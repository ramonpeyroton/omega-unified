// TV slide 2 — This Month. The whole current month (New York time) as a
// calendar: month card with progress, total + kind mix (bar + legend), a
// live "Next up" card, and a Sun–Sat grid with every day's events as
// colored pills (as many as fit whole, then "+N more"). Cancelled visits
// are left out.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { EVENT_KIND_META } from '../../../../shared/lib/calendar';
import { nyDateKey, nyMidnightMs, formatNyTime } from '../../../../shared/lib/stageAge';
import {
  TZ, ORANGE, DAY_MS, HOUR_MS, T, CARD, CountUp, SlideLoading,
  toMs, plural, daysFromToday, nextDayKey,
} from './tvKit';

export const meta = {
  key: 'calendar',
  title: 'This Month',
  eyebrow: 'Calendar',
  icon: CalendarDays,
  tables: ['calendar_events'],
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const OTHER_KIND = { label: 'Event', color: '#6B7280' };
const KIND_ORDER = [...Object.keys(EVENT_KIND_META), 'other'];
// Legend only — the two delivery labels are too long for a 4-up legend.
const LEGEND_LABEL = { material_delivery: 'Materials', cabinet_delivery: 'Cabinets' };
const EASE = [0.22, 1, 0.36, 1];

// Same steps as the tvKit ramp (T.eyebrow / T.meta / T.label), without
// their colors so they can be recolored here.
const SIZE = {
  eyebrow: 'text-[clamp(11px,1.5vh,16px)]',
  meta:    'text-[clamp(12px,1.7vh,18px)]',
  label:   'text-[clamp(14px,2vh,22px)]',
};

const PILL = `relative flex-shrink-0 flex items-center gap-[0.4em] h-[1.6em] rounded-lg pl-[0.6em] pr-[0.45em] overflow-hidden ${SIZE.meta}`;

const TIME_FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });

function kindMeta(kind) {
  return EVENT_KIND_META[kind] || OTHER_KIND;
}

// 10a · 2:30p · 12p. A start at exactly midnight reads as untimed → no label.
function shortTime(ms) {
  const parts = TIME_FMT.formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const h = get('hour');
  const m = get('minute');
  const pm = get('dayPeriod').toLowerCase().startsWith('p');
  if (!pm && h === '12' && m === '00') return '';
  return `${h}${m && m !== '00' ? `:${m}` : ''}${pm ? 'p' : 'a'}`;
}

// Titles are auto-built as "Client — Sales Visit" (EventForm) or
// "Visit: Client" (NewJob). Keep just the client / name.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KIND_LABELS = [...new Set([...Object.values(EVENT_KIND_META).map((k) => k.label), 'Visit'])]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join('|');
const PREFIX_RE = new RegExp(`^(?:${KIND_LABELS})(?:\\s*:|\\s+[—–-])\\s*`, 'i');
const SUFFIX_RE = new RegExp(`\\s+[—–-]\\s+(?:${KIND_LABELS})\\s*$`, 'i');

function eventName(title, fallback) {
  const t = String(title || '').trim().replace(PREFIX_RE, '').replace(SUFFIX_RE, '').trim();
  return t || fallback;
}

// Darker stop of a kind color, for the time text on its own light tint.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c) => Math.round(c * (1 - amt)).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

// Plain calendar arithmetic on 'YYYY-MM-DD' keys (no timezone involved).
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function keyLabel(key, opts) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

// First Sunday on/before the 1st → last Saturday on/after the last day.
function monthGrid(now) {
  const todayKey = nyDateKey(now);
  const [y, m] = todayKey.split('-').map(Number);
  const first = `${todayKey.slice(0, 7)}-01`;
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((lead + dim) / 7);
  const start = addDays(first, -lead);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  return { todayKey, prefix: todayKey.slice(0, 7), first, dim, weeks, days, start, end: days[days.length - 1] };
}

export async function load(now = Date.now()) {
  const g = monthGrid(now);
  // A few hours of slack on both ends: nyMidnightMs is an hour off on a DST
  // switch day. Events are bucketed by their own NY date afterwards.
  const from = nyMidnightMs(g.start) - 3 * HOUR_MS;
  const to = nyMidnightMs(nextDayKey(g.end)) + 3 * HOUR_MS;
  const { data, error } = await supabase
    .from('calendar_events')
    .select('id, title, starts_at, kind, visit_status, location, job_id')
    .gte('starts_at', new Date(from).toISOString())
    .lt('starts_at', new Date(to).toISOString())
    .order('starts_at', { ascending: true })
    .limit(2000);
  if (error) throw error;

  const events = [];
  for (const e of data || []) {
    if (e.visit_status === 'cancelled') continue;
    const ms = toMs(e.starts_at);
    if (ms == null) continue;
    const km = kindMeta(e.kind);
    events.push({
      id: e.id,
      ms,
      key: nyDateKey(ms),
      kind: EVENT_KIND_META[e.kind] ? e.kind : 'other',
      label: km.label,
      color: km.color,
      name: eventName(e.title, km.label),
      time: shortTime(ms),
      location: e.location || '',
    });
  }
  events.sort((a, b) => a.ms - b.ms);
  return { events, loadedAt: now };
}

// ─── View model ─────────────────────────────────────────────────────
function buildView(data, now) {
  const g = monthGrid(now);
  const events = Array.isArray(data?.events) ? data.events : [];

  const byDay = {};
  for (const e of events) (byDay[e.key] ||= []).push(e);

  const inMonth = events.filter((e) => e.key.startsWith(g.prefix));
  const counts = {};
  for (const e of inMonth) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const legend = Object.entries(counts)
    .map(([kind, n]) => {
      const km = kind === 'other' ? OTHER_KIND : kindMeta(kind);
      return { kind, n, color: km.color, label: LEGEND_LABEL[kind] || km.label };
    })
    .sort((a, b) => b.n - a.n || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const total = inMonth.length;
  const done = inMonth.filter((e) => e.ms < now).length;
  const next = events.find((e) => e.ms >= now && e.key <= g.end) || null;

  const days = g.days.map((key, i) => ({
    key,
    day: Number(key.slice(8)),
    inMonth: key.startsWith(g.prefix),
    isToday: key === g.todayKey,
    isPast: key < g.todayKey,
    weekend: i % 7 === 0 || i % 7 === 6,
    events: byDay[key] || [],
  }));

  const dayOfMonth = Number(g.todayKey.slice(8));
  const dayFrac = Math.min(1, Math.max(0, (now - nyMidnightMs(g.todayKey)) / DAY_MS));

  return {
    monthName: keyLabel(g.first, { month: 'long' }),
    dayOfMonth,
    dim: g.dim,
    progress: Math.min(100, ((dayOfMonth - 1 + dayFrac) / g.dim) * 100),
    todayDow: new Date(`${g.todayKey}T12:00:00Z`).getUTCDay(),
    weeks: g.weeks,
    days,
    legend,
    total,
    done,
    ahead: total - done,
    next,
    todayCount: (byDay[g.todayKey] || []).length,
  };
}

function nextWhen(e, now) {
  const days = daysFromToday(e.key, now);
  const clock = formatNyTime(e.ms);
  if (days === 0) return `Today · ${clock}`;
  if (days === 1) return `Tomorrow · ${clock}`;
  return `${keyLabel(e.key, { weekday: 'short', month: 'short', day: 'numeric' })} · ${clock}`;
}

function nextIn(e, now) {
  const mins = Math.max(0, Math.round((e.ms - now) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m && h < 6 ? `in ${h}h ${m}m` : `in ${Math.round(mins / 60)}h`;
  }
  return `in ${plural(Math.max(1, daysFromToday(e.key, now)), 'day', 'days')}`;
}

// How many pills fit whole in a day cell. Rows are equal, but today's
// thicker border makes its body a couple px shorter — use the smallest body
// so no cell ever shows a half-cut pill.
function usePillCapacity(weeks) {
  const ref = useRef(null);
  const [cap, setCap] = useState(3);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return undefined;
    const measure = () => {
      const bodies = grid.querySelectorAll('[data-cell-body]');
      const probe = grid.querySelector('[data-pill-probe]');
      if (!bodies.length || !probe) return;
      const pill = probe.getBoundingClientRect().height;
      if (!pill) return;
      const gap = parseFloat(getComputedStyle(bodies[0]).rowGap) || 0;
      let avail = Infinity;
      for (const b of bodies) avail = Math.min(avail, b.getBoundingClientRect().height);
      const fit = Math.max(0, Math.floor((avail + gap + 0.01) / (pill + gap)));
      setCap((c) => (c === fit ? c : fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [weeks]);
  return [ref, cap];
}

// ─── Pieces ─────────────────────────────────────────────────────────
function MonthCard({ monthName, dayOfMonth, dim, progress, reduce }) {
  return (
    <div className={`${CARD} relative overflow-hidden flex-shrink-0 w-[clamp(270px,22vw,430px)] px-7 py-2 flex flex-col justify-center`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(135deg, ${ORANGE}24 0%, ${ORANGE}00 65%)` }}
      />
      <p className={`relative ${T.big} text-[#111] whitespace-nowrap`}>{monthName}</p>
      <div className="relative mt-2.5 flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-black/[0.07] overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-omega-orange"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, delay: 0.2, ease: EASE }}
          />
        </div>
        <span className={`${T.meta} whitespace-nowrap leading-none`}>
          Day <span className="font-black text-[#111]">{dayOfMonth}</span> of {dim}
        </span>
      </div>
    </div>
  );
}

// Share of each kind this month — segments grow in on entrance.
function MixBar({ legend, reduce }) {
  return (
    <div className="flex gap-1 w-full h-[clamp(8px,1.1vh,12px)]">
      {legend.map((k, i) => (
        <motion.div
          key={k.kind}
          className="h-full rounded-full min-w-[6px]"
          style={{ background: k.color, flexBasis: 0, flexShrink: 1 }}
          initial={reduce ? false : { flexGrow: 0.001 }}
          animate={{ flexGrow: k.n }}
          transition={{ duration: 0.9, delay: 0.25 + i * 0.06, ease: EASE }}
        />
      ))}
    </div>
  );
}

function Legend({ legend }) {
  const rows = legend.length <= 3 ? 1 : 2;
  const cols = Math.ceil(legend.length / rows);
  return (
    <div
      className="grid gap-x-6 gap-y-1.5 justify-start min-w-0"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, max-content))` }}
    >
      {legend.map((k) => (
        <div key={k.kind} className="flex items-center gap-2 min-w-0">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: k.color }} />
          <span className={`${SIZE.meta} font-bold text-[#111] truncate`}>{k.label}</span>
          <span className={`${SIZE.meta} font-black tabular-nums text-omega-stone flex-shrink-0`}>{k.n}</span>
        </div>
      ))}
    </div>
  );
}

function TotalCard({ total, done, ahead, legend, reduce }) {
  return (
    <div className={`${CARD} flex-1 min-w-0 overflow-hidden px-7 py-2 flex items-center gap-7`}>
      <div className="flex-shrink-0">
        <div className="flex items-baseline gap-2.5">
          <CountUp value={total} className={`${T.big} text-[#111]`} />
          <span className={`${T.title} text-omega-stone`}>{total === 1 ? 'event' : 'events'}</span>
        </div>
        <p className={`${T.eyebrow} mt-1.5 whitespace-nowrap`}>
          {total ? `${ahead} ahead · ${done} done` : 'this month'}
        </p>
      </div>
      <div className="w-px self-stretch my-3 bg-black/10 flex-shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-3">
        {total > 0 ? (
          <>
            <MixBar legend={legend} reduce={reduce} />
            <Legend legend={legend} />
          </>
        ) : (
          <p className={T.body}>Nothing on the calendar yet this month.</p>
        )}
      </div>
    </div>
  );
}

function NextCard({ next, now, todayCount, reduce }) {
  return (
    <div className={`${CARD} relative overflow-hidden flex-shrink-0 w-[clamp(250px,19vw,370px)] px-6 py-2 flex flex-col justify-center`}>
      {next && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(135deg, ${next.color}26 0%, ${next.color}00 70%)` }}
        />
      )}
      <div className="relative flex items-center gap-2.5 min-w-0">
        <span className="relative flex w-2.5 h-2.5 flex-shrink-0">
          {next && !reduce && <span className="absolute inset-0 rounded-full bg-omega-orange opacity-60 animate-ping" />}
          <span className={`relative w-2.5 h-2.5 rounded-full ${next ? 'bg-omega-orange' : 'bg-omega-fog'}`} />
        </span>
        <p className={`${T.eyebrow} truncate min-w-0`}>
          Next up{todayCount > 0 ? ` · ${todayCount} today` : ''}
        </p>
        {next && (
          <p className={`ml-auto flex-shrink-0 font-extrabold uppercase tracking-wider text-omega-orange whitespace-nowrap ${SIZE.eyebrow}`}>
            {nextIn(next, now)}
          </p>
        )}
      </div>
      {next ? (
        <>
          <p className={`relative ${T.title} text-[#111] truncate mt-1`}>{next.name}</p>
          <div className="relative flex items-center gap-2 min-w-0 mt-0.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: next.color }} />
            <span className={`${T.meta} truncate`}>{nextWhen(next, now)} · {next.label}</span>
          </div>
        </>
      ) : (
        <>
          <p className={`relative ${T.title} text-[#111] truncate mt-1`}>All clear</p>
          <p className={`relative ${T.meta} truncate mt-0.5`}>No more events this month</p>
        </>
      )}
    </div>
  );
}

function Pill({ e, past, isNext, reduce }) {
  const tip = [`${e.label}${e.time ? ` · ${formatNyTime(e.ms)}` : ''}`, e.name, e.location].filter(Boolean).join('\n');
  return (
    <motion.div
      className={`${PILL} ${past ? 'opacity-50' : ''}`}
      title={tip}
      style={{ background: `${e.color}1F`, boxShadow: isNext ? `inset 0 0 0 2px ${ORANGE}` : undefined }}
      animate={isNext && !reduce ? { boxShadow: [`inset 0 0 0 2px ${ORANGE}`, `inset 0 0 0 2px ${ORANGE}33`] } : undefined}
      transition={isNext ? { duration: 1.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' } : undefined}
    >
      <span className="absolute left-0 inset-y-0 w-[4px]" style={{ background: e.color }} />
      {e.time && (
        <span className="font-black tabular-nums leading-none flex-shrink-0" style={{ color: shade(e.color, 0.35) }}>
          {e.time}
        </span>
      )}
      <span className="font-semibold text-[#111] leading-tight truncate min-w-0">{e.name}</span>
    </motion.div>
  );
}

function DayNumber({ d, reduce }) {
  const label = d.day === 1 ? `${keyLabel(d.key, { month: 'short' })} 1` : d.day;
  if (d.isToday) {
    return (
      <motion.span
        className={`inline-flex items-center justify-center rounded-full bg-omega-orange text-white px-2 h-full min-w-[clamp(24px,3vh,32px)] font-black tabular-nums leading-none whitespace-nowrap ${SIZE.label}`}
        animate={reduce ? undefined : { boxShadow: [`0 0 0 0 ${ORANGE}66`, `0 0 0 8px ${ORANGE}00`] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
      >
        {label}
      </motion.span>
    );
  }
  return (
    <span className={`pl-1 font-black tabular-nums leading-none whitespace-nowrap ${SIZE.label} ${d.inMonth ? 'text-[#111]' : 'text-omega-fog'}`}>
      {label}
    </span>
  );
}

function DayCell({ d, index, cap, nextId, now, reduce }) {
  const n = d.events.length;
  const shown = n > cap ? d.events.slice(0, cap) : d.events;
  const more = n - shown.length;

  const look = d.isToday
    ? 'border-2 border-omega-orange bg-white shadow-card-hover'
    : !d.inMonth
      ? 'border border-dashed border-black/[0.09] bg-transparent'
      : d.weekend
        ? 'border border-black/[0.05] bg-[#F3F2EC]'
        : 'border border-black/[0.05] bg-white shadow-card';
  const fade = !d.inMonth ? 'opacity-40' : d.isPast ? 'opacity-60' : '';

  return (
    <motion.div
      className={`relative min-h-0 min-w-0 rounded-2xl flex flex-col px-2 pt-1.5 pb-2 ${look}`}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.012, ease: EASE }}
    >
      {d.isToday && (
        <div
          className="absolute inset-0 rounded-[18px] pointer-events-none"
          style={{ background: `linear-gradient(180deg, ${ORANGE}1F 0%, ${ORANGE}00 70%)` }}
        />
      )}
      <div className={`relative flex-shrink-0 h-[clamp(24px,3vh,32px)] flex items-center justify-between gap-2 ${fade}`}>
        <DayNumber d={d} reduce={reduce} />
        {more > 0 ? (
          <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 bg-omega-cloud border border-black/[0.08] text-omega-slate font-bold leading-tight whitespace-nowrap ${SIZE.meta}`}>
            +{more} more
          </span>
        ) : d.isToday ? (
          <span className={`flex-shrink-0 pr-1 font-extrabold uppercase tracking-wider text-omega-orange ${SIZE.eyebrow}`}>Today</span>
        ) : null}
      </div>
      <div data-cell-body className={`relative flex-1 min-h-0 mt-1 flex flex-col gap-[3px] overflow-hidden ${fade}`}>
        {shown.map((e) => (
          <Pill key={e.id} e={e} past={d.isToday && e.ms < now} isNext={e.id === nextId} reduce={reduce} />
        ))}
      </div>
    </motion.div>
  );
}

function MonthGrid({ days, weeks, nextId, now, reduce }) {
  const [ref, cap] = usePillCapacity(weeks);
  return (
    <div
      ref={ref}
      className="relative flex-1 min-h-0 grid grid-cols-7 gap-1.5"
      style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
    >
      {days.map((d, i) => (
        <DayCell key={d.key} d={d} index={i} cap={cap} nextId={nextId} now={now} reduce={reduce} />
      ))}
      <div aria-hidden className="absolute left-0 top-0 invisible pointer-events-none">
        <div data-pill-probe className={PILL}>10a Probe</div>
      </div>
    </div>
  );
}

export default function CalendarSlide({ data, now = Date.now() }) {
  const reduce = useReducedMotion();
  const view = useMemo(() => (data ? buildView(data, now) : null), [data, now]);
  if (!view) return <SlideLoading />;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex gap-4 flex-shrink-0 h-[clamp(84px,11vh,120px)]">
        <MonthCard
          monthName={view.monthName}
          dayOfMonth={view.dayOfMonth}
          dim={view.dim}
          progress={view.progress}
          reduce={reduce}
        />
        <TotalCard total={view.total} done={view.done} ahead={view.ahead} legend={view.legend} reduce={reduce} />
        <NextCard next={view.next} now={now} todayCount={view.todayCount} reduce={reduce} />
      </div>

      <div className="grid grid-cols-7 gap-1.5 flex-shrink-0 mt-4 mb-1.5">
        {WEEKDAYS.map((w, i) => (
          <p
            key={w}
            className={`px-3 font-bold uppercase tracking-wider ${SIZE.eyebrow} ${i === view.todayDow ? 'text-omega-orange' : 'text-omega-stone'}`}
          >
            {w}
          </p>
        ))}
      </div>

      <MonthGrid days={view.days} weeks={view.weeks} nextId={view.next?.id} now={now} reduce={reduce} />
    </div>
  );
}
