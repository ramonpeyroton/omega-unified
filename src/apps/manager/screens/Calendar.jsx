import { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';

// Simple monthly calendar for the Project Manager. Shows the in-progress
// jobs as dots on the day they were created (quick visual of workload);
// tapping a day lists the jobs. No financial info — Manager is scoped to
// operational data only.

function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Calendar({ onNavigate }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('jobs')
        .select('id, client_name, service, address, city, pipeline_status, status, created_at, start_date')
        .in('pipeline_status', ['in_progress', 'in-progress'])
        .order('created_at', { ascending: false });
      setJobs(data || []);
    } finally {
      setLoading(false);
    }
  }

  const month = cursor.getMonth();
  const year = cursor.getFullYear();
  const first = startOfMonth(cursor);
  const firstWeekday = first.getDay();
  const total = daysInMonth(cursor);

  // Map day → list of jobs scheduled/created on that day
  const byDay = useMemo(() => {
    const map = {};
    jobs.forEach((j) => {
      const dateStr = j.start_date || j.created_at;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (d.getMonth() !== month || d.getFullYear() !== year) return;
      const key = d.getDate();
      if (!map[key]) map[key] = [];
      map[key].push(j);
    });
    return map;
  }, [jobs, month, year]);

  // Build grid cells: leading blanks + days
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const today = new Date();
  const selectedJobs = selected ? (byDay[selected] || []) : [];

  return (
    <div className="min-h-screen bg-omega-cloud pb-10">
      {/* Header */}
      <div className="bg-omega-charcoal px-5 pt-10 pb-4">
        <button onClick={() => onNavigate('dashboard')} className="inline-flex items-center gap-1 text-sm text-omega-fog hover:text-white mb-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-white text-2xl font-bold">Calendar</h1>
        <p className="text-omega-fog text-sm mt-1">Active jobs this month</p>
      </div>

      {/* Month switcher */}
      <div className="px-4 py-4 flex items-center justify-between">
        <button
          onClick={() => { setCursor(new Date(year, month - 1, 1)); setSelected(null); }}
          className="p-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange text-omega-slate"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="font-bold text-omega-charcoal">
          {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>
        <button
          onClick={() => { setCursor(new Date(year, month + 1, 1)); setSelected(null); }}
          className="p-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange text-omega-slate"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="px-4">
        <div className="grid grid-cols-7 gap-1 mb-2 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider py-1">{w}</div>
          ))}
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><LoadingSpinner size={28} /></div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (d == null) return <div key={`blank-${i}`} />;
              const dayJobs = byDay[d] || [];
              const isToday = sameDay(new Date(year, month, d), today);
              const isSelected = selected === d;
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d === selected ? null : d)}
                  className={`aspect-square rounded-xl border flex flex-col items-center justify-start p-1.5 transition-colors ${
                    isSelected
                      ? 'border-omega-orange bg-omega-pale'
                      : isToday
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-omega-orange/40'
                  }`}
                >
                  <span className={`text-xs font-semibold ${isToday ? 'text-blue-700' : 'text-omega-charcoal'}`}>{d}</span>
                  {dayJobs.length > 0 && (
                    <div className="mt-auto flex items-center gap-0.5">
                      {dayJobs.slice(0, 3).map((_, k) => (
                        <span key={k} className="w-1.5 h-1.5 rounded-full bg-omega-orange" />
                      ))}
                      {dayJobs.length > 3 && <span className="text-[9px] text-omega-orange font-bold">+{dayJobs.length - 3}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Day detail */}
      {selected != null && (
        <div className="mt-6 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="font-bold text-omega-charcoal mb-3">
              {new Date(year, month, selected).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
            {selectedJobs.length === 0 ? (
              <p className="text-sm text-omega-stone">No jobs on this day.</p>
            ) : (
              <ul className="space-y-2">
                {selectedJobs.map((j) => (
                  <li key={j.id} className="p-3 rounded-xl bg-omega-cloud">
                    <p className="font-semibold text-sm text-omega-charcoal">{j.client_name || 'Untitled'}</p>
                    <p className="text-xs text-omega-stone inline-flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" /> {j.address || j.city || '—'}
                    </p>
                    {j.service && (
                      <span className="inline-block mt-1.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange">
                        {j.service}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
