// Vercel Function: Gmail integration — OAuth + inbound email processing.
//
// Routes (req.query.action):
//   GET  connect    → redirect to Google OAuth consent screen
//   GET  callback   → receive auth code, store tokens, set up Gmail watch
//   GET  status     → return connection info (email, watch expiry)
//   POST disconnect → revoke + delete tokens
//   POST inbound    → receive Pub/Sub push, process new emails
//
// The "inbound" route is called by Google Cloud Pub/Sub (not the browser),
// so it verifies via ?pubsub_token= instead of x-omega-secret.
// All other routes require the shared secret.
//
// Required env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   GOOGLE_PUBSUB_TOPIC   — e.g. projects/my-project/topics/gmail-invoices
//   GOOGLE_PUBSUB_TOKEN   — secret appended to the push subscription URL
//   ANTHROPIC_KEY         — for Claude matching
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   PUBLIC_APP_URL

import { supabase } from '../_lib/supabase.js';
import { json, readJson } from '../_lib/http.js';
import { requireSecret } from '../_lib/requireSecret.js';
import {
  exchangeCode, storeTokens, storeWatchInfo,
  getConnection, getValidToken, updateHistoryId, deleteConnection,
} from '../_lib/googleAuth.js';

const GMAIL_API   = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES      = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTO_MATCH_THRESHOLD = 0.80; // confidence ≥ this → auto-upload

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = req.query.action;

  // Public — called by Google redirect / Pub/Sub (not by app).
  if (action === 'callback') return handleCallback(req, res);
  if (action === 'inbound')  return handleInbound(req, res);

  // Internal — require shared secret.
  if (!requireSecret(req, res)) return;

  if (action === 'connect')    return handleConnect(req, res);
  if (action === 'status')     return handleStatus(req, res);
  if (action === 'disconnect') return handleDisconnect(req, res);

  return json(res, 404, { ok: false, error: `Unknown email action: ${action}` });
}

// ─── GET /api/email/connect ───────────────────────────────────────────────────

function handleConnect(req, res) {
  const clientId   = process.env.GOOGLE_CLIENT_ID || '';
  const appUrl     = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/email/callback`;

  if (!clientId) return json(res, 500, { ok: false, error: 'GOOGLE_CLIENT_ID not configured' });

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',  // force refresh_token on every connect
    state:         'gmail-connect',
  });

  res.statusCode = 302;
  res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  res.end();
}

// ─── GET /api/email/callback ──────────────────────────────────────────────────

async function handleCallback(req, res) {
  const appUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/email/callback`;

  const url    = new URL(req.url, `http://${req.headers.host}`);
  const code   = url.searchParams.get('code');
  const errParam = url.searchParams.get('error');

  if (errParam) {
    return redirect(res, `${appUrl}?gmail=error&reason=${encodeURIComponent(errParam)}`);
  }
  if (!code) {
    return redirect(res, `${appUrl}?gmail=error&reason=no_code`);
  }

  try {
    // 1. Exchange code for tokens.
    const tokens = await exchangeCode(code, redirectUri);

    // 2. Get the user's email address.
    const accessToken = tokens.access_token;
    const profileRes = await gmailGet('/profile', accessToken);
    const email = profileRes.emailAddress;
    if (!email) throw new Error('Could not read Gmail email address');

    // 3. Store tokens.
    await storeTokens(email, tokens);

    // 4. Set up Gmail push watch so Pub/Sub notifies us on new messages.
    const topic = process.env.GOOGLE_PUBSUB_TOPIC || '';
    if (topic) {
      const watchRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/watch`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topicName:           topic,
          labelIds:            ['INBOX'],
          labelFilterBehavior: 'INCLUDE',
        }),
      });
      const watchData = await watchRes.json();
      if (watchData.historyId) {
        await storeWatchInfo(email, watchData.historyId, watchData.expiration);
      }
    }

    return redirect(res, `${appUrl}?gmail=connected&account=${encodeURIComponent(email)}`);
  } catch (err) {
    console.error('[email/callback]', err);
    return redirect(res, `${appUrl}?gmail=error&reason=${encodeURIComponent(err.message || 'setup_failed')}`);
  }
}

// ─── GET /api/email/status ────────────────────────────────────────────────────

async function handleStatus(req, res) {
  const conn = await getConnection(null); // any connected account
  if (!conn) return json(res, 200, { ok: true, connected: false });
  return json(res, 200, {
    ok: true,
    connected: true,
    email:           conn.email,
    watchExpiration: conn.watch_expiration,
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

// ─── POST /api/email/inbound (Pub/Sub push) ───────────────────────────────────

async function handleInbound(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });

  // Verify this is really from our Pub/Sub subscription.
  const url     = new URL(req.url, `http://${req.headers.host}`);
  const token   = url.searchParams.get('pubsub_token');
  const expected = (process.env.GOOGLE_PUBSUB_TOKEN || '').trim();
  if (expected && token !== expected) {
    return json(res, 401, { ok: false, error: 'Invalid pubsub_token' });
  }

  // Pub/Sub must receive a 2xx quickly or it retries. Parse in background.
  res.statusCode = 200;
  res.end('ok');

  // Parse the Pub/Sub message asynchronously.
  try {
    const body = await readJson(req).catch(() => ({}));
    const messageData = body?.message?.data;
    if (!messageData) return;

    const decoded  = JSON.parse(Buffer.from(messageData, 'base64').toString('utf8'));
    const email    = decoded.emailAddress;
    const historyId = String(decoded.historyId);
    if (!email || !historyId) return;

    await processNewEmails(email, historyId);
  } catch (err) {
    console.error('[email/inbound] processing error:', err);
  }
}

// ─── Core processing ──────────────────────────────────────────────────────────

async function processNewEmails(email, newHistoryId) {
  const conn = await getConnection(email);
  if (!conn) { console.warn(`[gmail] no connection for ${email}`); return; }

  const accessToken = await getValidToken(email);
  const lastHistoryId = conn.watch_history_id;

  // Get history since last processed ID.
  const historyUrl = new URL(`${GMAIL_API}/history`);
  historyUrl.searchParams.set('startHistoryId', lastHistoryId || newHistoryId);
  historyUrl.searchParams.set('historyTypes', 'messageAdded');

  const historyRes = await gmailGet(historyUrl.pathname + historyUrl.search, accessToken);
  const messages = [];
  for (const h of historyRes.history || []) {
    for (const m of h.messagesAdded || []) {
      if (m.message?.id) messages.push(m.message.id);
    }
  }

  // Update stored historyId so next push starts from here.
  await updateHistoryId(email, newHistoryId);

  // Load active jobs for matching (id, client_name, address, service).
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, client_name, address, service')
    .not('status', 'in', '("lost","closed","declined")');

  // Load known subs for matching.
  const { data: subs } = await supabase
    .from('subcontractors')
    .select('id, name, contact_name');

  for (const msgId of messages) {
    // Avoid double-processing.
    const { data: existing } = await supabase
      .from('email_processing_log')
      .select('id')
      .eq('gmail_message_id', msgId)
      .maybeSingle();
    if (existing) continue;

    await processMessage(msgId, accessToken, jobs || [], subs || []);
  }
}

async function processMessage(msgId, accessToken, jobs, subs) {
  try {
    // Fetch full message.
    const msg = await gmailGet(`/messages/${msgId}?format=full`, accessToken);
    const headers = msg.payload?.headers || [];
    const from    = getHeader(headers, 'From') || '';
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const snippet = msg.snippet || '';

    // Find PDF or image parts.
    const attachments = collectAttachments(msg.payload);
    if (attachments.length === 0) return; // no attachments → skip

    // Only process first attachment (most invoices have one PDF).
    const att = attachments[0];
    let attData = att.data; // inline base64
    if (!attData && att.attachmentId) {
      // Fetch the attachment separately.
      const attRes = await gmailGet(
        `/messages/${msgId}/attachments/${att.attachmentId}`,
        accessToken,
      );
      attData = attRes.data;
    }
    if (!attData) return;

    // Normalize base64 (Gmail uses URL-safe base64).
    const base64 = attData.replace(/-/g, '+').replace(/_/g, '/');

    // Upload to Supabase Storage immediately (so we never lose the file).
    const timestamp = Date.now();
    const storagePath = `inbox/${timestamp}-${att.filename || 'attachment.pdf'}`;
    const fileBuffer  = Buffer.from(base64, 'base64');

    const { error: uploadErr } = await supabase.storage
      .from('job-documents')
      .upload(storagePath, fileBuffer, {
        contentType: att.mimeType || 'application/pdf',
        upsert: false,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // Ask Claude to match the invoice to a job.
    const { jobId, confidence, invoiceInfo, reason } = await matchInvoice({
      from, subject, snippet, base64, mimeType: att.mimeType,
      jobs, subs,
    });

    const status = jobId && confidence >= AUTO_MATCH_THRESHOLD
      ? 'matched'
      : jobId
        ? 'pending_review'
        : 'unmatched';

    // If auto-matched: move file to the job folder and create a doc row.
    let docId = null;
    let finalStoragePath = storagePath;

    if (status === 'matched') {
      const jobPath = `${jobId}/invoices/${timestamp}-${att.filename || 'invoice.pdf'}`;
      await supabase.storage.from('job-documents').copy(storagePath, jobPath);
      await supabase.storage.from('job-documents').remove([storagePath]);
      finalStoragePath = jobPath;

      const { data: publicData } = supabase.storage
        .from('job-documents')
        .getPublicUrl(jobPath);

      const { data: doc, error: docErr } = await supabase
        .from('job_documents')
        .insert([{
          job_id:      jobId,
          folder:      'invoices',
          title:       invoiceInfo?.invoice_number
            ? `Invoice ${invoiceInfo.invoice_number} — ${invoiceInfo.sub_company || from}`
            : `Invoice from ${invoiceInfo?.sub_company || from} — ${new Date().toLocaleDateString('en-US')}`,
          photo_url:   publicData?.publicUrl || '',
          uploaded_by: 'Gmail AI',
        }])
        .select('id')
        .maybeSingle();

      if (!docErr && doc) docId = doc.id;

      // In-app notification for Brenda.
      await supabase.from('notifications').insert([{
        recipient_role: 'operations',
        title:          'Invoice auto-filed',
        message:        `${invoiceInfo?.sub_company || from}: ${invoiceInfo?.invoice_number || 'invoice'} filed under ${jobs.find(j => j.id === jobId)?.client_name || 'job'} (${Math.round(confidence * 100)}% match)`,
        type:           'invoice',
        job_id:         jobId,
      }]).catch(() => {});
    }

    // Log the processed email.
    await supabase.from('email_processing_log').insert([{
      gmail_message_id: msgId,
      from_address:     from,
      subject,
      job_id:           jobId || null,
      confidence:       confidence || null,
      status,
      doc_id:           docId,
      invoice_info:     invoiceInfo || null,
      raw_snippet:      snippet.slice(0, 300),
      attachment_name:  att.filename || null,
      storage_path:     finalStoragePath,
    }]);

  } catch (err) {
    console.error(`[gmail] processMessage ${msgId}:`, err);
    await supabase.from('email_processing_log').insert([{
      gmail_message_id: msgId,
      status:           'error',
      error_message:    err?.message || String(err),
    }]).catch(() => {});
  }
}

// ─── Claude matching ──────────────────────────────────────────────────────────

async function matchInvoice({ from, subject, snippet, base64, mimeType, jobs, subs }) {
  const anthropicKey = process.env.ANTHROPIC_KEY || '';
  if (!anthropicKey) return { jobId: null, confidence: 0, invoiceInfo: null, reason: 'ANTHROPIC_KEY missing' };

  const jobsList = jobs.map(j =>
    `• id:${j.id} | client:"${j.client_name || ''}" | address:"${j.address || ''}" | service:"${j.service || ''}"`
  ).join('\n');

  const subsList = subs.map(s =>
    `• "${s.name || ''}" (contact: "${s.contact_name || ''}")`
  ).join('\n');

  const isImage = (mimeType || '').startsWith('image/');
  const contentType = isImage ? 'image' : 'document';
  const mediaMime   = isImage ? (mimeType || 'image/jpeg') : 'application/pdf';

  const prompt = `You are an assistant for Omega Development LLC, a construction company in Connecticut.

An email arrived that likely contains a subcontractor invoice. Match it to one of the active jobs below.

EMAIL:
From: ${from}
Subject: ${subject}
Preview: ${snippet}

ACTIVE JOBS:
${jobsList || '(no active jobs)'}

KNOWN SUBCONTRACTORS:
${subsList || '(none)'}

The attached document/image is the invoice. Analyze it and return ONLY valid JSON (no markdown):
{
  "job_id": "the matching job uuid, or null",
  "confidence": 0.95,
  "reason": "short explanation",
  "invoice_info": {
    "sub_company": "company name",
    "sub_contact": "contact person",
    "amount": 2500.00,
    "invoice_date": "2026-05-16",
    "invoice_number": "INV-001",
    "description": "brief work description"
  }
}

Confidence guide: 0.9+ = address+sub exact match | 0.7–0.9 = sub matches, address partial | 0.5–0.7 = sub name only | <0.5 = cannot determine`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-opus-4-5',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            {
              type:   contentType,
              source: { type: 'base64', media_type: mediaMime, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await r.json();
    const text = data?.content?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()); }

    return {
      jobId:       parsed.job_id   || null,
      confidence:  parsed.confidence ?? 0,
      invoiceInfo: parsed.invoice_info || null,
      reason:      parsed.reason   || '',
    };
  } catch (err) {
    console.error('[gmail] Claude matching failed:', err);
    return { jobId: null, confidence: 0, invoiceInfo: null, reason: `Error: ${err.message}` };
  }
}

// ─── Gmail API helpers ────────────────────────────────────────────────────────

async function gmailGet(path, accessToken) {
  const base = path.startsWith('http') ? path : `${GMAIL_API}${path}`;
  const r = await fetch(base, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Gmail API ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

function getHeader(headers, name) {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

/** Recursively collect attachment parts from a Gmail message payload. */
function collectAttachments(payload) {
  if (!payload) return [];
  const parts  = payload.parts || [];
  const result = [];

  for (const part of parts) {
    // Recurse into multipart containers.
    if (part.mimeType?.startsWith('multipart/')) {
      result.push(...collectAttachments(part));
      continue;
    }
    const mime = part.mimeType || '';
    const isPdf   = mime === 'application/pdf';
    const isImage = mime.startsWith('image/');
    if (!isPdf && !isImage) continue;

    const body = part.body || {};
    result.push({
      attachmentId: body.attachmentId || null,
      data:         body.data         || null, // inline if small
      filename:     part.filename     || 'attachment',
      mimeType:     mime,
    });
  }
  return result;
}

function redirect(res, url) {
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}
