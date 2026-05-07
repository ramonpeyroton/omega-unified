// DocuSign JWT Grant authentication helper.
//
// Uses Node's built-in crypto to sign the JWT — no external package needed.
// Caches the access token per warm Lambda instance to avoid a round-trip on
// every request (token is valid for 1 h; we expire the cache 5 min early).

import crypto from 'node:crypto';

let _cachedToken = null;
let _tokenExpiry  = 0;

export async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 300_000) return _cachedToken;

  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY || '';
  const userId         = process.env.DOCUSIGN_USER_ID         || '';
  const oauthBase      = (process.env.DOCUSIGN_OAUTH_BASE || 'https://account-d.docusign.com').replace(/\/$/, '');
  const rawKey         = process.env.DOCUSIGN_PRIVATE_KEY     || '';

  // Vercel stores multi-line secrets with literal \n — normalize to real newlines.
  const privateKey = rawKey.replace(/\\n/g, '\n');

  if (!integrationKey || !userId || !privateKey) {
    throw new Error('Missing DocuSign env vars (DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_USER_ID / DOCUSIGN_PRIVATE_KEY)');
  }

  const now = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   integrationKey,
    sub:   userId,
    aud:   oauthBase.replace(/^https?:\/\//, ''),
    iat:   now,
    exp:   now + 3600,
    scope: 'signature impersonation',
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const signer       = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(privateKey, 'base64url');

  const jwt = `${signingInput}.${sig}`;

  const tokenUrl = `${oauthBase}/oauth/token`;
  console.log('[docusignAuth] fetching token from:', tokenUrl, '| integrationKey set:', !!integrationKey, '| userId set:', !!userId, '| privateKey length:', privateKey.length);

  let res;
  try {
    res = await fetch(tokenUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  jwt,
      }),
    });
  } catch (fetchErr) {
    throw new Error(`DocuSign OAuth fetch failed — URL: ${tokenUrl} — cause: ${fetchErr?.cause?.code || fetchErr?.cause?.message || fetchErr?.message}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DocuSign auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}
