// Vercel Function: transcribe a short audio blob using OpenAI Whisper.
// Accepts multipart/form-data with an `audio` file field, returns
// `{ ok, text }`. Frontend picks this over Web Speech because results
// are consistent across browsers and handle Portuguese well.
//
// Required env vars:
//   OPENAI_API_KEY   sk-...
//
// Cost (April 2026 pricing): $0.006 per minute of audio. A 30s field
// note costs $0.003 — essentially free at Omega's volume.

import { requireSecret } from './_lib/requireSecret.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Tiny multipart parser — handles ONE file field called "audio" plus
// optional string fields. Avoids pulling a full multipart lib into the
// serverless bundle.
function parseSingleFileMultipart(rawBuf, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;
  while (true) {
    const idx = rawBuf.indexOf(boundaryBuf, start);
    if (idx < 0) break;
    if (start < idx) parts.push(rawBuf.slice(start, idx));
    start = idx + boundaryBuf.length;
  }

  const file = { name: null, mime: null, data: null, fieldname: null };
  const fields = {};

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf8');
    // Strip leading and trailing CRLFs from the body
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);

    const nameMatch = /name="([^"]+)"/.exec(headerStr);
    const filenameMatch = /filename="([^"]+)"/.exec(headerStr);
    const mimeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);

    if (!nameMatch) continue;
    const fieldname = nameMatch[1];
    if (filenameMatch) {
      file.name = filenameMatch[1];
      file.mime = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';
      file.data = body;
      file.fieldname = fieldname;
    } else {
      fields[fieldname] = body.toString('utf8');
    }
  }
  return { file, fields };
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireSecret(req, res)) return;
  if (!OPENAI_API_KEY)       return json(res, 500, { ok: false, error: 'OPENAI_API_KEY missing' });

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
  if (!boundaryMatch) return json(res, 400, { ok: false, error: 'Missing multipart boundary' });
  const boundary = boundaryMatch[1].trim();

  let raw;
  try { raw = await readRawBody(req); }
  catch (e) { return json(res, 400, { ok: false, error: 'Failed to read body' }); }

  const { file, fields } = parseSingleFileMultipart(raw, boundary);
  if (!file?.data) return json(res, 400, { ok: false, error: 'No audio file found' });

  // Forward to OpenAI Whisper. We use `multipart/form-data` by hand —
  // same format as the incoming request, but we get to set proper
  // filename + mime so Whisper accepts it.
  const openAiBoundary = `----omega${Date.now()}`;
  const payloadParts = [];

  function appendField(name, value) {
    payloadParts.push(Buffer.from(`--${openAiBoundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  function appendFile(name, filename, mime, buffer) {
    payloadParts.push(Buffer.from(`--${openAiBoundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
    payloadParts.push(buffer);
    payloadParts.push(Buffer.from('\r\n'));
  }

  appendFile('file', file.name || 'audio.webm', file.mime || 'audio/webm', file.data);
  appendField('model', 'whisper-1');
  if (fields.language) appendField('language', fields.language);
  // Leave `response_format` as default (json). We just want the text.
  payloadParts.push(Buffer.from(`--${openAiBoundary}--\r\n`));
  const payload = Buffer.concat(payloadParts);

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${openAiBoundary}`,
        'Content-Length': String(payload.length),
      },
      body: payload,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(res, r.status, { ok: false, error: data?.error?.message || `OpenAI HTTP ${r.status}` });
    return json(res, 200, { ok: true, text: data?.text || '' });
  } catch (err) {
    return json(res, 500, { ok: false, error: err?.message || 'Transcription failed' });
  }
}
