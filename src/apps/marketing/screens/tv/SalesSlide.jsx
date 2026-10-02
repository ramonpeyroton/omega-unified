// TV slide 1 — Sales pipeline. The sales side of the pipeline as a flow:
// Leads (New Lead → Visited) and Estimates (Draft → Approved), one tile per
// column with its card count, an on-time/late health bar (same time-in-stage
// rules as the Kanban cards, see stageAge.js) and WHO is there: the clients'
// names, late ones first with a red dot and how long they've been waiting.
// Below, a quiet strip: visit → approval conversion + average time, oldest
// card, and the Disqualified / Lost totals. No money on purpose.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, UserPlus, PhoneCall, CalendarDays, BadgeCheck, FileText, Send,
  Handshake, FileCheck2, X, BarChart3, Clock, TrendingUp,
} from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { PIPELINE_COLORS, PIPELINE_STEP_LABEL, OFF_BOARD_STAGES } from '../../../../shared/config/phaseBreakdown';
import { stageAge, resolveVisit, nyDateKey, nyMidnightMs } from '../../../../shared/lib/stageAge';
import { lostReasonLabel } from '../../../receptionist/lib/leadCatalog';
import {
  DAY_MS, ORANGE, toMs, plural, selectIn, useCountUp,
  SectionTitle, SlideLoading,
} from './tvKit';

export const meta = {
  key: 'sales',
  title: 'Sales Pipeline',
  eyebrow: 'Leads & estimates',
  icon: TrendingUp,
  tables: ['jobs', 'estimates'],
};

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

const BAR_TONE = { ok: 'bg-emerald-500', info: 'bg-indigo-500', warn: 'bg-amber-400', late: 'bg-rose-500' };

// First day of the month `back` months before the month of `key` ('YYYY-MM-DD').
function monthKey(key, back = 0) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 10);
}


function topReason(rows) {
  const counts = {};
  rows.forEach((r) => { if (r.lost_reason) counts[r.lost_reason] = (counts[r.lost_reason] || 0) + 1; });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? lostReasonLabel(best[0]) : null;
}

// Only the board query is required; everything else degrades to "—".
export async function load(now = Date.now()) {

  const [boardRes, offRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, client_name, pipeline_status, stage_entered_at, last_touch_at, preferred_visit_date, preferred_visit_time')
      .eq('in_pipeline', true),
    supabase
      .from('jobs')
      .select('pipeline_status, lost_reason, stage_entered_at')
      .in('pipeline_status', [...OFF_BOARD_STAGES]),
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

// "45m" / "5h" / "12d" — how long a card has been waiting.
function shortSpan(ms) {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / (24 * 60))}d`;
}

// One line per client in a tile: name, a short "how long / when", and the
// tone of its time-in-stage (late / warn / ok) — late first, then oldest.
function stagePeople(status, jobs, { now, todayKey, visitTimes }) {
  const TONE_RANK = { late: 0, warn: 1, info: 2, ok: 3 };
  return jobs.map((j) => {
    const name = (j.client_name || '').trim() || 'Unnamed lead';
    if (status === 'visit_scheduled') {
      const v = resolveVisit(j, visitTimes[j.id], now);
      if (!v) return { id: j.id, name, when: 'no date', tone: 'warn', sort: Infinity };
      const days = Math.round((nyMidnightMs(v.dateKey) - nyMidnightMs(todayKey)) / DAY_MS);
      const when = days === 0 ? `today${v.timeLabel ? ` ${v.timeLabel}` : ''}`
        : days === 1 ? 'tomorrow'
          : days < 0 ? `${-days}d ago`
            : new Date(`${v.dateKey}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
      return { id: j.id, name, when, tone: days < 0 ? 'late' : days === 0 ? 'info' : 'ok', sort: days };
    }
    const entered = toMs(j.stage_entered_at);
    const touch = toMs(j.last_touch_at);
    const since = ['estimate_sent', 'estimate_negotiating'].includes(status)
      ? Math.max(entered ?? -Infinity, touch ?? -Infinity)
      : entered;
    const age = Number.isFinite(since) && since != null ? now - since : null;
    const tone = TIMED_STAGES.has(status) ? (stageAge(j, { now })?.tone || 'ok') : 'ok';
    return { id: j.id, name, when: age != null ? shortSpan(age) : '', tone, sort: -(age ?? 0) };
  }).sort((a, b) => (TONE_RANK[a.tone] - TONE_RANK[b.tone]) || (a.sort - b.sort));
}

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
        people: data ? stagePeople(status, jobs, { now, todayKey, visitTimes: data.visitTimes }) : [],
        // Draft is Omega's own backlog — call it out when it's running late.
        highlight: status === 'estimate_draft' && health.late > 0,
      };
    });
    totalLate += late;
    return { ...section, tiles, open: data ? open : null, late };
  });

  // Snapshot — Disqualified + Lost totals with small monthly trend bars
  // (oldest → newest).
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
    // The big number is every card sitting in that column, all-time.
    // The trend bars still show when cards landed there (last 6 months).
    const reason = rows ? topReason(rows) : null;
    const hex = PIPELINE_COLORS[status]?.hex;
    return {
      key: status,
      label: PIPELINE_STEP_LABEL[status],
      labelColor: status === 'estimate_rejected' ? hex : null,
      icon,
      iconBg: hex,
      tag: 'Total',
      hex,
      count: rows ? rows.length : null,
      text: rows ? `${rows.length === 1 ? 'lead' : 'leads'} ${text}` : '',
      trend: byMonth ? byMonth.map((m) => m.length) : null,
      chips: reason ? [{ tone: 'muted', text: `Top reason: ${reason}` }] : [],
    };
  };

  const side = [
    offTile('disqualified', 'disqualified', X),
    offTile('estimate_rejected', 'lost', X),
  ];
  const stripOff = side.map((t) => ({
    key: t.key,
    icon: t.icon,
    iconHex: t.hex,
    label: t.label,
    value: t.count != null ? t.count.toLocaleString('en-US') : '—',
    sub: t.chips[0]?.text?.replace('Top reason: ', 'mostly ') || 'all time',
  }));

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

  return { sections, strip: [...kpis, ...stripOff], totalLate };
}

// Count that rolls up from 0 each time the slide comes on screen.
function Count({ value }) {
  const n = useCountUp(value ?? 0);
  return value == null ? '—' : Math.round(n);
}

// Segmented bar: one slice per health bucket, sized by card count.
function HealthBar({ segments }) {
  const total = segments.reduce((a, s) => a + s.n, 0);
  if (!total) return <div className="h-1.5 w-full rounded-full bg-black/[0.06]" />;
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-black/[0.06]">
      {segments.filter((s) => s.n > 0).map((s) => (
        <div key={s.tone} className={`${BAR_TONE[s.tone]} h-full transition-all duration-700`} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

// Hides list rows that don't fit whole and reports how many were hidden.
function useFitCount(deps) {
  const ref = useRef(null);
  const [hidden, setHidden] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const fit = () => {
      const limit = box.clientHeight + 1;
      let h = 0;
      for (const el of box.children) {
        const ok = el.offsetTop + el.offsetHeight <= limit;
        el.style.visibility = ok ? '' : 'hidden';
        if (!ok) h++;
      }
      setHidden(h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    document.fonts?.ready?.then(fit).catch(() => {});
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, hidden];
}

const DOT = { late: 'bg-rose-500', warn: 'bg-amber-400', info: 'bg-indigo-500', ok: 'bg-emerald-500' };
const WHEN = { late: 'text-rose-600', warn: 'text-amber-600', info: 'text-indigo-600', ok: 'text-omega-stone' };

function PersonRow({ p }) {
  return (
    <div className="flex items-center gap-[0.45em] min-w-0 h-[1.3em] text-[clamp(15px,2.4vh,29px)]">
      <span className={`w-[0.4em] h-[0.4em] rounded-full flex-shrink-0 ${DOT[p.tone]}`} />
      <span className="flex-1 min-w-0 truncate font-medium text-[#111] leading-tight tracking-tight">{p.name}</span>
      {p.when && <span className={`flex-shrink-0 text-[0.8em] font-semibold tabular-nums leading-tight ${WHEN[p.tone]}`}>{p.when}</span>}
    </div>
  );
}

function StageTile({ label, icon: Icon, hex, count, chips, segments, people, highlight }) {
  const color = highlight ? ORANGE : hex;
  const [listRef, hidden] = useFitCount([people]);
  const lateChip = chips.find((c) => c.tone === 'late');
  return (
    <div
      className={`relative flex-1 min-w-0 rounded-3xl bg-white shadow-card overflow-hidden flex flex-col ${
        highlight ? 'border-2 border-omega-orange' : 'border border-black/[0.05]'
      }`}
    >
      {/* Colored header band with the label and the count. */}
      <div className="relative px-6 pt-4 pb-3 flex items-center gap-3" style={{ background: `${color}1A` }}>
        <span className="w-[clamp(34px,4.6vh,50px)] h-[clamp(34px,4.6vh,50px)] rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: color }}>
          <Icon className="w-1/2 h-1/2 text-white" strokeWidth={2.5} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold uppercase tracking-wide truncate leading-tight text-[clamp(16px,2.5vh,28px)]" style={{ color: shadeHex(color) }}>
            {label}
          </p>
          {lateChip
            ? <p className="font-bold text-rose-600 leading-tight text-[clamp(12px,1.7vh,18px)]">{lateChip.text}</p>
            : <p className="font-semibold text-omega-stone leading-tight text-[clamp(12px,1.7vh,18px)]">{count ? 'on track' : 'empty'}</p>}
        </div>
        <p className={`font-black tabular-nums leading-none tracking-tight text-[clamp(40px,7.4vh,84px)] ${count ? 'text-[#111]' : 'text-omega-fog'}`}>
          <Count value={count} />
        </p>
      </div>
      {/* Same spacing in every tile: tiles without a health bar keep an
          empty one so their lists start at the same height. */}
      <div className={`px-6 pt-2.5 ${segments.length ? "" : "invisible"}`}><HealthBar segments={segments} /></div>

      <div className="relative flex-1 min-h-0 px-6 pt-2 pb-3 flex flex-col">
        {people.length ? (
          <>
            <div ref={listRef} className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
              {people.map((p) => <PersonRow key={p.id} p={p} />)}
            </div>
            {hidden > 0 && (
              <p className="flex-shrink-0 pt-1 font-bold text-omega-slate text-[clamp(12px,1.7vh,18px)]">+{hidden} more</p>
            )}
          </>
        ) : (
          <p className="m-auto font-semibold text-omega-fog text-[clamp(13px,2vh,21px)]">Nobody here</p>
        )}
      </div>
    </div>
  );
}

// Darker stop of a stage color so the label reads on its light band.
function shadeHex(hex, amt = 0.25) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c) => Math.round(c * (1 - amt)).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

function StripItem({ icon: Icon, iconHex, label, value, sub }) {
  return (
    <div className="flex items-center gap-3.5 min-w-0 px-5">
      <span
        className="w-[clamp(30px,4.2vh,44px)] h-[clamp(30px,4.2vh,44px)] rounded-xl flex items-center justify-center flex-shrink-0"
        style={iconHex ? { background: `${iconHex}1F`, color: iconHex } : undefined}
      >
        <Icon className={`w-1/2 h-1/2 ${iconHex ? '' : 'text-omega-slate'}`} strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <p className="font-bold uppercase tracking-wider text-omega-stone truncate leading-tight text-[clamp(10px,1.4vh,15px)]">{label}</p>
        <p className="flex items-baseline gap-2 min-w-0 leading-tight">
          <span className="font-bold tabular-nums text-[#111] whitespace-nowrap text-[clamp(17px,2.5vh,27px)]">{value}</span>
          {sub && <span className="font-medium text-omega-stone truncate min-w-0 text-[clamp(11px,1.6vh,17px)]">{sub}</span>}
        </p>
      </div>
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
              <div className="w-[clamp(16px,1.6vw,32px)] flex-shrink-0 flex items-center justify-center text-omega-fog">
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

export default function SalesSlide({ data, now }) {
  const { sections, strip } = useMemo(() => buildView(data, now), [data, now]);
  if (!data) return <SlideLoading />;
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      {sections.map((s) => <Flow key={s.key} section={s} />)}
      <div className="flex-shrink-0 rounded-3xl bg-white shadow-card border border-black/[0.05] grid grid-cols-5 divide-x divide-black/[0.06] py-3">
        {strip.map(({ key, ...item }) => <StripItem key={key} {...item} />)}
      </div>
    </div>
  );
}
