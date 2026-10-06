// TV slide 5 — Bills to pay. The operating bills Operations keeps in
// Finance → Bills: what is overdue / due this week / due later this month /
// already paid this month, where this month's money goes by category
// (donut), cash going out week by week, and every pending bill in due-date
// order. Read-only on purpose: the TV never materializes recurring templates
// (the Bills tab does that), it only shows what is already in `bills`.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Receipt, Building2, Zap, ShieldCheck, Cpu, Car, Megaphone, Landmark, Briefcase,
  Package, FileText, MoreHorizontal, AlertTriangle, CalendarClock, CalendarRange,
  CheckCircle2, PartyPopper,
} from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { nyDateKey, nyMidnightMs } from '../../../../shared/lib/stageAge';
import { categoryLabel } from '../../../../shared/lib/bills';
import {
  T, CARD, TONE, usd, usdShort, dueChip, daysFromToday, shortDate, selectIn, plural,
  useCountUp, useFitChildren, SectionTitle, StatTile, Chip, SlideLoading, EmptyState,
} from './tvKit';

export const meta = {
  key: 'bills',
  title: 'Bills to Pay',
  eyebrow: 'Operating bills',
  icon: Receipt,
  tables: ['bills'],
};

const WEEKS = 6;       // columns in "Cash out by week" (after the Overdue column)
const MAX_SLICES = 4;  // donut: top 3 categories + "Everything else"
const SPOT_MS = 4000;  // donut spotlight step
const EASE = [0.22, 1, 0.36, 1];

// Fixed color per category (color follows the entity, never its rank).
const CAT = {
  rent:         { icon: Building2,   hex: '#2A78D6' },
  utilities:    { icon: Zap,         hex: '#1BAF7A' },
  insurance:    { icon: ShieldCheck, hex: '#4A3AA7' },
  software:     { icon: Cpu,         hex: '#E87BA4' },
  vehicle:      { icon: Car,         hex: '#EB6834' },
  marketing:    { icon: Megaphone,   hex: '#EDA100' },
  taxes:        { icon: Landmark,    hex: '#E34948' },
  professional: { icon: Briefcase,   hex: '#008300' },
  supplies:     { icon: Package,     hex: '#9A6B3F' },
  other:        { icon: FileText,    hex: '#8A8984' },
};
const REST = { icon: MoreHorizontal, hex: '#B8B6B0' };

const catMeta = (key) => CAT[key] || CAT.other;
function catLabel(key) {
  if (!key) return 'Other';
  const l = categoryLabel(key) || key;
  return l.charAt(0).toUpperCase() + l.slice(1);
}

// Whole dollars on the TV; $125k past six figures so tiles never overflow.
const money = (n) => (Math.abs(n) >= 100_000 ? usdShort(n) : usd(Math.round(n)));

// Pure calendar math on 'YYYY-MM-DD' keys (no timezone involved).
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function monthOf(todayKey) {
  const [y, m] = todayKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return {
    start: `${todayKey.slice(0, 7)}-01`,
    next,
    end: addDays(next, -1),
    name: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }),
  };
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const COLS = 'id, template_id, vendor_id, label, category, due_date, amount, status, paid_at, paid_amount';

// Pending bills are required; the paid queries and vendor names degrade.
export async function load(now = Date.now()) {
  const month = monthOf(nyDateKey(now));
  const fromIso = new Date(nyMidnightMs(month.start)).toISOString();
  const toIso = new Date(nyMidnightMs(month.next)).toISOString();

  const [pendingRes, paidRes, paidDueRes] = await Promise.all([
    supabase.from('bills').select(COLS).eq('status', 'pending')
      .order('due_date', { ascending: true }).limit(2000),
    supabase.from('bills').select(COLS).eq('status', 'paid')
      .gte('paid_at', fromIso).lt('paid_at', toIso),
    supabase.from('bills').select(COLS).eq('status', 'paid')
      .gte('due_date', month.start).lt('due_date', month.next),
  ]);
  if (pendingRes.error) throw pendingRes.error;
  const pending = pendingRes.data || [];
  const paidDueInMonth = paidDueRes.error ? null : paidDueRes.data || [];

  const vendors = {};
  const ids = [...new Set(pending.map((b) => b.vendor_id).filter(Boolean))];
  if (ids.length) {
    try {
      (await selectIn('vendors', 'id, name', 'id', ids)).forEach((v) => { vendors[v.id] = v.name; });
    } catch { /* cards just skip the vendor */ }
  }

  return {
    pending,
    paidInMonth: paidRes.error ? null : paidRes.data || [],
    paidDueInMonth,
    vendors,
    loadedAt: now,
  };
}

// ─── View model ─────────────────────────────────────────────────────
function buildView(data, now) {
  const today = nyDateKey(now);
  const month = monthOf(today);
  const weekEnd = addDays(today, 6); // "next 7 days" = today + 6 more

  const pending = (data.pending || [])
    .filter((b) => b.status === 'pending')
    .map((b) => ({ ...b, amt: num(b.amount), days: daysFromToday(b.due_date, now) }))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')
      || (b.amt ?? 0) - (a.amt ?? 0)
      || (a.label || '').localeCompare(b.label || ''));

  const sum = (rows) => rows.reduce((a, b) => a + (b.amt ?? 0), 0);
  const tbdOf = (rows) => rows.filter((b) => b.amt == null).length;
  const tbdNote = (rows) => (tbdOf(rows) ? ` · ${tbdOf(rows)} TBD` : '');

  const dated = pending.filter((b) => b.days != null);
  const overdue = dated.filter((b) => b.days < 0);
  const week = dated.filter((b) => b.days >= 0 && b.days <= 6);
  const later = dated.filter((b) => b.days > 6 && b.due_date < month.next);
  const paid = data.paidInMonth;
  const paidAmt = (b) => num(b.paid_amount) ?? num(b.amount) ?? 0;
  const maxLate = overdue.length ? Math.max(...overdue.map((b) => -b.days)) : 0;

  const stats = [
    {
      key: 'overdue', icon: AlertTriangle, label: 'Overdue',
      tone: overdue.length ? 'bad' : 'good',
      value: sum(overdue),
      sub: overdue.length
        ? `${plural(overdue.length, 'bill', 'bills')} · oldest ${plural(maxLate, 'day', 'days')} late${tbdNote(overdue)}`
        : 'Nothing overdue',
    },
    {
      key: 'week', icon: CalendarClock, label: 'Due in the next 7 days',
      tone: week.length ? 'warn' : undefined,
      value: sum(week),
      sub: week.length
        ? `${plural(week.length, 'bill', 'bills')} · through ${shortDate(weekEnd)}${tbdNote(week)}`
        : `Nothing due through ${shortDate(weekEnd)}`,
    },
    {
      key: 'later', icon: CalendarRange, label: 'Due later this month',
      tone: later.length ? 'info' : undefined,
      value: sum(later),
      sub: later.length
        ? `${plural(later.length, 'bill', 'bills')} · ${shortDate(addDays(today, 7))} – ${shortDate(month.end)}${tbdNote(later)}`
        : `Nothing else in ${month.name}`,
    },
    {
      key: 'paid', icon: CheckCircle2, label: 'Paid this month', tone: 'good',
      value: paid ? paid.reduce((a, b) => a + paidAmt(b), 0) : null,
      sub: !paid ? 'Not available right now'
        : paid.length ? `${plural(paid.length, 'bill', 'bills')} paid in ${month.name}`
          : `None paid yet in ${month.name}`,
    },
  ];

  // Donut — every bill due this NY month, pending + paid.
  const inMonth = (b) => b.due_date >= month.start && b.due_date < month.next;
  const monthRows = [
    ...pending.filter((b) => b.due_date && inMonth(b)).map((b) => ({ cat: b.category, amt: b.amt ?? 0, paid: false, tbd: b.amt == null })),
    ...(data.paidDueInMonth || []).map((b) => ({ cat: b.category, amt: paidAmt(b), paid: true, tbd: false })),
  ];
  const byCat = {};
  monthRows.forEach((r) => {
    const k = r.cat || 'other';
    (byCat[k] ||= { key: k, amount: 0, count: 0 });
    byCat[k].amount += r.amt;
    byCat[k].count += 1;
  });
  let cats = Object.values(byCat).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  if (cats.length > MAX_SLICES) {
    const rest = cats.slice(MAX_SLICES - 1);
    cats = [
      ...cats.slice(0, MAX_SLICES - 1),
      { key: '_rest', amount: rest.reduce((a, c) => a + c.amount, 0), count: rest.reduce((a, c) => a + c.count, 0), rest: true },
    ];
  }
  const monthTotal = cats.reduce((a, c) => a + c.amount, 0);
  const slices = cats.map((c) => ({
    ...c,
    label: c.rest ? 'Everything else' : catLabel(c.key),
    icon: c.rest ? REST.icon : catMeta(c.key).icon,
    hex: c.rest ? REST.hex : catMeta(c.key).hex,
    frac: monthTotal > 0 ? c.amount / monthTotal : 0,
  }));
  const donut = {
    slices,
    total: monthTotal,
    paid: monthRows.filter((r) => r.paid).reduce((a, r) => a + r.amt, 0),
    count: monthRows.length,
    tbd: monthRows.filter((r) => r.tbd).length,
    monthName: month.name,
  };

  // Cash out by week — Overdue, then this week and the next weeks.
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const from = addDays(today, i * 7);
    const to = addDays(today, i * 7 + 6);
    const rows = dated.filter((b) => b.due_date >= from && b.due_date <= to);
    return {
      key: from,
      label: i === 0 ? 'This week' : shortDate(from),
      amount: sum(rows),
      count: rows.length,
      hex: i === 0 ? TONE.warn.hex : TONE.info.hex,
    };
  });
  const buckets = [
    { key: 'late', label: 'Overdue', amount: sum(overdue), count: overdue.length, hex: TONE.bad.hex, late: true },
    ...weeks,
  ];

  return {
    stats,
    donut,
    buckets,
    weeksTotal: weeks.reduce((a, w) => a + w.amount, 0),
    list: pending,
    tbd: tbdOf(pending),
    vendors: data.vendors || {},
  };
}

// ─── Donut ──────────────────────────────────────────────────────────
const R = 80;
const SW = 22;
const C = 2 * Math.PI * R;

// The ring sweeps in on mount, then a spotlight walks the slices (month
// total → each category → total …) so the screen keeps moving all day.
function DonutCard({ slices, total, paid, count, tbd, monthName }) {
  const sweep = useCountUp(1, 1100);
  const [spot, setSpot] = useState(-1);
  const many = slices.length > 1;

  useEffect(() => {
    setSpot(-1);
    if (!many) return undefined;
    const iv = setInterval(() => setSpot((s) => (s + 1 >= slices.length ? -1 : s + 1)), SPOT_MS);
    return () => clearInterval(iv);
  }, [many, slices.length]);

  const active = many ? slices[spot] || null : null;
  const gap = many ? 3 : 0;
  let acc = 0;
  const arcs = slices.map((s) => {
    const start = acc;
    acc += s.frac * C;
    return { ...s, start, len: Math.max(0, s.frac * C - gap) };
  });

  const centerSub = !count
    ? 'No bills this month'
    : tbd && !total ? `${plural(count, 'bill', 'bills')} · amounts TBD`
      : plural(count, 'bill', 'bills');

  return (
    <div className={`${CARD} flex-1 min-h-0 p-6 flex items-center gap-7`}>
      <div className="relative h-full aspect-square max-w-[50%] flex-shrink-0 [container-type:inline-size]">
        <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" aria-hidden>
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={SW} />
          <g transform="rotate(-90 100 100)">
            {arcs.map((a) => {
              const shown = Math.max(0, Math.min(a.len, sweep * C - a.start));
              const on = active?.key === a.key;
              return (
                <circle
                  key={a.key}
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  stroke={a.hex}
                  strokeDasharray={`${shown} ${C}`}
                  strokeDashoffset={-(a.start + gap / 2)}
                  style={{
                    strokeWidth: on ? SW + 8 : SW,
                    opacity: active && !on ? 0.28 : 1,
                    transition: 'stroke-width 500ms ease, opacity 500ms ease',
                  }}
                />
              );
            })}
          </g>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <AnimatePresence mode="wait">
            <motion.div
              key={active ? active.key : 'total'}
              className="text-center max-w-[62%]"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3 }}
            >
              <p className={`${T.eyebrow} truncate`}>{active ? active.label : monthName}</p>
              {/* T.stat size, capped by the donut's own width so it stays inside the hole */}
              <p className="font-black tabular-nums leading-tight tracking-tight text-[#111] whitespace-nowrap text-[min(clamp(24px,4vh,44px),14cqw)]">
                {active ? money(active.amount) : money(total * sweep)}
              </p>
              <p className={`${T.meta} truncate`}>
                {active ? `${Math.round(active.frac * 100)}% of ${monthName}` : centerSub}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {slices.length ? (
        <DonutLegend slices={slices} activeKey={active?.key} paid={paid} total={total} />
      ) : (
        <p className={`${T.body} flex-1 min-w-0`}>
          {count ? `Amounts for ${monthName} are still TBD.` : `No bills due in ${monthName}.`}
        </p>
      )}
    </div>
  );
}

// Legend rows + the paid bar share one fit box. The auto margins center the
// rows above the bar when there is room and collapse to 0 when there isn't,
// so on a short screen the bar (last child) is what gets dropped first.
function DonutLegend({ slices, activeKey, paid, total }) {
  const ref = useFitChildren([slices]);
  return (
    <div ref={ref} className="relative flex-1 min-w-0 h-full overflow-hidden flex flex-col gap-[clamp(4px,0.8vh,8px)]">
      {slices.map((s, i) => {
        const Icon = s.icon;
        const on = s.key === activeKey;
        return (
          <div
            key={s.key}
            className={`flex items-center gap-3 rounded-2xl px-3 py-1 transition-colors duration-500 ${i === 0 ? 'mt-auto' : ''}`}
            style={{ background: on ? `${s.hex}1A` : 'transparent' }}
          >
            <span
              className="w-[clamp(24px,3.2vh,34px)] h-[clamp(24px,3.2vh,34px)] rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${s.hex}24`, color: s.hex }}
            >
              <Icon className="w-3/5 h-3/5" strokeWidth={2.5} />
            </span>
            <p className="flex-1 min-w-0 truncate font-bold text-[#111] text-[clamp(14px,2vh,21px)]">{s.label}</p>
            <p className="flex-shrink-0 whitespace-nowrap font-black tabular-nums text-[#111] text-[clamp(14px,2vh,21px)]">{money(s.amount)}</p>
            <p className={`${T.meta} flex-shrink-0 w-[3.2em] text-right tabular-nums`}>{Math.round(s.frac * 100)}%</p>
          </div>
        );
      })}
      {total > 0 && <PaidProgress paid={paid} total={total} />}
    </div>
  );
}

// How much of this month's bills is already paid.
function PaidProgress({ paid, total }) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  return (
    <div className="flex-shrink-0 mt-auto pt-3 border-t border-black/[0.06]">
      <div className="flex items-baseline gap-3 min-w-0">
        <p className={`${T.eyebrow} flex-shrink-0`}>Paid so far</p>
        <p className={`${T.meta} flex-1 min-w-0 truncate text-right`}>
          {money(paid)} of {money(total)} ·{' '}
          <span className="font-black text-emerald-600">{Math.round(pct)}%</span>
        </p>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-black/[0.06] overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-emerald-500"
          initial={reduce ? false : { width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
        />
      </div>
    </div>
  );
}

// ─── Cash out by week ───────────────────────────────────────────────
function WeekBars({ buckets }) {
  const reduce = useReducedMotion();
  const max = Math.max(0, ...buckets.map((b) => b.amount));
  return (
    <div className={`${CARD} flex-1 min-h-0 px-6 pt-4 pb-3 flex flex-col`}>
      <div className="flex-1 min-h-0 flex gap-3">
        {buckets.map((b, i) => {
          const pct = max > 0 ? Math.max(4, (b.amount / max) * 100) : 0;
          return (
            <div key={b.key} className="relative flex-1 min-w-0 h-full">
              {/* top inset keeps room for the value label over a full-height bar */}
              <div className="absolute inset-x-0 bottom-0 top-[clamp(20px,3vh,32px)] flex items-end justify-center">
                {b.amount > 0 ? (
                  <motion.div
                    className="relative w-[64%] rounded-t-md"
                    style={{ background: b.hex }}
                    initial={reduce ? false : { height: '0%' }}
                    animate={{ height: `${pct}%` }}
                    transition={{ duration: 0.75, delay: 0.15 + i * 0.05, ease: EASE }}
                  >
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap font-black tabular-nums text-[#111] text-[clamp(12px,1.7vh,18px)]">
                      {usdShort(b.amount)}
                    </span>
                  </motion.div>
                ) : (
                  <div className="relative w-[64%] h-1 rounded-full bg-black/[0.08]">
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 font-bold text-omega-fog text-[clamp(12px,1.7vh,18px)]">—</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-2 pt-2 border-t border-black/[0.06] flex-shrink-0">
        {buckets.map((b) => (
          <p
            key={b.key}
            className={`flex-1 min-w-0 text-center truncate ${T.meta} ${b.late && b.amount > 0 ? '!text-rose-600 !font-bold' : ''}`}
          >
            {b.label}
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── Pending list ───────────────────────────────────────────────────
function BillCard({ bill, vendor, index, reduce }) {
  const m = catMeta(bill.category);
  const Icon = m.icon;
  const chip = dueChip(bill.days);
  const late = bill.days != null && bill.days < 0;
  // Date first and without the weekday: in a ~200px column a long vendor
  // name must be what truncates, never the due date.
  const line = [bill.due_date ? `Due ${shortDate(bill.due_date)}` : 'No due date', vendor].filter(Boolean).join(' · ');
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.15 + Math.min(index, 10) * 0.05, ease: EASE }}
      className={`${CARD} relative min-w-0 overflow-hidden flex items-center gap-4 px-5 py-3.5 ${late ? 'ring-2 ring-rose-300' : ''}`}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(90deg, ${m.hex}14 0%, ${m.hex}00 55%)` }}
      />
      <span
        className="relative w-[clamp(40px,5.6vh,60px)] h-[clamp(40px,5.6vh,60px)] rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${m.hex}24`, color: m.hex }}
      >
        <Icon className="w-1/2 h-1/2" strokeWidth={2.25} />
      </span>
      <div className="relative flex-1 min-w-0">
        <p className={`${T.eyebrow} truncate`}>{catLabel(bill.category)}</p>
        <p className={`${T.title} text-[#111] truncate`}>{bill.label || 'Untitled bill'}</p>
        <p className={`${T.meta} truncate`}>{line}</p>
      </div>
      <div className="relative flex-shrink-0 flex flex-col items-end gap-1.5">
        {bill.amt == null
          ? <p className={`${T.label} text-amber-600 whitespace-nowrap`}>Amount TBD</p>
          : <p className={`${T.stat} text-[#111] whitespace-nowrap`}>{money(bill.amt)}</p>}
        <Chip tone={chip.tone} text={chip.label} />
      </div>
    </motion.div>
  );
}

function BillList({ bills, vendors, onHidden }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const [rows, setRows] = useState(6);

  // Reads as ONE list: down the left column, then down the right one
  // (Ramon, Oct/26). So we work out how many card rows fit, render only
  // 2 × rows bills and let the grid flow by column.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const measure = () => {
      const first = box.firstElementChild;
      if (!first) return;
      const cs = getComputedStyle(box);
      const gap = parseFloat(cs.rowGap) || 0;
      const inner = box.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      const n = Math.max(1, Math.floor((inner + gap) / (first.offsetHeight + gap)));
      setRows((r) => (r === n ? r : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [bills]);

  const shown = bills.slice(0, rows * 2);
  useEffect(() => { onHidden(bills.length - shown.length); }, [bills.length, shown.length, onHidden]);

  return (
    <div
      ref={ref}
      className="relative flex-1 min-h-0 overflow-hidden p-[3px] grid grid-cols-2 gap-4 content-start"
      style={{ gridTemplateRows: `repeat(${rows}, max-content)`, gridAutoFlow: 'column' }}
    >
      {shown.map((b, i) => (
        <BillCard key={b.id} bill={b} vendor={vendors[b.vendor_id]} index={i} reduce={reduce} />
      ))}
    </div>
  );
}

const SIDE_TEXT = 'font-semibold text-omega-stone whitespace-nowrap text-[clamp(12px,1.9vh,20px)]';

export default function BillsSlide({ data, now }) {
  const view = useMemo(() => (data ? buildView(data, now) : null), [data, now]);
  const [hidden, setHidden] = useState(0);
  if (!view) return <SlideLoading />;
  const { stats, donut, buckets, weeksTotal, list, tbd, vendors } = view;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-5 overflow-hidden">
      <div className="grid grid-cols-4 gap-5 flex-shrink-0">
        {stats.map(({ key, ...s }) => (
          <StatTile key={key} {...s} format={money} className="overflow-hidden" />
        ))}
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        <div className="w-[42%] flex-shrink-0 min-h-0 flex flex-col gap-5">
          <section className="flex-[1.15] min-h-0 flex flex-col">
            <SectionTitle title="Where the money goes">
              {donut.count > 0 && (
                <p className={SIDE_TEXT}>
                  <span className="text-[#111] font-black">{donut.count}</span> due in {donut.monthName}
                </p>
              )}
            </SectionTitle>
            <DonutCard {...donut} />
          </section>

          <section className="flex-1 min-h-0 flex flex-col">
            <SectionTitle title="Cash out by week">
              <p className={SIDE_TEXT}>
                <span className="text-[#111] font-black">{money(weeksTotal)}</span> next {WEEKS} weeks
              </p>
            </SectionTitle>
            <WeekBars buckets={buckets} />
          </section>
        </div>

        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          <SectionTitle title="Up next">
            {list.length > 0 && (
              <p className={SIDE_TEXT}>
                <span className="text-[#111] font-black">{list.length}</span> pending
                {hidden > 0 && <> · <span className="text-[#111] font-black">+{hidden}</span> more later</>}
              </p>
            )}
            {tbd > 0 && <Chip tone="warn" text={`${plural(tbd, 'amount', 'amounts')} TBD`} />}
          </SectionTitle>
          {list.length
            ? <BillList bills={list} vendors={vendors} onHidden={setHidden} />
            : <EmptyState icon={PartyPopper} title="All bills are paid" text="Nothing is waiting to be paid right now." />}
        </section>
      </div>
    </div>
  );
}
