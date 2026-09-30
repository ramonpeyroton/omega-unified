// Vercel Cron Function: nudge the owner once a day to update every
// active project. Runs daily at 1pm UTC (8am EST / 9am EDT).
//
// "Active" = pipeline_status = 'in_progress' (the canonical "work has
// started" status — Brenda flips a job to in_progress only after the
// contract is signed and the deposit has been received). One in-app
// notification is created per active job for the owner; if the owner
// already has a fresh "daily_update_reminder" notification for that
// job from today, the function skips it so the bell doesn't accumulate
// duplicates when the job spans many days.
//
// No email / SMS — Inácio asked for in-app notifications only.
//
// Vercel cron docs: https://vercel.com/docs/cron-jobs
// To restrict access, the function checks the `Authorization: Bearer
// $CRON_SECRET` header that Vercel injects when calling cron paths;
// requests without it are 401'd so nobody can manually hit the URL
// and spam the owner's bell.
//
// The same function also serves ?task= branches (Vercel Hobby caps the
// number of functions): send, login, reminders, lead-alert, daily-summary.
// Unknown tasks get a 404 — they must never fall through to the cron.

import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { pollGmailInvoices } from './_lib/gmailPoller.js';
import { requireSecret } from './_lib/requireSecret.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CRON_SECRET  = process.env.CRON_SECRET || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// ─── Web Push setup (folded into this function to stay under Vercel's
// 12-function Hobby limit; routed by ?task=) ──────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
let vapidReady = false;
let vapidError = null;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    // Trim in case the env values picked up stray whitespace/newlines.
    webpush.setVapidDetails('mailto:notifications@omegadevelopment.app', VAPID_PUBLIC.trim(), VAPID_PRIVATE.trim());
    vapidReady = true;
  } catch (err) {
    vapidError = err?.message || 'invalid VAPID keys';
    console.error('[push] setVapidDetails failed:', vapidError);
  }
}

// Send a push to every subscribed device of the given user names. Prunes dead
// subscriptions (410 Gone / 404). payload = { title, body, url, tag }.
async function sendPushToUsers(userNames, payload) {
  if (!vapidReady || !supabase) return { sent: 0, note: 'push not configured' };
  const names = (Array.isArray(userNames) ? userNames : []).filter(Boolean);
  if (names.length === 0) return { sent: 0 };

  const { data: subs } = await supabase
    .from('user_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_name', names);
  if (!subs || subs.length === 0) return { sent: 0 };

  const body = JSON.stringify(payload);
  const dead = [];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body
      );
      sent++;
    } catch (err) {
      const code = err?.statusCode;
      if (code === 410 || code === 404) dead.push(s.id);
    }
  }));
  if (dead.length) {
    await supabase.from('user_push_subscriptions').delete().in('id', dead);
  }
  return { sent, removed: dead.length };
}

function etTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}
function eventAssignees(ev) {
  if (Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length) return ev.assigned_to_names;
  return ev.assigned_to_name ? [ev.assigned_to_name] : [];
}

// Every active teammate — the audience for both the morning briefing and
// the 2h-before event reminders. Rule from Ramon: everyone sees everything
// so the team can help each other. Admin (hardcoded, never in `users`)
// and the screen kiosk role are excluded defensively.
const EXCLUDED_PUSH_ROLES = new Set(['admin', 'screen']);
async function fetchActiveUserNames() {
  if (!supabase) return [];
  const { data } = await supabase
    .from('users')
    .select('name, role, active')
    .eq('active', true);
  if (!data) return [];
  return data
    .filter((u) => u.name && !EXCLUDED_PUSH_ROLES.has(u.role))
    .map((u) => u.name);
}

// Human-readable label pairs for each calendar_events.kind (see
// migration 037 for the DB constraint, and src/shared/lib/eventCategories.js
// for the UI mirror). Anything that comes back missing a kind falls into
// `sales_visit` (the historic default before migration 037).
const KIND_LABELS = {
  sales_visit: { singular: 'sales visit',  plural: 'sales visits'  },
  job_start:   { singular: 'job start',    plural: 'job starts'    },
  service_day: { singular: 'service day',  plural: 'service days'  },
  inspection:  { singular: 'inspection',   plural: 'inspections'   },
  meeting:     { singular: 'meeting',      plural: 'meetings'      },
  media_visit: { singular: 'media visit',  plural: 'media visits'  },
};
const KIND_ORDER = ['sales_visit', 'job_start', 'service_day', 'inspection', 'meeting', 'media_visit'];

// "2 sales visits" / "1 inspection" / …
function labelForCount(kind, n) {
  const l = KIND_LABELS[kind] || { singular: kind, plural: `${kind}s` };
  return `${n} ${n === 1 ? l.singular : l.plural}`;
}

// Join a list with commas + "and" before the last item.
// ["A"]            → "A"
// ["A","B"]        → "A and B"
// ["A","B","C"]    → "A, B and C"
function joinWithAnd(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// 2h-before reminders. Window [now+105min, now+120min) matches the 15-min cron
// cadence; reminder_sent_at dedupes so each event fires once.
// Every active teammate gets every reminder — visibility across the team.
async function sendEventReminders() {
  if (!vapidReady || !supabase) return { reminded: 0 };
  const now = Date.now();
  const start = new Date(now + 105 * 60 * 1000).toISOString();
  const end   = new Date(now + 120 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, title, starts_at, location, job_id, kind')
    .is('reminder_sent_at', null)
    .gte('starts_at', start)
    .lt('starts_at', end);
  if (!events || events.length === 0) return { reminded: 0 };

  const recipients = await fetchActiveUserNames();

  let reminded = 0;
  for (const ev of events) {
    if (recipients.length) {
      const locLine = ev.location ? ` · ${ev.location}` : '';
      await sendPushToUsers(recipients, {
        title: `⏰ In 2h · ${ev.title}`,
        body:  `${etTime(ev.starts_at)}${locLine}`,
        url:   ev.job_id ? `/jobs/${ev.job_id}?tab=daily` : '/calendar',
        tag:   `event-${ev.id}`,
      });
      reminded++;
    }
    // Always mark as sent so a missing recipient list doesn't cause a
    // replay on the next 15-min tick.
    await supabase.from('calendar_events')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', ev.id);
  }
  return { reminded };
}

// Start-of-day summary: ONE push, same text, to every active teammate.
// Body aggregates events by kind ("2 sales visits and 1 job start") so
// the team scans the day in a single glance. No events for today →
// nothing is sent (Ramon: silence means light day).
async function sendDailySummaries() {
  if (!vapidReady || !supabase) return { summaries: 0 };
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('calendar_events')
    .select('kind, starts_at')
    .gte('starts_at', now.toISOString())
    .lt('starts_at', horizon);
  if (!events || events.length === 0) return { summaries: 0 };

  const todayET = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const todays = events.filter(
    (e) => new Date(e.starts_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === todayET
  );
  if (todays.length === 0) return { summaries: 0 };

  // Count by kind, then walk KIND_ORDER so the phrase is stable
  // regardless of DB ordering (visits first, media last).
  const counts = {};
  for (const e of todays) {
    const k = KIND_LABELS[e.kind] ? e.kind : 'sales_visit';
    counts[k] = (counts[k] || 0) + 1;
  }
  const parts = KIND_ORDER
    .filter((k) => counts[k])
    .map((k) => labelForCount(k, counts[k]));
  if (parts.length === 0) return { summaries: 0 };

  const recipients = await fetchActiveUserNames();
  if (recipients.length === 0) return { summaries: 0 };

  await sendPushToUsers(recipients, {
    title: '☀️ Good morning',
    body:  `Today we have: ${joinWithAnd(parts)}.`,
    url:   '/calendar',
    tag:   'daily-summary',
  });
  return { summaries: recipients.length };
}

// ═══ Lead alerts + 7pm owner summary (migration 078) ═════════════════
// ?task=lead-alert     POST { job_id, kind: 'new' | 'repeat', skip_user? }
//                      → web push to the salesperson (English) + WhatsApp
//                        template / email to the owner & Ramon (Portuguese).
// ?task=daily-summary  ?dry=1 returns the text · ?force=1 sends right now.
// maybeSendDailySummary() also runs at the end of ?task=reminders (GitHub
// cron, every 15 min) and sends once per New York day, after 19:00.
//
// WhatsApp business messages must use pre-approved templates (ContentSid +
// ContentVariables). Twilio can accept a message and only fail it seconds
// later, which we'd never see here — so until WHATSAPP_LIVE=1 the email
// ALWAYS goes out as well. After that, email only when WhatsApp isn't
// configured or a send fails right away.

const TZ = 'America/New_York';
const APP_URL = (process.env.APP_URL || 'https://omega-unified.vercel.app').replace(/\/+$/, '');
const TWILIO_SID   = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const WA_FROM_RAW  = (process.env.TWILIO_WHATSAPP_FROM || '').trim();
const WA_FROM      = WA_FROM_RAW && !WA_FROM_RAW.startsWith('whatsapp:') ? `whatsapp:${WA_FROM_RAW}` : WA_FROM_RAW;
const WA_TEMPLATE = {
  new:     (process.env.TWILIO_WA_TPL_NEW_LEAD || '').trim(),
  repeat:  (process.env.TWILIO_WA_TPL_REPEAT_LEAD || '').trim(),
  summary: (process.env.TWILIO_WA_TPL_DAILY_SUMMARY || '').trim(),
};
const WHATSAPP_LIVE  = /^(1|true|yes)$/i.test((process.env.WHATSAPP_LIVE || '').trim());
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM    = process.env.RESEND_FROM || 'Omega Development <office@omeganyct.com>';
// Per external call — keeps a whole alert well inside the function limit.
const EXTERNAL_TIMEOUT_MS = 4500;

// Bulk imports never alert and never count as "new leads" (Import Leads →
// 'import', legacy files importer → 'legacy_import').
const BULK_IMPORT_CREATORS = new Set(['import', 'legacy_import']);

// Portuguese names for lead sources (WhatsApp / email / summary).
const SOURCE_PT = {
  'Houzz':          'Houzz',
  'Local Services': 'Local Services',
  'Google Ads':     'Google Ads',
  'Website':        'Site',
  'Called In':      'Ligou direto',
  'Referral':       'Indicação',
  'Repeat Client':  'Cliente antigo',
  'Drove By':       'Passou na frente',
  'Other':          'Outro',
};

// Service labels — English matches src/shared/data/services.js (keep in
// sync), Portuguese for the owner's messages.
const SERVICE_EN = {
  bathroom: 'Bathroom Renovation', kitchen: 'Kitchen Renovation', deck: 'Deck / Patio',
  addition: 'Home Addition', roofing: 'Roofing', driveway: 'Driveway',
  basement: 'Basement Finishing', flooring: 'Flooring', survey: 'Survey',
  building_plans: 'Building Plans', partialreno: 'Partial Renovation',
  fullreno: 'Full Renovation', newconstruction: 'New Construction',
};
const SERVICE_PT = {
  bathroom: 'Reforma de banheiro', kitchen: 'Reforma de cozinha', deck: 'Deck / Pátio',
  addition: 'Ampliação', roofing: 'Telhado', driveway: 'Driveway',
  basement: 'Acabamento de porão', flooring: 'Piso', survey: 'Survey',
  building_plans: 'Projeto (plantas)', partialreno: 'Reforma parcial',
  fullreno: 'Reforma completa', newconstruction: 'Construção nova',
};

// Pipeline stages in Portuguese (returning-lead template).
const STAGE_PT = {
  new_lead: 'Novo lead', contacted: 'Contatado', visit_scheduled: 'Visita agendada',
  visited: 'Visitado', estimate_draft: 'Estimate em rascunho', estimate_sent: 'Estimate enviado',
  estimate_negotiating: 'Em negociação', estimate_approved: 'Estimate aprovado',
  contract_sent: 'Contrato enviado', contract_signed: 'Contrato assinado',
  in_progress: 'Em andamento', completed: 'Concluído', disqualified: 'Desqualificado',
  estimate_rejected: 'Perdido',
};

function envList(name, fallback = '') {
  return (process.env[name] || fallback).split(',').map((s) => s.trim()).filter(Boolean);
}

function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.length > 8 ? digits : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const maskPhone = (p) => (p ? `…${String(p).slice(-4)}` : p);
const maskEmail = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');
const flagOn = (v) => /^(1|true|yes)$/i.test(String(v || '').trim());

// A template variable must be a non-empty, single-line string.
function tplVar(v, max = 120) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : '—';
}

function readBody(req) {
  let p = req.body;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
  return p && typeof p === 'object' ? p : {};
}

// ─── Secrets ─────────────────────────────────────────────────────────
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function givenSecret(req) {
  return (req.headers['x-omega-secret'] || '').toString().trim();
}
// Strict guard for lead-alert / daily-summary: x-omega-secret must equal
// OMEGA_API_SECRET (the app's — also shipped in the browser bundle) or
// WEBSITE_LEAD_SECRET (server-only, used by the website). Unlike
// requireSecret(), this REJECTS when neither is configured.
function requireStrictSecret(req, res) {
  const accepted = [process.env.OMEGA_API_SECRET, process.env.WEBSITE_LEAD_SECRET]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  if (accepted.length === 0) {
    json(res, 503, { ok: false, error: 'No API secret configured on the server' });
    return false;
  }
  const given = givenSecret(req);
  if (given && accepted.some((s) => safeEqual(given, s))) return true;
  json(res, 401, { ok: false, error: 'Unauthorized' });
  return false;
}

// ─── Lead fields ─────────────────────────────────────────────────────
function sourcePt(src) {
  const s = (src || '').trim();
  return s ? (SOURCE_PT[s] || s) : 'Sem origem';
}

// jobs.service is a comma-separated list of ids (NewJob / website) with
// extras in additional_services (NewLead). Old rows may hold labels.
function serviceIds(job) {
  const byLabel = Object.fromEntries(Object.entries(SERVICE_EN).map(([id, label]) => [label.toLowerCase(), id]));
  const tokens = String(job.service || '').split(',').map((t) => t.trim()).filter(Boolean);
  const extra = Array.isArray(job.additional_services) ? job.additional_services : [];
  return [...new Set([...tokens, ...extra].map((t) => byLabel[String(t).toLowerCase()] || t))];
}

function cityOf(job) {
  if ((job.city || '').trim()) return job.city.trim();
  const parts = String(job.address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2) return parts[1].replace(/\s+[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/, '').trim();
  return '';
}

function leadFields(job, sourceOverride = '') {
  const src = (sourceOverride || job.lead_source || '').trim();
  const isLocalServices = src === 'Local Services';
  const name = (job.client_name || '').trim();
  const ids = serviceIds(job);
  const digits = last10(job.client_phone);
  return {
    sourceEn:  src || 'No source',
    sourcePt:  sourcePt(src),
    nameEn:    name || (isLocalServices ? 'Local Services client' : 'No name'),
    namePt:    name || (isLocalServices ? 'Cliente do Local Services' : '—'),
    serviceEn: ids.map((s) => SERVICE_EN[s] || s).join(', ') || '—',
    servicePt: ids.map((s) => SERVICE_PT[s] || s).join(', ') || '—',
    city:      cityOf(job) || '—',
    phonePt:   digits.length === 10
      ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
      : (isLocalServices ? 'ver no app' : ((job.client_phone || '').trim() || '—')),
    stagePt:   STAGE_PT[job.pipeline_status] || job.pipeline_status || '—',
  };
}

// Same text as the omega_novo_lead / omega_lead_retorno templates.
function newLeadLines(f) {
  return [
    `🔔 Novo lead recebido pela origem ${f.sourcePt}.`,
    `Cliente: ${f.namePt}`,
    `Serviço: ${f.servicePt}`,
    `Cidade: ${f.city}`,
    `Telefone: ${f.phonePt}`,
    'Abra o app da Omega para ver os detalhes.',
  ];
}
function repeatLeadLines(f) {
  return [
    `🔁 Um cliente que já está no sistema voltou a entrar em contato pela origem ${f.sourcePt}.`,
    `Cliente: ${f.namePt}`,
    `Etapa atual: ${f.stagePt}`,
    'Abra o app da Omega para ver os detalhes.',
  ];
}

// ─── Senders ─────────────────────────────────────────────────────────
function whatsappConfigured(template) {
  return !!(TWILIO_SID && TWILIO_TOKEN && WA_FROM && template);
}

async function sendWhatsAppTemplate(toE164Number, contentSid, variables) {
  const form = new URLSearchParams();
  form.set('From', WA_FROM);
  form.set('To', `whatsapp:${toE164Number}`);
  form.set('ContentSid', contentSid);
  form.set('ContentVariables', JSON.stringify(variables));
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.status === 'failed' || data?.status === 'undelivered') {
      return {
        ok: false,
        error: data?.message || `Twilio HTTP ${r.status}`,
        code: data?.code || data?.error_code || null,
        sid: data?.sid || null,
      };
    }
    return { ok: true, sid: data?.sid || null, status: data?.status || 'queued' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function sendWhatsAppBatch(numbers, template, variables, text, logBase) {
  const vars = Object.fromEntries(variables.map((v, i) => [String(i + 1), tplVar(v)]));
  return Promise.all(numbers.map(async (to) => {
    const r = await sendWhatsAppTemplate(to, template, vars);
    await logMessage({ ...logBase, channel: 'whatsapp', to: `whatsapp:${to}`, body: text, result: r });
    return { to: maskPhone(to), ...r };
  }));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailHtml(lines, link) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2C2C2A;">
    <div style="max-width:520px;margin:0 auto;background:#fff;padding:24px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.05);">
      <div style="font-size:20px;font-weight:900;color:#E8732A;letter-spacing:-0.02em;">Omega Development</div>
      <div style="margin-top:16px;font-size:15px;line-height:1.6;">${lines.map(escapeHtml).join('<br>')}</div>
      ${link ? `<p style="margin-top:20px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#E8732A;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Abrir no app</a></p>` : ''}
    </div>
  </body></html>`;
}

async function sendEmail(toList, subject, html, text) {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  if (!toList.length) return { ok: false, error: 'LEAD_ALERT_EMAIL_TO not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to: toList, subject, html, text }),
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.message || `Resend HTTP ${r.status}` };
    return { ok: true, id: data?.id || null };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function sendEmailLogged(toList, subject, lines, link, reason, logBase) {
  const text = lines.join('\n') + (link ? `\n\n${link}` : '');
  const r = await sendEmail(toList, subject, emailHtml(lines, link), text);
  const targets = toList.length ? toList : ['(LEAD_ALERT_EMAIL_TO not set)'];
  await Promise.all(targets.map((addr) => logMessage({
    ...logBase, channel: 'email', to: addr, body: `${subject}\n\n${lines.join('\n')}`, result: r,
  })));
  return { to: toList.map(maskEmail), reason, ...r };
}

// One message_log row per send attempt. Never throws — logging must not
// break a send (and before migration 078 the email/push rows are refused
// by the old channel check; that's fine).
async function logMessage({ channel, to, body, result, jobId = null, kind }) {
  if (!supabase) return;
  try {
    const queued = ['queued', 'accepted', 'scheduled', 'sending'].includes(result?.status);
    await supabase.from('message_log').insert({
      channel,
      to_number: String(to || '—').slice(0, 200),
      body: String(body || '—').slice(0, 4000),
      provider_sid: result?.sid || result?.id || null,
      status: result?.ok ? (queued ? 'queued' : 'sent') : 'failed',
      error: result?.ok ? null : [result?.code, result?.error].filter(Boolean).join(': ') || 'failed',
      job_id: jobId,
      kind,
      requested_by_name: 'system',
    });
  } catch { /* non-fatal */ }
}

// WhatsApp numbers minus the lead's creator (matched on users.phone), so
// whoever typed the lead in doesn't get a WhatsApp about it.
async function whatsappRecipients(list, skipUser) {
  const numbers = [...new Set(list.map(toE164).filter(Boolean))];
  const skip = (skipUser || '').trim().toLowerCase();
  if (!skip || !supabase) return numbers;
  try {
    const { data } = await supabase.from('users').select('name, username, phone');
    const creator = (data || []).find((u) =>
      [u.name, u.username].some((v) => (v || '').trim().toLowerCase() === skip));
    const creatorPhone = last10(creator?.phone);
    if (creatorPhone.length === 10) return numbers.filter((n) => last10(n) !== creatorPhone);
  } catch { /* keep everyone */ }
  return numbers;
}

// ─── Lead alert ──────────────────────────────────────────────────────
async function sendLeadAlert(job, kind, { skipUser = '', sourceOverride = '' } = {}) {
  const f = leadFields(job, sourceOverride);
  const logBase = { jobId: job.id, kind: 'lead_alert' };

  // 1. Web push → salesperson (English), deep link to the card.
  const skip = (skipUser || '').trim().toLowerCase();
  const pushUsers = envList('LEAD_ALERT_PUSH_USERS', 'Attila Dasilva')
    .filter((n) => n.toLowerCase() !== skip);
  const push = {
    title: `${kind === 'repeat' ? 'Returning lead' : 'New lead'} — ${f.sourceEn}`,
    body:  [f.nameEn, f.serviceEn, f.city].join(' · '),
    url:   `/jobs/${job.id}`,
    tag:   `lead-${job.id}`,
  };
  const pushTask = Promise.all(pushUsers.map(async (name) => {
    let r;
    try { r = await sendPushToUsers([name], push); }
    catch (err) { r = { sent: 0, error: err?.message }; }
    const result = r?.sent > 0
      ? { ok: true }
      : { ok: false, error: r?.error || r?.note || 'no active push subscription' };
    await logMessage({ ...logBase, channel: 'push', to: name, body: `${push.title}\n${push.body}`, result });
    return { to: name, devices: r?.sent || 0, ...result };
  }));

  // 2. WhatsApp → owner, Ramon, salesperson (Portuguese template).
  const lines = kind === 'repeat' ? repeatLeadLines(f) : newLeadLines(f);
  const template = kind === 'repeat' ? WA_TEMPLATE.repeat : WA_TEMPLATE.new;
  const variables = kind === 'repeat'
    ? [f.sourcePt, f.namePt, f.stagePt]
    : [f.sourcePt, f.namePt, f.servicePt, f.city, f.phonePt];
  const waTo = await whatsappRecipients(envList('LEAD_ALERT_WHATSAPP_TO'), skipUser);
  const waReady = whatsappConfigured(template) && waTo.length > 0;
  const waTask = waReady
    ? sendWhatsAppBatch(waTo, template, variables, lines.join('\n'), logBase)
    : Promise.resolve([]);

  // 3. Email → always while WhatsApp isn't live, afterwards as fallback.
  const subject = kind === 'repeat'
    ? `🔁 Cliente voltou (${f.sourcePt}): ${f.namePt}`
    : `🔔 Novo lead (${f.sourcePt}): ${f.namePt}`;
  const sendMail = (reason) =>
    sendEmailLogged(envList('LEAD_ALERT_EMAIL_TO'), subject, lines, `${APP_URL}/jobs/${job.id}`, reason, logBase);
  let emailTask = null;
  if (!waReady) emailTask = sendMail('whatsapp_not_configured');
  else if (!WHATSAPP_LIVE) emailTask = sendMail('whatsapp_not_live');

  const [pushRes, waRes] = await Promise.all([pushTask, waTask]);
  let emailRes = emailTask ? await emailTask : null;
  if (!emailRes && waRes.some((w) => !w.ok)) emailRes = await sendMail('whatsapp_failed');

  return { whatsapp_live: WHATSAPP_LIVE, push: pushRes, whatsapp: waRes, email: emailRes };
}

// ─── Daily summary (7pm New York) ────────────────────────────────────
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PT_WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
function nyParts(ms) {
  const o = {};
  for (const p of nyFormatter.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mi: +o.minute, wd: EN_WEEKDAYS.indexOf(o.weekday) };
}
const pad2 = (n) => String(n).padStart(2, '0');

// UTC instant of a New York wall-clock time. Iterates on the real offset
// (EST/EDT) instead of assuming one — no hardcoded UTC hour anywhere.
function nyWallTimeToUtc(y, m, d, hh = 0, mi = 0) {
  const target = Date.UTC(y, m - 1, d, hh, mi);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(t);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi) - target;
    if (diff === 0) break;
    t -= diff;
  }
  return t;
}

function nyDaysBetween(fromIso, toMs) {
  const a = nyParts(new Date(fromIso).getTime());
  const b = nyParts(toMs);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// All numbers straight from the database (no AI). Window = today 00:00
// New York → now.
async function computeDailySummary(nowMs = Date.now()) {
  const p = nyParts(nowMs);
  const startIso = new Date(nyWallTimeToUtc(p.y, p.m, p.d)).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  // a) New leads today, bulk imports excluded, grouped by source.
  const { data: created, error: e1 } = await supabase
    .from('jobs')
    .select('lead_source, created_by')
    .gte('created_at', startIso)
    .lte('created_at', nowIso);
  if (e1) throw e1;
  const leads = (created || []).filter((j) => !BULK_IMPORT_CREATORS.has((j.created_by || '').trim()));
  const bySource = {};
  for (const j of leads) {
    const k = sourcePt(j.lead_source);
    bySource[k] = (bySource[k] || 0) + 1;
  }
  const breakdown = Object.entries(bySource)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ') || 'nenhum';

  // b) Visits done today = distinct jobs moved to Visited today.
  const { data: visitEvents, error: e2 } = await supabase
    .from('job_stage_events')
    .select('job_id')
    .eq('to_status', 'visited')
    .gte('changed_at', startIso)
    .lte('changed_at', nowIso);
  if (e2) throw e2;
  const visitsToday = new Set((visitEvents || []).map((e) => e.job_id)).size;

  // c) Visited but still waiting for an estimate + the oldest one.
  const { data: waiting, error: e3 } = await supabase
    .from('jobs')
    .select('id, stage_entered_at')
    .eq('in_pipeline', true)
    .in('pipeline_status', ['visited', 'estimate_draft']);
  if (e3) throw e3;
  let oldest = '—';
  if (waiting?.length) {
    const lastVisit = {};
    const ids = waiting.map((j) => j.id);
    for (let i = 0; i < ids.length; i += 150) {
      const { data: ev } = await supabase
        .from('job_stage_events')
        .select('job_id, changed_at')
        .eq('to_status', 'visited')
        .in('job_id', ids.slice(i, i + 150));
      for (const e of ev || []) {
        if (!lastVisit[e.job_id] || e.changed_at > lastVisit[e.job_id]) lastVisit[e.job_id] = e.changed_at;
      }
    }
    let oldestAt = null;
    for (const j of waiting) {
      const t = lastVisit[j.id] || j.stage_entered_at;
      if (t && (!oldestAt || new Date(t) < new Date(oldestAt))) oldestAt = t;
    }
    if (oldestAt) {
      const days = nyDaysBetween(oldestAt, nowMs);
      oldest = days <= 0 ? 'hoje' : days === 1 ? 'há 1 dia' : `há ${days} dias`;
    }
  }

  return {
    summary_date:     `${p.y}-${pad2(p.m)}-${pad2(p.d)}`,
    date:             `${PT_WEEKDAYS[p.wd] || ''}, ${pad2(p.d)}/${pad2(p.m)}`,
    new_leads:        leads.length,
    breakdown,
    visits_today:     visitsToday,
    waiting_estimate: waiting?.length || 0,
    oldest_waiting:   oldest,
  };
}

// Same text as the omega_resumo_diario template.
function summaryLines(s) {
  return [
    `📊 Resumo do dia ${s.date} na Omega.`,
    `Leads novos: ${s.new_leads} (${s.breakdown})`,
    `Visitas feitas hoje: ${s.visits_today}`,
    `Visitados aguardando estimate: ${s.waiting_estimate} (mais antigo: ${s.oldest_waiting})`,
    'Até amanhã!',
  ];
}

// Owner + Ramon only (DAILY_SUMMARY_WHATSAPP_TO) — the salesperson never
// gets the summary. Email fallback goes to LEAD_ALERT_EMAIL_TO.
async function sendDailyOwnerSummary(s, { forced = false } = {}) {
  const logBase = { jobId: null, kind: 'daily_summary' };
  const lines = summaryLines(s);
  const variables = [s.date, s.new_leads, s.breakdown, s.visits_today, s.waiting_estimate, s.oldest_waiting];
  const waTo = [...new Set(envList('DAILY_SUMMARY_WHATSAPP_TO').map(toE164).filter(Boolean))];
  const waReady = whatsappConfigured(WA_TEMPLATE.summary) && waTo.length > 0;
  const subject = `${forced ? '[TESTE] ' : ''}📊 Resumo do dia ${s.date} — Omega`;
  const sendMail = (reason) =>
    sendEmailLogged(envList('LEAD_ALERT_EMAIL_TO'), subject, lines, APP_URL, reason, logBase);

  let emailTask = null;
  if (!waReady) emailTask = sendMail('whatsapp_not_configured');
  else if (!WHATSAPP_LIVE) emailTask = sendMail('whatsapp_not_live');
  const waRes = waReady
    ? await sendWhatsAppBatch(waTo, WA_TEMPLATE.summary, variables, lines.join('\n'), logBase)
    : [];
  let emailRes = emailTask ? await emailTask : null;
  if (!emailRes && waRes.some((w) => !w.ok)) emailRes = await sendMail('whatsapp_failed');

  return { whatsapp_live: WHATSAPP_LIVE, whatsapp: waRes, email: emailRes };
}

// Runs every 15 min from ?task=reminders. Sends only when it's 19:00 or
// later in New York AND today's row doesn't exist yet. The day is claimed
// FIRST (insert … on conflict do nothing) so two overlapping runs can
// never both send.
async function maybeSendDailySummary(nowMs = Date.now()) {
  if (!supabase) return { status: 'skipped' };
  const p = nyParts(nowMs);
  if (p.hh < 19) return { status: 'not_yet' };
  const summaryDate = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;

  const { data: claimed, error: claimErr } = await supabase
    .from('daily_summary_log')
    .upsert({ summary_date: summaryDate }, { onConflict: 'summary_date', ignoreDuplicates: true })
    .select('summary_date');
  // No claim, no send — e.g. migration 078 not applied yet.
  if (claimErr) return { status: 'error', error: claimErr.message };
  if (!claimed || claimed.length === 0) return { status: 'already_sent' };

  let summary;
  try {
    summary = await computeDailySummary(nowMs);
  } catch (err) {
    // Nothing was sent: release the claim so the next run retries.
    await supabase.from('daily_summary_log').delete().eq('summary_date', summaryDate);
    return { status: 'error', error: err?.message || 'summary failed' };
  }
  const results = await sendDailyOwnerSummary(summary);
  await supabase
    .from('daily_summary_log')
    .update({ sent_at: new Date().toISOString(), payload: { ...summary, text: summaryLines(summary).join('\n'), results } })
    .eq('summary_date', summaryDate);
  return { status: 'sent' };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// First public IP from x-forwarded-for (Vercel appends the client IP).
function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').toString();
  if (xff) return xff.split(',')[0].trim();
  return (req.headers['x-real-ip'] || req.socket?.remoteAddress || '').toString() || null;
}

// Vercel geo headers are URL-encoded ("New%20York"). Decode safely.
function geoHeader(req, name) {
  const v = req.headers[name];
  if (!v) return null;
  try { return decodeURIComponent(v.toString()); } catch { return v.toString(); }
}

// Tiny UA → friendly device label. Good enough for "iPhone · Safari".
function deviceLabel(ua = '') {
  const s = ua.toLowerCase();
  let os = 'Unknown device';
  if (/iphone/.test(s)) os = 'iPhone';
  else if (/ipad/.test(s)) os = 'iPad';
  else if (/android/.test(s)) os = 'Android';
  else if (/macintosh|mac os/.test(s)) os = 'Mac';
  else if (/windows/.test(s)) os = 'Windows';
  else if (/linux/.test(s)) os = 'Linux';
  let br = '';
  if (/edg\//.test(s)) br = 'Edge';
  else if (/chrome|crios/.test(s)) br = 'Chrome';
  else if (/firefox|fxios/.test(s)) br = 'Firefox';
  else if (/safari/.test(s)) br = 'Safari';
  return br ? `${os} · ${br}` : os;
}

export default async function handler(req, res) {
  const task = (req.query?.task || '').toString();

  // ── task=send: push to specific users (Daily Log mentions, etc.). ──
  // Client-triggered → guarded by the shared x-omega-secret.
  if (task === 'send') {
    if (!requireSecret(req, res)) return;
    if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured' });
    if (!vapidReady) return json(res, 200, { ok: false, sent: 0, vapidReady, vapidError, hint: 'VAPID keys missing or invalid on the server' });
    try {
      let p = req.body;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
      p = p || {};
      const result = await sendPushToUsers(p.userNames, {
        title: p.title || 'Omega',
        body:  p.body || '',
        url:   p.url || '/',
        tag:   p.tag || undefined,
      });
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 200, { ok: false, error: err?.message || 'send failed' });
    }
  }

  // ── task=login: record a login session (who/when/where/device). ──
  // Client-triggered right after a successful PIN login → guarded by the
  // shared x-omega-secret. Writes server-side (service role) so the row
  // is append-only from the app's perspective. Returns the row id, which
  // the client keeps as a session_id to stamp later actions.
  if (task === 'login') {
    if (!requireSecret(req, res)) return;
    if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured' });
    try {
      let p = req.body;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
      p = p || {};
      const ua = (req.headers['user-agent'] || '').toString();
      const row = {
        user_name:  p.user_name || 'unknown',
        user_role:  p.user_role || 'unknown',
        ip:         clientIp(req),
        city:       geoHeader(req, 'x-vercel-ip-city'),
        region:     geoHeader(req, 'x-vercel-ip-country-region'),
        country:    geoHeader(req, 'x-vercel-ip-country'),
        user_agent: ua.slice(0, 500),
        device:     deviceLabel(ua),
      };
      const { data, error } = await supabase
        .from('user_sessions')
        .insert([row])
        .select('id')
        .single();
      if (error) throw error;
      return json(res, 200, { ok: true, session_id: data?.id || null });
    } catch (err) {
      // Never block login on a logging failure.
      return json(res, 200, { ok: false, error: err?.message || 'login log failed' });
    }
  }

  // ── task=lead-alert: a new / returning lead just came in. ──
  // Called by the website (server-to-server) and by the app's New Lead
  // screens. Strict secret: OMEGA_API_SECRET or WEBSITE_LEAD_SECRET.
  if (task === 'lead-alert') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
    if (!requireStrictSecret(req, res)) return;
    if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured' });
    const p = readBody(req);
    const jobId = (p.job_id || '').toString().trim();
    const kind = p.kind === 'new' || p.kind === 'repeat' ? p.kind : null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId) || !kind) {
      return json(res, 400, { ok: false, error: 'job_id (uuid) and kind ("new" | "repeat") are required' });
    }
    // "repeat" only comes from the website. Once WEBSITE_LEAD_SECRET exists
    // it's required here — the app's secret is public in the browser bundle.
    const websiteSecret = (process.env.WEBSITE_LEAD_SECRET || '').trim();
    if (kind === 'repeat' && websiteSecret && !safeEqual(givenSecret(req), websiteSecret)) {
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }
    try {
      const { data: job, error: jobErr } = await supabase
        .from('jobs').select('*').eq('id', jobId).maybeSingle();
      if (jobErr) return json(res, 500, { ok: false, error: jobErr.message });
      if (!job) return json(res, 404, { ok: false, error: 'Job not found' });

      if (kind === 'new') {
        if (BULK_IMPORT_CREATORS.has((job.created_by || '').trim())) {
          return json(res, 200, { ok: true, skipped: 'bulk_import' });
        }
        if (job.lead_alert_sent_at) return json(res, 200, { ok: true, skipped: 'already_sent' });
        // Claim BEFORE sending: only the call that flips NULL → now() sends,
        // so a retry or two simultaneous calls can't alert twice.
        const { data: claimed, error: claimErr } = await supabase
          .from('jobs')
          .update({ lead_alert_sent_at: new Date().toISOString() })
          .eq('id', jobId)
          .is('lead_alert_sent_at', null)
          .select('id');
        if (claimErr) {
          // Only tolerated when migration 078 isn't applied yet: a missed
          // lead is worse than a possible duplicate.
          if (!/lead_alert_sent_at/.test(claimErr.message || '')) {
            return json(res, 500, { ok: false, error: claimErr.message });
          }
        } else if (!claimed || claimed.length === 0) {
          return json(res, 200, { ok: true, skipped: 'already_sent' });
        }
      }

      const report = await sendLeadAlert(job, kind, {
        skipUser: (p.skip_user || '').toString(),
        sourceOverride: (p.source || '').toString(),
      });
      return json(res, 200, { ok: true, job_id: jobId, kind, ...report });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || 'lead alert failed' });
    }
  }

  // ── task=daily-summary: the 7pm owner summary, on demand. ──
  // ?dry=1 → numbers + text, nothing sent. ?force=1 → send now, ignoring
  // the 19:00 gate; it does NOT claim the day, so the real 7pm summary
  // still goes out (logged in message_log, email subject tagged [TESTE]).
  // No flag → same gated, once-a-day path the cron uses.
  if (task === 'daily-summary') {
    if (!requireStrictSecret(req, res)) return;
    if (!supabase) return json(res, 500, { ok: false, error: 'Supabase not configured' });
    try {
      if (flagOn(req.query?.dry)) {
        const summary = await computeDailySummary();
        return json(res, 200, {
          ok: true, dry: true, whatsapp_live: WHATSAPP_LIVE, summary, text: summaryLines(summary).join('\n'),
        });
      }
      if (flagOn(req.query?.force)) {
        const summary = await computeDailySummary();
        const results = await sendDailyOwnerSummary(summary, { forced: true });
        return json(res, 200, { ok: true, forced: true, summary, ...results });
      }
      return json(res, 200, { ok: true, ...(await maybeSendDailySummary()) });
    } catch (err) {
      return json(res, 500, { ok: false, error: err?.message || 'daily summary failed' });
    }
  }

  // ── task=reminders: 2h-before event reminders (free external GitHub
  // cron, every 15 min — Vercel Hobby only allows daily crons). ──
  // Intentionally NOT secret-guarded: it's idempotent (reminder_sent_at
  // dedupes), returns no sensitive data, and the repo is PUBLIC so we
  // can't ship a shared secret in the workflow. Leaving it open lets the
  // free cron run with zero secret config. Errors return 200 with the
  // detail in the body so a transient hiccup never spams failure emails.
  // It also triggers the 7pm owner summary (once per New York day); the
  // response only says sent / not_yet / already_sent — never the numbers.
  if (task === 'reminders') {
    if (!supabase) return json(res, 200, { ok: false, error: 'Supabase not configured' });
    let result;
    try {
      result = { ok: true, ...(await sendEventReminders()) };
    } catch (err) {
      result = { ok: false, error: err?.message || 'reminders failed' };
    }
    // Isolated: a summary problem can never break the reminders.
    try {
      result.daily_summary = (await maybeSendDailySummary()).status;
    } catch {
      result.daily_summary = 'error';
    }
    return json(res, 200, result);
  }

  // Unknown task → 404. Without this, any unrecognised ?task= fell through
  // to the daily owner cron below.
  if (task) return json(res, 404, { ok: false, error: 'Unknown task' });

  // ── default (no task): the daily owner cron + start-of-day summaries. ──
  // Vercel cron sets Authorization: Bearer ${CRON_SECRET}. If the env
  // is empty (e.g. local dev), allow GET so we can manually trigger.
  if (CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }
  }

  if (!supabase) {
    return json(res, 500, { ok: false, error: 'Supabase not configured' });
  }

  // Fetch every job that's currently being worked on.
  const { data: jobs, error: jErr } = await supabase
    .from('jobs')
    .select('id, client_name, address, service, pm_name')
    .eq('pipeline_status', 'in_progress');
  if (jErr) {
    return json(res, 500, { ok: false, error: jErr.message });
  }

  if (!jobs || jobs.length === 0) {
    return json(res, 200, { ok: true, jobs_active: 0, notifications_created: 0 });
  }

  // Don't double-up — if a "daily_update_reminder" already exists for
  // the owner on this job within the last 23h, skip. A 23h window (vs
  // exactly 24h) gives a tiny bit of slack so the cron doesn't miss a
  // day if it runs a minute earlier on consecutive days.
  const since = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: rErr } = await supabase
    .from('notifications')
    .select('job_id')
    .eq('recipient_role', 'owner')
    .eq('type', 'daily_update_reminder')
    .gt('created_at', since);
  if (rErr) {
    return json(res, 500, { ok: false, error: rErr.message });
  }
  const skipSet = new Set((recent || []).map((n) => n.job_id));

  // Build new notification rows for every job that wasn't already
  // reminded today.
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  const rows = jobs
    .filter((j) => !skipSet.has(j.id))
    .map((j) => ({
      recipient_role: 'owner',
      type:           'daily_update_reminder',
      job_id:         j.id,
      title:          `Daily update needed — ${j.client_name || 'Job'}`,
      message:        `It's ${today}. Please add a status update for "${j.client_name || j.address || 'this job'}" so the team knows where it stands.${j.pm_name ? ` PM on site: ${j.pm_name}.` : ''}`,
      read:           false,
      seen:           false,
    }));

  if (rows.length === 0) {
    return json(res, 200, { ok: true, jobs_active: jobs.length, notifications_created: 0, skipped: skipSet.size });
  }

  const { error: insErr } = await supabase.from('notifications').insert(rows);
  if (insErr) {
    return json(res, 500, { ok: false, error: insErr.message });
  }

  // ─── Pending sub offer reminders ─────────────────────────────────
  // Any subcontractor offer that's still status='sent' more than 24h
  // after sent_at gets the owner a fresh reminder (with a 23h-window
  // dedup). We do NOT auto-expire the offer — Ramon's call: the offer
  // only goes away when the sub responds or when Inácio reassigns.
  let pendingOffers = [];
  let offerReminders = 0;
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from('subcontractor_offers')
      .select('id, job_id, subcontractor_id, sent_at, last_reminder_at, scope_of_work, subcontractors(name)')
      .eq('status', 'sent')
      .lt('sent_at', yesterday);
    pendingOffers = stale || [];

    // Dedup against last_reminder_at (don't ping every day).
    const reminderCutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const toRemind = pendingOffers.filter(
      (o) => !o.last_reminder_at || o.last_reminder_at < reminderCutoff
    );

    if (toRemind.length > 0) {
      const offerRows = toRemind.map((o) => ({
        recipient_role: 'owner',
        type:           'sub_offer_pending_24h',
        job_id:         o.job_id,
        title:          `${o.subcontractors?.name || 'A subcontractor'} hasn't responded yet`,
        message:        `Offer was sent ${new Date(o.sent_at).toLocaleDateString()}. Scope: ${(o.scope_of_work || '').slice(0, 80)}${(o.scope_of_work || '').length > 80 ? '…' : ''}. Consider following up by phone or assigning a different sub.`,
        read:           false,
        seen:           false,
      }));
      const { error: offerErr } = await supabase.from('notifications').insert(offerRows);
      if (!offerErr) {
        offerReminders = offerRows.length;
        // Stamp last_reminder_at on each so we don't ping again for ~23h.
        const now = new Date().toISOString();
        for (const o of toRemind) {
          await supabase.from('subcontractor_offers')
            .update({ last_reminder_at: now })
            .eq('id', o.id);
        }
      }
    }
  } catch { /* non-fatal — owner already got the job-update notif */ }

  // ─── Gmail invoice poll ───────────────────────────────────────────
  // Non-fatal: if Gmail isn't connected or fails, the cron still succeeds.
  let gmailResult = { ok: false, reason: 'not_run' };
  try {
    gmailResult = await pollGmailInvoices();
  } catch (err) {
    gmailResult = { ok: false, reason: err.message };
  }

  // ─── Start-of-day push summaries ─────────────────────────────────
  // One push per user listing today's calendar events. Non-fatal.
  let pushSummaries = { summaries: 0 };
  try { pushSummaries = await sendDailySummaries(); } catch { /* non-fatal */ }

  return json(res, 200, {
    ok: true,
    jobs_active: jobs.length,
    notifications_created: rows.length,
    skipped: skipSet.size,
    pending_offers: pendingOffers.length,
    offer_reminders_created: offerReminders,
    gmail: gmailResult,
    push_summaries: pushSummaries.summaries,
  });
}
