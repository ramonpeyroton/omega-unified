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
import { pollGmailInvoices } from './_lib/gmailPoller.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CRON_SECRET  = process.env.CRON_SECRET || '';

const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
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

  return json(res, 200, {
    ok: true,
    jobs_active: jobs.length,
    notifications_created: rows.length,
    skipped: skipSet.size,
    pending_offers: pendingOffers.length,
    offer_reminders_created: offerReminders,
    gmail: gmailResult,
  });
}
