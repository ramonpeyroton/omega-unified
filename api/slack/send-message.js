// Vercel Function: post a new message — and optionally an image —
// into the Slack channel linked to a job. Used by the message
// composer in the Daily Logs tab inside JobFullView.
//
// Two request shapes accepted:
//
//   1. JSON (text only) — Sprint 4 mini-passo 1
//      Content-Type: application/json
//      Body:    { jobId: string, text: string }
//
//   2. multipart/form-data (text + 1 image) — Sprint 4 mini-passo 2
//      Content-Type: multipart/form-data
//      Fields:  jobId (string), text (string, optional when file present)
//      Files:   file (1 image, max 4 MB after compression — see UI)
//      Allowed mimetypes: image/jpeg, image/png, image/webp, image/heic
//
// The bot identity stays the same (Omega Bot). Author attribution
// happens via a single-line prefix "Ramon Peyroton: <text>" so reading
// the channel inside Slack still tells you who said what.
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   SLACK_BOT_TOKEN

import { readFile } from 'node:fs/promises';
import formidable from 'formidable';

import { supabase, requireSupabase } from '../_lib/supabase.js';
import { slack, requireSlack } from '../_lib/slack.js';
import { json, readJson } from '../_lib/http.js';
import { requireSecret } from '../_lib/requireSecret.js';

const MAX_TEXT  = 4000;                  // Slack hard cap
const MAX_BYTES = 4 * 1024 * 1024;       // 4 MB — leaves headroom under the
                                         // ~4.5 MB Vercel body cap.
const ACCEPTED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);

// Vercel needs to know NOT to auto-parse the body — formidable will
// stream the raw multipart payload itself.
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }
  if (!requireSecret(req, res)) return;

  const sb = requireSupabase();
  if (!sb.ok) return json(res, 500, sb);
  const sl = requireSlack();
  if (!sl.ok) return json(res, 500, sl);

  // Author attribution — same headers the rest of api/* uses.
  const userName = (req.headers['x-omega-user'] || '').toString().trim();

  // Branch on Content-Type. Multipart only when a file is being sent.
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  const isMultipart = contentType.includes('multipart/form-data');

  let payload;
  if (isMultipart) {
    try { payload = await parseMultipart(req); }
    catch (err) {
      return json(res, 400, {
        ok: false,
        error: err?.message || 'Could not parse multipart body',
      });
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

  // Either text or file (or both). Empty + empty is rejected.
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

  // Resolve channel from job.
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, slack_channel_id')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) return json(res, 500, { ok: false, error: jobErr.message });
  if (!job)   return json(res, 404, { ok: false, error: 'Job not found' });
  if (!job.slack_channel_id) {
    return json(res, 400, {
      ok: false,
      error: 'This job is not connected to a Slack channel yet.',
    });
  }

  // Build the human-readable prefix once. Consumed by both branches.
  const credit = userName ? `${userName}: ` : '';
  const finalText = `${credit}${text}`;

  try {
    // ─── Branch A: image upload (text becomes initial_comment) ────
    if (file) {
      const fileBuffer = await readFile(file.tempPath);
      const r = await slack.files.uploadV2({
        channel_id: job.slack_channel_id,
        file: fileBuffer,
        filename: file.filename || 'upload',
        // initial_comment is what shows above the file preview in
        // Slack — we put the credit + text here so the post reads
        // "Ramon Peyroton: take a look" with the photo attached.
        initial_comment: finalText || credit || undefined,
      });

      if (!r.ok) {
        return json(res, 502, {
          ok: false,
          error: `Slack returned: ${r.error || 'unknown'}`,
        });
      }
      return json(res, 200, {
        ok: true,
        channelId: job.slack_channel_id,
        // files.uploadV2 returns { files: [...] } not a top-level ts.
        // The polling fetch will pick the new entry up on next tick.
        file_id: r.files?.[0]?.id || null,
      });
    }

    // ─── Branch B: text-only message ──────────────────────────────
    const r = await slack.chat.postMessage({
      channel: job.slack_channel_id,
      text: finalText,
      mrkdwn: true,
    });

    if (!r.ok) {
      return json(res, 502, {
        ok: false,
        error: `Slack returned: ${r.error || 'unknown'}`,
      });
    }

    return json(res, 200, {
      ok: true,
      ts: r.ts,
      channelId: job.slack_channel_id,
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.data?.error || err?.message || 'Slack request failed',
    });
  }
}

// Parse multipart/form-data with formidable. Normalizes the result
// into a flat { jobId, text, file } shape so the handler doesn't
// have to deal with formidable's field/file nesting.
async function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_BYTES,
    keepExtensions: true,
  });
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

// formidable v3 returns arrays even for single fields/files. Take [0].
function pickFirst(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}
