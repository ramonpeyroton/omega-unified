// Vercel Cron Function: nudge the owner once a day to update every
// active project. Runs daily at 12pm UTC (7am EST / 8am EDT).
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

// Bill alerts — notify Operations (Brenda) when bills need attention.
// Two triggers, deduped so Brenda doesn't get spammed:
//   • Due soon  → 2 days before due_date, fires ONCE per bill
//   • Overdue   → fires once per 20h window while still overdue
//
// Runs from the ?task=reminders cadence (every 15 min via GitHub Actions
// — see .github/workflows/push-cron.yml). Only `operations` role users
// receive these; owner / admin / others don't get spammed by day-to-day
// bill chatter.
async function sendBillAlerts() {
  if (!vapidReady || !supabase) return { due_soon: 0, overdue: 0 };

  // Who gets the alerts — operations only.
  const { data: ops } = await supabase
    .from('users')
    .select('name, role, active')
    .eq('active', true)
    .eq('role', 'operations');
  const opsNames = (ops || []).map((u) => u.name).filter(Boolean);
  if (opsNames.length === 0) return { due_soon: 0, overdue: 0 };

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const in2Days  = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const overdueCutoff = new Date(today.getTime() - 20 * 60 * 60 * 1000).toISOString();

  const { data: bills } = await supabase
    .from('bills')
    .select('id, label, due_date, amount, status, overdue_notified_at, due_soon_notified_at')
    .eq('status', 'pending')
    .lte('due_date', in2Days);
  if (!bills || bills.length === 0) return { due_soon: 0, overdue: 0 };

  let dueSoon = 0, overdue = 0;
  for (const bill of bills) {
    const isOverdue = bill.due_date < todayISO;
    if (isOverdue) {
      // Dedupe: only alert if we haven't sent one in the last 20h.
      if (bill.overdue_notified_at && bill.overdue_notified_at > overdueCutoff) continue;
      const amountText = bill.amount != null ? ` · $${Number(bill.amount).toFixed(2)}` : '';
      await sendPushToUsers(opsNames, {
        title: `🔴 Overdue bill · ${bill.label}`,
        body:  `Was due ${bill.due_date}${amountText}`,
        url:   '/finance',
        tag:   `bill-overdue-${bill.id}`,
      });
      await supabase.from('bills')
        .update({ overdue_notified_at: new Date().toISOString() })
        .eq('id', bill.id);
      overdue++;
    } else {
      // Due within next 2 days (today, tomorrow, or day after).
      if (bill.due_soon_notified_at) continue; // one-shot
      const amountText = bill.amount != null ? ` · $${Number(bill.amount).toFixed(2)}` : '';
      await sendPushToUsers(opsNames, {
        title: `⏳ Bill due soon · ${bill.label}`,
        body:  `Due ${bill.due_date}${amountText}`,
        url:   '/finance',
        tag:   `bill-due-${bill.id}`,
      });
      await supabase.from('bills')
        .update({ due_soon_notified_at: new Date().toISOString() })
        .eq('id', bill.id);
      dueSoon++;
    }
  }
  return { due_soon: dueSoon, overdue };
}

// ═══ 5pm SMS summary (owner + Ramon) ═════════════════════════════════
// By Ramon's call: one SMS a day at 17:00 NY (weekends too) from the
// Twilio toll-free number. Stays on until WhatsApp is approved (09/10/26);
// set SMS_SUMMARY_LAST_DAY to a 'YYYY-MM-DD' to stop it on a given day.
// The lead alerts / WhatsApp track stays on standby.
//
// Runs from ?task=reminders (GitHub cron, every 15 min). Dedupe is per
// recipient per day through audit_log rows (action 'sms_summary.sent'), so
// a number added to DAILY_SUMMARY_SMS_TO later in the day still gets that
// day's summary on the next tick, and nobody gets it twice.
//
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (the
// toll-free sender), DAILY_SUMMARY_SMS_TO (comma-separated US numbers).

const NY_TZ = 'America/New_York';
const SMS_SUMMARY_HOUR = 17;
const SMS_SUMMARY_LAST_DAY = null; // inclusive 'YYYY-MM-DD'; null = no end date
const BULK_IMPORT_CREATORS = new Set(['import', 'legacy_import']);
const PT_WEEKDAY = { Sun: 'dom', Mon: 'seg', Tue: 'ter', Wed: 'qua', Thu: 'qui', Fri: 'sex', Sat: 'sáb' };
const KIND_PT = {
  sales_visit: 'Visita', job_start: 'Início de obra', service_day: 'Dia de serviço',
  inspection: 'Inspeção', meeting: 'Reunião', media_visit: 'Mídia',
  material_delivery: 'Entrega de material', cabinet_delivery: 'Entrega de armários',
};
const KIND_EN = {
  sales_visit: 'Sales Visit', job_start: 'Job Start', service_day: 'Service Day',
  inspection: 'Inspection', meeting: 'Meeting', media_visit: 'Media Visit',
  material_delivery: 'Material Delivery', cabinet_delivery: 'Cabinet Delivery',
};

function nyParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, wd: p.weekday };
}

// One NY calendar day: its 'YYYY-MM-DD' key, midnight (UTC ms) and labels.
// Offset is read at noon, so it's an hour off only on the two DST-switch
// days — harmless for a daily summary.
function nyDay(y, m, d) {
  const noon = Date.UTC(y, m - 1, d, 12);
  const p = nyParts(noon);
  return {
    key: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    startMs: Date.UTC(p.y, p.m - 1, p.d) + (12 - p.hh) * 3_600_000,
    label: `${PT_WEEKDAY[p.wd] || p.wd} ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`,
    y: p.y, m: p.m, d: p.d,
  };
}

function toE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function shortDateKey(key) {
  const [, m, d] = key.split('-');
  return `${d}/${m}`;
}

function ageText(iso, nowMs) {
  const days = Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'de hoje' : days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

// "Megan Flores — HVAC Start" style titles: drop the kind (shown separately).
function cleanEventTitle(title, kind) {
  let t = (title || '').trim();
  const en = KIND_EN[kind];
  if (en) {
    const suffix = ` — ${en}`.toLowerCase();
    const prefix = `${en} — `.toLowerCase();
    if (t.toLowerCase().endsWith(suffix)) t = t.slice(0, -suffix.length);
    else if (t.toLowerCase().startsWith(prefix)) t = t.slice(prefix.length);
  }
  return t.replace(/^visit:\s*/i, '');
}

async function buildSmsSummary(nowMs = Date.now()) {
  const p = nyParts(nowMs);
  const today = nyDay(p.y, p.m, p.d);
  const tomorrow = nyDay(p.y, p.m, p.d + 1);
  const dayAfter = nyDay(p.y, p.m, p.d + 2);
  const todayIso = new Date(today.startMs).toISOString();

  const [leadsRes, visitsRes, waitingRes, overdueRes, dueTomorrowRes, agendaRes] = await Promise.all([
    supabase.from('jobs').select('lead_source, created_by').gte('created_at', todayIso),
    supabase.from('job_stage_events').select('job_id').eq('to_status', 'visited').gte('changed_at', todayIso),
    supabase.from('jobs').select('pipeline_status, stage_entered_at')
      .eq('in_pipeline', true).in('pipeline_status', ['estimate_draft', 'visited']),
    supabase.from('bills').select('label, amount, due_date')
      .eq('status', 'pending').lt('due_date', today.key).order('due_date', { ascending: true }),
    supabase.from('bills').select('label, amount, due_date')
      .eq('status', 'pending').eq('due_date', tomorrow.key),
    supabase.from('calendar_events').select('title, starts_at, kind, visit_status')
      .gte('starts_at', new Date(tomorrow.startMs).toISOString())
      .lt('starts_at', new Date(dayAfter.startMs).toISOString())
      .order('starts_at', { ascending: true }),
  ]);
  for (const r of [leadsRes, visitsRes, waitingRes, overdueRes, dueTomorrowRes, agendaRes]) {
    if (r.error) throw r.error;
  }

  const leads = (leadsRes.data || []).filter((j) => !BULK_IMPORT_CREATORS.has((j.created_by || '').trim()));
  const bySource = {};
  for (const j of leads) {
    const k = (j.lead_source || '').trim() || 'Sem origem';
    bySource[k] = (bySource[k] || 0) + 1;
  }
  const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');

  const visitsToday = new Set((visitsRes.data || []).map((e) => e.job_id)).size;
  const waiting = waitingRes.data || [];
  const drafts = waiting.filter((j) => j.pipeline_status === 'estimate_draft');
  const visited = waiting.filter((j) => j.pipeline_status === 'visited');
  const oldestOf = (rows) => rows.map((j) => j.stage_entered_at).filter(Boolean).sort()[0];

  // Phone-first layout: one emoji + CAPS header per section, the number in
  // the header, one item per line, blank line between sections.
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const oldest = (rows) => {
    const t = oldestOf(rows);
    return t ? ` (mais antigo ${ageText(t, nowMs)})` : '';
  };

  const lines = ['OMEGA · RESUMO DO DIA', cap(today.label), ''];

  lines.push(`📥 LEADS NOVOS: ${leads.length}`);
  if (sources) lines.push(sources);
  lines.push('');

  lines.push(`🏠 VISITAS FEITAS: ${visitsToday}`);
  lines.push('');

  lines.push('✍️ ESTIMATES');
  lines.push(`• ${drafts.length} esperando preço${oldest(drafts)}`);
  lines.push(`• ${visited.length} ${visited.length === 1 ? 'visitado esperando' : 'visitados esperando'} o Attila${oldest(visited)}`);
  lines.push('');

  const overdue = overdueRes.data || [];
  const dueTomorrow = dueTomorrowRes.data || [];
  if (!overdue.length && !dueTomorrow.length) {
    lines.push('💵 CONTAS: tudo em dia ✅');
  } else {
    lines.push('💵 CONTAS');
    overdue.slice(0, 3).forEach((b) => lines.push(`🔴 ${b.label} · ${usd(b.amount)} · venceu ${shortDateKey(b.due_date)}`));
    if (overdue.length > 3) lines.push(`🔴 + ${overdue.length - 3} outras atrasadas`);
    dueTomorrow.slice(0, 3).forEach((b) => lines.push(`🟡 ${b.label} · ${usd(b.amount)} · vence amanhã`));
    if (dueTomorrow.length > 3) lines.push(`🟡 + ${dueTomorrow.length - 3} outras vencendo amanhã`);
  }
  lines.push('');

  const agenda = (agendaRes.data || []).filter((e) => e.visit_status !== 'cancelled');
  if (!agenda.length) {
    lines.push(`📅 AMANHÃ (${cap(tomorrow.label)}): nada marcado`);
  } else {
    lines.push(`📅 AMANHÃ · ${cap(tomorrow.label)}`);
    agenda.slice(0, 8).forEach((e) => {
      const kind = KIND_PT[e.kind] || 'Evento';
      const title = cleanEventTitle(e.title, e.kind);
      lines.push(`• ${etTime(e.starts_at)} · ${title || kind}${title ? ` (${kind})` : ''}`);
    });
    if (agenda.length > 8) lines.push(`• + ${agenda.length - 8} outros`);
  }

  return { dayKey: today.key, hour: p.hh, text: lines.join('\n') };
}

async function sendSms(to, body) {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = (process.env.TWILIO_PHONE_NUMBER || '').trim();
  if (!sid || !token || !from) return { ok: false, error: 'Twilio SMS not configured' };
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data?.message || `Twilio ${r.status}`, code: data?.code };
    return { ok: true, sid: data.sid, status: data.status };
  } catch (err) {
    return { ok: false, error: err?.message || 'Twilio request failed' };
  }
}

async function maybeSendSmsSummary(nowMs = Date.now()) {
  if (!supabase) return { status: 'skipped' };
  const raw = (process.env.DAILY_SUMMARY_SMS_TO || '').trim();
  if (!raw) return { status: 'no_recipients' };
  const recipients = [...new Set(raw.split(',').map(toE164).filter(Boolean))];
  // Set but unparseable (e.g. numbers separated by spaces, non-US). The
  // endpoint is public, so report the shape problem — never the numbers.
  if (!recipients.length) {
    return { status: 'invalid_recipients', hint: '10-digit US numbers separated by commas' };
  }

  const p = nyParts(nowMs);
  const today = nyDay(p.y, p.m, p.d);
  if (SMS_SUMMARY_LAST_DAY && today.key > SMS_SUMMARY_LAST_DAY) return { status: 'ended' };
  if (p.hh < SMS_SUMMARY_HOUR) return { status: 'not_yet' };

  const { data: sentRows, error: sentErr } = await supabase
    .from('audit_log')
    .select('details')
    .eq('action', 'sms_summary.sent')
    .gte('timestamp', new Date(today.startMs).toISOString());
  if (sentErr) throw sentErr;
  const alreadySent = new Set((sentRows || []).map((r) => r.details?.to).filter(Boolean));
  const pending = recipients.filter((n) => !alreadySent.has(n));
  if (!pending.length) return { status: 'already_sent' };

  const { text } = await buildSmsSummary(nowMs);
  const results = [];
  for (const to of pending) {
    const r = await sendSms(to, text);
    results.push({ to: `…${to.slice(-4)}`, ...r });
    // Mark sent only on success, so a failed send retries on the next tick.
    if (r.ok) {
      await supabase.from('audit_log').insert([{
        user_name: 'system', user_role: 'system', action: 'sms_summary.sent',
        entity_type: 'sms', entity_id: null,
        details: { to, day: today.key, twilio_sid: r.sid },
      }]);
    } else {
      console.error('[sms-summary] send failed', to.slice(-4), r.error, r.code);
    }
  }
  return { status: 'sent', results };
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

  // ── task=reminders: 2h-before event reminders (free external GitHub
  // cron, every 15 min — Vercel Hobby only allows daily crons). ──
  // Intentionally NOT secret-guarded: it's idempotent (reminder_sent_at
  // dedupes), returns no sensitive data, and the repo is PUBLIC so we
  // can't ship a shared secret in the workflow. Leaving it open lets the
  // free cron run with zero secret config. Errors return 200 with the
  // detail in the body so a transient hiccup never spams failure emails.
  if (task === 'reminders') {
    if (!supabase) return json(res, 200, { ok: false, error: 'Supabase not configured' });
    try {
      // Two independent tracks — a failure in one must not block the other.
      const evt = await sendEventReminders().catch((e) => ({ error: e?.message || 'event reminders failed' }));
      const bills = await sendBillAlerts().catch((e) => ({ error: e?.message || 'bill alerts failed' }));
      const sms = await maybeSendSmsSummary().catch((e) => ({ error: e?.message || 'sms summary failed' }));
      return json(res, 200, { ok: true, events: evt, bills, sms });
    } catch (err) {
      return json(res, 200, { ok: false, error: err?.message || 'reminders failed' });
    }
  }

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
