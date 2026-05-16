// Anthropic caller — routes through /api/ai-proxy (Vercel Function).
// The ANTHROPIC_KEY never appears in the browser bundle.
//
// The proxy accepts: { provider:'claude', prompt, maxTokens?, prefill?, allowTruncation? }
// and forwards the call to api.anthropic.com server-side.

import { apiFetch } from './apiFetch.js';

const TIMEOUT_MS = 90_000;

export async function callAnthropicShared(prompt, maxTokens = 2500, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await apiFetch('/api/ai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider:        'claude',
        prompt,
        maxTokens,
        prefill:         opts.prefill        ?? undefined,
        allowTruncation: opts.allowTruncation ?? undefined,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || `Claude API ${res.status}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Truncation guard — surface as a specific error so callers can retry
    // with a larger budget instead of silently getting half an answer.
    if (data.stop_reason === 'max_tokens' && !opts.allowTruncation) {
      const err = new Error('AI response was truncated (hit max_tokens). Increase maxTokens and retry.');
      err.code = 'MAX_TOKENS';
      err.partialText = text;
      throw err;
    }

    // If a prefill was used, glue it back on — the API only returns the
    // text Claude generated AFTER the prefill string.
    return opts.prefill ? opts.prefill + text : text;
  } catch (err) {
    clearTimeout(t);
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  }
}
