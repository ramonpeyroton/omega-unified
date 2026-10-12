// Vercel Function, routed by ?task= (folded together to stay under Vercel's
// 12-function Hobby limit):
//   task=send       web push to specific users (Daily Log @mentions)
//   task=login      record a login session
//   task=reminders  every 15 min (GitHub Actions): team WhatsApp alerts
//                   (_lib/teamAlerts.js)
//   (no task)       daily Vercel cron at 12:00 UTC: Gmail invoice poll
//
// 2026-10-12 (Ramon): every older automatic notification — the 5pm SMS
// summary, the morning push, the 2h-before event push, the bill pushes and
// the owner's daily-update / pending-offer bell reminders — was switched off
// and replaced by the per-person WhatsApp alerts in _lib/teamAlerts.js.

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { pollGmailInvoices } from './_lib/gmailPoller.js';
import { requireSecret } from './_lib/requireSecret.js';
import { timingSafeEqual } from 'node:crypto';
import { runTeamAlerts, groupWatchDirectory, groupWatchReport } from './_lib/teamAlerts.js';

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

  // ── task=reminders: team WhatsApp alerts (free external GitHub cron,
  // every 15 min — Vercel Hobby only allows daily crons). ──
  // Intentionally NOT secret-guarded: every alert is deduped (audit_log
  // 'team_alert.sent'), the response carries no phone numbers or client
  // data, and the repo is PUBLIC. Errors return 200 with the detail in the
  // body so a transient hiccup never spams failure emails.
  if (task === 'reminders') {
    try {
      const team = await runTeamAlerts();
      return json(res, 200, { ok: true, team });
    } catch (err) {
      console.error('[team-alerts] failed', err?.message || err);
      return json(res, 200, { ok: false, error: err?.message || 'team alerts failed' });
    }
  }

  // ── task=imessage: the group-chat watcher on Inácio's MacBook
  // (tools/imessage-watch). GET = directory (team + client phones), POST =
  // hourly report of unanswered client groups. Guarded by its own secret
  // (env IMESSAGE_WATCH_SECRET, same value in the Mac's config.json).
  if (task === 'imessage') {
    const secret = (process.env.IMESSAGE_WATCH_SECRET || '').trim();
    if (!secret) return json(res, 503, { ok: false, error: 'IMESSAGE_WATCH_SECRET not set' });
    const given = Buffer.from((req.headers['x-watch-secret'] || '').toString());
    const want = Buffer.from(secret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }
    try {
      if (req.method === 'GET') return json(res, 200, { ok: true, ...(await groupWatchDirectory()) });
      let p = req.body;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
      return json(res, 200, { ok: true, ...(await groupWatchReport(p || {})) });
    } catch (err) {
      console.error('[group-watch] failed', err?.message || err);
      return json(res, 500, { ok: false, error: err?.message || 'group watch failed' });
    }
  }

  // Unknown task (e.g. the retired ?task=lead-alert) — never fall through
  // to the cron work below.
  if (task) return json(res, 404, { ok: false, error: `Unknown task "${task}"` });

  // ── default (no task): the daily Vercel cron. ──
  // Vercel cron sets Authorization: Bearer ${CRON_SECRET}. If the env
  // is empty (e.g. local dev), allow GET so we can manually trigger.
  if (CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return json(res, 401, { ok: false, error: 'Unauthorized' });
    }
  }

  // ─── Gmail invoice poll ───────────────────────────────────────────
  // Non-fatal: if Gmail isn't connected or fails, the cron still succeeds.
  let gmailResult = { ok: false, reason: 'not_run' };
  try {
    gmailResult = await pollGmailInvoices();
  } catch (err) {
    gmailResult = { ok: false, reason: err.message };
  }
  return json(res, 200, { ok: true, gmail: gmailResult });
}
