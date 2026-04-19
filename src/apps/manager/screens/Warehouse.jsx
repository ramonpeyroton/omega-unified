import { useState, useEffect, useRef } from 'react';
import {
  Package, Search, Plus, Minus, Edit2, X, CheckCircle, Camera,
  Image as ImageIcon, ArrowLeft, Save,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { scanMaterialsImage } from '../lib/anthropic';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

const CATEGORIES = ['Lumber', 'Hardware', 'Electrical', 'Plumbing', 'Waterproofing', 'Finishes', 'Tools', 'Other'];

const CAT_COLORS = {
  Lumber: 'bg-amber-100 text-amber-800',
  Hardware: 'bg-gray-100 text-gray-700',
  Electrical: 'bg-yellow-100 text-yellow-800',
  Plumbing: 'bg-blue-100 text-blue-800',
  Waterproofing: 'bg-cyan-100 text-cyan-800',
  Finishes: 'bg-pink-100 text-pink-800',
  Tools: 'bg-purple-100 text-purple-800',
  Other: 'bg-gray-100 text-gray-600',
};

function stockColor(item) {
  if (item.quantity <= 0) return 'text-red-600';
  if (item.quantity <= item.low_stock_threshold) return 'text-amber-600';
  return 'text-green-600';
}

// ── Add Quantity Modal ────────────────────────────────────────────────────────
function AddModal({ item, onClose, onSaved, userName }) {
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const amount = parseFloat(qty);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      const newQty = item.quantity + amount;
      await supabase.from('warehouse_items').update({ quantity: newQty }).eq('id', item.id);
      await supabase.from('warehouse_transactions').insert([{
        item_id: item.id, transaction_type: 'add', quantity: amount,
        user_name: userName, note: note.trim() || null,
      }]);
      onSaved({ ...item, quantity: newQty });
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full p-6 pb-8">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-omega-charcoal text-lg">Add Stock — {item.name}</p>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-omega-stone mb-4">Current: <strong className="text-omega-charcoal">{item.quantity} {item.unit}</strong></p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Quantity to Add</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Amount in ${item.unit}`}
              className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-base focus:outline-none focus:border-omega-orange" autoFocus />
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivery from Home Depot"
              className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-sm focus:outline-none focus:border-omega-orange" />
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || !qty} className="w-full flex items-center justify-center gap-2 mt-5 py-4 rounded-xl bg-green-600 text-white font-bold text-base hover:bg-green-700 disabled:opacity-60 transition-colors">
          {saving ? <LoadingSpinner size={18} color="text-white" /> : <Plus className="w-5 h-5" />}
          Add {qty || '0'} {item.unit}
        </button>
      </div>
    </div>
  );
}

// ── Remove Quantity Modal ─────────────────────────────────────────────────────
function RemoveModal({ item, jobs, onClose, onSaved, userName }) {
  const [qty, setQty] = useState('');
  const [jobId, setJobId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const amount = parseFloat(qty);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      const newQty = Math.max(0, item.quantity - amount);
      await supabase.from('warehouse_items').update({ quantity: newQty }).eq('id', item.id);
      await supabase.from('warehouse_transactions').insert([{
        item_id: item.id, transaction_type: 'remove', quantity: amount,
        job_id: jobId || null, user_name: userName, note: note.trim() || null,
      }]);
      onSaved({ ...item, quantity: newQty });
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full p-6 pb-8">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-omega-charcoal text-lg">Remove Stock — {item.name}</p>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-omega-stone mb-4">Current: <strong className="text-omega-charcoal">{item.quantity} {item.unit}</strong></p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Quantity to Remove</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Amount in ${item.unit}`}
              className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-base focus:outline-none focus:border-omega-orange" autoFocus />
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Linked Job (optional)</label>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-sm focus:outline-none focus:border-omega-orange bg-white">
              <option value="">— No job —</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.client_name} · {j.service}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason or details"
              className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-sm focus:outline-none focus:border-omega-orange" />
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || !qty} className="w-full flex items-center justify-center gap-2 mt-5 py-4 rounded-xl bg-red-600 text-white font-bold text-base hover:bg-red-700 disabled:opacity-60 transition-colors">
          {saving ? <LoadingSpinner size={18} color="text-white" /> : <Minus className="w-5 h-5" />}
          Remove {qty || '0'} {item.unit}
        </button>
      </div>
    </div>
  );
}

// ── Edit Item Modal ───────────────────────────────────────────────────────────
function EditModal({ item, onClose, onSaved }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [unit, setUnit] = useState(item.unit);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('warehouse_items')
        .update({ name: name.trim(), category, unit: unit.trim() || 'units' })
        .eq('id', item.id).select().single();
      if (error) throw error;
      onSaved(data);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full p-6 pb-8">
        <div className="flex items-center justify-between mb-5">
          <p className="font-bold text-omega-charcoal text-lg">Edit Item</p>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-base focus:outline-none focus:border-omega-orange" autoFocus />
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-sm focus:outline-none focus:border-omega-orange bg-white">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Unit</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="units" className="w-full px-4 py-3.5 rounded-xl border border-gray-200 text-omega-charcoal text-base focus:outline-none focus:border-omega-orange" />
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || !name.trim()} className="w-full flex items-center justify-center gap-2 mt-5 py-4 rounded-xl bg-omega-orange text-white font-bold text-base hover:bg-omega-dark disabled:opacity-60 transition-colors">
          {saving ? <LoadingSpinner size={18} color="text-white" /> : <Save className="w-5 h-5" />}
          Save Changes
        </button>
      </div>
    </div>
  );
}

// ── AI Scan ───────────────────────────────────────────────────────────────────
function AIScanModal({ items, jobs, onClose, onAdd, userName }) {
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState([]); // editable table rows
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const CATEGORIES = ['Lumber', 'Hardware', 'Electrical', 'Plumbing', 'Waterproofing', 'Finishes', 'Tools', 'Other'];

  const handleImage = async (file) => {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = (e) => res(e.target.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const result = await scanMaterialsImage(base64, file.type || 'image/jpeg');
      setRows(result.map((it) => ({
        item: it.item || it.name || '',
        description: it.description || '',
        quantity: it.quantity ?? 1,
        size: it.size || '',
        sku: it.sku || '',
        color: it.color || '',
        category: it.category || 'Other',
        selected: true,
      })));
    } catch (err) {
      setError(err.message || 'Scan failed. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  const updateRow = (i, field, value) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const toggleRow = (i) => updateRow(i, 'selected', !rows[i].selected);

  const handleConfirm = async () => {
    const selected = rows.filter((r) => r.selected);
    if (!selected.length) return;
    setSaving(true);
    try {
      for (const it of selected) {
        const name = it.item.trim();
        if (!name) continue;
        const existing = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          const newQty = existing.quantity + Number(it.quantity);
          await supabase.from('warehouse_items').update({ quantity: newQty }).eq('id', existing.id);
          await supabase.from('warehouse_transactions').insert([{
            item_id: existing.id, transaction_type: 'add',
            quantity: Number(it.quantity), user_name: userName, note: 'AI Scan',
          }]);
        } else {
          await supabase.from('warehouse_items').insert([{
            name,
            category: it.category || 'Other',
            quantity: Number(it.quantity) || 0,
            unit: it.size || 'units',
            notes: [it.description, it.sku ? `SKU: ${it.sku}` : '', it.color].filter(Boolean).join(' · ') || null,
          }]);
        }
      }
      onAdd(selected.length);
    } catch (err) {
      setError('Failed to save: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full pb-8 max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <p className="font-bold text-omega-charcoal text-lg">Scan Materials</p>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
          {/* Upload step */}
          {rows.length === 0 && !scanning && (
            <>
              <p className="text-sm text-omega-stone mb-4">Take a photo of materials, an invoice, or a handwritten list — AI will identify all items.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { fileRef.current.setAttribute('capture', 'environment'); fileRef.current.click(); }}
                  className="flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-omega-orange text-omega-stone hover:text-omega-orange transition-colors">
                  <Camera className="w-7 h-7" />
                  <span className="text-sm font-medium">Camera</span>
                </button>
                <button onClick={() => { fileRef.current.removeAttribute('capture'); fileRef.current.click(); }}
                  className="flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-omega-orange text-omega-stone hover:text-omega-orange transition-colors">
                  <ImageIcon className="w-7 h-7" />
                  <span className="text-sm font-medium">Gallery</span>
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={(e) => handleImage(e.target.files?.[0])} className="hidden" />
              {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200"><p className="text-sm text-red-600">{error}</p></div>}
            </>
          )}

          {/* Scanning */}
          {scanning && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-omega-pale border border-omega-orange/20">
              <LoadingSpinner />
              <p className="text-sm font-semibold text-omega-charcoal">Identifying materials...</p>
            </div>
          )}

          {/* Editable table */}
          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200 mb-3">
                <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-700 font-medium">{rows.length} item{rows.length !== 1 ? 's' : ''} identified — edit any field before confirming</p>
              </div>

              {error && <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200"><p className="text-sm text-red-600">{error}</p></div>}

              {/* Table header */}
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="w-8 px-2 py-2.5 text-center"></th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Item</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Description</th>
                      <th className="w-16 px-2 py-2.5 text-center font-semibold text-omega-stone uppercase tracking-wider">Qty</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Size</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">SKU</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Color</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} ${!row.selected ? 'opacity-40' : ''}`}>
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => toggleRow(i)} className="flex items-center justify-center">
                            {row.selected
                              ? <CheckCircle className="w-4 h-4 text-omega-orange" />
                              : <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
                          </button>
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.item} onChange={(e) => updateRow(i, 'item', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal text-xs focus:outline-none focus:border-omega-orange bg-white" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.description} onChange={(e) => updateRow(i, 'description', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal text-xs focus:outline-none focus:border-omega-orange bg-white" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" value={row.quantity} onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal text-xs text-center focus:outline-none focus:border-omega-orange bg-white" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.size} onChange={(e) => updateRow(i, 'size', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal text-xs focus:outline-none focus:border-omega-orange bg-white" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.sku} onChange={(e) => updateRow(i, 'sku', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal text-xs focus:outline-none focus:border-omega-orange bg-white" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.color} onChange={(e) => updateRow(i, 'color', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-omega-charcoal text-xs focus:outline-none focus:border-omega-orange bg-white" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer buttons */}
        {rows.length > 0 && (
          <div className="flex gap-3 px-5 pt-3 pb-safe flex-shrink-0 border-t border-gray-100">
            <button onClick={() => { setRows([]); setError(null); }}
              className="flex-1 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-omega-slate hover:bg-gray-50">
              Rescan
            </button>
            <button onClick={handleConfirm} disabled={saving || !rows.some((r) => r.selected)}
              className="flex-1 py-3.5 rounded-xl bg-omega-orange text-white text-sm font-bold hover:bg-omega-dark disabled:opacity-60 transition-colors">
              {saving
                ? <LoadingSpinner size={16} color="text-white" />
                : `Confirm & Add ${rows.filter((r) => r.selected).length} to Warehouse`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Item Card (manager) ───────────────────────────────────────────────────────
function ItemCard({ item, jobs, onUpdate, userName }) {
  const [modal, setModal] = useState(null); // 'add' | 'remove' | 'edit'

  const handleSaved = (updated) => {
    onUpdate(updated);
    setModal(null);
  };

  const qty = item.quantity;
  const qtyColor = qty <= 0 ? 'text-red-600' : qty <= item.low_stock_threshold ? 'text-amber-600' : 'text-green-600';

  return (
    <>
      {modal === 'add' && <AddModal item={item} userName={userName} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal === 'remove' && <RemoveModal item={item} jobs={jobs} userName={userName} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal === 'edit' && <EditModal item={item} onClose={() => setModal(null)} onSaved={handleSaved} />}

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-omega-charcoal text-base">{item.name}</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CAT_COLORS[item.category] || CAT_COLORS.Other}`}>{item.category}</span>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold ${qtyColor}`}>{qty}</p>
            <p className="text-xs text-omega-stone">{item.unit}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setModal('add')} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs font-bold hover:bg-green-100 transition-colors">
            <Plus className="w-3.5 h-3.5" />ADD
          </button>
          <button onClick={() => setModal('remove')} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold hover:bg-red-100 transition-colors">
            <Minus className="w-3.5 h-3.5" />REMOVE
          </button>
          <button onClick={() => setModal('edit')} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-omega-slate text-xs font-bold hover:bg-gray-100 transition-colors">
            <Edit2 className="w-3.5 h-3.5" />EDIT
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function Warehouse({ user, onNavigate }) {
  const [items, setItems] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showScan, setShowScan] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: itemsData }, { data: jobsData }] = await Promise.all([
      supabase.from('warehouse_items').select('*').order('name'),
      supabase.from('jobs').select('id, client_name, service').eq('status', 'in_progress').order('created_at', { ascending: false }).limit(30),
    ]);
    setItems(itemsData || []);
    setJobs(jobsData || []);
    setLoading(false);
  }

  const updateItem = (updated) => {
    setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
  };

  const handleScanAdd = (count) => {
    setShowScan(false);
    setToast({ type: 'success', message: `${count} item${count !== 1 ? 's' : ''} added!` });
    loadAll();
  };

  const filtered = items.filter((it) => {
    const matchSearch = !search || it.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filterCat || it.category === filterCat;
    return matchSearch && matchCat;
  });

  return (
    <div className="min-h-screen bg-omega-cloud pb-32">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showScan && <AIScanModal items={items} jobs={jobs} userName={user?.name || 'Manager'} onClose={() => setShowScan(false)} onAdd={handleScanAdd} />}

      <div className="bg-omega-charcoal px-5 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => onNavigate?.('dashboard')} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-omega-fog text-xs font-medium">Field Manager</p>
            <h1 className="text-white font-bold text-xl">Warehouse</h1>
          </div>
        </div>
        <p className="text-omega-fog text-xs pl-11">{items.length} items in inventory</p>
      </div>

      <div className="px-4 py-4 space-y-3">
        {/* Search + Scan */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..."
              className="w-full pl-9 pr-4 py-3 rounded-xl bg-white border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange" />
          </div>
          <button onClick={() => setShowScan(true)} className="flex items-center gap-2 px-4 py-3 rounded-xl bg-omega-orange text-white font-semibold text-sm hover:bg-omega-dark transition-colors">
            <Camera className="w-4 h-4" />Scan
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {['', ...CATEGORIES].map((c) => (
            <button key={c || 'all'} onClick={() => setFilterCat(c)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filterCat === c ? 'bg-omega-charcoal text-white' : 'bg-white border border-gray-200 text-omega-stone'}`}>
              {c || 'All'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size={32} /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-12 h-12 text-omega-fog mx-auto mb-3" />
            <p className="font-semibold text-omega-charcoal">{items.length === 0 ? 'No items in warehouse' : 'No items match'}</p>
            <p className="text-sm text-omega-stone mt-1">{items.length === 0 ? 'Owner adds items from the Owner app' : 'Adjust your search or filter'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((item) => (
              <ItemCard key={item.id} item={item} jobs={jobs} onUpdate={updateItem} userName={user?.name || 'Manager'} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
