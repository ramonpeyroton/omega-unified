// Client-side helpers for sending SMS / WhatsApp via Twilio and for
// building the default message templates used by Manager/Owner (sub
// confirmation) and Operations (client outreach).
//
// Real sends go through /api/twilio-send — the server holds the Twilio
// credentials. If the server isn't configured (local dev, no env vars),
// the caller can fall back to the platform deep links `sms:` and `wa.me`.

// ─── Phone helpers ─────────────────────────────────────────────────

/** Return a clean E.164-ish phone, or null if nothing usable. */
export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** `sms:` URI that opens the native messaging app. */
export function smsDeepLink(phone, body) {
  const p = normalizePhone(phone);
  if (!p) return null;
  // iOS uses `&`, Android accepts both. `?body=` is widely compatible.
  return `sms:${p}?body=${encodeURIComponent(body || '')}`;
}

/** wa.me link that opens WhatsApp directly (no Twilio required). */
export function waDeepLink(phone, body) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return `https://wa.me/${p.replace(/^\+/, '')}?text=${encodeURIComponent(body || '')}`;
}

// ─── Server send ───────────────────────────────────────────────────

import { apiFetch } from './apiFetch.js';

/**
 * Send via the Twilio-backed serverless endpoint.
 * @param {object} opts
 *   to, body, channel = 'sms' | 'whatsapp',
 *   meta? = { jobId, phaseId, subId, kind },
 *   user? = { name, role }
 * @returns {Promise<{ok: boolean, sid?: string, error?: string}>}
 */
export async function sendMessage({ to, body, channel = 'sms', meta, user } = {}) {
  if (!to || !body) return { ok: false, error: 'Missing "to" or "body"' };
  try {
    const r = await apiFetch('/api/twilio-send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Informational only; the server does NOT use these for auth.
        'x-omega-role': user?.role || '',
        'x-omega-user': user?.name || '',
      },
      body: JSON.stringify({ to, body, channel, meta }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok) {
      return { ok: false, error: data?.error || `HTTP ${r.status}` };
    }
    return { ok: true, sid: data.sid };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ─── Message templates ─────────────────────────────────────────────

// The "please confirm" message to a sub lives in subMessages.js now, in the
// sub's primary language. Re-exported so existing imports keep working.
export { subConfirmTemplate } from './subMessages';

/**
 * Build a generic client-update message (Operations / Brenda reaching
 * out). Empty `custom` keeps the default prompt — callers are expected
 * to edit before sending.
 */
export function clientMessageTemplate({ job, custom } = {}) {
  if (custom && custom.trim()) return custom;
  const lines = [];
  lines.push(`Hi ${job?.client_name || 'there'}, this is Omega Development.`);
  if (job?.service) lines.push(`Regarding your ${job.service} project${job?.address ? ` at ${job.address}` : ''}:`);
  lines.push('');
  lines.push('[Write your update here.]');
  lines.push('');
  lines.push('— Omega Development');
  return lines.join('\n');
}
