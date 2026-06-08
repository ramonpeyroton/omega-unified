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

// 2h-before reminders. Window [now+105min, now+120min) matches the 15-min cron
// cadence; reminder_sent_at dedupes so each event fires once.
async function sendEventReminders() {
  if (!vapidReady || !supabase) return { reminded: 0 };
  const now = Date.now();
  const start = new Date(now + 105 * 60 * 1000).toISOString();
  const end   = new Date(now + 120 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('calendar_events')
    .select('id, title, starts_at, location, assigned_to_names, assigned_to_name, job_id')
    .is('reminder_sent_at', null)
    .gte('starts_at', start)
    .lt('starts_at', end);
  if (!events || events.length === 0) return { reminded: 0 };

  let reminded = 0;
  for (const ev of events) {
    const names = eventAssignees(ev);
    if (names.length) {
      await sendPushToUsers(names, {
        title: `Soon: ${ev.title}`,
        body: `Starts at ${etTime(ev.starts_at)}${ev.location ? ` · ${ev.location}` : ''}`,
        url: ev.job_id ? `/jobs/${ev.job_id}?tab=daily` : '/calendar',
        tag: `event-${ev.id}`,
      });
      reminded++;
    }
    await supabase.from('calendar_events')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', ev.id);
  }
  return { reminded };
}

// Start-of-day summary: one push per user listing today's (ET) events.
async function sendDailySummaries() {
  if (!vapidReady || !supabase) return { summaries: 0 };
  const now = new Date();
  const horizon = new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString();
  const { data: events } = await supabase
    .from('calendar_events')
    .select('title, starts_at, assigned_to_names, assigned_to_name')
    .gte('starts_at', now.toISOString())
    .lt('starts_at', horizon)
    .order('starts_at', { ascending: true });
  if (!events || events.length === 0) return { summaries: 0 };

  const todayET = now.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const todays = events.filter(
    (e) => new Date(e.starts_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === todayET
  );
  if (todays.length === 0) return { summaries: 0 };

  const byUser = {};
  for (const e of todays) {
    for (const n of eventAssignees(e)) (byUser[n] ||= []).push(e);
  }

  let summaries = 0;
  for (const [name, list] of Object.entries(byUser)) {
    const lines = list.slice(0, 5)
      .map((e) => `${etTime(e.starts_at)} ${e.title}`)
      .join(' · ');
    await sendPushToUsers([name], {
      title: `Today: ${list.length} event${list.length === 1 ? '' : 's'}`,
      body: lines,
      url: '/calendar',
      tag: 'daily-summary',
    });
    summaries++;
  }
  return { summaries };
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
      const result = await sendEventReminders();
      return json(res, 200, { ok: true, ...result });
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
