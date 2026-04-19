import { useState, useEffect } from 'react';
import { Bell, LogOut, Sun, Moon, HardHat, RefreshCw, Package } from 'lucide-react';
import { supabase } from '../lib/supabase';
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

function JobCard({ job, phases, onClick }) {
  const pct = calcJobProgress(phases);
  const started = phases?.filter((p) => p.started).length || 0;
  const total = phases?.length || 0;

  return (
    <button
      onClick={() => onClick(job, phases)}
      className="w-full bg-white rounded-2xl border border-gray-200 p-4 text-left hover:border-omega-orange/40 hover:shadow-md transition-all duration-200 active:scale-[0.99] dark:bg-gray-800 dark:border-gray-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-bold text-omega-charcoal dark:text-white text-base">{job.client_name}</p>
          <p className="text-xs text-omega-stone mt-0.5 mb-3">{job.service}</p>
          <p className="text-xs text-omega-stone truncate">{job.address}</p>
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
        const { data: phasesData } = await supabase
          .from('job_phases')
          .select('*')
          .in('job_id', ids)
          .order('phase_index', { ascending: true });

        const map = {};
        (phasesData || []).forEach((p) => {
          if (!map[p.job_id]) map[p.job_id] = [];
          map[p.job_id].push(p);
        });
        setPhasesMap(map);
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
    <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-omega-cloud'}`}>
      {/* Header */}
      <div className="bg-omega-charcoal px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-4">
          <Logo size="sm" dark />
          <div className="flex items-center gap-2">
            <button onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-xl bg-white/10 text-omega-fog hover:bg-white/20 transition-colors">
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button onClick={() => onNavigate?.('notifications')} className="relative p-2 rounded-xl bg-white/10 text-omega-fog hover:bg-white/20 transition-colors">
              <Bell className="w-5 h-5" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold rounded-full bg-omega-orange text-white flex items-center justify-center">
                  {notifCount}
                </span>
              )}
            </button>
            <button onClick={onLogout} className="p-2 rounded-xl bg-white/10 text-omega-fog hover:bg-white/20 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div>
          <p className="text-omega-fog text-sm">Field Manager</p>
          <h1 className="text-white text-2xl font-bold">{user.name}</h1>
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-20">
        <button onClick={() => onNavigate?.('dashboard')} className="flex-1 flex flex-col items-center gap-1 py-3 text-omega-orange">
          <HardHat className="w-5 h-5" />
          <span className="text-[10px] font-semibold">Jobs</span>
        </button>
        <button onClick={() => onNavigate?.('warehouse')} className="flex-1 flex flex-col items-center gap-1 py-3 text-omega-stone hover:text-omega-charcoal transition-colors">
          <Package className="w-5 h-5" />
          <span className="text-[10px] font-semibold">Warehouse</span>
        </button>
        <button onClick={() => onNavigate?.('notifications')} className="flex-1 flex flex-col items-center gap-1 py-3 text-omega-stone hover:text-omega-charcoal transition-colors relative">
          <Bell className="w-5 h-5" />
          {notifCount > 0 && <span className="absolute top-2 right-6 w-4 h-4 text-[9px] font-bold rounded-full bg-omega-orange text-white flex items-center justify-center">{notifCount}</span>}
          <span className="text-[10px] font-semibold">Alerts</span>
        </button>
      </div>

      <div className="px-4 py-5 pb-24">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-omega-charcoal dark:text-white text-lg">Active Jobs</h2>
            <p className="text-xs text-omega-stone">{jobs.length} in progress</p>
          </div>
          <button onClick={loadData} className="p-2 rounded-xl bg-white border border-gray-200 text-omega-stone hover:text-omega-orange transition-colors dark:bg-gray-800 dark:border-gray-700">
            <RefreshCw className="w-4 h-4" />
          </button>
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
                onClick={onSelectJob}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
