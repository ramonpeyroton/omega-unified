import { useEffect, useState, useMemo } from 'react';
import { Plus, X, Save, Trash2, Upload, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';

const CATEGORIES = ['Material', 'Labor', 'Subcontractor', 'Equipment', 'Permit', 'Other'];

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function emptyForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    category: 'Material',
    description: '',
    amount: '',
    receipt_url: '',
  };
}

export default function JobExpensesSection({ job, user }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [estTotal, setEstTotal] = useState(0);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      const { data: exps } = await supabase
        .from('job_expenses')
        .select('*')
        .eq('job_id', job.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      setExpenses(exps || []);

      const { data: est } = await supabase
        .from('estimates')
        .select('total_amount')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setEstTotal(Number(est?.total_amount) || 0);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load expenses' });
    } finally {
      setLoading(false);
    }
  }

  const total = useMemo(() => expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0), [expenses]);
  const delta = estTotal - total;

  const byCategory = useMemo(() => {
    const agg = {};
    expenses.forEach((e) => {
      agg[e.category] = (agg[e.category] || 0) + (Number(e.amount) || 0);
    });
    return agg;
  }, [expenses]);

  async function uploadReceipt(file) {
    if (!file) return null;
    setUploading(true);
    try {
      const path = `expenses/${job.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('job-expenses').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from('job-expenses').getPublicUrl(path);
      return data?.publicUrl || null;
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Upload failed (bucket "job-expenses" needed)' });
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function add() {
    if (!form.amount || isNaN(Number(form.amount))) { setToast({ type: 'warning', message: 'Amount required' }); return; }
    setSaving(true);
    try {
      const payload = {
        job_id: job.id,
        date: form.date,
        category: form.category,
        description: form.description || null,
        amount: Number(form.amount),
        receipt_url: form.receipt_url || null,
        logged_by: user?.name || null,
      };
      const { data, error } = await supabase.from('job_expenses').insert([payload]).select().single();
      if (error) throw error;
      setExpenses((prev) => [data, ...prev]);
      setShowForm(false);
      setForm(emptyForm());
      setToast({ type: 'success', message: 'Expense added' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to add' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(e) {
    if (!confirm('Delete this expense?')) return;
    try {
      const { error } = await supabase.from('job_expenses').delete().eq('id', e.id);
      if (error) throw error;
      setExpenses((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to delete' });
    }
  }

  if (loading) return <div className="text-sm text-omega-stone p-4">Loading expenses…</div>;

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Total Spent</p>
          <p className="text-lg font-bold text-omega-charcoal mt-0.5">{money(total)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Estimated</p>
          <p className="text-lg font-bold text-omega-charcoal mt-0.5">{money(estTotal)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 col-span-2 sm:col-span-1">
          <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Variance</p>
          <p className={`text-lg font-bold mt-0.5 ${delta >= 0 ? 'text-omega-success' : 'text-red-600'}`}>
            {delta >= 0 ? '+' : ''}{money(delta)}
          </p>
        </div>
      </div>

      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(byCategory).map(([cat, val]) => (
            <span key={cat} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-omega-pale text-[11px] font-semibold text-omega-orange">
              {cat}: {money(val)}
            </span>
          ))}
        </div>
      )}

      {/* Action */}
      <div className="flex justify-end">
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
          <Plus className="w-4 h-4" /> Log Expense
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {expenses.length === 0 ? (
          <div className="p-8 text-center text-omega-stone text-sm">No expenses logged yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {expenses.map((e) => (
              <li key={e.id} className="p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-0.5">
                    <span className="text-omega-stone">{e.date ? new Date(e.date).toLocaleDateString() : '—'}</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold text-[10px] uppercase">{e.category}</span>
                  </div>
                  <p className="text-sm text-omega-charcoal">{e.description || '—'}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-omega-stone">
                    {e.logged_by && <span>by {e.logged_by}</span>}
                    {e.receipt_url && <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-omega-info font-semibold">Receipt ↗</a>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-omega-charcoal">{money(e.amount)}</p>
                  <button onClick={() => remove(e)} className="text-red-600 hover:text-red-700 mt-1 text-xs inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white sm:rounded-2xl w-full sm:max-w-md rounded-t-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">Log Expense</p>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Description</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base" placeholder="What was it for?" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Amount</label>
                <div className="relative mt-1">
                  <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone" />
                  <input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-base" placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Receipt (optional)</label>
                <label className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-omega-slate cursor-pointer">
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading…' : form.receipt_url ? 'Replace receipt' : 'Upload receipt image/PDF'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const url = await uploadReceipt(e.target.files?.[0]);
                      if (url) setForm((f) => ({ ...f, receipt_url: url }));
                    }}
                    disabled={uploading}
                  />
                </label>
                {form.receipt_url && (
                  <a href={form.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-omega-info font-semibold mt-1 inline-block">View receipt ↗</a>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={add} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
