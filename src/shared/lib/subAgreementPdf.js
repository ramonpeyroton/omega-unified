// Client-side fallback for the "Generate & Send via DocuSign" button on
// subcontractor agreements. When DocuSign isn't wired up (env vars
// missing or the feature flag off), we generate a printable PDF the
// crew can hand to the sub for an in-person signature instead of
// silently 404-ing the user against /api/docusign/create-envelope.
//
// Render strategy mirrors ContractTemplate.jsx: build a hidden DOM
// node, hand it to html2pdf.js, then strip it. Dynamic import keeps
// html2pdf out of the main bundle until someone actually downloads.

import { subDisplayNames } from './subcontractor';

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  // Treat input as a calendar date (YYYY-MM-DD) so we don't time-shift
  // by the user's timezone — the agreement says "start on the 8th",
  // not "start on the 7th-or-8th depending on UTC offset".
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString();
  return new Date(iso).toLocaleDateString();
}

function todayIso() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function safeFilenamePart(s) {
  return String(s || 'agreement').replace(/[^a-z0-9-]/gi, '_').slice(0, 40);
}

function buildAgreementHtml({ job, subcontractor, scope, amount, paymentPlan, startDate, endDate }) {
  const sub = subDisplayNames(subcontractor);
  const planRows = (paymentPlan || []).map((p) => {
    const pct = Number(p.percent) || 0;
    const dollars = (amount * pct) / 100;
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #ccc;">${escapeHtml(p.label || '—')}</td>
      <td style="padding:6px 10px;border:1px solid #ccc;text-align:right;">${pct}%</td>
      <td style="padding:6px 10px;border:1px solid #ccc;text-align:right;">${escapeHtml(fmtMoney(dollars))}</td>
    </tr>`;
  }).join('');

  return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color:#1a1a1a; padding:32px; max-width:780px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:14px;margin-bottom:24px;">
        <div>
          <h1 style="margin:0;font-size:22px;letter-spacing:0.5px;">Subcontractor Agreement</h1>
          <p style="margin:4px 0 0;font-size:11px;color:#666;">Omega Development LLC</p>
        </div>
        <div style="text-align:right;font-size:11px;color:#666;">
          <div>Issued: ${escapeHtml(fmtDate(todayIso()))}</div>
        </div>
      </div>

      <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666;">Project</h2>
      <p style="margin:0 0 16px;font-size:13px;line-height:1.5;">
        <strong>${escapeHtml(job?.client_name || '—')}</strong><br>
        ${escapeHtml(job?.address || '—')}
      </p>

      <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666;">Subcontractor</h2>
      <p style="margin:0 0 16px;font-size:13px;line-height:1.5;">
        <strong>${escapeHtml(sub.primary)}</strong>${sub.secondary ? ` — ${escapeHtml(sub.secondary)}` : ''}<br>
        ${escapeHtml(subcontractor?.phone || '')}${subcontractor?.email ? ` · ${escapeHtml(subcontractor.email)}` : ''}
        ${subcontractor?.trade ? `<br><span style="font-size:11px;color:#666;">Trade: ${escapeHtml(subcontractor.trade)}</span>` : ''}
      </p>

      <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666;">Scope of Work</h2>
      <div style="border:1px solid #ddd;padding:12px;border-radius:6px;background:#fafafa;font-size:13px;line-height:1.55;white-space:pre-wrap;margin-bottom:18px;">${escapeHtml(scope || '—')}</div>

      <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666;">Compensation</h2>
      <p style="margin:0 0 8px;font-size:14px;"><strong>Total: ${escapeHtml(fmtMoney(amount))}</strong></p>
      ${planRows ? `
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px;">
          <thead>
            <tr>
              <th style="padding:6px 10px;border:1px solid #ccc;background:#f3f3f3;text-align:left;">Milestone</th>
              <th style="padding:6px 10px;border:1px solid #ccc;background:#f3f3f3;text-align:right;">%</th>
              <th style="padding:6px 10px;border:1px solid #ccc;background:#f3f3f3;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>${planRows}</tbody>
        </table>
      ` : '<p style="font-size:12px;color:#666;margin-bottom:18px;">Payment plan: TBD.</p>'}

      <h2 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#666;">Schedule</h2>
      <p style="margin:0 0 24px;font-size:13px;">
        <strong>Start:</strong> ${escapeHtml(fmtDate(startDate))} &nbsp;·&nbsp;
        <strong>End:</strong> ${escapeHtml(fmtDate(endDate))}
      </p>

      <p style="font-size:11px;color:#666;line-height:1.5;margin:0 0 30px;">
        By signing below, the Subcontractor agrees to the scope and terms above and confirms that all work will be performed
        in a workmanlike manner, in compliance with applicable codes, and in coordination with Omega Development LLC.
        Insurance coverage (general liability + workers' comp where applicable) must be current for the duration of the work.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-top:20px;">
        <tr>
          <td style="width:48%;padding-top:30px;">
            <div style="border-top:1px solid #1a1a1a;padding-top:6px;font-size:12px;">
              <strong>Subcontractor</strong> — ${escapeHtml(sub.primary)}<br>
              <span style="color:#666;font-size:11px;">Signature &nbsp;·&nbsp; Date</span>
            </div>
          </td>
          <td style="width:4%;"></td>
          <td style="width:48%;padding-top:30px;">
            <div style="border-top:1px solid #1a1a1a;padding-top:6px;font-size:12px;">
              <strong>Omega Development LLC</strong><br>
              <span style="color:#666;font-size:11px;">Signature &nbsp;·&nbsp; Date</span>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

/**
 * Generate and download a printable PDF of the subcontractor agreement.
 * Used as a fallback when DocuSign is disabled (or as a primary path
 * for crews that prefer wet ink).
 *
 * @param {object} opts
 * @param {object} opts.job
 * @param {object} opts.subcontractor
 * @param {string} opts.scope
 * @param {number} opts.amount
 * @param {Array<{label:string,percent:number}>} opts.paymentPlan
 * @param {string} [opts.startDate]
 * @param {string} [opts.endDate]
 */
export async function downloadSubAgreementPdf(opts) {
  const { subcontractor, job } = opts;
  const html2pdfMod = await import('html2pdf.js');
  const html2pdf = html2pdfMod.default || html2pdfMod;

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.style.width = '816px'; // letter width @ 96dpi-ish; html2pdf rasterizes
  host.innerHTML = buildAgreementHtml(opts);
  document.body.appendChild(host);

  const subName = subDisplayNames(subcontractor).primary;
  const filename = `omega-sub-agreement-${safeFilenamePart(subName)}-${safeFilenamePart(job?.client_name || 'job')}-${todayIso()}.pdf`;

  try {
    await html2pdf()
      .set({
        margin: [0.5, 0.5, 0.6, 0.5],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      })
      .from(host)
      .save();
  } finally {
    host.remove();
  }
}
