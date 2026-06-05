import { useState, useEffect } from 'react';
import { Bell, LogOut, Sun, Moon, HardHat, RefreshCw, Package, Sun as SunIcon, ShoppingCart, Calendar, MapPin, Navigation } from 'lucide-react';
import { supabase } from '../lib/supabase';
import PageHeader from '../../../shared/components/ui/PageHeader';
import Logo from '../components/Logo';
import ProgressRing from '../components/ProgressRing';
import LoadingSpinner from '../components/LoadingSpinner';

function calcJobProgress(phases) {
  if (!phases || phases.length === 0) return 0;
  let total = 0, done = 0;
  phases.forEach((p) => {
    const tasks = [
      ...(p.tasks || []).filter((t) => !t.startsWith('__duration__') && !t.startsWith('__warning__')),
      ...(p.extra_tasks || []),
    ];
    const completed = p.completed_tasks || [];
    total += tasks.length;
    done += completed.length;
  });
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function JobCard({ job, phases, onClick, materialsPending = 0 }) {
  const pct = calcJobProgress(phases);
  const started = phases?.filter((p) => p.started).length || 0;
  const total = phases?.length || 0;

  return (
    <button
      onClick={() => onClick(job, phases)}
      className="relative w-full bg-white rounded-2xl border border-gray-200 p-4 text-left hover:border-omega-orange/40 hover:shadow-md transition-all duration-200 active:scale-[0.99] dark:bg-gray-800 dark:border-gray-700"
    >
      {/* Pending-materials badge — quick visual reminder that Gabriel still
          has something to buy for this job. Tops the card's right edge. */}
      {materialsPending > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1.5 rounded-full bg-omega-orange text-white text-[11px] font-black flex items-center justify-center shadow-md shadow-omega-orange/40 ring-2 ring-white"
          title={`${materialsPending} material${materialsPending > 1 ? 's' : ''} to buy`}
        >
          {materialsPending > 9 ? '9+' : materialsPending}
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-omega-charcoal dark:text-white text-base">{job.client_name}</p>
          {job.service && (
            <p className="text-[11px] uppercase tracking-wider text-omega-orange font-bold mt-0.5">
              {job.service}
            </p>
          )}
          {/* Address gets top billing — Gabriel needs to eyeball it
              from the van, so we make it larger and add a pin + map
              shortcut that opens Google Maps navigation. */}
          {job.address && (
            <div className="mt-2.5 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-omega-orange flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-omega-charcoal dark:text-gray-100 leading-snug break-words">
                  {job.address}
                </p>
                {job.city && (
                  <p className="text-[11px] text-omega-stone font-medium">{job.city}</p>
                )}
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([job.address, job.city].filter(Boolean).join(', '))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-omega-orange hover:underline mt-1"
                >
                  <Navigation className="w-3 h-3" /> Navigate
                </a>
              </div>
            </div>
          )}
        </div>
        <ProgressRing pct={pct} size={56} />
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-omega-stone">Phases</span>
            <span className="text-xs font-semibold text-omega-charcoal dark:text-gray-300">{started}/{total}</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-omega-orange rounded-full transition-all duration-700"
              style={{ width: `${total > 0 ? (started / total) * 100 : 0}%` }}
            />
          </div>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-omega-pale text-omega-orange">
          {pct}% done
        </span>
      </div>
    </button>
  );
}

export default function Dashboard({ user, onSelectJob, onLogout, onNavigate, darkMode, setDarkMode }) {
  const [jobs, setJobs] = useState([]);
  const [phasesMap, setPhasesMap] = useState({});
  const [materialsByJob, setMaterialsByJob] = useState({}); // jobId → count needed
  const [loading, setLoading] = useState(true);
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      // Query uses `pipeline_status = 'in_progress'` (new canonical column).
      // OR with the legacy `status` column keeps pre-migration jobs visible.
      //
      // TODO: once real auth is wired, scope this to jobs assigned to Gabriel
      //       (e.g. `.eq('pm_id', user.id)` or `.eq('pm_name', user.name)`).
      //       Right now PIN login has no user id, so we show ALL in-progress
      //       jobs to every field manager.
      const { data: jobsData } = await supabase
        .from('jobs')
        .select('*')
        .or('pipeline_status.eq.in_progress,status.eq.in-progress,status.eq.in_progress')
        .order('created_at', { ascending: false });

      const jobs = jobsData || [];
      setJobs(jobs);

      if (jobs.length > 0) {
        const ids = jobs.map((j) => j.id);
        const [{ data: phasesData }, { data: matsData }] = await Promise.all([
          supabase
            .from('job_phases')
            .select('*')
            .in('job_id', ids)
            .order('phase_index', { ascending: true }),
          supabase
            .from('job_materials')
            .select('job_id')
            .eq('status', 'needed')
            .in('job_id', ids),
        ]);

        const map = {};
        (phasesData || []).forEach((p) => {
          if (!map[p.job_id]) map[p.job_id] = [];
          map[p.job_id].push(p);
        });
        setPhasesMap(map);

        // Count pending materials per job for the badge
        const counts = {};
        (matsData || []).forEach((m) => {
          counts[m.job_id] = (counts[m.job_id] || 0) + 1;
        });
        setMaterialsByJob(counts);
      }

      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('seen', false);
      setNotifCount(count || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`flex-1 overflow-y-auto ${darkMode ? 'dark bg-gray-900' : 'bg-omega-cloud'}`}>
      {/* Clean page header — the shared sidebar already shows the role
          and a logout/notifications bell, so we just label the screen. */}
      <PageHeader icon={HardHat} title="Active Jobs" subtitle="Field Manager" onBack={() => onNavigate('home')} />

      <div className="px-4 py-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-omega-stone">{jobs.length} in progress</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-xl border border-gray-200 hover:border-omega-orange text-omega-stone dark:bg-gray-800 dark:border-gray-700"
              title="Toggle dark mode"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={loadData} className="p-2 rounded-xl bg-white border border-gray-200 text-omega-stone hover:text-omega-orange transition-colors dark:bg-gray-800 dark:border-gray-700">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size={32} /></div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <HardHat className="w-12 h-12 text-omega-fog mb-3" />
            <p className="font-semibold text-omega-charcoal dark:text-white mb-1">No active jobs</p>
            <p className="text-sm text-omega-stone">Jobs in progress will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                phases={phasesMap[job.id] || []}
                materialsPending={materialsByJob[job.id] || 0}
                onClick={onSelectJob}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
