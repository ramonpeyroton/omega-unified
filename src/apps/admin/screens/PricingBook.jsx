import { useEffect, useState } from 'react';
import { Plus, Edit3, X, Save, Trash2, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { logAudit } from '../../../shared/lib/audit';

const SERVICE_TYPES = [
  'Deck', 'Bathroom', 'Kitchen', 'Addition', 'Basement',
  'Driveway', 'Roofing', 'Full Renovation', 'New Construction', 'Other',
];

const UNITS = ['sq ft', 'linear ft', 'each', 'hour', 'day', 'lump sum'];

function emptyForm() {
  return { service_type: 'Deck', item_name: '', unit: 'sq ft', price_per_unit: '', notes: '' };
}

export default function PricingBook({ user }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filterService, setFilterService] = useState('all');

  useEffect(() => { loadItems(); }, []);

  async function loadItems() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pricing_reference')
        .select('*')
        .order('service_type')
        .order('item_name');
      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load pricing' });
    } finally {
      setLoading(false);
    }
  }

  function openNew() { setEditing('new'); setForm(emptyForm()); }
  function openEdit(i) {
    setEditing(i);
    setForm({
      service_type: i.service_type || 'Deck',
      item_name: i.item_name || '',
      unit: i.unit || 'sq ft',
      price_per_unit: i.price_per_unit ?? '',
      notes: i.notes || '',
    });
  }
  function close() { setEditing(null); setForm(emptyForm()); }

  async function save() {
    if (!form.item_name.trim()) { setToast({ type: 'warning', message: 'Item name required' }); return; }
    if (form.price_per_unit === '' || isNaN(Number(form.price_per_unit))) { setToast({ type: 'warning', message: 'Price must be a number' }); return; }
    setSaving(true);
    try {
      const payload = {
        service_type: form.service_type,
        item_name: form.item_name.trim(),
        unit: form.unit,
        price_per_unit: Number(form.price_per_unit),
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
        updated_by: user?.name || null,
      };
      if (editing === 'new') {
        const { data, error } = await supabase.from('pricing_reference').insert([payload]).select().single();
        if (error) throw error;
        setItems((prev) => [data, ...prev]);
        logAudit({ user, action: 'pricing.create', entityType: 'pricing_reference', entityId: data.id, details: payload });
      } else {
        const { data, error } = await supabase.from('pricing_reference').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        setItems((prev) => prev.map((x) => x.id === data.id ? data : x));
        logAudit({ user, action: 'pricing.update', entityType: 'pricing_reference', entityId: data.id, details: payload });
      }
      setToast({ type: 'success', message: 'Saved' });
      close();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(i) {
    if (!confirm(`Delete "${i.item_name}"?`)) return;
    try {
      const { error } = await supabase.from('pricing_reference').delete().eq('id', i.id);
      if (error) throw error;
      setItems((prev) => prev.filter((x) => x.id !== i.id));
      logAudit({ user, action: 'pricing.delete', entityType: 'pricing_reference', entityId: i.id, details: { item: i.item_name } });
      setToast({ type: 'success', message: 'Deleted' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed' });
    }
  }

  const visible = filterService === 'all' ? items : items.filter((i) => i.service_type === filterService);

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Pricing Book</h1>
            <p className="text-sm text-omega-stone mt-1">Reference prices per service — used by Sales to build estimates</p>
          </div>
          <div className="flex gap-2">
            <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm">
              <option value="all">All services</option>
              {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={openNew}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>
        </div>
      </header>

      <div className="p-6 md:p-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Service</th>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left">Unit</th>
                <th className="px-4 py-3 text-right">Price / Unit</th>
                <th className="px-4 py-3 text-left">Notes</th>
                <th className="px-4 py-3 text-left">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-omega-stone">No pricing items yet.</td></tr>
              )}
              {visible.map((i) => (
                <tr key={i.id} className="hover:bg-omega-cloud/40">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold text-[10px] uppercase">
                      {i.service_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-omega-charcoal">{i.item_name}</td>
                  <td className="px-4 py-3">{i.unit}</td>
                  <td className="px-4 py-3 text-right font-semibold">${Number(i.price_per_unit).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-xs text-omega-stone max-w-xs truncate">{i.notes || '—'}</td>
                  <td className="px-4 py-3 text-xs text-omega-stone">
                    {i.updated_at ? new Date(i.updated_at).toLocaleDateString() : '—'}
                    {i.updated_by && <div className="text-[10px]">by {i.updated_by}</div>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button onClick={() => openEdit(i)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark">
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button onClick={() => remove(i)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-white rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">{editing === 'new' ? 'Add Pricing Item' : 'Edit Pricing Item'}</p>
              <button onClick={close}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Service Type</label>
                <select value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Item Name</label>
                <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="e.g. Tile install, Cabinet install" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Unit</label>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-omega-stone uppercase">Price</label>
                  <div className="relative mt-1">
                    <DollarSign className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-omega-stone" />
                    <input type="number" step="0.01" value={form.price_per_unit} onChange={(e) => setForm({ ...form, price_per_unit: e.target.value })} className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="0.00" />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Notes (optional)</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={close} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
