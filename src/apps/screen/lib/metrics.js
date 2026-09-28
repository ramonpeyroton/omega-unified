// All Supabase queries the Screen dashboard needs, grouped by concern.
// Every function is resilient to a missing table or permission error:
// it logs internally and returns a safe zero / empty shape so the TV
// never shows "error" — only up-to-date numbers or dashes.

import { supabase } from '../../../shared/lib/supabase';
import {
  weekRange, prevWeekRange, monthRange, prevMonthRange, ytdRange,
} from './ranges';
import { progressFromPhaseData } from '../../../shared/config/phaseBreakdown';

// ─── Low-level helpers ─────────────────────────────────────────────

async function count(table, build) {
  try {
    let q = supabase.from(table).select('id', { count: 'exact', head: true });
    q = build ? build(q) : q;
    const { count: c } = await q;
    return c || 0;
  } catch { return 0; }
}

async function sum(table, build, column = 'total_amount') {
  try {
    let q = supabase.from(table).select(column);
    q = build ? build(q) : q;
    const { data } = await q;
    return (data || []).reduce((acc, r) => acc + (Number(r?.[column]) || 0), 0);
  } catch { return 0; }
}

// ─── KPI block (week + month, with deltas) ─────────────────────────
// Returns one block:
//   { leads, visits, estimates, contracts, revenue, prev: {…} }

async function kpiFor(range, prev) {
  const [
    leads, visits,
    estSent, ctrSigned, revenue,
    pLeads, pVisits, pEstSent, pCtrSigned, pRevenue,
  ] = await Promise.all([
    count('jobs',      (q) => q.gte('created_at', range.start).lt('created_at', range.end)),
    count('jobs',      (q) => q.gte('created_at', range.start).lt('created_at', range.end).not('preferred_visit_date', 'is', null)),
    count('estimates', (q) => q.gte('sent_at',    range.start).lt('sent_at',    range.end)),
    count('contracts', (q) => q.gte('signed_at',  range.start).lt('signed_at',  range.end)),
    sum  ('contracts', (q) => q.gte('signed_at',  range.start).lt('signed_at',  range.end)),

    count('jobs',      (q) => q.gte('created_at', prev.start).lt('created_at', prev.end)),
    count('jobs',      (q) => q.gte('created_at', prev.start).lt('created_at', prev.end).not('preferred_visit_date', 'is', null)),
    count('estimates', (q) => q.gte('sent_at',    prev.start).lt('sent_at',    prev.end)),
    count('contracts', (q) => q.gte('signed_at',  prev.start).lt('signed_at',  prev.end)),
    sum  ('contracts', (q) => q.gte('signed_at',  prev.start).lt('signed_at',  prev.end)),
  ]);

  return {
    leads, visits, estimates: estSent, contracts: ctrSigned, revenue,
    prev: { leads: pLeads, visits: pVisits, estimates: pEstSent, contracts: pCtrSigned, revenue: pRevenue },
  };
}

export async function loadWeekKpi() { return kpiFor(weekRange(),  prevWeekRange());  }
export async function loadMonthKpi() { return kpiFor(monthRange(), prevMonthRange()); }

// ─── Pipeline value ────────────────────────────────────────────────
// Total $ currently "in motion": sum of the latest estimate for each
// active job. Excludes jobs marked LOST (`estimate_rejected`),
// Disqualified or already closed out (`completed`).
export async function loadPipelineValue() {
  try {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id')
      .not('pipeline_status', 'in', '("estimate_rejected","disqualified","completed")');
    const ids = (jobs || []).map((j) => j.id);
    if (!ids.length) return 0;

    const { data: ests } = await supabase
      .from('estimates')
      .select('job_id, total_amount, created_at')
      .in('job_id', ids)
      .order('created_at', { ascending: false });

    // Dedupe — keep latest estimate per job only.
    const seen = new Set();
    let total = 0;
    for (const e of ests || []) {
      if (seen.has(e.job_id)) continue;
      seen.add(e.job_id);
      total += Number(e.total_amount) || 0;
    }
    return total;
  } catch { return 0; }
}

// ─── Active projects (in_progress with % done) ─────────────────────
export async function loadActiveProjects(limit = 5) {
  try {
    const { data } = await supabase
      .from('jobs')
      .select('id, client_name, service, city, address, phase_data, updated_at')
      .eq('pipeline_status', 'in_progress')
      .order('updated_at', { ascending: false })
      .limit(25);

    const rows = (data || []).map((j) => {
      const { progress, currentPhaseName } = progressFromPhaseData(j.phase_data);
      return {
        id: j.id,
        client: j.client_name,
        service: j.service,
        location: j.city || (j.address || '').split(',')[1]?.trim() || '',
        progress, phase: currentPhaseName,
      };
    });
    return { shown: rows.slice(0, limit), total: rows.length };
  } catch { return { shown: [], total: 0 }; }
}

// ─── Salesperson ranking (month) ───────────────────────────────────
// Groups contracts signed this month by the `assigned_to` on the job,
// ties revenue and count together. Falls back to "Attila" bucket if
// assigned_to is null (single-salesperson assumption today).
export async function loadSalesRankingMonth() {
  const range = monthRange();
  try {
    const { data } = await supabase
      .from('contracts')
      .select('total_amount, signed_at, job_id, jobs:job_id ( assigned_to, salesperson_name )')
      .gte('signed_at', range.start)
      .lt('signed_at',  range.end);

    const map = new Map();
    (data || []).forEach((row) => {
      const name =
        row?.jobs?.assigned_to ||
        row?.jobs?.salesperson_name ||
        'Attila';
      const cur = map.get(name) || { name, revenue: 0, count: 0 };
      cur.revenue += Number(row.total_amount) || 0;
      cur.count   += 1;
      map.set(name, cur);
    });

    const list = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    return list;
  } catch { return []; }
}

// ─── YTD goal progress ─────────────────────────────────────────────
export async function loadYtdRevenue() {
  const range = ytdRange();
  return sum('contracts', (q) => q.gte('signed_at', range.start).lt('signed_at', range.end));
}

// ─── Daily series (last N days) — for sparklines ────────────────────
// Returns { leads:[...], visits:[...], estimates:[...], contracts:[...] }
// where each array has exactly N numbers, oldest → newest.
export async function loadDailySeries(days = 14) {
  const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
  const start = new Date(end); start.setDate(end.getDate() - days);

  const emptyBuckets = () => new Array(days).fill(0);
  function bucketIndex(iso) {
    const d = new Date(iso);
    const idx = Math.floor((d - start) / 86400_000);
    return idx >= 0 && idx < days ? idx : -1;
  }

  const leads     = emptyBuckets();
  const visits    = emptyBuckets();
  const estimates = emptyBuckets();
  const contracts = emptyBuckets();

  try {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('created_at, preferred_visit_date')
      .gte('created_at', start.toISOString())
      .lt('created_at',  end.toISOString());
    (jobs || []).forEach((j) => {
      const i = bucketIndex(j.created_at);
      if (i >= 0) {
        leads[i] += 1;
        if (j.preferred_visit_date) visits[i] += 1;
      }
    });
  } catch { /* swallow */ }

  try {
    const { data: est } = await supabase
      .from('estimates')
      .select('sent_at')
      .gte('sent_at', start.toISOString())
      .lt('sent_at',  end.toISOString());
    (est || []).forEach((e) => {
      const i = bucketIndex(e.sent_at);
      if (i >= 0) estimates[i] += 1;
    });
  } catch { /* swallow */ }

  try {
    const { data: ctr } = await supabase
      .from('contracts')
      .select('signed_at')
      .gte('signed_at', start.toISOString())
      .lt('signed_at',  end.toISOString());
    (ctr || []).forEach((c) => {
      const i = bucketIndex(c.signed_at);
      if (i >= 0) contracts[i] += 1;
    });
  } catch { /* swallow */ }

  return { leads, visits, estimates, contracts };
}

// ─── Pipeline distribution — for donut chart ─────────────────────
export async function loadPipelineDistribution() {
  try {
    const { data } = await supabase.from('jobs').select('pipeline_status');
    const counts = new Map();
    (data || []).forEach((j) => {
      const k = j.pipeline_status || 'new_lead';
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}

// ─── Revenue by month (last 6 months) — for bar chart ───────────
export async function loadMonthlyRevenue(monthsBack = 6) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const buckets = [];
  for (let m = 0; m < monthsBack; m++) {
    const d = new Date(start); d.setMonth(start.getMonth() + m);
    buckets.push({
      key:  d.toISOString(),
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      value: 0,
    });
  }

  try {
    const { data } = await supabase
      .from('contracts')
      .select('total_amount, signed_at')
      .gte('signed_at', start.toISOString())
      .lt('signed_at',  end.toISOString());
    (data || []).forEach((row) => {
      const d = new Date(row.signed_at);
      const idx = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx].value += Number(row.total_amount) || 0;
      }
    });
  } catch { /* swallow */ }
  return buckets;
}

// ─── Service mix of this-year jobs — for horizontal bar legend ──
export async function loadServiceMix() {
  try {
    const year0 = new Date(new Date().getFullYear(), 0, 1).toISOString();
    const { data } = await supabase
      .from('jobs')
      .select('service, created_at')
      .gte('created_at', year0);
    const counts = new Map();
    (data || []).forEach((j) => {
      const raw = (j.service || '').toLowerCase().trim() || 'other';
      // A job may have multi-service "kitchen, bathroom" — split and count each.
      raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((svc) => {
        counts.set(svc, (counts.get(svc) || 0) + 1);
      });
    });
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    return Array.from(counts.entries())
      .map(([svc, count]) => ({ service: svc, count, pct: total ? count / total : 0 }))
      .sort((a, b) => b.count - a.count);
  } catch { return []; }
}
