// TV slide 2 — This Month. The whole current month (New York time) as a
// calendar: month card with progress and a live "Next up" card on top, a
// Sun–Sat grid with every day's events as colored pills (as many as fit
// whole, then "+N more"; today's cell is solid orange), and the month's
// total + what each color means in a strip at the bottom. Cancelled visits
// are left out. Sized to be read from across the office.

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
// Nobody works Sunday and Saturday is a half day: Sunday is a thin strip
// (day number + a dot per event), Saturday is narrower, and the weekdays
// get the width so their events can be big.
const COLUMNS = 'minmax(0,0.24fr) repeat(5, minmax(0,1fr)) minmax(0,0.62fr)';
const OTHER_KIND = { label: 'Event', color: '#6B7280' };
const KIND_ORDER = [...Object.keys(EVENT_KIND_META), 'other'];
// Legend only — the two delivery labels are too long for a 4-up legend.
const LEGEND_LABEL = { material_delivery: 'Materials', cabinet_delivery: 'Cabinets' };
const EASE = [0.22, 1, 0.36, 1];

// Sizes without colors so they can be recolored here. Pills and day numbers
// are a step above the tvKit body text — they're what people read from the
// other side of the room.
const SIZE = {
  eyebrow: 'text-[clamp(11px,1.5vh,16px)]',
  meta:    'text-[clamp(12px,1.7vh,18px)]',
  label:   'text-[clamp(14px,2vh,22px)]',
  pill:    'text-[clamp(15px,2.4vh,28px)]',
  day:     'text-[clamp(16px,2.5vh,28px)]',
  week:    'text-[clamp(13px,1.9vh,22px)]',
  legend:  'text-[clamp(14px,2.1vh,24px)]',
};

const PILL = `relative flex-shrink-0 flex items-center gap-[0.4em] h-[1.2em] rounded-lg pl-[0.55em] pr-[0.4em] overflow-hidden ${SIZE.pill}`;

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

// ALL-CAPS titles ("OFFICE WEEKLY MEETING") read wider and harder from far
// away — show them in Title Case. Mixed-case titles are left alone.
function softenCaps(t) {
  if (!/[A-Z]{4}/.test(t) || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s/(&+-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

function eventName(title, fallback) {
  const t = String(title || '').trim().replace(PREFIX_RE, '').replace(SUFFIX_RE, '').trim();
  return softenCaps(t) || fallback;
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
    <div className={`${CARD} relative overflow-hidden flex-shrink-0 w-[clamp(260px,22vw,420px)] px-7 py-2 flex flex-col justify-center`}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(135deg, ${ORANGE}24 0%, ${ORANGE}00 65%)` }}
      />
      <div className="relative flex items-baseline justify-between gap-3">
        <p className="font-black leading-none tracking-tight text-[#111] whitespace-nowrap text-[clamp(26px,4vh,46px)]">{monthName}</p>
        <span className={`${T.meta} whitespace-nowrap leading-none`}>
          Day <span className="font-black text-[#111]">{dayOfMonth}</span> of {dim}
        </span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-black/[0.07] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-omega-orange"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 1, delay: 0.2, ease: EASE }}
        />
      </div>
    </div>
  );
}

// Bottom strip: the month's total, then what each color means (with how
// many of each this month). Moved down from the header so the grid and the
// Next-up card own the top of the screen.
function LegendStrip({ total, done, ahead, legend }) {
  return (
    <div className={`${CARD} flex-shrink-0 mt-2 px-7 py-1.5 flex items-center gap-7 min-w-0`}>
      <div className="flex items-baseline gap-2.5 flex-shrink-0">
        <CountUp value={total} className="font-black tabular-nums leading-none text-[#111] text-[clamp(22px,3.4vh,38px)]" />
        <span className={`${SIZE.legend} font-bold text-omega-slate whitespace-nowrap`}>
          {total === 1 ? 'event' : 'events'}{total ? ` · ${ahead} ahead · ${done} done` : ' this month'}
        </span>
      </div>
      {legend.length > 0 && <div className="w-px self-stretch bg-black/10 flex-shrink-0" />}
      <div className="flex-1 min-w-0 flex items-center gap-x-7 gap-y-1 flex-wrap">
        {legend.map((k) => (
          <div key={k.kind} className={`flex items-center gap-2.5 whitespace-nowrap ${SIZE.legend}`}>
            <span className="w-[0.7em] h-[0.7em] rounded-full flex-shrink-0" style={{ background: k.color }} />
            <span className="font-bold text-[#111]">{k.label}</span>
            <span className="font-black tabular-nums text-omega-stone">{k.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// One row so the header stays short and the grid gets the height:
// "NEXT UP / in 1h 26m" | event name | when · kind.
function NextCard({ next, now, todayCount, reduce }) {
  return (
    <div className={`${CARD} relative overflow-hidden flex-1 min-w-0 px-7 py-2 flex items-center gap-6`}>
      {next && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(135deg, ${next.color}26 0%, ${next.color}00 70%)` }}
        />
      )}
      <div className="relative flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="relative flex w-2.5 h-2.5 flex-shrink-0">
            {next && !reduce && <span className="absolute inset-0 rounded-full bg-omega-orange opacity-60 animate-ping" />}
            <span className={`relative w-2.5 h-2.5 rounded-full ${next ? 'bg-omega-orange' : 'bg-omega-fog'}`} />
          </span>
          <p className={`${T.eyebrow} whitespace-nowrap`}>Next up{todayCount > 0 ? ` · ${todayCount} today` : ''}</p>
        </div>
        {next && (
          <p className={`mt-1 font-extrabold uppercase tracking-wider text-omega-orange whitespace-nowrap ${SIZE.eyebrow}`}>
            {nextIn(next, now)}
          </p>
        )}
      </div>
      <div className="relative w-px self-stretch my-1 bg-black/10 flex-shrink-0" />
      <div className="relative flex-1 min-w-0 flex items-baseline gap-5">
        <p className="min-w-0 truncate font-black leading-tight text-[#111] text-[clamp(20px,3.2vh,36px)]">
          {next ? next.name : 'All clear'}
        </p>
        <span className={`flex-shrink-0 inline-flex items-center gap-2.5 whitespace-nowrap ${SIZE.label} font-semibold text-omega-slate`}>
          {next && <span className="w-3 h-3 rounded-full flex-shrink-0 self-center" style={{ background: next.color }} />}
          {next ? `${nextWhen(next, now)} · ${next.label}` : 'No more events this month'}
        </span>
      </div>
    </div>
  );
}

function Pill({ e, past, isNext, onToday, reduce }) {
  // On today's orange cell the pills turn white and the "next" ring dark.
  const ring = onToday ? '#111111' : ORANGE;
  const tip = [`${e.label}${e.time ? ` · ${formatNyTime(e.ms)}` : ''}`, e.name, e.location].filter(Boolean).join('\n');
  return (
    <motion.div
      className={`${PILL} ${past ? 'opacity-50' : ''}`}
      title={tip}
      style={{ background: onToday ? '#FFFFFF' : `${e.color}1F`, boxShadow: isNext ? `inset 0 0 0 2px ${ring}` : undefined }}
      animate={isNext && !reduce ? { boxShadow: [`inset 0 0 0 2px ${ring}`, `inset 0 0 0 2px ${ring}33`] } : undefined}
      transition={isNext ? { duration: 1.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' } : undefined}
    >
      <span className="absolute left-0 inset-y-0 w-[5px]" style={{ background: e.color }} />
      {e.time && (
        <span className="font-black tabular-nums leading-none flex-shrink-0" style={{ color: shade(e.color, 0.35) }}>
          {e.time}
        </span>
      )}
      <span className="font-bold text-[#111] leading-tight truncate min-w-0">{e.name}</span>
    </motion.div>
  );
}

function DayNumber({ d, reduce }) {
  const label = d.day === 1 ? `${keyLabel(d.key, { month: 'short' })} 1` : d.day;
  if (d.isToday) {
    return (
      <motion.span
        className={`inline-flex items-center justify-center rounded-full bg-white text-omega-orange px-2.5 h-full min-w-[clamp(26px,3vh,34px)] font-black tabular-nums leading-none whitespace-nowrap ${SIZE.day}`}
        animate={reduce ? undefined : { boxShadow: ['0 0 0 0 rgba(255,255,255,0.7)', '0 0 0 8px rgba(255,255,255,0)'] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
      >
        {label}
      </motion.span>
    );
  }
  return (
    <span className={`pl-1 font-black tabular-nums leading-none whitespace-nowrap ${SIZE.day} ${d.inMonth ? 'text-[#111]' : 'text-omega-fog'}`}>
      {label}
    </span>
  );
}

function DayCell({ d, index, cap, nextId, now, reduce }) {
  if (index % 7 === 0) return <SundayCell d={d} index={index} reduce={reduce} />;
  const n = d.events.length;
  const shown = n > cap ? d.events.slice(0, cap) : d.events;
  const more = n - shown.length;

  const look = d.isToday
    ? 'border-2 border-omega-orange bg-omega-orange shadow-card-hover'
    : !d.inMonth
      ? 'border border-dashed border-black/[0.09] bg-transparent'
      : d.weekend
        ? 'border border-black/[0.05] bg-[#F3F2EC]'
        : 'border border-black/[0.05] bg-white shadow-card';
  const fade = !d.inMonth ? 'opacity-40' : d.isPast ? 'opacity-60' : '';

  return (
    <motion.div
      className={`relative min-h-0 min-w-0 rounded-2xl flex flex-col px-2 pt-1 pb-1.5 ${look}`}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.012, ease: EASE }}
    >
      <div className={`relative flex-shrink-0 h-[clamp(24px,2.7vh,30px)] flex items-center justify-between gap-2 ${fade}`}>
        <DayNumber d={d} reduce={reduce} />
        {more > 0 ? (
          <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 border border-black/[0.08] font-bold leading-tight whitespace-nowrap ${SIZE.meta} ${d.isToday ? 'bg-white text-omega-orange' : 'bg-omega-cloud text-omega-slate'}`}>
            +{more} more
          </span>
        ) : d.isToday ? (
          <span className={`flex-shrink-0 pr-1 font-black uppercase tracking-wider text-white ${SIZE.label}`}>Today</span>
        ) : null}
      </div>
      <div data-cell-body className={`relative flex-1 min-h-0 mt-1 flex flex-col gap-[2px] overflow-hidden ${fade}`}>
        {shown.map((e) => (
          <Pill key={e.id} e={e} past={d.isToday && e.ms < now} isNext={e.id === nextId} onToday={d.isToday} reduce={reduce} />
        ))}
      </div>
    </motion.div>
  );
}

// Thin Sunday column: just the day number and one colored dot per event.
function SundayCell({ d, index, reduce }) {
  const look = d.isToday
    ? 'border-2 border-omega-orange bg-omega-orange'
    : !d.inMonth
      ? 'border border-dashed border-black/[0.09] bg-transparent'
      : 'border border-black/[0.05] bg-[#F3F2EC]';
  const fade = !d.inMonth ? 'opacity-40' : d.isPast ? 'opacity-60' : '';
  return (
    <motion.div
      className={`relative min-h-0 min-w-0 rounded-2xl flex flex-col items-center pt-1 pb-1.5 ${look}`}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.012, ease: EASE }}
    >
      <div className={`flex-shrink-0 h-[clamp(24px,2.7vh,30px)] flex items-center ${fade}`}>
        <span className={`font-black tabular-nums leading-none ${SIZE.day} ${d.isToday ? 'text-white' : d.inMonth ? 'text-omega-slate' : 'text-omega-fog'}`}>
          {d.day}
        </span>
      </div>
      <div className={`flex-1 min-h-0 mt-1 flex flex-col items-center gap-1.5 overflow-hidden ${fade}`}>
        {d.events.slice(0, 4).map((e) => (
          <span key={e.id} title={e.name} className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.color }} />
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
      className="relative flex-1 min-h-0 grid gap-1.5"
      style={{ gridTemplateColumns: COLUMNS, gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
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
      <div className="flex gap-4 flex-shrink-0 h-[clamp(58px,6.8vh,76px)]">
        <MonthCard
          monthName={view.monthName}
          dayOfMonth={view.dayOfMonth}
          dim={view.dim}
          progress={view.progress}
          reduce={reduce}
        />
        <NextCard next={view.next} now={now} todayCount={view.todayCount} reduce={reduce} />
      </div>

      <div className="grid gap-1.5 flex-shrink-0 mt-2 mb-1" style={{ gridTemplateColumns: COLUMNS }}>
        {WEEKDAYS.map((w, i) => (
          <p
            key={w}
            className={`font-extrabold uppercase tracking-wider truncate ${SIZE.week} ${i === 0 ? 'text-center' : 'px-3'} ${i === view.todayDow ? 'text-omega-orange' : 'text-omega-slate'}`}
          >
            {w}
          </p>
        ))}
      </div>

      <MonthGrid days={view.days} weeks={view.weeks} nextId={view.next?.id} now={now} reduce={reduce} />

      <LegendStrip total={view.total} done={view.done} ahead={view.ahead} legend={view.legend} />
    </div>
  );
}
