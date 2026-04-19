import { useState, useEffect, useRef } from 'react';
import {
  Package, Search, Plus, Minus, ChevronDown, ChevronUp, X, AlertTriangle,
  Camera, Image as ImageIcon, CheckCircle, Edit2, ArrowUpDown, Save,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const CATEGORIES = ['Lumber', 'Hardware', 'Electrical', 'Plumbing', 'Waterproofing', 'Finishes', 'Tools', 'Other'];

const CAT_COLORS = {
  Lumber:       'bg-amber-100 text-amber-800',
  Hardware:     'bg-gray-100 text-gray-700',
  Electrical:   'bg-yellow-100 text-yellow-800',
  Plumbing:     'bg-blue-100 text-blue-800',
  Waterproofing:'bg-cyan-100 text-cyan-800',
  Finishes:     'bg-pink-100 text-pink-800',
  Tools:        'bg-purple-100 text-purple-800',
  Other:        'bg-gray-100 text-gray-600',
};

function stockStatus(item) {
  if (item.quantity <= 0) return { label: 'Out of stock', cls: 'bg-red-100 text-red-700' };
  if (item.quantity <= item.low_stock_threshold) return { label: 'Low stock', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'In stock', cls: 'bg-green-100 text-green-700' };
}

// ── Add Item Modal ────────────────────────────────────────────────────────────
function AddItemModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', category: 'Other', unit: 'units', quantity: '', low_stock_threshold: '5', notes: '' });
  const [saving, setSaving] = useState(false);
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('warehouse_items').insert([{
        name: form.name.trim(),
        category: form.category,
        unit: form.unit || 'units',
        quantity: parseFloat(form.quantity) || 0,
        low_stock_threshold: parseFloat(form.low_stock_threshold) || 5,
        notes: form.notes.trim() || null,
      }]).select().single();
      if (error) throw error;
      onSave(data);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal">Add Inventory Item</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Item Name *</label>
            <input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. 2x4x8 Stud" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange" />
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Category</label>
            <select value={form.category} onChange={(e) => update('category', e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange bg-white">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Initial Qty</label>
              <input type="number" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} placeholder="0" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange" />
            </div>
            <div>
              <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Unit</label>
              <input value={form.unit} onChange={(e) => update('unit', e.target.value)} placeholder="units" className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Low Stock Alert (qty)</label>
            <input type="number" value={form.low_stock_threshold} onChange={(e) => update('low_stock_threshold', e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange" />
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Notes</label>
            <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={2} className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange resize-none" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()} className="flex-1 py-3 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark disabled:opacity-60 transition-colors">
            {saving ? <LoadingSpinner size={14} color="text-white" /> : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Scan Modal ─────────────────────────────────────────────────────────────
function AIScanModal({ onClose, onAdd }) {
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

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
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } },
              {
                type: 'text',
                text: `You are a construction materials expert. Identify every construction material, product, or supply item visible in this image (including items on invoices, receipts, handwritten lists, or physical materials).

For each item return a JSON array with these exact fields:
- item: short product name (e.g. "2x4x8 Stud", "1/2\" Drywall Sheet", "PVC 90° Elbow 3/4\"")
- description: material type or grade (e.g. "Douglas Fir KD", "Type X Fire Rated", "Schedule 40")
- quantity: numeric quantity (number only)
- size: dimensions (e.g. "2\" x 4\" x 8'", "4x8 sheet", "3/4\" dia")
- sku: Home Depot or supplier SKU if visible, otherwise empty string
- color: color or finish if applicable, otherwise empty string
- category: one of Lumber, Hardware, Electrical, Plumbing, Waterproofing, Finishes, Tools, Other

Return ONLY a valid JSON array — no markdown, no explanation:
[{"item":"2x4x8 Stud","description":"Douglas Fir KD","quantity":48,"size":"2\\" x 4\\" x 8'","sku":"161640","color":"Natural","category":"Lumber"}]`,
              },
            ],
          }],
        }),
      });
      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setRows(parsed.map((it) => ({
          item: it.item || it.name || '',
          description: it.description || '',
          quantity: it.quantity ?? 1,
          size: it.size || '',
          sku: it.sku || '',
          color: it.color || '',
          category: it.category || 'Other',
          selected: true,
        })));
      } else {
        setError('Could not identify materials. Try a clearer photo.');
      }
    } catch (err) {
      setError('Scan failed: ' + (err.message || 'Unknown error'));
    } finally {
      setScanning(false);
    }
  };

  const updateRow = (i, field, value) =>
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const toggleRow = (i) => updateRow(i, 'selected', !rows[i].selected);

  const handleConfirm = () => {
    setSaving(true);
    onAdd(rows.filter((r) => r.selected).map((r) => ({
      name: r.item,
      description: r.description,
      quantity: Number(r.quantity) || 0,
      size: r.size,
      sku: r.sku,
      color: r.color,
      category: r.category,
    })));
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <p className="font-bold text-omega-charcoal">AI Material Scan</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Upload step */}
          {rows.length === 0 && !scanning && (
            <div className="space-y-4">
              <p className="text-sm text-omega-stone">Take a photo of materials, an invoice, or a handwritten list. AI will identify all construction items.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { fileRef.current.setAttribute('capture', 'environment'); fileRef.current.click(); }}
                  className="flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-omega-orange text-omega-stone hover:text-omega-orange transition-colors">
                  <Camera className="w-7 h-7" />
                  <span className="text-sm font-medium">Camera</span>
                </button>
                <button onClick={() => { fileRef.current.removeAttribute('capture'); fileRef.current.click(); }}
                  className="flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-gray-200 hover:border-omega-orange text-omega-stone hover:text-omega-orange transition-colors">
                  <ImageIcon className="w-7 h-7" />
                  <span className="text-sm font-medium">From Gallery</span>
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={(e) => handleImage(e.target.files?.[0])} className="hidden" />
              {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200"><p className="text-sm text-red-600">{error}</p></div>}
            </div>
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
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200">
                <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-700 font-medium">{rows.length} item{rows.length !== 1 ? 's' : ''} identified — edit any field before confirming</p>
              </div>

              {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200"><p className="text-sm text-red-600">{error}</p></div>}

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-xs min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="w-8 px-2 py-2.5"></th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Item</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Description</th>
                      <th className="w-14 px-2 py-2.5 text-center font-semibold text-omega-stone uppercase tracking-wider">Qty</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Size</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">SKU</th>
                      <th className="px-2 py-2.5 text-left font-semibold text-omega-stone uppercase tracking-wider">Color</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={`border-b border-gray-100 transition-opacity ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} ${!row.selected ? 'opacity-40' : ''}`}>
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
            </div>
          )}
        </div>

        {/* Footer */}
        {rows.length > 0 && (
          <div className="flex gap-3 px-5 py-4 border-t border-gray-100 flex-shrink-0">
            <button onClick={() => { setRows([]); setError(null); }}
              className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-medium text-omega-slate hover:bg-gray-50">
              Rescan
            </button>
            <button onClick={handleConfirm} disabled={saving || !rows.some((r) => r.selected)}
              className="flex-1 py-3 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark disabled:opacity-60 transition-colors">
              {saving
                ? <LoadingSpinner size={14} color="text-white" />
                : `Confirm & Add ${rows.filter((r) => r.selected).length} to Warehouse`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit Item Modal ───────────────────────────────────────────────────────────
function EditModal({ item, onClose, onSaved }) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category || 'Other');
  const [unit, setUnit] = useState(item.unit || 'units');
  const [threshold, setThreshold] = useState(item.low_stock_threshold ?? 5);
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('warehouse_items')
        .update({ name: name.trim(), category, unit: unit.trim() || 'units', low_stock_threshold: Number(threshold) || 5, notes: notes.trim() || null })
        .eq('id', item.id).select().single();
      if (error) throw error;
      onSaved(data);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal">Edit Item</p>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange bg-white">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Unit</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Low Stock Alert (qty)</label>
            <input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange" />
          </div>
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1.5 block">Notes / SKU / Size</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange resize-none" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-omega-slate hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="flex-1 py-2.5 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark disabled:opacity-60 transition-colors">
            {saving ? <LoadingSpinner size={14} color="text-white" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline Qty Adjust Modal ────────────────────────────────────────────────────
function QtyModal({ item, mode, onClose, onSaved }) {
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const isAdd = mode === 'add';

  const handleSave = async () => {
    const amount = parseFloat(qty);
    if (!amount || amount <= 0) return;
    setSaving(true);
    try {
      const newQty = isAdd ? item.quantity + amount : Math.max(0, item.quantity - amount);
      await supabase.from('warehouse_items').update({ quantity: newQty }).eq('id', item.id);
      await supabase.from('warehouse_transactions').insert([{
        item_id: item.id, transaction_type: isAdd ? 'add' : 'remove', quantity: amount, note: isAdd ? 'Manual add' : 'Manual remove',
      }]);
      onSaved({ ...item, quantity: newQty });
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-xs shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-omega-charcoal text-sm">{isAdd ? 'Add Stock' : 'Remove Stock'} — {item.name}</p>
          <button onClick={onClose} className="p-1 rounded-lg text-omega-stone hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-omega-stone mb-3">Current: <strong className="text-omega-charcoal">{item.quantity} {item.unit}</strong></p>
        <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={`Qty in ${item.unit}`} autoFocus
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange mb-3" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-omega-slate hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving || !qty}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-60 transition-colors ${isAdd ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'}`}>
            {saving ? <LoadingSpinner size={14} color="text-white" /> : `${isAdd ? '+' : '-'} ${qty || '0'} ${item.unit}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Parse SKU & Size from notes field ─────────────────────────────────────────
function parseNotesFields(notes) {
  if (!notes) return { sku: '', size: '' };
  const skuMatch = notes.match(/SKU:\s*([^\s·]+)/i);
  const sku = skuMatch ? skuMatch[1] : '';
  // Size is anything that looks like a dimension
  const sizeMatch = notes.match(/(\d+["']?\s*[x×]\s*\d+[^\s·]*|\d+(?:\/\d+)?\s*(?:in|ft|mm|cm)|[A-Z0-9]{1,4}-\d+[^\s·]*)/i);
  const size = sizeMatch ? sizeMatch[0] : '';
  return { sku, size };
}

// ── Sort icon helper ──────────────────────────────────────────────────────────
function SortIcon({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
  return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-omega-orange" /> : <ChevronDown className="w-3 h-3 text-omega-orange" />;
}

// ── Item Row ──────────────────────────────────────────────────────────────────
function ItemRow({ item, onUpdated, zebra }) {
  const [modal, setModal] = useState(null); // 'add' | 'remove' | 'edit'
  const { sku, size } = parseNotesFields(item.notes);
  const status = stockStatus(item);
  const qtyLow = item.quantity > 0 && item.quantity <= item.low_stock_threshold;

  const handleSaved = (updated) => { onUpdated(updated); setModal(null); };

  return (
    <>
      {modal === 'add' && <QtyModal item={item} mode="add" onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal === 'remove' && <QtyModal item={item} mode="remove" onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal === 'edit' && <EditModal item={item} onClose={() => setModal(null)} onSaved={handleSaved} />}

      <tr className={`border-b border-gray-100 hover:bg-blue-50/30 transition-colors ${zebra ? 'bg-gray-50/50' : 'bg-white'}`}>
        {/* Name */}
        <td className="px-4 py-3">
          <p className="font-semibold text-omega-charcoal text-sm leading-tight">{item.name}</p>
          {item.notes && !sku && !size && (
            <p className="text-xs text-omega-fog mt-0.5 truncate max-w-[200px]">{item.notes}</p>
          )}
        </td>
        {/* Category */}
        <td className="px-3 py-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CAT_COLORS[item.category] || CAT_COLORS.Other}`}>
            {item.category}
          </span>
        </td>
        {/* SKU */}
        <td className="px-3 py-3">
          <span className="text-xs text-omega-stone font-mono">{sku || '—'}</span>
        </td>
        {/* Size / Unit */}
        <td className="px-3 py-3">
          <span className="text-xs text-omega-stone">{size || item.unit || '—'}</span>
        </td>
        {/* Status */}
        <td className="px-3 py-3">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${status.cls}`}>
            {status.label}
          </span>
        </td>
        {/* Qty */}
        <td className="px-3 py-3 text-right">
          <span className={`text-base font-bold ${qtyLow ? 'text-omega-orange' : item.quantity <= 0 ? 'text-red-600' : 'text-omega-charcoal'}`}>
            {item.quantity}
          </span>
          <span className="text-xs text-omega-stone ml-1">{item.unit}</span>
        </td>
        {/* Actions */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5 justify-end">
            <button onClick={() => setModal('add')} title="Add stock"
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setModal('remove')} title="Remove stock"
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors">
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setModal('edit')} title="Edit item"
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 border border-gray-200 text-omega-slate hover:bg-gray-100 transition-colors">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    </>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function Warehouse() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [showAdd, setShowAdd] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { loadItems(); }, []);

  async function loadItems() {
    setLoading(true);
    const { data } = await supabase.from('warehouse_items').select('*').order('name');
    setItems(data || []);
    setLoading(false);
  }

  async function handleAIAddItems(scanned) {
    setShowScan(false);
    for (const it of scanned) {
      const name = (it.name || '').trim();
      if (!name) continue;
      const existing = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('warehouse_items').update({ quantity: existing.quantity + (Number(it.quantity) || 0) }).eq('id', existing.id);
        await supabase.from('warehouse_transactions').insert([{ item_id: existing.id, transaction_type: 'add', quantity: Number(it.quantity) || 0, note: 'AI Scan' }]);
      } else {
        const notes = [it.description, it.sku ? `SKU: ${it.sku}` : '', it.color].filter(Boolean).join(' · ') || null;
        await supabase.from('warehouse_items').insert([{ name, category: it.category || 'Other', quantity: Number(it.quantity) || 0, unit: it.size || 'units', notes }]);
      }
    }
    setToast({ type: 'success', message: `${scanned.length} item${scanned.length !== 1 ? 's' : ''} added from scan!` });
    loadItems();
  }

  function handleSort(col) {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  const updateItem = (updated) => setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));

  const filtered = items
    .filter((it) => {
      const matchSearch = !search || it.name.toLowerCase().includes(search.toLowerCase()) ||
        (it.notes || '').toLowerCase().includes(search.toLowerCase());
      const matchCat = !filterCat || it.category === filterCat;
      return matchSearch && matchCat;
    })
    .sort((a, b) => {
      let va, vb;
      if (sortBy === 'name') { va = a.name; vb = b.name; }
      else if (sortBy === 'category') { va = a.category; vb = b.category; }
      else if (sortBy === 'status') {
        const order = { 'Out of stock': 0, 'Low stock': 1, 'In stock': 2 };
        va = order[stockStatus(a).label] ?? 1;
        vb = order[stockStatus(b).label] ?? 1;
      }
      else if (sortBy === 'quantity') { va = a.quantity; vb = b.quantity; }
      else { va = a.name; vb = b.name; }
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const lowStockCount = items.filter((i) => i.quantity > 0 && i.quantity <= i.low_stock_threshold).length;
  const outCount = items.filter((i) => i.quantity <= 0).length;

  const COLS = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category', sortable: true },
    { key: 'sku', label: 'SKU', sortable: false },
    { key: 'size', label: 'Size', sortable: false },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'quantity', label: 'Qty', sortable: true },
    { key: 'actions', label: '', sortable: false },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showAdd && <AddItemModal onClose={() => setShowAdd(false)} onSave={(item) => { setItems((prev) => [...prev, item]); setShowAdd(false); setToast({ type: 'success', message: 'Item added!' }); }} />}
      {showScan && <AIScanModal onClose={() => setShowScan(false)} onAdd={handleAIAddItems} />}

      {/* Top bar */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-omega-charcoal">Warehouse</h1>
          <p className="text-xs text-omega-stone mt-0.5">
            {items.length} items
            {outCount > 0 && <> · <span className="text-red-600 font-medium">{outCount} out of stock</span></>}
            {lowStockCount > 0 && <> · <span className="text-amber-600 font-medium">{lowStockCount} low stock</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowScan(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-omega-charcoal text-sm font-medium hover:bg-gray-50 transition-colors">
            <Camera className="w-4 h-4" />Scan
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
            <Plus className="w-4 h-4" />Add Item
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="px-6 py-3 bg-white border-b border-gray-100 flex items-center gap-3 flex-wrap flex-shrink-0">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange bg-white" />
        </div>
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-omega-charcoal focus:outline-none focus:border-omega-orange bg-white">
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* List table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size={32} /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-12 h-12 text-omega-fog mx-auto mb-3" />
            <p className="font-semibold text-omega-charcoal mb-1">{items.length === 0 ? 'No items yet' : 'No items match filters'}</p>
            <p className="text-sm text-omega-stone">{items.length === 0 ? 'Add your first inventory item to get started' : 'Try adjusting your search or filters'}</p>
          </div>
        ) : (
          <table className="w-full min-w-[700px]">
            <thead className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
              <tr>
                {COLS.map((col) => (
                  <th key={col.key}
                    className={`px-4 py-3 text-left text-xs font-semibold text-omega-stone uppercase tracking-wider whitespace-nowrap ${col.sortable ? 'cursor-pointer hover:text-omega-charcoal select-none' : ''} ${col.key === 'actions' ? 'text-right' : ''}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}>
                    <span className="flex items-center gap-1">
                      {col.label}
                      {col.sortable && <SortIcon col={col.key} sortBy={sortBy} sortDir={sortDir} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <ItemRow key={item.id} item={item} zebra={i % 2 !== 0} onUpdated={updateItem} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
