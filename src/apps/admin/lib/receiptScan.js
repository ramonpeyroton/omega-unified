// receiptScan — read the grand total off a single receipt image with
// Claude (Sonnet). Returns the final amount charged plus a best-effort
// store name to prefill the description. The human reviewer always sees
// and can edit the value before anything is saved, so this only needs
// to be a good first guess — not perfect.

import { apiFetch } from '../../../shared/lib/apiFetch.js';

const PROMPT = `You are reading a single store receipt or supplier invoice (often a faded thermal print).

Return ONLY a JSON object — no markdown, no explanation — with these exact fields:
- total: the FINAL grand total actually charged, AFTER tax (a number, no currency symbol, no commas). If you truly cannot read it, use null.
- store: the store / vendor name if visible (e.g. "Home Depot", "West End Lumber"), otherwise "".
- confidence: "high" if the total is clearly legible, "medium" if partly faded, "low" if you are guessing.

Rules:
- Pick the TOTAL line, not the subtotal and not the tax line.
- If several totals appear, choose the largest final/charged amount.
- Numbers only for total: 132.07 not "$132.07".

Example: {"total":132.07,"store":"Home Depot","confidence":"high"}`;

/**
 * @param {string} base64Data   raw base64 (no data: prefix)
 * @param {string} [mimeType]
 * @param {(attempt:number)=>void} [onRetry]
 * @returns {Promise<{ total: number|null, store: string, confidence: 'high'|'medium'|'low' }>}
 */
export async function extractReceiptTotal(base64Data, mimeType = 'image/jpeg', onRetry) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      response = await apiFetch('/api/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'claude',
          model: 'claude-sonnet-4-20250514',
          maxTokens: 300,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
              { type: 'text', text: PROMPT },
            ],
          }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') { lastErr = new Error('Timed out'); continue; }
      throw err;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 429 && attempt < 3) {
        onRetry?.(attempt + 1);
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      throw new Error(err?.error?.message || err?.error || `API error ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) { lastErr = new Error('Could not parse total'); continue; }

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch { lastErr = new Error('Bad JSON from AI'); continue; }

    const rawTotal = parsed.total;
    const total = (rawTotal === null || rawTotal === undefined || rawTotal === '')
      ? null
      : Number(String(rawTotal).replace(/[^0-9.]/g, ''));

    return {
      total: Number.isFinite(total) ? total : null,
      store: typeof parsed.store === 'string' ? parsed.store.trim() : '',
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    };
  }
  throw lastErr || new Error('Failed to read receipt');
}
