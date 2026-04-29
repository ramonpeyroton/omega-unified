// Vercel Function: stream a Slack file (image, PDF, etc.) to the
// browser without exposing the Bot Token.
//
// Slack's url_private requires Authorization: Bearer <token> to load.
// Browsers can't add custom headers to <img src="..."> requests, so
// without this proxy we can't render Slack thumbnails inline. The
// proxy reads the file once with the bot token and streams the bytes
// to the client over a normal CORS-clean response.
//
// Method: GET   (so it works as <img src="/api/slack/file-proxy?id=...">)
// Query:  ?id=Fxxxxxxxx   — the Slack file ID (from message.files[].id)
//
// Response: the raw file bytes with the right Content-Type. 1h cache
// header so the browser doesn't re-fetch on every poll.
//
// Errors: short JSON { ok:false, error } so the frontend can show a
// fallback chip if a particular file fails.
//
// Required env: SLACK_BOT_TOKEN
// Required Slack scope: files:read (already granted in Sprint 1).

import { slack, requireSlack } from '../_lib/slack.js';
import { json } from '../_lib/http.js';

// Cap at 10MB — matches the upload ceiling we'd accept (4MB after
// compression) plus generous headroom for older files. Beyond this
// the response would be heavy enough that we'd rather link out.
const MAX_PROXY_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }
  const sl = requireSlack();
  if (!sl.ok) return json(res, 500, sl);

  // Parse ?id from the URL — Vercel Node functions don't auto-parse query.
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const id = url.searchParams.get('id');
  if (!id) {
    return json(res, 400, { ok: false, error: 'Missing "id" query param' });
  }

  // 1. files.info to find the URL + mimetype + size.
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
    return json(res, 404, {
      ok: false,
      error: info?.error || 'File not found',
    });
  }

  const file = info.file;
  const downloadUrl = file.url_private_download || file.url_private;
  if (!downloadUrl) {
    return json(res, 404, { ok: false, error: 'File has no download URL' });
  }
  if (file.size && file.size > MAX_PROXY_BYTES) {
    return json(res, 413, { ok: false, error: 'File too large to proxy' });
  }

  // 2. Fetch the bytes with the bot token.
  let upstream;
  try {
    upstream = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
  } catch (err) {
    return json(res, 502, {
      ok: false,
      error: err?.message || 'Could not fetch file from Slack',
    });
  }
  if (!upstream.ok) {
    return json(res, 502, {
      ok: false,
      error: `Slack returned ${upstream.status} for the file`,
    });
  }

  // 3. Stream back to the browser. Cache for 1h so polling doesn't
  //    re-download the same image every 30 seconds.
  res.setHeader(
    'Content-Type',
    file.mimetype || upstream.headers.get('content-type') || 'application/octet-stream',
  );
  res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
  if (file.name) {
    // Inline so browsers display images instead of forcing download.
    // Filename helps the rare manual right-click "Save image as".
    res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(file.name)}"`);
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.statusCode = 200;
  res.end(buf);
}

// RFC 5987-ish encoding — keep ASCII filenames untouched, escape the rest.
function encodeFilename(name) {
  return /^[\x20-\x7E]+$/.test(name) ? name : encodeURIComponent(name);
}
