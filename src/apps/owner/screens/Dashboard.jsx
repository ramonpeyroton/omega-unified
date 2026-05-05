import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, Calendar, TrendingUp, TrendingDown, ArrowRight, Briefcase,
  DollarSign, Banknote, Target, GitBranch, Percent, Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';

// Owner Dashboard — Phase 1 of Ramon's redesign:
//   • 6 KPI cards (MTD vs last month delta).
//   • Active Jobs table with Financial Status.
//   • Sales Pipeline funnel + side stats.
//
// Phase 2 brings: Financial Overview chart + Marketing donut +
//                 Salesman Performance + Cash & Payments block.
// Phase 3 brings: Alerts & Notifications + Top Bottlenecks +
//                 Action Center.
//
// All "MTD" values respect the current calendar month in CT (the
// office runs on America/New_York). The vs-last-month delta uses
// the same calendar slice from the previous month so the comparison
// stays apples-to-apples even on the first day of a new month.

const ACTIVE_PHASES = new Set([
  'new_lead',
  'estimate_draft',
  'estimate_sent',
  'estimate_negotiating',
  'estimate_approved',
  'contract_sent',
  'contract_signed',
  'in_progress',
]);

const SIGNED_PHASES = new Set(['contract_signed', 'in_progress', 'completed']);
const WON_PHASES    = new Set(['contract_signed', 'in_progress', 'completed']);
const LOST_PHASES   = new Set(['estimate_rejected']);

// MTD bounds — compares current month-to-date vs the SAME slice of
// the previous month (day-1 through today's day-of-month). On May 5
// the current range is May 1-5 and the comparison is Apr 1-5.
// Avoids the "5-day partial month vs full 30-day prior month" trap.
function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  // End is the start of TOMORROW (so today is fully included).
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

  const lastStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  // If the current day-of-month doesn't exist in the previous month
  // (e.g. today is March 31 → February only has 28/29), cap at the
  // last day of that month.
  const lastMonthDayCount = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
  const lastDay = Math.min(d.getDate(), lastMonthDayCount);
  const lastEnd = new Date(d.getFullYear(), d.getMonth() - 1, lastDay + 1);

  return { start, end, lastStart, lastEnd };
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Math.round(n)}%`;
}

function fmtDelta(curr, prev, suffix = '%') {
  if (prev == null || prev === 0) {
    if (curr > 0) return { text: 'New', positive: true, raw: 0 };
    return { text: '0%', positive: true, raw: 0 };
  }
  const diff = ((curr - prev) / Math.abs(prev)) * 100;
  return {
    text: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}${suffix}`,
    positive: diff >= 0,
    raw: diff,
  };
}

function fmtDeltaPp(curr, prev) {
  // Percentage-point delta — used for rates that already are %.
  if (prev == null) return { text: 'New', positive: true, raw: 0 };
  const diff = curr - prev;
  return {
    text: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pp`,
    positive: diff >= 0,
    raw: diff,
  };
}

function rangeLabel(start, end) {
  // end is exclusive; subtract 1ms to get the inclusive last day.
  const lastDay = new Date(end.getTime() - 1);
  const monthName = start.toLocaleDateString('en-US', { month: 'short' });
  const year = start.getFullYear();
  if (start.getDate() === lastDay.getDate()) {
    return `${monthName} ${start.getDate()}, ${year}`;
  }
  return `${monthName} ${start.getDate()} – ${lastDay.getDate()}, ${year}`;
}

function lastMonthLabel(lastStart) {
  return lastStart.toLocaleDateString('en-US', { month: 'short' });
}

// Margin % thresholds — Profitable / At Risk / Loss bucketing.
function marginBucket(marginPct) {
  if (marginPct == null) return { label: 'No data', cls: 'bg-gray-100 text-gray-700 border-gray-200' };
  if (marginPct >= 15)  return { label: 'Profitable', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (marginPct >= 5)   return { label: 'At Risk',    cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  return { label: 'Loss', cls: 'bg-red-100 text-red-700 border-red-200' };
}

// Pull the most recent estimate amount per job from a list.
function latestEstimateByJob(estimates) {
  const map = {};
  for (const e of estimates) {
    const prev = map[e.job_id];
    if (!prev || new Date(e.created_at) > new Date(prev.created_at)) {
      map[e.job_id] = e;
    }
  }
  return map;
}

export default function Dashboard({ user, onSelectJob }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [data, setData]       = useState(null);

  const bounds = useMemo(() => monthBounds(), []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { start, end, lastStart, lastEnd } = bounds;

        // Single batch — every query for the whole dashboard runs in
        // parallel so refresh is one round trip instead of fifteen.
        const [
          jobsResp,
          estimatesResp,
          expensesResp,
          eventsResp,
          qbResp,
          milestonesResp,
        ] = await Promise.all([
          supabase
            .from('jobs')
            .select('id, client_name, address, city, service, pipeline_status, created_at, updated_at, lead_source, in_pipeline, phase_data, lead_date, assigned_to')
            .limit(5000),
          supabase
            .from('estimates')
            .select('id, job_id, total_amount, status, created_at, signed_at')
            .limit(5000),
          supabase
            .from('job_expenses')
            .select('id, job_id, amount, date')
            .limit(10000),
          supabase
            .from('calendar_events')
            .select('id, job_id, kind, starts_at')
            .eq('kind', 'sales_visit')
            .gte('starts_at', lastStart.toISOString())
            .lt('starts_at', end.toISOString()),
          // QuickBooks bank balance — soft fail if not connected.
          // We don't store balances locally yet (only access tokens),
          // so this just confirms whether QB is connected. Wiring the
          // /api/quickbooks/balances endpoint into here is Phase 2.
          supabase
            .from('quickbooks_tokens')
            .select('id, realm_id')
            .limit(1)
            .maybeSingle(),
          // Payment milestones — drives the Cash & Payments block.
          supabase
            .from('payment_milestones')
            .select('id, job_id, due_date, due_amount, received_amount, status')
            .limit(5000),
        ]);

        if (!active) return;

        const jobs       = jobsResp.data || [];
        const estimates  = estimatesResp.data || [];
        const expenses   = expensesResp.data || [];
        const events     = eventsResp.data || [];
        const qbConnected = !!qbResp.data?.realm_id;

        const latestEstByJob = latestEstimateByJob(estimates);

        // ─── Active jobs ─────────────────────────────────────────
        const activeJobs = jobs.filter((j) => ACTIVE_PHASES.has(j.pipeline_status || 'new_lead'));

        // ─── Revenue (MTD): sum of contracts signed this month. ─
        // Falls back to estimates.signed_at when contracts table
        // is sparse. Each job counts once at the latest estimate
        // amount.
        function revenueIn(rangeStart, rangeEnd) {
          let total = 0;
          for (const j of jobs) {
            if (!SIGNED_PHASES.has(j.pipeline_status)) continue;
            const est = latestEstByJob[j.id];
            if (!est?.signed_at) {
              // Fall back to job's updated_at when the signed_at
              // field is missing on the estimate.
              const ts = new Date(j.updated_at || j.created_at);
              if (ts >= rangeStart && ts < rangeEnd) total += Number(est?.total_amount) || 0;
              continue;
            }
            const ts = new Date(est.signed_at);
            if (ts >= rangeStart && ts < rangeEnd) total += Number(est.total_amount) || 0;
          }
          return total;
        }

        const revenueMTD  = revenueIn(start, end);
        const revenueLast = revenueIn(lastStart, lastEnd);

        // ─── Costs (MTD): job_expenses by date. ─────────────────
        function costsIn(rangeStart, rangeEnd) {
          let total = 0;
          for (const e of expenses) {
            if (!e.date) continue;
            const [y, m, d] = e.date.split('-').map(Number);
            const ts = new Date(y, (m - 1), d);
            if (ts >= rangeStart && ts < rangeEnd) total += Number(e.amount) || 0;
          }
          return total;
        }

        const costsMTD  = costsIn(start, end);
        const costsLast = costsIn(lastStart, lastEnd);

        const profitMTD  = revenueMTD  - costsMTD;
        const profitLast = revenueLast - costsLast;

        // ─── Pipeline value: sum of latest estimates for jobs
        // currently in active (non-signed) phases. ──────────────
        const pipelineValue = activeJobs.reduce((sum, j) => {
          if (SIGNED_PHASES.has(j.pipeline_status)) return sum;
          const est = latestEstByJob[j.id];
          return sum + (Number(est?.total_amount) || 0);
        }, 0);

        // Pipeline value last month (for delta) — same logic but
        // we approximate by counting the prior snapshot via
        // updated_at. Not exact, but the only signal we have.
        // (Better requires a periodic snapshot table.)

        // ─── Close rate: signed / (signed + rejected) MTD ───────
        function closeRateIn(rangeStart, rangeEnd) {
          let won = 0, lost = 0;
          for (const j of jobs) {
            const ts = new Date(j.updated_at || j.created_at);
            if (ts < rangeStart || ts >= rangeEnd) continue;
            if (WON_PHASES.has(j.pipeline_status)) won += 1;
            if (LOST_PHASES.has(j.pipeline_status)) lost += 1;
          }
          const denom = won + lost;
          return denom === 0 ? 0 : (won / denom) * 100;
        }

        const closeRateMTD  = closeRateIn(start, end);
        const closeRateLast = closeRateIn(lastStart, lastEnd);

        // ─── Active Jobs count ──────────────────────────────────
        const activeJobsCount = activeJobs.filter((j) =>
          j.pipeline_status === 'in_progress' || j.pipeline_status === 'contract_signed'
        ).length;
        const activeJobsLast = jobs.filter((j) => {
          if (!(j.pipeline_status === 'in_progress' || j.pipeline_status === 'contract_signed')) return false;
          const ts = new Date(j.updated_at || j.created_at);
          return ts >= lastStart && ts < lastEnd;
        }).length;

        // ─── Active Jobs table (in_progress only) ───────────────
        const inProgressJobs = jobs
          .filter((j) => j.pipeline_status === 'in_progress')
          .map((j) => {
            const est = latestEstByJob[j.id];
            const estTotal = Number(est?.total_amount) || 0;
            const jobExpenses = expenses.filter((e) => e.job_id === j.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
            const margin = estTotal > 0 ? ((estTotal - jobExpenses) / estTotal) * 100 : null;

            // Progress % from phase_data.phases[].items[].done.
            const phases = j.phase_data?.phases || [];
            let total = 0, done = 0;
            for (const p of phases) {
              for (const it of (p.items || [])) {
                total += 1;
                if (it.done || it.completed) done += 1;
              }
            }
            const progress = total === 0 ? 0 : Math.round((done / total) * 100);

            return {
              id: j.id,
              client_name: j.client_name,
              address: [j.address, j.city].filter(Boolean).join(', '),
              service: j.service,
              progress,
              margin,
              estTotal,
              raw: j,
            };
          })
          .sort((a, b) => (b.estTotal || 0) - (a.estTotal || 0))
          .slice(0, 6);

        // ─── Sales Pipeline funnel ─────────────────────────────
        function fromLeadDate(j) {
          return new Date(j.lead_date || j.created_at);
        }
        const monthLeads = jobs.filter((j) => {
          const ts = fromLeadDate(j);
          return ts >= start && ts < end;
        });
        const leadsCount = monthLeads.length;

        const monthAppts = events.filter((ev) => {
          const ts = new Date(ev.starts_at);
          return ts >= start && ts < end;
        }).length;

        const monthEstSent = jobs.filter((j) => {
          if (!['estimate_sent', 'estimate_negotiating', 'estimate_approved', 'contract_sent', 'contract_signed', 'in_progress', 'completed', 'estimate_rejected'].includes(j.pipeline_status)) return false;
          const ts = new Date(j.updated_at || j.created_at);
          return ts >= start && ts < end;
        }).length;

        const monthClosed = jobs.filter((j) => {
          if (!WON_PHASES.has(j.pipeline_status)) return false;
          const ts = new Date(j.updated_at || j.created_at);
          return ts >= start && ts < end;
        }).length;

        // Conversion rate (closed / leads), avg deal, total pipeline.
        const conversionRate = leadsCount === 0 ? 0 : (monthClosed / leadsCount) * 100;
        const avgDealSize = monthClosed === 0 ? 0 : revenueMTD / monthClosed;

        // Last-month equivalents for funnel deltas.
        const lastLeads = jobs.filter((j) => {
          const ts = fromLeadDate(j);
          return ts >= lastStart && ts < lastEnd;
        }).length;
        const lastClosed = jobs.filter((j) => {
          if (!WON_PHASES.has(j.pipeline_status)) return false;
          const ts = new Date(j.updated_at || j.created_at);
          return ts >= lastStart && ts < lastEnd;
        }).length;
        const lastConversion = lastLeads === 0 ? 0 : (lastClosed / lastLeads) * 100;
        const lastAvgDeal = lastClosed === 0 ? 0 : revenueLast / lastClosed;

        // ─── Phase 2: Daily series for Financial Overview chart ──
        // Bucket revenue + costs per calendar day from the 1st of
        // the month through today. Days yet-to-come stay 0 for
        // both — the chart line stops at today via the cutoff in
        // FinancialChart.
        const daysInRange = Math.ceil((end - start) / 86400000); // includes today
        const series = Array.from({ length: daysInRange }, (_, i) => {
          const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
          let revenue = 0;
          for (const j of jobs) {
            if (!SIGNED_PHASES.has(j.pipeline_status)) continue;
            const est = latestEstByJob[j.id];
            const ts = est?.signed_at ? new Date(est.signed_at) : new Date(j.updated_at || j.created_at);
            if (ts >= day && ts < dayEnd) revenue += Number(est?.total_amount) || 0;
          }
          let cost = 0;
          for (const e of expenses) {
            if (!e.date) continue;
            const [y, m, d] = e.date.split('-').map(Number);
            if (y === day.getFullYear() && (m - 1) === day.getMonth() && d === day.getDate()) {
              cost += Number(e.amount) || 0;
            }
          }
          return { day: day.getDate(), revenue, cost, profit: revenue - cost };
        });

        // ─── Phase 2: Salesman Performance ──────────────────────
        // Group MTD won jobs by assigned_to. Count + revenue + avg.
        const salesByPerson = new Map();
        for (const j of jobs) {
          if (!WON_PHASES.has(j.pipeline_status)) continue;
          const ts = new Date(j.updated_at || j.created_at);
          if (ts < start || ts >= end) continue;
          const name = j.assigned_to || 'Unassigned';
          const est = latestEstByJob[j.id];
          const amount = Number(est?.total_amount) || 0;
          const acc = salesByPerson.get(name) || { name, count: 0, revenue: 0 };
          acc.count += 1;
          acc.revenue += amount;
          salesByPerson.set(name, acc);
        }
        const salesmen = Array.from(salesByPerson.values())
          .map((p) => ({ ...p, avg: p.count === 0 ? 0 : p.revenue / p.count }))
          .sort((a, b) => b.revenue - a.revenue);

        // ─── Phase 2: Marketing — leads by source MTD ───────────
        const leadsBySource = new Map();
        for (const j of monthLeads) {
          const src = j.lead_source || 'Other';
          leadsBySource.set(src, (leadsBySource.get(src) || 0) + 1);
        }
        const marketingTotal = monthLeads.length;
        const marketing = Array.from(leadsBySource.entries())
          .map(([source, count]) => ({
            source,
            count,
            pct: marketingTotal === 0 ? 0 : (count / marketingTotal) * 100,
          }))
          .sort((a, b) => b.count - a.count);
        const bestChannel = marketing[0] || null;

        // ─── Phase 2: Cash & Payments ───────────────────────────
        // Payments due this week, overdue, and upcoming receivables
        // (next 30 days). All from payment_milestones.
        const milestones = milestonesResp.data || [];
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const inSevenDays = new Date(today.getTime() + 7 * 86400000);
        const inThirtyDays = new Date(today.getTime() + 30 * 86400000);
        const graceDays = 3; // Brenda's overdue rule (matches Finance screen)
        const overdueThreshold = new Date(today.getTime() - graceDays * 86400000);

        let dueThisWeek = 0, overdue = 0, upcoming30 = 0;
        for (const m of milestones) {
          if (!m.due_date) continue;
          if (m.status === 'paid') continue;
          const remaining = (Number(m.due_amount) || 0) - (Number(m.received_amount) || 0);
          if (remaining <= 0) continue;
          const [yy, mm, dd] = m.due_date.split('-').map(Number);
          const dueDate = new Date(yy, mm - 1, dd);

          if (dueDate < overdueThreshold) {
            overdue += remaining;
          } else if (dueDate <= inSevenDays) {
            dueThisWeek += remaining;
          }
          if (dueDate <= inThirtyDays && dueDate >= today) {
            upcoming30 += remaining;
          }
        }

        // ─── Phase 2: QuickBooks balance fetch (best-effort) ────
        let qbCash = null;
        if (qbConnected) {
          try {
            const r = await fetch('/api/quickbooks/balances');
            if (r.ok) {
              const j = await r.json();
              const accounts = Array.isArray(j?.accounts) ? j.accounts : [];
              // Sum bank-type accounts; ignore credit cards / other.
              qbCash = accounts
                .filter((a) => (a.type || '').toLowerCase() === 'bank')
                .reduce((s, a) => s + (Number(a.currentBalance) || 0), 0);
            }
          } catch { /* leave qbCash null */ }
        }
        if (!active) return;

        setData({
          revenueMTD, revenueLast,
          profitMTD, profitLast,
          costsMTD, costsLast,
          pipelineValue,
          closeRateMTD, closeRateLast,
          activeJobsCount, activeJobsLast,
          qbConnected, qbCash,
          inProgressJobs,
          funnel: {
            leadsCount, monthAppts, monthEstSent, monthClosed,
            conversionRate, avgDealSize,
            lastConversion, lastAvgDeal,
          },
          series,
          salesmen,
          marketing, marketingTotal, bestChannel,
          payments: { dueThisWeek, overdue, upcoming30, cashInBank: qbCash },
        });
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load dashboard.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [bounds, refreshTick]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-omega-cloud">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-omega-cloud p-8">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const lastMonthAbbr = lastMonthLabel(bounds.lastStart);

  // KPI definitions with delta.
  const revenueDelta   = fmtDelta(data.revenueMTD, data.revenueLast);
  const profitDelta    = fmtDelta(data.profitMTD, data.profitLast);
  const activeJobsDelta = (() => {
    const diff = data.activeJobsCount - data.activeJobsLast;
    return { text: `${diff >= 0 ? '+' : ''}${diff} vs ${lastMonthAbbr}`, positive: diff >= 0 };
  })();
  const closeRateDelta = fmtDeltaPp(data.closeRateMTD, data.closeRateLast);
  const convDelta      = fmtDeltaPp(data.funnel.conversionRate, data.funnel.lastConversion);
  const avgDealDelta   = fmtDelta(data.funnel.avgDealSize, data.funnel.lastAvgDeal);

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-5">

        {/* ─── Header ───────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-omega-charcoal">Dashboard</h1>
            <p className="text-sm text-omega-stone mt-1">Overview of your business performance</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRefreshTick((t) => t + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange text-sm font-bold text-omega-charcoal shadow-sm"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm font-bold text-omega-charcoal shadow-sm">
              <Calendar className="w-4 h-4 text-omega-orange" />
              {rangeLabel(bounds.start, bounds.end)}
            </span>
          </div>
        </header>

        {/* ─── KPI Row ──────────────────────────────────────── */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <KpiCard
            icon={DollarSign}
            iconBg="bg-orange-100" iconColor="text-omega-orange"
            label="Revenue (MTD)"
            value={fmtMoney(data.revenueMTD)}
            delta={revenueDelta}
            deltaSuffix={`vs ${lastMonthAbbr}`}
          />
          <KpiCard
            icon={TrendingUp}
            iconBg="bg-emerald-100" iconColor="text-emerald-600"
            label="Profit (MTD)"
            value={fmtMoney(data.profitMTD)}
            delta={profitDelta}
            deltaSuffix={`vs ${lastMonthAbbr}`}
          />
          <KpiCard
            icon={Briefcase}
            iconBg="bg-blue-100" iconColor="text-blue-600"
            label="Active Jobs"
            value={data.activeJobsCount.toString()}
            delta={activeJobsDelta}
            deltaSuffix=""
          />
          <KpiCard
            icon={Wallet}
            iconBg="bg-violet-100" iconColor="text-violet-600"
            label="Cash Available"
            value={data.qbCash != null ? fmtMoney(data.qbCash) : '—'}
            delta={null}
            deltaSuffix={
              data.qbCash != null
                ? 'QuickBooks bank accounts'
                : data.qbConnected
                  ? 'Refreshing…'
                  : 'Connect QuickBooks'
            }
          />
          <KpiCard
            icon={GitBranch}
            iconBg="bg-amber-100" iconColor="text-amber-600"
            label="Pipeline Value"
            value={fmtMoney(data.pipelineValue)}
            delta={null}
            deltaSuffix={`${data.funnel.leadsCount} new leads`}
          />
          <KpiCard
            icon={Target}
            iconBg="bg-emerald-100" iconColor="text-emerald-600"
            label="Close Rate"
            value={fmtPct(data.closeRateMTD)}
            delta={closeRateDelta}
            deltaSuffix={`vs ${lastMonthAbbr}`}
          />
        </section>

        {/* ─── Active Jobs table ─────────────────────────────── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-omega-charcoal">Active Jobs</h2>
              <p className="text-xs text-omega-stone mt-0.5">In-progress projects ranked by contract value</p>
            </div>
            {data.inProgressJobs.length === 6 && (
              <span className="text-[11px] font-bold text-omega-stone uppercase tracking-wider">
                Top 6 of {data.activeJobsCount}
              </span>
            )}
          </div>
          {data.inProgressJobs.length === 0 ? (
            <p className="text-sm text-omega-stone italic py-8 text-center">
              No jobs are currently in progress.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">
                    <th className="text-left py-2 px-2">Job / Client</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2 w-[180px]">Progress</th>
                    <th className="text-left py-2 px-2">Financial Status</th>
                    <th className="text-right py-2 px-2">Margin</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.inProgressJobs.map((j) => {
                    const bucket = marginBucket(j.margin);
                    return (
                      <tr
                        key={j.id}
                        onClick={() => onSelectJob?.(j.raw)}
                        className="border-t border-gray-100 hover:bg-omega-cloud/40 cursor-pointer"
                      >
                        <td className="py-2.5 px-2">
                          <p className="font-bold text-omega-charcoal text-sm truncate max-w-[260px]">
                            {j.client_name || 'Untitled'}
                          </p>
                          {j.address && (
                            <p className="text-[11px] text-omega-stone truncate max-w-[260px]">{j.address}</p>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-xs">
                          {j.service && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold uppercase text-[10px]">
                              {j.service}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full bg-omega-orange" style={{ width: `${j.progress}%` }} />
                            </div>
                            <span className="text-xs font-bold text-omega-charcoal tabular-nums w-10 text-right">{j.progress}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${bucket.cls}`}>
                            {bucket.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right text-sm font-bold text-omega-charcoal tabular-nums">
                          {j.margin == null ? '—' : `${j.margin >= 0 ? '+' : ''}${j.margin.toFixed(0)}%`}
                        </td>
                        <td className="py-2.5 px-2 text-omega-stone">
                          <ArrowRight className="w-4 h-4" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─── Sales Pipeline funnel + side stats ─────────────── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-omega-charcoal">Sales Pipeline</h2>
              <p className="text-xs text-omega-stone mt-0.5">{rangeLabel(bounds.start, bounds.end)} funnel</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
            <Funnel
              steps={[
                { label: 'Leads',         value: data.funnel.leadsCount,   color: '#A78BFA' }, // violet-400
                { label: 'Appointments',  value: data.funnel.monthAppts,   color: '#60A5FA' }, // blue-400
                { label: 'Estimates Sent', value: data.funnel.monthEstSent, color: '#FB923C' }, // orange-400
                { label: 'Closed Won',    value: data.funnel.monthClosed,  color: '#34D399' }, // emerald-400
              ]}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SideStat
                icon={Percent}
                label="Conversion Rate"
                value={fmtPct(data.funnel.conversionRate)}
                delta={convDelta}
                deltaSuffix={`vs ${lastMonthAbbr}`}
              />
              <SideStat
                icon={GitBranch}
                label="Pipeline Value"
                value={fmtMoney(data.pipelineValue)}
                delta={null}
                deltaSuffix={`${data.funnel.leadsCount} new leads`}
              />
              <SideStat
                icon={Banknote}
                label="Avg Deal Size"
                value={fmtMoney(data.funnel.avgDealSize)}
                delta={avgDealDelta}
                deltaSuffix={`vs ${lastMonthAbbr}`}
              />
            </div>
          </div>
        </section>

        {/* ─── Phase 2: Financial Overview chart ─────────────── */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-omega-charcoal">Financial Overview</h2>
              <p className="text-xs text-omega-stone mt-0.5">{rangeLabel(bounds.start, bounds.end)} — Revenue, Costs, Profit by day</p>
            </div>
            <div className="inline-flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-omega-stone">
              <Legend color="#22C55E" label="Revenue" />
              <Legend color="#F97316" label="Costs" />
              <Legend color="#1F2937" label="Profit" dashed />
            </div>
          </div>
          <FinancialChart series={data.series} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <MiniStat label="Total Revenue" value={fmtMoney(data.revenueMTD)} positive />
            <MiniStat label="Total Costs"   value={fmtMoney(data.costsMTD)}   tone="orange" />
            <MiniStat label="Total Profit"  value={fmtMoney(data.profitMTD)}  positive={data.profitMTD >= 0} negative={data.profitMTD < 0} />
            <MiniStat label="Profit Margin" value={
              data.revenueMTD === 0 ? '—' : `${((data.profitMTD / data.revenueMTD) * 100).toFixed(1)}%`
            } positive />
          </div>
        </section>

        {/* ─── Phase 2: Salesman / Marketing / Cash & Payments ── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SalesmanPerformance salesmen={data.salesmen} />
          <MarketingOverview marketing={data.marketing} total={data.marketingTotal} best={data.bestChannel} />
          <CashAndPayments payments={data.payments} qbConnected={data.qbConnected} />
        </section>

        <p className="text-[11px] text-omega-stone text-center pt-2">
          All data is updated as of {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconBg, iconColor, label, value, delta, deltaSuffix }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-3 sm:p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl ${iconBg} ${iconColor} inline-flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone truncate">{label}</p>
        <p className="text-xl sm:text-2xl font-black text-omega-charcoal tabular-nums leading-tight mt-0.5">{value}</p>
        {(delta || deltaSuffix) && (
          <p className={`text-[11px] font-semibold mt-1 truncate ${
            delta?.positive === false ? 'text-red-600' : delta ? 'text-emerald-600' : 'text-omega-stone'
          }`}>
            {delta?.positive === false ? <TrendingDown className="w-3 h-3 inline mr-0.5" /> : delta ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : null}
            {delta?.text}{delta && deltaSuffix ? ' ' : ''}{deltaSuffix}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Side stat (smaller KPI used inside Pipeline section) ────────
function SideStat({ icon: Icon, label, value, delta, deltaSuffix }) {
  return (
    <div className="bg-omega-cloud/60 rounded-xl border border-gray-100 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4 text-omega-orange" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">{label}</p>
      </div>
      <p className="text-xl font-black text-omega-charcoal tabular-nums">{value}</p>
      {(delta || deltaSuffix) && (
        <p className={`text-[11px] font-semibold mt-1 ${
          delta?.positive === false ? 'text-red-600' : delta ? 'text-emerald-600' : 'text-omega-stone'
        }`}>
          {delta?.positive === false ? <TrendingDown className="w-3 h-3 inline mr-0.5" /> : delta ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : null}
          {delta?.text}{delta && deltaSuffix ? ' ' : ''}{deltaSuffix}
        </p>
      )}
    </div>
  );
}

// ─── Mini stat used under the chart ──────────────────────────────
function MiniStat({ label, value, tone = 'gray', positive = false, negative = false }) {
  const cls = negative
    ? 'text-red-600'
    : positive
      ? 'text-emerald-600'
      : tone === 'orange'
        ? 'text-orange-600'
        : 'text-omega-charcoal';
  return (
    <div className="bg-omega-cloud/60 rounded-xl border border-gray-100 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">{label}</p>
      <p className={`text-xl font-black tabular-nums mt-0.5 ${cls}`}>{value}</p>
    </div>
  );
}

function Legend({ color, label, dashed = false }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block w-3 h-[2px]"
        style={{
          background: dashed ? `repeating-linear-gradient(to right, ${color} 0, ${color} 3px, transparent 3px, transparent 5px)` : color,
        }}
      />
      {label}
    </span>
  );
}

// ─── Financial Overview chart — pure SVG line chart ──────────────
// 3 series (Revenue / Costs / Profit) by day for the visible MTD
// range. No charting library — keeps the bundle slim.
function FinancialChart({ series }) {
  const W = 920;
  const H = 240;
  const padX = 36;
  const padY = 24;

  if (!series || series.length === 0) {
    return <div className="text-sm text-omega-stone italic py-12 text-center">No data yet.</div>;
  }

  const maxVal = Math.max(
    1,
    ...series.map((p) => Math.max(p.revenue, p.cost, Math.abs(p.profit))),
  );
  const minVal = Math.min(0, ...series.map((p) => p.profit));

  const xFor = (i) => padX + (i * (W - padX * 2)) / Math.max(1, series.length - 1);
  const yFor = (v) => {
    const range = maxVal - minVal;
    return padY + (1 - (v - minVal) / range) * (H - padY * 2);
  };

  const pathFor = (key) => series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p[key])}`).join(' ');

  // Y-axis labels — three reference lines at 0, mid, max.
  const midVal = (maxVal + minVal) / 2;

  const fmtAxis = (n) => {
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}K`;
    return `$${Math.round(n)}`;
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        {/* Reference horizontal lines */}
        {[maxVal, midVal, 0].map((v, i) => (
          <g key={i}>
            <line
              x1={padX} x2={W - padX}
              y1={yFor(v)} y2={yFor(v)}
              stroke="#e5e7eb" strokeDasharray="2 4"
            />
            <text x={6} y={yFor(v) + 4} fontSize="10" fill="#9ca3af">{fmtAxis(v)}</text>
          </g>
        ))}

        {/* Lines */}
        <path d={pathFor('revenue')} fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={pathFor('cost')}    fill="none" stroke="#F97316" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={pathFor('profit')}  fill="none" stroke="#1F2937" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />

        {/* X-axis: day numbers (every ~5 days) */}
        {series.map((p, i) => {
          const showLabel = i === 0 || i === series.length - 1 || (i + 1) % 5 === 0;
          if (!showLabel) return null;
          return (
            <text key={i} x={xFor(i)} y={H - 4} fontSize="10" fill="#9ca3af" textAnchor="middle">
              {p.day}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Salesman Performance ────────────────────────────────────────
function SalesmanPerformance({ salesmen }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
      <h2 className="text-base font-bold text-omega-charcoal mb-3">Salesman Performance</h2>
      {salesmen.length === 0 ? (
        <p className="text-sm text-omega-stone italic py-6 text-center">No closed deals this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[300px]">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">
                <th className="text-left py-1.5">Salesman</th>
                <th className="text-right py-1.5">Closed</th>
                <th className="text-right py-1.5">Revenue</th>
                <th className="text-right py-1.5">Avg Deal</th>
              </tr>
            </thead>
            <tbody>
              {salesmen.map((s) => (
                <tr key={s.name} className="border-t border-gray-100">
                  <td className="py-2 text-sm font-bold text-omega-charcoal truncate max-w-[140px]">{s.name}</td>
                  <td className="py-2 text-right text-sm tabular-nums">{s.count}</td>
                  <td className="py-2 text-right text-sm tabular-nums">{fmtMoney(s.revenue)}</td>
                  <td className="py-2 text-right text-sm tabular-nums">{fmtMoney(s.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Marketing Overview — donut by lead source ───────────────────
const MARKETING_COLORS = ['#3B82F6', '#F97316', '#22C55E', '#A78BFA', '#F43F5E', '#FACC15', '#06B6D4', '#9CA3AF'];

function MarketingOverview({ marketing, total, best }) {
  // Donut math.
  const size = 140;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
      <h2 className="text-base font-bold text-omega-charcoal mb-3">Marketing Overview</h2>
      {marketing.length === 0 ? (
        <p className="text-sm text-omega-stone italic py-6 text-center">No leads logged this month.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-3">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              {/* Background ring */}
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
              {marketing.map((m, i) => {
                const len = (m.pct / 100) * c;
                const seg = (
                  <circle
                    key={m.source}
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none"
                    stroke={MARKETING_COLORS[i % MARKETING_COLORS.length]}
                    strokeWidth={stroke}
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={-offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  />
                );
                offset += len;
                return seg;
              })}
              {/* Center label */}
              <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="10" fill="#9ca3af" fontWeight="700">Total Leads</text>
              <text x={size / 2} y={size / 2 + 18} textAnchor="middle" fontSize="22" fill="#1f2937" fontWeight="900">{total}</text>
            </svg>
            <ul className="flex-1 min-w-0 space-y-1.5">
              {marketing.slice(0, 6).map((m, i) => (
                <li key={m.source} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: MARKETING_COLORS[i % MARKETING_COLORS.length] }} />
                  <span className="flex-1 truncate text-omega-charcoal font-semibold">{m.source}</span>
                  <span className="text-omega-stone tabular-nums">{m.count} ({Math.round(m.pct)}%)</span>
                </li>
              ))}
            </ul>
          </div>
          {best && (
            <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">Best Channel</p>
              <p className="text-sm font-bold text-omega-charcoal">
                {best.source} <span className="text-omega-stone font-normal">({Math.round(best.pct)}%)</span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Cash & Payments block ───────────────────────────────────────
function CashAndPayments({ payments, qbConnected }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
      <h2 className="text-base font-bold text-omega-charcoal mb-3">Cash & Payments</h2>
      <ul className="space-y-2">
        <PayRow icon={Wallet}    iconColor="text-violet-600" label="Cash in Bank"
          value={payments.cashInBank != null ? fmtMoney(payments.cashInBank) : '—'}
          hint={qbConnected ? null : 'Connect QuickBooks'}
        />
        <PayRow icon={Banknote}  iconColor="text-amber-600" label="Payments Due This Week"
          value={fmtMoney(payments.dueThisWeek)} valueClass="text-amber-700"
        />
        <PayRow icon={DollarSign} iconColor="text-red-600"  label="Overdue Payments"
          value={fmtMoney(payments.overdue)} valueClass="text-red-700"
        />
        <PayRow icon={TrendingUp} iconColor="text-emerald-600" label="Upcoming Receivables"
          subtitle="Next 30 days"
          value={fmtMoney(payments.upcoming30)} valueClass="text-emerald-700"
        />
      </ul>
    </div>
  );
}

function PayRow({ icon: Icon, iconColor, label, subtitle, value, valueClass = 'text-omega-charcoal', hint }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-8 h-8 rounded-lg bg-omega-cloud/60 inline-flex items-center justify-center flex-shrink-0 ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-omega-charcoal truncate">{label}</p>
          {(subtitle || hint) && <p className="text-[10px] text-omega-stone truncate">{subtitle || hint}</p>}
        </div>
      </div>
      <p className={`text-sm font-bold tabular-nums flex-shrink-0 ${valueClass}`}>{value}</p>
    </li>
  );
}

// ─── Funnel — pure CSS pyramid with proportional widths ─────────
function Funnel({ steps }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        // Each step is ~12% narrower than the one above; floor at 35%.
        const widthByOrder = Math.max(35, 100 - i * 18);
        const widthByValue = max > 0 ? Math.max(35, (s.value / max) * 100) : widthByOrder;
        const width = Math.min(widthByOrder, widthByValue + 5); // visual cap so funnel narrows
        return (
          <div key={s.label} className="flex items-center justify-center">
            <div
              className="rounded-lg shadow-sm py-2.5 px-3 flex items-center justify-between"
              style={{ background: s.color + '33', borderLeft: `3px solid ${s.color}`, width: `${width}%` }}
            >
              <span className="text-[11px] font-bold uppercase tracking-wider text-omega-charcoal">{s.label}</span>
              <span className="text-base font-black text-omega-charcoal tabular-nums">{s.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
