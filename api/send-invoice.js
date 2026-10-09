// Vercel Function: email a payment-milestone invoice to the client — and,
// with { action: 'receipt' }, the "Payment received" receipt (see
// handleReceipt below).
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
  // 'YYYY-MM-DD' is a calendar day — read it as such, never as UTC
  // midnight (that shows the day before in New York).
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(iso);
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

// ─── Payment receipt ──────────────────────────────────────────────
// POST JSON: { action: 'receipt', milestoneId, amount, receivedOn: 'YYYY-MM-DD' }
// Sent right after a payment is marked received (Estimate Flow step 5 or
// Finance → Clients), unless the person unticks "Email receipt to client".
// Lives in this function (not its own) to stay under Vercel Hobby's
// 12-function cap. A copy goes to the office mailbox (bcc).

const SERVICE_NAMES = {
  bathroom: 'Bathroom Renovation', kitchen: 'Kitchen Renovation', deck: 'Deck / Patio',
  addition: 'Home Addition', roofing: 'Roofing', driveway: 'Driveway', basement: 'Basement Finishing',
  flooring: 'Flooring', survey: 'Survey', building_plans: 'Building Plans',
  partialreno: 'Partial Renovation', fullreno: 'Full Renovation', newconstruction: 'New Construction',
};
function projectName(job) {
  const ids = String(job?.service || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids.map((id) => SERVICE_NAMES[id] || id).join(' + ') : 'your project';
}

function renderReceiptEmailHTML({ job, company, milestone, installmentNumber, totalInstallments, amount, receivedOn, receiptNo, contractTotal, paidToDate, next }) {
  const logoUrl = company?.logo_url || `${PUBLIC_APP_URL.replace(/\/$/, '')}/logo.png`;
  const companyName = company?.company_name || 'Omega Development';
  const first = (job.client_name || 'there').split(' ')[0];
  const label = milestone.label || `Installment ${installmentNumber}`;
  const remaining = Math.max(0, contractTotal - paidToDate);
  const fullyPaid = contractTotal > 0 && remaining < 0.005;
  const leftOnThis = Math.max(0, Number(milestone.due_amount || 0) - Number(milestone.received_amount || 0));
  const pct = contractTotal > 0 ? Math.min(100, Math.round((paidToDate / contractTotal) * 100)) : 0;
  const project = projectName(job);
  const place = [project, job.address].filter(Boolean).join(' · ');
  const ofN = totalInstallments > 1 ? ` (${installmentNumber} of ${totalInstallments})` : '';

  const brandHTML = company?.logo_url
    ? `<img src="${escape(logoUrl)}" alt="${escape(companyName)}" height="64" style="display:block;border:0;outline:none;height:64px;width:auto;" />`
    : `
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <img src="${escape(logoUrl)}" alt="Omega" width="56" height="56" style="display:block;border:0;outline:none;width:56px;height:56px;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:20px;font-weight:900;color:#2C2C2A;letter-spacing:-0.02em;line-height:1;">OMEGA<span style="color:#E8732A;">DEVELOPMENT</span></div>
            <div style="font-size:9px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-top:6px;">RENOVATIONS &amp; CONSTRUCTION</div>
          </td>
        </tr>
      </table>`;

  const message = fullyPaid
    ? `Thank you for your payment! We've received <strong>${money(amount)}</strong> for the <strong>${escape(label)}</strong> installment, and your ${escape(project)} is now <strong>fully paid</strong>. It has been a pleasure working with you — thank you for trusting ${escape(companyName)}.`
    : leftOnThis > 0.005
      ? `Thank you for your payment! We've received <strong>${money(amount)}</strong> toward the <strong>${escape(label)}</strong> installment of your ${escape(project)}. <strong>${money(leftOnThis)}</strong> is still due on this installment.`
      : `Thank you for your payment! We've received <strong>${money(amount)}</strong> for the <strong>${escape(label)}</strong> installment of your ${escape(project)}. We truly appreciate your trust in ${escape(companyName)} — our team is excited to keep your project moving.`;

  const nextHTML = !fullyPaid && next ? `
    <div style="margin-top:22px;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:14px;">
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6b6b6b;font-weight:800;">Next installment</div>
      <div style="font-size:14px;margin-top:6px;"><strong>${escape(next.label || 'Next installment')}</strong> — ${money(next.amount)}</div>
      <div style="font-size:12px;color:#6b6b6b;margin-top:2px;">${next.due_date ? `Due ${escape(fmtDate(next.due_date))}.` : 'We\'ll send you an invoice when it\'s due.'}</div>
    </div>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Payment receipt — ${escape(label)}</title></head>
<body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    ${brandHTML}

    <div style="margin-top:28px;text-align:center;">
      <div style="width:56px;height:56px;border-radius:50%;background:#16a34a;color:white;font-size:30px;font-weight:900;line-height:56px;margin:0 auto;">&#10003;</div>
      <h1 style="font-size:24px;margin:14px 0 4px;font-weight:900;">${fullyPaid ? 'Your project is fully paid — thank you!' : 'Payment received — thank you!'}</h1>
      <div style="font-size:12px;color:#6b6b6b;">Receipt #${escape(receiptNo)} · ${escape(fmtDate(receivedOn))}</div>
    </div>

    <p style="font-size:14px;line-height:1.65;color:#444;margin:24px 0 0;">Hi ${escape(first)},</p>
    <p style="font-size:14px;line-height:1.65;color:#444;margin:8px 0 0;">${message}</p>

    <div style="border:2px solid #16a34a;border-radius:8px;padding:18px;background:#f0fdf4;margin:22px 0;">
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#15803d;font-weight:800;">Amount Received</div>
      <div style="font-size:34px;font-weight:900;color:#15803d;line-height:1;margin-top:6px;">${money(amount)}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:13px;">
        <tr><td style="padding:3px 0;color:#555;">Payment for</td><td style="padding:3px 0;text-align:right;font-weight:600;">${escape(label)}${escape(ofN)}</td></tr>
        <tr><td style="padding:3px 0;color:#555;">Date received</td><td style="padding:3px 0;text-align:right;font-weight:600;">${escape(fmtDate(receivedOn))}</td></tr>
        <tr><td style="padding:3px 0;color:#555;">Project</td><td style="padding:3px 0;text-align:right;font-weight:600;">${escape(place)}</td></tr>
      </table>
    </div>

    ${contractTotal > 0 ? `
    <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6b6b6b;font-weight:800;">Your project balance</div>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px;">
      <tr><td style="padding:5px 0;color:#555;">Contract total</td><td style="padding:5px 0;text-align:right;font-weight:600;">${money(contractTotal)}</td></tr>
      <tr><td style="padding:5px 0;color:#555;">Paid to date</td><td style="padding:5px 0;text-align:right;font-weight:700;color:#15803d;">${money(paidToDate)}</td></tr>
      <tr style="border-top:2px solid #2C2C2A;"><td style="padding:9px 0 5px;font-weight:800;">Remaining balance</td><td style="padding:9px 0 5px;text-align:right;font-weight:900;font-size:18px;">${money(remaining)}</td></tr>
    </table>
    <div style="height:10px;border-radius:5px;background:#ececE9;margin-top:10px;overflow:hidden;">
      <div style="height:10px;width:${pct}%;background:#16a34a;"></div>
    </div>
    <div style="font-size:11px;color:#6b6b6b;margin-top:5px;">${pct}% of your project is paid</div>` : ''}

    ${nextHTML}

    <p style="font-size:12px;line-height:1.6;color:#6b6b6b;margin:22px 0 0;">This email is your receipt — please keep it for your records.</p>

    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center;line-height:1.6;">
      ${escape(companyName)}${company?.address ? ` · ${escape(company.address)}` : ''}<br />
      Questions? Reply to this email${company?.phone ? ` or call ${escape(company.phone)}` : ''}.
    </div>
  </div>
</body></html>`;
}

async function handleReceipt(res, body) {
  const { milestoneId, amount, receivedOn } = body || {};
  const amt = Number(amount);
  if (!milestoneId) return json(res, 400, { ok: false, error: 'Missing milestoneId' });
  if (!(amt > 0))   return json(res, 400, { ok: false, error: 'Missing payment amount' });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(receivedOn || '')) ? receivedOn : new Date().toISOString().slice(0, 10);

  const { data: milestone } = await supabase
    .from('payment_milestones').select('*').eq('id', milestoneId).maybeSingle();
  if (!milestone) return json(res, 404, { ok: false, error: 'Installment not found' });

  const [{ data: siblings }, { data: contract }, { data: job }, { data: company }] = await Promise.all([
    supabase.from('payment_milestones').select('*').eq('contract_id', milestone.contract_id).order('order_idx', { ascending: true }),
    supabase.from('contracts').select('id, total_amount').eq('id', milestone.contract_id).maybeSingle(),
    supabase.from('jobs').select('*').eq('id', milestone.job_id).maybeSingle(),
    supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!job) return json(res, 404, { ok: false, error: 'Job not found' });
  if (!job.client_email) return json(res, 400, { ok: false, error: 'Client has no email on file' });

  const list = siblings || [milestone];
  const totalInstallments = list.length || 1;
  const installmentNumber = Math.max(1, list.findIndex((s) => s.id === milestone.id) + 1);
  const contractTotal = Number(contract?.total_amount) || list.reduce((s, m) => s + (Number(m.due_amount) || 0), 0);
  const paidToDate = list.reduce((s, m) => s + (Number(m.received_amount) || 0), 0);
  // Next installment still owed: first one after this, else any earlier one.
  const open = list.filter((m) => m.id !== milestone.id && Number(m.received_amount || 0) < Number(m.due_amount || 0) - 0.005);
  const nextRow = open.find((m) => (m.order_idx ?? 0) > (milestone.order_idx ?? 0)) || open[0] || null;
  const next = nextRow ? {
    label: nextRow.label,
    amount: Math.max(0, Number(nextRow.due_amount || 0) - Number(nextRow.received_amount || 0)),
    due_date: nextRow.due_date,
  } : null;
  const receiptNo = `RCPT-${String(milestone.id).slice(0, 8).toUpperCase()}-${day.slice(2).replace(/-/g, '')}`;

  const html = renderReceiptEmailHTML({
    job, company, milestone, installmentNumber, totalInstallments,
    amount: amt, receivedOn: day, receiptNo, contractTotal, paidToDate, next,
  });
  const fullyPaid = contractTotal > 0 && contractTotal - paidToDate < 0.005;
  const companyName = company?.company_name || 'Omega Development';
  const subject = fullyPaid
    ? `Your project is fully paid — thank you! — ${companyName}`
    : `Payment received — thank you! — ${companyName}`;
  const officeCopy = company?.email || 'office@omeganyct.com';

  let providerId = null;
  let errorMsg = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [job.client_email],
        bcc: officeCopy && officeCopy.toLowerCase() !== String(job.client_email).toLowerCase() ? [officeCopy] : undefined,
        reply_to: company?.email || undefined,
        subject,
        html,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) errorMsg = data?.message || `Resend HTTP ${r.status}`;
    else       providerId = data?.id || null;
  } catch (err) {
    errorMsg = err?.message || String(err);
  }
  if (!providerId) return json(res, 500, { ok: false, error: errorMsg || 'Receipt email failed' });

  return json(res, 200, { ok: true, providerId, receiptNo, fullyPaid, to: job.client_email });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireSecret(req, res)) return;
  if (!supabase)        return json(res, 500, { ok: false, error: 'Supabase not configured.' });
  if (!RESEND_API_KEY)  return json(res, 500, { ok: false, error: 'Resend not configured (RESEND_API_KEY missing).' });

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  if (body?.action === 'receipt') return handleReceipt(res, body);

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
