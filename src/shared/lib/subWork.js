// Who worked where, read from the Phases tab (jobs.phase_data). Nobody types
// anything twice: the subs + dates planned on each phase are the record.
//   * subWorkForJob(job)       → the job card's Subcontractors tab
//   * loadSubWorkHistory(sub)  → a sub's profile: every job they were on

import { supabase } from './supabase';
import { planRows } from './phasePlan';

// 'done' | 'on_site' | 'scheduled' | null — same rule as the Phases tab.
export function workStatus(row, todayKey) {
  if (!row?.start_date || !row?.end_date) return null;
  if (row.end_date < todayKey) return 'done';
  if (row.start_date <= todayKey) return 'on_site';
  return 'scheduled';
}

// One row per (phase, sub) planned on the job.
export function subWorkForJob(job) {
  const phases = Array.isArray(job?.phase_data?.phases) ? job.phase_data.phases : [];
  const out = [];
  phases.forEach((ph, idx) => {
    planRows(ph).forEach((r, ri) => {
      if (!r.sub_id && !r.sub_name) return;
      out.push({
        key: `${ph.id || idx}_${r.id || ri}`,
        phase: ph.name || `Phase ${idx + 1}`,
        sub_id: r.sub_id || null,
        sub_name: r.sub_name || null,
        start_date: r.start_date || null,
        end_date: r.end_date || null,
      });
    });
  });
  return out;
}

// Rows grouped by sub, in the order they first show up on the job.
export function groupBySub(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    const k = r.sub_id || `name:${(r.sub_name || '').toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, { sub_id: r.sub_id, sub_name: r.sub_name, rows: [] });
    groups.get(k).rows.push(r);
  });
  return [...groups.values()];
}

// Every job where this sub is planned on a phase, most recent work first.
export async function loadSubWorkHistory(sub) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, client_name, address, city, service, pipeline_status, phase_data')
    .not('phase_data', 'is', null);
  if (error) throw error;
  const name = (sub?.name || '').trim().toLowerCase();
  const isThisSub = (r) => (r.sub_id ? r.sub_id === sub.id : !!name && (r.sub_name || '').trim().toLowerCase() === name);
  const jobs = (data || [])
    .map((job) => ({ job, rows: subWorkForJob(job).filter(isThisSub) }))
    .filter((j) => j.rows.length > 0);
  const latest = (j) => j.rows.map((r) => r.start_date || '').sort().pop() || '';
  return jobs.sort((a, b) => latest(b).localeCompare(latest(a)));
}
