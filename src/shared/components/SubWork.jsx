import { useEffect, useState } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';
import { nyDateKey } from '../lib/stageAge';
import { subInlineLabel } from '../lib/subcontractor';
import { subWorkForJob, groupBySub, workStatus, loadSubWorkHistory } from '../lib/subWork';

// Read-only views of the subs planned on the Phases tab — so the office can
// answer "did X do the work at this client?" without opening every phase.

const STATUS_CHIP = {
  done:      { label: 'Done',      cls: 'bg-green-100 text-green-700' },
  on_site:   { label: 'On site',   cls: 'bg-orange-100 text-orange-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-700' },
};

// 'YYYY-MM-DD' → "Oct 3, 2026" (read as a calendar day, not UTC midnight).
function day(key) {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusChip({ row, todayKey }) {
  const st = STATUS_CHIP[workStatus(row, todayKey)];
  if (!st) return <span className="text-xs text-omega-stone">No dates</span>;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${st.cls}`}>{st.label}</span>;
}

function WorkRow({ row, todayKey, title }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-omega-charcoal truncate">{title}</p>
        <p className="text-xs text-omega-stone">{day(row.start_date)} → {day(row.end_date)}</p>
      </div>
      <StatusChip row={row} todayKey={todayKey} />
    </div>
  );
}

// Job card → Subcontractors tab: each sub with the phases they work on.
export function JobSubWork({ job, subs }) {
  const groups = groupBySub(subWorkForJob(job));
  const todayKey = nyDateKey(Date.now());
  const subsById = new Map((subs || []).map((s) => [s.id, s]));
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-omega-orange" /> Work on this job
        </h2>
        <p className="text-xs text-omega-stone mt-0.5">From the Phases tab — who does each phase, and when.</p>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 sm:px-6 py-5 text-sm text-omega-stone">No subs planned on the Phases tab yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {groups.map((g) => {
            const sub = g.sub_id ? subsById.get(g.sub_id) : null;
            return (
              <div key={g.sub_id || g.sub_name} className="px-4 sm:px-6 py-3">
                <p className="text-sm font-bold text-omega-charcoal">
                  {sub ? subInlineLabel(sub) : (g.sub_name || 'Unknown sub')}
                  {sub?.trade && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-omega-stone">{sub.trade}</span>}
                </p>
                <div className="divide-y divide-gray-50">
                  {g.rows.map((r) => <WorkRow key={r.key} row={r} todayKey={todayKey} title={r.phase} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Sub profile: every job this sub is planned on, most recent first.
export function SubWorkHistory({ sub }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setJobs(null);
    loadSubWorkHistory(sub)
      .then((list) => { if (alive) setJobs(list); })
      .catch((e) => { if (alive) { setError(e.message || 'Could not load jobs'); setJobs([]); } });
    return () => { alive = false; };
  }, [sub?.id]);
  const todayKey = nyDateKey(Date.now());

  return (
    <div>
      <p className="text-[11px] font-semibold text-omega-stone uppercase tracking-wider mb-2">
        Jobs (from Phases){jobs ? ` · ${jobs.length}` : ''}
      </p>
      {jobs === null && (
        <p className="text-xs text-omega-stone inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {jobs && !error && jobs.length === 0 && (
        <p className="text-xs text-omega-stone italic">Not planned on any job's Phases tab yet.</p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-100">
          {jobs.map(({ job, rows }) => (
            <li key={job.id} className="px-3 py-2">
              <a href={`/jobs/${job.id}?tab=phases`} className="text-xs font-bold text-omega-charcoal hover:text-omega-orange">
                {job.client_name || 'Unknown client'}
                {(job.address || job.city) && <span className="font-normal text-omega-stone"> — {job.address || job.city}</span>}
              </a>
              <div className="divide-y divide-gray-50">
                {rows.map((r) => <WorkRow key={r.key} row={r} todayKey={todayKey} title={r.phase} />)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
