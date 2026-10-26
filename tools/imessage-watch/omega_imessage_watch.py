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
  python3 omega_imessage_watch.py --unmatched  active groups NOT recognised as client groups
  python3 omega_imessage_watch.py --test-acks  which sample messages count as "no answer needed"

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
# Sent with every report; the app logs it in the hourly heartbeat, so we can
# see from the app whether the Mac is running the latest copy.
WATCHER_VERSION = 5

# Messages that don't need an answer: short replies made ONLY of these words
# (plus team names, emoji and the filler words below), e.g. "Awesome, thank
# you Attila!" or "Perfect thanks so much 🙏". Anything with a "?" or another
# word counts as a message that needs an answer (Ramon, 14/10/26).
ACK_TOKENS = {
    "ok", "okay", "k", "kk", "thanks", "thank", "you", "u", "thx", "ty", "tysm", "tks",
    "great", "perfect", "awesome", "amazing", "wonderful", "excellent", "fantastic", "beautiful",
    "sounds", "good", "looks", "got", "it", "cool", "nice", "yes", "yep", "yeah", "yup", "sure",
    "will", "do", "appreciate", "appreciated", "noted", "understood", "alright", "right", "fine",
    "love", "np", "no", "problem", "welcome", "youre", "glad", "job", "done", "deal",
    "obrigado", "obrigada", "valeu", "beleza", "blz", "show", "certo", "combinado", "perfeito",
    "otimo", "maravilha", "top", "tmj", "massa", "legal", "joia", "sim", "ta", "bom",
}
ACK_FILLER = {
    "so", "much", "a", "lot", "very", "really", "again", "guys", "team", "all", "as", "always",
    "for", "everything", "the", "update", "info", "man", "buddy", "sir", "and", "omega",
    "muito", "pessoal", "de", "novo", "mesmo", "e", "pela", "pelo", "atualizacao",
}
# iMessage reactions (tapbacks) from the team count as "answered":
# 2000 love, 2001 like, 2002 dislike, 2003 laugh, 2004 emphasize, 2006 emoji.
# 2005 ("?") does not — that's asking, not answering. 3000+ = reaction removed.
TEAM_REACTIONS = {2000, 2001, 2002, 2003, 2004, 2006}
# Text stand-ins for things that aren't new messages. A Mac without iMessage
# editing (older macOS) gets each edit as a new 'Edited to "…"' message, and
# Android/old phones send reactions as 'Liked "…"'. From a client they would
# look like a new message after the team's answer (Nicolas & EJ, 26/10/26).
FALLBACK_RE = re.compile(
    r'^\s*(edited to|loved|liked|disliked|laughed at|emphasi[sz]ed|questioned|reacted .{1,12} to|removed a .{1,20} from)\s*["“”]',
    re.IGNORECASE)


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


def is_ack(text, names=()):
    t = fold(text).strip()
    if not t or not re.search(r"[a-z0-9]", t):  # empty / emoji / punctuation only
        return True
    if "?" in t:
        return False
    words = re.findall(r"[a-z0-9]+", t.replace("'", "").replace("’", ""))
    if not words or len(words) > 10:
        return False
    skip = ACK_FILLER | {n for n in names if n}
    rest = [w for w in words if w not in skip]
    return bool(rest) and all(w in ACK_TOKENS for w in rest)


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
    # config.json "team_handles": extra numbers/emails the team uses in the
    # groups, e.g. {"+12035551234": "attila", "office@icloud.com": "team"}.
    extra = {}
    for k, v in (cfg.get("team_handles") or {}).items():
        if last10(k):
            team_by_digits[last10(k)] = v
        else:
            extra[k.lower()] = v
    clients = {c["digits"]: c for c in directory.get("clients", [])}
    # Subcontractors (from the app) + config "ignore_handles": skipped entirely.
    ignore = set(directory.get("ignore", []))
    ignore.update(last10(h) or h.lower() for h in (cfg.get("ignore_handles") or []))
    return team_by_digits, team_first, extra, clients, ignore


def who_is(handle, team_by_digits, extra):
    if not handle:
        return None
    if handle.lower() in extra:
        return extra[handle.lower()]
    return team_by_digits.get(last10(handle))


def ignored(handle, ignore):
    return bool(handle) and (last10(handle) in ignore or handle.lower() in ignore)


DIRECT_STYLE = 45  # chat.style for 1:1 chats
# An unknown number/email in the client groups of this many different clients
# is the team on another handle (e.g. Attila's Apple ID email), not a client.
AUTO_TEAM_MIN_GROUPS = 3

MSG_SQL = """SELECT m.guid, m.text, m.attributedBody, m.is_from_me, m.date, m.cache_has_attachments, h.id AS handle,
                    COALESCE(m.associated_message_type, 0) AS reaction
             FROM chat_message_join cmj
             JOIN message m ON m.ROWID = cmj.message_id
             LEFT JOIN handle h ON h.ROWID = m.handle_id
             WHERE cmj.chat_id = ? AND m.date > ?
               AND (COALESCE(m.associated_message_type, 0) = 0 OR m.associated_message_type BETWEEN 2000 AND 2006)
               AND COALESCE(m.item_type, 0) = 0
             ORDER BY m.date"""


def norm_handle(h):
    return last10(h) or (h or "").lower()


def mask(h):
    """Short, privacy-friendly label for a handle in the app's log."""
    if not h:
        return "?"
    if last10(h):
        return "…" + last10(h)[-4:]
    user, _, domain = h.partition("@")
    return f"{user[:2]}…@{domain}" if domain else h[:4] + "…"


def chat_handles(con, rowid):
    return [r["id"] for r in con.execute(
        "SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?",
        (rowid,))]


def scan(con, directory, cfg):
    team_by_digits, team_first, extra, clients, ignore = build_identity(directory, cfg)
    me = directory.get("me", "inacio")
    since_apple = (datetime.now(timezone.utc).timestamp() - LOOKBACK_DAYS * 86400 - APPLE_EPOCH) * 1e9

    # 1. Client group chats. The iPhone often keeps the same group twice (an
    #    SMS thread and an iMessage thread with the same people), and the
    #    client may write in one while the team answers in the other. Threads
    #    with the same people are read as ONE group.
    logical = {}
    for chat in con.execute("SELECT ROWID, guid, display_name FROM chat WHERE style = ?", (GROUP_STYLE,)):
        handles = chat_handles(con, chat["ROWID"])
        group_clients = [clients[last10(h)] for h in handles if last10(h) in clients]
        if not group_clients:
            continue  # not a client group (family, friends, team-only…)
        key = frozenset(norm_handle(h) for h in handles if h)
        g = logical.setdefault(key, {"chats": [], "handles": set(), "clients": {}})
        g["chats"].append(chat)
        g["handles"].update(handles)
        for c in group_clients:
            g["clients"][c["digits"]] = c

    # 2. Unknown handles seen across many clients' groups = the team.
    seen_in = {}
    for g in logical.values():
        for h in g["handles"]:
            if who_is(h, team_by_digits, extra) or ignored(h, ignore) or last10(h) in clients:
                continue
            seen_in.setdefault(norm_handle(h), set()).add(frozenset(g["clients"]))
    auto_team = {n for n, s in seen_in.items() if len(s) >= AUTO_TEAM_MIN_GROUPS}

    def sender_of(is_from_me, handle):
        if is_from_me:
            return me
        k = who_is(handle, team_by_digits, extra)
        if k:
            return k
        return "team" if handle and norm_handle(handle) in auto_team else None

    # 3. Inácio texting the client directly (1:1) also answers the group.
    direct = {}
    for chat in con.execute("SELECT ROWID FROM chat WHERE style = ?", (DIRECT_STYLE,)):
        hs = chat_handles(con, chat["ROWID"])
        if len(hs) != 1 or last10(hs[0]) not in clients:
            continue
        for r in con.execute(
                """SELECT m.date FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
                   WHERE cmj.chat_id = ? AND m.date > ? AND m.is_from_me = 1""", (chat["ROWID"], since_apple)):
            direct.setdefault(last10(hs[0]), []).append(apple_time(r["date"]))

    names = set(team_first.values())
    groups = []
    for g in logical.values():
        events, others = [], set()
        for chat in g["chats"]:
            for m in con.execute(MSG_SQL, (chat["ROWID"], since_apple)).fetchall():
                if not m["is_from_me"] and ignored(m["handle"], ignore):
                    continue  # a subcontractor: neither a question nor an answer
                sender = sender_of(m["is_from_me"], m["handle"])
                at = apple_time(m["date"])
                if m["reaction"]:
                    # A 👍/❤️/… from the team = everything before it is answered.
                    if sender and m["reaction"] in TEAM_REACTIONS:
                        events.append({"at": at, "team": sender, "mark": True})
                    continue  # client reactions are neither questions nor answers
                text = m["text"] or decode_attributed_body(m["attributedBody"]) or ""
                text = text.replace("￼", "").strip()
                if not text and m["cache_has_attachments"]:
                    text = "[photo/attachment]"
                if not sender and FALLBACK_RE.match(text):
                    continue  # a client's edit / text reaction: not a new message
                if not sender and last10(m["handle"]) not in g["clients"]:
                    others.add(mask(m["handle"]))
                events.append({"guid": m["guid"], "chat_guid": chat["guid"], "text": text, "at": at,
                               "team": sender, "handle": m["handle"]})
        for d in g["clients"]:
            for t in direct.get(d, []):
                events.append({"at": t, "team": me, "mark": True})
        events.sort(key=lambda e: e["at"])

        msgs, last_team = [], None  # last_team = (index, who, when)
        for e in events:
            if e.get("mark"):
                last_team = (len(msgs) - 1, e["team"], e["at"])
                continue
            msgs.append(e)
            if e["team"]:
                last_team = (len(msgs) - 1, e["team"], e["at"])

        start = last_team[0] + 1 if last_team else 0
        waiting = [x for x in msgs[start:] if not x["team"] and x["text"] and not is_ack(x["text"], names)]
        clients_list = list(g["clients"].values())
        name = next((c["display_name"] for c in g["chats"] if c["display_name"]), None) or f"{clients_list[0]['name']} group"
        groups.append({
            "name": name, "handles": sorted(g["handles"]), "clients": clients_list, "waiting": waiting,
            "threads": len(g["chats"]), "last_team": last_team[1] if last_team else None,
            "last_team_at": last_team[2] if last_team else None, "others": sorted(others),
            "auto_team": {h for h in g["handles"] if norm_handle(h) in auto_team},
        })

    pending = []
    for g in groups:
        if not g["waiting"]:
            continue
        first = g["waiting"][0]
        # Who was asked: a team name in the client's messages → that person;
        # else whoever from the team spoke last in the group; else Inácio.
        said = " ".join(fold(x["text"]) for x in g["waiting"])
        asked = next((k for k, f in team_first.items() if f and re.search(r"\b" + re.escape(f) + r"\b", said)), None)
        asked = asked or (g["last_team"] if g["last_team"] in team_first else me)
        sender_client = next((c for c in g["clients"] if c["digits"] == last10(first["handle"])), None)
        client = sender_client["name"] if sender_client else (first["handle"] or g["clients"][0]["name"])
        last_team = f"{g['last_team']} {g['last_team_at'].isoformat()}" if g["last_team"] else None
        pending.append({
            "chat": first["chat_guid"], "msg": first["guid"], "group": g["name"], "client": client,
            "text": first["text"][:300], "since": first["at"].isoformat(), "asked": asked, "count": len(g["waiting"]),
            # Why it counts as unanswered, kept in the app's log for checking.
            "diag": {
                "threads": g["threads"],
                "last_team": last_team,
                "from": "client" if sender_client else "unknown " + mask(first["handle"]),
                "unknown": g["others"][:5],
            },
        })
    return groups, pending


def unmatched(con, directory, cfg):
    """Group chats with recent messages but no client phone from the app."""
    team_by_digits, _, extra, clients, ignore = build_identity(directory, cfg)
    since_apple = (datetime.now(timezone.utc).timestamp() - LOOKBACK_DAYS * 86400 - APPLE_EPOCH) * 1e9
    rows = con.execute(
        """SELECT c.ROWID, c.display_name, MAX(m.date) AS last
           FROM chat c JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
           JOIN message m ON m.ROWID = cmj.message_id
           WHERE c.style = ? AND m.date > ? GROUP BY c.ROWID ORDER BY last DESC""",
        (GROUP_STYLE, since_apple)).fetchall()
    found = 0
    for r in rows:
        handles = [h["id"] for h in con.execute(
            "SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?",
            (r["ROWID"],))]
        if any(last10(h) in clients for h in handles):
            continue
        found += 1
        print(f"\n== {r['display_name'] or '(no name)'}  last message {apple_time(r['last']).astimezone():%a %b %d %H:%M}")
        for h in handles:
            k = who_is(h, team_by_digits, extra)
            print(f"   {h:<32} {'TEAM ' + k if k else 'SUB (ignored)' if ignored(h, ignore) else 'not in the app'}")
    print(f"\n{found} active groups without a client phone from the app")


ACK_SAMPLES = [
    ("Awesome", True), ("Awesome!", True), ("Awesome, thank you!", True), ("Awesome thanks Attila", True),
    ("Perfect, thanks so much 🙏", True), ("Great, thank you guys!", True), ("Thank you so much again Inácio", True),
    ("👍", True), ("Ok sounds good", True), ("Valeu, obrigado!", True), ("Got it, will do", True),
    ("You're welcome", True), ("Awesome, when do you start?", False), ("Ok?", False),
    ("Thanks, can you send the invoice", False), ("Perfect, see you Monday at 9", False),
    ("The tile arrived broken", False), ("[photo/attachment]", False), ("No, the plumber didn't come", False),
]


def test_acks():
    bad = 0
    for text, want in ACK_SAMPLES:
        got = is_ack(text, {"attila", "inacio", "joel", "rafaela", "ramon"})
        bad += got != want
        print(f"{'OK ' if got == want else 'BAD'}  {'no answer needed' if got else 'needs an answer':<17} {text}")
    print(f"\n{len(ACK_SAMPLES) - bad}/{len(ACK_SAMPLES)} as expected")
    return bad


def main():
    args = set(sys.argv[1:])
    if "--test-acks" in args:
        sys.exit(1 if test_acks() else 0)
    cfg = load_config()
    directory = api(cfg, "GET")
    con, tmp = open_db_copy()
    try:
        if "--unmatched" in args:
            unmatched(con, directory, cfg)
            return
        groups, pending = scan(con, directory, cfg)
    finally:
        con.close()
        shutil.rmtree(tmp, ignore_errors=True)

    if "--list" in args:
        team_by_digits, _, extra, _, ignore = build_identity(directory, cfg)
        for g in groups:
            threads = f", {g['threads']} threads read as one" if g["threads"] > 1 else ""
            print(f"\n== {g['name']}  (clients: {', '.join(c['name'] for c in g['clients'])}{threads})")
            for h in g["handles"]:
                k = who_is(h, team_by_digits, extra)
                tag = (f"TEAM {k}" if k else "SUB (ignored)" if ignored(h, ignore)
                       else "TEAM (other handle, seen in many client groups)" if h in g["auto_team"]
                       else "CLIENT" if last10(h) in {c['digits'] for c in g['clients']} else "other (treated as client)")
                print(f"   {h:<32} {tag}")
            if g["last_team_at"]:
                print(f"   last team answer: {g['last_team']} {g['last_team_at'].astimezone():%a %H:%M}")
            if g["waiting"]:
                w = g["waiting"][0]
                print(f"   -> unanswered since {w['at'].astimezone():%a %H:%M}: {w['text'][:80]!r} (+{len(g['waiting']) - 1})")
        print(f"\n{len(groups)} client groups, {len(pending)} unanswered")
        return

    result = api(cfg, "POST", {"pending": pending, "dry_run": "--dry-run" in args, "version": WATCHER_VERSION})
    log(f"groups={len(groups)} pending={len(pending)}", json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # keep launchd logs readable
        log("ERROR", repr(e))
        sys.exit(1)
