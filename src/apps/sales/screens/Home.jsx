import { useEffect, useMemo, useState } from 'react';
import {
  PlusCircle, Bell, LogOut, GitBranch, Calendar as CalendarIcon, FileText,
  ClipboardList, ArrowRight, TrendingUp, TrendingDown, MapPin, Phone,
  CalendarCheck, Lightbulb, Home as HomeIcon, Sparkles, DollarSign,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';
import DailyLogsCascade from '../../../shared/components/DailyLogsCascade';
import UserProfileModal from '../../../shared/components/UserProfileModal';

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
  { key: 'estimate_negotiating', label: 'Estimate Negotiating', tint: 'bg-amber-100 text-amber-700' },
  { key: 'contract_sent',        label: 'Contract Sent',        tint: 'bg-blue-100 text-blue-700' },
  { key: 'won',                  label: 'Won',                  tint: 'bg-emerald-100 text-emerald-800',
    matches: (j) => ['contract_signed', 'in_progress', 'completed'].includes(j.pipeline_status) },
];

// ─── Tiny inline sparkline (visual flourish, not real data) ─────────
// 4 KPI cards each get a soft trend curve. Generating from a hash of
// the metric value keeps each card stable across renders without
// pulling historical data.
function Sparkline({ color = '#E8732A' }) {
  return (
    <svg viewBox="0 0 80 28" width="80" height="28" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0,22 C12,15 22,20 32,12 C42,4 52,16 62,9 C70,4 76,8 80,6"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function SalesSidebar({ activeId, onNavigate, user, onLogout, onOpenJob }) {
  const [profileOpen, setProfileOpen] = useState(false);
  // Pulls the profile photo (and refresh fn for after Edit Profile)
  // from the same shared hook every other role's sidebar uses, so
  // Attila's Salesman tile shows his real photo instead of an
  // initial-on-orange square.
  const { photoUrl, refresh } = useUserProfile(user);
  const userName = user?.name || '';

  return (
    <aside className="w-56 flex-shrink-0 bg-omega-charcoal flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <Logo size="sm" dark />
      </div>

      <button
        onClick={() => setProfileOpen(true)}
        className="px-5 py-4 border-b border-white/10 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer w-full"
        title="Open my profile"
      >
        <Avatar
          name={userName}
          photoUrl={photoUrl || undefined}
          size="sm"
          color={colorFromName(userName)}
        />
        <div className="min-w-0">
          <p className="text-[10px] text-omega-stone uppercase tracking-widest font-semibold">Salesman</p>
          <p className="text-sm font-semibold text-white truncate">{userName || '—'}</p>
        </div>
      </button>

      <UserProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        user={user}
        onUserUpdated={refresh}
      />

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeId === id
                ? 'bg-omega-orange text-white'
                : 'text-omega-fog hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <DailyLogsCascade user={user} onOpenJob={onOpenJob} />

      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-omega-fog hover:bg-white/10 hover:text-white transition-all"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconBg, iconColor, label, value, deltaPct, sparkColor }) {
  const positive = deltaPct >= 0;
  const Arrow = positive ? TrendingUp : TrendingDown;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-omega-stone font-semibold">{label}</p>
          <p className="text-2xl font-black text-omega-charcoal tabular-nums leading-tight mt-0.5">
            {value}
          </p>
          {Number.isFinite(deltaPct) && (
            <p className={`text-[11px] font-semibold inline-flex items-center gap-0.5 mt-1 ${
              positive ? 'text-emerald-600' : 'text-red-600'
            }`}>
              <Arrow className="w-3 h-3" />
              {Math.abs(Math.round(deltaPct))}% <span className="text-omega-stone font-medium">vs last month</span>
            </p>
          )}
        </div>
        <Sparkline color={sparkColor} />
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
  const [events, setEvents] = useState([]);
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
        const [jobsResp, estResp, evResp, notifResp] = await Promise.all([
          // ALL jobs (sales = single-seller).
          supabase.from('jobs').select('*'),
          // Estimates — load all, narrow client-side later.
          supabase.from('estimates').select('id, job_id, status, total_amount, signed_at, created_at, updated_at'),
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
        if (cancelled) return;
        setJobs(jobsResp.data || []);
        setEstimates(estResp.data || []);
        setEvents(evResp.data || []);
        setNotifCount(notifResp.count || 0);
      } catch {
        // Soft-fail — empty state is fine. The cards just show 0.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.name]);

  // ─── Derived KPIs ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const startThis = startOfMonthISO();
    const startLast = startOfPreviousMonthISO();
    const myJobIds = new Set(jobs.map((j) => j.id));
    const myEsts = estimates.filter((e) => myJobIds.has(e.job_id));

    function inMonth(iso, month) {
      const startCutoff = month === 'this' ? startThis : startLast;
      const endCutoff   = month === 'this' ? null     : startThis;
      if (!iso) return false;
      if (iso < startCutoff) return false;
      if (endCutoff && iso >= endCutoff) return false;
      return true;
    }
    function delta(thisCount, lastCount) {
      if (lastCount === 0) return thisCount > 0 ? 100 : 0;
      return ((thisCount - lastCount) / lastCount) * 100;
    }

    const leadsThis = jobs.filter((j) => inMonth(j.created_at, 'this')).length;
    const leadsLast = jobs.filter((j) => inMonth(j.created_at, 'last')).length;

    const estSentThis = myEsts.filter((e) => e.status === 'sent' && inMonth(e.updated_at || e.created_at, 'this')).length;
    const estSentLast = myEsts.filter((e) => e.status === 'sent' && inMonth(e.updated_at || e.created_at, 'last')).length;

    const wonStatuses = new Set(['contract_signed', 'in_progress', 'completed']);
    const wonThis = jobs.filter((j) => wonStatuses.has(j.pipeline_status) && inMonth(j.updated_at || j.created_at, 'this')).length;
    const wonLast = jobs.filter((j) => wonStatuses.has(j.pipeline_status) && inMonth(j.updated_at || j.created_at, 'last')).length;

    const salesThis = myEsts
      .filter((e) => e.signed_at && inMonth(e.signed_at, 'this'))
      .reduce((acc, e) => acc + (Number(e.total_amount) || 0), 0);
    const salesLast = myEsts
      .filter((e) => e.signed_at && inMonth(e.signed_at, 'last'))
      .reduce((acc, e) => acc + (Number(e.total_amount) || 0), 0);

    return {
      leads:       { value: leadsThis,    delta: delta(leadsThis, leadsLast) },
      estimates:   { value: estSentThis,  delta: delta(estSentThis, estSentLast) },
      won:         { value: wonThis,      delta: delta(wonThis, wonLast) },
      sales:       { value: salesThis,    delta: delta(salesThis, salesLast) },
    };
  }, [jobs, estimates]);

  // ─── Pipeline overview rows ──────────────────────────────────────
  const pipelineRows = useMemo(() => {
    const myJobIds = new Set(jobs.map((j) => j.id));
    // Latest estimate per job, used to sum dollar value per phase.
    const estByJob = new Map();
    for (const e of estimates) {
      if (!myJobIds.has(e.job_id)) continue;
      const prev = estByJob.get(e.job_id);
      if (!prev || (e.created_at || '') > (prev.created_at || '')) {
        estByJob.set(e.job_id, e);
      }
    }

    const rows = OVERVIEW_PHASES.map((phase) => {
      const matches = phase.matches
        ? jobs.filter(phase.matches)
        : jobs.filter((j) => j.pipeline_status === phase.key);
      const total = matches.reduce((acc, j) => {
        const est = estByJob.get(j.id);
        return acc + (Number(est?.total_amount) || 0);
      }, 0);
      return { phase, count: matches.length, total };
    });
    const totalValue = rows.reduce((acc, r) => acc + r.total, 0);
    return { rows, totalValue };
  }, [jobs, estimates]);

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

  return (
    <div className="flex min-h-screen bg-omega-cloud">
      <SalesSidebar activeId="home" onNavigate={onNavigate} user={user} onLogout={onLogout} onOpenJob={onOpenJob} />

      <main className="flex-1 min-w-0">
        {/* Top bar: greeting + notifications + sign out */}
        <header className="bg-omega-cloud px-6 sm:px-10 pt-8 pb-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-omega-charcoal inline-flex items-center gap-2">
              {getGreeting()}, {user?.name || 'there'} <span className="inline-block">👋</span>
            </h1>
            <p className="text-sm text-omega-stone mt-1">
              Here's what's happening with your business today.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate('notifications')}
              className="relative p-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange transition-colors"
              title="Notifications"
            >
              <Bell className="w-5 h-5 text-omega-charcoal" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-omega-orange text-white">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange transition-colors"
              title="Sign out"
            >
              <LogOut className="w-5 h-5 text-omega-charcoal" />
            </button>
          </div>
        </header>

        <div className="px-6 sm:px-10 pb-10 space-y-6">
          {/* KPIs */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={TrendingUp}
              iconBg="bg-orange-100" iconColor="text-omega-orange" sparkColor="#E8732A"
              label="Leads (This Month)"
              value={loading ? '—' : kpis.leads.value}
              deltaPct={loading ? null : kpis.leads.delta}
            />
            <KpiCard
              icon={FileText}
              iconBg="bg-violet-100" iconColor="text-violet-600" sparkColor="#8B5CF6"
              label="Estimates Sent"
              value={loading ? '—' : kpis.estimates.value}
              deltaPct={loading ? null : kpis.estimates.delta}
            />
            <KpiCard
              icon={CalendarCheck}
              iconBg="bg-emerald-100" iconColor="text-emerald-600" sparkColor="#10B981"
              label="Won"
              value={loading ? '—' : kpis.won.value}
              deltaPct={loading ? null : kpis.won.delta}
            />
            <KpiCard
              icon={TrendingUp}
              iconBg="bg-amber-100" iconColor="text-amber-600" sparkColor="#F59E0B"
              label="Sales (This Month)"
              value={loading ? '—' : fmtMoneyShort(kpis.sales.value)}
              deltaPct={loading ? null : kpis.sales.delta}
            />
          </section>

          {/* Big New Job CTA */}
          <button
            onClick={() => onNavigate('new-job')}
            className="w-full bg-omega-orange hover:bg-omega-dark text-white rounded-2xl p-5 flex items-center gap-4 shadow-lg shadow-omega-orange/25 transition-colors"
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <PlusCircle className="w-6 h-6" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-base font-bold">New Job</p>
              <p className="text-sm text-white/85">Start a new client consultation</p>
            </div>
            <ArrowRight className="w-5 h-5" />
          </button>

          {/* Three columns: pipeline overview · upcoming · recent leads */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
    </div>
  );
}
