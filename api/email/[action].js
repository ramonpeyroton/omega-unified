// Vercel Function: Gmail integration — OAuth + manual inbox check.
//
// Routes (req.query.action):
//   GET  connect    → redirect to Google OAuth consent screen
//   GET  callback   → receive auth code, store tokens (public — Google redirect)
//   GET  status     → return connection info (email, last checked)
//   POST disconnect → revoke + delete tokens
//   POST check      → poll Gmail for new invoice emails (called by UI + cron)
//
// All routes except "callback" require the shared secret (x-omega-secret).
//
// Required env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   ANTHROPIC_KEY         — for Claude matching
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   PUBLIC_APP_URL        — e.g. https://omega-unified.vercel.app

import { json } from '../_lib/http.js';
import { requireSecret } from '../_lib/requireSecret.js';
import {
  exchangeCode, storeTokens,
  getConnection, getValidToken, deleteConnection,
} from '../_lib/googleAuth.js';
import { pollGmailInvoices } from '../_lib/gmailPoller.js';

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = req.query.action;

  // Public — called by Google after OAuth consent (not by the browser app).
  if (action === 'callback') return handleCallback(req, res);

  // All other routes require the shared secret.
  if (!requireSecret(req, res)) return;

  if (action === 'connect')    return handleConnect(req, res);
  if (action === 'status')     return handleStatus(req, res);
  if (action === 'disconnect') return handleDisconnect(req, res);
  if (action === 'check')      return handleCheck(req, res);

  return json(res, 404, { ok: false, error: `Unknown email action: ${action}` });
}

// ─── GET /api/email/connect ───────────────────────────────────────────────────

function handleConnect(req, res) {
  const clientId    = process.env.GOOGLE_CLIENT_ID || '';
  const appUrl      = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/email/callback`;

  if (!clientId) return json(res, 500, { ok: false, error: 'GOOGLE_CLIENT_ID not configured' });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent', // force refresh_token on every connect
    state:         'gmail-connect',
  });

  res.statusCode = 302;
  res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.end();
}

// ─── GET /api/email/callback ──────────────────────────────────────────────────

async function handleCallback(req, res) {
  const appUrl      = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/email/callback`;

  const url      = new URL(req.url, `http://${req.headers.host}`);
  const code     = url.searchParams.get('code');
  const errParam = url.searchParams.get('error');

  if (errParam) {
    return redirect(res, `${appUrl}?gmail=error&reason=${encodeURIComponent(errParam)}`);
  }
  if (!code) {
    return redirect(res, `${appUrl}?gmail=error&reason=no_code`);
  }

  try {
    // Exchange auth code for tokens.
    const tokens = await exchangeCode(code, redirectUri);

    // Get the Gmail address.
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const email   = profile.emailAddress;
    if (!email) throw new Error('Could not read Gmail email address');

    // Store tokens.
    await storeTokens(email, tokens);

    return redirect(res, `${appUrl}?gmail=connected&account=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error('[email/callback]', err);
    return redirect(res, `${appUrl}?gmail=error&reason=${encodeURIComponent(err.message || 'setup_failed')}`);
  }
}

// ─── GET /api/email/status ────────────────────────────────────────────────────

async function handleStatus(req, res) {
  const conn = await getConnection(null);
  if (!conn) return json(res, 200, { ok: true, connected: false });
  return json(res, 200, {
    ok:          true,
    connected:   true,
    email:       conn.email,
    lastChecked: conn.last_checked_at || null,
  });
}

// ─── POST /api/email/disconnect ───────────────────────────────────────────────

async function handleDisconnect(req, res) {
  const conn = await getConnection(null);
  if (!conn) return json(res, 200, { ok: true });

  // Revoke the access token with Google.
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${conn.access_token}`, { method: 'POST' });
  } catch { /* ignore revocation errors */ }

  await deleteConnection(conn.email);
  return json(res, 200, { ok: true });
}

// ─── POST /api/email/check ────────────────────────────────────────────────────

async function handleCheck(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });

  const result = await pollGmailInvoices();
  return json(res, result.ok ? 200 : 500, result);
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}
