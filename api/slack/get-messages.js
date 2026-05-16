// Vercel Function: fetch the most recent messages from the Slack
// channel linked to a job. Drives the "Daily Logs" tab inside
// JobFullView (Sprint 3 — frontend not built yet).
//
// Method: POST   (POST so we can carry context headers cleanly; payload
//                 is small enough that GET would work too — just kept
//                 the project's existing style)
// Body:   { jobId: string, limit?: number }
//
// Response:
//   { ok: true,  channelId, messages: [{ ts, user, text, files, raw }] }
//   { ok: true,  channelId: null, messages: [], notSetUp: true }
//                ↑ job has no slack_channel_id yet — UI shows empty state.
//   { ok: false, error: "..." }
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (read jobs.slack_channel_id)
//   SLACK_BOT_TOKEN                           (xoxb-...)

import { supabase, requireSupabase } from '../_lib/supabase.js';
import { slack, requireSlack } from '../_lib/slack.js';
import { json, readJson } from '../_lib/http.js';
import { requireSecret } from '../_lib/requireSecret.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Token bytes used to wrap resolved Slack mentions / channel refs /
// keywords in the response text. U+E000 and U+E001 are in the BMP
// Private Use Area — no font assigns glyphs there, so they stay
// invisible if anything ever leaks past the frontend's strip step.
//
// We use them so the frontend can find resolved mentions and turn
// them into colored pills without guessing whether "@something" is
// a mention or a literal "@" the user typed.
const MENTION_OPEN  = '';
const MENTION_CLOSE = '';

// In-memory user-id → display name cache. Lives only as long as the
// serverless function instance stays warm (Vercel reuses warm instances
// for ~5min of idleness), then cold-starts and rebuilds on next call.
// 1h TTL inside the warm window so a renamed user isn't stuck forever.
const USERS_CACHE_TTL_MS = 60 * 60 * 1000;
let usersCache = null;
let usersCacheAt = 0;

async function getUsersMap() {
  const fresh = usersCache && (Date.now() - usersCacheAt < USERS_CACHE_TTL_MS);
  if (fresh) return usersCache;
  try {
    const r = await slack.users.list({ limit: 200 });
    if (r.ok) {
      const map = {};
      for (const u of r.members || []) {
        // real_name is filled when the user has set their full name in
        // their profile; falls back to the Slack handle otherwise.
        map[u.id] = u.real_name || u.profile?.real_name || u.name || u.id;
      }
      usersCache = map;
      usersCacheAt = Date.now();
      return map;
    }
  } catch {
    // Most likely cause: missing_scope (users:read not granted yet).
    // We swallow it and return whatever we had (or empty) — the UI
    // will still render with "Slack user" until the scope is added.
  }
  return usersCache || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }
  if (!requireSecret(req, res)) return;

  const sb = requireSupabase();
  if (!sb.ok) return json(res, 500, sb);
  const sl = requireSlack();
  if (!sl.ok) return json(res, 500, sl);

  let payload;
  try { payload = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const { jobId } = payload || {};
  const limit = Math.min(Math.max(Number(payload?.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  if (!jobId || typeof jobId !== 'string') {
    return json(res, 400, { ok: false, error: 'Missing "jobId"' });
  }

  // 1. Look up the channel id stored against this job.
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, slack_channel_id')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr) {
    return json(res, 500, { ok: false, error: jobErr.message });
  }
  if (!job) {
    return json(res, 404, { ok: false, error: 'Job not found' });
  }

  // No channel yet → tell the UI to show "not connected" empty state
  // instead of an error. Setup will happen in Sprint 3 UX.
  if (!job.slack_channel_id) {
    return json(res, 200, {
      ok: true,
      channelId: null,
      messages: [],
      notSetUp: true,
    });
  }

  // 2. Hit Slack. Surface their error verbatim — Slack's error strings
  //    ("channel_not_found", "not_in_channel", "invalid_auth") are more
  //    actionable for debugging than anything we'd wrap them in.
  try {
    const r = await slack.conversations.history({
      channel: job.slack_channel_id,
      limit,
    });

    if (!r.ok) {
      return json(res, 502, {
        ok: false,
        error: `Slack returned: ${r.error || 'unknown'}`,
      });
    }

    // Reverse so the oldest message is first — matches a chat-style
    // top-down render. Slack returns newest-first by default.
    const ordered = (r.messages || []).slice().reverse();

    // Resolve user IDs → real names so messages typed directly inside
    // Slack (no credit-line prefix) show "Brenda Souza" instead of
    // "Slack user". One users.list call is enough — we cache it.
    const usersMap = await getUsersMap();

    // Lookup map: app-side `users.name` (lowercased) → profile photo URL.
    // Used to attach a profile photo to each message based on the
    // resolved author name. Match is case-insensitive on the trimmed
    // name; nothing fancy. Names that don't match silently get no
    // photo and the chat falls back to the colored-initial avatar.
    let photoByName = {};
    try {
      const { data: appUsers } = await supabase
        .from('users')
        .select('name, profile_photo_url');
      for (const u of appUsers || []) {
        if (u.name && u.profile_photo_url) {
          photoByName[u.name.trim().toLowerCase()] = u.profile_photo_url;
        }
      }
    } catch {
      // Non-fatal — chat keeps working without photos.
    }

    // Also try to resolve the author from any "Name: ..." credit line
    // the app prepends, so app-posted messages get a photo even when
    // the underlying Slack user_id maps to "Omega Bot".
    function resolveAuthorName(message, slackResolved) {
      const text = message.text || '';
      const m = text.match(/^([^:\n]{1,60}):\s*([\s\S]*)$/);
      if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
      return slackResolved || null;
    }

    // Replace Slack's "magic" entity tokens with human-readable text:
    //   <@U0123ABCDEF>          → @Brenda Souza   (or @user when unknown)
    //   <#C0123ABCDEF|general>  → #general
    //   <!channel>/<!here>      → @channel/@here
    // Hyperlinks (<https://...>) are left alone — the frontend converts
    // those into real <a> tags during rendering so the user can click.
    //
    // Wrap each in MENTION_OPEN..MENTION_CLOSE so the frontend can
    // identify them later and render them as colored pills.
    function tag(label) {
      return `${MENTION_OPEN}${label}${MENTION_CLOSE}`;
    }

    function resolveSlackEntities(text) {
      if (!text) return '';
      return text
        .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g, (_, id) => {
          const name = usersMap[id];
          return tag(`@${name || 'user'}`);
        })
        .replace(/<#[A-Z0-9]+\|([^>]+)>/g, (_, label) => tag(`#${label}`))
        .replace(/<!(channel|here|everyone)>/g, (_, kw) => tag(`@${kw}`));
    }

    const messages = ordered.map((m) => {
      const userId = m.user || m.bot_id || null;
      const userName = userId ? (usersMap[userId] || null) : null;
      const authorForPhoto = resolveAuthorName(m, userName);
      const author_photo_url = authorForPhoto
        ? (photoByName[authorForPhoto.trim().toLowerCase()] || null)
        : null;
      return {
        ts:               m.ts,
        user:             userId,
        user_name:        userName,
        author_photo_url,
        // Slack message subtype (channel_join, channel_leave, etc).
        // Surface so the frontend can render system-style rows.
        subtype:          m.subtype || null,
        text:             resolveSlackEntities(m.text || ''),
        files: Array.isArray(m.files) ? m.files.map((f) => ({
          id:        f.id,
          name:      f.name,
          mimetype:  f.mimetype,
          url:       f.url_private || f.permalink || null,
          // Permalink works for click-to-open inside Slack itself.
          permalink: f.permalink || null,
          // Pre-resolved local proxy URL — the frontend uses this for
          // <img> so the browser can load the bytes without the
          // Slack token. See api/slack/file-proxy.js.
          proxy_url: `/api/slack/file-proxy?id=${encodeURIComponent(f.id)}`,
        })) : [],
        // Keep the raw payload so the UI can render reactions, threads,
        // edits etc. as we add them — without us needing to bump the
        // backend schema every time.
        raw: m,
      };
    });

    return json(res, 200, {
      ok: true,
      channelId: job.slack_channel_id,
      messages,
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.data?.error || err?.message || 'Slack request failed',
    });
  }
}
