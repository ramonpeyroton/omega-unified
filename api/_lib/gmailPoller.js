// Gmail invoice poller — shared between api/email/[action].js (manual check)
// and api/daily-owner-update.js (cron).
//
// Uses Gmail messages.list with a date filter (has:attachment after:YYYY/MM/DD)
// instead of Pub/Sub push. Deduplicates via email_processing_log.gmail_message_id.

import { supabase } from './supabase.js';
import { getConnection, getValidToken, updateLastChecked } from './googleAuth.js';

const GMAIL_API           = 'https://gmail.googleapis.com/gmail/v1/users/me';
const AUTO_MATCH_THRESHOLD = 0.80;
const MAX_MESSAGES_PER_RUN = 20; // safety cap per poll

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Poll Gmail for new emails with attachments, match with Claude, file invoices.
 * Returns { ok, checked, processed, reason? }
 */
export async function pollGmailInvoices() {
  if (!supabase) return { ok: false, reason: 'supabase_not_configured', checked: 0, processed: 0 };

  const conn = await getConnection(null);
  if (!conn) return { ok: false, reason: 'not_connected', checked: 0, processed: 0 };

  let accessToken;
  try {
    accessToken = await getValidToken(conn.email);
  } catch (err) {
    return { ok: false, reason: `token_error: ${err.message}`, checked: 0, processed: 0 };
  }

  // Build Gmail search: attachments received since last check (or 30 days back).
  const since = conn.last_checked_at
    ? new Date(conn.last_checked_at)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const dateStr = [
    since.getFullYear(),
    String(since.getMonth() + 1).padStart(2, '0'),
    String(since.getDate()).padStart(2, '0'),
  ].join('/');

  // Stamp the check time NOW before we process — avoids missing messages
  // that arrive during a slow run, and prevents re-processing on next poll.
  await updateLastChecked(conn.email);

  // List messages with attachments, excluding known material suppliers
  // and internal/automated senders that are never sub invoices.
  const EXCLUDE_SENDERS = [
    'homedepot.com',
    'hd.com',
    'lowes.com',
    'grainger.com',
    'fastenal.com',
    'mailer-daemon',
    'noreply',
    'no-reply',
  ];
  const exclusions = EXCLUDE_SENDERS.map(s => `-from:${s}`).join(' ');
  const gmailQuery = `has:attachment after:${dateStr} ${exclusions}`;

  let messages = [];
  try {
    const listRes = await gmailGet(
      `/messages?q=${encodeURIComponent(gmailQuery)}&maxResults=${MAX_MESSAGES_PER_RUN}`,
      accessToken,
    );
    messages = listRes.messages || [];
  } catch (err) {
    console.error('[gmailPoller] messages.list failed:', err.message);
    return { ok: false, reason: `gmail_list_error: ${err.message}`, checked: 0, processed: 0 };
  }

  if (messages.length === 0) {
    return { ok: true, checked: 0, processed: 0 };
  }

  // Load active jobs and known subs once for the whole batch.
  const [{ data: jobs }, { data: subs }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, client_name, address, service')
      .not('status', 'in', '("lost","closed","declined")'),
    supabase
      .from('subcontractors')
      .select('id, name, contact_name'),
  ]);

  let processed = 0;
  for (const msg of messages) {
    // Skip already-processed emails (dedup).
    const { data: existing } = await supabase
      .from('email_processing_log')
      .select('id')
      .eq('gmail_message_id', msg.id)
      .maybeSingle();
    if (existing) continue;

    await processMessage(msg.id, accessToken, jobs || [], subs || []);
    processed++;
  }

  return { ok: true, checked: messages.length, processed };
}

// ─── Per-message processing ───────────────────────────────────────────────────

async function processMessage(msgId, accessToken, jobs, subs) {
  try {
    const msg     = await gmailGet(`/messages/${msgId}?format=full`, accessToken);
    const headers = msg.payload?.headers || [];
    const from    = getHeader(headers, 'From') || '';
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const snippet = msg.snippet || '';

    const allAttachments  = collectAttachments(msg.payload, false); // all types
    const goodAttachments = collectAttachments(msg.payload, true);  // PDF/image only

    // No attachments at all → skip silently.
    if (allAttachments.length === 0) return;

    // Has attachments but none are processable by Claude → log as unmatched.
    if (goodAttachments.length === 0) {
      await supabase.from('email_processing_log').insert([{
        gmail_message_id: msgId,
        from_address:     from,
        subject,
        status:           'unmatched',
        raw_snippet:      snippet.slice(0, 300),
        attachment_name:  allAttachments[0]?.filename || null,
        error_message:    `Attachment type not supported for AI matching: ${allAttachments.map(a => a.mimeType).join(', ')}`,
      }]);
      return;
    }

    // Prefer PDF over image when both are present.
    const att = goodAttachments.find(a => a.mimeType === 'application/pdf') || goodAttachments[0];
    let attData = att.data;
    if (!attData && att.attachmentId) {
      const attRes = await gmailGet(
        `/messages/${msgId}/attachments/${att.attachmentId}`,
        accessToken,
      );
      attData = attRes.data;
    }
    if (!attData) return;

    // Gmail uses URL-safe base64 — normalize for Anthropic / Buffer.
    const base64 = attData.replace(/-/g, '+').replace(/_/g, '/');

    // Upload to Supabase Storage right away so we never lose the file.
    const timestamp   = Date.now();
    // Sanitize filename — remove characters Supabase Storage rejects (~ spaces etc.)
    const safeFilename = (att.filename || 'attachment.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `inbox/${timestamp}-${safeFilename}`;
    const fileBuffer  = Buffer.from(base64, 'base64');

    const { error: uploadErr } = await supabase.storage
      .from('job-documents')
      .upload(storagePath, fileBuffer, {
        contentType: att.mimeType || 'application/pdf',
        upsert: false,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // Ask Claude to classify + match.
    const { isInvoice, jobId, confidence, invoiceInfo, reason } = await matchInvoice({
      from, subject, snippet, base64, mimeType: att.mimeType, jobs, subs,
    });

    // Claude determined this is NOT a subcontractor invoice — log as unmatched for visibility.
    if (!isInvoice) {
      await supabase.from('email_processing_log').insert([{
        gmail_message_id: msgId,
        from_address:     from,
        subject,
        status:           'unmatched',
        raw_snippet:      snippet.slice(0, 300),
        attachment_name:  att.filename || null,
        error_message:    `Not a sub invoice: ${reason}`,
      }]);
      return;
    }

    // matched       → auto-filed (high confidence)
    // pending_review → needs Brenda to confirm (low confidence OR no job found)
    // unmatched is reserved for when Brenda manually dismisses from the inbox
    const status = jobId && confidence >= AUTO_MATCH_THRESHOLD
      ? 'matched'
      : 'pending_review';

    let docId = null;
    let finalStoragePath = storagePath;

    if (status === 'matched') {
      const jobPath = `${jobId}/invoices/${timestamp}-${att.filename || 'invoice.pdf'}`;
      await supabase.storage.from('job-documents').copy(storagePath, jobPath);
      await supabase.storage.from('job-documents').remove([storagePath]);
      finalStoragePath = jobPath;

      const { data: pubData } = supabase.storage.from('job-documents').getPublicUrl(jobPath);

      const { data: doc } = await supabase
        .from('job_documents')
        .insert([{
          job_id:      jobId,
          folder:      'sub_invoices',
          title:       invoiceInfo?.invoice_number
            ? `Invoice ${invoiceInfo.invoice_number} — ${invoiceInfo.sub_company || from}`
            : `Invoice from ${invoiceInfo?.sub_company || from} — ${new Date().toLocaleDateString('en-US')}`,
          photo_url:   pubData?.publicUrl || '',
          uploaded_by: 'Gmail AI',
        }])
        .select('id')
        .maybeSingle();

      if (doc) docId = doc.id;

      // In-app notification for Brenda (non-fatal).
      try {
        await supabase.from('notifications').insert([{
          recipient_role: 'operations',
          title:          'Invoice auto-filed',
          message:        `${invoiceInfo?.sub_company || from}: ${invoiceInfo?.invoice_number || 'invoice'} filed under ${jobs.find(j => j.id === jobId)?.client_name || 'job'} (${Math.round(confidence * 100)}% match)`,
          type:           'invoice',
          job_id:         jobId,
        }]);
      } catch { /* non-fatal */ }
    }

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
    console.error(`[gmailPoller] processMessage ${msgId}:`, err.message);
    try {
      await supabase.from('email_processing_log').insert([{
        gmail_message_id: msgId,
        status:           'error',
        error_message:    err?.message || String(err),
      }]);
    } catch { /* ignore */ }
  }
}

// ─── Claude matching ──────────────────────────────────────────────────────────

async function matchInvoice({ from, subject, snippet, base64, mimeType, jobs, subs }) {
  const anthropicKey = process.env.ANTHROPIC_KEY || '';
  if (!anthropicKey) {
    return { jobId: null, confidence: 0, invoiceInfo: null, reason: 'ANTHROPIC_KEY missing' };
  }

  const jobsList = jobs.map(j =>
    `• id:${j.id} | client:"${j.client_name || ''}" | address:"${j.address || ''}" | service:"${j.service || ''}"`
  ).join('\n');

  const subsList = subs.map(s =>
    `• "${s.name || ''}" (contact: "${s.contact_name || ''}")`
  ).join('\n');

  const isImage    = (mimeType || '').startsWith('image/');
  const contentType = isImage ? 'image'    : 'document';
  const mediaMime   = isImage ? (mimeType || 'image/jpeg') : 'application/pdf';

  const prompt = `You are an assistant for Omega Development LLC, a construction company in Connecticut.

An email arrived with an attachment. First determine if this is a SUBCONTRACTOR INVOICE (a bill for labor/services performed by a sub for Omega). Then, if it is, match it to the right job.

EMAIL:
From: ${from}
Subject: ${subject}
Preview: ${snippet}

ACTIVE JOBS:
${jobsList || '(no active jobs)'}

KNOWN SUBCONTRACTORS:
${subsList || '(none)'}

STEP 1 — Is this a subcontractor invoice?
Set "is_invoice": false if it is any of these:
- A quote, proposal, or estimate (not yet billed)
- A material purchase (Home Depot, supplier, etc.) — not labor
- An internal Omega email or forwarded message
- A delivery/status notification or marketing email
- A client-facing document (warranty, completion letter, etc.)
- Anything that is NOT a bill for subcontractor labor/services

STEP 2 — If it IS an invoice, match it to a job.

Return ONLY valid JSON (no markdown):
{
  "is_invoice": true,
  "job_id": "matching job uuid or null",
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
            { type: contentType, source: { type: 'base64', media_type: mediaMime, data: base64 } },
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
      isInvoice:   parsed.is_invoice !== false, // default true if missing
      jobId:       parsed.job_id    || null,
      confidence:  parsed.confidence ?? 0,
      invoiceInfo: parsed.invoice_info || null,
      reason:      parsed.reason    || '',
    };
  } catch (err) {
    console.error('[gmailPoller] Claude matching failed:', err.message);
    return { isInvoice: true, jobId: null, confidence: 0, invoiceInfo: null, reason: `Error: ${err.message}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function gmailGet(path, accessToken) {
  const url = path.startsWith('http') ? path : `${GMAIL_API}${path}`;
  const r   = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Gmail API ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

function getHeader(headers, name) {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function collectAttachments(payload, pdfImageOnly = true) {
  if (!payload) return [];
  const parts  = payload.parts || [];
  const result = [];

  for (const part of parts) {
    if (part.mimeType?.startsWith('multipart/')) {
      result.push(...collectAttachments(part, pdfImageOnly));
      continue;
    }
    const mime    = part.mimeType || '';
    const isPdf   = mime === 'application/pdf';
    const isImage = mime.startsWith('image/');

    // Skip inline tiny images (e.g. email signature logos) — no filename.
    if (isImage && !part.filename) continue;

    if (pdfImageOnly && !isPdf && !isImage) continue;

    // Skip attachments with no body data and no attachmentId.
    const body = part.body || {};
    if (!body.attachmentId && !body.data) continue;

    result.push({
      attachmentId: body.attachmentId || null,
      data:         body.data         || null,
      filename:     part.filename     || 'attachment',
      mimeType:     mime,
    });
  }
  return result;
}
