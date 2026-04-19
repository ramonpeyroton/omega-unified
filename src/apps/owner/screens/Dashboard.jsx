import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, MapPin, TrendingUp, Award } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { progressFromPhaseData, normalizeService, SERVICE_LABELS } from '../../../shared/config/phaseBreakdown';
import PaymentAging from '../../../shared/components/PaymentAging';
import JobFullView from '../../../shared/components/JobFullView';

// Owner Dashboard — focuses only on jobs that are currently in progress.
// Pipeline-wide management happens on the dedicated Pipeline screen.

function ProgressBar({ progress }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#2A2A2A' }}>
        <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: '#D4AF37' }} />
      </div>
      <span className="text-xs font-semibold text-omega-charcoal w-9 text-right">{progress}%</span>
    </div>
  );
}

function JobCard({ job, onSelectJob }) {
  const { progress, currentPhaseName } = useMemo(() => progressFromPhaseData(job.phase_data), [job.phase_data]);
  const address = [job.address, job.city].filter(Boolean).join(', ');

  return (
    <button
      onClick={() => onSelectJob?.(job)}
      className="text-left bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md hover:border-omega-orange/40 transition-all"
    >
      <p className="font-bold text-omega-charcoal truncate">{job.client_name || job.name || 'Untitled'}</p>
      {address && (
        <p className="text-xs text-omega-stone truncate mt-0.5 inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> {address}
        </p>
      )}

      {job.service && (
        <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold text-[10px] uppercase">
          {job.service}
        </span>
      )}

      <p className="mt-3 text-xs text-omega-stone uppercase tracking-wider font-semibold">Current phase</p>
      <p className="text-sm font-semibold text-omega-charcoal mb-2 truncate">{currentPhaseName || '—'}</p>

      <ProgressBar progress={progress} />
    </button>
  );
}

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function Dashboard({ user, onSelectJob }) {
  const [jobs, setJobs] = useState([]);
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [openJob, setOpenJob] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: inProgress }, { data: allJobs }, { data: costData }] = await Promise.all([
        supabase.from('jobs').select('*').eq('pipeline_status', 'in_progress').order('created_at', { ascending: false }),
        supabase.from('jobs').select('id, service'),
        supabase.from('job_costs').select('*'),
      ]);
      setJobs(inProgress || []);
      // Join service onto each cost row
      const jobMap = Object.fromEntries((allJobs || []).map((j) => [j.id, j.service]));
      const enrichedCosts = (costData || []).map((c) => ({ ...c, service: jobMap[c.job_id] }));
      setCosts(enrichedCosts);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load dashboard data' });
    } finally {
      setLoading(false);
    }
  }

  const marginStats = useMemo(() => {
    const rows = costs.filter((c) => Number(c.estimated_revenue) > 0);
    if (rows.length === 0) return { avg: null, best: null };
    const avg = rows.reduce((s, r) => s + (Number(r.gross_margin_percent) || 0), 0) / rows.length;

    // Best service by average margin
    const byService = {};
    rows.forEach((r) => {
      const key = normalizeService(r.service) || 'other';
      if (!byService[key]) byService[key] = { sum: 0, n: 0 };
      byService[key].sum += Number(r.gross_margin_percent) || 0;
      byService[key].n += 1;
    });
    let best = null;
    for (const [svc, { sum, n }] of Object.entries(byService)) {
      const m = sum / n;
      if (!best || m > best.margin) best = { service: svc, margin: m };
    }
    return { avg, best };
  }, [costs]);

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Dashboard</h1>
            <p className="text-sm text-omega-stone mt-1">Active projects, margin and payments</p>
          </div>
          <button
            onClick={loadAll}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </header>

      <div className="p-6 md:p-8 space-y-6">
        {/* Margin cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-omega-pale text-omega-orange flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold">Average Margin</p>
              <p className="text-2xl font-bold text-omega-charcoal mt-0.5">
                {marginStats.avg != null ? `${marginStats.avg.toFixed(1)}%` : '—'}
              </p>
              <p className="text-[11px] text-omega-stone mt-0.5">
                {costs.filter((c) => Number(c.estimated_revenue) > 0).length} job(s) with cost data
              </p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-omega-pale text-omega-orange flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold">Best Service by Margin</p>
              <p className="text-2xl font-bold text-omega-charcoal mt-0.5">
                {marginStats.best ? (SERVICE_LABELS[marginStats.best.service] || marginStats.best.service) : '—'}
              </p>
              <p className="text-[11px] text-omega-stone mt-0.5">
                {marginStats.best ? `${marginStats.best.margin.toFixed(1)}% avg` : 'Not enough data yet'}
              </p>
            </div>
          </div>
        </div>

        {/* Payment aging */}
        <div>
          <h2 className="text-lg font-bold text-omega-charcoal mb-3">Payments</h2>
          <PaymentAging user={user} />
        </div>

        {/* Active jobs */}
        <div>
          <h2 className="text-lg font-bold text-omega-charcoal mb-3">Active Jobs</h2>
          {loading ? (
            <div className="flex items-center justify-center py-10"><LoadingSpinner size={32} /></div>
          ) : jobs.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-omega-stone">
              No jobs in progress right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} onSelectJob={setOpenJob} />
              ))}
            </div>
          )}
        </div>
      </div>

      {openJob && (
        <JobFullView
          job={openJob}
          user={user}
          onClose={() => setOpenJob(null)}
          onJobUpdated={(updated) => {
            setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
            setOpenJob(updated);
          }}
          onJobDeleted={(deleted) => {
            setJobs((prev) => prev.filter((j) => j.id !== deleted.id));
            setOpenJob(null);
          }}
        />
      )}
    </div>
  );
}
