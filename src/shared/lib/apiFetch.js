/**
 * apiFetch — fetch wrapper for internal /api/* calls.
 *
 * Automatically attaches the x-omega-secret header so every
 * request to our Vercel Functions proves it came from the app
 * rather than an external caller.
 *
 * The secret value comes from VITE_OMEGA_API_SECRET (client-side env var).
 * The server checks it against OMEGA_API_SECRET (same value, no VITE_ prefix).
 *
 * Usage: drop-in replacement for fetch() for any /api/* URL.
 *
 *   import { apiFetch } from '../lib/apiFetch';
 *
 *   // JSON body
 *   const r = await apiFetch('/api/twilio-send', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ ... }),
 *   });
 *
 *   // FormData (multipart) — do NOT set Content-Type; browser adds boundary
 *   const r = await apiFetch('/api/twilio-send', {
 *     method: 'POST',
 *     body: formData,
 *   });
 */

const API_SECRET = (import.meta.env.VITE_OMEGA_API_SECRET || '').trim();

/**
 * Thin fetch wrapper that injects x-omega-secret on every call.
 * All other options are forwarded verbatim — method, headers, body, signal, etc.
 */
export function apiFetch(url, options = {}) {
  const extraHeaders = API_SECRET ? { 'x-omega-secret': API_SECRET } : {};
  return fetch(url, {
    ...options,
    headers: {
      ...extraHeaders,
      ...(options.headers || {}),
    },
  });
}
