// Vercel Function: unified AI proxy (Anthropic Claude + Groq).
//
// Consolidates two providers into ONE function to stay within Vercel
// Hobby's 12-function limit. The `provider` field in the body routes
// the request to the right backend.
//
// POST JSON:
//   { provider: 'claude', prompt, maxTokens?, prefill?, allowTruncation? }
//   { provider: 'groq', model, messages, tools?, tool_choice?, temperature?, max_tokens? }
//
// Required env vars (server-side — no VITE_ prefix):
//   ANTHROPIC_KEY      Claude API key  (previously VITE_ANTHROPIC_KEY)
//   GROQ_API_KEY       Groq API key    (previously VITE_GROQ_API_KEY)
//   OMEGA_API_SECRET   shared secret verified by requireSecret

import { requireSecret } from './_lib/requireSecret.js';
import { json, readJson } from './_lib/http.js';

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-haiku-4-5-20251001';
const GROQ_URL       = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS     = 90_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!requireSecret(req, res)) return;

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { provider } = body || {};

  if (provider === 'claude') return handleClaude(res, body);
  if (provider === 'groq')   return handleGroq(res, body);

  return json(res, 400, { error: 'Missing or unknown "provider". Use "claude" or "groq".' });
}

// ─── Anthropic handler ───────────────────────────────────────────
async function handleClaude(res, body) {
  const key = (process.env.ANTHROPIC_KEY || '').trim();
  if (!key) return json(res, 500, { error: 'ANTHROPIC_KEY not configured on the server.' });

  const { prompt, maxTokens = 2500, prefill, allowTruncation } = body;
  if (!prompt) return json(res, 400, { error: 'Missing "prompt"' });

  const messages = [{ role: 'user', content: prompt }];
  if (prefill) messages.push({ role: 'assistant', content: prefill });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, messages }),
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
