// Vercel Function: unified AI proxy (Anthropic Claude + Groq).
//
// Consolidates two providers into ONE function to stay within Vercel
// Hobby's 12-function limit. The `provider` field in the body routes
// the request to the right backend.
//
// POST JSON:
//   { provider: 'claude', prompt, maxTokens?, prefill?, allowTruncation? }
//   { provider: 'groq', model, messages, tools?, tool_choice?, temperature?, max_tokens? }
//   { provider: 'higgsfield', action: 'generate', prompt, width?, height?, model? }
//   { provider: 'higgsfield', action: 'status', id }
//
// Higgsfield image generation is folded in here (not its own function)
// to stay under Vercel Hobby's 12-function cap. It's async: 'generate'
// submits a job and returns { id }; 'status' polls until { done, url }.
//
// Required env vars (server-side — no VITE_ prefix):
//   ANTHROPIC_KEY        Claude API key  (previously VITE_ANTHROPIC_KEY)
//   GROQ_API_KEY         Groq API key    (previously VITE_GROQ_API_KEY)
//   HIGGSFIELD_API_KEY   Higgsfield Cloud API key (Bearer) — image gen
//   HIGGSFIELD_API_BASE  optional, default https://api.higgsfield.ai
//   OMEGA_API_SECRET     shared secret verified by requireSecret

import { requireSecret } from './_lib/requireSecret.js';
import { json, readJson } from './_lib/http.js';

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-haiku-4-5-20251001';
const GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';
const HF_BASE        = (process.env.HIGGSFIELD_API_BASE || 'https://api.higgsfield.ai').replace(/\/$/, '');
const HF_MODEL       = 'flux';
const TIMEOUT_MS     = 90_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!requireSecret(req, res)) return;

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { provider } = body || {};

  if (provider === 'claude')     return handleClaude(res, body);
  if (provider === 'groq')       return handleGroq(res, body);
  if (provider === 'higgsfield') return handleHiggsfield(res, body);

  return json(res, 400, { error: 'Missing or unknown "provider". Use "claude", "groq" or "higgsfield".' });
}

// ─── Higgsfield image generation ─────────────────────────────────
// Defensive against the exact Cloud API contract still being verified:
// auth is Bearer HIGGSFIELD_API_KEY (set the value to "key:secret" if
// your account issues a pair), and both the status string and the
// finished image URL are pulled from several likely response shapes.

const HF_DONE   = new Set(['completed', 'succeeded', 'success', 'done', 'finished', 'complete', 'ready']);
const HF_FAILED = new Set(['failed', 'error', 'errored', 'canceled', 'cancelled', 'rejected']);

function hfPickStatus(d) {
  return String(d?.status || d?.state || d?.job_status || d?.data?.status || '').toLowerCase();
}
function hfPickId(d) {
  return d?.id || d?.job_id || d?.jobId || d?.generation_id || d?.data?.id || d?.job?.id || null;
}
function hfPickUrl(d) {
  if (!d || typeof d !== 'object') return null;
  const cands = [
    d.url, d.image_url, d.imageUrl, d.output_url,
    d.output?.url, d.result?.url, d.data?.url,
    d.images?.[0]?.url, d.result?.images?.[0]?.url, d.output?.images?.[0]?.url, d.data?.images?.[0]?.url,
    d.assets?.[0]?.url, d.output?.[0]?.url, d.results?.[0]?.url, d.data?.[0]?.url,
    d.result?.[0]?.url, d.outputs?.[0]?.url,
  ];
  return cands.find((u) => typeof u === 'string' && /^https?:\/\//.test(u)) || null;
}

async function handleHiggsfield(res, body) {
  const key = (process.env.HIGGSFIELD_API_KEY || '').trim();
  if (!key) return json(res, 500, { error: 'HIGGSFIELD_API_KEY not configured on the server. Add it in Vercel to enable AI image generation.' });

  const { action } = body;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  try {
    if (action === 'generate') {
      const { prompt, width = 1024, height = 1024, model } = body;
      if (!prompt) return json(res, 400, { error: 'Missing "prompt"' });
      const payload = { task: 'text-to-image', model: model || HF_MODEL, prompt, width, height };
      const r = await fetch(`${HF_BASE}/v1/generations`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, r.status, { error: data?.error?.message || data?.message || `Higgsfield ${r.status}` });
      const id = hfPickId(data);
      // Some APIs return the image synchronously — pass a url back if present.
      return json(res, 200, { id, url: hfPickUrl(data), status: hfPickStatus(data) || 'queued' });
    }

    if (action === 'status') {
      const { id } = body;
      if (!id) return json(res, 400, { error: 'Missing "id"' });
      const r = await fetch(`${HF_BASE}/v1/generations/${encodeURIComponent(id)}`, { headers });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json(res, r.status, { error: data?.error?.message || data?.message || `Higgsfield ${r.status}` });
      const status = hfPickStatus(data);
      const url = hfPickUrl(data);
      const done = HF_DONE.has(status) || !!url;
      const failed = HF_FAILED.has(status);
      return json(res, 200, { status: status || (url ? 'completed' : 'processing'), done, failed, url });
    }

    return json(res, 400, { error: 'Higgsfield: unknown action. Use "generate" or "status".' });
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Higgsfield call failed' });
  }
}

// ─── Anthropic handler ───────────────────────────────────────────
async function handleClaude(res, body) {
  const key = (process.env.ANTHROPIC_KEY || '').trim();
  if (!key) return json(res, 500, { error: 'ANTHROPIC_KEY not configured on the server.' });

  const {
    prompt, maxTokens = 2500, prefill, allowTruncation,
    messages: rawMessages, model, tools, anthropicBeta,
  } = body;

  // Callers send EITHER a simple text `prompt`, OR a full `messages`
  // array (needed for image / PDF document content blocks). When both
  // are present, `messages` wins.
  let messages;
  if (Array.isArray(rawMessages) && rawMessages.length) {
    messages = rawMessages;
  } else if (prompt) {
    messages = [{ role: 'user', content: prompt }];
    if (prefill) messages.push({ role: 'assistant', content: prefill });
  } else {
    return json(res, 400, { error: 'Missing "prompt" or "messages"' });
  }

  const payload = {
    model: model || CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages,
  };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;

  const headers = {
    'x-api-key':         key,
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  };
  // Opt-in beta features (e.g. web search) passed straight through.
  if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(res, r.status, { error: data?.error?.message || `Anthropic API ${r.status}` });
    }
    return json(res, 200, data);
  } catch (err) {
    clearTimeout(t);
    if (err.name === 'AbortError') return json(res, 504, { error: 'Request timed out' });
    return json(res, 500, { error: err?.message || 'Anthropic call failed' });
  }
}

// ─── Groq handler ────────────────────────────────────────────────
async function handleGroq(res, body) {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) return json(res, 500, { error: 'GROQ_API_KEY not configured on the server.' });

  // Strip our internal `provider` field before forwarding to Groq.
  const { provider: _p, ...groqBody } = body;

  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(groqBody),
    });
    const data = await r.json().catch(() => ({}));
    return json(res, r.status, data);
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Groq call failed' });
  }
}
