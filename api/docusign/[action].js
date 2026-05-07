// /api/docusign/:action  (Vercel dynamic route)
//
// Single Function that fans out to all DocuSign sub-handlers so the whole
// integration counts as ONE serverless function — Vercel Hobby plan caps
// at 12 total.
//
// Routes:
//   POST /api/docusign/create-envelope   → create envelope, return { envelopeId }
//   GET  /api/docusign/envelope-status   → { status, completedAt, history[] }
//   GET  /api/docusign/download          → proxied signed PDF
//   POST /api/docusign/send-reminder     → resend notification to pending signers

import { json, readJson } from '../_lib/http.js';
import { getAccessToken } from '../_lib/docusignAuth.js';
import { INACIO_SIG } from '../_lib/inacioSignature.js';

const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
const BASE_URL   = (process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi').replace(/\/$/, '');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Contract HTML ────────────────────────────────────────────────────────────

function buildContractHtml({ job, estimate, paymentPlan }) {
  const clientName    = job?.client_name    || 'Client';
  const clientAddress = [job?.address, job?.city].filter(Boolean).join(', ');
  const clientPhone   = job?.client_phone   || '';
  const clientEmail   = job?.client_email   || '';
  const serviceType   = job?.service        || '';
  const contractDate  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalAmount   = Number(estimate?.total_amount ?? 0);
  const sections      = Array.isArray(estimate?.sections) ? estimate.sections : [];
  const singlePrice   = estimate?.display_mode === 'single';

  const scopeRows = sections.map(sec => `
    <tr>
      <td colspan="2" style="padding:8px 12px;background:#f5f5f3;font-weight:bold;font-size:13px;
                             text-transform:uppercase;letter-spacing:.04em;">
        ${sec.title || ''}
      </td>
    </tr>
    ${(sec.items || []).map(item => `
      <tr>
        <td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;vertical-align:top;">
          <strong>${item.description || ''}</strong>
          ${item.scope ? `<br><span style="color:#555;font-size:12px;">${item.scope}</span>` : ''}
        </td>
        <td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;
                   text-align:right;white-space:nowrap;vertical-align:top;">
          ${singlePrice ? '' : money(item.price)}
        </td>
      </tr>
    `).join('')}
  `).join('');

  const paymentRows = Array.isArray(paymentPlan) ? paymentPlan.map((p, i) => {
    const pct = p.percent ? `${p.percent}%` : '';
    const amt = p.amount
      ? money(p.amount)
      : p.percent ? money((totalAmount * Number(p.percent)) / 100) : '';
    return `
      <tr>
        <td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;">
          ${p.label || `Payment ${i + 1}`}
        </td>
        <td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;">${pct}</td>
        <td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;text-align:right;">
          ${amt}
        </td>
        <td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #eee;">
          ${p.due_date || p.when || ''}
        </td>
      </tr>
    `;
  }).join('') : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;color:#2C2C2A;margin:0;padding:40px;font-size:13px;}
  h2{font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.05em;
     border-bottom:2px solid #2C2C2A;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;}
  .lbl{color:#6b6b6b;font-weight:bold;width:140px;vertical-align:top;padding:3px 8px 3px 0;font-size:13px;}
  .val{padding:3px 0;font-size:13px;}
  p{font-size:12px;line-height:1.6;color:#333;margin:0 0 10px;}
</style>
</head>
<body>

<!-- Header -->
<table style="margin-bottom:24px;">
  <tr>
    <td>
      <div style="font-size:22px;font-weight:900;letter-spacing:-.01em;">
        OMEGA<span style="color:#E8732A;">DEVELOPMENT</span>
      </div>
      <div style="font-size:10px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;">
        RENOVATIONS &amp; CONSTRUCTION
      </div>
      <div style="font-size:12px;color:#555;margin-top:6px;">
        278 Post Road E, 2nd Floor · Westport, CT 06880
      </div>
    </td>
    <td style="text-align:right;vertical-align:top;">
      <div style="font-size:28px;font-weight:900;">CONTRACT</div>
      <div style="font-size:12px;margin-top:6px;color:#555;">Date: ${contractDate}</div>
    </td>
  </tr>
</table>

<h2>Parties</h2>
<table>
  <tr><td class="lbl">Contractor:</td>
      <td class="val">Omega Development LLC · 278 Post Road E, 2nd Floor, Westport, CT 06880</td></tr>
  <tr><td class="lbl">Owner / Client:</td><td class="val">${clientName}</td></tr>
  <tr><td class="lbl">Client Address:</td><td class="val">${clientAddress}</td></tr>
  ${clientPhone ? `<tr><td class="lbl">Phone:</td><td class="val">${clientPhone}</td></tr>` : ''}
  ${clientEmail ? `<tr><td class="lbl">Email:</td><td class="val">${clientEmail}</td></tr>` : ''}
  <tr><td class="lbl">Project Location:</td><td class="val">${clientAddress}</td></tr>
  ${serviceType ? `<tr><td class="lbl">Service Type:</td><td class="val">${serviceType}</td></tr>` : ''}
</table>

<h2>Schedule A — Scope of Work</h2>
<table>
  ${scopeRows}
  <tr style="background:#2C2C2A;color:white;">
    <td style="padding:10px 12px;font-weight:bold;font-size:14px;">TOTAL CONTRACT AMOUNT</td>
    <td style="padding:10px 12px;font-weight:bold;font-size:14px;text-align:right;">
      ${money(totalAmount)}
    </td>
  </tr>
</table>

<h2>Payment Schedule</h2>
<table>
  <thead>
    <tr style="background:#f5f5f3;">
      <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;">Milestone</th>
      <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;">%</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;">Amount</th>
      <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;">Due When</th>
    </tr>
  </thead>
  <tbody>${paymentRows}</tbody>
</table>

<h2>Terms and Conditions</h2>
<p><strong>1. SCOPE OF WORK.</strong> Contractor will provide all services, materials and labor for the Work
at the Property as outlined in Schedule A. Any additions or changes require a written change order
signed by both parties. No oral modifications shall be binding.</p>

<p><strong>2. PAYMENT.</strong> All payments shall be made payable to Contractor at 278 Post Road E, 2nd Floor,
Westport CT 06880 or to an authorized agent. Owner shall pay each invoice within three (3) days of
receipt. Failure to pay within ten (10) days entitles Contractor to suspend Work. Unpaid amounts
exceeding thirty (30) days accrue interest at 12% per annum.</p>

<p><strong>3. PERMITS.</strong> Contractor shall obtain necessary building permits. Permit costs are not included
in the contract price and shall be paid by Owner.</p>

<p><strong>4. SCHEDULE &amp; UNAVOIDABLE DELAYS.</strong> Contractor shall commence and complete the Work by the
agreed dates, subject to change orders and Unavoidable Delays beyond Contractor's reasonable control
(weather, material shortages, government restrictions, Acts of God, labor disputes, etc.).</p>

<!-- Initials required — Payment &amp; Schedule page -->
<div style="margin-top:24px;padding-top:12px;border-top:2px solid #2C2C2A;display:flex;justify-content:flex-end;align-items:center;gap:12px;">
  <span style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#888;">Owner Initials (Page 2):</span>
  <span style="display:inline-block;width:80px;border-bottom:1.5px solid #333;">&nbsp;</span>
</div>

<p><strong>5. INSURANCE.</strong> Contractor shall maintain general liability insurance valid under Connecticut
law and provide certificates of insurance upon request.</p>

<p><strong>6. SITE ACCESS.</strong> Owner grants free access to work areas and areas for material/debris
storage. Owner provides water and electrical service at no cost to Contractor during performance
of the Work.</p>

<p><strong>7. INSPECTION.</strong> Owner may inspect all Work and shall report defects in writing immediately.
Contractor shall have ten (10) days to advise how and when defects will be remedied.</p>

<p><strong>8. PHOTOS &amp; MARKETING.</strong> Owner grants Contractor permission to photograph and record the
Property for documentation and marketing, limited to the Work and excluding personal identifying
material. Contractor owns all copyrights to photographs taken at the Property.</p>

<p><strong>9. DEFAULT.</strong> Material defaults include: failure to make required payments; insolvency;
failure to provide site access. The non-defaulting party may terminate with 30 days written notice
and opportunity to cure.</p>

<!-- Initials required — Insurance, Access &amp; Default page -->
<div style="margin-top:24px;padding-top:12px;border-top:2px solid #2C2C2A;display:flex;justify-content:flex-end;align-items:center;gap:12px;">
  <span style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#888;">Owner Initials (Page 3):</span>
  <span style="display:inline-block;width:80px;border-bottom:1.5px solid #333;">&nbsp;</span>
</div>

<p><strong>10. INDEMNIFICATION.</strong> Owner shall defend, hold harmless, and indemnify Contractor and its
principals from all claims arising from this Agreement, except those caused solely by Contractor's
intentional misconduct or material breach.</p>

<p><strong>11. FORCE MAJEURE.</strong> Neither party is liable for delays caused by events beyond their
reasonable control. The affected party shall give prompt written notice and resume performance
as soon as practicable.</p>

<!-- Initials required — Remedies &amp; Indemnification page -->
<div style="margin-top:24px;padding-top:12px;border-top:2px solid #2C2C2A;display:flex;justify-content:flex-end;align-items:center;gap:12px;">
  <span style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#888;">Owner Initials (Page 4):</span>
  <span style="display:inline-block;width:80px;border-bottom:1.5px solid #333;">&nbsp;</span>
</div>

<p><strong>12. GOVERNING LAW.</strong> This Agreement is governed by the laws of the State of Connecticut.
Disputes shall be resolved in the courts of Fairfield County, Connecticut.</p>

<p><strong>13. ENTIRE AGREEMENT.</strong> This Agreement constitutes the entire agreement of the parties
and may only be modified by a written instrument signed by both parties.</p>

<!-- Initials required — General Terms page -->
<div style="margin-top:24px;padding-top:12px;border-top:2px solid #2C2C2A;display:flex;justify-content:flex-end;align-items:center;gap:12px;">
  <span style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#888;">Owner Initials (Page 5):</span>
  <span style="display:inline-block;width:80px;border-bottom:1.5px solid #333;">&nbsp;</span>
</div>

<h2>Notice of Cancellation</h2>
<p>You may cancel this contract, without penalty or obligation, within three (3) business days
from the date signed. To cancel, notify Omega Development LLC in writing at the address above
or by email prior to midnight of the third business day.</p>

<h2>Signatures</h2>
<p style="margin-bottom:32px;">By signing below, both parties agree to all terms and conditions of this Agreement.</p>

<table>
  <tr>
    <td style="width:50%;vertical-align:bottom;padding-right:32px;">
      <div style="font-weight:bold;margin-bottom:8px;">CONTRACTOR: Omega Development LLC</div>
      <div style="position:relative;height:52px;">
        <img src="${INACIO_SIG}" alt="Authorized signature" style="height:48px;max-width:220px;object-fit:contain;display:block;" />
      </div>
      <div style="border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555;">
        Authorized Representative &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date
      </div>
    </td>
    <td style="width:50%;vertical-align:bottom;padding-left:32px;">
      <div style="font-weight:bold;margin-bottom:48px;">OWNER / CLIENT: ${clientName}</div>
      <div style="border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555;">
        Owner Signature: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date
      </div>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ─── Subcontractor Agreement HTML ─────────────────────────────────────────────

function buildSubAgreementHtml(data) {
  const subName      = data.sub_name || data.company_name || 'Subcontractor';
  const contactName  = data.contact_name || '';
  const jobAddress   = data.job_address  || data.address || '';
  const scope        = data.scope || data.description || '';
  const totalAmount  = Number(data.their_estimate || data.total_amount || 0);
  const contractDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const paymentPlan  = Array.isArray(data.payment_plan) ? data.payment_plan : [];

  const paymentRows = paymentPlan.map((p, i) => {
    const amt = p.amount
      ? money(p.amount)
      : p.percent ? money((totalAmount * Number(p.percent)) / 100) : '';
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;">
        ${p.label || `Payment ${i + 1}`}
      </td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:right;">
        ${amt}
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;color:#2C2C2A;margin:0;padding:40px;font-size:13px;}
  h2{font-size:14px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.05em;
     border-bottom:2px solid #2C2C2A;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;}
  p{font-size:12px;line-height:1.6;color:#333;margin:0 0 10px;}
</style>
</head>
<body>

<div style="font-size:22px;font-weight:900;margin-bottom:4px;">
  OMEGA<span style="color:#E8732A;">DEVELOPMENT</span>
</div>
<div style="font-size:10px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-bottom:20px;">
  RENOVATIONS &amp; CONSTRUCTION
</div>
<div style="font-size:28px;font-weight:900;margin-bottom:4px;">SUBCONTRACTOR AGREEMENT</div>
<div style="font-size:12px;color:#555;margin-bottom:24px;">Date: ${contractDate}</div>

<h2>Parties</h2>
<p><strong>Contractor:</strong> Omega Development LLC · 278 Post Road E, 2nd Floor, Westport, CT 06880</p>
<p><strong>Subcontractor:</strong> ${subName}${contactName ? ` — Contact: ${contactName}` : ''}</p>
${jobAddress ? `<p><strong>Project Location:</strong> ${jobAddress}</p>` : ''}

<h2>Scope of Work</h2>
<p style="white-space:pre-wrap;">${scope || 'As detailed in the project plans and specifications.'}</p>

<h2>Compensation</h2>
<p><strong>Total Amount:</strong> ${money(totalAmount)}</p>
${paymentRows ? `
<table>
  <thead>
    <tr style="background:#f5f5f3;">
      <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;">Milestone</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;">Amount</th>
    </tr>
  </thead>
  <tbody>${paymentRows}</tbody>
</table>` : ''}

<h2>Terms</h2>
<p>Subcontractor shall perform all Work in a professional manner, in accordance with applicable
building codes, and complete the Work by the agreed schedule. All work is subject to inspection
and approval by Omega Development LLC.</p>
<p>Payment shall be made per the schedule above, contingent on satisfactory completion of each
milestone. Subcontractor is an independent contractor and is responsible for all tools,
equipment, permits, and labor required to complete the Work unless otherwise specified.</p>
<p>This Agreement is governed by the laws of the State of Connecticut.</p>

<h2>Signatures</h2>
<p style="margin-bottom:32px;">By signing below, both parties agree to the terms of this Subcontractor Agreement.</p>

<table>
  <tr>
    <td style="width:50%;vertical-align:bottom;padding-right:32px;">
      <div style="font-weight:bold;margin-bottom:48px;">OMEGA DEVELOPMENT LLC</div>
      <div style="border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555;">
        Authorized Representative &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date
      </div>
    </td>
    <td style="width:50%;vertical-align:bottom;padding-left:32px;">
      <div style="font-weight:bold;margin-bottom:48px;">SUBCONTRACTOR: ${subName}</div>
      <div style="border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555;">
        Owner Signature: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date
      </div>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ─── Sub-handlers ─────────────────────────────────────────────────────────────

async function handleCreateEnvelope(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { kind, job, estimate, paymentPlan, ...rest } = body;

  try {
    const token = await getAccessToken();

    let htmlDoc, signerEmail, signerName, emailSubject, docName;

    if (kind === 'subcontractor_agreement') {
      signerEmail  = rest.sub_email || rest.subcontractor_email || rest.email || '';
      signerName   = rest.sub_name  || rest.company_name || rest.contact_name || 'Subcontractor';
      emailSubject = `Subcontractor Agreement — Omega Development`;
      docName      = 'Subcontractor Agreement.html';
      htmlDoc      = buildSubAgreementHtml(rest);
    } else {
      signerEmail  = job?.client_email || '';
      signerName   = job?.client_name  || 'Client';
      emailSubject = `Your Omega Development Contract — ${job?.service || 'Project'}`;
      docName      = 'Omega Contract.html';
      htmlDoc      = buildContractHtml({ job, estimate, paymentPlan });
    }

    if (!signerEmail) {
      return json(res, 400, {
        error: 'Client email is required to send via DocuSign. Please add the email to the job and try again.',
      });
    }

    const docBase64 = Buffer.from(htmlDoc, 'utf8').toString('base64');

    const envelope = {
      status:       'sent',
      emailSubject,
      documents: [{
        documentBase64: docBase64,
        name:           docName,
        fileExtension:  'html',
        documentId:     '1',
      }],
      recipients: {
        signers: [{
          email:        signerEmail,
          name:         signerName,
          recipientId:  '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [{
              anchorString:  'Owner Signature:',
              anchorXOffset: '140',
              anchorYOffset: '-10',
              anchorUnits:   'pixels',
            }],
            dateSignedTabs: [{
              anchorString:  'Owner Signature:',
              anchorXOffset: '340',
              anchorYOffset: '-10',
              anchorUnits:   'pixels',
            }],
            // One initials tab per important page — client must initial each
            // separately before they can complete the signature.
            initialHereTabs: [
              {
                anchorString:  'Owner Initials (Page 2):',
                anchorXOffset: '160',
                anchorYOffset: '-4',
                anchorUnits:   'pixels',
              },
              {
                anchorString:  'Owner Initials (Page 3):',
                anchorXOffset: '160',
                anchorYOffset: '-4',
                anchorUnits:   'pixels',
              },
              {
                anchorString:  'Owner Initials (Page 4):',
                anchorXOffset: '160',
                anchorYOffset: '-4',
                anchorUnits:   'pixels',
              },
              {
                anchorString:  'Owner Initials (Page 5):',
                anchorXOffset: '160',
                anchorYOffset: '-4',
                anchorUnits:   'pixels',
              },
            ],
          },
        }],
        carbonCopies: [{
          email:        'office@omeganyct.com',
          name:         'Omega Development Office',
          recipientId:  '2',
          routingOrder: '2',
        }],
      },
    };

    const dsRes = await fetch(`${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    if (!dsRes.ok) {
      const text = await dsRes.text();
      console.error('[docusign/create-envelope] error:', text);
      return json(res, dsRes.status, { error: `DocuSign error: ${text}` });
    }

    const { envelopeId } = await dsRes.json();
    return json(res, 200, { envelopeId });

  } catch (err) {
    console.error('[docusign/create-envelope]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}

async function handleEnvelopeStatus(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const envelopeId = new URL(req.url, 'http://x').searchParams.get('envelopeId');
  if (!envelopeId) return json(res, 400, { error: 'Missing envelopeId' });

  try {
    const token = await getAccessToken();

    const [envRes, auditRes] = await Promise.all([
      fetch(`${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/audit_events`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    if (!envRes.ok) {
      const text = await envRes.text();
      return json(res, envRes.status, { error: text });
    }

    const envelope = await envRes.json();

    let history = [];
    if (auditRes.ok) {
      const audit = await auditRes.json();
      history = (audit.auditEvents || []).map(e => {
        const fields = e.eventFields || [];
        const find   = (name) => fields.find(f => f.name === name)?.value || '';
        return { event: find('Action'), timestamp: find('Timestamp'), actor: find('UserName') };
      }).filter(e => e.event);
    }

    return json(res, 200, {
      status:      envelope.status            || 'unknown',
      completedAt: envelope.completedDateTime || null,
      history,
    });

  } catch (err) {
    console.error('[docusign/envelope-status]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}

async function handleDownload(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const envelopeId = new URL(req.url, 'http://x').searchParams.get('envelopeId');
  if (!envelopeId) return json(res, 400, { error: 'Missing envelopeId' });

  try {
    const token = await getAccessToken();

    const dsRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!dsRes.ok) {
      const text = await dsRes.text();
      return json(res, dsRes.status, { error: text });
    }

    const buffer = await dsRes.arrayBuffer();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="signed-contract-${envelopeId}.pdf"`);
    res.end(Buffer.from(buffer));

  } catch (err) {
    console.error('[docusign/download]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}

async function handleSendReminder(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { envelopeId } = body;
  if (!envelopeId) return json(res, 400, { error: 'Missing envelopeId' });

  try {
    const token = await getAccessToken();

    const dsRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/recipients?resend_envelope=true`,
      {
        method:  'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );

    if (!dsRes.ok) {
      const text = await dsRes.text();
      return json(res, dsRes.status, { error: text });
    }

    return json(res, 200, { ok: true });

  } catch (err) {
    console.error('[docusign/send-reminder]', err);
    return json(res, 500, { error: err.message || 'Internal error' });
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = req.query.action;

  if (action === 'create-envelope')  return handleCreateEnvelope(req, res);
  if (action === 'envelope-status')  return handleEnvelopeStatus(req, res);
  if (action === 'download')         return handleDownload(req, res);
  if (action === 'send-reminder')    return handleSendReminder(req, res);

  return json(res, 404, { error: `Unknown DocuSign action: ${action}` });
}
