// Time-in-stage for pipeline cards (Lead Central, migration 077).
//
//   stageAge(job, { now, visit }) → { label, title, tone } | null
//     tone: null | 'warn' (amber tint) | 'late' (rose tint)
//
// Rules per stage (job.stage_entered_at is stamped by the DB trigger):
//   new_lead                 business time   ≥ 45 min warn · > 60 min late
//   contacted                calendar time   ≥ 2 d warn    · > 3 d late
//   visit_scheduled          by visit date (New York): visit day warn,
//                            any day after it late, no date → no tint
//   visited, estimate_draft  business time   ≥ 4 d warn    · > 5 d late
//   estimate_sent,           calendar time since the later of entering the
//   estimate_negotiating     stage and the last follow-up (last_touch_at):
//                            ≥ 5 d warn · > 7 d late
//   everything else          null — the card keeps its normal footer
//
// Business time = Mon–Fri 08:00–17:00 America/New_York, no holidays; a
// business day is 9 h. Pure Intl — the repo has no date library.

import { useEffect, useState } from 'react';

const TZ = 'America/New_York';
const BIZ_START_H = 8;
const BIZ_END_H = 17;
const BIZ_DAY_MIN = (BIZ_END_H - BIZ_START_H) * 60;
const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

const BUSINESS_HOURS_NOTE = 'Counts business hours only (Mon–Fri, 8am–5pm ET).';

// Tint for the whole card + color for the label, per tone.
export const STAGE_TONE = {
  warn: { card: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
  late: { card: 'bg-rose-50 border-rose-200',   text: 'text-rose-700' },
};

const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function nyParts(ms) {
  const o = {};
  for (const p of nyFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mi: +o.minute, ss: +o.second };
}

// New York's UTC offset (ms) during the daytime of a NY calendar day. DST
// flips at 2 AM, so the whole 08:00–17:00 window shares one offset; we
// sample 17:00 UTC (~noon in New York). Cached — an offset never changes.
const offsetCache = new Map();
function dayOffsetMs(y, m, d) {
  const key = y * 10000 + m * 100 + d;
  let off = offsetCache.get(key);
  if (off === undefined) {
    const probe = Date.UTC(y, m - 1, d, 17);
    const p = nyParts(probe);
    off = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss) - probe;
    offsetCache.set(key, off);
  }
  return off;
}

// Minutes of business time between two instants.
export function businessMinutesBetween(startMs, endMs) {
  if (!(endMs > startMs)) return 0;
  const s = nyParts(startMs);
  const base = Date.UTC(s.y, s.m - 1, s.d); // calendar arithmetic only
  let total = 0;
  for (let i = 0; i < 4000; i++) { // ~11 years — hard stop for bad data
    const day = new Date(base + i * DAY_MS);
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const off = dayOffsetMs(y, m, d);
    const winStart = Date.UTC(y, m - 1, d, BIZ_START_H) - off;
    if (winStart >= endMs) break;
    const weekday = day.getUTCDay(); // weekday of the NY calendar date
    if (weekday >= 1 && weekday <= 5) {
      const winEnd = Date.UTC(y, m - 1, d, BIZ_END_H) - off;
      const overlap = Math.min(endMs, winEnd) - Math.max(startMs, winStart);
      if (overlap > 0) total += overlap / MIN_MS;
    }
  }
  return total;
}

// 'YYYY-MM-DD' of an instant, in New York.
export function nyDateKey(ms) {
  const p = nyParts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function daysBetweenKeys(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS);
}

// 'YYYY-MM-DD' → 'Mon, Sep 28'. A plain calendar date — no timezone math.
export function formatDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(key || '')) return '';
  return new Date(`${key.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
}

// 'HH:MM[:SS]' (a Postgres time) → '10:30 AM'.
export function formatClockTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// Instant → New York wall-clock time, '2:00 PM'.
export function formatNyTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

function toMs(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// Calendar span: '12m', '3h 5m', '2d 4h', '9d'.
function fmtSpan(ms) {
  const totalMin = Math.max(0, Math.floor(ms / MIN_MS));
  if (totalMin < 60) return `${totalMin}m`;
  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24) return totalMin % 60 ? `${totalH}h ${totalMin % 60}m` : `${totalH}h`;
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h && d < 7 ? `${d}d ${h}h` : `${d}d`;
}

// Business span, same shape — here a "day" is one 9-hour business day.
function fmtBizSpan(minutes) {
  const totalMin = Math.max(0, Math.floor(minutes));
  if (totalMin < 60) return `${totalMin}m`;
  if (totalMin < BIZ_DAY_MIN) {
    const h = Math.floor(totalMin / 60);
    return totalMin % 60 ? `${h}h ${totalMin % 60}m` : `${h}h`;
  }
  const d = Math.floor(totalMin / BIZ_DAY_MIN);
  const h = Math.floor((totalMin % BIZ_DAY_MIN) / 60);
  return h && d < 7 ? `${d}d ${h}h` : `${d}d`;
}

// `visit` (Visit Scheduled only): { dateKey: 'YYYY-MM-DD', timeLabel?, source }
// — the caller resolves it from calendar_events, falling back to
// jobs.preferred_visit_date.
export function stageAge(job, { now = Date.now(), visit = null } = {}) {
  if (!job) return null;
  const status = job.pipeline_status || 'new_lead';
  const entered = toMs(job.stage_entered_at);

  switch (status) {
    case 'new_lead': {
      if (entered == null) return null;
      const min = businessMinutesBetween(entered, now);
      return {
        label: `${fmtBizSpan(min)} in stage`,
        title: `Time in New Lead. ${BUSINESS_HOURS_NOTE}`,
        tone: min > 60 ? 'late' : min >= 45 ? 'warn' : null,
      };
    }
    case 'contacted': {
      if (entered == null) return null;
      const ms = now - entered;
      return {
        label: `${fmtSpan(ms)} in stage`,
        title: 'Time since the card moved to Contacted.',
        tone: ms > 3 * DAY_MS ? 'late' : ms >= 2 * DAY_MS ? 'warn' : null,
      };
    }
    case 'visit_scheduled': {
      if (!visit?.dateKey) {
        return { label: 'No visit date', title: 'No sales visit on the calendar for this job.', tone: null };
      }
      const diff = daysBetweenKeys(nyDateKey(now), visit.dateKey); // > 0 = future
      const when = [formatDateKey(visit.dateKey), visit.timeLabel].filter(Boolean).join(' · ');
      const title = `Visit: ${when}${visit.source === 'lead' ? ' (preferred date on the lead)' : ''}`;
      if (diff > 1) return { label: `Visit in ${diff}d`, title, tone: null };
      if (diff === 1) return { label: 'Visit tomorrow', title, tone: null };
      if (diff === 0) return { label: `Visit today${visit.timeLabel ? ` · ${visit.timeLabel}` : ''}`, title, tone: 'warn' };
      return { label: `Visit was ${-diff}d ago`, title: `${title} — move the card to Visited once it's done.`, tone: 'late' };
    }
    case 'visited':
    case 'estimate_draft': {
      if (entered == null) return null;
      const min = businessMinutesBetween(entered, now);
      const days = min / BIZ_DAY_MIN;
      return {
        label: `${fmtBizSpan(min)} in stage`,
        title: `Business days in this stage. ${BUSINESS_HOURS_NOTE}`,
        tone: days > 5 ? 'late' : days >= 4 ? 'warn' : null,
      };
    }
    case 'estimate_sent':
    case 'estimate_negotiating': {
      const touch = toMs(job.last_touch_at);
      const since = Math.max(entered ?? -Infinity, touch ?? -Infinity);
      if (!Number.isFinite(since)) return null;
      const ms = now - since;
      const byTouch = touch != null && (entered == null || touch > entered);
      return {
        label: byTouch ? `${fmtSpan(ms)} since follow-up` : `${fmtSpan(ms)} in stage`,
        title: byTouch
          ? 'Time since the last follow-up note (My Leads → Last Touch).'
          : 'Time since the card entered this stage. A follow-up note resets it.',
        tone: ms > 7 * DAY_MS ? 'late' : ms >= 5 * DAY_MS ? 'warn' : null,
      };
    }
    default:
      return null;
  }
}

// Re-render tick so time-in-stage labels stay current (default: 1 min).
export function useNow(intervalMs = MIN_MS) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
