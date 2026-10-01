// TV dashboard (built for 1920×1080) — the sales side of the pipeline as a
// flow: Leads (New Lead → Visited) and Estimates (Draft → Approved), one
// tile per column with its card count, what those cards are waiting on,
// and an on-time/late health bar (same time-in-stage rules as the Kanban
// cards, see stageAge.js). Below: 3 KPIs (visit → approval conversion +
// average time, oldest card). Right: Snapshot with today's incoming leads
// and this month's Disqualified / Lost, each with a small trend. Layout
// follows Ramon's mockup (Sep/26). Lives in Ramon's Marketing app at /tv
// for the office TV. No money on purpose (Ramon dropped the $ KPI).
// Refreshes every minute + on any jobs change.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Maximize2, ChevronRight, UserPlus, PhoneCall, CalendarDays, BadgeCheck,
  FileText, Send, Handshake, FileCheck2, Bell, X, BarChart3, Clock, HelpCircle,
  Building2, Zap, ShieldCheck, Cpu, Car, Megaphone, Landmark, Briefcase, Package,
  Plus, ArrowRight,
} from 'lucide-react';
import logoImg from '../../../assets/logo.png';
import { supabase } from '../../../shared/lib/supabase';
import { PIPELINE_COLORS, PIPELINE_STEP_LABEL, OFF_BOARD_STAGES } from '../../../shared/config/phaseBreakdown';
import { stageAge, resolveVisit, useNow, nyDateKey, nyMidnightMs, formatNyTime } from '../../../shared/lib/stageAge';
import { lostReasonLabel } from '../../receptionist/lib/leadCatalog';
import { loadUpcomingBills, categoryLabel, daysUntilDue } from '../../../shared/lib/bills';

// Icon per bill category — mirrors BILL_CATEGORIES in src/shared/lib/bills.js.
const BILL_CATEGORY_ICON = {
  rent:         Building2,
  utilities:    Zap,
  insurance:    ShieldCheck,
  software:     Cpu,
  vehicle:      Car,
  marketing:    Megaphone,
  taxes:        Landmark,
  professional: Briefcase,
  supplies:     Package,
  other:        FileText,
};

function dueChip(days) {
  if (days < 0)       return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} late`, tone: 'bg-red-100 text-red-700' };
  if (days === 0)     return { label: 'due today',                                                    tone: 'bg-red-100 text-red-700' };
  if (days <= 7)      return { label: `${days} day${days === 1 ? '' : 's'} left`,                     tone: 'bg-amber-100 text-amber-700' };
  if (days <= 30)     return { label: `${days} days left`,                                            tone: 'bg-emerald-100 text-emerald-700' };
  return { label: `${days} days left`, tone: 'bg-gray-100 text-gray-600' };
}

function billDueLabel(dueDateISO) {
  const d = new Date(dueDateISO + 'T12:00:00');
  return 'Due ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function billAmountLabel(amount) {
  if (amount == null) return '—';
  const n = Number(amount);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

const REFRESH_MS = 60_000;
const DAY_MS = 86_400_000;
const TZ = 'America/New_York';
const ORANGE = '#E8732A';
const KPI_WINDOW_DAYS = 90; // conversion + average time look back this far

// The two flows on the TV, in Kanban order.
const SECTIONS = [
  { key: 'leads',     title: 'Leads',     stages: ['new_lead', 'contacted', 'visit_scheduled', 'visited'] },
  { key: 'estimates', title: 'Estimates', stages: ['estimate_draft', 'estimate_sent', 'estimate_negotiating', 'estimate_approved'] },
];
const BOARD_STAGES = SECTIONS.flatMap((s) => s.stages);

// Per column: short label (the "Estimate" prefix is redundant inside the
// Estimates flow), icon, and the line under the number (singular/plural).
const STAGE_META = {
  new_lead:             { icon: UserPlus,     one: 'waiting for first contact',          many: 'waiting for first contact' },
  contacted:            { icon: PhoneCall,    one: 'waiting for a visit to be scheduled', many: 'waiting for a visit to be scheduled' },
  visit_scheduled:      { icon: CalendarDays, one: 'visit booked on the calendar',       many: 'visits booked on the calendar' },
  visited:              { icon: BadgeCheck,   one: 'visited, waiting for an estimate',   many: 'visited, waiting for an estimate' },
  estimate_draft:       { icon: FileText,     short: 'Draft',       one: 'estimate being prepared', many: 'estimates being prepared' },
  estimate_sent:        { icon: Send,         short: 'Sent',        one: 'waiting for the client’s answer', many: 'waiting for the client’s answer' },
  estimate_negotiating: { icon: Handshake,    short: 'Negotiating', one: 'estimate in negotiation', many: 'estimates in negotiation' },
  estimate_approved:    { icon: FileCheck2,   short: 'Approved',    one: 'approved, contract not sent yet', many: 'approved, contract not sent yet' },
};

// "Oldest in pipeline" subtitle — where that card is stuck.
const STUCK_LABEL = {
  new_lead:             'new lead (no contact)',
  contacted:            'contacted (no visit)',
  visit_scheduled:      'visit scheduled',
  visited:              'visited (no estimate)',
  estimate_draft:       'draft (not sent)',
  estimate_sent:        'sent (no answer)',
  estimate_negotiating: 'in negotiation',
  estimate_approved:    'approved (not sent)',
};

// Stages where stageAge() has warn/late rules → "3 late · 2 almost late".
const TIMED_STAGES = new Set([
  'new_lead', 'contacted', 'visited', 'estimate_draft', 'estimate_sent', 'estimate_negotiating',
]);

const CHIP_TONE = {
  late:  'bg-rose-50 text-rose-600',
  warn:  'bg-amber-50 text-amber-600',
  ok:    'bg-emerald-50 text-emerald-600',
  info:  'bg-indigo-50 text-indigo-600',
  muted: 'bg-omega-cloud text-omega-slate border border-black/[0.06]',
};
const BAR_TONE = { ok: 'bg-emerald-500', info: 'bg-indigo-500', warn: 'bg-amber-400', late: 'bg-rose-500' };

function toMs(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

// Calendar math on 'YYYY-MM-DD' keys (noon UTC keeps DST out of it).
function addDaysKey(key, n) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function mondayKey(key) {
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysKey(key, -((wd + 6) % 7));
}
function monthKey(key, back = 0) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 10);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function topReason(rows) {
  const counts = {};
  rows.forEach((r) => { if (r.lost_reason) counts[r.lost_reason] = (counts[r.lost_reason] || 0) + 1; });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? lostReasonLabel(best[0]) : null;
}

// .in() in chunks so the URL stays short on big lists.
async function selectIn(table, columns, column, ids, build = (q) => q) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await build(supabase.from(table).select(columns).in(column, ids.slice(i, i + 150)));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

// ─── Data ───────────────────────────────────────────────────────────
// Only the board query is required; everything else degrades to "—".
async function loadTvData() {
  const now = Date.now();
  const todayKey = nyDateKey(now);
  const createdFrom = [mondayKey(todayKey), addDaysKey(todayKey, -6)].sort()[0];
  const offBoardFrom = new Date(nyMidnightMs(monthKey(todayKey, 5))).toISOString();

  const [boardRes, offRes, newRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, pipeline_status, stage_entered_at, last_touch_at, preferred_visit_date, preferred_visit_time')
      .eq('in_pipeline', true),
    supabase
      .from('jobs')
      .select('pipeline_status, lost_reason, stage_entered_at')
      .in('pipeline_status', [...OFF_BOARD_STAGES])
      .gte('stage_entered_at', offBoardFrom),
    supabase
      .from('jobs')
      .select('created_at')
      .gte('created_at', new Date(nyMidnightMs(createdFrom)).toISOString()),
  ]);
  if (boardRes.error) throw boardRes.error;
  const board = boardRes.data || [];

  // Sales visits for the Visit Scheduled cards (same source as the Kanban).
  const visitTimes = {};
  const visitIds = board.filter((j) => j.pipeline_status === 'visit_scheduled').map((j) => j.id);
  try {
    const ev = await selectIn('calendar_events', 'job_id, starts_at, visit_status', 'job_id', visitIds,
      (q) => q.eq('kind', 'sales_visit').order('starts_at', { ascending: true }));
    for (const e of ev) {
      if (!e.job_id || e.visit_status === 'cancelled') continue;
      const t = toMs(e.starts_at);
      if (t != null) (visitTimes[e.job_id] ||= []).push(t);
    }
  } catch { /* cards fall back to preferred_visit_date */ }

  const funnel = await loadVisitFunnel(now);

  return {
    board,
    visitTimes,
    offBoard: offRes.error ? null : offRes.data || [],
    created: newRes.error ? null : newRes.data || [],
    funnel,
    loadedAt: now,
  };
}

// Jobs with a sales visit in the last KPI_WINDOW_DAYS: how many got an
// estimate approved/signed, and how long that took from the first visit.
async function loadVisitFunnel(now) {
  try {
    const { data: ev, error } = await supabase
      .from('calendar_events')
      .select('job_id, starts_at, visit_status')
      .eq('kind', 'sales_visit')
      .gte('starts_at', new Date(now - KPI_WINDOW_DAYS * DAY_MS).toISOString())
      .lte('starts_at', new Date(now).toISOString());
    if (error) throw error;
    const firstVisit = {};
    for (const e of ev || []) {
      const t = toMs(e.starts_at);
      if (!e.job_id || e.visit_status === 'cancelled' || t == null) continue;
      if (!(firstVisit[e.job_id] <= t)) firstVisit[e.job_id] = t;
    }
    const ids = Object.keys(firstVisit);
    if (!ids.length) return { visited: 0, approved: 0, avgDays: null };

    const ests = await selectIn('estimates', 'job_id, status, approved_at, signed_at', 'job_id', ids,
      (q) => q.in('status', ['approved', 'signed']));
    const approvedAt = {};
    for (const e of ests) {
      const t = toMs(e.approved_at) ?? toMs(e.signed_at);
      if (!(e.job_id in approvedAt) || (t != null && (approvedAt[e.job_id] == null || t < approvedAt[e.job_id]))) {
        approvedAt[e.job_id] = t;
      }
    }
    const spans = Object.entries(approvedAt)
      .map(([id, t]) => (t == null ? null : (t - firstVisit[id]) / DAY_MS))
      .filter((d) => d != null && d >= 0);
    return {
      visited: ids.length,
      approved: Object.keys(approvedAt).length,
      avgDays: spans.length ? spans.reduce((a, d) => a + d, 0) / spans.length : null,
    };
  } catch { return null; }
}

// ─── View model ─────────────────────────────────────────────────────
// Health of one column: chips for the footer + bar segments ({ tone, n }).
function stageHealth(status, jobs, { now, todayKey, visitTimes }) {
  if (!jobs.length) return { chips: [], segments: [], late: 0 };

  if (status === 'visit_scheduled') {
    let today = 0, past = 0, noDate = 0;
    jobs.forEach((j) => {
      const v = resolveVisit(j, visitTimes[j.id], now);
      if (!v) noDate++;
      else if (v.dateKey === todayKey) today++;
      else if (v.dateKey < todayKey) past++;
    });
    const upcoming = jobs.length - today - past - noDate;
    return {
      late: past,
      segments: [{ tone: 'ok', n: upcoming }, { tone: 'info', n: today }, { tone: 'warn', n: noDate }, { tone: 'late', n: past }],
      chips: [
        past && { tone: 'late', text: `${past} late` },
        today && { tone: 'info', text: `${today} today` },
        noDate && { tone: 'warn', text: `${noDate} no date` },
        !past && !today && !noDate && { tone: 'ok', text: 'All upcoming' },
      ].filter(Boolean),
    };
  }

  if (TIMED_STAGES.has(status)) {
    let late = 0, warn = 0;
    jobs.forEach((j) => {
      const tone = stageAge(j, { now })?.tone;
      if (tone === 'late') late++;
      else if (tone === 'warn') warn++;
    });
    return {
      late,
      segments: [{ tone: 'ok', n: jobs.length - late - warn }, { tone: 'warn', n: warn }, { tone: 'late', n: late }],
      chips: !late && !warn
        ? [{ tone: 'ok', text: 'All on time' }]
        : [
          late && { tone: 'late', text: `${late} late` },
          warn && { tone: 'warn', text: `${warn} almost late` },
        ].filter(Boolean),
    };
  }

  // Estimate Approved has no time rule — the oldest card still tells a story.
  const oldest = Math.max(...jobs.map((j) => now - (toMs(j.stage_entered_at) ?? now)));
  const days = Math.floor(oldest / DAY_MS);
  return {
    late: 0,
    segments: [],
    chips: [{ tone: 'muted', icon: Clock, text: `Oldest: ${days ? plural(days, 'day', 'days') : 'today'}` }],
  };
}

function buildView(data, now) {
  const todayKey = nyDateKey(now);
  const todayStartMs = nyMidnightMs(todayKey);
  const weekStartMs = nyMidnightMs(mondayKey(todayKey));

  const byStage = Object.fromEntries(BOARD_STAGES.map((s) => [s, []]));
  (data?.board || []).forEach((j) => {
    if (byStage[j.pipeline_status]) byStage[j.pipeline_status].push(j);
    else if (!PIPELINE_STEP_LABEL[j.pipeline_status]) byStage.new_lead.push(j); // unknown → New Lead, like the Kanban
  });

  let totalLate = 0;
  const sections = SECTIONS.map((section) => {
    let open = 0, late = 0;
    const tiles = section.stages.map((status) => {
      const jobs = byStage[status];
      const health = data
        ? stageHealth(status, jobs, { now, todayKey, visitTimes: data.visitTimes })
        : { chips: [], segments: [], late: 0 };
      open += jobs.length;
      late += health.late;
      const meta = STAGE_META[status];
      return {
        key: status,
        label: meta.short || PIPELINE_STEP_LABEL[status],
        icon: meta.icon,
        hex: PIPELINE_COLORS[status]?.hex,
        count: data ? jobs.length : null,
        text: data ? (jobs.length === 1 ? meta.one : meta.many) : '',
        chips: health.chips,
        segments: health.segments,
        // Draft is Omega's own backlog — call it out when it's running late.
        highlight: status === 'estimate_draft' && health.late > 0,
      };
    });
    totalLate += late;
    return { ...section, tiles, open: data ? open : null, late };
  });

  // Snapshot — counts + small trend bars (oldest → newest).
  const created = data?.created;
  const createdMs = created ? created.map((r) => toMs(r.created_at) ?? 0) : null;
  const incomingTrend = createdMs
    ? Array.from({ length: 7 }, (_, i) => {
      const from = nyMidnightMs(addDaysKey(todayKey, i - 6));
      const to = i === 6 ? Infinity : nyMidnightMs(addDaysKey(todayKey, i - 5));
      return createdMs.filter((t) => t >= from && t < to).length;
    })
    : null;

  const offBoard = data?.offBoard;
  const offTile = (status, text, icon) => {
    const rows = offBoard ? offBoard.filter((r) => r.pipeline_status === status) : null;
    const byMonth = rows
      ? Array.from({ length: 6 }, (_, i) => {
        const from = nyMidnightMs(monthKey(todayKey, 5 - i));
        const to = i === 5 ? Infinity : nyMidnightMs(monthKey(todayKey, 4 - i));
        return rows.filter((r) => { const t = toMs(r.stage_entered_at) ?? 0; return t >= from && t < to; });
      })
      : null;
    const month = byMonth ? byMonth[5] : null;
    const reason = month ? topReason(month) : null;
    const hex = PIPELINE_COLORS[status]?.hex;
    return {
      key: status,
      label: PIPELINE_STEP_LABEL[status],
      labelColor: status === 'estimate_rejected' ? hex : null,
      icon,
      iconBg: hex,
      tag: 'This month',
      hex,
      count: month ? month.length : null,
      text: month ? `${month.length === 1 ? 'lead' : 'leads'} ${text}` : '',
      trend: byMonth ? byMonth.map((m) => m.length) : null,
      chips: reason ? [{ tone: 'muted', text: `Top reason: ${reason}` }] : [],
    };
  };

  const todayCount = createdMs ? createdMs.filter((t) => t >= todayStartMs).length : null;
  const side = [
    {
      key: 'incoming',
      label: 'Incoming',
      icon: Bell,
      iconBg: ORANGE,
      tag: 'Today',
      hex: ORANGE,
      count: todayCount,
      text: todayCount == null ? '' : `${todayCount === 1 ? 'lead' : 'leads'} came in today`,
      trend: incomingTrend,
      chips: createdMs ? [{ tone: 'muted', dot: true, text: `${createdMs.filter((t) => t >= weekStartMs).length} this week` }] : [],
    },
    offTile('disqualified', 'disqualified this month', X),
    offTile('estimate_rejected', 'lost this month', X),
  ];

  // Bottom KPIs.
  let oldest = null;
  BOARD_STAGES.forEach((status) => byStage[status].forEach((j) => {
    const since = toMs(j.stage_entered_at);
    if (since != null && (!oldest || since < oldest.since)) oldest = { since, status };
  }));
  const funnel = data?.funnel;
  const oldestDays = oldest ? Math.floor((now - oldest.since) / DAY_MS) : null;
  const kpis = [
    {
      key: 'conversion', icon: BarChart3, label: 'Conversion rate',
      value: funnel?.visited ? `${Math.round((funnel.approved / funnel.visited) * 100)}%` : '—',
      sub: 'visits → approved', help: `Jobs with a sales visit in the last ${KPI_WINDOW_DAYS} days that got an estimate approved.`,
    },
    {
      key: 'avg', icon: Clock, label: 'Average time',
      value: funnel?.avgDays != null ? plural(Math.round(funnel.avgDays), 'day', 'days') : '—',
      sub: 'visit → approval',
    },
    {
      key: 'oldest', icon: CalendarDays, label: 'Oldest in pipeline',
      value: oldestDays != null ? plural(oldestDays, 'day', 'days') : '—',
      sub: oldest ? STUCK_LABEL[oldest.status] : '',
    },
  ];

  return { sections, side, kpis, totalLate };
}

// ─── UI ─────────────────────────────────────────────────────────────
function Chip({ tone, text, icon: Icon, dot }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full font-bold leading-tight text-[clamp(12px,1.7vh,18px)] ${CHIP_TONE[tone]}`}>
      {Icon
        ? <Icon className="w-[1.1em] h-[1.1em] flex-shrink-0" strokeWidth={2.5} />
        : (tone !== 'muted' || dot) && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${tone === 'muted' ? 'bg-omega-stone' : 'bg-current'}`} />}
      {text}
    </span>
  );
}

// Segmented bar: one slice per health bucket, sized by card count.
function HealthBar({ segments }) {
  const total = segments.reduce((a, s) => a + s.n, 0);
  if (!total) return <div className="h-2 w-full rounded-full bg-black/[0.06]" />;
  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden bg-black/[0.06]">
      {segments.filter((s) => s.n > 0).map((s) => (
        <div key={s.tone} className={`${BAR_TONE[s.tone]} h-full transition-all duration-700`} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

function StageTile({ label, icon: Icon, hex, count, text, chips, segments, highlight }) {
  const color = highlight ? ORANGE : hex;
  return (
    <div
      className={`relative flex-1 min-w-0 rounded-3xl bg-white shadow-card overflow-hidden flex flex-col ${
        highlight ? 'border-2 border-omega-orange' : 'border border-black/[0.05]'
      }`}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(180deg, ${color}${highlight ? '24' : '14'} 0%, ${color}00 75%)` }}
      />
      <div className="relative px-7 pt-6 flex items-center gap-3">
        <Icon className="w-[clamp(20px,3vh,32px)] h-[clamp(20px,3vh,32px)] flex-shrink-0" style={{ color }} strokeWidth={2.25} />
        <p className="font-extrabold uppercase tracking-wide truncate text-[clamp(14px,2vh,22px)]" style={{ color }}>
          {label}
        </p>
      </div>
      <div className="relative flex-1 min-h-0 px-7 pb-5 flex flex-col">
        <p className={`mt-1 font-black tabular-nums leading-none tracking-tight text-[clamp(48px,10vh,112px)] ${count ? 'text-[#111]' : 'text-omega-fog'}`}>
          {count ?? '—'}
        </p>
        <p className="mt-2 text-omega-slate font-medium leading-snug line-clamp-2 text-[clamp(13px,2vh,21px)]">{text}</p>
        <div className="mt-auto pt-3 space-y-3">
          {segments.length > 0 && <HealthBar segments={segments} />}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => <Chip key={c.text} {...c} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Little bar trend — last bar (today / this month) in full color.
function TrendBars({ values, hex }) {
  if (!values) return null;
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[clamp(3px,0.5vh,6px)] h-[clamp(28px,5.5vh,60px)] flex-shrink-0">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-[clamp(5px,0.9vh,10px)] rounded-full"
          style={{
            height: `${Math.max(22, (v / max) * 100)}%`,
            background: hex,
            opacity: i === values.length - 1 ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

function SideTile({ label, labelColor, icon: Icon, iconBg, tag, hex, count, text, trend, chips }) {
  return (
    <div className="flex-1 min-h-0 rounded-3xl bg-white shadow-card border border-black/[0.05] px-7 py-5 flex flex-col justify-center">
      <div className="flex items-center gap-3">
        <span className="w-[clamp(26px,3.6vh,38px)] h-[clamp(26px,3.6vh,38px)] rounded-full flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
          <Icon className="w-3/5 h-3/5 text-white" strokeWidth={3} />
        </span>
        <p className="flex-1 font-extrabold uppercase tracking-wide truncate text-[clamp(14px,2vh,22px)]" style={{ color: labelColor || '#111' }}>{label}</p>
        <span className="flex-shrink-0 rounded-lg px-3 py-1 font-bold uppercase tracking-wide text-[clamp(10px,1.3vh,14px)] bg-omega-cloud text-omega-slate">
          {tag}
        </span>
      </div>
      <div className="flex items-end gap-4 mt-3">
        <p className={`font-black tabular-nums leading-none tracking-tight text-[clamp(40px,8vh,88px)] ${count ? 'text-[#111]' : 'text-omega-fog'}`}>
          {count ?? '—'}
        </p>
        <p className="flex-1 min-w-0 pb-2 text-omega-slate font-medium leading-snug line-clamp-2 text-[clamp(12px,1.9vh,20px)]">{text}</p>
        <TrendBars values={trend} hex={hex} />
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => <Chip key={c.text} {...c} />)}
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, help }) {
  return (
    <div className="flex-1 min-w-0 rounded-3xl bg-white shadow-card border border-black/[0.05] px-5 py-5 flex items-center gap-4">
      <span
        className="w-[clamp(44px,6.5vh,68px)] h-[clamp(44px,6.5vh,68px)] rounded-2xl flex items-center justify-center flex-shrink-0 bg-omega-cloud text-[#111]"
      >
        <Icon className="w-1/2 h-1/2" strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="font-bold uppercase tracking-wider text-omega-stone truncate text-[clamp(10px,1.4vh,15px)]">{label}</p>
        <p className="font-black tabular-nums text-[#111] leading-tight whitespace-nowrap tracking-tight text-[clamp(20px,3.3vh,36px)]">{value}</p>
        <p className="text-omega-slate font-medium truncate inline-flex items-center gap-2 max-w-full text-[clamp(12px,1.8vh,19px)]">
          {sub}
          {help && <HelpCircle className="w-[1em] h-[1em] text-omega-fog flex-shrink-0" title={help} />}
        </p>
      </div>
    </div>
  );
}

function SectionTitle({ title, children }) {
  return (
    <div className="flex items-center gap-4 mb-3 flex-shrink-0">
      <span className="w-1.5 h-[clamp(20px,3vh,32px)] rounded-full bg-omega-orange flex-shrink-0" />
      <h2 className="font-black uppercase tracking-wide text-[#111] text-[clamp(18px,2.8vh,30px)]">{title}</h2>
      <div className="flex-1 h-px bg-black/10" />
      {children}
    </div>
  );
}

function Flow({ section }) {
  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <SectionTitle title={section.title}>
        {section.open != null && (
          <p className="font-semibold text-omega-stone text-[clamp(12px,1.9vh,20px)]">
            <span className="text-[#111] font-black">{section.open}</span> open
            {section.late > 0 && <> · <span className="text-rose-600 font-black">{section.late}</span> late</>}
          </p>
        )}
      </SectionTitle>
      <div className="flex-1 min-h-0 flex items-stretch">
        {section.tiles.map(({ key, ...tile }, i) => (
          <div key={key} className="contents">
            {i > 0 && (
              <div className="w-[clamp(20px,2.2vw,42px)] flex-shrink-0 flex items-center justify-center text-omega-fog">
                <ChevronRight className="w-full h-auto" strokeWidth={2.5} />
              </div>
            )}
            <StageTile {...tile} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Bills to pay (right-most column on the TV) ──────────────────────
// Reads the same pending bills Operations sees in Finance → Bills, in
// due-date order. Read-only on the TV; the header link and the "+ Add
// bill" button bounce to /finance where Brenda does the actual CRUD.
function BillsPanel({ bills, onNavigate }) {
  const nowMs = Date.now();
  // Show overdue + upcoming — the ones that actually need attention.
  // Rows are sized for reading from across the room, so fewer fit.
  const visible = bills.slice(0, 7);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Same header as Snapshot / Leads so the three columns read as one board. */}
      <SectionTitle title="Bills to pay">
        <button
          onClick={onNavigate}
          className="font-semibold text-omega-stone hover:text-omega-orange inline-flex items-center gap-1 text-[clamp(12px,1.6vh,17px)]"
        >
          View all <ArrowRight className="w-[1em] h-[1em]" />
        </button>
      </SectionTitle>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-[clamp(8px,1.1vh,14px)]">
        {visible.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-omega-stone font-medium text-[clamp(14px,2vh,22px)]">
            All bills are paid.
          </div>
        ) : (
          visible.map((bill) => {
            const Icon = BILL_CATEGORY_ICON[bill.category] || FileText;
            const days = daysUntilDue(bill, nowMs);
            const chip = dueChip(days);
            return (
              <div key={bill.id} className="flex items-center gap-4 px-5 py-[clamp(10px,1.5vh,18px)] rounded-2xl bg-white shadow-card border border-black/[0.05]">
                <div className="w-[clamp(36px,5vh,54px)] h-[clamp(36px,5vh,54px)] rounded-xl bg-omega-cloud flex items-center justify-center flex-shrink-0 text-omega-stone">
                  <Icon className="w-1/2 h-1/2" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold uppercase tracking-wider text-omega-stone truncate text-[clamp(10px,1.3vh,14px)]">
                    {categoryLabel(bill.category)}
                  </p>
                  {/* Same size as the stage-card titles (New Lead, Contacted…). */}
                  <p className="font-extrabold text-[#111] truncate leading-tight text-[clamp(14px,2vh,22px)]">
                    {bill.label}
                  </p>
                  <p className="text-omega-slate font-medium whitespace-nowrap text-[clamp(12px,1.6vh,17px)]">
                    {billDueLabel(bill.due_date)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {/* Readable but deliberately not the loudest thing on the row. */}
                  <p className="font-semibold text-omega-slate tabular-nums whitespace-nowrap text-[clamp(13px,1.8vh,20px)]">
                    {billAmountLabel(bill.amount)}
                  </p>
                  <span className={`font-bold px-2.5 py-1 rounded-lg whitespace-nowrap text-[clamp(11px,1.4vh,15px)] ${chip.tone}`}>
                    {chip.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        onClick={onNavigate}
        className="mt-3 w-full py-3 rounded-xl border-2 border-dashed border-black/[0.12] text-omega-stone hover:text-omega-orange hover:border-omega-orange inline-flex items-center justify-center gap-2 font-semibold transition-colors flex-shrink-0 text-[clamp(13px,1.7vh,18px)]"
      >
        <Plus className="w-4 h-4" /> Add bill
      </button>
    </div>
  );
}

export default function PipelineTV() {
  const navigate = useNavigate();
  const now = useNow(15_000);
  const [data, setData] = useState(null);
  const [bills, setBills] = useState([]);
  const [error, setError] = useState(false);
  const [idle, setIdle] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  // Load now, every minute, and a beat after any change to jobs or bills.
  useEffect(() => {
    let alive = true;
    let debounce;
    async function load() {
      try {
        const [d, bl] = await Promise.all([
          loadTvData(),
          loadUpcomingBills({ limit: 12 }).catch(() => []),
        ]);
        if (alive) { setData(d); setBills(bl); setError(false); }
      } catch {
        if (alive) setError(true);
      }
    }
    load();
    const iv = setInterval(load, REFRESH_MS);
    const jobsChan = supabase
      .channel('marketing-tv-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(load, 2000);
      })
      .subscribe();
    const billsChan = supabase
      .channel('marketing-tv-bills')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills' }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(load, 2000);
      })
      .subscribe();
    return () => {
      alive = false;
      clearInterval(iv);
      clearTimeout(debounce);
      supabase.removeChannel(jobsChan);
      supabase.removeChannel(billsChan);
    };
  }, []);

  // Keep the TV from dimming/sleeping while the page is visible.
  useEffect(() => {
    let lock = null;
    async function acquire() {
      if (document.visibilityState !== 'visible') return;
      try { lock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported or denied */ }
    }
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      lock?.release?.().catch(() => {});
    };
  }, []);

  // Hide the cursor and the controls after 3 s without mouse/keyboard.
  useEffect(() => {
    let t;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const { sections, side, kpis, totalLate } = useMemo(() => buildView(data, now), [data, now]);

  const dateLabel = new Date(now).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const updatedLabel = !data
    ? (error ? 'Can’t reach the server — retrying…' : 'Loading…')
    : `${error ? 'Offline · last update' : 'Live · updated'} ${formatNyTime(data.loadedAt)}`;

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    navigate('/');
  };

  return (
    <div className={`h-screen w-screen overflow-hidden bg-omega-cloud flex flex-col select-none ${idle ? 'cursor-none' : ''}`}>
      <header className="flex items-stretch bg-white border-b border-black/[0.06] flex-shrink-0 h-[clamp(64px,9.5vh,104px)]">
        {/* Dark logo block with the orange diagonal stripe. */}
        <div className="relative w-[clamp(240px,20vw,400px)] flex-shrink-0 bg-omega-orange [clip-path:polygon(0_0,100%_0,calc(100%-3.2vw)_100%,0_100%)]">
          <div className="absolute inset-0 bg-[#141414] flex items-center pl-[2vw] [clip-path:polygon(0_0,calc(100%-1.5vw)_0,calc(100%-4.7vw)_100%,0_100%)]">
            <img src={logoImg} alt="Omega Development" className="h-full w-auto scale-110 origin-left" />
          </div>
        </div>

        <div className="min-w-0 flex flex-col justify-center pl-[1.5vw]">
          <p className="text-[#111] font-bold uppercase tracking-[0.25em] text-[clamp(11px,1.5vh,16px)]">Pipeline Today</p>
          <p className="text-[#111] font-black leading-tight truncate text-[clamp(22px,3.8vh,42px)]">{dateLabel}</p>
        </div>

        <div className="ml-auto flex items-center gap-8 pr-8">
          {data && (
            <span
              className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full font-bold text-[clamp(14px,2vh,22px)] ${
                totalLate > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full bg-current" />
              {totalLate > 0 ? `${plural(totalLate, 'card', 'cards')} late` : 'Everything on time'}
            </span>
          )}
          <div className="text-right">
            <p className="text-[#111] font-black tabular-nums leading-none text-[clamp(24px,4vh,44px)]">{formatNyTime(now)}</p>
            <p className={`mt-1.5 inline-flex items-center gap-1.5 font-medium text-[clamp(11px,1.4vh,15px)] ${error ? 'text-amber-600' : 'text-omega-slate'}`}>
              {data && !error && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
              {updatedLabel}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 px-8 pt-5 pb-6 flex gap-6">
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          {sections.map((s) => <Flow key={s.key} section={s} />)}
          <div className="flex gap-4 flex-shrink-0 h-[clamp(84px,12.5vh,136px)]">
            {kpis.map(({ key, ...kpi }) => <KpiCard key={key} {...kpi} />)}
          </div>
        </div>

        <aside className="w-[16%] flex-shrink-0 flex flex-col">
          <SectionTitle title="Snapshot" />
          <div className="flex-1 min-h-0 flex flex-col gap-5">
            {side.map(({ key, ...tile }) => <SideTile key={key} {...tile} />)}
          </div>
        </aside>

        <aside className="w-[22%] flex-shrink-0 flex flex-col min-h-0">
          <BillsPanel bills={bills} onNavigate={() => navigate('/finance')} />
        </aside>
      </main>

      {/* Floating controls — fade out with the cursor so the TV stays clean. */}
      <div className={`fixed bottom-4 right-4 flex gap-2 transition-opacity duration-300 ${idle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {!isFullscreen && (
          <button
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-charcoal text-white text-sm font-semibold shadow-lg hover:bg-black"
          >
            <Maximize2 className="w-4 h-4" /> Full screen
          </button>
        )}
        <button
          onClick={exit}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-omega-charcoal text-sm font-semibold shadow-lg border border-black/10 hover:bg-omega-cloud"
        >
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
      </div>
    </div>
  );
}
