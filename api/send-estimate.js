// Vercel Function: render an estimate as HTML + email it via Resend.
//
// POST JSON: { estimateId: "<uuid>" }
// Requires server env vars:
//   RESEND_API_KEY                 re_xxx
//   RESEND_FROM                    default "Omega Development <office@omeganyct.com>"
//   SUPABASE_URL                   https://...
//   SUPABASE_SERVICE_ROLE_KEY      service_role key (bypasses RLS)
//   PUBLIC_APP_URL                 e.g. https://omega-unified.vercel.app (used in emails)
//
// The email includes the estimate laid out as styled HTML and a link
// that opens a printable version (`/estimate-view/:id`). The client can
// "Save as PDF" from the browser print dialog — avoids bundling a
// PDF engine in the function.

import { createClient } from '@supabase/supabase-js';
import { requireSecret } from './_lib/requireSecret.js';

const SUPABASE_URL      = process.env.SUPABASE_URL || '';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY    = process.env.RESEND_API_KEY || '';
const RESEND_FROM       = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';
const PUBLIC_APP_URL    = process.env.PUBLIC_APP_URL || 'https://omega-unified.vercel.app';

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
function escapeMultiline(s) {
  return escape(s).replace(/\n/g, '<br>');
}

function renderEstimateHTML({ estimate, job, company, clientLink }) {
  const sections = Array.isArray(estimate.sections) ? estimate.sections : [];
  const total = estimate.total_amount ?? sections.reduce((acc, s) =>
    acc + (s.items || []).reduce((a, it) => a + (Number(it.price) || 0), 0), 0);

  // Summary line — top-level scope titles joined together so the
  // client gets a tasting menu in the email, but the full breakdown
  // only loads after they click "Review Estimate" (which also triggers
  // the open-tracking beacon on the public page).
  const scopeSummary = sections
    .map((s) => s.title)
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');

  const addressBlock = [company?.address, `${company?.city || ''}${company?.city && company?.state ? ', ' : ''}${company?.state || ''} ${company?.zip || ''}`.trim(), company?.phone, company?.email]
    .filter(Boolean).map((l) => `<div>${escape(l)}</div>`).join('');

  // Logo setup for email clients. Must be an absolute URL — relative
  // paths don't work in Gmail/Outlook. Uses the admin-uploaded
  // company.logo_url when available, falling back to the icon shipped
  // in /public/logo.png next to the brand-name text (same layout as
  // the EstimateView header).
  const logoUrl = company?.logo_url || `${PUBLIC_APP_URL.replace(/\/$/, '')}/logo.png`;
  const brandHTML = company?.logo_url
    ? `<img src="${escape(logoUrl)}" alt="${escape(company?.company_name || 'Omega Development')}" height="72" style="display:block;border:0;outline:none;text-decoration:none;height:72px;width:auto;" />`
    : `
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <img src="${escape(logoUrl)}" alt="Omega" width="64" height="64" style="display:block;border:0;outline:none;width:64px;height:64px;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:22px;font-weight:900;color:#2C2C2A;letter-spacing:-0.02em;line-height:1;">
              OMEGA<span style="color:#E8732A;">DEVELOPMENT</span>
            </div>
            <div style="font-size:10px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-top:6px;">RENOVATIONS &amp; CONSTRUCTION</div>
          </td>
        </tr>
      </table>`;

  // Big orange CTA button — the real signature flow lives on the
  // web page (canvas needs a browser). Email clients render JS-free
  // HTML only, so we drop this button at the top AND bottom of the
  // email so the customer can't miss it.
  const signButtonHTML = clientLink ? `
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;">
      <tr>
        <td style="background:#E8732A;border-radius:8px;padding:0;">
          <a href="${escape(clientLink)}" style="display:inline-block;padding:14px 32px;background:#E8732A;color:#ffffff;font-weight:900;font-size:15px;text-decoration:none;border-radius:8px;letter-spacing:.02em;">
            Review Estimate →
          </a>
        </td>
      </tr>
    </table>
  ` : '';

  const customerBlock = [job.client_name, job.address, job.client_phone, job.client_email]
    .filter(Boolean).map((l) => `<div>${escape(l)}</div>`).join('');

  const sectionsHTML = sections.map((sec) => `
    <div style="margin-top:24px;">
      <div style="background:#2C2C2A;color:white;padding:10px 16px;font-size:14px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;text-align:center;">
        ${escape(sec.title || '')}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:1px solid #e5e5e5;background:#fafafa;">
            <th style="text-align:left;padding:8px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;">Description</th>
            <th style="text-align:right;padding:8px 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;width:120px;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${(sec.items || []).map((it) => `
            <tr style="border-bottom:1px solid #f1f1f1;vertical-align:top;">
              <td style="padding:12px;">
                <div style="font-weight:700;color:#2C2C2A;margin-bottom:4px;">${escape(it.description || '')}</div>
                <div style="color:#555;font-size:12px;white-space:pre-line;line-height:1.6;">${escapeMultiline(it.scope || '')}</div>
              </td>
              <td style="padding:12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;color:#2C2C2A;">${money(it.price)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');

  const customerMsgHTML = estimate.customer_message
    ? `<div style="flex:1;background:#fafafa;border:1px solid #eee;padding:16px;border-radius:6px;">
         <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;margin-bottom:8px;font-weight:700;">Customer Message</div>
         <div style="font-size:13px;color:#333;white-space:pre-line;line-height:1.6;">${escape(estimate.customer_message)}</div>
       </div>`
    : '<div style="flex:1;"></div>';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Estimate #${estimate.estimate_number || ''}</title></head>
<body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:780px;margin:0 auto;background:white;padding:32px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">

    <!-- Header: logo + brand on the left, Estimate meta on the right -->
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="vertical-align:top;">
          ${brandHTML}
          <div style="font-size:12px;color:#555;line-height:1.6;margin-top:12px;">${addressBlock}</div>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="font-size:32px;font-weight:900;color:#2C2C2A;">Estimate</div>
          <table style="border-collapse:collapse;margin-top:8px;margin-left:auto;font-size:12px;">
            <tr><td style="padding:3px 8px;color:#6b6b6b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Estimate #</td><td style="padding:3px 8px;font-weight:700;">${escape(estimate.estimate_number || '—')}</td></tr>
            <tr><td style="padding:3px 8px;color:#6b6b6b;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Date</td><td style="padding:3px 8px;">${new Date(estimate.created_at || Date.now()).toLocaleDateString()}</td></tr>
          </table>
        </td>
      </tr>
    </table>


    <!-- Customer + Service Location -->
    <table style="width:100%;border-collapse:collapse;margin-top:24px;">
      <tr>
        <td style="width:50%;padding-right:12px;vertical-align:top;">
          <div style="background:#fafafa;border:1px solid #eee;border-radius:6px;padding:14px;">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;font-weight:700;margin-bottom:8px;">Customer</div>
            <div style="font-size:13px;line-height:1.6;">${customerBlock || '—'}</div>
          </div>
        </td>
        <td style="width:50%;padding-left:12px;vertical-align:top;">
          <div style="background:#fafafa;border:1px solid #eee;border-radius:6px;padding:14px;">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;font-weight:700;margin-bottom:8px;">Service Location</div>
            <div style="font-size:13px;line-height:1.6;">${customerBlock || '—'}</div>
          </div>
        </td>
      </tr>
    </table>

    <!-- Description (optional intro line from the seller) -->
    ${estimate.header_description ? `
    <div style="margin-top:20px;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:14px;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;font-weight:700;margin-bottom:8px;">Description</div>
      <div style="font-size:13px;color:#333;white-space:pre-line;line-height:1.6;">${escape(estimate.header_description)}</div>
    </div>` : ''}

    ${signButtonHTML ? `
    <!-- Dark CTA — the email intentionally does NOT show the line
         items, customer message or total. The client has to open the
         public page to see what was proposed, which fires the open
         tracking beacon and gives Omega visibility into engagement. -->
    <div style="margin-top:32px;padding:24px;background:#2C2C2A;border-radius:8px;text-align:center;">
      <div style="font-size:15px;color:white;font-weight:700;margin-bottom:6px;">
        Your estimate is ready
      </div>
      <div style="font-size:12px;color:#cccccc;margin-bottom:16px;line-height:1.5;">
        Tap below to review the full proposal. You'll see scope, pricing, and our payment schedule on the next screen.
      </div>
      ${signButtonHTML}
    </div>` : ''}

    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center;">
      Questions? Reply to this email or call ${escape(company?.phone || '')}.
    </div>

  </div>
</body></html>`;
}

// Email for a multi-service bundle. Lists each service with its total
// and a single CTA → /estimate-bundle/:bundle_id where the customer
// reviews and signs each proposal independently.
function renderBundleHTML({ bundleMembers, job, company, clientLink }) {
  const customerFirst = (job.client_name || 'there').split(' ')[0];
  const logoUrl = company?.logo_url || `${PUBLIC_APP_URL.replace(/\/$/, '')}/logo.png`;
  const grandTotal = bundleMembers.reduce((s, m) => s + Number(m.total_amount || 0), 0);
  const brandHTML = company?.logo_url
    ? `<img src="${escape(logoUrl)}" alt="${escape(company?.company_name || 'Omega Development')}" height="72" style="display:block;border:0;outline:none;text-decoration:none;height:72px;width:auto;" />`
    : `
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <img src="${escape(logoUrl)}" alt="Omega" width="64" height="64" style="display:block;border:0;outline:none;width:64px;height:64px;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:22px;font-weight:900;color:#2C2C2A;letter-spacing:-0.02em;line-height:1;">
              OMEGA<span style="color:#E8732A;">DEVELOPMENT</span>
            </div>
            <div style="font-size:10px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-top:6px;">RENOVATIONS &amp; CONSTRUCTION</div>
          </td>
        </tr>
      </table>`;

  const rows = bundleMembers.map((m, i) => {
    const label = m.bundle_label || `Proposal ${i + 1}`;
    return `
      <tr>
        <td style="padding:10px 14px;border:1px solid #eee;border-radius:6px;background:#fafafa;margin-bottom:8px;display:block;">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#E8732A;font-weight:700;">Proposal ${i + 1}</div>
          <div style="font-size:16px;font-weight:800;color:#2C2C2A;margin-top:2px;">${escape(label)}</div>
          <div style="font-size:20px;color:#2C2C2A;font-weight:900;margin-top:6px;font-variant-numeric:tabular-nums;">${money(m.total_amount || 0)}</div>
        </td>
      </tr>
      <tr><td style="height:8px;"></td></tr>
    `;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your proposals — ${escape(company?.company_name || 'Omega Development')}</title></head>
<body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">

    ${brandHTML}

    <h1 style="font-size:22px;margin:28px 0 8px;font-weight:900;">Hi ${escape(customerFirst)},</h1>
    <p style="font-size:14px;line-height:1.55;color:#444;margin:0 0 20px;">
      We've put together <strong>${bundleMembers.length} separate proposals</strong> for your project.
      Each one covers a different scope of work — please review and sign whichever ones
      you'd like to move forward with. You can approve any combination independently.
    </p>

    <table style="width:100%;border-collapse:separate;border-spacing:0;margin-bottom:24px;">
      <tbody>${rows}</tbody>
    </table>

    <div style="background:#fafafa;border:1px solid #eee;border-radius:6px;padding:12px 16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:#6b6b6b;font-weight:600;">Combined total (all proposals)</span>
      <span style="font-size:18px;font-weight:900;font-variant-numeric:tabular-nums;">${money(grandTotal)}</span>
    </div>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${clientLink}" style="display:inline-block;padding:14px 28px;background:#E8732A;color:white;font-weight:900;font-size:15px;text-decoration:none;border-radius:8px;letter-spacing:.02em;">
        Review &amp; Sign Proposals
      </a>
    </div>

    <p style="font-size:11px;color:#888;margin:20px 0 0;text-align:center;">
      Each proposal can be signed independently. Signing one does not affect the others.
    </p>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center;">
      Questions? Reply to this email or call ${escape(company?.phone || '')}.
    </div>
  </div>
</body></html>`;
}

// Compact email body for multi-option groups. Instead of rendering N
// full estimates in a single mail (heavy and overwhelming), we list
// the options with totals and drop a single CTA that opens the
// side-by-side picker where the customer compares & signs.
function renderMultiOptionHTML({ siblings, job, company, clientLink }) {
  const customerFirst = (job.client_name || 'there').split(' ')[0];
  const logoUrl = company?.logo_url || `${PUBLIC_APP_URL.replace(/\/$/, '')}/logo.png`;
  const brandHTML = company?.logo_url
    ? `<img src="${escape(logoUrl)}" alt="${escape(company?.company_name || 'Omega Development')}" height="72" style="display:block;border:0;outline:none;text-decoration:none;height:72px;width:auto;" />`
    : `
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <img src="${escape(logoUrl)}" alt="Omega" width="64" height="64" style="display:block;border:0;outline:none;width:64px;height:64px;" />
          </td>
          <td style="vertical-align:middle;">
            <div style="font-size:22px;font-weight:900;color:#2C2C2A;letter-spacing:-0.02em;line-height:1;">
              OMEGA<span style="color:#E8732A;">DEVELOPMENT</span>
            </div>
            <div style="font-size:10px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-top:6px;">RENOVATIONS &amp; CONSTRUCTION</div>
          </td>
        </tr>
      </table>`;
  const rows = (siblings || []).map((s, i) => {
    const label = s.option_label || `Option ${i + 1}`;
    const total = money(s.total_amount || 0);
    return `
      <tr>
        <td style="padding:10px 14px;border:1px solid #eee;border-radius:6px;background:#fafafa;">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#E8732A;font-weight:700;">Option ${i + 1}</div>
          <div style="font-size:16px;font-weight:800;color:#2C2C2A;margin-top:2px;">${escape(label)}</div>
          <div style="font-size:20px;color:#2C2C2A;font-weight:900;margin-top:6px;font-variant-numeric:tabular-nums;">${total}</div>
        </td>
      </tr>
      <tr><td style="height:10px;"></td></tr>
    `;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your estimate options — ${escape(company?.company_name || 'Omega Development')}</title></head>
<body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">

    ${brandHTML}

    <h1 style="font-size:22px;margin:28px 0 8px;font-weight:900;">Hi ${escape(customerFirst)},</h1>
    <p style="font-size:14px;line-height:1.55;color:#444;margin:0 0 20px;">
      We've prepared <strong>${siblings.length} options</strong> for your project so you can pick the scope that fits best.
      Click below to review them side-by-side and sign the one you want to move forward with.
    </p>

    <table style="width:100%;border-collapse:separate;border-spacing:0;margin-bottom:24px;">
      <tbody>${rows}</tbody>
    </table>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${clientLink}" style="display:inline-block;padding:14px 28px;background:#E8732A;color:white;font-weight:900;font-size:15px;text-decoration:none;border-radius:8px;letter-spacing:.02em;">
        View all options &amp; sign
      </a>
    </div>

    <p style="font-size:11px;color:#888;margin:20px 0 0;text-align:center;">
      Once you sign one option, the other alternatives are automatically withdrawn and we'll send the final binding contract via DocuSign.
    </p>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center;">
      Questions? Reply to this email or call ${escape(company?.phone || '')}.
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });

  if (!supabase)        return json(res, 500, { ok: false, error: 'Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).' });
  if (!RESEND_API_KEY)  return json(res, 500, { ok: false, error: 'Resend not configured (RESEND_API_KEY missing).' });

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const estimateId = body?.estimateId;
  if (!estimateId) return json(res, 400, { ok: false, error: 'Missing estimateId' });

  // Route 2: open-tracking beacon. Called from the PUBLIC estimate-view
  // page when the client opens their estimate — no secret required here.
  if (body?.action === 'opened') {
    return handleEstimateOpened(estimateId, res);
  }

  // From here on: internal use only (Brenda / Attila sending an estimate).
  // Require the shared API secret so only the app can trigger email sends.
  if (!requireSecret(req, res)) return;

  // Load estimate + job + company settings in parallel.
  const { data: estimate, error: eErr } = await supabase
    .from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (eErr || !estimate) return json(res, 404, { ok: false, error: 'Estimate not found' });

  const { data: job } = await supabase
    .from('jobs').select('*').eq('id', estimate.job_id).maybeSingle();
  if (!job) return json(res, 404, { ok: false, error: 'Job not found' });

  if (!job.client_email) return json(res, 400, { ok: false, error: 'Client has no email on file' });

  const { data: company } = await supabase
    .from('company_settings').select('*')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  // Check for multi-service bundle first (bundle_id takes precedence).
  // Bundle = multiple estimates for DIFFERENT services, each needing
  // independent approval → /estimate-bundle/:bundle_id.
  let bundleMembers = [];
  if (estimate.bundle_id) {
    const { data: bm } = await supabase
      .from('estimates')
      .select('id, bundle_label, total_amount, status, estimate_number')
      .eq('bundle_id', estimate.bundle_id)
      .order('created_at', { ascending: true });
    bundleMembers = bm || [];
  }
  const isBundle = bundleMembers.length > 1;

  // Check whether this estimate is part of a multi-option group. When
  // the group has >1 row we email a single link to /estimate-options/:id
  // so the customer sees all alternatives side-by-side and picks one
  // via a unified signature block. Single-option estimates keep the
  // existing /estimate-view/:id link (unchanged UX).
  const group_id = estimate.group_id || estimate.id;
  const { data: siblings } = !isBundle ? await supabase
    .from('estimates')
    .select('id, option_label, option_order, status, total_amount')
    .eq('group_id', group_id)
    .order('option_order', { ascending: true }) : { data: [] };
  const isMultiOption = !isBundle && Array.isArray(siblings) && siblings.length > 1;

  const clientLink = isBundle
    ? `${PUBLIC_APP_URL.replace(/\/$/, '')}/estimate-bundle/${estimate.bundle_id}`
    : isMultiOption
      ? `${PUBLIC_APP_URL.replace(/\/$/, '')}/estimate-options/${group_id}`
      : `${PUBLIC_APP_URL.replace(/\/$/, '')}/estimate-view/${estimateId}`;

  const html = isBundle
    ? renderBundleHTML({ bundleMembers, job, company, clientLink })
    : isMultiOption
      ? renderMultiOptionHTML({ siblings, job, company, clientLink })
      : renderEstimateHTML({ estimate, job, company, clientLink });
  const subject = isBundle
    ? `Your ${bundleMembers.length} proposals — ${company?.company_name || 'Omega Development'}`
    : isMultiOption
      ? `Your ${siblings.length} estimate options — ${company?.company_name || 'Omega Development'}`
      : `Estimate #${estimate.estimate_number || ''} — ${company?.company_name || 'Omega Development'}`.trim();
  const requester = {
    role: (req.headers['x-omega-role'] || '').toString(),
    name: (req.headers['x-omega-user'] || '').toString(),
  };

  // Send via Resend REST API (no extra dependency).
  let providerId = null;
  let errorMsg  = null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     RESEND_FROM,
        to:       [job.client_email],
        reply_to: company?.email || undefined,
        subject,
        html,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { errorMsg = data?.message || `Resend HTTP ${r.status}`; }
    else       { providerId = data?.id || null; }
  } catch (err) {
    errorMsg = err?.message || String(err);
  }

  // Write audit row regardless of success.
  try {
    await supabase.from('estimate_emails').insert({
      estimate_id: estimateId,
      job_id: estimate.job_id,
      to_email: job.client_email,
      subject,
      status: providerId ? 'sent' : 'failed',
      provider: 'resend',
      provider_id: providerId,
      error: errorMsg,
      sent_by_name: requester.name || null,
      sent_by_role: requester.role || null,
    });
  } catch { /* ignore */ }

  if (!providerId) return json(res, 500, { ok: false, error: errorMsg || 'Send failed' });

  // On success, stamp `status = 'sent' + sent_at + pdf_url` on every
  // row involved. Bundle stamps all bundle members; multi-option stamps
  // all siblings; single-option touches only its own row.
  const nowIso = new Date().toISOString();
  try {
    if (isBundle) {
      await supabase.from('estimates').update({
        status: 'sent',
        sent_at: nowIso,
        sent_by: requester.name || null,
        pdf_url: clientLink,
      }).eq('bundle_id', estimate.bundle_id);
    } else if (isMultiOption) {
      await supabase.from('estimates').update({
        status: 'sent',
        sent_at: nowIso,
        sent_by: requester.name || null,
        pdf_url: clientLink,
      }).eq('group_id', group_id);
    } else {
      await supabase.from('estimates').update({
        status: 'sent',
        sent_at: nowIso,
        sent_by: requester.name || null,
        pdf_url: `${PUBLIC_APP_URL.replace(/\/$/, '')}/estimate-view/${estimateId}`,
      }).eq('id', estimateId);
    }
  } catch { /* ignore */ }

  return json(res, 200, {
    ok: true, providerId,
    bundle: isBundle, bundleCount: isBundle ? bundleMembers.length : 0,
    multiOption: isMultiOption, optionCount: isMultiOption ? siblings.length : 1,
  });
}

// ─── Estimate-opened beacon ──────────────────────────────────────
// Bumps client_open_count on every hit and stamps client_opened_at
// on the first one. Emails Omega's main inbox the first time the
// client engages with the proposal so the salesperson knows the
// link was opened. Co-located here instead of in its own function
// because Vercel Hobby caps total serverless functions at 12.
function renderOpenedEmailHTML({ estimate, job, openLink }) {
  const total = money(estimate.total_amount || 0);
  const fmtNow = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:560px;margin:0 auto;background:white;padding:24px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#E8732A;font-weight:800;">Estimate opened by client</div>
    <h1 style="font-size:20px;margin:6px 0 16px;font-weight:900;">${escape(job?.client_name || 'Client')} just viewed their proposal</h1>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:6px 0;color:#6b6b6b;width:38%;">Estimate #</td><td style="padding:6px 0;font-weight:700;">${escape(estimate.estimate_number || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#6b6b6b;">Total</td><td style="padding:6px 0;font-weight:700;">${total}</td></tr>
      ${estimate.sent_by ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Sent by</td><td style="padding:6px 0;">${escape(estimate.sent_by)}</td></tr>` : ''}
      ${job?.address ? `<tr><td style="padding:6px 0;color:#6b6b6b;">Project</td><td style="padding:6px 0;">${escape(job.address)}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#6b6b6b;">Opened at</td><td style="padding:6px 0;">${escape(fmtNow)}</td></tr>
    </table>
    <div style="margin-top:20px;text-align:center;">
      <a href="${escape(openLink)}" style="display:inline-block;padding:10px 22px;background:#2C2C2A;color:white;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;letter-spacing:.02em;">
        View the estimate the client saw →
      </a>
    </div>
    <p style="font-size:11px;color:#888;margin:20px 0 0;text-align:center;">
      Heads-up only — no action required. We'll send a follow-up when the client signs.
    </p>
  </div>
</body></html>`;
}

async function handleEstimateOpened(estimateId, res) {
  if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured.' });

  const { data: estimate, error: eErr } = await supabase
    .from('estimates').select('*').eq('id', estimateId).maybeSingle();
  if (eErr || !estimate) return json(res, 404, { ok: false, error: 'Estimate not found' });

  const isFirstOpen = !estimate.client_opened_at;
  const nowIso = new Date().toISOString();
  const patch = {
    client_last_opened_at: nowIso,
    client_open_count: (estimate.client_open_count || 0) + 1,
  };
  if (isFirstOpen) patch.client_opened_at = nowIso;

  try { await supabase.from('estimates').update(patch).eq('id', estimateId); }
  catch { /* non-fatal */ }

  // In-app notification on the FIRST open. Sent to Sales, Operations
  // and Owner so Attila, Brenda (or whoever replaces her) and Inácio
  // all see the bell light up. Done even when Resend isn't configured
  // because the bell doesn't depend on email infrastructure.
  if (isFirstOpen) {
    try {
      const { data: jobLite } = await supabase
        .from('jobs').select('client_name').eq('id', estimate.job_id).maybeSingle();
      const clientName = jobLite?.client_name || 'Your client';
      const baseRow = {
        title: '📬 Client opened estimate',
        message: `${clientName} just viewed the estimate${estimate.estimate_number ? ` (#${estimate.estimate_number})` : ''}.`,
        type: 'estimate',
        job_id: estimate.job_id,
        read: false,
      };
      await supabase.from('notifications').insert([
        { ...baseRow, recipient_role: 'sales' },
        { ...baseRow, recipient_role: 'operations' },
        { ...baseRow, recipient_role: 'owner' },
      ]);
    } catch { /* non-fatal */ }
  }

  if (isFirstOpen && RESEND_API_KEY) {
    try {
      const { data: job } = await supabase.from('jobs').select('*').eq('id', estimate.job_id).maybeSingle();
      const { data: company } = await supabase
        .from('company_settings').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();
      const to = company?.email;
      if (to) {
        const openLink = `${PUBLIC_APP_URL.replace(/\/$/, '')}/estimate-view/${estimateId}`;
        const html = renderOpenedEmailHTML({ estimate, job, openLink });
        const subject = `📬 Estimate opened — ${job?.client_name || 'client'}${estimate.estimate_number ? ` (#${estimate.estimate_number})` : ''}`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
        });
      }
    } catch { /* swallow — best-effort */ }
  }

  return json(res, 200, { ok: true, firstOpen: isFirstOpen, openCount: patch.client_open_count });
}
