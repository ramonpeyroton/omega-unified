// Calendar data + helpers.
// Everything is stored in UTC (timestamptz) and displayed in
// America/New_York — the Omega office sits in Fairfield County CT,
// so we don't need user-selectable timezones.

import { supabase } from './supabase';

export const TZ = 'America/New_York';

// One color per event kind. Pipeline-style palette so the calendar
// feels part of the rest of the app.
export const EVENT_KIND_META = {
  sales_visit: { label: 'Sales Visit',  color: '#E8732A' }, // omega orange
  job_start:   { label: 'Job Start',    color: '#22C55E' }, // green
  service_day: { label: 'Service Day',  color: '#3B82F6' }, // blue
  inspection:  { label: 'Inspection',   color: '#EAB308' }, // amber
  meeting:     { label: 'Meeting',      color: '#8B5CF6' }, // violet
};

export const EVENT_KIND_OPTIONS = Object.entries(EVENT_KIND_META).map(
  ([value, meta]) => ({ value, label: meta.label, color: meta.color })
);

// ─── Visit status (sales_visit only) ────────────────────────────────
// Lets the receptionist tag every visit so the calendar reads at a
// glance. Colors are picked to NOT clash with the other event kinds:
//   to_do     orange (= sales_visit default)            ↔ no clash
//   completed sky-500 cyan-blue   (≠ service_day blue   #3B82F6)
//   pending   lime-700 yellow-grn (≠ job_start  green   #22C55E)
//   cancelled slate-800 near-black                      ↔ no clash
//
// `getVisitStatusMeta` handles the legacy 'scheduled' value some
// envs may have written — treat it as 'to_do'.
export const VISIT_STATUS_META = {
  to_do:     { label: 'To Do',     short: 'TO DO',     color: '#E8732A' },
  completed: { label: 'Completed', short: 'COMPLETED', color: '#0EA5E9' },
  pending:   { label: 'Pending',   short: 'PENDING',   color: '#65A30D' },
  cancelled: { label: 'Cancelled', short: 'CANCELLED', color: '#1F2937' },
};

export const VISIT_STATUS_ORDER = ['to_do', 'pending', 'completed', 'cancelled'];

export function getVisitStatusMeta(status) {
  if (!status || status === 'scheduled') return VISIT_STATUS_META.to_do;
  return VISIT_STATUS_META[status] || VISIT_STATUS_META.to_do;
}

/**
 * Return the display color + label for an event. Sales visits override
 * the kind's color with the visit_status color so the receptionist can
 * tell at a glance which visits are pending vs completed vs cancelled.
 * Other kinds (job_start, service_day, etc.) ignore visit_status — the
 * column exists on every row but only sales_visit consumes it.
 *
 * @param {{ kind?: string, visit_status?: string }} ev
 * @returns {{ color: string, label: string, statusLabel: string|null }}
 */
export function eventDisplayMeta(ev) {
  const kindMeta = EVENT_KIND_META[ev?.kind] || { label: ev?.kind || 'Event', color: '#6B7280' };
  if (ev?.kind === 'sales_visit') {
    const s = getVisitStatusMeta(ev.visit_status);
    return { color: s.color, label: kindMeta.label, statusLabel: s.label };
  }
  return { color: kindMeta.color, label: kindMeta.label, statusLabel: null };
}

// ─── Date helpers (all respect CT timezone) ─────────────────────────

/** Return the local YYYY-MM-DD string for a Date in CT. */
export function isoDateCT(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

export function formatTimeCT(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

export function formatDateLongCT(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(d);
}

export function formatMonthCT(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, month: 'long', year: 'numeric',
  }).format(d);
}

/** Build a 42-cell month grid (6 weeks × 7 days, Sun-first). */
export function buildMonthGrid(year, monthIndex /* 0-11 */) {
  // First/last day of the target month in UTC terms — we just need
  // ordinal dates, not timezone math here.
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const firstDow = firstOfMonth.getUTCDay(); // 0 = Sun

  const cells = [];
  const startOffset = firstDow; // how many "previous month" cells to prepend
  for (let i = 0; i < 42; i++) {
    const dayOffset = i - startOffset;
    // ⚠️ Noon UTC, NOT midnight. Midnight UTC of "day N" lands the day
    // BEFORE in America/New_York (EDT = UTC-4 → 8pm prev day, EST =
    // UTC-5 → 7pm prev day), which made `isoDateCT(d)` return day N-1
    // while `d.getUTCDate()` returned N. Net effect: the cell labelled
    // "9" had iso "2026-05-08", so an event you booked for the 8th
    // ended up rendering in the cell labelled "9". Noon UTC = 7am-8am
    // NY → same calendar date in both UTC and NY. Fixes the off-by-one.
    const d = new Date(Date.UTC(year, monthIndex, 1 + dayOffset, 12));
    cells.push({
      date: d,
      iso: isoDateCT(d),
      day: d.getUTCDate(),
      isCurrentMonth: d.getUTCMonth() === monthIndex && d.getUTCFullYear() === year,
      isToday: isoDateCT(d) === isoDateCT(new Date()),
    });
  }
  return cells;
}

/** Convert a YYYY-MM-DD date + HH:mm time (CT) into a UTC ISO string. */
export function composeCTDateTime(isoDate, hhmm) {
  // Pull the month/day/year as local CT, then synthesize a Date whose
  // toLocaleString('en-US', {timeZone:'America/New_York'}) matches the
  // requested wall time.
  const [yy, mm, dd] = isoDate.split('-').map(Number);
  const [h, m] = (hhmm || '00:00').split(':').map(Number);

  // Start with a UTC guess then adjust by the TZ offset of CT on that day.
  const utcGuess = new Date(Date.UTC(yy, (mm - 1), dd, h, m));
  const offsetMs = ctOffsetMs(utcGuess);
  return new Date(utcGuess.getTime() - offsetMs).toISOString();
}

/** Offset of America/New_York relative to UTC for a given instant, in ms.
 *  Returns negative numbers (e.g. -5h in EST, -4h in EDT). */
export function ctOffsetMs(date = new Date()) {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: TZ }));
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  return tzDate.getTime() - utcDate.getTime();
}

// ─── Supabase queries ──────────────────────────────────────────────

export async function loadEventsForRange(startISO, endISO) {
  try {
    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .gte('starts_at', startISO)
      .lt('starts_at', endISO)
      .order('starts_at', { ascending: true });
    return data || [];
  } catch { return []; }
}

export async function loadEventsForMonth(year, monthIndex) {
  // Pull a bit wider than the month itself because the grid shows
  // leading/trailing days from prev/next month.
  const start = new Date(Date.UTC(year, monthIndex - 0, 1));
  start.setUTCDate(start.getUTCDate() - 7);
  const end   = new Date(Date.UTC(year, monthIndex + 1, 1));
  end.setUTCDate(end.getUTCDate() + 7);
  return loadEventsForRange(start.toISOString(), end.toISOString());
}

/**
 * Conflict detection for sales_visit. Returns the first blocking
 * event if the proposed window collides with an existing event for
 * ANY of the proposed assignees, or null when everyone is free.
 *
 * Accepts either `assignedToName` (single name, legacy) or
 * `assignedToNames` (array of names, multi-assign).
 */
export async function findConflict({ startsAt, endsAt, assignedToName, assignedToNames, ignoreId }) {
  const names = Array.isArray(assignedToNames) && assignedToNames.length
    ? assignedToNames.filter(Boolean)
    : (assignedToName ? [assignedToName] : []);
  if (!names.length) return null;
  try {
    // Window-overlap predicate: existing event starts BEFORE our end
    // AND ends AFTER our start. We then OR the assignee match across
    // both the legacy scalar column and the new array column so we
    // catch conflicts on rows written before migration 036 too.
    const orParts = names.flatMap((n) => [
      `assigned_to_name.eq.${n}`,
      `assigned_to_names.cs.{${n.replace(/"/g, '\\"')}}`,
    ]);
    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .lt('starts_at', endsAt)
      .gt('ends_at', startsAt)
      .or(orParts.join(','));
    const rows = (data || []).filter((r) => r.id !== ignoreId);
    return rows[0] || null;
  } catch { return null; }
}

export async function createEvent(event) {
  const { data, error } = await supabase
    .from('calendar_events')
    .insert([event])
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateEvent(id, patch) {
  const { data, error } = await supabase
    .from('calendar_events')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ─── Role permissions ──────────────────────────────────────────────
// Who can do what on the calendar. View is open to all logged-in roles;
// editing is scoped to the kinds that role naturally owns.

const EDIT_ALL = new Set(['owner', 'operations', 'admin']);

export function canEditKind(role, kind) {
  if (EDIT_ALL.has(role)) return true;
  if (role === 'receptionist') return kind === 'sales_visit';
  if (role === 'sales')        return kind === 'sales_visit';
  if (role === 'manager')      return ['job_start', 'service_day', 'inspection', 'meeting'].includes(kind);
  return false;
}

export function canCreateAnyEvent(role) {
  return EDIT_ALL.has(role) || ['receptionist', 'sales', 'manager'].includes(role);
}
