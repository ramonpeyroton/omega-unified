import { useState, useEffect } from 'react';
import { PlusCircle, ClipboardList, Bell, LogOut, TrendingUp, Clock, CheckCircle, GitBranch } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import LoadingSpinner from '../components/LoadingSpinner';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Home({ user, onNavigate, onLogout }) {
  const [stats, setStats] = useState({ drafts: 0, total: 0, recent: [] });
  const [loading, setLoading] = useState(true);
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    loadStats();
  }, [user]);

  async function loadStats() {
    try {
      const [{ data: jobs }, { count: unseen }] = await Promise.all([
        supabase
          .from('jobs')
          .select('id, client_name, status, created_at, service')
          .eq('salesperson_name', user.name)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('seen', false),
      ]);

      const all = jobs || [];
      const drafts = all.filter((j) => j.status === 'draft').length;

      setStats({ drafts, total: all.length, recent: all.slice(0, 3) });
      setNotifCount(unseen || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const statusColor = {
    draft: 'bg-amber-100 text-amber-700',
    submitted: 'bg-blue-100 text-blue-700',
    'in-progress': 'bg-green-100 text-green-700',
    completed: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="min-h-screen bg-omega-cloud pb-8">
      {/* Header */}
      <div className="bg-omega-charcoal px-5 pt-12 pb-6">
        <div className="flex items-start justify-between mb-6">
          <Logo size="sm" dark />
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate('notifications')}
              className="relative p-2 rounded-xl bg-white/10 text-omega-fog hover:bg-white/20 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[10px] font-bold rounded-full bg-omega-orange text-white">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
            <button
              onClick={onLogout}
              className="p-2 rounded-xl bg-white/10 text-omega-fog hover:bg-white/20 transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div>
          <p className="text-omega-fog text-sm font-medium mb-0.5">{getGreeting()},</p>
          <h1 className="text-white text-2xl font-bold">{user.name}</h1>
        </div>
      </div>

      <div className="px-5 -mt-4">
        {/* Context Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
          {loading ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-omega-charcoal">{stats.total}</div>
                  <div className="text-xs text-omega-stone font-medium mt-0.5">Total Jobs</div>
                </div>
                <div className="text-center border-x border-gray-100">
                  <div className="text-2xl font-bold text-amber-600">{stats.drafts}</div>
                  <div className="text-xs text-omega-stone font-medium mt-0.5">Drafts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-omega-orange">{stats.total - stats.drafts}</div>
                  <div className="text-xs text-omega-stone font-medium mt-0.5">Submitted</div>
                </div>
              </div>

              {stats.recent.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-3">Recent Jobs</p>
                  <div className="space-y-2">
                    {stats.recent.map((job) => (
                      <button
                        key={job.id}
                        onClick={() => onNavigate('previous-jobs')}
                        className="w-full flex items-center justify-between py-2 hover:opacity-70 transition-opacity"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-omega-pale flex items-center justify-center">
                            <span className="text-xs font-bold text-omega-orange">
                              {job.client_name?.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-omega-charcoal">{job.client_name}</p>
                            <p className="text-xs text-omega-stone">{job.service}</p>
                          </div>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor[job.status] || 'bg-gray-100 text-gray-600'}`}>
                          {job.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {stats.recent.length === 0 && (
                <div className="flex flex-col items-center py-4 text-center">
                  <TrendingUp className="w-8 h-8 text-omega-fog mb-2" />
                  <p className="text-sm text-omega-stone">No jobs yet — start your first consultation!</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Main Actions */}
        <div className="space-y-3">
          <button
            onClick={() => onNavigate('new-job')}
            className="w-full flex items-center gap-4 p-5 rounded-2xl bg-omega-orange hover:bg-omega-dark active:scale-[0.98] transition-all duration-200 shadow-lg shadow-omega-orange/25"
          >
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <PlusCircle className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <p className="text-white font-bold text-base">New Job</p>
              <p className="text-white/75 text-sm">Start a new client consultation</p>
            </div>
          </button>

          <button
            onClick={() => onNavigate('pipeline')}
            className="w-full flex items-center gap-4 p-5 rounded-2xl bg-white hover:bg-gray-50 active:scale-[0.98] transition-all duration-200 border border-gray-200 shadow-sm"
          >
            <div className="w-12 h-12 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
              <GitBranch className="w-6 h-6 text-omega-orange" />
            </div>
            <div className="text-left">
              <p className="text-omega-charcoal font-bold text-base">Pipeline</p>
              <p className="text-omega-stone text-sm">Drag your jobs between phases</p>
            </div>
          </button>

          <button
            onClick={() => onNavigate('previous-jobs')}
            className="w-full flex items-center gap-4 p-5 rounded-2xl bg-white hover:bg-gray-50 active:scale-[0.98] transition-all duration-200 border border-gray-200 shadow-sm"
          >
            <div className="w-12 h-12 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
              <ClipboardList className="w-6 h-6 text-omega-orange" />
            </div>
            <div className="text-left">
              <p className="text-omega-charcoal font-bold text-base">Previous Jobs</p>
              <p className="text-omega-stone text-sm">View, search, and export</p>
            </div>
          </button>
        </div>

        {/* Tips */}
        <div className="mt-5 p-4 rounded-xl bg-omega-info/10 border border-omega-info/20">
          <div className="flex gap-3">
            <CheckCircle className="w-5 h-5 text-omega-info flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-omega-info mb-1">Pro Tip</p>
              <p className="text-xs text-omega-slate">Complete the questionnaire thoroughly — a detailed report leads to a higher close rate.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
