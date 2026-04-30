// /api/quickbooks/:action  (Vercel dynamic route)
//
// Single Function that fans out to all QB sub-handlers, so the whole
// integration counts as ONE serverless function instead of five —
// Vercel Hobby plan caps at 12 total. Sub-handlers map 1:1 with what
// used to be separate files; logic is identical.
//
// Routes:
//   GET  /api/quickbooks/auth        → start OAuth, 302 to Intuit
//   GET  /api/quickbooks/callback    → finish OAuth, persist tokens
//   GET  /api/quickbooks/status      → JSON connection state
//   POST /api/quickbooks/disconnect  → revoke + delete row
//   GET  /api/quickbooks/balances    → JSON list of bank/cc balances

import crypto from 'node:crypto';
import {
  envConfig, exchangeCodeForTokens, saveTokens,
  loadActiveTokens, deleteTokens, revokeAtIntuit, qbFetch,
} from '../_lib/quickbooks.js';
import { json } from '../_lib/http.js';

const AUTHORIZE_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPE = 'com.intuit.quickbooks.accounting';

const QUERY_ACCOUNTS =
  "select Id, Name, AccountType, AccountSubType, CurrentBalance, CurrencyRef, MetaData " +
  "from Account where AccountType in ('Bank','Credit Card') and Active = true";

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export default async function handler(req, res) {
  const action = req.query?.action || '';
  switch (action) {
    case 'auth':       return handleAuth(req, res);
    case 'callback':   return handleCallback(req, res);
    case 'status':     return handleStatus(req, res);
    case 'disconnect': return handleDisconnect(req, res);
    case 'balances':   return handleBalances(req, res);
    default:           return json(res, 404, { error: 'Unknown action', action });
  }
}

// ─── auth ────────────────────────────────────────────────────────
function handleAuth(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const cfg = envConfig();
  if (!cfg.ready) {
    return json(res, 500, {
      error: 'QuickBooks env vars not configured',
      hint: 'Set QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET and QUICKBOOKS_REDIRECT_URI on Vercel.',
    });
  }
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    scope: SCOPE,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    state,
  });
  res.setHeader('Set-Cookie', [
    `qb_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`,
  ]);
  res.statusCode = 302;
  res.setHeader('Location', `${AUTHORIZE_BASE}?${params.toString()}`);
  res.end();
}

// ─── callback ────────────────────────────────────────────────────
async function handleCallback(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const cfg = envConfig();
  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const state = url.searchParams.get('state');
  const intuitError = url.searchParams.get('error');

  const appBase = `https://${req.headers.host}`;
  const back = (qs) => {
    res.statusCode = 302;
    res.setHeader('Set-Cookie', [
      'qb_oauth_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    ]);
    res.setHeader('Location', `${appBase}/?${qs}`);
    res.end();
  };

  if (intuitError) return back(`qb=error&reason=${encodeURIComponent(intuitError)}`);
  if (!code || !realmId) return back('qb=error&reason=missing_params');

  const savedState = readCookie(req, 'qb_oauth_state');
  if (!savedState || savedState !== state) return back('qb=error&reason=state_mismatch');

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveTokens({
      realmId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSec: tokens.expires_in,
      refreshExpiresInSec: tokens.x_refresh_token_expires_in,
      environment: cfg.environment || 'sandbox',
    });
    return back('qb=connected');
  } catch (err) {
    console.error('[quickbooks-callback]', err?.message || err);
    return back(`qb=error&reason=${encodeURIComponent(err?.message || 'exchange_failed')}`);
  }
}

// ─── status ──────────────────────────────────────────────────────
async function handleStatus(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const row = await loadActiveTokens();
    if (!row) return json(res, 200, { connected: false });
    return json(res, 200, {
      connected: true,
      realmId: row.realm_id,
      environment: row.environment,
      connectedAt: row.connected_at,
      lastRefreshedAt: row.last_refreshed_at,
    });
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Status check failed' });
  }
}

// ─── disconnect ──────────────────────────────────────────────────
async function handleDisconnect(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  try {
    const row = await loadActiveTokens();
    if (!row) return json(res, 200, { ok: true, alreadyDisconnected: true });
    try { await revokeAtIntuit(row.refresh_token); } catch { /* logged inside */ }
    await deleteTokens(row.realm_id);
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Disconnect failed' });
  }
}

// ─── balances ────────────────────────────────────────────────────
async function handleBalances(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const row = await loadActiveTokens();
    if (!row) return json(res, 200, { connected: false, accounts: [] });
    const path = `/v3/company/{realmId}/query?query=${encodeURIComponent(QUERY_ACCOUNTS)}`;
    const data = await qbFetch(path);
    const raw = data?.QueryResponse?.Account || [];
    const accounts = raw.map((a) => ({
      id: a.Id,
      name: a.Name,
      type: a.AccountType,
      subType: a.AccountSubType,
      currentBalance: Number(a.CurrentBalance) || 0,
      currency: a.CurrencyRef?.value || 'USD',
      lastUpdated: a.MetaData?.LastUpdatedTime || null,
    }));
    return json(res, 200, {
      connected: true,
      realmId: row.realm_id,
      environment: row.environment,
      accounts,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json(res, 500, { error: err?.message || 'Failed to fetch balances' });
  }
}
