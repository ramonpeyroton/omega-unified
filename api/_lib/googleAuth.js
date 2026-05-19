// Google OAuth2 token manager.
// Handles token exchange, refresh, and storage (Supabase gmail_tokens).
//
// Used by api/email/[action].js for Gmail API access.

import { supabase } from './supabase.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Exchange an auth code for access + refresh tokens. */
export async function exchangeCode(code, redirectUri) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error_description || data.error || 'Token exchange failed');
  return data; // { access_token, refresh_token, expires_in, token_type }
}

/** Persist tokens to gmail_tokens table (upsert by email). */
export async function storeTokens(email, tokens) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  const row = {
    email,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token || undefined, // may be absent on refresh
    expires_at:    expiresAt,
    updated_at:    new Date().toISOString(),
  };
  // Only overwrite refresh_token when we actually got a new one.
  if (!tokens.refresh_token) delete row.refresh_token;

  const { error } = await supabase
    .from('gmail_tokens')
    .upsert(row, { onConflict: 'email' });
  if (error) throw new Error(`storeTokens: ${error.message}`);
}

/** Update Gmail watch metadata after calling gmail.users.watch(). */
export async function storeWatchInfo(email, historyId, expiration) {
  const { error } = await supabase
    .from('gmail_tokens')
    .update({
      watch_history_id: String(historyId),
      watch_expiration: new Date(Number(expiration)).toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .eq('email', email);
  if (error) throw new Error(`storeWatchInfo: ${error.message}`);
}

/** Update just the lastHistoryId after processing a batch of messages. */
export async function updateHistoryId(email, historyId) {
  await supabase
    .from('gmail_tokens')
    .update({ watch_history_id: String(historyId), updated_at: new Date().toISOString() })
    .eq('email', email);
}

/** Load the stored connection row (or null if not connected). */
export async function getConnection(email) {
  if (!email) {
    // No email specified — return the first/only connected account.
    const { data } = await supabase
      .from('gmail_tokens')
      .select('*')
      .limit(1)
      .maybeSingle();
    return data || null;
  }
  const { data } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  return data || null;
}

/**
 * Get a valid access token for the given email, refreshing if needed.
 * Returns the access token string.
 */
export async function getValidToken(email) {
  const conn = await getConnection(email);
  if (!conn) throw new Error(`No Gmail connection found for ${email || 'any account'}`);

  // Still valid with >5 min buffer — return as-is.
  const expiresAt = new Date(conn.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) return conn.access_token;

  // Refresh.
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID     || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: conn.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);

  await storeTokens(conn.email, data);
  return data.access_token;
}

/** Delete all tokens for an email (disconnect). */
export async function deleteConnection(email) {
  await supabase.from('gmail_tokens').delete().eq('email', email);
}
