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

// Initialize once per warm instance
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } }
);

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
      if (event === 'envelope-signed' || status === 'completed' || status === 'signed') {
        patch.status = 'signed';
        patch.signed_at = completedAt || new Date().toISOString();
        await supabase.from('jobs').update({ status: 'contracted' }).eq('id', contract.job_id);
      } else if (event === 'envelope-declined' || status === 'declined') {
        patch.status = 'declined';
      } else if (event === 'envelope-sent' || status === 'sent') {
        patch.status = 'sent';
      }
      await supabase.from('contracts').update(patch).eq('id', contract.id);
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
      if (event === 'envelope-signed' || status === 'completed' || status === 'signed') {
        patch.status = 'signed';
        patch.signed_at = completedAt || new Date().toISOString();
      } else if (event === 'envelope-declined' || status === 'declined') {
        patch.status = 'declined';
      } else if (event === 'envelope-sent' || status === 'sent') {
        patch.status = 'sent';
      }
      await supabase.from('subcontractor_agreements').update(patch).eq('id', agr.id);
      res.status(200).json({ ok: true, kind: 'agreement' });
      return;
    }

    res.status(200).json({ ok: true, kind: 'unknown' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Webhook error' });
  }
}
