// Shared building blocks for the office TV slideshow (src/apps/marketing/
// screens/PipelineTV.jsx). Every slide imports its type scale, cards, chips
// and helpers from here so the five screens read as ONE board: same Inter
// type ramp, same white rounded cards on the cloud background, same orange
// section bars. Sized for a 1920×1080 TV (vh-based clamps), readable from
// across the room.
//
// Slide contract (each file in ./slides*.jsx):
//   export const meta = { key, title, eyebrow, icon, tables: [...] }
//   export async function load(now)  → data object (throw on failure)
//   export default function Slide({ data, now, active })
// `data` is undefined until the first load resolves — render <SlideLoading/>.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { nyDateKey, nyMidnightMs } from '../../../../shared/lib/stageAge';

export const TZ = 'America/New_York';
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const ORANGE = '#E8732A';

// ─── Type scale ─────────────────────────────────────────────────────
// Use these instead of ad-hoc sizes so every slide shares one ramp.
export const T = {
  hero:   'font-black tabular-nums leading-none tracking-tight text-[clamp(48px,10vh,112px)]',
  big:    'font-black tabular-nums leading-none tracking-tight text-[clamp(34px,6.2vh,68px)]',
  stat:   'font-black tabular-nums leading-tight tracking-tight text-[clamp(24px,4vh,44px)]',
  title:  'font-extrabold leading-tight text-[clamp(18px,2.6vh,28px)]',
  label:  'font-extrabold uppercase tracking-wide text-[clamp(14px,2vh,22px)]',
  eyebrow:'font-bold uppercase tracking-wider text-omega-stone text-[clamp(11px,1.5vh,16px)]',
  body:   'font-medium text-omega-slate leading-snug text-[clamp(14px,2vh,21px)]',
  meta:   'font-medium text-omega-stone text-[clamp(12px,1.7vh,18px)]',
};

// The one card look on the TV.
export const CARD = 'rounded-3xl bg-white shadow-card border border-black/[0.05]';

// Semantic tones (chips, bars, accents). Text colors are the -600/-700
// stops so they stay readable on the light background.
export const TONE = {
  good: { text: 'text-emerald-600', bg: 'bg-emerald-50', solid: 'bg-emerald-500', hex: '#10B981' },
  warn: { text: 'text-amber-600',   bg: 'bg-amber-50',   solid: 'bg-amber-400',   hex: '#F59E0B' },
  bad:  { text: 'text-rose-600',    bg: 'bg-rose-50',    solid: 'bg-rose-500',    hex: '#F43F5E' },
  info: { text: 'text-indigo-600',  bg: 'bg-indigo-50',  solid: 'bg-indigo-500',  hex: '#6366F1' },
  brand:{ text: 'text-omega-orange',bg: 'bg-omega-pale', solid: 'bg-omega-orange',hex: ORANGE },
};

export const CHIP_TONE = {
  late:  'bg-rose-50 text-rose-600',
  warn:  'bg-amber-50 text-amber-600',
  ok:    'bg-emerald-50 text-emerald-600',
  info:  'bg-indigo-50 text-indigo-600',
  muted: 'bg-omega-cloud text-omega-slate border border-black/[0.06]',
};

// ─── Small helpers ──────────────────────────────────────────────────
export function toMs(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// $12,400 — whole dollars unless there are cents.
export function usd(n) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return v < 0 ? `−${s}` : s;
}

// $12.4k / $1.2M — for tight spots (chart labels, column headers).
export function usdShort(n) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  let s;
  if (abs >= 1_000_000) s = `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) s = `$${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  else s = `$${Math.round(abs)}`;
  s = s.replace('.0k', 'k').replace('.0M', 'M');
  return v < 0 ? `−${s}` : s;
}

// Whole NY calendar days from today to a 'YYYY-MM-DD' date (negative = past).
export function daysFromToday(dateKey, now = Date.now()) {
  if (!dateKey) return null;
  const today = nyDateKey(now);
  const a = Date.UTC(...today.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const b = Date.UTC(...dateKey.slice(0, 10).split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  return Math.round((b - a) / DAY_MS);
}

// Chip for a due date: late (red) / due today (red) / ≤7d (amber) / ≤30d
// (green) / later (grey).
export function dueChip(days) {
  if (days == null) return { label: 'no date', tone: 'bg-gray-100 text-gray-600' };
  if (days < 0)   return { label: `${plural(Math.abs(days), 'day', 'days')} late`, tone: 'bg-rose-100 text-rose-700' };
  if (days === 0) return { label: 'due today', tone: 'bg-rose-100 text-rose-700' };
  if (days <= 7)  return { label: `${plural(days, 'day', 'days')} left`, tone: 'bg-amber-100 text-amber-700' };
  if (days <= 30) return { label: `${days} days left`, tone: 'bg-emerald-100 text-emerald-700' };
  return { label: `${days} days left`, tone: 'bg-gray-100 text-gray-600' };
}

// 'YYYY-MM-DD' → "Oct 3"
export function shortDate(dateKey) {
  if (!dateKey) return '—';
  return new Date(`${dateKey.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// NY calendar day after `key`. 30h from midnight lands inside the next day
// even across a DST switch.
export function nextDayKey(key) {
  return nyDateKey(nyMidnightMs(key) + 30 * HOUR_MS);
}

// .in() in chunks so the URL stays short on big lists.
export async function selectIn(table, columns, column, ids, build = (q) => q) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await build(supabase.from(table).select(columns).in(column, ids.slice(i, i + 150)));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

// ─── Hooks ──────────────────────────────────────────────────────────

// Animates 0 → target when the slide mounts (and eases to new targets on
// refresh). Respects prefers-reduced-motion.
export function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const to = Number(target);
    if (!Number.isFinite(to)) { setValue(target); return undefined; }
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = Number.isFinite(fromRef.current) ? fromRef.current : 0;
    if (reduce || from === to) { setValue(to); fromRef.current = to; return undefined; }
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setValue(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// Hides every child of a fixed-height list that wouldn't fit whole, so a
// list fills its box without a half-cut card at the bottom. The list must
// be `relative`. Re-runs on resize and when `deps` change.
export function useFitChildren(deps) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const fit = () => {
      const limit = box.clientHeight + 1;
      for (const el of box.children) {
        el.style.visibility = el.offsetTop + el.offsetHeight <= limit ? '' : 'hidden';
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// ─── UI primitives ──────────────────────────────────────────────────

export function SectionTitle({ title, children }) {
  return (
    <div className="flex items-center gap-4 mb-3 flex-shrink-0">
      <span className="w-1.5 h-[clamp(20px,3vh,32px)] rounded-full bg-omega-orange flex-shrink-0" />
      <h2 className="font-black uppercase tracking-wide text-[#111] text-[clamp(18px,2.8vh,30px)]">{title}</h2>
      <div className="flex-1 h-px bg-black/10" />
      {children}
    </div>
  );
}

export function Chip({ tone = 'muted', text, icon: Icon, dot }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full font-bold leading-tight whitespace-nowrap text-[clamp(12px,1.7vh,18px)] ${CHIP_TONE[tone] || tone}`}>
      {Icon
        ? <Icon className="w-[1.1em] h-[1.1em] flex-shrink-0" strokeWidth={2.5} />
        : (tone !== 'muted' || dot) && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tone === 'muted' ? 'bg-omega-stone' : 'bg-current'}`} />}
      {text}
    </span>
  );
}

// Number that counts up on mount. `format` turns the animated number into
// text (e.g. usd); defaults to a rounded integer.
export function CountUp({ value, format, className = '' }) {
  const n = useCountUp(value);
  const shown = typeof n === 'number' ? (format ? format(n) : Math.round(n).toLocaleString('en-US')) : n;
  return <span className={className}>{value == null ? '—' : shown}</span>;
}

// Big KPI tile: icon chip + caps label, a counting number, a short line.
// `tone` colors the number and icon (good / warn / bad / info / brand).
export function StatTile({ icon: Icon, label, value, format, sub, tone, className = '' }) {
  const t = tone ? TONE[tone] : null;
  return (
    <div className={`${CARD} px-7 py-5 flex items-center gap-5 min-w-0 ${className}`}>
      {Icon && (
        <span className={`w-[clamp(44px,6.5vh,68px)] h-[clamp(44px,6.5vh,68px)] rounded-2xl flex items-center justify-center flex-shrink-0 ${t ? `${t.bg} ${t.text}` : 'bg-omega-cloud text-[#111]'}`}>
          <Icon className="w-1/2 h-1/2" strokeWidth={2.5} />
        </span>
      )}
      <div className="min-w-0">
        <p className={`${T.eyebrow} truncate`}>{label}</p>
        <CountUp value={value} format={format} className={`${T.big} block whitespace-nowrap ${t ? t.text : 'text-[#111]'}`} />
        {sub && <p className={`${T.meta} truncate mt-1`}>{sub}</p>}
      </div>
    </div>
  );
}

export function SlideLoading() {
  return (
    <div className="flex-1 flex items-center justify-center text-omega-stone">
      <Loader2 className="w-10 h-10 animate-spin" />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className={`${CARD} flex-1 flex flex-col items-center justify-center text-center gap-3 p-10`}>
      {Icon && <Icon className="w-[clamp(40px,7vh,72px)] h-[clamp(40px,7vh,72px)] text-omega-fog" strokeWidth={1.75} />}
      <p className={`${T.title} text-[#111]`}>{title}</p>
      {text && <p className={T.body}>{text}</p>}
    </div>
  );
}
