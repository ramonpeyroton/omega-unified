// Vercel Function: DocuSign Connect webhook.
//
// Receives envelope lifecycle events and syncs the `contracts` and
// `subcontractor_agreements` tables. DocuSign Connect should be configured to
// POST JSON to https://<your-domain>/api/docusign-webhook and subscribe to:
//   - envelope-sent
//   - envelope-signed  (aka envelope-completed in Connect 2.0 terminology)
//   - envelope-declined
//
// Expected env vars on the server:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   // service role so we can bypass RLS on writes
//   DOCUSIGN_HMAC_SECRET        // optional; if set, HMAC signature is verified

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { getAccessToken } from './_lib/docusignAuth.js';

// Initialize once per warm instance
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } }
);

const DS_BASE_URL  = (process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi').replace(/\/$/, '');
const DS_ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM    = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Fires a "X signed the contract" email to company_settings.email so
// Brenda + the salesperson know immediately when DocuSign returns
// completed. Silently no-ops if RESEND_API_KEY isn't configured. The
// `kind` arg drives the subject ("contract" vs "subcontractor
// agreement") so the same helper works for both flows.
async function notifyOmegaOfSigning({ kind, row, signedAt }) {
  if (!RESEND_API_KEY) return;
  try {
    const { data: company } = await supabase
      .from('company_settings').select('*')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    const to = company?.email;
    if (!to) return;

    let clientName = '—', address = '', salesperson = '', totalAmount = null;
    if (kind === 'contract') {
      const { data: job } = await supabase
        .from('jobs').select('client_name, address, salesperson_name')
        .eq('id', row.job_id).maybeSingle();
      clientName = job?.client_name || 'Client';
      address = job?.address || '';
      salesperson = job?.salesperson_name || '';
      totalAmount = row.total_amount;
    } else {
      const { data: sub } = await supabase
        .from('subcontractors').select('name, contact_name')
        .eq('id', row.subcontractor_id).maybeSingle();
      const { data: job } = await supabase
        .from('jobs').select('client_name, address').eq('id', row.job_id).maybeSingle();
      clientName = sub?.contact_name || sub?.name || 'Sub';
      address = job?.address || '';
      totalAmount = row.their_estimate || row.total_amount;
    }

    const subject = kind === 'contract'
      ? `✅ ${clientName} signed the contract`
      : `✅ ${clientName} signed the sub agreement`;
    const heading = kind === 'contract'
      ? `${clientName} signed the contract`
      : `Sub ${clientName} signed the agreement`;
    const accentLabel = kind === 'contract' ? 'Contract signed' : 'Sub agreement signed';
    const totalLine = totalAmount ? `<tr><td style="padding:6px 0;color:#6b6b6b;width:32%;">Amount</td><td style="padding:6px 0;font-weight:700;">${money(totalAmount)}</td></tr>` : '';
    const projectLine = address ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Project</td><td style="padding:6px 0;">${escapeHtml(address)}</td></tr>` : '';
    const sellerLine = salesperson ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Salesperson</td><td style="padding:6px 0;">${escapeHtml(salesperson)}</td></tr>` : '';
    const when = new Date(signedAt || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:520px;margin:0 auto;background:white;padding:24px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#22c55e;font-weight:800;">${accentLabel}</div>
    <h1 style="font-size:22px;margin:6px 0 16px;font-weight:900;">${escapeHtml(heading)}</h1>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${projectLine}
      ${totalLine}
      ${sellerLine}
      <tr><td style="padding:6px 0;color:#6b6b6b;">Signed at</td><td style="padding:6px 0;">${escapeHtml(when)}</td></tr>
    </table>
    <p style="font-size:11px;color:#888;margin:20px 0 0;text-align:center;">
      ${kind === 'contract' ? 'Signed PDF is saving to Documents → Contracts. Payment milestones materialized.' : 'Payment plan materialized in Finance → Subs.'}
    </p>
  </div>
</body></html>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    });
  } catch { /* silent */ }
}

// After a contract is signed, download the PDF from DocuSign and save it
// to Supabase Storage so it appears in Documents → Contracts automatically.
// Non-fatal: any failure here is logged but does not affect the webhook response.
async function downloadAndSaveSignedContract(contract) {
  if (!contract?.docusign_envelope_id || !contract?.job_id) return;
  try {
    const token  = await getAccessToken();
    const pdfRes = await fetch(
      `${DS_BASE_URL}/v2.1/accounts/${DS_ACCOUNT_ID}/envelopes/${contract.docusign_envelope_id}/documents/combined`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!pdfRes.ok) {
      console.warn('[webhook] DocuSign PDF download failed:', await pdfRes.text());
      return;
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const date      = new Date().toISOString().split('T')[0];
    const path      = `${contract.job_id}/contracts/signed-contract-${contract.id}-${date}.pdf`;

    const { error: upErr } = await supabase.storage
      .from('job-documents')
      .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (upErr) {
      console.warn('[webhook] Storage upload failed:', upErr.message);
      return;
    }

    const { data: pub } = supabase.storage.from('job-documents').getPublicUrl(path);
    const publicUrl = pub?.publicUrl || null;

    const signedDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    await supabase.from('job_documents').insert([{
      job_id:      contract.job_id,
      folder:      'contracts',
      title:       `Signed Contract — ${signedDate}`,
      photo_url:   publicUrl,
      uploaded_by: 'DocuSign',
    }]);
  } catch (err) {
    console.warn('[webhook] downloadAndSaveSignedContract failed (non-fatal):', err?.message);
  }
}

function verifyHmac(req, rawBody) {
  const secret = process.env.DOCUSIGN_HMAC_SECRET;
  if (!secret) return true; // skip when not configured
  const signature = req.headers['x-docusign-signature-1'];
  if (!signature) return false;
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return signature === computed;
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let rawBody;
  let payload;
  try {
    rawBody = await readRawBody(req);
    payload = JSON.parse(rawBody);
  } catch (err) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  if (!verifyHmac(req, rawBody)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Connect payload shape: { event, data: { envelopeId, envelopeSummary: { status, completedDateTime, ... } } }
  const event = payload.event || payload.Event || '';
  const envelopeId =
    payload?.data?.envelopeId ||
    payload?.envelopeStatus?.envelopeId ||
    payload?.EnvelopeStatus?.EnvelopeID;
  const status = (
    payload?.data?.envelopeSummary?.status ||
    payload?.envelopeStatus?.status ||
    ''
  ).toLowerCase();
  const completedAt =
    payload?.data?.envelopeSummary?.completedDateTime ||
    payload?.envelopeStatus?.completed ||
    null;

  if (!envelopeId) {
    res.status(400).json({ error: 'Missing envelopeId' });
    return;
  }

  try {
    // Try contracts first
    const { data: contract } = await supabase
      .from('contracts')
      .select('*')
      .eq('docusign_envelope_id', envelopeId)
      .maybeSingle();

    if (contract) {
      const patch = { docusign_status: status };
      const becomingSigned =
        event === 'envelope-signed' || status === 'completed' || status === 'signed';
      if (becomingSigned) {
        patch.status = 'signed';
        patch.signed_at = completedAt || new Date().toISOString();
        // ALSO advance the pipeline so the kanban card moves to
        // 'Contract Signed' automatically — without this the card
        // stays stuck at 'Awaiting Signature' until someone opens
        // EstimateFlow and triggers the front-end refresh. Audit #2.
        await supabase
          .from('jobs')
          .update({ status: 'contracted', pipeline_status: 'contract_signed' })
          .eq('id', contract.job_id);
      } else if (event === 'envelope-declined' || status === 'declined') {
        patch.status = 'declined';
      } else if (event === 'envelope-sent' || status === 'sent') {
        patch.status = 'sent';
      }
      await supabase.from('contracts').update(patch).eq('id', contract.id);

      // When the customer signs, materialize payment_milestones from the
      // payment_plan JSONB so the Finance area has rows to track. Idempotent
      // (we'd skip if rows already exist, but that's unlikely on first sign).
      if (becomingSigned) {
        try {
          await materializePaymentMilestones(contract);
        } catch (err) {
          console.warn('[docusign-webhook] milestone materialization failed:', err?.message);
        }
        // Download the signed PDF and save it to Documents → Contracts so
        // the team can access it at any time without going through DocuSign.
        await downloadAndSaveSignedContract({ ...contract, ...patch });
        // Email Omega's main inbox with a simple confirmation.
        await notifyOmegaOfSigning({ kind: 'contract', row: { ...contract, ...patch }, signedAt: patch.signed_at });
      }

      res.status(200).json({ ok: true, kind: 'contract' });
      return;
    }

    // Else subcontractor agreement
    const { data: agr } = await supabase
      .from('subcontractor_agreements')
      .select('*')
      .eq('docusign_envelope_id', envelopeId)
      .maybeSingle();

    if (agr) {
      const patch = { docusign_status: status };
      const becomingSigned =
        event === 'envelope-signed' || status === 'completed' || status === 'signed';
      if (becomingSigned) {
        patch.status = 'signed';
        patch.signed_at = completedAt || new Date().toISOString();
      } else if (event === 'envelope-declined' || status === 'declined') {
        patch.status = 'declined';
      } else if (event === 'envelope-sent' || status === 'sent') {
        patch.status = 'sent';
      }
      await supabase.from('subcontractor_agreements').update(patch).eq('id', agr.id);

      // Materialize sub_payments rows so we can track payments to the sub.
      if (becomingSigned) {
        try {
          await materializeSubPayments(agr);
        } catch (err) {
          console.warn('[docusign-webhook] sub_payments materialization failed:', err?.message);
        }
        await notifyOmegaOfSigning({ kind: 'agreement', row: { ...agr, ...patch }, signedAt: patch.signed_at });
      }

      res.status(200).json({ ok: true, kind: 'agreement' });
      return;
    }

    res.status(200).json({ ok: true, kind: 'unknown' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Webhook error' });
  }
}

// ─── Materialization helpers (server-side) ───────────────────────
// Inlined so this serverless function stays self-contained — no
// dependency on /src/shared/lib/finance.js (which is browser-side).
//
// Both helpers are idempotent: they bail if milestones already exist
// for the given contract / agreement.

function milestoneAmount(item, totalAmount) {
  if (!item) return 0;
  if (item.amount != null && item.amount !== '') return Number(item.amount) || 0;
  if (item.percent != null && totalAmount != null) {
    return (Number(totalAmount) || 0) * (Number(item.percent) || 0) / 100;
  }
  return 0;
}

async function materializePaymentMilestones(contract) {
  if (!contract?.id) return;
  const { data: existing } = await supabase
    .from('payment_milestones')
    .select('id')
    .eq('contract_id', contract.id)
    .limit(1);
  if (existing && existing.length > 0) return;

  const plan = Array.isArray(contract.payment_plan) ? contract.payment_plan : [];
  if (plan.length === 0) return;

  const rows = plan.map((p, idx) => {
    const amount = milestoneAmount(p, contract.total_amount);
    const wasPaid = !!p.paid;
    return {
      contract_id: contract.id,
      job_id: contract.job_id || null,
      order_idx: idx,
      label: p.label || `Installment ${idx + 1}`,
      due_amount: amount,
      due_date: p.due_date || null,
      received_amount: wasPaid ? amount : 0,
      received_at: wasPaid ? (p.paid_at || new Date().toISOString()) : null,
      status: wasPaid ? 'paid' : 'pending',
    };
  });
  await supabase.from('payment_milestones').insert(rows);
}

async function materializeSubPayments(agreement) {
  if (!agreement?.id) return;
  const { data: existing } = await supabase
    .from('sub_payments')
    .select('id')
    .eq('agreement_id', agreement.id)
    .limit(1);
  if (existing && existing.length > 0) return;

  // Pull the originating offer if the agreement doesn't carry the plan.
  let plan = Array.isArray(agreement.payment_plan) ? agreement.payment_plan : null;
  let total = Number(agreement.their_estimate || agreement.total_amount || 0);
  let subId = agreement.subcontractor_id || null;
  let jobId = agreement.job_id || null;

  if (!plan && agreement.offer_id) {
    const { data: offer } = await supabase
      .from('subcontractor_offers')
      .select('payment_plan, their_estimate, subcontractor_id, job_id')
      .eq('id', agreement.offer_id)
      .maybeSingle();
    if (offer) {
      plan = Array.isArray(offer.payment_plan) ? offer.payment_plan : null;
      total = total || Number(offer.their_estimate || 0);
      subId = subId || offer.subcontractor_id || null;
      jobId = jobId || offer.job_id || null;
    }
  }

  if (!plan || plan.length === 0) return;

  const rows = plan.map((p, idx) => {
    const amount = milestoneAmount(p, total);
    const wasPaid = !!p.paid;
    return {
      agreement_id: agreement.id,
      subcontractor_id: subId,
      job_id: jobId,
      order_idx: idx,
      label: p.label || `Installment ${idx + 1}`,
      due_amount: amount,
      due_date: p.due_date || null,
      paid_amount: wasPaid ? amount : 0,
      paid_at: wasPaid ? (p.paid_at || new Date().toISOString()) : null,
      status: wasPaid ? 'paid' : 'pending',
    };
  });
  await supabase.from('sub_payments').insert(rows);
}
