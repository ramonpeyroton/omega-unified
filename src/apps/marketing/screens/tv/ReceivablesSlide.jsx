// TV slide 4 — Receivables. Client installments of SIGNED contracts (same
// scope as Finance → Clients): what is overdue, what comes in soon, and a
// 5-week cash-flow chart (client money in vs bills + sub payments out).
// "Overdue" follows shared/lib/finance.js: open and more than
// OVERDUE_GRACE_DAYS past due, so the TV agrees with what Operations sees.

import { useLayoutEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  HandCoins, AlertTriangle, CalendarClock, CalendarRange, CircleDollarSign, PartyPopper,
} from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { nyDateKey } from '../../../../shared/lib/stageAge';
import {
  T, CARD, TONE, toMs, plural, usd, usdShort, dueChip, daysFromToday, shortDate, selectIn,
  useFitChildren, SectionTitle, StatTile, CountUp, Chip, SlideLoading, EmptyState,
} from './tvKit';

export const meta = {
  key: 'receivables',
  title: 'Receivables',
  eyebrow: 'Client payments',
  icon: HandCoins,
  tables: ['payment_milestones', 'bills', 'sub_payments'],
};

const OVERDUE_GRACE_DAYS = 3; // keep in sync with shared/lib/finance.js
const WEEKS = 5;
const HORIZON_DAYS = WEEKS * 7;

// ─── Date / number helpers ──────────────────────────────────────────
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const asDateKey = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// Pure calendar arithmetic on 'YYYY-MM-DD' keys (no time zone involved).
function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function monthEndKey(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const fmtKey = (key, opts) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
function rangeLabel(a, b) {
  const end = a.slice(0, 7) === b.slice(0, 7) ? fmtKey(b, { day: 'numeric' }) : fmtKey(b, { month: 'short', day: 'numeric' });
  return `${fmtKey(a, { month: 'short', day: 'numeric' })}–${end}`;
}

// Whole dollars below $100k, "$719k" above — keeps KPI numbers on one line.
const money = (n) => (Math.abs(n) >= 100_000 ? usdShort(n) : usd(Math.round(n)));
const signed = (n) => (n >= 0.5 ? `+${usdShort(n)}` : n <= -0.5 ? usdShort(n) : '$0');

// ─── Data ───────────────────────────────────────────────────────────
// Milestones + contracts are required; bills / sub payments only feed the
// "out" side of the chart and degrade to "—".
export async function load(now = Date.now()) {
  const horizonKey = addDaysKey(nyDateKey(now), HORIZON_DAYS);

  const [contractsRes, billsRes, subsRes] = await Promise.all([
    supabase.from('contracts').select('id, job_id').not('signed_at', 'is', null),
    supabase.from('bills').select('due_date, amount').eq('status', 'pending').lte('due_date', horizonKey),
    supabase.from('sub_payments').select('due_date, due_amount, paid_amount, status')
      .neq('status', 'paid').lte('due_date', horizonKey),
  ]);
  if (contractsRes.error) throw contractsRes.error;
  const contracts = contractsRes.data || [];
  const contractJob = Object.fromEntries(contracts.map((c) => [c.id, c.job_id]));

  const milestones = await selectIn(
    'payment_milestones',
    'id, contract_id, job_id, label, due_amount, received_amount, due_date, status, received_at',
    'contract_id',
    contracts.map((c) => c.id),
  );

  const jobIdOf = (m) => m.job_id || contractJob[m.contract_id] || null;
  let clientOf = {};
  try {
    const ids = [...new Set(milestones.map(jobIdOf).filter(Boolean))];
    const jobs = await selectIn('jobs', 'id, client_name', 'id', ids);
    clientOf = Object.fromEntries(jobs.map((j) => [j.id, j.client_name]));
  } catch { /* rows fall back to a generic name */ }

  const open = [];
  const received = [];
  for (const m of milestones) {
    const recMs = toMs(m.received_at);
    if (recMs != null && num(m.received_amount) > 0) {
      received.push({ key: nyDateKey(recMs), amount: num(m.received_amount) });
    }
    const remaining = num(m.due_amount) - num(m.received_amount);
    if (m.status === 'paid' || remaining < 0.01) continue;
    open.push({
      id: m.id,
      client: clientOf[jobIdOf(m)] || null,
      label: m.label || 'Installment',
      remaining,
      dueKey: asDateKey(m.due_date),
    });
  }

  const out = [];
  (billsRes.data || []).forEach((b) => {
    const k = asDateKey(b.due_date);
    if (k) out.push({ kind: 'bill', dueKey: k, amount: Math.max(0, num(b.amount)), tbd: b.amount == null });
  });
  (subsRes.data || []).forEach((s) => {
    const k = asDateKey(s.due_date);
    const rem = num(s.due_amount) - num(s.paid_amount);
    if (k && rem >= 0.01) out.push({ kind: 'sub', dueKey: k, amount: rem });
  });

  return { open, received, out, outOk: !billsRes.error && !subsRes.error, loadedAt: now };
}

// ─── View model ─────────────────────────────────────────────────────
// Chart slot for something `days` from today: 0 = Overdue, 1..WEEKS = rolling
// 7-day windows starting today (window 1 also takes items still inside the
// grace period — they are due now), -1 = beyond the horizon.
function slotFor(days, grace) {
  if (!Number.isFinite(days)) return -1;
  if (days < -grace) return 0;
  if (days < 0) return 1;
  if (days < HORIZON_DAYS) return 1 + Math.floor(days / 7);
  return -1;
}

function accentFor(days) {
  if (days == null) return '#CBD5E1';
  if (days <= 0) return TONE.bad.hex;
  if (days <= 7) return TONE.warn.hex;
  if (days <= 30) return TONE.good.hex;
  return '#94A3B8';
}

function buildView(data, now) {
  const todayKey = nyDateKey(now);
  const monthEnd = monthEndKey(todayKey);

  const groups = [
    { key: 'overdue', label: 'Overdue', overdue: true, in: 0, out: 0 },
    ...Array.from({ length: WEEKS }, (_, i) => ({
      key: `w${i}`,
      label: rangeLabel(addDaysKey(todayKey, i * 7), addDaysKey(todayKey, i * 7 + 6)),
      in: 0,
      out: 0,
    })),
  ];

  const overdue = { sum: 0, count: 0, oldest: 0 };
  const soon = { sum: 0, count: 0, grace: 0 };
  const later = { sum: 0, count: 0 };
  const noDate = { sum: 0, count: 0 };
  let openSum = 0;

  const rows = (data.open || []).map((it) => {
    const days = it.dueKey ? daysFromToday(it.dueKey, now) : null;
    openSum += it.remaining;
    if (days == null || !Number.isFinite(days)) {
      noDate.sum += it.remaining;
      noDate.count++;
      return { ...it, days: null };
    }
    const slot = slotFor(days, OVERDUE_GRACE_DAYS);
    if (slot >= 0) groups[slot].in += it.remaining;
    if (slot === 0) {
      overdue.sum += it.remaining;
      overdue.count++;
      overdue.oldest = Math.max(overdue.oldest, -days);
    } else if (days < 7) {
      soon.sum += it.remaining;
      soon.count++;
      if (days < 0) soon.grace++;
    } else if (it.dueKey <= monthEnd) {
      later.sum += it.remaining;
      later.count++;
    }
    return { ...it, days };
  });

  // Overdue (oldest first) → by due date → undated, biggest first.
  rows.sort((a, b) => {
    if (a.dueKey && b.dueKey) {
      if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
      return b.remaining - a.remaining;
    }
    if (a.dueKey) return -1;
    if (b.dueKey) return 1;
    return b.remaining - a.remaining;
  });

  // A half-loaded "out" side would make every net look better than it is.
  const outOk = data.outOk !== false;
  let billsTbd = 0;
  (outOk ? data.out || [] : []).forEach((o) => {
    // Bills have no grace period (shared/lib/bills.js); sub payments do.
    const slot = slotFor(daysFromToday(o.dueKey, now), o.kind === 'bill' ? 0 : OVERDUE_GRACE_DAYS);
    if (slot < 0) return;
    groups[slot].out += o.amount;
    if (o.tbd) billsTbd++;
  });

  const monthKey = todayKey.slice(0, 7);
  const recRows = (data.received || []).filter((r) => r.key?.slice(0, 7) === monthKey);
  const receivedMonth = { sum: recRows.reduce((s, r) => s + r.amount, 0), count: recRows.length };

  const totIn = groups.reduce((s, g) => s + g.in, 0);
  const totOut = groups.reduce((s, g) => s + g.out, 0);

  return {
    todayKey, monthEnd, groups, rows, overdue, soon, later, noDate, receivedMonth,
    openSum, totIn, totOut, billsTbd, outOk,
    monthName: fmtKey(todayKey, { month: 'long' }),
  };
}

// ─── Chart ──────────────────────────────────────────────────────────
const LBL = 'clamp(30px,3.8vh,42px)'; // headroom above the bars for value labels
const AXIS = 'clamp(44px,3.4vw,68px)';
const BAR_W = 'clamp(28px,3vw,58px)';
const BAR_GAP = 'clamp(6px,0.85vw,16px)'; // keeps paired value labels apart
const IN_FILL = 'linear-gradient(180deg, #34D399 0%, #059669 100%)';
const OUT_FILL = 'linear-gradient(180deg, #94A3B8 0%, #475569 100%)';
const IN_TEXT = '#047857';
const OUT_TEXT = '#334155';
const SZ_META = 'text-[clamp(12px,1.7vh,18px)]';
const SZ_AXIS = 'text-[clamp(11px,1.5vh,16px)]';
const EASE = [0.22, 1, 0.36, 1];

function niceScale(max) {
  if (!(max > 0)) return { top: 1, ticks: [0] };
  // Floor keeps steps >= $25 so tick labels never repeat ("$0 $0 $1").
  const raw = Math.max(max, 100) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  const n = Math.max(1, Math.ceil(max / step));
  return { top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}

function Bar({ value, top, fill, color, delay, reduce }) {
  const pct = Math.min(100, (value / top) * 100);
  const h = value > 0 ? `max(6px, ${pct}%)` : '3px';
  return (
    <div className="relative h-full flex items-end flex-shrink-0" style={{ width: BAR_W }}>
      <motion.div
        className="w-full rounded-t-xl"
        style={{ height: h, background: value > 0 ? fill : 'rgba(0,0,0,0.07)', originY: 1 }}
        initial={reduce ? false : { scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.7, delay, ease: EASE }}
      />
      {value > 0 && (
        // Zero-width centered box so the label can be wider than the bar.
        <div className="absolute left-1/2 w-0 flex justify-center" style={{ bottom: `calc(${h} + 8px)` }}>
          <motion.span
            className={`font-black tabular-nums whitespace-nowrap leading-none ${SZ_META}`}
            style={{ color }}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: delay + 0.45 }}
          >
            {usdShort(value)}
          </motion.span>
        </div>
      )}
    </div>
  );
}

function GroupLabel({ g, outOk }) {
  const empty = g.in < 0.5 && g.out < 0.5;
  const net = g.in - g.out;
  let tone = 'bg-omega-cloud text-omega-stone border border-black/[0.06]';
  let text = 'Nothing due';
  if (empty && g.overdue) { tone = 'bg-emerald-50 text-emerald-700'; text = 'All clear'; }
  else if (!empty && !outOk) { text = `In ${usdShort(g.in)}`; }
  else if (!empty) {
    tone = net >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700';
    text = `Net ${signed(net)}`;
  }
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
      <p className={`font-extrabold whitespace-nowrap leading-tight ${SZ_META} ${g.overdue ? 'text-rose-600' : 'text-[#111]'}`}>
        {g.label}
      </p>
      <span className={`rounded-full px-3 py-1 font-bold tabular-nums whitespace-nowrap leading-tight ${SZ_AXIS} ${tone}`}>
        {text}
      </span>
    </div>
  );
}

function CashFlowChart({ groups, outOk, reduce }) {
  const max = Math.max(0, ...groups.flatMap((g) => [g.in, g.out]));
  const { top, ticks } = niceScale(max);
  const pos = (t) => `${(t / top) * 100}%`;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="relative flex-1 min-h-0">
        <div className="absolute left-0 bottom-0" style={{ top: LBL, width: AXIS }}>
          {ticks.map((t) => (
            <span
              key={t}
              className={`absolute right-3 translate-y-1/2 font-semibold tabular-nums leading-none text-omega-stone ${SZ_AXIS}`}
              style={{ bottom: pos(t) }}
            >
              {usdShort(t)}
            </span>
          ))}
        </div>

        <div className="absolute right-0 bottom-0" style={{ top: LBL, left: AXIS }}>
          {ticks.map((t) => (
            <div
              key={t}
              className={`absolute inset-x-0 border-t ${t === 0 ? 'border-black/15' : 'border-dashed border-black/[0.08]'}`}
              style={{ bottom: pos(t) }}
            />
          ))}
          <div className="absolute inset-0 flex">
            {groups.map((g, gi) => (
              <div key={g.key} className="relative flex-1 min-w-0 flex items-end justify-center" style={{ gap: BAR_GAP }}>
                {g.overdue && (
                  <div
                    className="absolute inset-x-[6%] bottom-0 rounded-2xl bg-rose-50"
                    style={{ top: `calc(-1 * ${LBL} + 2px)` }}
                  />
                )}
                <Bar value={g.in} top={top} fill={IN_FILL} color={IN_TEXT} delay={0.15 + gi * 0.06} reduce={reduce} />
                <Bar value={g.out} top={top} fill={OUT_FILL} color={OUT_TEXT} delay={0.21 + gi * 0.06} reduce={reduce} />
              </div>
            ))}
          </div>
          {!(max > 0) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className={T.body}>Nothing due in the next {WEEKS} weeks</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 flex pt-3" style={{ paddingLeft: AXIS }}>
        {groups.map((g) => <GroupLabel key={g.key} g={g} outOk={outOk} />)}
      </div>
    </div>
  );
}

function Legend() {
  const item = (fill, text) => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="w-3.5 h-3.5 rounded-[5px] flex-shrink-0" style={{ background: fill }} />
      <span className={T.meta}>{text}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-5 flex-shrink-0">
      {item(IN_FILL, 'Client payments')}
      {item(OUT_FILL, 'Bills + subs')}
    </div>
  );
}

function FooterStat({ label, value, format, color, sub, first }) {
  return (
    <div className={`min-w-0 ${first ? 'pr-6' : 'px-6'}`}>
      <p className={`${T.eyebrow} truncate`}>{label}</p>
      <CountUp value={value} format={format} className={`${T.stat} block whitespace-nowrap ${color}`} />
      {sub && <p className={`${T.meta} truncate`}>{sub}</p>}
    </div>
  );
}

// ─── Installment list ───────────────────────────────────────────────
function InstallmentRow({ row }) {
  const chip = dueChip(row.days);
  const accent = accentFor(row.days);
  return (
    <div className={`${CARD} relative overflow-hidden flex-shrink-0 flex items-center gap-5 pl-8 pr-6 py-3.5`}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(90deg, ${accent}1C 0%, ${accent}00 45%)` }} />
      <span className="absolute left-0 inset-y-0 w-2" style={{ background: accent }} />
      <div className="relative flex-1 min-w-0">
        <p className={`${T.title} text-[#111] truncate`}>{row.client || 'Client'}</p>
        <p className={`${T.meta} truncate`}>
          {row.label}
          {row.dueKey && <> · due {shortDate(row.dueKey)}</>}
        </p>
      </div>
      <span className="relative flex-shrink-0"><Chip tone={chip.tone} text={chip.label} /></span>
      <p className={`relative ${T.stat} text-[#111] whitespace-nowrap flex-shrink-0 text-right`}>
        {usd(Math.round(row.remaining))}
      </p>
    </div>
  );
}

function InstallmentList({ rows, reduce }) {
  const ref = useFitChildren([rows]);
  const [hidden, setHidden] = useState(0);

  // Count what useFitChildren hid (it runs first: declared above) for the
  // "+N more" line; re-counts whenever the box resizes.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const count = () => setHidden([...box.children].filter((el) => el.style.visibility === 'hidden').length);
    count();
    const ro = new ResizeObserver(count);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const hiddenSum = hidden ? rows.slice(rows.length - hidden).reduce((s, r) => s + r.remaining, 0) : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
        {rows.map((row, i) => (
          <motion.div
            key={row.id}
            className="flex-shrink-0 flex flex-col"
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, delay: 0.15 + Math.min(i, 8) * 0.06, ease: EASE }}
          >
            <InstallmentRow row={row} />
          </motion.div>
        ))}
      </div>
      {hidden > 0 && (
        <p className={`${T.meta} flex-shrink-0 pt-3 text-center whitespace-nowrap`}>
          + <span className="font-black text-[#111]">{hidden}</span> more · {usdShort(hiddenSum)}
        </p>
      )}
    </div>
  );
}

// ─── Slide ──────────────────────────────────────────────────────────
export default function ReceivablesSlide({ data, now }) {
  const view = useMemo(() => (data ? buildView(data, now) : null), [data, now]);
  const reduce = useReducedMotion();
  if (!view) return <SlideLoading />;

  const { overdue, soon, later, noDate, receivedMonth, groups, rows } = view;
  const net = view.totIn - view.totOut;

  const tiles = [
    {
      key: 'overdue', icon: AlertTriangle, label: 'Overdue', value: overdue.sum,
      tone: overdue.count ? 'bad' : 'good',
      sub: overdue.count
        ? `${plural(overdue.count, 'installment', 'installments')} · ${overdue.count > 1 ? 'oldest ' : ''}${plural(overdue.oldest, 'day', 'days')} late`
        : 'Nothing overdue',
    },
    {
      key: 'soon', icon: CalendarClock, label: 'Due next 7 days', value: soon.sum,
      tone: soon.count ? 'warn' : undefined,
      sub: soon.count
        ? `${plural(soon.count, 'installment', 'installments')}${soon.grace ? ` · ${soon.grace} in grace period` : ''}`
        : 'Nothing due this week',
    },
    {
      key: 'later', icon: CalendarRange, label: 'Later this month', value: later.sum,
      tone: later.count ? 'info' : undefined,
      sub: later.count
        ? `${plural(later.count, 'installment', 'installments')} · through ${shortDate(view.monthEnd)}`
        : `Nothing else due by ${shortDate(view.monthEnd)}`,
    },
    {
      key: 'received', icon: CircleDollarSign, label: `Received in ${view.monthName}`, value: receivedMonth.sum,
      tone: receivedMonth.count ? 'good' : undefined,
      sub: receivedMonth.count ? `${plural(receivedMonth.count, 'payment', 'payments')} from clients` : 'No payments logged yet',
    },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-5 flex-shrink-0">
        {tiles.map(({ key, ...tile }, i) => (
          <motion.div
            key={key}
            className="min-w-0 flex"
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: i * 0.06, ease: EASE }}
          >
            <StatTile {...tile} format={money} className="flex-1" />
          </motion.div>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        <section className="flex-[1.25] min-w-0 flex flex-col">
          <SectionTitle title={`Cash flow · next ${WEEKS} weeks`}>
            <Legend />
          </SectionTitle>
          <div className={`${CARD} flex-1 min-h-0 flex flex-col px-7 pt-5 pb-5`}>
            <CashFlowChart groups={groups} outOk={view.outOk} reduce={reduce} />
            <div className="flex-shrink-0 mt-4 pt-4 border-t border-black/[0.06] grid grid-cols-4 divide-x divide-black/[0.06]">
              <FooterStat first label="Expected in" value={view.totIn} format={usdShort} color="text-emerald-600" sub="incl. overdue" />
              <FooterStat
                label="Going out"
                value={view.outOk ? view.totOut : null}
                format={usdShort}
                color="text-slate-700"
                sub={!view.outOk ? 'bills offline' : view.billsTbd ? `${plural(view.billsTbd, 'bill', 'bills')} w/o amount` : 'bills + subs'}
              />
              <FooterStat
                label="Net"
                value={view.outOk ? net : null}
                format={signed}
                color={net >= 0 ? 'text-emerald-600' : 'text-rose-600'}
                sub="in − out"
              />
              <FooterStat
                label="No due date"
                value={noDate.sum}
                format={usdShort}
                color={noDate.count ? 'text-indigo-600' : 'text-omega-fog'}
                sub={noDate.count ? plural(noDate.count, 'installment', 'installments') : 'all dated'}
              />
            </div>
          </div>
        </section>

        <section className="flex-1 min-w-0 flex flex-col">
          <SectionTitle title="Open installments">
            {rows.length > 0 && (
              <p className="font-semibold text-omega-stone whitespace-nowrap text-[clamp(12px,1.9vh,20px)]">
                <span className="text-[#111] font-black">{rows.length}</span> open
                {' · '}<span className="text-[#111] font-black">{usdShort(view.openSum)}</span>
              </p>
            )}
          </SectionTitle>
          {rows.length
            ? <InstallmentList rows={rows} reduce={reduce} />
            : <EmptyState icon={PartyPopper} title="All clients are up to date" text="No open installments on signed contracts." />}
        </section>
      </div>
    </div>
  );
}
