import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, Calendar, TrendingUp, TrendingDown, ArrowRight, Briefcase,
  DollarSign, Banknote, Target, GitBranch, Percent, Wallet, AlertOctagon,
  CheckCircle2, X, Phone, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import LeadsHeatMap from '../components/LeadsHeatMap';
import Logo from '../components/Logo';
import { sumAcceptedEstimates, manualCostTotal, computeJobFinancials } from '../../../shared/lib/jobFinancials';

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

// Compact money for tight spaces — $45K, $1.2M, $800
function fmtMoneyCompact(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v)}`;
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
  if (marginPct == null) return { label: 'No Costing', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
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

export default function Dashboard({ user, onSelectJob, onNavigate }) {
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
          milestonesResp,
          materialsResp,
          spendResp,
          costsResp,
        ] = await Promise.all([
          supabase
            .from('jobs')
            .select('id, client_name, client_phone, address, city, service, pipeline_status, created_at, updated_at, lead_source, in_pipeline, phase_data, lead_date, assigned_to, last_touch_at')
            .limit(5000),
          supabase
            .from('estimates')
            .select('id, job_id, total_amount, status, created_at, signed_at')
            .limit(5000),
          supabase
            .from('job_expenses')
            .select('id, job_id, amount, date')
            .limit(10000),
          // Calendar events: sales_visits for funnel + inspections
          // for the bottlenecks panel. Pulled together to keep the
          // request count down.
          supabase
            .from('calendar_events')
            .select('id, job_id, kind, starts_at, visit_status')
            .in('kind', ['sales_visit', 'inspection'])
            .gte('starts_at', lastStart.toISOString())
            .lt('starts_at', end.toISOString()),
          // Payment milestones — drives the Cash & Payments block
          // and the Total Receivable KPI.
          supabase
            .from('payment_milestones')
            .select('id, job_id, due_date, due_amount, received_amount, status')
            .limit(5000),
          // Open material requests — fuels the Material Delays
          // bottleneck. status='needed' = not bought yet.
          supabase
            .from('job_materials')
            .select('id, job_id, status, added_at, name')
            .eq('status', 'needed')
            .limit(2000),
          // Marketing spend per channel — single recurring monthly
          // value (migration 049). Drives Cost per Lead in the
          // Marketing Overview panel for every month.
          supabase
            .from('marketing_spend')
            .select('channel, monthly_amount'),
          // Manual Job Costing (Financial tab). For jobs imported from
          // the old app with no estimate, this is the only source of a
          // contract value + costs, so the Active Jobs margin falls back
          // to it instead of showing "No Costing".
          supabase
            .from('job_costs')
            .select('job_id, estimated_revenue, material_cost, labor_cost, sub_cost, other_costs, updated_at')
            .limit(5000),
        ]);

        if (!active) return;

        const jobs       = jobsResp.data || [];
        const estimates  = estimatesResp.data || [];
        const expenses   = expensesResp.data || [];
        const events     = eventsResp.data || [];

        const latestEstByJob = latestEstimateByJob(estimates);

        // All estimates grouped per job — the Active Jobs margin uses the
        // SUM of accepted (approved/signed) estimates, not just the latest.
        const estimatesByJob = {};
        for (const e of estimates) {
          (estimatesByJob[e.job_id] ||= []).push(e);
        }

        // Latest manual Job Costing row per job (Financial tab). The
        // fallback revenue + cost source for estimate-less (imported)
        // jobs, and the manual-cost half of every job's total cost.
        const costsByJob = {};
        for (const c of (costsResp.data || [])) {
          const prev = costsByJob[c.job_id];
          if (!prev || new Date(c.updated_at || 0) > new Date(prev.updated_at || 0)) {
            costsByJob[c.job_id] = c;
          }
        }

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
            // Use signed_at (DocuSign date) → estimate.created_at → job.created_at.
            // Never use updated_at — it changes on every field edit and would
            // re-count old jobs as this month's revenue whenever someone touches them.
            const ts = est?.signed_at
              ? new Date(est.signed_at)
              : new Date(est?.created_at || j.created_at);
            if (ts >= rangeStart && ts < rangeEnd) total += Number(est?.total_amount) || 0;
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
        // Won: timestamp = estimate.signed_at → estimate.created_at → job.created_at
        //      (never updated_at — any field edit would re-count old wins)
        // Lost: updated_at is OK for rejections (last meaningful action on the job)
        function closeRateIn(rangeStart, rangeEnd) {
          let won = 0, lost = 0;
          for (const j of jobs) {
            if (WON_PHASES.has(j.pipeline_status)) {
              const est = latestEstByJob[j.id];
              const ts = est?.signed_at
                ? new Date(est.signed_at)
                : new Date(est?.created_at || j.created_at);
              if (ts >= rangeStart && ts < rangeEnd) won += 1;
            } else if (LOST_PHASES.has(j.pipeline_status)) {
              const ts = new Date(j.updated_at || j.created_at);
              if (ts >= rangeStart && ts < rangeEnd) lost += 1;
            }
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
        // Delta: jobs that *entered* an active phase this period,
        // anchored to estimate.signed_at (stable) not updated_at.
        function activeJobsStartedIn(rangeStart, rangeEnd) {
          return jobs.filter((j) => {
            if (j.pipeline_status !== 'in_progress' && j.pipeline_status !== 'contract_signed') return false;
            const est = latestEstByJob[j.id];
            const ts = est?.signed_at
              ? new Date(est.signed_at)
              : new Date(est?.created_at || j.created_at);
            return ts >= rangeStart && ts < rangeEnd;
          }).length;
        }
        const activeJobsLast = activeJobsStartedIn(lastStart, lastEnd);

        // ─── Active Jobs table (in_progress only) ───────────────
        const inProgressJobs = jobs
          .filter((j) => j.pipeline_status === 'in_progress')
          .map((j) => {
            const jobExpenses = expenses.filter((e) => e.job_id === j.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
            const cost = costsByJob[j.id];

            // Unified formula (same as the Financials tab):
            //   revenue = sum of accepted estimates, else manual revenue
            //   cost    = all receipts (job_expenses) + manual cost fields
            const fin = computeJobFinancials({
              acceptedEstimateTotal: sumAcceptedEstimates(estimatesByJob[j.id]),
              manualRevenue: Number(cost?.estimated_revenue) || 0,
              manualCost: manualCostTotal(cost),
              expensesTotal: jobExpenses,
            });
            const margin = fin.margin;
            const profit = fin.profit;
            const contractValue = fin.revenue;

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
              profit,
              contractValue,
              raw: j,
            };
          })
          .sort((a, b) => (b.contractValue || 0) - (a.contractValue || 0))
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

        // Estimates Sent: only count jobs that have an actual estimate created
        // this period. Do NOT fall back to j.created_at — that inflates the
        // count by including every job in an advanced stage that was created
        // this month (even ones with no estimate at all).
        const monthEstSent = jobs.filter((j) => {
          if (!['estimate_sent', 'estimate_negotiating', 'estimate_approved',
                'contract_sent', 'contract_signed', 'in_progress',
                'completed', 'estimate_rejected'].includes(j.pipeline_status)) return false;
          const est = latestEstByJob[j.id];
          if (!est?.created_at) return false; // must have an actual estimate
          const ts = new Date(est.created_at);
          return ts >= start && ts < end;
        }).length;

        // Closed this month: anchored to estimate.signed_at (stable date)
        function closedJobsIn(rangeStart, rangeEnd) {
          return jobs.filter((j) => {
            if (!WON_PHASES.has(j.pipeline_status)) return false;
            const est = latestEstByJob[j.id];
            const ts = est?.signed_at
              ? new Date(est.signed_at)
              : new Date(est?.created_at || j.created_at);
            return ts >= rangeStart && ts < rangeEnd;
          }).length;
        }
        const monthClosed = closedJobsIn(start, end);

        // Conversion rate (closed / leads), avg deal, total pipeline.
        const conversionRate = leadsCount === 0 ? 0 : (monthClosed / leadsCount) * 100;
        const avgDealSize = monthClosed === 0 ? 0 : revenueMTD / monthClosed;

        // Last-month equivalents for funnel deltas.
        const lastLeads = jobs.filter((j) => {
          const ts = fromLeadDate(j);
          return ts >= lastStart && ts < lastEnd;
        }).length;
        const lastClosed = closedJobsIn(lastStart, lastEnd);
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
            const ts = est?.signed_at
              ? new Date(est.signed_at)
              : new Date(est?.created_at || j.created_at);
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
        // Use signed_at / estimate.created_at — never updated_at.
        const salesByPerson = new Map();
        for (const j of jobs) {
          if (!WON_PHASES.has(j.pipeline_status)) continue;
          const est = latestEstByJob[j.id];
          const ts = est?.signed_at
            ? new Date(est.signed_at)
            : new Date(est?.created_at || j.created_at);
          if (ts < start || ts >= end) continue;
          // Jobs created via Sales app store salesperson_name, not assigned_to.
          // Fall through both fields before labelling as Unassigned.
          const name = j.assigned_to || j.salesperson_name || 'Unassigned';
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
        const spendByChannel = new Map();
        for (const s of (spendResp?.data || [])) {
          spendByChannel.set(s.channel, Number(s.monthly_amount) || 0);
        }
        const marketing = Array.from(leadsBySource.entries())
          .map(([source, count]) => {
            const spend = spendByChannel.get(source) || 0;
            return {
              source,
              count,
              pct: marketingTotal === 0 ? 0 : (count / marketingTotal) * 100,
              spend,
              cpl: count === 0 || spend === 0 ? null : spend / count,
            };
          })
          .sort((a, b) => b.count - a.count);
        const totalSpend = Array.from(spendByChannel.values()).reduce((s, v) => s + v, 0);
        const overallCpl = marketingTotal === 0 || totalSpend === 0 ? null : totalSpend / marketingTotal;
        // Best channel = lowest CPL among those with both spend AND
        // leads. Falls back to highest count when no CPL data exists.
        const cplCandidates = marketing.filter((m) => m.cpl != null);
        const bestChannel = cplCandidates.length
          ? cplCandidates.sort((a, b) => a.cpl - b.cpl)[0]
          : (marketing[0] || null);
        const bestByVolume = marketing[0] || null;

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

        let dueThisWeek = 0, overdue = 0, upcoming30 = 0, totalReceivable = 0;
        for (const m of milestones) {
          if (m.status === 'paid') continue;
          const remaining = (Number(m.due_amount) || 0) - (Number(m.received_amount) || 0);
          if (remaining <= 0) continue;
          // Total receivable = everything still owed (no date filter)
          totalReceivable += remaining;
          if (!m.due_date) continue;
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

        // ─── Phase 3: Alerts & Notifications ────────────────────
        // Each alert returns { count, ... } so the panel can hide
        // entries with count === 0. No alert UI noise when there's
        // nothing to act on.
        const expensesByJob = new Map();
        for (const e of expenses) {
          const acc = expensesByJob.get(e.job_id) || 0;
          expensesByJob.set(e.job_id, acc + (Number(e.amount) || 0));
        }

        let jobsOverBudget = 0;
        let negativeMargin = 0;
        for (const j of jobs) {
          if (j.pipeline_status !== 'in_progress' && j.pipeline_status !== 'completed') continue;
          const est = latestEstByJob[j.id];
          const estTotal = Number(est?.total_amount) || 0;
          if (estTotal === 0) continue;
          const spent = expensesByJob.get(j.id) || 0;
          if (spent > estTotal) jobsOverBudget += 1;
          const margin = ((estTotal - spent) / estTotal) * 100;
          if (margin < 0) negativeMargin += 1;
        }

        const overdueMilestones = (milestonesResp.data || []).filter((m) => {
          if (!m.due_date || m.status === 'paid') return false;
          const remaining = (Number(m.due_amount) || 0) - (Number(m.received_amount) || 0);
          if (remaining <= 0) return false;
          const [yy, mm, dd] = m.due_date.split('-').map(Number);
          const dueDate = new Date(yy, mm - 1, dd);
          const now2 = new Date();
          const todayCmp = new Date(now2.getFullYear(), now2.getMonth(), now2.getDate());
          const overdueCutoff = new Date(todayCmp.getTime() - 3 * 86400000);
          return dueDate < overdueCutoff;
        });
        const overdueAmt = overdueMilestones.reduce((s, m) =>
          s + ((Number(m.due_amount) || 0) - (Number(m.received_amount) || 0)), 0);

        // Approvals pending = estimates in 'sent' or 'negotiating'.
        const pendingApprovals = estimates.filter((e) =>
          ['sent', 'negotiating'].includes(e.status || '')
        ).length;

        // overdueInvoices intentionally excluded — overdue amount is
        // already visible in the Cash row. Showing it again as an alert
        // creates noise without adding actionable info.
        const alerts = [
          jobsOverBudget > 0 && {
            id: 'overBudget',
            tone: 'red',
            count: jobsOverBudget,
            title: `${jobsOverBudget} ${jobsOverBudget === 1 ? 'Job' : 'Jobs'} over budget`,
            subtitle: 'Require your attention',
          },
          negativeMargin > 0 && {
            id: 'negativeMargin',
            tone: 'red',
            count: negativeMargin,
            title: `${negativeMargin} ${negativeMargin === 1 ? 'Job' : 'Jobs'} with negative margin`,
            subtitle: 'Review and take action',
          },
          pendingApprovals > 0 && {
            id: 'approvalsPending',
            tone: 'blue',
            count: pendingApprovals,
            title: `${pendingApprovals} Approvals pending`,
            subtitle: 'Estimates and change orders',
          },
        ].filter(Boolean);

        // ─── Phase 3: Top Bottlenecks ───────────────────────────
        const materials = materialsResp.data || [];
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
        const materialDelayJobs = new Set();
        for (const m of materials) {
          if (!m.added_at) continue;
          if (new Date(m.added_at) <= threeDaysAgo) materialDelayJobs.add(m.job_id);
        }

        const inspectionEvents = (eventsResp.data || []).filter((e) => e.kind === 'inspection');
        const inspectionPending = inspectionEvents.filter((ev) => {
          const t = new Date(ev.starts_at);
          return t < new Date() && ev.visit_status !== 'completed';
        }).length;

        const fiveDaysAgo = new Date(Date.now() - 5 * 86400000);
        const designStuck = estimates.filter((e) =>
          (e.status === 'negotiating' || e.status === 'changes_requested') &&
          e.created_at && new Date(e.created_at) <= fiveDaysAgo
        ).length;

        const bottlenecks = [
          materialDelayJobs.size > 0 && {
            id: 'materialDelays',
            count: materialDelayJobs.size,
            title: 'Material Delays',
            subtitle: `${materialDelayJobs.size} ${materialDelayJobs.size === 1 ? 'job' : 'jobs'} waiting > 3 days`,
            tone: 'orange',
          },
          inspectionPending > 0 && {
            id: 'inspectionPending',
            count: inspectionPending,
            title: 'Inspection Pending',
            subtitle: `${inspectionPending} ${inspectionPending === 1 ? 'event' : 'events'} past due`,
            tone: 'blue',
          },
          designStuck > 0 && {
            id: 'designApproval',
            count: designStuck,
            title: 'Design Approval',
            subtitle: `${designStuck} ${designStuck === 1 ? 'estimate' : 'estimates'} stuck > 5 days`,
            tone: 'violet',
          },
        ].filter(Boolean);

        // ─── Phase 3: Action Center ─────────────────────────────
        const actions = [];

        // Overdue invoices → top 3
        for (const m of overdueMilestones.slice(0, 3)) {
          const j = jobs.find((x) => x.id === m.job_id);
          actions.push({
            id: `inv-${m.id}`,
            priority: 'high',
            icon: 'invoice',
            title: `Follow up: Invoice overdue${j?.client_name ? ' · ' + j.client_name : ''}`,
            subtitle: m.label || 'Payment milestone past due',
            due: m.due_date,
          });
        }

        // Pending estimates needing review
        for (const e of estimates.filter((es) => es.status === 'sent').slice(0, 2)) {
          const j = jobs.find((x) => x.id === e.job_id);
          actions.push({
            id: `est-${e.id}`,
            priority: 'medium',
            icon: 'estimate',
            title: `Approve estimate${j?.client_name ? ' · ' + j.client_name : ''}`,
            subtitle: j?.service ? `${j.service} project` : 'Estimate sent — awaiting approval',
            due: e.created_at,
          });
        }

        // Jobs over 90% of budget but not yet over (early warning)
        for (const j of jobs) {
          if (j.pipeline_status !== 'in_progress') continue;
          const est = latestEstByJob[j.id];
          const estTotal = Number(est?.total_amount) || 0;
          if (estTotal === 0) continue;
          const spent = expensesByJob.get(j.id) || 0;
          const ratio = spent / estTotal;
          if (ratio >= 0.9 && ratio <= 1.0) {
            actions.push({
              id: `budget-${j.id}`,
              priority: 'high',
              icon: 'budget',
              title: `Review job: ${j.client_name || 'Untitled'} (Budget over ${Math.round(ratio * 100)}%)`,
              subtitle: j.service || 'In progress',
              due: null,
            });
            if (actions.length >= 8) break;
          }
        }

        // Active leads with no touch in > 4 days → call them
        const fourDaysAgo = new Date(Date.now() - 4 * 86400000);
        for (const j of jobs) {
          if (!ACTIVE_PHASES.has(j.pipeline_status)) continue;
          if (j.pipeline_status !== 'new_lead' && j.pipeline_status !== 'estimate_sent') continue;
          if (j.last_touch_at && new Date(j.last_touch_at) >= fourDaysAgo) continue;
          actions.push({
            id: `call-${j.id}`,
            priority: 'medium',
            icon: 'call',
            title: `Call lead: ${j.client_name || 'Untitled'}`,
            subtitle: j.service ? `${j.service} project` : 'Cold for 4+ days',
            due: null,
          });
          if (actions.length >= 10) break;
        }

        if (!active) return;

        setData({
          revenueMTD, revenueLast,
          profitMTD, profitLast,
          costsMTD, costsLast,
          pipelineValue,
          closeRateMTD, closeRateLast,
          activeJobsCount, activeJobsLast,
          totalReceivable,
          inProgressJobs,
          funnel: {
            leadsCount, monthAppts, monthEstSent, monthClosed,
            conversionRate, avgDealSize,
            lastConversion, lastAvgDeal,
          },
          series,
          salesmen,
          marketing, marketingTotal, bestChannel, overallCpl, totalMarketingSpend: totalSpend,
          monthLeads,
          payments: { dueThisWeek, overdue, upcoming30 },
          alerts,
          bottlenecks,
          actions: actions.slice(0, 8),
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

      {/* ══ MOBILE VIEW (md:hidden) ══════════════════════════════════ */}
      <MobileOwnerDashboard
        data={data}
        bounds={bounds}
        revenueDelta={revenueDelta}
        profitDelta={profitDelta}
        closeRateDelta={closeRateDelta}
        lastMonthAbbr={lastMonthAbbr}
        onSelectJob={onSelectJob}
        onNavigate={onNavigate}
        onRefresh={() => setRefreshTick((t) => t + 1)}
      />

      {/* ══ DESKTOP VIEW (hidden md:block) ═══════════════════════════ */}
      <div className="hidden md:block max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-5">

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
            label="Total Receivable"
            value={fmtMoney(data.totalReceivable)}
            delta={null}
            deltaSuffix="outstanding from clients"
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

        {/* ─── Financial Overview + Alerts ──────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden lg:col-span-2">
            <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
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
            <div className="p-5">
              <FinancialChart series={data.series} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <MiniStat label="Total Revenue" value={fmtMoney(data.revenueMTD)} positive />
                <MiniStat label="Total Costs"   value={fmtMoney(data.costsMTD)}   tone="orange" />
                <MiniStat label="Total Profit"  value={fmtMoney(data.profitMTD)}  positive={data.profitMTD >= 0} negative={data.profitMTD < 0} />
                <MiniStat label="Profit Margin" value={
                  data.revenueMTD === 0 ? '—' : `${((data.profitMTD / data.revenueMTD) * 100).toFixed(1)}%`
                } positive />
              </div>
            </div>
          </div>

          <AlertsPanel alerts={data.alerts} />
        </section>

        {/* ─── Active Jobs + Top Bottlenecks ────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden lg:col-span-2">
            <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
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
            <div className="p-5">
            {data.inProgressJobs.length === 0 ? (
              <p className="text-sm text-omega-stone italic py-8 text-center">
                No jobs are currently in progress.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">
                      <th className="text-left py-2 px-2">Job / Client</th>
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-left py-2 px-2 w-[160px]">Progress</th>
                      <th className="text-left py-2 px-2">Status</th>
                      <th className="text-right py-2 px-2">Margin</th>
                      <th className="w-6"></th>
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
                            <p className="font-bold text-omega-charcoal text-sm truncate max-w-[220px]">
                              {j.client_name || 'Untitled'}
                            </p>
                            {j.address && (
                              <p className="text-[11px] text-omega-stone truncate max-w-[220px]">{j.address}</p>
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
                              <span className="text-xs font-bold text-omega-charcoal tabular-nums w-9 text-right">{j.progress}%</span>
                            </div>
                          </td>
                          <td
                            className="py-2.5 px-2"
                            onClick={(e) => { e.stopPropagation(); onSelectJob?.(j.raw, 'financials'); }}
                            title="Open Financials"
                          >
                            <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${bucket.cls} hover:ring-2 hover:ring-omega-orange/30`}>
                              {bucket.label}
                            </span>
                          </td>
                          <td
                            className="py-2.5 px-2 text-right text-sm font-bold text-omega-charcoal tabular-nums hover:text-omega-orange hover:underline"
                            onClick={(e) => { e.stopPropagation(); onSelectJob?.(j.raw, 'financials'); }}
                            title="Open Financials"
                          >
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
            </div>
          </div>

          <BottlenecksPanel bottlenecks={data.bottlenecks} />
        </section>

        {/* ─── Sales Pipeline + Marketing + Salesman ────────────── */}
        {/* 12-col grid. Left: Sales Pipeline (tall). Right column stacks
            Marketing (wide) over Salesman Performance (thin strip), so
            the heights balance instead of leaving a lonely empty card. */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-start">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden lg:col-span-4">
            <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-omega-charcoal">Sales Pipeline</h2>
                <p className="text-xs text-omega-stone mt-0.5">{rangeLabel(bounds.start, bounds.end)} funnel</p>
              </div>
            </div>
            <div className="p-5">
            <Funnel
              steps={[
                { label: 'Leads',          value: data.funnel.leadsCount,   color: '#A78BFA' },
                { label: 'Appointments',   value: data.funnel.monthAppts,   color: '#60A5FA' },
                { label: 'Estimates Sent', value: data.funnel.monthEstSent, color: '#FB923C' },
                { label: 'Closed Won',     value: data.funnel.monthClosed,  color: '#34D399' },
              ]}
            />
            <div className="grid grid-cols-1 gap-2 mt-4 pt-4 border-t border-gray-100">
              <SideStatRow icon={Percent}  label="Conversion Rate" value={fmtPct(data.funnel.conversionRate)} delta={convDelta} deltaSuffix={`vs ${lastMonthAbbr}`} />
              <SideStatRow icon={GitBranch} label="Pipeline Value" value={fmtMoney(data.pipelineValue)} delta={null} deltaSuffix={`${data.funnel.leadsCount} new leads`} />
              <SideStatRow icon={Banknote}  label="Avg Deal Size"  value={fmtMoney(data.funnel.avgDealSize)} delta={avgDealDelta} deltaSuffix={`vs ${lastMonthAbbr}`} />
            </div>
            </div>
          </div>

          <div className="lg:col-span-8 flex flex-col gap-4">
            <MarketingOverview
              marketing={data.marketing}
              total={data.marketingTotal}
              best={data.bestChannel}
              overallCpl={data.overallCpl}
              totalSpend={data.totalMarketingSpend}
              leads={data.monthLeads || []}
              onSelectJob={onSelectJob}
            />
            <SalesmanPerformance salesmen={data.salesmen} />
          </div>
        </section>

        {/* ─── Lead Origins Heat Map ─────────────────────────────── */}
        <LeadsHeatMap />

        {/* ─── Cash & Payments ──────────────────────────────────── */}
        <section>
          <CashAndPayments payments={data.payments} totalReceivable={data.totalReceivable} />
        </section>

        <p className="text-[11px] text-omega-stone text-center pt-2">
          All data is updated as of {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ─── Mobile Owner Dashboard ───────────────────────────────────────
function MobileOwnerDashboard({ data, bounds, revenueDelta, profitDelta, closeRateDelta, lastMonthAbbr, onSelectJob, onNavigate, onRefresh }) {
  const kpis = [
    {
      label: 'Revenue',
      value: fmtMoneyCompact(data.revenueMTD),
      accent: 'border-orange-400',
      valueColor: 'text-omega-charcoal',
      delta: revenueDelta,
    },
    {
      label: 'Profit',
      value: fmtMoneyCompact(data.profitMTD),
      accent: data.profitMTD < 0 ? 'border-red-500' : 'border-emerald-400',
      valueColor: data.profitMTD < 0 ? 'text-red-600' : 'text-emerald-700',
      delta: profitDelta,
    },
    {
      label: 'Jobs',
      value: String(data.activeJobsCount),
      accent: 'border-blue-400',
      valueColor: 'text-omega-charcoal',
      delta: null,
    },
    {
      label: 'Pipeline',
      value: fmtMoneyCompact(data.pipelineValue),
      accent: 'border-violet-400',
      valueColor: 'text-omega-charcoal',
      delta: null,
    },
    {
      label: 'Closing',
      value: fmtPct(data.closeRateMTD),
      accent: 'border-amber-400',
      valueColor: 'text-omega-charcoal',
      delta: closeRateDelta,
    },
    {
      label: 'Receive',
      value: fmtMoneyCompact(data.totalReceivable),
      accent: 'border-slate-400',
      valueColor: 'text-omega-charcoal',
      delta: null,
    },
  ];

  return (
    <div className="md:hidden flex flex-col min-h-full">

      {/* ── Light header (matches the new mobile aesthetic) ─────── */}
      <div className="bg-white border-b border-gray-200 px-4 pt-5 pb-4">
        {/* Brand row — logo so the dashboard is clearly identified as Omega */}
        <div className="flex items-center justify-between mb-4">
          <Logo size="sm" />
          <button
            onClick={onRefresh}
            className="p-2 rounded-xl bg-omega-pale text-omega-orange hover:bg-omega-orange/10 transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
        <div className="mb-4">
          <p className="text-omega-stone text-[11px] font-bold uppercase tracking-widest leading-none">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
          <h1 className="text-xl font-black text-omega-charcoal mt-1">Dashboard 📊</h1>
        </div>

        {/* 6 KPIs — one row; defined cards so they read on the light header */}
        <div className="grid grid-cols-3 gap-1.5">
          {kpis.map((k) => (
            <div
              key={k.label}
              className={`min-w-0 bg-white rounded-xl border border-gray-100 shadow-sm border-t-[3px] ${k.accent} flex flex-col items-center justify-center text-center py-2.5 px-0.5`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone leading-none">{k.label}</p>
              <p className={`text-sm font-black tabular-nums leading-none mt-1 ${k.valueColor}`}>{k.value}</p>
              {k.delta && Number.isFinite(k.delta?.raw) && (
                <p className={`text-[9px] font-bold leading-none mt-0.5 ${k.delta.positive ? 'text-emerald-500' : 'text-red-400'}`}>
                  {k.delta.positive ? '↑' : '↓'}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Scrollable content ────────────────────────────────── */}
      <div className="flex-1 bg-omega-cloud px-4 py-4 space-y-3">

        {/* Alerts */}
        {data.alerts.length > 0 && (
          <div className="space-y-2">
            {data.alerts.map((a) => {
              const toneMap = {
                red:   { bg: 'bg-red-50',    border: 'border-red-200',   text: 'text-red-700',   badge: 'bg-red-600' },
                amber: { bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-800', badge: 'bg-amber-500' },
                blue:  { bg: 'bg-blue-50',   border: 'border-blue-200',  text: 'text-blue-700',  badge: 'bg-blue-600' },
              };
              const t = toneMap[a.tone] || toneMap.red;
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${t.bg} ${t.border}`}
                >
                  <span className={`w-8 h-8 rounded-lg ${t.badge} text-white flex items-center justify-center font-black text-sm flex-shrink-0`}>
                    {a.count}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${t.text}`}>{a.title}</p>
                    <p className="text-[11px] text-omega-stone truncate">{a.subtitle}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data.alerts.length === 0 && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-emerald-700">All clear — no alerts</p>
          </div>
        )}

        {/* Active Jobs */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-omega-charcoal flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-omega-orange" /> Active Jobs
            </h2>
            <span className="text-xs font-bold text-omega-stone">{data.activeJobsCount} total</span>
          </div>
          {data.inProgressJobs.length === 0 ? (
            <p className="text-xs text-omega-stone text-center py-6">No jobs in progress.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.inProgressJobs.slice(0, 5).map((j) => {
                const bucket = marginBucket(j.margin);
                return (
                  <li
                    key={j.id}
                    onClick={() => onSelectJob?.(j.raw)}
                    className="flex items-center gap-3 px-4 py-3 active:bg-omega-cloud cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-omega-charcoal truncate">{j.client_name || 'Untitled'}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden max-w-[100px]">
                          <div className="h-full bg-omega-orange" style={{ width: `${j.progress}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-omega-stone tabular-nums">{j.progress}%</span>
                      </div>
                    </div>
                    <span
                      onClick={(e) => { e.stopPropagation(); onSelectJob?.(j.raw, 'financials'); }}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex-shrink-0 ${bucket.cls}`}
                    >
                      {bucket.label}
                    </span>
                    <ArrowRight className="w-4 h-4 text-omega-stone flex-shrink-0" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

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

// ─── Side stat row — used inside the narrow Sales Pipeline col ──
function SideStatRow({ icon: Icon, label, value, delta, deltaSuffix }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-omega-orange flex-shrink-0" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-omega-stone truncate">{label}</span>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-black text-omega-charcoal tabular-nums">{value}</p>
        {(delta || deltaSuffix) && (
          <p className={`text-[10px] font-semibold ${
            delta?.positive === false ? 'text-red-600' : delta ? 'text-emerald-600' : 'text-omega-stone'
          }`}>
            {delta?.text}{delta && deltaSuffix ? ' ' : ''}{deltaSuffix}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Alerts panel ────────────────────────────────────────────────
function AlertsPanel({ alerts }) {
  const tones = {
    red:    { iconBg: 'bg-red-100',     iconColor: 'text-red-600' },
    amber:  { iconBg: 'bg-amber-100',   iconColor: 'text-amber-600' },
    blue:   { iconBg: 'bg-blue-100',    iconColor: 'text-blue-600' },
    orange: { iconBg: 'bg-orange-100',  iconColor: 'text-orange-600' },
    violet: { iconBg: 'bg-violet-100',  iconColor: 'text-violet-600' },
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-base font-bold text-omega-charcoal">Alerts &amp; Notifications</h2>
        <span className="text-[11px] font-bold uppercase tracking-wider text-omega-stone">{alerts.length}</span>
      </div>
      <div className="p-5">
      {alerts.length === 0 ? (
        <p className="text-sm text-omega-stone italic py-6 text-center">All clear. Nothing needs your attention.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {alerts.map((a) => {
            const t = tones[a.tone] || tones.red;
            return (
              <li key={a.id} className="py-2.5 flex items-start gap-3">
                <span className={`w-9 h-9 rounded-lg ${t.iconBg} ${t.iconColor} inline-flex items-center justify-center flex-shrink-0 font-black text-sm`}>
                  {a.count}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-omega-charcoal truncate">{a.title}</p>
                  <p className="text-[11px] text-omega-stone truncate">{a.subtitle}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-omega-stone flex-shrink-0 mt-1" />
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </div>
  );
}

// ─── Bottlenecks panel ───────────────────────────────────────────
function BottlenecksPanel({ bottlenecks }) {
  const tones = {
    red:    { iconBg: 'bg-red-100',     iconColor: 'text-red-600' },
    amber:  { iconBg: 'bg-amber-100',   iconColor: 'text-amber-600' },
    blue:   { iconBg: 'bg-blue-100',    iconColor: 'text-blue-600' },
    orange: { iconBg: 'bg-orange-100',  iconColor: 'text-orange-600' },
    violet: { iconBg: 'bg-violet-100',  iconColor: 'text-violet-600' },
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-base font-bold text-omega-charcoal">Top Bottlenecks</h2>
      </div>
      <div className="p-5">
      {bottlenecks.length === 0 ? (
        <p className="text-sm text-omega-stone italic py-6 text-center">No bottlenecks detected. 🎉</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {bottlenecks.map((b) => {
            const t = tones[b.tone] || tones.amber;
            return (
              <li key={b.id} className="py-2.5 flex items-center gap-3">
                <span className={`w-9 h-9 rounded-lg ${t.iconBg} ${t.iconColor} inline-flex items-center justify-center flex-shrink-0`}>
                  <AlertOctagon className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-omega-charcoal truncate">{b.title}</p>
                  <p className="text-[11px] text-omega-stone truncate">{b.subtitle}</p>
                </div>
                <span className="text-base font-black text-omega-charcoal tabular-nums">{b.count}</span>
              </li>
            );
          })}
        </ul>
      )}
      </div>
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
const SALESMAN_MEDALS = ['🥇', '🥈', '🥉'];

function SalesmanPerformance({ salesmen }) {
  const real = (salesmen || []).filter((s) => s.name !== 'Unassigned');
  const unassigned = (salesmen || []).find((s) => s.name === 'Unassigned');
  const maxRev = Math.max(1, ...real.map((s) => s.revenue));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="px-5 py-3 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-base font-bold text-omega-charcoal">Salesman Performance</h2>
        {unassigned?.count > 0 && (
          <span className="text-[11px] text-omega-stone">{unassigned.count} unassigned</span>
        )}
      </div>

      {real.length === 0 ? (
        // Sparse / empty state — kept short so the card reads as a strip,
        // not an abandoned panel.
        <div className="px-5 py-4 flex items-center gap-2 text-sm text-omega-stone">
          <Briefcase className="w-4 h-4 flex-shrink-0 text-gray-400" />
          <span>
            No salesperson tagged on closed deals this period
            {unassigned?.count > 0 ? ` — ${unassigned.count} closed without an owner.` : '.'}
          </span>
        </div>
      ) : (
        // Horizontal strip: one compact card per salesperson, wrapping.
        <div className="p-4 flex flex-wrap gap-3">
          {real.map((s, i) => {
            const barPct = s.revenue > 0 ? Math.round((s.revenue / maxRev) * 100) : 0;
            return (
              <div key={s.name} className="flex-1 min-w-[200px] rounded-xl bg-omega-cloud p-3">
                <div className="flex items-center gap-2 mb-2 min-w-0">
                  <span className="text-base leading-none flex-shrink-0">{SALESMAN_MEDALS[i] || '·'}</span>
                  <p className="text-sm font-bold text-omega-charcoal truncate">{s.name}</p>
                </div>
                <div className="flex items-center gap-4 mb-2">
                  <div>
                    <p className="text-[9px] font-bold text-omega-stone uppercase tracking-wider leading-none mb-0.5">Closed</p>
                    <p className="text-sm font-black text-omega-charcoal tabular-nums">{s.count}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-omega-stone uppercase tracking-wider leading-none mb-0.5">Revenue</p>
                    <p className="text-sm font-black text-omega-charcoal tabular-nums">{fmtMoney(s.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-omega-stone uppercase tracking-wider leading-none mb-0.5">Avg Deal</p>
                    <p className="text-sm font-black text-omega-charcoal tabular-nums">{fmtMoney(s.avg)}</p>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full rounded-full bg-omega-orange transition-all" style={{ width: `${barPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Marketing Overview — donut by lead source ───────────────────
const MARKETING_COLORS = ['#3B82F6', '#F97316', '#22C55E', '#A78BFA', '#F43F5E', '#FACC15', '#06B6D4', '#9CA3AF'];

// Status badge config for the leads drill-down panel
const LEAD_STATUS_META = {
  new_lead:             { label: 'New Lead',       cls: 'bg-gray-100 text-gray-600' },
  estimate_sent:        { label: 'Estimate Sent',  cls: 'bg-violet-100 text-violet-700' },
  estimate_negotiating: { label: 'Negotiating',    cls: 'bg-amber-100 text-amber-700' },
  estimate_approved:    { label: 'Approved',       cls: 'bg-emerald-100 text-emerald-700' },
  contract_sent:        { label: 'Contract Sent',  cls: 'bg-blue-100 text-blue-700' },
  contract_signed:      { label: 'Won',            cls: 'bg-emerald-100 text-emerald-800' },
  in_progress:          { label: 'In Progress',    cls: 'bg-emerald-100 text-emerald-800' },
  completed:            { label: 'Completed',      cls: 'bg-green-100 text-green-800' },
  estimate_rejected:    { label: 'Rejected',       cls: 'bg-red-100 text-red-700' },
};

function MarketingOverview({ marketing, total, best, overallCpl, totalSpend, leads = [], onSelectJob }) {
  const [selectedSource, setSelectedSource] = useState(null);

  // Leads for the currently-selected source
  const drillLeads = selectedSource
    ? leads.filter((j) => (j.lead_source || 'Other') === selectedSource)
    : [];

  // Color index for the selected source
  const selectedIdx = selectedSource
    ? marketing.findIndex((m) => m.source === selectedSource)
    : -1;
  const selectedColor = selectedIdx >= 0
    ? MARKETING_COLORS[selectedIdx % MARKETING_COLORS.length]
    : '#3B82F6';

  // Donut math.
  const size = 140;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <>
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200">
        <h2 className="text-base font-bold text-omega-charcoal">Marketing Overview</h2>
      </div>
      <div className="p-5">
      {marketing.length === 0 ? (
        <p className="text-sm text-omega-stone italic py-6 text-center">No leads logged this month.</p>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-3">
            {/* Donut — each segment is clickable */}
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="cursor-pointer flex-shrink-0">
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
              {marketing.map((m, i) => {
                const len = (m.pct / 100) * c;
                const seg = (
                  <circle
                    key={m.source}
                    cx={size / 2} cy={size / 2} r={r}
                    fill="none"
                    stroke={MARKETING_COLORS[i % MARKETING_COLORS.length]}
                    strokeWidth={stroke + (selectedSource === m.source ? 4 : 0)}
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={-offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    style={{ cursor: 'pointer', opacity: selectedSource && selectedSource !== m.source ? 0.4 : 1, transition: 'opacity 0.15s, stroke-width 0.15s' }}
                    onClick={() => setSelectedSource(selectedSource === m.source ? null : m.source)}
                  />
                );
                offset += len;
                return seg;
              })}
              <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize="10" fill="#9ca3af" fontWeight="700">Total Leads</text>
              <text x={size / 2} y={size / 2 + 18} textAnchor="middle" fontSize="22" fill="#1f2937" fontWeight="900">{total}</text>
            </svg>
            {/* Source legend rows — each row is clickable */}
            <ul className="flex-1 min-w-0 space-y-1">
              {marketing.slice(0, 6).map((m, i) => (
                <li
                  key={m.source}
                  onClick={() => setSelectedSource(selectedSource === m.source ? null : m.source)}
                  className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1 cursor-pointer transition-colors group
                    ${selectedSource === m.source ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: MARKETING_COLORS[i % MARKETING_COLORS.length] }} />
                  <span className="flex-1 truncate text-omega-charcoal font-semibold">{m.source}</span>
                  <span className="text-omega-stone tabular-nums whitespace-nowrap">
                    {m.count} {m.cpl != null && (
                      <span className="text-[10px] text-omega-orange font-bold">· {fmtMoney(m.cpl)}/lead</span>
                    )}
                  </span>
                  <ChevronRight className="w-3 h-3 text-omega-fog opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-gray-100 pt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">Cost per Lead</p>
              <p className="text-sm font-bold text-omega-charcoal tabular-nums">
                {overallCpl == null ? '—' : fmtMoney(overallCpl)}
                {totalSpend > 0 && (
                  <span className="text-[10px] text-omega-stone font-normal ml-1">
                    · {fmtMoney(totalSpend)} spent
                  </span>
                )}
              </p>
            </div>
            {best && (
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-omega-stone">Best Channel</p>
                <p className="text-sm font-bold text-omega-charcoal">
                  {best.source}
                  {best.cpl != null && (
                    <span className="text-omega-stone font-normal ml-1">
                      ({fmtMoney(best.cpl)}/lead)
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </>
      )}
      </div>
    </div>

    {/* ── Leads drill-down drawer ──────────────────────────────────── */}
    {selectedSource && (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={() => setSelectedSource(null)}
        />
        {/* Panel */}
        <div className="fixed top-0 right-0 h-full w-full max-w-[400px] bg-white shadow-2xl z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 bg-gray-50">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: selectedColor }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-omega-stone uppercase tracking-wider">Lead Source</p>
              <h3 className="text-base font-bold text-omega-charcoal truncate">{selectedSource}</h3>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-bold text-white" style={{ background: selectedColor }}>
              {drillLeads.length} leads
            </span>
            <button
              onClick={() => setSelectedSource(null)}
              className="p-1.5 rounded-lg text-omega-stone hover:bg-gray-200 transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {drillLeads.length === 0 ? (
              <p className="text-sm text-omega-stone italic text-center py-10">No leads found.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {drillLeads.map((j) => {
                  const meta = LEAD_STATUS_META[j.pipeline_status] || { label: j.pipeline_status, cls: 'bg-gray-100 text-gray-600' };
                  const dateStr = (j.lead_date || j.created_at || '').slice(0, 10);
                  const phone = (j.client_phone || '').replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
                  return (
                    <li
                      key={j.id}
                      onClick={() => { onSelectJob?.(j); setSelectedSource(null); }}
                      className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors group"
                    >
                      {/* Color dot */}
                      <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: selectedColor }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-omega-charcoal truncate group-hover:text-omega-orange transition-colors">
                          {j.client_name || '—'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {j.service && (
                            <span className="text-[11px] text-omega-stone truncate">{j.service}</span>
                          )}
                          {phone && (
                            <span className="flex items-center gap-0.5 text-[11px] text-omega-stone">
                              <Phone className="w-2.5 h-2.5" />{phone}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-omega-fog mt-0.5">{dateStr}</p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </>
    )}
    </>
  );
}

// ─── Cash & Payments block ───────────────────────────────────────
function CashAndPayments({ payments, totalReceivable }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="px-5 py-3.5 bg-gray-100 border-b border-gray-200">
        <h2 className="text-base font-bold text-omega-charcoal">Cash & Payments</h2>
      </div>
      <div className="p-5">
      <ul className="space-y-2">
        <PayRow icon={Wallet}    iconColor="text-violet-600" label="Total Receivable"
          value={fmtMoney(totalReceivable)}
          hint="outstanding from all clients"
        />
        <PayRow icon={Banknote}  iconColor="text-amber-600" label="Payments Due This Week"
          value={fmtMoney(payments.dueThisWeek)} valueClass="text-amber-700"
        />
        <PayRow icon={DollarSign} iconColor="text-red-600"  label="Overdue Payments"
          value={fmtMoney(payments.overdue)} valueClass="text-red-700"
        />
        <PayRow icon={TrendingUp} iconColor="text-emerald-600" label="Upcoming (Next 30 Days)"
          value={fmtMoney(payments.upcoming30)} valueClass="text-emerald-700"
        />
      </ul>
      </div>
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

// ─── Funnel — minimal rows matching the dashboard's typography ───
// Each step: colored dot · gray label · proportional bar · charcoal number
// Conversion % shown as a small connector between steps.
function Funnel({ steps }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const barPct   = max > 0 ? Math.max(4, Math.round((s.value / max) * 100)) : 4;
        const fromPrev = i > 0 && steps[i - 1].value > 0
          ? Math.round((s.value / steps[i - 1].value) * 100)
          : null;
        return (
          <div key={s.label}>
            {/* ── Conversion connector ── */}
            {fromPrev !== null && (
              <div className="flex items-center gap-1.5 pl-3 py-0.5">
                <div className="w-px h-3 bg-gray-200 ml-[3px]" />
                <span className="text-[10px] text-omega-stone">↓ {fromPrev}%</span>
              </div>
            )}

            {/* ── Step row ── */}
            <div className="flex items-center gap-2.5 bg-omega-cloud rounded-xl px-3 py-2.5">
              {/* Stage color dot */}
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: s.color }}
              />

              {/* Label */}
              <p className="text-[11px] font-bold uppercase tracking-wider text-omega-stone flex-shrink-0">
                {s.label}
              </p>

              {/* Proportional bar */}
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden mx-1">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${barPct}%`, background: s.color }}
                />
              </div>

              {/* Count */}
              <span className="text-sm font-black text-omega-charcoal tabular-nums flex-shrink-0 w-8 text-right">
                {s.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
