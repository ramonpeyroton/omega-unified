// Vercel Function: stamp `client_opened_at` on an estimate and email
// Omega on the FIRST open so the salesperson knows the client engaged
// with the proposal.
//
// Called fire-and-forget from the public /estimate-view/:id page when
// the client lands on it via the email button. No auth — the estimate
// id in the URL is the capability; same model used by the page itself.
//
// POST JSON: { estimateId: "<uuid>" }
//
// Required env vars (same set as send-estimate.js):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY, RESEND_FROM
//   PUBLIC_APP_URL

import { createClient } from '@supabase/supabase-js';

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
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderOpenedEmailHTML({ estimate, job, company, openLink }) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured.' });

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const { estimateId } = body || {};
  if (!estimateId) return json(res, 400, { ok: false, error: 'Missing estimateId' });

  const { data: estimate, error: eErr } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', estimateId)
    .maybeSingle();
  if (eErr || !estimate) return json(res, 404, { ok: false, error: 'Estimate not found' });

  // Bump open counter on every hit; the timestamp tells us "last seen".
  // The notification email below is fired ONLY on the first open so we
  // don't spam Brenda every time the client reopens the link.
  const isFirstOpen = !estimate.client_opened_at;
  const nowIso = new Date().toISOString();
  const patch = {
    client_last_opened_at: nowIso,
    client_open_count: (estimate.client_open_count || 0) + 1,
  };
  if (isFirstOpen) patch.client_opened_at = nowIso;

  try {
    await supabase.from('estimates').update(patch).eq('id', estimateId);
  } catch { /* non-fatal — we still try the email below */ }

  // First-open notification.
  if (isFirstOpen && RESEND_API_KEY) {
    try {
      const { data: job }     = await supabase.from('jobs').select('*').eq('id', estimate.job_id).maybeSingle();
      const { data: company } = await supabase
        .from('company_settings').select('*')
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();

      const to = company?.email;
      if (to) {
        const openLink = `${PUBLIC_APP_URL.replace(/\/$/, '')}/estimate-view/${estimateId}`;
        const html = renderOpenedEmailHTML({ estimate, job, company, openLink });
        const subject = `📬 Estimate opened — ${job?.client_name || 'client'}${estimate.estimate_number ? ` (#${estimate.estimate_number})` : ''}`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [to],
            subject,
            html,
          }),
        });
      }
    } catch { /* swallow — open tracking is best-effort */ }
  }

  return json(res, 200, { ok: true, firstOpen: isFirstOpen, openCount: patch.client_open_count });
}
