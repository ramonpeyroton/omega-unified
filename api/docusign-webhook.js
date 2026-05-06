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
        await supabase.from('jobs').update({ status: 'contracted' }).eq('id', contract.job_id);
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
