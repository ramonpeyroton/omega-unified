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
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false } }
);

const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
const BASE_URL   = (process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi').replace(/\/$/, '');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Subcontractor Agreement HTML ─────────────────────────────────────────────
//
// NOTE: the Owner contract template that used to live here was deleted on
// 2026-05-08 along with the legacy "short" contract bug. The contract HTML
// is now built client-side by ContractTemplate.jsx and sent in the
// create-envelope request body as `html` — that way Brenda's edits and
// the full 11-page legal template both reach DocuSign verbatim. Only the
// subcontractor-agreement template remains here because that flow does
// not have an editable preview yet.

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

  const { kind, job, html, ...rest } = body;

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
      if (!html || typeof html !== 'string') {
        return json(res, 400, {
          error: 'Missing contract HTML in request body. Reload the contract page and try again.',
        });
      }
      // Inácio's pre-signed signature is referenced as a relative URL in
      // the React template; DocuSign's renderer cannot fetch it, so we
      // splice in the base64 data URL server-side.
      htmlDoc = html.replace(/src=["']\/inacio-signature\.png["']/g, `src="${INACIO_SIG}"`);
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
            // The owner contract template (ContractTemplate.jsx) drops two
            // invisible anchor markers — \sign_here_owner\ on the signature
            // line and \sign_date_owner\ on the date line. They render as
            // 8px transparent text so DocuSign's text scanner can find them
            // but they're invisible in the final PDF. The subcontractor
            // template still uses "Owner Signature:" as a visible anchor.
            signHereTabs: [{
              anchorString:  kind === 'subcontractor_agreement' ? 'Owner Signature:' : '\\sign_here_owner\\',
              anchorXOffset: kind === 'subcontractor_agreement' ? '140' : '0',
              anchorYOffset: kind === 'subcontractor_agreement' ? '-10' : '0',
              anchorUnits:   'pixels',
            }],
            dateSignedTabs: [{
              anchorString:  kind === 'subcontractor_agreement' ? 'Owner Signature:' : '\\sign_date_owner\\',
              anchorXOffset: kind === 'subcontractor_agreement' ? '210' : '0',
              anchorYOffset: kind === 'subcontractor_agreement' ? '-10' : '0',
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
    const cause = err?.cause?.code || err?.cause?.message || '';
    console.error('[docusign/create-envelope]', err, cause);
    return json(res, 500, { error: err.message || 'Internal error', cause, account: ACCOUNT_ID ? 'set' : 'MISSING', baseUrl: BASE_URL });
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

async function handleSaveSignedPdf(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const { contractId, envelopeId, jobId } = body;
  if (!contractId || !envelopeId || !jobId) return json(res, 400, { error: 'Missing contractId, envelopeId, or jobId' });

  try {
    // Check if already saved (idempotent)
    const { data: existing } = await supabase
      .from('job_documents')
      .select('id')
      .eq('job_id', jobId)
      .ilike('title', 'Signed Contract%')
      .limit(1);
    if (existing && existing.length > 0) return json(res, 200, { ok: true, skipped: true });

    const token = await getAccessToken();
    const pdfRes = await fetch(
      `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!pdfRes.ok) {
      const text = await pdfRes.text();
      return json(res, pdfRes.status, { error: `DocuSign PDF download failed: ${text}` });
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const date = new Date().toISOString().split('T')[0];
    const path = `${jobId}/contracts/signed-contract-${contractId}-${date}.pdf`;

    const { error: upErr } = await supabase.storage
      .from('job-documents')
      .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
    if (upErr) return json(res, 500, { error: `Storage upload failed: ${upErr.message}` });

    const { data: pub } = supabase.storage.from('job-documents').getPublicUrl(path);
    const publicUrl = pub?.publicUrl || null;

    const signedDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    await supabase.from('job_documents').insert([{
      job_id:      jobId,
      folder:      'contracts',
      title:       `Signed Contract — ${signedDate}`,
      photo_url:   publicUrl,
      uploaded_by: 'DocuSign',
    }]);

    return json(res, 200, { ok: true });
  } catch (err) {
    console.error('[docusign/save-signed-pdf]', err);
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
  if (action === 'save-signed-pdf')  return handleSaveSignedPdf(req, res);

  return json(res, 404, { error: `Unknown DocuSign action: ${action}` });
}
