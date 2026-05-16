// Vercel Function: single handler for all Slack API routes.
// Fans out to three sub-handlers so the entire Slack integration
// counts as ONE serverless function — keeps us inside the Vercel
// Hobby 12-function cap.
//
// Routes:
//   GET  /api/slack/file-proxy?id=Fxxx  → stream private Slack file to browser
//   POST /api/slack/get-messages         → fetch recent channel messages
//   POST /api/slack/send-message         → post text + optional image to channel
//
// Disable Vercel's body-parser globally so formidable can stream
// multipart payloads for send-message. get-messages uses readJson()
// (manual parsing) and file-proxy is a GET with no body — both are
// unaffected by this setting.

import { readFile } from 'node:fs/promises';
import formidable from 'formidable';

import { supabase, requireSupabase } from '../_lib/supabase.js';
import { slack, requireSlack } from '../_lib/slack.js';
import { json, readJson } from '../_lib/http.js';
import { requireSecret } from '../_lib/requireSecret.js';

export const config = {
  api: { bodyParser: false },
};

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = req.query.action;

  // file-proxy: GET, used as <img src> — browser can't add auth headers,
  // so this route is intentionally unprotected (read-only, requires knowing
  // a valid Slack file ID anyway).
  if (action === 'file-proxy') return handleFileProxy(req, res);

  // All other Slack endpoints are internal — require the shared secret.
  if (!requireSecret(req, res)) return;

  if (action === 'get-messages')  return handleGetMessages(req, res);
  if (action === 'send-message')  return handleSendMessage(req, res);

  return json(res, 404, { ok: false, error: `Unknown Slack action: ${action}` });
}

// ─── GET /api/slack/file-proxy ────────────────────────────────────────────────
//
// Stream a Slack file (image, PDF, etc.) to the browser without exposing
// the Bot Token. Slack's url_private requires Authorization: Bearer <token>
// to load; browsers can't add custom headers to <img src="…"> requests, so
// without this proxy we can't render thumbnails inline. 1h cache header
// so repeated polls don't re-download the same image.

const MAX_PROXY_BYTES = 10 * 1024 * 1024; // 10 MB

async function handleFileProxy(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }
  const sl = requireSlack();
  if (!sl.ok) return json(res, 500, sl);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const id = url.searchParams.get('id');
  if (!id) return json(res, 400, { ok: false, error: 'Missing "id" query param' });

  let info;
  try {
    info = await slack.files.info({ file: id });
  } catch (err) {
    return json(res, 502, {
      ok: false,
      error: err?.data?.error || err?.message || 'Slack files.info failed',
    });
  }
  if (!info?.ok || !info.file) {
    return json(res, 404, { ok: false, error: info?.error || 'File not found' });
  }

  const file = info.file;
  const downloadUrl = file.url_private_download || file.url_private;
  if (!downloadUrl) return json(res, 404, { ok: false, error: 'File has no download URL' });
  if (file.size && file.size > MAX_PROXY_BYTES) {
    return json(res, 413, { ok: false, error: 'File too large to proxy' });
  }

  let upstream;
  try {
    upstream = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
  } catch (err) {
    return json(res, 502, { ok: false, error: err?.message || 'Could not fetch file from Slack' });
  }
  if (!upstream.ok) {
    return json(res, 502, { ok: false, error: `Slack returned ${upstream.status} for the file` });
  }

  res.setHeader(
    'Content-Type',
    file.mimetype || upstream.headers.get('content-type') || 'application/octet-stream',
  );
  res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
  if (file.name) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(file.name)}"`);
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = 200;
  res.end(buf);
}

function encodeFilename(name) {
  return /^[\x20-\x7E]+$/.test(name) ? name : encodeURIComponent(name);
}

// ─── POST /api/slack/get-messages ─────────────────────────────────────────────
//
// Fetch the most recent messages from the Slack channel linked to a job.
// Body: { jobId: string, limit?: number }

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const MENTION_OPEN  = '';
const MENTION_CLOSE = '';

// In-memory user-id → display name cache (warm for ~5 min Vercel instance).
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
        map[u.id] = u.real_name || u.profile?.real_name || u.name || u.id;
      }
      usersCache = map;
      usersCacheAt = Date.now();
      return map;
    }
  } catch {
    // missing_scope or network — return whatever we have (or empty).
  }
  return usersCache || {};
}

async function handleGetMessages(req, res) {
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

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, slack_channel_id')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) return json(res, 500, { ok: false, error: jobErr.message });
  if (!job)   return json(res, 404, { ok: false, error: 'Job not found' });

  if (!job.slack_channel_id) {
    return json(res, 200, { ok: true, channelId: null, messages: [], notSetUp: true });
  }

  try {
    const r = await slack.conversations.history({ channel: job.slack_channel_id, limit });
    if (!r.ok) {
      return json(res, 502, { ok: false, error: `Slack returned: ${r.error || 'unknown'}` });
    }

    const ordered = (r.messages || []).slice().reverse();
    const usersMap = await getUsersMap();

    let photoByName = {};
    try {
      const { data: appUsers } = await supabase.from('users').select('name, profile_photo_url');
      for (const u of appUsers || []) {
        if (u.name && u.profile_photo_url) {
          photoByName[u.name.trim().toLowerCase()] = u.profile_photo_url;
        }
      }
    } catch { /* non-fatal */ }

    function resolveAuthorName(message, slackResolved) {
      const text = message.text || '';
      const m = text.match(/^([^:\n]{1,60}):\s*([\s\S]*)$/);
      if (m && /[A-Za-z]/.test(m[1])) return m[1].trim();
      return slackResolved || null;
    }

    function tag(label) { return `${MENTION_OPEN}${label}${MENTION_CLOSE}`; }

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
        ts:   m.ts,
        user: userId,
        user_name: userName,
        author_photo_url,
        subtype: m.subtype || null,
        text: resolveSlackEntities(m.text || ''),
        files: Array.isArray(m.files) ? m.files.map((f) => ({
          id:        f.id,
          name:      f.name,
          mimetype:  f.mimetype,
          url:       f.url_private || f.permalink || null,
          permalink: f.permalink || null,
          proxy_url: `/api/slack/file-proxy?id=${encodeURIComponent(f.id)}`,
        })) : [],
        raw: m,
      };
    });

    return json(res, 200, { ok: true, channelId: job.slack_channel_id, messages });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.data?.error || err?.message || 'Slack request failed',
    });
  }
}

// ─── POST /api/slack/send-message ─────────────────────────────────────────────
//
// Post a new message — and optionally an image — into the Slack channel
// linked to a job.
//
// Two shapes:
//   JSON (text only):          { jobId, text }
//   multipart/form-data:       fields: jobId, text (optional); file: 1 image ≤ 4 MB

const MAX_TEXT  = 4000;
const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPTED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

async function handleSendMessage(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const sb = requireSupabase();
  if (!sb.ok) return json(res, 500, sb);
  const sl = requireSlack();
  if (!sl.ok) return json(res, 500, sl);

  const userName = (req.headers['x-omega-user'] || '').toString().trim();
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const isMultipart = contentType.includes('multipart/form-data');

  let payload;
  if (isMultipart) {
    try { payload = await parseMultipart(req); }
    catch (err) {
      return json(res, 400, { ok: false, error: err?.message || 'Could not parse multipart body' });
    }
  } else {
    try { payload = await readJson(req); }
    catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }
    payload = { ...payload, file: null };
  }

  const { jobId, text: rawText, file } = payload;
  const text = typeof rawText === 'string' ? rawText.trim() : '';

  if (!jobId || typeof jobId !== 'string') {
    return json(res, 400, { ok: false, error: 'Missing "jobId"' });
  }
  if (!text && !file) {
    return json(res, 400, { ok: false, error: 'Provide a message, an image, or both.' });
  }
  if (text.length > MAX_TEXT) {
    return json(res, 400, { ok: false, error: `Text exceeds ${MAX_TEXT} characters` });
  }
  if (file) {
    if (file.size > MAX_BYTES) {
      return json(res, 400, {
        ok: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 4 MB.`,
      });
    }
    if (!ACCEPTED_MIMES.has(file.mimetype) && !/\.heic$/i.test(file.filename || '')) {
      return json(res, 400, {
        ok: false,
        error: `Unsupported file type "${file.mimetype || 'unknown'}". Allowed: JPG, PNG, WEBP, HEIC.`,
      });
    }
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, slack_channel_id')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) return json(res, 500, { ok: false, error: jobErr.message });
  if (!job)   return json(res, 404, { ok: false, error: 'Job not found' });
  if (!job.slack_channel_id) {
    return json(res, 400, { ok: false, error: 'This job is not connected to a Slack channel yet.' });
  }

  const credit = userName ? `${userName}: ` : '';
  const finalText = `${credit}${text}`;

  try {
    if (file) {
      const fileBuffer = await readFile(file.tempPath);
      const r = await slack.files.uploadV2({
        channel_id: job.slack_channel_id,
        file: fileBuffer,
        filename: file.filename || 'upload',
        initial_comment: finalText || credit || undefined,
      });
      if (!r.ok) {
        return json(res, 502, { ok: false, error: `Slack returned: ${r.error || 'unknown'}` });
      }
      return json(res, 200, {
        ok: true,
        channelId: job.slack_channel_id,
        file_id: r.files?.[0]?.id || null,
      });
    }

    const r = await slack.chat.postMessage({
      channel: job.slack_channel_id,
      text: finalText,
      mrkdwn: true,
    });
    if (!r.ok) {
      return json(res, 502, { ok: false, error: `Slack returned: ${r.error || 'unknown'}` });
    }
    return json(res, 200, { ok: true, ts: r.ts, channelId: job.slack_channel_id });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.data?.error || err?.message || 'Slack request failed',
    });
  }
}

async function parseMultipart(req) {
  const form = formidable({ multiples: false, maxFileSize: MAX_BYTES, keepExtensions: true });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      const jobId = pickFirst(fields.jobId);
      const text  = pickFirst(fields.text) || '';
      const f     = pickFirst(files.file);
      const file  = f
        ? {
            tempPath: f.filepath,
            filename: f.originalFilename || 'upload',
            mimetype: f.mimetype || 'application/octet-stream',
            size: f.size,
          }
        : null;
      resolve({ jobId, text, file });
    });
  });
}

function pickFirst(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}
