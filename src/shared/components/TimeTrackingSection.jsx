import { useEffect, useState, useMemo } from 'react';
import { Plus, X, Save, Trash2, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';

function emptyForm() {
  return {
    worker_name: '',
    worker_type: 'employee',
    date: new Date().toISOString().slice(0, 10),
    hours_worked: '',
    phase_id: '',
    notes: '',
  };
}

function weekStart(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1 - day); // Monday as start
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function TimeTrackingSection({ job, user }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState([]);
  const [subs, setSubs] = useState([]);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      const { data: ents } = await supabase
        .from('time_entries')
        .select('*')
        .eq('job_id', job.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      setEntries(ents || []);

      const { data: subsData } = await supabase.from('subcontractors').select('name').order('name');
      setSubs(subsData || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load time entries' });
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const wkStart = weekStart().getTime();
    let week = 0, all = 0;
    entries.forEach((e) => {
      const h = Number(e.hours_worked) || 0;
      all += h;
      if (e.date && new Date(e.date).getTime() >= wkStart) week += h;
    });
    return { week, all };
  }, [entries]);

  async function save() {
    if (!form.worker_name.trim()) { setToast({ type: 'warning', message: 'Worker name required' }); return; }
    if (!form.hours_worked || isNaN(Number(form.hours_worked))) { setToast({ type: 'warning', message: 'Hours must be a number' }); return; }
    setSaving(true);
    try {
      const payload = {
        job_id: job.id,
        worker_name: form.worker_name.trim(),
        worker_type: form.worker_type,
        date: form.date,
        hours_worked: Number(form.hours_worked),
        phase_id: form.phase_id || null,
        notes: form.notes || null,
        logged_by: user?.name || null,
      };
      const { data, error } = await supabase.from('time_entries').insert([payload]).select().single();
      if (error) throw error;
      setEntries((prev) => [data, ...prev]);
      setShowForm(false);
      setForm(emptyForm());
      setToast({ type: 'success', message: 'Time logged' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(e) {
    if (!confirm('Delete this entry?')) return;
    try {
      const { error } = await supabase.from('time_entries').delete().eq('id', e.id);
      if (error) throw error;
      setEntries((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      setToast({ type: 'error', message: err.message });
    }
  }

  const phases = Array.isArray(job.phase_data?.phases) ? job.phase_data.phases : [];

  if (loading) return <div className="text-sm text-omega-stone p-4">Loading time entries…</div>;

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Hours This Week</p>
          <p className="text-lg font-bold text-omega-charcoal mt-0.5">{totals.week.toFixed(1)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Total on this Job</p>
          <p className="text-lg font-bold text-omega-charcoal mt-0.5">{totals.all.toFixed(1)}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
          <Plus className="w-4 h-4" /> Log Hours
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-omega-stone text-sm">
          No time entries yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {entries.map((e) => {
              const phase = phases.find((p) => p.id === e.phase_id);
              return (
                <li key={e.id} className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-omega-charcoal">{e.worker_name}</p>
                      <span className="text-[10px] text-omega-stone uppercase">{e.worker_type}</span>
                    </div>
                    <p className="text-[11px] text-omega-stone">
                      {e.date ? new Date(e.date).toLocaleDateString() : ''}
                      {phase && ` · ${phase.name}`}
                    </p>
                    {e.notes && <p className="text-xs text-omega-slate mt-0.5">{e.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-omega-charcoal inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {Number(e.hours_worked).toFixed(1)}h</p>
                    <button onClick={() => remove(e)} className="text-red-600 hover:text-red-700 mt-1 text-xs"><Trash2 className="w-3 h-3 inline" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white sm:rounded-2xl w-full sm:max-w-md rounded-t-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">Log Hours</p>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Worker</label>
                <input
                  value={form.worker_name}
                  onChange={(e) => setForm({ ...form, worker_name: e.target.value })}
                  list="sub-names"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base"
                  placeholder="Name"
                />
                <datalist id="sub-names">
                  {subs.map((s) => <option key={s.name} value={s.name} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Type</label>
                  <select value={form.worker_type} onChange={(e) => setForm({ ...form, worker_type: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base">
                    <option value="employee">Employee</option>
                    <option value="subcontractor">Subcontractor</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Hours</label>
                <input
                  type="number"
                  step="0.25"
                  inputMode="decimal"
                  value={form.hours_worked}
                  onChange={(e) => setForm({ ...form, hours_worked: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base"
                  placeholder="e.g. 8 or 4.5"
                />
              </div>
              {phases.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Phase (optional)</label>
                  <select value={form.phase_id} onChange={(e) => setForm({ ...form, phase_id: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base">
                    <option value="">— none —</option>
                    {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
