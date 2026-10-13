// Client purchase lists — server side (migration 088). The app-side rules
// live in src/shared/lib/purchaseLists.js; keep the two in step.
//
//   createDraftForJob   contract signed (docusign-webhook) → draft from the
//                       default template + a bell notification for sales
//   sendPurchaseList    Attila clicks Send (api/send-invoice action
//                       'purchase-list') → SMS from the toll-free number +
//                       email to every client address
//   runPurchaseReminders  Fridays 9am NY (daily-owner-update ?task=reminders,
//                       every 15 min): one reminder per open list per week
//
// Every message to the client ends with the "don't reply" line — the
// toll-free number can't take replies (Ramon, 13/10/26).

import { supabase } from './supabase.js';
import { clientEmails } from './clientEmails.js';

const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://omega-unified.vercel.app').replace(/\/$/, '');
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM    = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';
const OFFICE_PHONE   = '(203) 451-4846';
const NO_REPLY_SMS   = `Please don't reply to this message. Questions? Call or text us at ${OFFICE_PHONE}. Reply STOP to opt out.`;
const NY_TZ = 'America/New_York';

const SERVICE_NAMES = { bathroom: 'bathroom', kitchen: 'kitchen', partialreno: 'renovation', fullreno: 'renovation' };

export function purchaseServices(serviceValue) {
  const ids = String(serviceValue || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const out = new Set();
  for (const id of ids) {
    if (id === 'bathroom' || id === 'bathroom renovation') out.add('bathroom');
    else if (id === 'kitchen' || id === 'kitchen renovation') out.add('kitchen');
    else if (['partialreno', 'fullreno', 'partial renovation', 'full renovation'].includes(id)) { out.add('bathroom'); out.add('kitchen'); }
  }
  return [...out];
}

export const purchaseLink = (listId) => `${PUBLIC_APP_URL}/purchase-list/${listId}`;

function projectName(job) {
  const ids = String(job?.service || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  const names = [...new Set(ids.map((id) => SERVICE_NAMES[id]).filter(Boolean))];
  return names.length ? `${names.join(' and ')} project` : 'project';
}
const firstName = (job) => String(job?.client_name || '').trim().split(/\s+/)[0] || 'there';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toE164(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

// ─── Draft on contract signed ────────────────────────────────────────
export async function createDraftForJob(jobId) {
  if (!supabase || !jobId) return { skipped: 'no db' };
  const { data: job } = await supabase.from('jobs').select('id, client_name, service').eq('id', jobId).maybeSingle();
  const services = purchaseServices(job?.service);
  if (!job || !services.length) return { skipped: 'not a bathroom/kitchen/reno job' };
  const { data: existing } = await supabase.from('purchase_lists').select('id').eq('job_id', jobId).maybeSingle();
  if (existing) return { skipped: 'list exists', listId: existing.id };

  const { data: tpl, error } = await supabase.from('purchase_list_templates')
    .select('*').in('service', services).order('position');
  if (error) return { skipped: `templates: ${error.message}` };
  const seen = new Set();
  const items = [];
  const notices = [];
  for (const svc of services) {
    for (const t of (tpl || []).filter((x) => x.service === svc)) {
      const key = `${t.kind}:${t.label.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (t.kind === 'notice') notices.push(t.label.trim());
      else items.push({ label: t.label.trim(), note: t.note || null });
    }
  }
  const { data: list, error: e2 } = await supabase.from('purchase_lists')
    .insert([{ job_id: jobId, services, notices }]).select().single();
  if (e2) return { skipped: `insert: ${e2.message}` };
  if (items.length) {
    await supabase.from('purchase_list_items').insert(items.map((it, i) => ({ ...it, list_id: list.id, position: i + 1 })));
  }
  await supabase.from('notifications').insert([{
    recipient_role: 'sales', type: 'purchase_list', job_id: jobId, read: false,
    title: `Purchase list ready to review — ${job.client_name || 'client'}`,
    message: 'Review the items the client needs to buy and send the list (Phases tab).',
  }]);
  return { created: list.id, items: items.length };
}

// ─── Messages ────────────────────────────────────────────────────────
async function sendSms(to, body) {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = (process.env.TWILIO_PHONE_NUMBER || '').trim();
  if (!sid || !token || !from) return { ok: false, error: 'Twilio not configured' };
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
    });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, sid: data.sid } : { ok: false, error: data?.message || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e?.message || 'sms failed' };
  }
}

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
    });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: data.id } : { ok: false, error: data?.message || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e?.message || 'email failed' };
  }
}

function smsText(kind, job, items, link) {
  if (kind === 'reminder') {
    const pending = items.filter((i) => i.status !== 'at_house').length;
    return `Hi ${firstName(job)}, a friendly reminder from Omega Development: ${pending} of ${items.length} items on your purchase list aren't at the house yet. Please check and update the list here: ${link}\n\n${NO_REPLY_SMS}`;
  }
  return `Hi ${firstName(job)}, this is Omega Development. Before we start your ${projectName(job)}, please purchase the items on this list and mark each one as you go (ordered or at the house): ${link}\n\n${NO_REPLY_SMS}`;
}

function emailHtml(kind, job, list, items, link) {
  const shown = kind === 'reminder' ? items.filter((i) => i.status !== 'at_house') : items;
  const statusTxt = { not_purchased: 'Not purchased yet', ordered: 'Ordered', at_house: 'At the house' };
  const rows = shown.map((i) => `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid #eee;font-size:14px;color:#2C2C2A;">
          <strong>${esc(i.label)}</strong>${i.note ? `<div style="font-size:12px;color:#6b6b6b;margin-top:2px;">${esc(i.note)}</div>` : ''}
        </td>
        ${kind === 'reminder' ? `<td style="padding:9px 0;border-bottom:1px solid #eee;font-size:12px;color:#8a6d1f;text-align:right;white-space:nowrap;">${esc(statusTxt[i.status] || '')}${i.status === 'ordered' && i.arrives_on ? ` · arrives ${esc(i.arrives_on.slice(5).replace('-', '/'))}` : ''}</td>` : ''}
      </tr>`).join('');
  const notices = (list.notices || []).map((n) => `<li style="margin:4px 0;">${esc(n)}</li>`).join('');
  const intro = kind === 'reminder'
    ? `A friendly reminder: these items on your purchase list aren't at the house yet. Please update each one as soon as it's ordered or delivered.`
    : `Before we start your ${esc(projectName(job))}, please purchase the items below. Open the list and mark each one as you go — <strong>ordered</strong> (with the delivery date) or <strong>at the house</strong>. Anyone with the link sees the same list.`;
  return `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
  <div style="max-width:600px;margin:0 auto;background:white;padding:32px;border-radius:8px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:12px;"><img src="${PUBLIC_APP_URL}/logo.png" alt="Omega" width="56" height="56" style="display:block;width:56px;height:56px;" /></td>
      <td><div style="font-size:20px;font-weight:900;letter-spacing:-0.02em;">OMEGA<span style="color:#E8732A;">DEVELOPMENT</span></div>
          <div style="font-size:10px;font-weight:600;color:#6b6b6b;letter-spacing:.18em;margin-top:5px;">RENOVATIONS &amp; CONSTRUCTION</div></td>
    </tr></table>
    <h1 style="font-size:21px;margin:26px 0 8px;font-weight:900;">Hi ${esc(firstName(job))},</h1>
    <p style="font-size:14px;line-height:1.55;color:#444;margin:0 0 18px;">${intro}</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>
    ${notices && kind !== 'reminder' ? `<div style="margin-top:18px;background:#FFF5EC;border:1px solid #F7D3B5;border-radius:8px;padding:10px 16px;font-size:13px;color:#5a4a3c;"><strong>Please note</strong><ul style="margin:6px 0 0;padding-left:18px;">${notices}</ul></div>` : ''}
    <div style="text-align:center;margin:26px 0 6px;">
      <a href="${link}" style="display:inline-block;padding:14px 28px;background:#E8732A;color:white;font-weight:900;font-size:15px;text-decoration:none;border-radius:8px;">Open your purchase list</a>
    </div>
    <div style="margin-top:28px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#777;text-align:center;line-height:1.5;">
      Please don't reply to this email. Questions? Call or text us at <strong>${OFFICE_PHONE}</strong>.<br/>Omega Development LLC · omeganyct.com
    </div>
  </div></body></html>`;
}

// kind: 'initial' (Attila's Send / Resend) | 'reminder' (Friday cron)
export async function sendPurchaseList(listId, { kind = 'initial', by = null } = {}) {
  if (!supabase) return { ok: false, error: 'no db' };
  const { data: list } = await supabase.from('purchase_lists').select('*').eq('id', listId).maybeSingle();
  if (!list) return { ok: false, error: 'List not found' };
  const [{ data: job }, { data: items }] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', list.job_id).maybeSingle(),
    supabase.from('purchase_list_items').select('*').eq('list_id', listId).order('position'),
  ]);
  if (!job) return { ok: false, error: 'Job not found' };
  if (!items?.length) return { ok: false, error: 'The list has no items' };

  const link = purchaseLink(listId);
  const phone = toE164(job.client_phone);
  const emails = clientEmails(job);
  if (!phone && !emails.length) return { ok: false, error: 'Client has no phone or email on file' };

  const result = { ok: false, sms: null, email: null };
  if (phone) result.sms = await sendSms(phone, smsText(kind, job, items, link));
  if (emails.length) {
    const subject = kind === 'reminder'
      ? 'Reminder: your purchase list — Omega Development'
      : 'Items to purchase before your project — Omega Development';
    result.email = await sendEmail(emails, subject, emailHtml(kind, job, list, items, link));
  }
  result.ok = !!(result.sms?.ok || result.email?.ok);
  if (!result.ok) {
    result.error = [result.sms?.error && `SMS: ${result.sms.error}`, result.email?.error && `Email: ${result.email.error}`].filter(Boolean).join(' · ') || 'Nothing was sent';
    return result;
  }

  const now = new Date().toISOString();
  const patch = kind === 'reminder'
    ? { last_reminder_at: now }
    : { sent_at: list.sent_at || now, sent_by: by || list.sent_by, status: list.status === 'draft' ? 'sent' : list.status, updated_at: now };
  await supabase.from('purchase_lists').update(patch).eq('id', listId);
  await supabase.from('audit_log').insert([{
    user_name: by || 'purchase-lists', user_role: by ? 'team' : 'system',
    action: kind === 'reminder' ? 'purchase_list.reminder' : 'purchase_list.send',
    entity_type: 'job', entity_id: list.job_id,
    details: { list_id: listId, sms: !!result.sms?.ok, email: emails.length ? !!result.email?.ok : null, to_emails: emails },
  }]);
  return result;
}

// ─── Friday 9am reminder ─────────────────────────────────────────────
function nyNow(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { wd: parts.weekday, key: `${parts.year}-${parts.month}-${parts.day}`, hh: Number(parts.hour) % 24 };
}

export async function runPurchaseReminders(nowMs = Date.now()) {
  if (!supabase) return { status: 'no_db' };
  const t = nyNow(nowMs);
  if (t.wd !== 'Fri' || t.hh < 9 || t.hh >= 17) return { status: 'not_now' };
  const { data: lists, error } = await supabase.from('purchase_lists')
    .select('id, sent_at, last_reminder_at').eq('status', 'sent');
  if (error) return { status: 'error', error: error.message };
  const sent = [];
  for (const l of lists || []) {
    // Not the same week it went out, and once per Friday.
    if (!l.sent_at || nowMs - Date.parse(l.sent_at) < 2 * 86_400_000) continue;
    if (l.last_reminder_at && nyNow(Date.parse(l.last_reminder_at)).key === t.key) continue;
    const r = await sendPurchaseList(l.id, { kind: 'reminder' });
    sent.push({ list: l.id, ok: r.ok, error: r.error || null });
  }
  return { status: 'ok', sent };
}
