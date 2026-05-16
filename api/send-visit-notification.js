// Vercel Function: when a sales_visit is scheduled, email the assignee
// AND the client with the visit details. Best-effort — callers don't
// block on the response.
//
// POST JSON: { eventId: "<uuid>" }
// Requires env vars:
//   RESEND_API_KEY, RESEND_FROM
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js';
import { requireSecret } from './_lib/requireSecret.js';

const SUPABASE_URL      = process.env.SUPABASE_URL || '';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_API_KEY    = process.env.RESEND_API_KEY || '';
const RESEND_FROM       = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';
const TZ                = 'America/New_York';

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
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function formatDateCT(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(d);
}
function formatTimeCT(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

function htmlVisitCard({ title, starts, ends, location, notes, recipientGreeting }) {
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
    <div style="max-width:520px;margin:0 auto;background:white;padding:28px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
      <div style="font-size:22px;font-weight:900;color:#E8732A;letter-spacing:-0.02em;">Omega Development</div>
      <p style="margin-top:22px;font-size:15px;color:#333;line-height:1.55;">${escape(recipientGreeting)}</p>

      <div style="margin-top:22px;padding:16px 18px;background:#fafafa;border-left:4px solid #E8732A;border-radius:6px;">
        <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;font-weight:700;">${escape(title)}</div>
        <div style="font-size:20px;font-weight:800;margin-top:6px;">${escape(formatDateCT(starts))}</div>
        <div style="font-size:16px;color:#444;margin-top:4px;">${escape(formatTimeCT(starts))} – ${escape(formatTimeCT(ends))}</div>
        ${location ? `<div style="margin-top:8px;font-size:13px;color:#555;">${escape(location)}</div>` : ''}
        ${notes ? `<div style="margin-top:10px;font-size:13px;color:#555;white-space:pre-line;">${escape(notes)}</div>` : ''}
      </div>

      <p style="margin-top:22px;font-size:13px;color:#777;">Need to reschedule? Reply to this email or call the office.</p>
      <div style="margin-top:22px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#999;">Omega Development LLC · office@omeganyct.com</div>
    </div>
  </body></html>`;
}

async function sendResendEmail({ to, subject, html, replyTo }) {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], reply_to: replyTo || undefined, subject, html }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.message || `HTTP ${r.status}` };
    return { ok: true, id: data?.id };
  } catch (err) { return { ok: false, error: err?.message || String(err) }; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireSecret(req, res)) return;
  if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured' });

  let body;
  try { body = await readJson(req); }
  catch { return json(res, 400, { ok: false, error: 'Invalid JSON' }); }

  const eventId = body?.eventId;
  if (!eventId) return json(res, 400, { ok: false, error: 'Missing eventId' });

  const { data: event, error: eErr } = await supabase
    .from('calendar_events').select('*').eq('id', eventId).maybeSingle();
  if (eErr || !event) return json(res, 404, { ok: false, error: 'Event not found' });

  const starts = new Date(event.starts_at);
  const ends   = new Date(event.ends_at);

  // Load the optional job + company so we can address client/assignee.
  let job = null;
  if (event.job_id) {
    const { data: j } = await supabase.from('jobs').select('*').eq('id', event.job_id).maybeSingle();
    job = j || null;
  }
  const { data: company } = await supabase
    .from('company_settings').select('*')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();

  const results = { emailed: [], failed: [] };

  // Find assignee email — right now we only look at the admin-managed
  // `users` table; if absent, fall back to a hardcoded Attila email if
  // present in company_settings.
  let assigneeEmail = null;
  if (event.assigned_to_name) {
    try {
      const { data: u } = await supabase
        .from('users').select('email').eq('name', event.assigned_to_name).maybeSingle();
      assigneeEmail = u?.email || null;
    } catch { /* users table may not have email col */ }
  }

  if (assigneeEmail) {
    const subject = `New visit booked — ${formatDateCT(starts)}`;
    const greeting = `Hi ${event.assigned_to_name?.split(' ')[0] || 'there'}, a new visit was scheduled for you:`;
    const r = await sendResendEmail({
      to: assigneeEmail, subject, replyTo: company?.email,
      html: htmlVisitCard({
        title: event.title,
        starts, ends,
        location: event.location,
        notes: event.notes,
        recipientGreeting: greeting,
      }),
    });
    (r.ok ? results.emailed : results.failed).push({ to: assigneeEmail, ...r });
  }

  // Client email, if we have one
  if (job?.client_email) {
    const first = (job.client_name || '').split(' ')[0] || 'there';
    const subject = `Your Omega visit is confirmed — ${formatDateCT(starts)}`;
    const greeting = `Hi ${first}, thanks for reaching out. Your Omega visit is confirmed:`;
    const r = await sendResendEmail({
      to: job.client_email, subject, replyTo: company?.email,
      html: htmlVisitCard({
        title: event.title,
        starts, ends,
        location: event.location || job.address,
        notes: null, // don't leak internal notes to the client
        recipientGreeting: greeting,
      }),
    });
    (r.ok ? results.emailed : results.failed).push({ to: job.client_email, ...r });
  }

  return json(res, 200, { ok: true, ...results });
}
