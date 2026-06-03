import { useEffect, useMemo, useState } from 'react';
import {
  PlusCircle, Bell, LogOut, GitBranch, Calendar as CalendarIcon, FileText,
  ClipboardList, ArrowRight, TrendingUp, TrendingDown, MapPin, Phone,
  CalendarCheck, Lightbulb, Home as HomeIcon, Sparkles, DollarSign, MessageCircle,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';
import UserProfileModal from '../../../shared/components/UserProfileModal';
import NotificationsBell from '../../../shared/components/NotificationsBell';
import DailyLogsList from '../../../shared/components/DailyLogsList';

// ─── Date helpers ───────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function startOfMonthISO(refDate = new Date()) {
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  return d.toISOString();
}

function startOfPreviousMonthISO(refDate = new Date()) {
  const d = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1);
  return d.toISOString();
}

function relTime(d) {
  const ms = Date.now() - new Date(d).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString();
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtMoneyShort(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '');
}

function isSameDayCT(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
      && da.getMonth() === db.getMonth()
      && da.getDate() === db.getDate();
}

// ─── Pipeline phases shown on the overview list ─────────────────────
// Order matches the redesign: lead → estimate sent → negotiating →
// contract sent → won. Pre-lead drafts and rejected are hidden so the
// seller only sees stages that still have a path to close.
const OVERVIEW_PHASES = [
  { key: 'new_lead',             label: 'New Lead',             tint: 'bg-omega-pale text-omega-charcoal' },
  { key: 'estimate_sent',        label: 'Estimate Sent',        tint: 'bg-violet-100 text-violet-700' },
  { key: 'estimate_negotiating', label: 'Negotiating',          tint: 'bg-amber-100 text-amber-700' },
  { key: 'estimate_approved',    label: 'Approved',             tint: 'bg-emerald-100 text-emerald-700' },
  { key: 'contract_sent',        label: 'Contract Sent',        tint: 'bg-blue-100 text-blue-700' },
  { key: 'won',                  label: 'Won',                  tint: 'bg-emerald-100 text-emerald-800',
    matches: (j) => ['contract_signed', 'in_progress', 'completed'].includes(j.pipeline_status) },
];

// ─── Tiny inline sparkline (real data, oldest → newest) ────────────
// Each KPI card passes a `points` array (one value per month, 6
// elements typical, oldest first). Baseline is always 0 — using
// min(series) as baseline made every card's pick float at the top of
// the viewBox, so a 1-lead month looked identical to a 31-estimate
// month. With baseline=0 the curves keep their relative shape but a
// small absolute value stays small on screen and a big absolute value
// fills most of the box, so the cards differ visually at a glance.
//
// Area fill + a dot on the most recent point are pure visual polish:
// they make the curve obvious even in a 80x28 box at a casual glance.
function Sparkline({ points, color = '#E8732A' }) {
  const W = 80;
  const H = 28;
  const PAD_Y = 3;
  const BASELINE_Y = H - PAD_Y; // where v=0 sits

  const series = Array.isArray(points) && points.length > 0
    ? points.map((v) => Number(v) || 0)
    : null;

  // Empty / no data → flat baseline.
  if (!series || series.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none" aria-hidden="true">
        <line x1={0} y1={BASELINE_Y} x2={W} y2={BASELINE_Y} stroke={color} strokeOpacity={0.3} strokeWidth={1.5} />
      </svg>
    );
  }

  // Single point → just a dot.
  if (series.length === 1) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <circle cx={W / 2} cy={H / 2} r="2" fill={color} />
      </svg>
    );
  }

  // Multi-point: scale from 0 → max(series). Baseline is anchored to
  // the bottom so the visual area below the line is proportional to
  // each card's actual numbers.
  const max = Math.max(...series, 1); // avoid /0 if everything is zero
  const stepX = W / (series.length - 1);
  const coords = series.map((v, i) => {
    const x = i * stepX;
    const y = BASELINE_Y - (BASELINE_Y - PAD_Y) * (v / max);
    return [x, y];
  });
  const linePath = coords
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`))
    .join(' ');
  // Close the path back down to the baseline so the fill is a proper
  // area chart, not just a thick line.
  const areaPath = `${linePath} L${W.toFixed(1)},${BASELINE_Y.toFixed(1)} L0,${BASELINE_Y.toFixed(1)} Z`;

  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="none" aria-hidden="true">
      <path d={areaPath} fill={color} fillOpacity={0.16} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// ─── Sidebar (Home-only — desktop layout) ───────────────────────────
const NAV_ITEMS = [
  { id: 'home',          label: 'Home',          icon: HomeIcon },
  { id: 'pipeline',      label: 'Pipeline',      icon: GitBranch },
  { id: 'leads',         label: 'My Leads',      icon: ClipboardList },
  { id: 'commissions',   label: 'Commissions',   icon: DollarSign },
  { id: 'estimates',     label: 'Estimates',     icon: FileText },
  { id: 'calendar',      label: 'Calendar',      icon: CalendarIcon },
  { id: 'previous-jobs', label: 'Previous Jobs', icon: ClipboardList },
];

// ─── Mobile bottom navigation bar ──────────────────────────────────
// Shown only on sm and below (hidden sm:hidden). 5 items: Home,
// Pipeline, + New Job (centre FAB), Calendar, Leads.
function MobileBottomBar({ activeId, onNavigate, notifCount }) {
  const items = [
    { id: 'home',     icon: HomeIcon,     label: 'Home' },
    { id: 'pipeline', icon: GitBranch,    label: 'Pipeline' },
    { id: 'new-job',  icon: PlusCircle,   label: 'New Job',  fab: true },
    { id: 'calendar', icon: CalendarIcon, label: 'Calendar' },
    { id: 'leads',    icon: ClipboardList,label: 'Leads' },
  ];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex sm:hidden safe-bottom">
      {items.map(({ id, icon: Icon, label, fab }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 ${
            fab
              ? 'relative'
              : activeId === id
                ? 'text-omega-orange'
                : 'text-omega-stone'
          }`}
        >
          {fab ? (
            <span className="w-12 h-12 rounded-full bg-omega-orange flex items-center justify-center shadow-lg -mt-5">
              <Icon className="w-6 h-6 text-white" />
            </span>
          ) : (
            <Icon className="w-5 h-5" />
          )}
          <span className={`text-[10px] font-semibold ${fab ? 'text-omega-orange mt-0.5' : ''}`}>{label}</span>
        </button>
      ))}
    </nav>
  );
}

// SalesSidebar was moved to ../components/SalesSidebar.jsx so the
// persistent shell in App.jsx can render it on every route. Don't
// re-define it here.

// ─── KPI card ────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconBg, iconColor, label, value, deltaPct, sparkColor, series }) {
  const positive = deltaPct >= 0;
  const Arrow = positive ? TrendingUp : TrendingDown;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-2 sm:p-5">
      {/* Mobile: stacked icon + number (very compact) */}
      <div className="flex flex-col items-center text-center sm:hidden gap-1 py-1">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
        </div>
        <p className="text-base font-black text-omega-charcoal tabular-nums leading-none">{value}</p>
        <p className="text-[9px] text-omega-stone font-semibold leading-tight line-clamp-2">{label}</p>
        {Number.isFinite(deltaPct) && (
          <p className={`text-[9px] font-bold inline-flex items-center gap-0.5 ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
            <Arrow className="w-2.5 h-2.5" />{Math.abs(Math.round(deltaPct))}%
          </p>
        )}
      </div>
      {/* Desktop: original layout */}
      <div className="hidden sm:flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-omega-stone font-semibold leading-tight">{label}</p>
          <p className="text-2xl font-black text-omega-charcoal tabular-nums leading-tight mt-0.5">{value}</p>
          {Number.isFinite(deltaPct) && (
            <p className={`text-[11px] font-semibold inline-flex items-center gap-0.5 mt-1 ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
              <Arrow className="w-3 h-3" />{Math.abs(Math.round(deltaPct))}%
              <span className="text-omega-stone font-medium"> vs last month</span>
            </p>
          )}
        </div>
        <Sparkline color={sparkColor} points={series} />
      </div>
    </div>
  );
}

// ─── Pipeline overview row ──────────────────────────────────────────
function PipelineRow({ phase, count, total }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider whitespace-nowrap ${phase.tint}`}>
        {phase.label}
      </span>
      <div className="flex-1" />
      <span className="text-sm font-bold text-omega-charcoal tabular-nums w-8 text-right">{count}</span>
      <span className="text-sm font-bold text-omega-charcoal tabular-nums w-20 text-right">
        {total > 0 ? fmtMoneyShort(total) : '—'}
      </span>
    </div>
  );
}

// ─── Activity icon by event kind ────────────────────────────────────
function activityIconFor(kind) {
  switch (kind) {
    case 'sales_visit': return MapPin;
    case 'job_start':   return Sparkles;
    case 'service_day': return CalendarCheck;
    case 'inspection':  return Sparkles;
    case 'meeting':     return Phone;
    default:            return CalendarIcon;
  }
}

// ────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────
export default function Home({ user, onNavigate, onLogout, onOpenJob }) {
  const [notifCount, setNotifCount] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [jobCosts, setJobCosts] = useState([]);
  const [events, setEvents] = useState([]);
  // KPI counters returned by /api/sales/sent-stats — the source of
  // truth for Estimates Sent / Won (contract sent or signed). We use
  // the server-side endpoint because audit_log doesn't have a
  // permissive anon read policy, so a direct supabase.from('audit_log')
  // from the browser returned silent empties for weeks.
  const [auditStats, setAuditStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // ─── Load dashboard data ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Attila is the only salesperson at Omega today, and the
      // historic rows have salesperson_name = NULL — filtering by
      // name would silently zero out every KPI. Match the same
      // policy the Pipeline already uses (filterBySalesperson=false
      // for the Sales role) and load every job. When a second
      // salesperson is hired we'll narrow this back.
      const fullName  = (user?.name || '').trim();
      const firstName = fullName.split(/\s+/)[0] || fullName;
      const namePrefix = firstName ? `${firstName}%` : '';

      try {
        // Stats query goes server-side because audit_log is RLS-locked
        // for anon reads. Fired in parallel with the rest.
        const statsPromise = fetch('/api/sales/sent-stats')
          .then((r) => r.ok ? r.json() : null)
          .catch(() => null);

        const [jobsResp, estResp, costsResp, evResp, notifResp] = await Promise.all([
          // ALL jobs (sales = single-seller).
          supabase.from('jobs').select('*'),
          // Estimates — load all, narrow client-side later.
          // Note: 'sent_at' is intentionally NOT in this select. The
          // column was never created by any migration even though
          // EstimateFlow.jsx tries to write to it — the update fails
          // silently. Selecting a non-existent column makes the WHOLE
          // query 400 in PostgREST. The Estimates Sent KPI now comes
          // from audit_log instead (see sendResp below), so we don't
          // need that field here.
          supabase.from('estimates').select('id, job_id, status, total_amount, signed_at, created_at, updated_at'),
          // Job costing rows — fallback for pipeline totals when no
          // formal estimate exists yet. Tolerates missing table.
          supabase.from('job_costs').select('job_id, estimated_revenue'),
          // Upcoming events: still filtered by assignee since the
          // EventForm reliably writes assigned_to_name. Falls back
          // to all upcoming events when we have no first name.
          namePrefix
            ? supabase.from('calendar_events')
                .select('*')
                .ilike('assigned_to_name', namePrefix)
                .gte('starts_at', new Date().toISOString())
                .order('starts_at', { ascending: true })
                .limit(8)
            : supabase.from('calendar_events')
                .select('*')
                .gte('starts_at', new Date().toISOString())
                .order('starts_at', { ascending: true })
                .limit(8),
          supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('seen', false),
        ]);
        const statsResp = await statsPromise;
        if (cancelled) return;
        // Surface query failures so silent 400s don't disappear into
        // a generic catch like they did all the way back to yesterday's
        // sent_at saga.
        if (jobsResp.error)  console.warn('[Sales Home] jobs query failed:',  jobsResp.error);
        if (estResp.error)   console.warn('[Sales Home] estimates query failed:', estResp.error);
        if (costsResp.error) console.warn('[Sales Home] job_costs query failed:', costsResp.error);
        if (evResp.error)    console.warn('[Sales Home] calendar_events query failed:', evResp.error);
        if (notifResp.error) console.warn('[Sales Home] notifications query failed:', notifResp.error);
        if (!statsResp?.ok)  console.warn('[Sales Home] sent-stats endpoint failed:', statsResp);

        setJobs(jobsResp.data || []);
        setEstimates(estResp.data || []);
        setJobCosts(costsResp.data || []);
        setEvents(evResp.data || []);
        setNotifCount(notifResp.count || 0);
        setAuditStats(statsResp?.ok ? statsResp : null);
      } catch (err) {
        console.warn('[Sales Home] dashboard load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.name]);

  // ─── Derived KPIs ────────────────────────────────────────────────
  // Rewritten 2026-06-02 — full reset. Three earlier attempts failed
  // because `estimates.sent_at` was being used despite the column
  // never having been created in any migration. The single source of
  // truth for "an action happened" is `audit_log` (logAudit writes a
  // row on every meaningful click).
  //
  // KPIs in this dashboard:
  //   • Leads (This Month)      — jobs created in the current month
  //   • Estimates Sent          — audit_log rows action='estimate.send'
  //   • Won (This Month)        — audit_log rows action='contract.send'
  //                                OR jobs whose pipeline_status is in
  //                                the "winning" set (contract_signed,
  //                                in_progress, completed) and moved
  //                                this month.
  //   • Sales (This Month)      — sum of total_amount on estimates the
  //                                client signed this month.
  //
  // We never look at status fields alone — those flip as the client
  // moves through the funnel and would silently undercount.
  const kpis = useMemo(() => {
    const startThis = startOfMonthISO();
    const startLast = startOfPreviousMonthISO();

    // Month membership for any ISO-8601-ish timestamp string.
    // 'this' = >= startThis, no upper bound (open-ended).
    // 'last' = [startLast, startThis).
    function inMonth(iso, month) {
      if (!iso) return false;
      const startCutoff = month === 'this' ? startThis : startLast;
      const endCutoff   = month === 'this' ? null     : startThis;
      if (iso < startCutoff) return false;
      if (endCutoff && iso >= endCutoff) return false;
      return true;
    }
    function delta(thisCount, lastCount) {
      if (lastCount === 0) return thisCount > 0 ? 100 : 0;
      return ((thisCount - lastCount) / lastCount) * 100;
    }

    // ─── KPI 1: Leads ─────────────────────────────────────────────
    const leadsThis = jobs.filter((j) => inMonth(j.created_at, 'this')).length;
    const leadsLast = jobs.filter((j) => inMonth(j.created_at, 'last')).length;

    // ─── KPI 2: Estimates Sent — server-side from audit_log ─────
    const estSentThis = auditStats?.estimate_sent?.this_month ?? 0;
    const estSentLast = auditStats?.estimate_sent?.last_month ?? 0;

    // ─── KPI 3: Won — server-side audit OR pipeline status ──────
    // The endpoint counts contract.send + contract.sign rows. We also
    // check the jobs table for any row whose pipeline_status sits in
    // the winning set and moved this month, then take the max. Belt
    // and braces.
    const wonStatuses = new Set(['contract_signed', 'in_progress', 'completed']);
    const wonByJobs = (m) => jobs.filter((j) =>
      wonStatuses.has(j.pipeline_status) && inMonth(j.updated_at || j.created_at, m),
    ).length;
    const wonByAuditThis = (auditStats?.contract_sent?.this_month ?? 0) + (auditStats?.contract_sign?.this_month ?? 0);
    const wonByAuditLast = (auditStats?.contract_sent?.last_month ?? 0) + (auditStats?.contract_sign?.last_month ?? 0);
    const wonThis = Math.max(wonByJobs('this'), wonByAuditThis);
    const wonLast = Math.max(wonByJobs('last'), wonByAuditLast);

    // ─── KPI 4: Sales (this month) ────────────────────────────────
    // signed_at IS a real column (migration 018). Filter estimates by
    // it and sum total_amount. This needs the estimates rows, so it
    // only works once jobs loaded — no `myJobIds` narrowing because
    // Attila is the only salesperson today.
    const salesThis = estimates
      .filter((e) => e.signed_at && inMonth(e.signed_at, 'this'))
      .reduce((acc, e) => acc + (Number(e.total_amount) || 0), 0);
    const salesLast = estimates
      .filter((e) => e.signed_at && inMonth(e.signed_at, 'last'))
      .reduce((acc, e) => acc + (Number(e.total_amount) || 0), 0);

    // ─── Sparkline series (oldest → newest, 6 months) ───────────────
    // Audit-driven series come straight from the server endpoint.
    // Leads + Sales series are computed locally from jobs/estimates by
    // walking the same six month windows the endpoint uses.
    const HISTORY = 6;
    const monthNow = new Date();
    const monthWindows = []; // [{start, end}]  end=null on the newest one
    for (let i = HISTORY - 1; i >= 0; i--) {
      const start = new Date(monthNow.getFullYear(), monthNow.getMonth() - i, 1).toISOString();
      const end   = i === 0
        ? null
        : new Date(monthNow.getFullYear(), monthNow.getMonth() - i + 1, 1).toISOString();
      monthWindows.push({ start, end });
    }
    function rowsInWindow(iso, { start, end }) {
      if (!iso) return false;
      if (iso < start) return false;
      if (end && iso >= end) return false;
      return true;
    }
    const leadsSeries = monthWindows.map(
      (w) => jobs.filter((j) => rowsInWindow(j.created_at, w)).length,
    );
    const salesSeries = monthWindows.map((w) =>
      estimates
        .filter((e) => rowsInWindow(e.signed_at, w))
        .reduce((acc, e) => acc + (Number(e.total_amount) || 0), 0),
    );
    const estSentSeries = auditStats?.estimate_sent?.history || [];
    const wonSeries = (() => {
      // Sum contract.send + contract.sign per month, then max against
      // a job-pipeline derived count for the same window so we keep the
      // belt-and-braces behavior of the current month value.
      const auditWon = (auditStats?.contract_sent?.history || []).map(
        (v, i) => (v || 0) + ((auditStats?.contract_sign?.history || [])[i] || 0),
      );
      const jobsWon = monthWindows.map((w) => jobs.filter((j) =>
        wonStatuses.has(j.pipeline_status) && rowsInWindow(j.updated_at || j.created_at, w),
      ).length);
      return monthWindows.map((_, i) => Math.max(auditWon[i] || 0, jobsWon[i] || 0));
    })();

    return {
      leads:       { value: leadsThis,    delta: delta(leadsThis, leadsLast),     series: leadsSeries  },
      estimates:   { value: estSentThis,  delta: delta(estSentThis, estSentLast), series: estSentSeries },
      won:         { value: wonThis,      delta: delta(wonThis, wonLast),         series: wonSeries     },
      sales:       { value: salesThis,    delta: delta(salesThis, salesLast),     series: salesSeries   },
    };
  }, [jobs, estimates, auditStats]);

  // ─── Pipeline overview rows ──────────────────────────────────────
  const pipelineRows = useMemo(() => {
    // Mirror the Kanban desktop logic exactly so both views show the
    // same numbers. Three tiers, same priority order:
    //
    //  1. Sum of approved/signed estimates — client agreed on this.
    //  2. job_costs.estimated_revenue      — manually entered revenue.
    //  3. Latest estimate (any status)     — fallback for early leads
    //     that have a draft/sent estimate but nothing approved yet.
    //
    // Scope: only ACTIVE pipeline jobs (in_pipeline !== false).
    // Historic imports and archived jobs with in_pipeline = false are
    // excluded so they don't silently distort the totals.

    const APPROVED = new Set(['approved', 'signed']);

    // Tier 1: sum of approved/signed per job
    const approvedByJob = {};
    for (const e of estimates) {
      if (!APPROVED.has(e.status)) continue;
      approvedByJob[e.job_id] = (approvedByJob[e.job_id] || 0) + (Number(e.total_amount) || 0);
    }

    // Tier 2: job_costs.estimated_revenue (one row per job)
    const costByJob = {};
    for (const c of jobCosts) costByJob[c.job_id] = c;

    // Tier 3: latest estimate any-status per job
    const latestEstByJob = {};
    for (const e of estimates) {
      const prev = latestEstByJob[e.job_id];
      if (!prev || (e.created_at || '') > (prev.created_at || '')) {
        latestEstByJob[e.job_id] = e;
      }
    }

    // Only active pipeline jobs
    const activeJobs = jobs.filter((j) => j.in_pipeline !== false);

    const rows = OVERVIEW_PHASES.map((phase) => {
      const matches = phase.matches
        ? activeJobs.filter(phase.matches)
        : activeJobs.filter((j) => j.pipeline_status === phase.key);
      const total = matches.reduce((acc, j) => {
        const amount =
          approvedByJob[j.id] ||
          Number(costByJob[j.id]?.estimated_revenue) ||
          Number(latestEstByJob[j.id]?.total_amount) ||
          0;
        return acc + amount;
      }, 0);
      return { phase, count: matches.length, total };
    });
    const totalValue = rows.reduce((acc, r) => acc + r.total, 0);
    return { rows, totalValue };
  }, [jobs, estimates, jobCosts]);

  // ─── Recent leads (latest 4) ─────────────────────────────────────
  const recentLeads = useMemo(() => {
    return jobs
      .filter((j) => j.pipeline_status === 'new_lead')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 4);
  }, [jobs]);

  // ─── Group upcoming events by Today / Tomorrow / Later ──────────
  const groupedEvents = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const groups = { today: [], tomorrow: [], later: [] };
    for (const e of events) {
      if (isSameDayCT(e.starts_at, today)) groups.today.push(e);
      else if (isSameDayCT(e.starts_at, tomorrow)) groups.tomorrow.push(e);
      else groups.later.push(e);
    }
    return groups;
  }, [events]);

  // Sidebar is now owned by the SalesShell in App.jsx — every route
  // renders inside it, so the Home screen only needs to emit its
  // content. The wrapping flex + min-h-screen also moved up to the
  // shell.
  return (
    <>
      <main className="flex-1 min-w-0 pb-16 sm:pb-0">
        {/* ── Mobile-only top bar ──────────────────────────────── */}
        <header className="sm:hidden sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-omega-stone font-semibold">{getGreeting()},</p>
            <p className="text-base font-black text-omega-charcoal truncate leading-tight">
              {user?.name || 'there'} 👋
            </p>
          </div>
          {/* Realtime notifications bell — shared component with role-
              scoped popover. Clicking a notification jumps to the linked
              job at the right tab. Each instance uses its own Realtime
              channel (see useRef in NotificationsBell) so the mobile
              and desktop bells can coexist without colliding. */}
          <NotificationsBell user={user} onOpenJob={onOpenJob} />
        </header>

        {/* ── Desktop top bar ──────────────────────────────────── */}
        <header className="hidden sm:flex bg-omega-cloud px-6 sm:px-10 pt-8 pb-4 items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-omega-charcoal inline-flex items-center gap-2">
              {getGreeting()}, {user?.name || 'there'} <span className="inline-block">👋</span>
            </h1>
            <p className="text-sm text-omega-stone mt-1">
              Here's what's happening with your business today.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationsBell user={user} onOpenJob={onOpenJob} />
            <button
              onClick={onLogout}
              className="p-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange transition-colors"
              title="Sign out"
            >
              <LogOut className="w-5 h-5 text-omega-charcoal" />
            </button>
          </div>
        </header>

        <div className="px-4 sm:px-10 pb-10 space-y-4 sm:space-y-6 pt-4 sm:pt-0">
          {/* KPIs — 4 cols always (compact on mobile, full on desktop) */}
          <section className="grid grid-cols-4 gap-2 sm:gap-4">
            <KpiCard
              icon={TrendingUp}
              iconBg="bg-orange-100" iconColor="text-omega-orange" sparkColor="#E8732A"
              label="Leads (This Month)"
              value={loading ? '—' : kpis.leads.value}
              deltaPct={loading ? null : kpis.leads.delta}
              series={loading ? null : kpis.leads.series}
            />
            <KpiCard
              icon={FileText}
              iconBg="bg-violet-100" iconColor="text-violet-600" sparkColor="#8B5CF6"
              label="Estimates Sent"
              value={loading ? '—' : kpis.estimates.value}
              deltaPct={loading ? null : kpis.estimates.delta}
              series={loading ? null : kpis.estimates.series}
            />
            <KpiCard
              icon={CalendarCheck}
              iconBg="bg-emerald-100" iconColor="text-emerald-600" sparkColor="#10B981"
              label="Won"
              value={loading ? '—' : kpis.won.value}
              deltaPct={loading ? null : kpis.won.delta}
              series={loading ? null : kpis.won.series}
            />
            <KpiCard
              icon={TrendingUp}
              iconBg="bg-amber-100" iconColor="text-amber-600" sparkColor="#F59E0B"
              label="Sales (This Month)"
              value={loading ? '—' : fmtMoneyShort(kpis.sales.value)}
              deltaPct={loading ? null : kpis.sales.delta}
              series={loading ? null : kpis.sales.series}
            />
          </section>

          {/* Big New Job CTA — desktop only; mobile uses the FAB in MobileBottomBar */}
          <button
            onClick={() => onNavigate('new-job')}
            className="hidden sm:flex w-full bg-omega-orange hover:bg-omega-dark text-white rounded-2xl p-4 sm:p-5 items-center gap-3 sm:gap-4 shadow-lg shadow-omega-orange/25 transition-colors"
          >
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <PlusCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm sm:text-base font-bold">New Job</p>
              <p className="text-xs sm:text-sm text-white/85">Start a new client consultation</p>
            </div>
            <ArrowRight className="w-5 h-5" />
          </button>

          {/* Three columns: pipeline overview · upcoming · recent leads */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* Pipeline overview */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-omega-orange" /> Pipeline Overview
                </h2>
                <button
                  onClick={() => onNavigate('pipeline')}
                  className="text-xs font-semibold text-omega-orange hover:text-omega-dark"
                >
                  View full pipeline
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {pipelineRows.rows.map((r) => (
                  <PipelineRow key={r.phase.key} {...r} />
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-omega-stone uppercase tracking-wider">
                  Total Pipeline Value
                </span>
                <span className="text-lg font-black text-omega-charcoal tabular-nums">
                  {fmtMoney(pipelineRows.totalValue)}
                </span>
              </div>
            </div>

            {/* Upcoming activities */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-omega-orange" /> Upcoming Activities
                </h2>
                <button
                  onClick={() => onNavigate('calendar')}
                  className="text-xs font-semibold text-omega-orange hover:text-omega-dark"
                >
                  View calendar
                </button>
              </div>
              {events.length === 0 ? (
                <p className="text-xs text-omega-stone py-6 text-center">No upcoming activities scheduled.</p>
              ) : (
                <div className="space-y-4">
                  {(['today', 'tomorrow', 'later']).map((bucket) => {
                    const list = groupedEvents[bucket];
                    if (list.length === 0) return null;
                    const label = bucket === 'today' ? 'Today' : bucket === 'tomorrow' ? 'Tomorrow' : 'Later';
                    return (
                      <div key={bucket}>
                        <p className="text-[10px] font-bold text-omega-stone uppercase tracking-widest mb-2">
                          {label}
                        </p>
                        <div className="space-y-2">
                          {list.slice(0, 3).map((ev) => {
                            const Icon = activityIconFor(ev.kind);
                            return (
                              <div key={ev.id} className="flex items-start gap-3">
                                <span className="text-[11px] font-bold text-omega-stone tabular-nums w-12 mt-1 flex-shrink-0">
                                  {fmtTime(ev.starts_at)}
                                </span>
                                <div className="flex-1 min-w-0 bg-omega-cloud rounded-xl px-3 py-2.5">
                                  <p className="text-sm font-semibold text-omega-charcoal truncate">{ev.title}</p>
                                  {ev.notes && (
                                    <p className="text-[11px] text-omega-stone truncate">{ev.notes}</p>
                                  )}
                                </div>
                                <div className="w-9 h-9 rounded-xl bg-omega-pale text-omega-orange flex items-center justify-center flex-shrink-0">
                                  <Icon className="w-4 h-4" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent leads */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-omega-orange" /> Recent Leads
                </h2>
                <button
                  onClick={() => onNavigate('pipeline')}
                  className="text-xs font-semibold text-omega-orange hover:text-omega-dark"
                >
                  View all leads
                </button>
              </div>
              {recentLeads.length === 0 ? (
                <p className="text-xs text-omega-stone py-6 text-center">No new leads yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentLeads.map((j) => (
                    <li key={j.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-omega-charcoal truncate">{j.client_name || 'Untitled'}</p>
                        <p className="text-[11px] text-omega-stone truncate">
                          {[j.city, j.address?.split(',').slice(-2, -1)?.[0]?.trim()].filter(Boolean).join(', ') || j.address || '—'}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          NEW
                        </span>
                        <p className="text-[11px] text-omega-stone mt-0.5">{relTime(j.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Pro Tip footer */}
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3 flex-wrap">
            <div className="w-9 h-9 rounded-xl bg-white text-blue-600 flex items-center justify-center flex-shrink-0">
              <Lightbulb className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-blue-900">Pro Tip</p>
              <p className="text-xs text-blue-800">
                Complete the questionnaire thoroughly — a detailed report leads to a higher close rate.
              </p>
            </div>
            <button
              onClick={() => onNavigate('new-job')}
              className="px-3 py-2 rounded-xl bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 text-xs font-bold"
            >
              Go to Questionnaire
            </button>
          </div>
        </div>
      </main>

      {/* Mobile bottom navigation — hidden on sm+ (sidebar takes over) */}
      <MobileBottomBar activeId="home" onNavigate={onNavigate} notifCount={notifCount} />
    </>
  );
}
