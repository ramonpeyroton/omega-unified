// TV slide 2 — Calendar. Always three Mon–Sun weeks (New York time): last
// week, THIS week and next week. The middle row is the current week — twice
// as tall as the other two, the only one with a highlighted edge and big
// two-line events; last and next week are quiet half-height rows (Ramon,
// 02/10). Every day's events are colored pills (as many as fit whole, then
// "+N more"; today's cell is light orange; the next event pulses), then a
// small strip with the range, its totals and what each color means. Pills
// lead with the client's name (from the job when the event has one) so they
// read from across the office. Cancelled visits are left out.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { EVENT_KIND_META } from '../../../../shared/lib/calendar';
import { nyDateKey, nyMidnightMs, formatNyTime } from '../../../../shared/lib/stageAge';
import {
  TZ, ORANGE, HOUR_MS, CARD, SlideLoading,
  toMs, nextDayKey,
} from './tvKit';

export const meta = {
  key: 'calendar',
  title: 'Calendar',
  eyebrow: 'Calendar',
  icon: CalendarDays,
  tables: ['calendar_events'],
};

// The week runs Monday → Sunday, so the weekend sits together on the right.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUN = 6; // column index of Sunday
// Saturday is a half day (narrower) and nobody works Sunday (a thin strip
// with the day number and a dot per event), so the weekdays get the width
// and their events can be big.
const COLUMNS = 'repeat(5, minmax(0,1fr)) minmax(0,0.62fr) minmax(0,0.24fr)';
const TODAY_BG = '#FCEBDF'; // light orange — today's cell
// Last week and next week are exactly as tall as their busiest day needs
// (the row ends right under its last event — no gap, no "+N more"); this
// week takes all the rest. Until that's measured: half / double / half.
const ROWS = 'minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)';
// …but an outer row never takes more than this share of the grid, so this
// week always stays the big one (past that, "+N more" kicks in).
const OUTER_MAX = 0.3;
const WEEKS = 3;
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
  pill:    'text-[clamp(14px,2.2vh,26px)]',
  pillBig: 'text-[clamp(16px,2.6vh,30px)]',
  day:     'text-[clamp(16px,2.5vh,28px)]',
  week:    'text-[clamp(13px,1.9vh,22px)]',
  legend:  'text-[clamp(12px,1.7vh,19px)]',
};

const PILL_BASE = 'relative flex-shrink-0 flex items-center gap-[0.4em] h-[1.2em] rounded-lg pl-[0.55em] pr-[0.4em] overflow-hidden';
const PILL = `${PILL_BASE} ${SIZE.pill}`;
// This week's and next week's events are two-line cards: time + client on
// top, what it is underneath — so the client's name doesn't get cut. This
// week uses the big size; next week the regular one. Last week stays on a
// single line.
const PILL_2L = 'relative flex-shrink-0 flex items-center h-[2.05em] rounded-lg pl-[0.55em] pr-[0.4em] overflow-hidden';
const PILL_BIG = `${PILL_2L} ${SIZE.pillBig}`;
const PILL_TWO = `${PILL_2L} ${SIZE.pill}`;
const PILL_CLASS = { big: PILL_BIG, two: PILL_TWO, one: PILL };

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

// For an event tied to a job: what's left of the title once the client's
// name is taken out — "Plumbing Start at Megan Flores" → "Plumbing Start",
// "Fabuwood Delivery Keisha (boxes)" → "Fabuwood Delivery (boxes)". A title
// that is just the client's name leaves nothing.
function eventDetail(name, client, kindLabel) {
  let t = name;
  if (/\sat\s/i.test(t)) t = t.replace(/\s+at\s+.+$/i, '');
  t = t.replace(new RegExp(escapeRe(client), 'ig'), ' ');
  t = t.replace(/\(\s*\)/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s—–:·-]+|[\s—–:·-]+$/g, '').trim();
  if (!t || t.toLowerCase() === kindLabel.toLowerCase()) return '';
  return t;
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

// Monday of last week → Sunday of next week (3 rows).
function rangeGrid(now) {
  const todayKey = nyDateKey(now);
  const dow = (new Date(`${todayKey}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(todayKey, -dow - 7);
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i));
  return { todayKey, dow, days, start, end: days[days.length - 1], focusStart: addDays(start, 7), focusEnd: addDays(start, 13) };
}

export async function load(now = Date.now()) {
  const g = rangeGrid(now);
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

  // Client names for events tied to a job — the pill leads with them.
  const jobIds = [...new Set((data || []).map((e) => e.job_id).filter(Boolean))];
  let clientByJob = {};
  if (jobIds.length) {
    const { data: jobs } = await supabase.from('jobs').select('id, client_name').in('id', jobIds);
    clientByJob = Object.fromEntries((jobs || []).map((j) => [j.id, (j.client_name || '').trim()]));
  }

  const events = [];
  for (const e of data || []) {
    if (e.visit_status === 'cancelled') continue;
    const ms = toMs(e.starts_at);
    if (ms == null) continue;
    const km = kindMeta(e.kind);
    const name = eventName(e.title, km.label);
    const client = clientByJob[e.job_id] || '';
    const detail = client ? eventDetail(name, client, km.label) : '';
    events.push({
      id: e.id,
      ms,
      key: nyDateKey(ms),
      kind: EVENT_KIND_META[e.kind] ? e.kind : 'other',
      label: km.label,
      color: km.color,
      name: client ? (detail ? `${client} · ${detail}` : client) : name,
      client,
      detail,
      time: shortTime(ms),
      location: e.location || '',
    });
  }
  events.sort((a, b) => a.ms - b.ms);
  return { events, loadedAt: now };
}

// ─── View model ─────────────────────────────────────────────────────
function buildView(data, now) {
  const g = rangeGrid(now);
  const events = (Array.isArray(data?.events) ? data.events : [])
    .filter((e) => e.key >= g.start && e.key <= g.end);

  const byDay = {};
  for (const e of events) (byDay[e.key] ||= []).push(e);

  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const legend = Object.entries(counts)
    .map(([kind, n]) => {
      const km = kind === 'other' ? OTHER_KIND : kindMeta(kind);
      return { kind, n, color: km.color, label: LEGEND_LABEL[kind] || km.label };
    })
    .sort((a, b) => b.n - a.n || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const total = events.length;
  const done = events.filter((e) => e.ms < now).length;
  const next = events.find((e) => e.ms >= now) || null;

  const days = g.days.map((key, i) => ({
    key,
    day: Number(key.slice(8)),
    inMonth: true,
    isToday: key === g.todayKey,
    isPast: key < g.todayKey,
    focus: key >= g.focusStart && key <= g.focusEnd, // this week
    pillSize: key >= g.focusStart && key <= g.focusEnd ? 'big' : key > g.focusEnd ? 'two' : 'one',
    weekend: i % 7 >= 5,
    events: byDay[key] || [],
  }));

  const short = { month: 'short', day: 'numeric' };
  return {
    rangeLabel: `${keyLabel(g.start, short)} – ${keyLabel(g.end, short)}`,
    todayDow: g.dow,
    days,
    legend,
    total,
    done,
    ahead: total - done,
    next,
  };
}

// How many pills fit whole in each day cell. Rows have different heights
// and each week uses its own pill size, so it's worked out per cell from its
// own body height and the matching probe pill.
function useCellCaps(ref, days) {
  const [caps, setCaps] = useState({});
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return undefined;
    const measure = () => {
      const probe = {};
      for (const el of grid.querySelectorAll('[data-pill-probe]')) {
        probe[el.dataset.pillProbe] = el.getBoundingClientRect().height;
      }
      if (!probe.big || !probe.two || !probe.one) return;
      const next = {};
      for (const b of grid.querySelectorAll('[data-cell-body]')) {
        const pill = probe[b.dataset.size] || probe.one;
        const gap = parseFloat(getComputedStyle(b).rowGap) || 0;
        next[b.dataset.key] = Math.max(0, Math.floor((b.getBoundingClientRect().height + gap + 0.01) / (pill + gap)));
      }
      setCaps((prev) => {
        const same = Object.keys(next).length === Object.keys(prev).length
          && Object.keys(next).every((k) => prev[k] === next[k]);
        return same ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    grid.querySelectorAll('[data-cell-body]').forEach((b) => ro.observe(b));
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [ref, days]);
  return caps;
}

// Pixel heights for the last-week and next-week rows: the cell chrome (day
// number, padding) plus as many pills as that week's busiest weekday has.
function useOuterRows(ref, days) {
  const [rows, setRows] = useState(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return undefined;
    const busiest = (from) => Math.max(1, ...days.slice(from, from + 7)
      .filter((_, i) => i !== SUN)
      .map((d) => d.events.length));
    const measure = () => {
      const pill = (size) => grid.querySelector(`[data-pill-probe="${size}"]`)?.getBoundingClientRect().height || 0;
      const bodies = [...grid.querySelectorAll('[data-cell-body]')];
      if (!bodies.length || !pill('one') || !pill('two')) return;
      const gap = parseFloat(getComputedStyle(bodies[0]).rowGap) || 0;
      const chrome = Math.max(...bodies.map((b) => b.parentElement.getBoundingClientRect().height - b.getBoundingClientRect().height));
      const need = (n, h) => Math.ceil(chrome + n * h + (n - 1) * gap + 1);
      const rowGap = parseFloat(getComputedStyle(grid).rowGap) || 0;
      const max = (grid.clientHeight - 2 * rowGap) * OUTER_MAX;
      const top = Math.min(need(busiest(0), pill('one')), max);
      const bottom = Math.min(need(busiest(14), pill('two')), max);
      setRows((prev) => (prev && prev[0] === top && prev[1] === bottom ? prev : [top, bottom]));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [ref, days]);
  return rows ? `${rows[0]}px minmax(0,1fr) ${rows[1]}px` : ROWS;
}

// Bottom strip, all one small size: the dates on screen and their totals,
// then what each color means (with how many of each).
function LegendStrip({ rangeLabel, total, done, ahead, legend }) {
  return (
    <div className={`${CARD} flex-shrink-0 mt-2 px-6 py-2 flex items-center gap-6 min-w-0 ${SIZE.legend}`}>
      <p className="flex-shrink-0 whitespace-nowrap font-normal text-[#5F5F5B]">
        <span className="font-extrabold tracking-[-0.015em] text-[#141413]">{rangeLabel}</span>
        {' · '}
        <span className="font-extrabold text-[#141413]">{total}</span> {total === 1 ? 'event' : 'events'}
        {total ? ` · ${ahead} ahead · ${done} done` : ''}
      </p>
      {legend.length > 0 && <div className="w-px self-stretch bg-black/10 flex-shrink-0" />}
      <div className="flex-1 min-w-0 flex items-center gap-x-6 gap-y-1 flex-wrap">
        {legend.map((k) => (
          <div key={k.kind} className="flex items-center gap-2 whitespace-nowrap">
            <span className="w-[0.75em] h-[0.75em] rounded-full flex-shrink-0" style={{ background: k.color }} />
            <span className="font-medium text-[#3A3A37]">{k.label}</span>
            <span className="font-semibold tabular-nums text-omega-stone">{k.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ e, past, isNext, size = 'one', reduce }) {
  const ring = ORANGE;
  const tip = [`${e.label}${e.time ? ` · ${formatNyTime(e.ms)}` : ''}`, e.name, e.location].filter(Boolean).join('\n');
  const time = e.time && (
    <span className="font-bold tabular-nums leading-none flex-shrink-0" style={{ color: shade(e.color, 0.35) }}>
      {e.time}
    </span>
  );
  return (
    <motion.div
      className={`${PILL_CLASS[size] || PILL} ${past ? 'opacity-50' : ''}`}
      title={tip}
      style={{ background: `${e.color}1F`, boxShadow: isNext ? `inset 0 0 0 2px ${ring}` : undefined }}
      animate={isNext && !reduce ? { boxShadow: [`inset 0 0 0 2px ${ring}`, `inset 0 0 0 2px ${ring}33`] } : undefined}
      transition={isNext ? { duration: 1.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' } : undefined}
    >
      <span className="absolute left-0 inset-y-0 w-[5px]" style={{ background: e.color }} />
      {size !== 'one' ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-[0.35em] min-w-0 leading-[1.05]">
            {time}
            <span className="font-semibold tracking-[-0.01em] text-[#141413] truncate min-w-0">{e.client || e.name}</span>
          </div>
          <p className="text-[0.82em] font-normal text-[#5F5F5B] leading-[1.15] truncate">
            {e.client ? (e.detail || e.label) : e.label}
          </p>
        </div>
      ) : (
        <>
          {time}
          <span className="leading-tight truncate min-w-0">
            {e.client ? (
              <>
                <span className="font-semibold tracking-[-0.01em] text-[#141413]">{e.client}</span>
                {e.detail && <span className="font-normal text-[#5F5F5B]"> · {e.detail}</span>}
              </>
            ) : (
              <span className="font-semibold tracking-[-0.01em] text-[#141413]">{e.name}</span>
            )}
          </span>
        </>
      )}
    </motion.div>
  );
}

function DayNumber({ d, reduce }) {
  const label = d.day === 1 ? `${keyLabel(d.key, { month: 'short' })} 1` : d.day;
  if (d.isToday) {
    return (
      <motion.span
        className={`inline-flex items-center justify-center rounded-full bg-omega-orange text-white px-2.5 h-full min-w-[clamp(26px,3vh,34px)] font-extrabold tracking-[-0.02em] tabular-nums leading-none whitespace-nowrap ${SIZE.day}`}
        animate={reduce ? undefined : { boxShadow: [`0 0 0 0 ${ORANGE}66`, `0 0 0 8px ${ORANGE}00`] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
      >
        {label}
      </motion.span>
    );
  }
  return (
    <span className={`pl-1 font-extrabold tracking-[-0.02em] tabular-nums leading-none whitespace-nowrap ${SIZE.day} ${d.inMonth ? 'text-[#111]' : 'text-omega-fog'}`}>
      {label}
    </span>
  );
}

function DayCell({ d, index, cap = 1, nextId, now, reduce }) {
  if (index % 7 === SUN) return <SundayCell d={d} index={index} reduce={reduce} />;
  const n = d.events.length;
  const shown = n > cap ? d.events.slice(0, cap) : d.events;
  const more = n - shown.length;

  // This week: white card with an orange edge. Last and next week stay
  // quiet.
  const look = d.isToday
    ? 'border-2 border-omega-orange shadow-card-hover'
    : d.focus
      ? `border-2 border-omega-orange/30 shadow-card ${d.weekend ? 'bg-[#F3F2EC]' : 'bg-white'}`
      : d.weekend
        ? 'border border-black/[0.05] bg-[#F3F2EC]'
        : `border border-black/[0.05] ${d.isPast ? 'bg-white/60' : 'bg-white/80'}`;
  const fade = d.isPast ? 'opacity-50' : '';

  return (
    <motion.div
      className={`relative min-h-0 min-w-0 rounded-2xl flex flex-col px-2 pt-1 pb-1.5 ${look}`}
      style={d.isToday ? { background: TODAY_BG } : undefined}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.012, ease: EASE }}
    >
      <div className={`relative flex-shrink-0 h-[clamp(24px,2.7vh,30px)] flex items-center justify-between gap-2 ${fade}`}>
        <DayNumber d={d} reduce={reduce} />
        {more > 0 ? (
          <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 border border-black/[0.08] font-semibold leading-tight whitespace-nowrap ${SIZE.meta} ${d.isToday ? 'bg-white text-omega-orange' : 'bg-omega-cloud text-omega-slate'}`}>
            +{more} more
          </span>
        ) : d.isToday ? (
          <span className={`flex-shrink-0 pr-1 font-bold tracking-[-0.01em] text-omega-orange ${SIZE.label}`}>Today</span>
        ) : null}
      </div>
      <div data-cell-body data-key={d.key} data-size={d.pillSize} className={`relative flex-1 min-h-0 mt-1 flex flex-col gap-[2px] overflow-hidden ${fade}`}>
        {shown.map((e) => (
          <Pill key={e.id} e={e} past={d.isToday && e.ms < now} isNext={e.id === nextId} size={d.pillSize} reduce={reduce} />
        ))}
      </div>
    </motion.div>
  );
}

// Thin Sunday column: just the day number and one colored dot per event.
function SundayCell({ d, index, reduce }) {
  const look = d.isToday
    ? 'border-2 border-omega-orange'
    : d.focus
      ? 'border-2 border-omega-orange/30 bg-[#F3F2EC]'
      : 'border border-black/[0.05] bg-[#F3F2EC]';
  const fade = d.isPast ? 'opacity-50' : '';
  return (
    <motion.div
      className={`relative min-h-0 min-w-0 rounded-2xl flex flex-col items-center pt-1 pb-1.5 ${look}`}
      style={d.isToday ? { background: TODAY_BG } : undefined}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.012, ease: EASE }}
    >
      <div className={`flex-shrink-0 h-[clamp(24px,2.7vh,30px)] flex items-center ${fade}`}>
        <span className={`font-extrabold tracking-[-0.02em] tabular-nums leading-none ${SIZE.day} ${d.isToday ? 'text-omega-orange' : 'text-omega-slate'}`}>
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

function MonthGrid({ days, nextId, now, reduce }) {
  const ref = useRef(null);
  const rows = useOuterRows(ref, days);
  const caps = useCellCaps(ref, days);
  return (
    <div
      ref={ref}
      className="relative flex-1 min-h-0 grid gap-1.5"
      style={{ gridTemplateColumns: COLUMNS, gridTemplateRows: rows }}
    >
      {days.map((d, i) => (
        <DayCell key={d.key} d={d} index={i} cap={caps[d.key]} nextId={nextId} now={now} reduce={reduce} />
      ))}
      <div aria-hidden className="absolute left-0 top-0 invisible pointer-events-none">
        <div data-pill-probe="one" className={PILL}>10a Probe</div>
        <div data-pill-probe="two" className={PILL_TWO}>10a Probe</div>
        <div data-pill-probe="big" className={PILL_BIG}>10a Probe</div>
      </div>
    </div>
  );
}

export default function CalendarSlide({ data, now = Date.now() }) {
  const reduce = useReducedMotion();
  const view = useMemo(() => (data ? buildView(data, now) : null), [data, now]);
  if (!view) return <SlideLoading />;

  return (
    <div className="font-optical flex-1 min-h-0 flex flex-col">
      <div className="grid gap-1.5 flex-shrink-0 mb-1" style={{ gridTemplateColumns: COLUMNS }}>
        {WEEKDAYS.map((w, i) => (
          <p
            key={w}
            className={`font-semibold tracking-[-0.01em] truncate ${SIZE.week} ${i === SUN ? 'text-center' : 'px-3'} ${i === view.todayDow ? 'text-omega-orange' : 'text-omega-slate'}`}
          >
            {w}
          </p>
        ))}
      </div>

      <MonthGrid days={view.days} nextId={view.next?.id} now={now} reduce={reduce} />

      <LegendStrip
        rangeLabel={view.rangeLabel}
        total={view.total}
        done={view.done}
        ahead={view.ahead}
        legend={view.legend}
      />
    </div>
  );
}
