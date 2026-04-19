import { useEffect, useState } from 'react';
import { Plus, X, Save, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';

const WEATHER = [
  { key: 'Sunny',  icon: '☀️' },
  { key: 'Cloudy', icon: '⛅' },
  { key: 'Rainy',  icon: '🌧️' },
  { key: 'Snowy',  icon: '🌨️' },
  { key: 'Windy',  icon: '💨' },
];

function emptyForm() {
  return {
    log_date: new Date().toISOString().slice(0, 10),
    weather: '',
    workers_on_site: '',
    work_performed: '',
    materials_delivered: '',
    issues_encountered: '',
  };
}

export default function DailyLogsSection({ job, user }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState([]);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('job_id', job.id)
        .order('log_date', { ascending: false })
        .order('created_at', { ascending: false });
      setLogs(data || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load logs' });
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        job_id: job.id,
        log_date: form.log_date,
        weather: form.weather || null,
        workers_on_site: form.workers_on_site === '' ? null : Number(form.workers_on_site),
        work_performed: form.work_performed || null,
        materials_delivered: form.materials_delivered || null,
        issues_encountered: form.issues_encountered || null,
        logged_by: user?.name || null,
      };
      const { data, error } = await supabase.from('daily_logs').insert([payload]).select().single();
      if (error) throw error;
      setLogs((prev) => [data, ...prev]);
      setShowForm(false);
      setForm(emptyForm());
      setToast({ type: 'success', message: 'Log saved' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(log) {
    if (!confirm('Delete this log?')) return;
    try {
      const { error } = await supabase.from('daily_logs').delete().eq('id', log.id);
      if (error) throw error;
      setLogs((prev) => prev.filter((l) => l.id !== log.id));
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    }
  }

  if (loading) return <div className="text-sm text-omega-stone p-4">Loading logs…</div>;

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
          <Plus className="w-4 h-4" /> New Log
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-omega-stone text-sm">
          No daily logs yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {logs.map((log) => {
            const w = WEATHER.find((x) => x.key === log.weather);
            return (
              <li key={log.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-omega-charcoal">{new Date(log.log_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                    {w && <span className="text-xl" title={w.key}>{w.icon}</span>}
                    {log.workers_on_site != null && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-omega-pale text-omega-orange font-semibold text-[11px]">
                        {log.workers_on_site} {log.workers_on_site === 1 ? 'worker' : 'workers'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {log.logged_by && <span className="text-[11px] text-omega-stone">by {log.logged_by}</span>}
                    <button onClick={() => remove(log)} className="text-red-600 hover:text-red-700 text-xs"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {log.work_performed && <LogField label="Work performed" text={log.work_performed} />}
                {log.materials_delivered && <LogField label="Materials delivered" text={log.materials_delivered} />}
                {log.issues_encountered && <LogField label="Issues encountered" text={log.issues_encountered} warn />}
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white sm:rounded-2xl w-full sm:max-w-lg rounded-t-2xl max-h-[95vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white">
              <p className="font-bold text-omega-charcoal">New Daily Log</p>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Date</label>
                <input type="date" value={form.log_date} onChange={(e) => setForm({ ...form, log_date: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Weather</label>
                <div className="mt-1 flex gap-2 flex-wrap">
                  {WEATHER.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      onClick={() => setForm({ ...form, weather: form.weather === w.key ? '' : w.key })}
                      className={`px-3 py-2 rounded-xl border-2 text-sm font-medium ${form.weather === w.key ? 'border-omega-orange bg-omega-pale' : 'border-gray-200 bg-white'}`}
                    >
                      <span className="text-lg mr-1">{w.icon}</span>{w.key}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Workers on site</label>
                <input type="number" inputMode="numeric" min="0" value={form.workers_on_site} onChange={(e) => setForm({ ...form, workers_on_site: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Work performed</label>
                <textarea rows={3} value={form.work_performed} onChange={(e) => setForm({ ...form, work_performed: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Materials delivered</label>
                <textarea rows={2} value={form.materials_delivered} onChange={(e) => setForm({ ...form, materials_delivered: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Issues encountered</label>
                <textarea rows={2} value={form.issues_encountered} onChange={(e) => setForm({ ...form, issues_encountered: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Log'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LogField({ label, text, warn }) {
  return (
    <div className="mt-2">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${warn ? 'text-red-600' : 'text-omega-stone'}`}>{label}</p>
      <p className="text-sm text-omega-slate whitespace-pre-wrap">{text}</p>
    </div>
  );
}
