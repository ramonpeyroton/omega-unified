// Follow-ups (migration 092) — calendar_events rows with kind 'follow_up',
// always tied to a client. Read + write helpers for the Follow Up screen
// (sales + owner). Reminders are sent server-side (api/_lib/teamAlerts.js).

import { supabase } from './supabase';
import { TZ, isoDateCT, composeCTDateTime } from './calendar';
import { logAudit } from './audit';

// Monday-first week key range (YYYY-MM-DD) that contains `todayKey`.
function weekRange(todayKey) {
  const [y, m, d] = todayKey.split('-').map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = (noon.getUTCDay() + 6) % 7; // Mon = 0
  const mon = new Date(noon.getTime() - dow * 86_400_000);
  const sun = new Date(mon.getTime() + 6 * 86_400_000);
  const key = (dt) => dt.toISOString().slice(0, 10);
  return { start: key(mon), end: key(sun) };
}

// 'overdue' (red) · 'week' (yellow, includes today) · 'later' (green) · 'done'
export function followUpBucket(ev, now = new Date()) {
  if (ev.visit_status === 'completed') return 'done';
  const todayKey = isoDateCT(now);
  const dayKey = isoDateCT(new Date(ev.starts_at));
  // Red from the next day on — a follow-up stays "today" until midnight.
  if (dayKey < todayKey) return 'overdue';
  const { end } = weekRange(todayKey);
  return dayKey <= end ? 'week' : 'later';
}

export function isToday(ev, now = new Date()) {
  return isoDateCT(new Date(ev.starts_at)) === isoDateCT(now);
}

export async function loadFollowUps() {
  const { data, error } = await supabase
    .from('calendar_events')
    .select('id, kind, title, starts_at, ends_at, all_day, job_id, notes, visit_status, done_at, done_by, done_note, assigned_to_names, created_by_name, created_at')
    .eq('kind', 'follow_up')
    .neq('visit_status', 'cancelled')
    .order('starts_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];
  const jobs = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: js } = await supabase
      .from('jobs')
      .select('id, client_name, client_phone, address, city, service, pipeline_status')
      .in('id', ids.slice(i, i + 150));
    for (const j of js || []) jobs.set(j.id, j);
  }
  return rows.map((r) => ({ ...r, job: jobs.get(r.job_id) || null }));
}

export async function markFollowUpDone(ev, user, note) {
  const patch = {
    visit_status: 'completed',
    done_at: new Date().toISOString(),
    done_by: user?.name || null,
    done_note: (note || '').trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('calendar_events').update(patch).eq('id', ev.id);
  if (error) throw error;
  logAudit({ user, action: 'follow_up.done', entityType: 'calendar_event', entityId: ev.id, details: { job_id: ev.job_id, note: patch.done_note } });
}

export async function reopenFollowUp(ev, user) {
  const { error } = await supabase.from('calendar_events')
    .update({ visit_status: 'to_do', done_at: null, done_by: null, done_note: null, updated_at: new Date().toISOString() })
    .eq('id', ev.id);
  if (error) throw error;
  logAudit({ user, action: 'follow_up.reopen', entityType: 'calendar_event', entityId: ev.id, details: { job_id: ev.job_id } });
}

// New date (YYYY-MM-DD) and time ('HH:MM', or null = any time that day).
export async function rescheduleFollowUp(ev, user, dateKey, hhmm) {
  const startsAt = composeCTDateTime(dateKey, hhmm || '09:00');
  const endsAt = new Date(new Date(startsAt).getTime() + 15 * 60000).toISOString();
  const { error } = await supabase.from('calendar_events')
    .update({ starts_at: startsAt, ends_at: endsAt, all_day: !hhmm, visit_status: 'to_do',
      done_at: null, done_by: null, done_note: null, updated_at: new Date().toISOString() })
    .eq('id', ev.id);
  if (error) throw error;
  logAudit({ user, action: 'follow_up.reschedule', entityType: 'calendar_event', entityId: ev.id,
    details: { job_id: ev.job_id, from: ev.starts_at, to: startsAt } });
}

export async function removeFollowUp(ev, user) {
  const { error } = await supabase.from('calendar_events').delete().eq('id', ev.id);
  if (error) throw error;
  logAudit({ user, action: 'follow_up.remove', entityType: 'calendar_event', entityId: ev.id,
    details: { job_id: ev.job_id, starts_at: ev.starts_at, title: ev.title } });
}

export function formatFollowUpWhen(ev) {
  const d = new Date(ev.starts_at);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  if (ev.all_day) return `${day} · any time`;
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return `${day} · ${time}`;
}
