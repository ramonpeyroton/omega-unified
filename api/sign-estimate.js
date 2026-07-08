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
import { notifyOfficeRoles } from './_lib/notify.js';

const SUPABASE_URL   = process.env.SUPABASE_URL || '';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM    = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

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

  // Change Orders reuse this same public endpoint (Vercel Hobby caps us at
  // 12 functions). A body with change_order_id routes to the CO signer;
  // everything below is the estimate path, left untouched.
  if (body?.change_order_id) return signChangeOrder(req, res, body);

  const estimate_id     = (body?.estimate_id   || '').toString().trim();
  const signature_png   = (body?.signature_png || '').toString();
  const initials_png    = (body?.initials_png  || '').toString();
  const signed_by       = (body?.signed_by     || '').toString().trim();
  const signed_date_raw = (body?.signed_date   || '').toString().trim();
  const disclaimers     = (body?.disclaimers   || '').toString();
  const consent         = body?.consent === true;
  // Disclaimers acknowledgement is required IF the front-end shipped
  // disclaimer text. Older clients / direct-API callers without
  // disclaimer support skip this gate (back-compat).
  const disclaimers_acknowledged = body?.disclaimers_acknowledged === true;

  if (!estimate_id)    return json(res, 400, { ok: false, error: 'Missing estimate_id' });
  if (!signature_png || !signature_png.startsWith('data:image/'))
                       return json(res, 400, { ok: false, error: 'Invalid signature_png (expected data: URL)' });
  if (signed_by.length < 2) return json(res, 400, { ok: false, error: 'signed_by must be at least 2 characters' });
  if (!consent)        return json(res, 400, { ok: false, error: 'ESIGN consent is required' });

  // Disclaimer acknowledgement gate — only enforced when the client
  // actually provided disclaimer text, so legacy callers that don't
  // know about disclaimers still work.
  if (disclaimers && disclaimers.trim() && !disclaimers_acknowledged) {
    return json(res, 400, { ok: false, error: 'You must acknowledge the project disclaimers before signing.' });
  }

  // Validate client-entered date: must be YYYY-MM-DD, a real date, and
  // not more than 24h in the future (accounts for timezone overlap).
  // Falls back to today if the field is missing — the frontend always
  // prefills it, so this is purely a defensive guard.
  let signed_date = null;
  if (signed_date_raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signed_date_raw))
      return json(res, 400, { ok: false, error: 'signed_date must be in YYYY-MM-DD format' });
    const parsed = new Date(`${signed_date_raw}T00:00:00Z`);
    if (isNaN(parsed.getTime()))
      return json(res, 400, { ok: false, error: 'signed_date is not a valid date' });
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    if (parsed.getTime() > tomorrow)
      return json(res, 400, { ok: false, error: 'signed_date cannot be in the future' });
    signed_date = signed_date_raw;
  } else {
    // Default: today in UTC (YYYY-MM-DD).
    signed_date = new Date().toISOString().slice(0, 10);
  }

  // Sanity caps — the full signature should not be larger than ~500 KB
  // and the initials around 200 KB. Anything bigger is probably someone
  // trying to store random blobs.
  if (signature_png.length > 500_000)
    return json(res, 413, { ok: false, error: 'Signature image too large' });
  if (initials_png && initials_png.length > 200_000)
    return json(res, 413, { ok: false, error: 'Initials image too large' });

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

  // Update estimates: signature + status flip. If a column from a
  // pending migration is missing (signed_date from 018, or
  // initials_png / disclaimers from 019) the API drops only the
  // missing fields and retries — the signature still lands, and the
  // legal record we *can* save (signature_png + signed_at) is enough
  // to bootstrap until the migrations are applied.
  const fullPatch = {
    signature_png,
    initials_png:  initials_png || null,
    signed_by,
    signed_at,
    signed_date,
    signed_ip,
    signed_user_agent,
    disclaimers:   disclaimers || null,
    status: 'approved',
    approved_at: signed_at,
    approved_by: signed_by,
  };
  let { error: updErr } = await supabase.from('estimates').update(fullPatch).eq('id', estimate_id);
  // Drop fields one by one if Supabase rejects them with PGRST204
  // (missing column). Order matters — drop the newest schema additions
  // first so we don't lose data we *could* have saved.
  for (const key of ['initials_png', 'disclaimers', 'signed_date']) {
    if (!updErr) break;
    if (!new RegExp(key, 'i').test(updErr.message || '')) continue;
    const { [key]: _drop, ...fallback } = fullPatch;
    const retry = await supabase.from('estimates').update(fallback).eq('id', estimate_id);
    updErr = retry.error || null;
    fullPatch[key] = undefined; // keep the loop honest if multiple cols missing
  }
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
    await notifyOfficeRoles(supabase, {
      jobId: estimate.job_id,
      type: 'estimate_approved',
      title,
      message,
    });
  } catch { /* ignore */ }

  // Email Omega's main inbox so Brenda + the salesperson see the
  // signature confirmation immediately. We use the same Resend
  // transport as send-estimate.js and silently skip if the env vars
  // aren't set so this never blocks the signing flow.
  if (RESEND_API_KEY) {
    try {
      const { data: full } = await supabase
        .from('estimates')
        .select('estimate_number, total_amount, sent_by, option_label')
        .eq('id', estimate_id)
        .maybeSingle();
      const { data: job } = await supabase
        .from('jobs')
        .select('client_name, address, salesperson_name')
        .eq('id', estimate.job_id)
        .maybeSingle();
      const { data: company } = await supabase
        .from('company_settings').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();

      const to = company?.email;
      if (to) {
        const clientName = job?.client_name || signed_by || 'Client';
        const estNum     = full?.estimate_number ? ` (#${full.estimate_number})` : '';
        const subject = `✅ ${clientName} signed the estimate${estNum}`;
        const totalLine  = full?.total_amount ? `<tr><td style="padding:6px 0;color:#6b6b6b;width:32%;">Total</td><td style="padding:6px 0;font-weight:700;">${money(full.total_amount)}</td></tr>` : '';
        const optionLine = full?.option_label ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Chose option</td><td style="padding:6px 0;">${escapeHtml(full.option_label)}</td></tr>` : '';
        const projectLine = job?.address ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Project</td><td style="padding:6px 0;">${escapeHtml(job.address)}</td></tr>` : '';
        const sellerLine = (job?.salesperson_name || full?.sent_by) ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Salesperson</td><td style="padding:6px 0;">${escapeHtml(job?.salesperson_name || full?.sent_by)}</td></tr>` : '';
        const when = new Date(signed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

        const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:520px;margin:0 auto;background:white;padding:24px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#22c55e;font-weight:800;">Estimate signed</div>
    <h1 style="font-size:22px;margin:6px 0 16px;font-weight:900;">${escapeHtml(clientName)} signed${estNum}</h1>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${projectLine}
      ${totalLine}
      ${optionLine}
      ${sellerLine}
      <tr><td style="padding:6px 0;color:#6b6b6b;">Signed at</td><td style="padding:6px 0;">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b6b6b;">Signed by</td><td style="padding:6px 0;">${escapeHtml(signed_by || '—')}</td></tr>
    </table>
    <p style="font-size:11px;color:#888;margin:20px 0 0;text-align:center;">
      Heads-up only. Operations will follow up to prepare the contract.
    </p>
  </div>
</body></html>`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
        });
      }
    } catch { /* silent — signing already succeeded */ }
  }

  return json(res, 200, { ok: true, signed_at, signed_by, signed_date, rejected_siblings });
}

// ─── Change Order signing ─────────────────────────────────────────────
// Mirrors the estimate flow: validate, lock (409 if already signed), save
// the signature, flip status -> 'signed', notify the team, email Omega.
// A signed change order's amount is added to the job's revenue by the
// financials layer (jobFinancials.sumSignedChangeOrders).
async function signChangeOrder(req, res, body) {
  const change_order_id = (body?.change_order_id || '').toString().trim();
  const signature_png   = (body?.signature_png || '').toString();
  const initials_png    = (body?.initials_png  || '').toString();
  const signed_by       = (body?.signed_by     || '').toString().trim();
  const signed_date_raw = (body?.signed_date   || '').toString().trim();
  const disclaimers     = (body?.disclaimers   || '').toString();
  const consent         = body?.consent === true;
  const disclaimers_acknowledged = body?.disclaimers_acknowledged === true;

  if (!change_order_id) return json(res, 400, { ok: false, error: 'Missing change_order_id' });
  if (!signature_png || !signature_png.startsWith('data:image/'))
    return json(res, 400, { ok: false, error: 'Invalid signature_png (expected data: URL)' });
  if (signed_by.length < 2) return json(res, 400, { ok: false, error: 'signed_by must be at least 2 characters' });
  if (!consent) return json(res, 400, { ok: false, error: 'ESIGN consent is required' });
  if (disclaimers && disclaimers.trim() && !disclaimers_acknowledged)
    return json(res, 400, { ok: false, error: 'You must acknowledge the disclaimers before signing.' });

  let signed_date;
  if (signed_date_raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signed_date_raw))
      return json(res, 400, { ok: false, error: 'signed_date must be in YYYY-MM-DD format' });
    signed_date = signed_date_raw;
  } else {
    signed_date = new Date().toISOString().slice(0, 10);
  }

  if (signature_png.length > 500_000) return json(res, 413, { ok: false, error: 'Signature image too large' });
  if (initials_png && initials_png.length > 200_000) return json(res, 413, { ok: false, error: 'Initials image too large' });

  const { data: co, error: cErr } = await supabase
    .from('change_orders')
    .select('id, job_id, status, signed_at, amount, description')
    .eq('id', change_order_id).maybeSingle();
  if (cErr || !co) return json(res, 404, { ok: false, error: 'Change order not found' });
  if (co.signed_at) return json(res, 409, { ok: false, error: 'This change order has already been signed.' });

  const signed_at = new Date().toISOString();
  const signed_ip = clientIp(req);
  const signed_user_agent = (req.headers['user-agent'] || '').toString().slice(0, 500) || null;

  const { error: updErr } = await supabase.from('change_orders').update({
    signature_png,
    initials_png: initials_png || null,
    signed_by,
    signed_at,
    signed_date,
    signed_ip,
    signed_user_agent,
    disclaimers: disclaimers || null,
    disclaimers_acknowledged: disclaimers_acknowledged || false,
    consent: true,
    status: 'signed',
  }).eq('id', change_order_id);
  if (updErr) return json(res, 500, { ok: false, error: updErr.message || 'Failed to save signature' });

  // Notify sales + operations + owner (same bell the estimate flow uses).
  try {
    const title = `Change order signed by ${signed_by}`;
    const message = `Customer signed a change order${co.amount ? ` for ${money(co.amount)}` : ''}${co.description ? `: ${co.description}` : ''}.`;
    await notifyOfficeRoles(supabase, { jobId: co.job_id, type: 'change_order', title, message });
  } catch { /* ignore */ }

  // Email Omega's inbox (optional — same Resend transport).
  if (RESEND_API_KEY) {
    try {
      const { data: job } = await supabase.from('jobs').select('client_name, address').eq('id', co.job_id).maybeSingle();
      const { data: company } = await supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
      const to = company?.email;
      if (to) {
        const clientName = job?.client_name || signed_by || 'Client';
        const subject = `✅ ${clientName} signed a change order`;
        const when = new Date(signed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
        const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:520px;margin:0 auto;background:white;padding:24px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#22c55e;font-weight:800;">Change order signed</div>
    <h1 style="font-size:22px;margin:6px 0 16px;font-weight:900;">${escapeHtml(clientName)} signed a change order</h1>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${job?.address ? `<tr><td style="padding:6px 0;color:#6b6b6b;width:32%;">Project</td><td style="padding:6px 0;">${escapeHtml(job.address)}</td></tr>` : ''}
      ${co.amount ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Amount</td><td style="padding:6px 0;font-weight:700;">${money(co.amount)}</td></tr>` : ''}
      ${co.description ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Scope</td><td style="padding:6px 0;">${escapeHtml(co.description)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#6b6b6b;">Signed at</td><td style="padding:6px 0;">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b6b6b;">Signed by</td><td style="padding:6px 0;">${escapeHtml(signed_by || '—')}</td></tr>
    </table>
  </div>
</body></html>`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
        });
      }
    } catch { /* silent */ }
  }

  return json(res, 200, { ok: true, signed_at, signed_by, signed_date });
}
