#!/usr/bin/env python3
"""Omega — client group-chat watcher (runs hourly on Inácio's MacBook).

The Mac is signed in to Inácio's iCloud, so Messages there has every client
group chat (blue and green). Every hour this script:
  1. asks the Omega app for the directory (team phones + client phones),
  2. reads ~/Library/Messages/chat.db (read-only copy),
  3. keeps only group chats that include a client from the app,
  4. finds groups where a client wrote and nobody from the team answered,
  5. reports those to the app, which sends the WhatsApp reminders.

Nothing else leaves the Mac: personal chats are skipped, and only the
unanswered client message (text, time, group name) is reported.

Usage:
  python3 omega_imessage_watch.py            normal hourly run
  python3 omega_imessage_watch.py --list     show client groups + who is who (no report)
  python3 omega_imessage_watch.py --dry-run  report, but the app only says what it WOULD send

Python 3.8+ standard library only (macOS Command Line Tools).
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")
APPLE_EPOCH = 978307200  # 2001-01-01 in unix seconds
LOOKBACK_DAYS = 4
GROUP_STYLE = 43  # chat.style for group chats

# Messages that don't need an answer.
ACK_WORDS = {
    "ok", "okay", "k", "kk", "thanks", "thank you", "thank you so much", "thanks so much", "thx", "ty",
    "great", "perfect", "awesome", "sounds good", "got it", "cool", "nice", "yes", "yep", "sure", "will do",
    "obrigado", "obrigada", "valeu", "beleza", "blz", "show", "certo", "combinado", "perfeito", "otimo", "ótimo",
}


def log(*args):
    print(datetime.now().strftime("%Y-%m-%d %H:%M"), *args, flush=True)


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    if not cfg.get("url") or not cfg.get("secret"):
        raise SystemExit("config.json needs 'url' and 'secret'")
    return cfg


def api(cfg, method, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        cfg["url"], data=data, method=method,
        headers={"x-watch-secret": cfg["secret"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def fold(s):
    """Lowercase, no accents — for matching names like Inácio/Inacio."""
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def last10(handle):
    digits = re.sub(r"\D", "", handle or "")
    return digits[-10:] if len(digits) >= 10 else ""


def apple_time(value):
    """chat.db dates: nanoseconds (or seconds on old rows) since 2001-01-01."""
    if not value:
        return None
    secs = value / 1e9 if value > 1e11 else value
    return datetime.fromtimestamp(secs + APPLE_EPOCH, tz=timezone.utc)


def decode_attributed_body(blob):
    """Text of messages whose `text` column is empty (typedstream NSString)."""
    if not blob:
        return None
    blob = bytes(blob)
    i = blob.find(b"NSString")
    if i < 0:
        return None
    i = blob.find(b"\x2b", i)  # '+' marks the string payload
    if i < 0:
        return None
    i += 1
    n = blob[i]
    i += 1
    if n == 0x81:
        n = int.from_bytes(blob[i:i + 2], "little")
        i += 2
    elif n == 0x82:
        n = int.from_bytes(blob[i:i + 3], "little")
        i += 3
    return blob[i:i + n].decode("utf-8", "replace")


def is_ack(text):
    t = fold(text).strip()
    t = re.sub(r"[\s!.,?❤️👍🙏😊🙂😀👌🏻🏼🏽🏾🏿]+$", "", t).strip()
    if not t:
        return True
    if not re.search(r"[a-z0-9]", t):  # emoji / punctuation only
        return True
    return t in ACK_WORDS


def open_db_copy():
    """Copy chat.db (+ WAL files) so we never lock or touch the live database."""
    tmp = tempfile.mkdtemp(prefix="omega-chatdb-")
    for suffix in ("", "-wal", "-shm"):
        src = CHAT_DB + suffix
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(tmp, "chat.db" + suffix))
    con = sqlite3.connect(os.path.join(tmp, "chat.db"))
    con.row_factory = sqlite3.Row
    return con, tmp


def build_identity(directory, cfg):
    team_by_digits = {t["digits"]: t["key"] for t in directory.get("team", []) if t.get("digits")}
    team_first = {t["key"]: fold(t.get("first", "")) for t in directory.get("team", [])}
    extra = {k.lower(): v for k, v in (cfg.get("team_handles") or {}).items()}
    clients = {c["digits"]: c for c in directory.get("clients", [])}
    return team_by_digits, team_first, extra, clients


def who_is(handle, team_by_digits, extra):
    if not handle:
        return None
    if handle.lower() in extra:
        return extra[handle.lower()]
    return team_by_digits.get(last10(handle))


def scan(con, directory, cfg):
    team_by_digits, team_first, extra, clients = build_identity(directory, cfg)
    me = directory.get("me", "inacio")
    since_apple = (datetime.now(timezone.utc).timestamp() - LOOKBACK_DAYS * 86400 - APPLE_EPOCH) * 1e9

    groups = []
    for chat in con.execute("SELECT ROWID, guid, display_name FROM chat WHERE style = ?", (GROUP_STYLE,)):
        handles = [r["id"] for r in con.execute(
            "SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?",
            (chat["ROWID"],))]
        group_clients = [clients[last10(h)] for h in handles if last10(h) in clients]
        if not group_clients:
            continue  # not a client group (family, friends, team-only…)

        rows = con.execute(
            """SELECT m.guid, m.text, m.attributedBody, m.is_from_me, m.date, m.cache_has_attachments, h.id AS handle
               FROM chat_message_join cmj
               JOIN message m ON m.ROWID = cmj.message_id
               LEFT JOIN handle h ON h.ROWID = m.handle_id
               WHERE cmj.chat_id = ? AND m.date > ?
                 AND COALESCE(m.associated_message_type, 0) = 0
                 AND COALESCE(m.item_type, 0) = 0
               ORDER BY m.date""",
            (chat["ROWID"], since_apple)).fetchall()

        last_team = None  # (index, key)
        msgs = []
        for i, m in enumerate(rows):
            text = m["text"] or decode_attributed_body(m["attributedBody"]) or ""
            text = text.replace("￼", "").strip()
            if not text and m["cache_has_attachments"]:
                text = "[photo/attachment]"
            sender = me if m["is_from_me"] else who_is(m["handle"], team_by_digits, extra)
            msgs.append({"guid": m["guid"], "text": text, "at": apple_time(m["date"]), "team": sender, "handle": m["handle"]})
            if sender:
                last_team = (i, sender)

        start = last_team[0] + 1 if last_team else 0
        waiting = [x for x in msgs[start:] if not x["team"] and x["text"] and not is_ack(x["text"])]
        name = chat["display_name"] or f"{group_clients[0]['name']} group"
        groups.append({"chat": chat, "name": name, "handles": handles, "clients": group_clients,
                       "waiting": waiting, "last_team": last_team[1] if last_team else None})

    pending = []
    for g in groups:
        if not g["waiting"]:
            continue
        first = g["waiting"][0]
        # Who was asked: a team name in the client's messages → that person;
        # else whoever from the team spoke last in the group; else Inácio.
        said = " ".join(fold(x["text"]) for x in g["waiting"])
        asked = next((k for k, f in team_first.items() if f and re.search(r"\b" + re.escape(f) + r"\b", said)), None)
        asked = asked or g["last_team"] or me
        sender_client = next((c for c in g["clients"] if c["digits"] == last10(first["handle"])), None)
        client = sender_client["name"] if sender_client else (first["handle"] or g["clients"][0]["name"])
        pending.append({
            "chat": g["chat"]["guid"], "msg": first["guid"], "group": g["name"], "client": client,
            "text": first["text"][:300], "since": first["at"].isoformat(), "asked": asked, "count": len(g["waiting"]),
        })
    return groups, pending


def main():
    args = set(sys.argv[1:])
    cfg = load_config()
    directory = api(cfg, "GET")
    con, tmp = open_db_copy()
    try:
        groups, pending = scan(con, directory, cfg)
    finally:
        con.close()
        shutil.rmtree(tmp, ignore_errors=True)

    if "--list" in args:
        team_by_digits, _, extra, _ = build_identity(directory, cfg)
        for g in groups:
            print(f"\n== {g['name']}  (clients: {', '.join(c['name'] for c in g['clients'])})")
            for h in g["handles"]:
                k = who_is(h, team_by_digits, extra)
                tag = f"TEAM {k}" if k else ("CLIENT" if last10(h) in {c['digits'] for c in g['clients']} else "other (treated as client)")
                print(f"   {h:<32} {tag}")
            if g["waiting"]:
                w = g["waiting"][0]
                print(f"   -> unanswered since {w['at'].astimezone():%a %H:%M}: {w['text'][:80]!r} (+{len(g['waiting']) - 1})")
        print(f"\n{len(groups)} client groups, {len(pending)} unanswered")
        return

    result = api(cfg, "POST", {"pending": pending, "dry_run": "--dry-run" in args})
    log(f"groups={len(groups)} pending={len(pending)}", json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # keep launchd logs readable
        log("ERROR", repr(e))
        sys.exit(1)
