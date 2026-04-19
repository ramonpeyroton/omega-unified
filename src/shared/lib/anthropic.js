// Minimal Anthropic caller for shared components. Uses the same env var
// (VITE_ANTHROPIC_KEY) as the Sales app so there's a single key to manage.
// The API key is exposed to the browser; this is a trade-off for v1. When
// the product scales the call should move to a Vercel Function proxy.

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 90000;

export async function callAnthropicShared(prompt, maxTokens = 2500) {
  if (!ANTHROPIC_KEY) throw new Error('Missing VITE_ANTHROPIC_KEY');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic API ${res.status}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || '';
  } catch (err) {
    clearTimeout(t);
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  }
}
