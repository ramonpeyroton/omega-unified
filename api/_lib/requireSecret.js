/**
 * requireSecret — lightweight shared-secret guard for internal Vercel Functions.
 *
 * The browser sends VITE_OMEGA_API_SECRET via the `x-omega-secret` header.
 * The server checks it against OMEGA_API_SECRET (same value, no VITE_ prefix).
 *
 * Usage (early-return pattern):
 *
 *   import { requireSecret } from './_lib/requireSecret.js';
 *   // from api/slack/* use: import { requireSecret } from '../_lib/requireSecret.js';
 *
 *   export default async function handler(req, res) {
 *     if (!requireSecret(req, res)) return;
 *     // ... your handler logic
 *   }
 *
 * Dev behaviour: if OMEGA_API_SECRET is not set the guard logs a warning
 * and allows the request through so local dev keeps working without env vars.
 * Set the secret in Vercel Production env vars to enforce the check in prod.
 *
 * DO NOT use this for public-facing endpoints (DocuSign webhook uses HMAC,
 * Vercel Cron uses its own auth, public estimate-view / sign-estimate have
 * no internal callers that can supply a secret).
 */
export function requireSecret(req, res) {
  const secret = (process.env.OMEGA_API_SECRET || '').trim();

  if (!secret) {
    // Not configured — warn loudly in Vercel function logs, allow through.
    console.warn(
      '[security] OMEGA_API_SECRET is not configured. ' +
      'Set it in Vercel → Settings → Environment Variables to restrict API access.'
    );
    return true;
  }

  const provided = (req.headers['x-omega-secret'] || '').toString().trim();
  if (provided === secret) return true;

  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
  return false;
}
