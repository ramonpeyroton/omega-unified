// Vercel Function: email a payment-milestone invoice to the client.
//
// POST JSON: { milestoneId: "<uuid>", pdfUrl: "<public storage url>", isResend?: bool }
//
// The client (Estimate Flow step 5) is responsible for:
//   1. Rendering InvoiceTemplate hidden, html2pdf-ing it to a Blob.
//   2. Uploading the PDF to the `job-documents` bucket.
//   3. Inserting a `job_documents` row with folder='invoices'.
//   4. Calling THIS endpoint with the milestoneId + the public PDF url.
//
// We do the email-with-attachment + stamp `payment_milestones.invoice_sent_at`
// (and `invoice_doc_id` if provided). Read-side simplicity: only the email
// + DB stamp live here, the PDF was already persisted client-side so a
// failure here doesn't lose the document.
//
// Required env vars (same set used by send-estimate.js):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY, RESEND_FROM (defaults to Omega's office address)
//   PUBLIC_APP_URL (for the logo fallback in the email body)

import { createClient } from '@supabase/supabase-js';
import { requireSecret } from './_lib/requireSecret.js';

const SUPABASE_URL   = process.env.SUPABASE_URL || '';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM    = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://omega-unified.vercel.app';

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
function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderInvoiceEmailHTML({ milestone, job, company, installmentNumber, totalInstallments, isResend }) {
  const logoUrl = company?.logo_url || `${PUBLIC_APP_URL.replace(/\/$/, '')}/logo.png`;
  const customerFirst = (job.client_name || 'there').split(' ')[0];
  const dueAmount = Number(milestone.due_amount || 0);
  const label = milestone.label || `Installment ${installmentNumber}`;
  const dueDate = fmtDate(milestone.due_date);

  const brandHTML = company?.logo_url
    ? `<img src="${escape(logoUrl)}" alt="${escape(company?.company_name || 'Omega Development')}" height="64" style="display:block;border:0;outline:none;height:64px;width:auto;" />`
    : `
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <img src="${escape(logoUrl)}" alt="Omega" width="56" height="56" style="display:block;border:0;outline:none;width:56px;height:56px;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:20px;font-weight:900;color:#2C2C2A;letter-spacing:-0.02em;line-height:1;">
              OMEGA<span style="color:#E8732A;">DEVELOPMENT</span>
            </div>
            <div style="font-size:9px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-top:6px;">RENOVATIONS &amp; CONSTRUCTION</div>
          </td>
        </tr>
      </table>`;

  const intro = isResend
    ? `Re-sending the invoice below for <strong>${escape(label)}</strong>${totalInstallments > 1 ? ` (installment ${installmentNumber} of ${totalInstallments})` : ''}.`
    : `Please find attached the invoice for <strong>${escape(label)}</strong>${totalInstallments > 1 ? ` (installment ${installmentNumber} of ${totalInstallments})` : ''} on your project.`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice — ${escape(label)}</title></head>
<body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    ${brandHTML}

    <h1 style="font-size:22px;margin:24px 0 8px;font-weight:900;">Hi ${escape(customerFirst)},</h1>
    <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 20px;">
      ${intro}
    </p>

    <div style="border:2px solid #E8732A;border-radius:8px;padding:18px;background:#FFF7F1;margin:20px 0;">
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#E8732A;font-weight:800;">Amount Due</div>
      <div style="font-size:32px;font-weight:900;color:#E8732A;font-variant-numeric:tabular-nums;line-height:1;margin-top:6px;">${money(dueAmount)}</div>
      <div style="font-size:13px;color:#555;margin-top:8px;">${escape(label)}${dueDate ? ` · Due ${escape(dueDate)}` : ''}</div>
    </div>

    <p style="font-size:13px;line-height:1.6;color:#444;margin:0 0 12px;">
      The full invoice is attached as a PDF. Make checks payable to
      <strong>${escape(company?.company_name || 'Omega Development LLC')}</strong>${company?.phone ? `, or call <strong>${escape(company.phone)}</strong> for ACH/wire details` : ''}.
    </p>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center;">
      Questions? Reply to this email${company?.phone ? ` or call ${escape(company.phone)}` : ''}.
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireSecret(req, res)) return;
  if (!supabase)        return json(res, 500, { ok: false, error: 'Supabase not configured.' });
  if (!RESEND_API_KEY)  return json(res, 500, { ok: false, error: 'Resend not configured (RESEND_API_KEY missing).' });

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const { milestoneId, pdfUrl, docId, isResend } = body || {};
  if (!milestoneId) return json(res, 400, { ok: false, error: 'Missing milestoneId' });
  if (!pdfUrl)      return json(res, 400, { ok: false, error: 'Missing pdfUrl' });

  // Load milestone + sibling milestones (for "X of N" display) + job + company.
  const { data: milestone, error: mErr } = await supabase
    .from('payment_milestones').select('*').eq('id', milestoneId).maybeSingle();
  if (mErr || !milestone) return json(res, 404, { ok: false, error: 'Milestone not found' });

  const { data: siblings } = await supabase
    .from('payment_milestones')
    .select('id, order_idx')
    .eq('contract_id', milestone.contract_id)
    .order('order_idx', { ascending: true });
  const totalInstallments = (siblings || []).length || 1;
  const installmentNumber = Math.max(
    1,
    (siblings || []).findIndex((s) => s.id === milestoneId) + 1
  );

  const { data: job } = await supabase
    .from('jobs').select('*').eq('id', milestone.job_id).maybeSingle();
  if (!job) return json(res, 404, { ok: false, error: 'Job not found' });
  if (!job.client_email) return json(res, 400, { ok: false, error: 'Client has no email on file' });

  const { data: company } = await supabase
    .from('company_settings').select('*')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  // Fetch the PDF the client just uploaded so we can attach it.
  let pdfBase64 = null;
  let attachmentName = `invoice-${(job.client_name || 'client').replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40)}-${milestone.label?.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30) || 'installment'}.pdf`;
  try {
    const r = await fetch(pdfUrl);
    if (!r.ok) throw new Error(`PDF fetch failed: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    pdfBase64 = buf.toString('base64');
  } catch (err) {
    return json(res, 502, { ok: false, error: `Could not fetch the PDF from storage: ${err.message || err}` });
  }

  const html = renderInvoiceEmailHTML({ milestone, job, company, installmentNumber, totalInstallments, isResend });
  const subject = isResend
    ? `Re-sending invoice — ${milestone.label || 'Installment'} — ${company?.company_name || 'Omega Development'}`
    : `Invoice — ${milestone.label || 'Installment'} — ${company?.company_name || 'Omega Development'}`;

  let providerId = null;
  let errorMsg   = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [job.client_email],
        reply_to: company?.email || undefined,
        subject,
        html,
        attachments: [
          { filename: attachmentName, content: pdfBase64 },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) errorMsg = data?.message || `Resend HTTP ${r.status}`;
    else       providerId = data?.id || null;
  } catch (err) {
    errorMsg = err?.message || String(err);
  }

  if (!providerId) return json(res, 500, { ok: false, error: errorMsg || 'Send failed' });

  // Stamp milestone — sent_at always wins (resend overwrites). doc_id
  // only set on first send; resends keep pointing to the original PDF
  // unless the caller passes a fresh docId.
  const patch = { invoice_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (docId) patch.invoice_doc_id = docId;
  await supabase.from('payment_milestones').update(patch).eq('id', milestoneId);

  return json(res, 200, {
    ok: true,
    providerId,
    milestoneId,
    isResend: !!isResend,
  });
}
