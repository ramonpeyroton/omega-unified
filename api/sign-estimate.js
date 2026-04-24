// Vercel Function: record customer e-signature for an estimate.
//
// POST JSON: {
//   estimate_id:   "<uuid>",
//   signature_png: "data:image/png;base64,...",
//   signed_by:     "Customer Full Name",
//   consent:       true,
// }
//
// On success:
//   - writes signature_png / signed_by / signed_at / signed_ip / signed_user_agent on estimates
//   - flips estimates.status -> 'approved' and sets approved_at / approved_by
//   - flips jobs.pipeline_status -> 'estimate_approved'
//   - creates notifications for sales + operations
//   - locks the row: a second call for the same estimate returns 409
//
// Requires server env vars (no VITE_ prefix):
//   SUPABASE_URL                   https://...
//   SUPABASE_SERVICE_ROLE_KEY      service_role key (bypasses RLS)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Take the first non-empty IP out of x-forwarded-for (Vercel puts the
// real client IP first, then the chain of proxies). Falls back to
// x-real-ip and finally the raw socket address.
function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').toString();
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const xri = (req.headers['x-real-ip'] || '').toString().trim();
  if (xri) return xri;
  return req.socket?.remoteAddress || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).' });

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const estimate_id   = (body?.estimate_id   || '').toString().trim();
  const signature_png = (body?.signature_png || '').toString();
  const signed_by     = (body?.signed_by     || '').toString().trim();
  const consent       = body?.consent === true;

  if (!estimate_id)    return json(res, 400, { ok: false, error: 'Missing estimate_id' });
  if (!signature_png || !signature_png.startsWith('data:image/'))
                       return json(res, 400, { ok: false, error: 'Invalid signature_png (expected data: URL)' });
  if (signed_by.length < 2) return json(res, 400, { ok: false, error: 'signed_by must be at least 2 characters' });
  if (!consent)        return json(res, 400, { ok: false, error: 'ESIGN consent is required' });

  // Sanity cap — a canvas signature should not be larger than ~500 KB.
  // Anything bigger is probably someone trying to store random blobs.
  if (signature_png.length > 500_000)
    return json(res, 413, { ok: false, error: 'Signature image too large' });

  // Load the estimate. 404 if missing, 409 if already signed.
  const { data: estimate, error: eErr } = await supabase
    .from('estimates').select('id, job_id, status, signed_at, group_id').eq('id', estimate_id).maybeSingle();
  if (eErr || !estimate) return json(res, 404, { ok: false, error: 'Estimate not found' });
  if (estimate.signed_at)
    return json(res, 409, { ok: false, error: 'This estimate has already been signed. Contact Omega if you need to revise it.' });

  // If this estimate belongs to a multi-option group, check that no
  // sibling was already signed — whichever option the customer picks
  // locks the whole group. Two people can't race to sign different
  // options on the same proposal.
  const group_id = estimate.group_id || estimate.id;
  if (estimate.group_id) {
    const { data: siblingSigned } = await supabase
      .from('estimates')
      .select('id, signed_by, signed_at, option_label')
      .eq('group_id', group_id)
      .not('signed_at', 'is', null)
      .limit(1);
    if (siblingSigned && siblingSigned.length) {
      const s = siblingSigned[0];
      return json(res, 409, {
        ok: false,
        error: `Another option (${s.option_label || 'one of the alternatives'}) was already signed by ${s.signed_by || 'the customer'}. Contact Omega if you need to revise the proposal.`,
      });
    }
  }

  const signed_at = new Date().toISOString();
  const signed_ip = clientIp(req);
  const signed_user_agent = (req.headers['user-agent'] || '').toString().slice(0, 500) || null;

  // Update estimates: signature + status flip.
  const { error: updErr } = await supabase.from('estimates').update({
    signature_png,
    signed_by,
    signed_at,
    signed_ip,
    signed_user_agent,
    status: 'approved',
    approved_at: signed_at,
    approved_by: signed_by,
  }).eq('id', estimate_id);
  if (updErr) return json(res, 500, { ok: false, error: updErr.message || 'Failed to save signature' });

  // If this is part of a multi-option group, auto-reject the siblings
  // the customer didn't choose. We keep them around (audit trail — all
  // 3 PDFs stay in the Documents tab) but their status chip flips from
  // SENT -> LOST so the picker reflects the decision.
  let rejected_siblings = 0;
  if (estimate.group_id) {
    try {
      const { data: sibs } = await supabase
        .from('estimates')
        .update({
          status: 'rejected',
          status_detail: `Customer chose another option (${signed_by} selected ${new Date(signed_at).toLocaleDateString()}).`,
        })
        .eq('group_id', group_id)
        .neq('id', estimate_id)
        .select('id');
      rejected_siblings = (sibs || []).length;
    } catch { /* non-fatal — the signed row is already saved */ }
  }

  // Flip the job's pipeline status so the sales kanban reflects approval.
  try {
    await supabase.from('jobs').update({
      pipeline_status: 'estimate_approved',
    }).eq('id', estimate.job_id);
  } catch { /* ignore — the estimate is already saved */ }

  // Fan-out notifications to sales + operations. Uses the same
  // `notifications` table the in-app bell reads from.
  try {
    // Look up the chosen option's label for a friendlier message when
    // we're inside a multi-option group.
    let optionSuffix = '';
    if (rejected_siblings > 0) {
      const { data: chosen } = await supabase
        .from('estimates').select('option_label').eq('id', estimate_id).maybeSingle();
      if (chosen?.option_label) optionSuffix = ` — chose ${chosen.option_label}`;
    }
    const title = `Estimate approved by ${signed_by}${optionSuffix}`;
    const message = rejected_siblings > 0
      ? `Customer picked one of ${rejected_siblings + 1} options and signed. Prepare the contract for DocuSign.`
      : 'Customer signed the estimate. Prepare the contract for DocuSign.';
    await supabase.from('notifications').insert([
      { recipient_role: 'sales',      title, message, type: 'estimate_approved', job_id: estimate.job_id, read: false },
      { recipient_role: 'operations', title, message, type: 'estimate_approved', job_id: estimate.job_id, read: false },
    ]);
  } catch { /* ignore */ }

  return json(res, 200, { ok: true, signed_at, signed_by, rejected_siblings });
}
