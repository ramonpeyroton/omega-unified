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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

    const messages = ordered.map((m) => {
      const userId = m.user || m.bot_id || null;
      const userName = userId ? (usersMap[userId] || null) : null;
      return {
        ts:        m.ts,
        user:      userId,
        user_name: userName,
        text:      m.text || '',
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
