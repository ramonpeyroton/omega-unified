import { useCallback, useEffect, useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { loadTemplates } from '../../lib/purchaseLists';

// The default purchase lists (bathroom / kitchen) that every new client list
// starts from. Editable by Attila, Inácio and Rafaela (Ramon, 13/10/26).
// Changes only affect lists created from now on — lists already drafted or
// sent keep their own items.

const TABS = [
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'kitchen', label: 'Kitchen' },
];

export default function PurchaseTemplateEditor({ user, onClose }) {
  const [tab, setTab] = useState('bathroom');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState('');
  const [newNotice, setNewNotice] = useState('');

  const reload = useCallback(async () => {
    try { setRows(await loadTemplates()); } catch (e) { alert(e?.message || 'Could not load'); }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const items = rows.filter((r) => r.service === tab && r.kind === 'item').sort((a, b) => a.position - b.position);
  const notices = rows.filter((r) => r.service === tab && r.kind === 'notice').sort((a, b) => a.position - b.position);

  async function add(kind, label) {
    const list = kind === 'item' ? items : notices;
    const position = (list[list.length - 1]?.position || 0) + 1;
    await supabase.from('purchase_list_templates').insert([{ service: tab, kind, label, position }]);
    logAudit({ user, action: 'purchase_template.add', entityType: 'purchase_template', details: { service: tab, kind, label } });
    reload();
  }
  async function update(row, patch) {
    await supabase.from('purchase_list_templates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id);
    reload();
  }
  async function remove(row) {
    if (!window.confirm(`Remove "${row.label}" from the default ${tab} list?`)) return;
    await supabase.from('purchase_list_templates').delete().eq('id', row.id);
    logAudit({ user, action: 'purchase_template.remove', entityType: 'purchase_template', details: { service: tab, label: row.label } });
    reload();
  }
  async function move(list, row, dir) {
    const idx = list.findIndex((r) => r.id === row.id);
    const other = list[idx + dir];
    if (!other) return;
    await Promise.all([
      supabase.from('purchase_list_templates').update({ position: other.position }).eq('id', row.id),
      supabase.from('purchase_list_templates').update({ position: row.position }).eq('id', other.id),
    ]);
    reload();
  }

  const Row = ({ row, list, i }) => (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex flex-col">
        <button onClick={() => move(list, row, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-omega-charcoal disabled:opacity-30" aria-label="Move up"><ChevronUp className="w-4 h-4" /></button>
        <button onClick={() => move(list, row, 1)} disabled={i === list.length - 1} className="p-0.5 text-gray-400 hover:text-omega-charcoal disabled:opacity-30" aria-label="Move down"><ChevronDown className="w-4 h-4" /></button>
      </div>
      <input defaultValue={row.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== row.label) update(row, { label: v }); }}
        className="flex-1 min-w-0 px-2.5 h-9 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none" />
      <button onClick={() => remove(row)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${row.label}`}>
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
          <div className="flex-1">
            <p className="font-bold text-omega-charcoal text-lg">Default purchase lists</p>
            <p className="text-xs text-omega-stone">Every new client list starts from these. Lists already created keep their own items.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone hover:bg-gray-200" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pt-3 flex gap-2">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`h-9 px-4 rounded-full text-sm font-semibold border ${tab === t.id ? 'bg-omega-charcoal text-white border-omega-charcoal' : 'border-gray-200 text-omega-slate hover:border-omega-orange'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-omega-stone" /> : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">Items ({items.length})</p>
              {items.map((r, i) => <Row key={r.id} row={r} list={items} i={i} />)}
              <div className="flex gap-2 mt-2">
                <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) { add('item', newItem.trim()); setNewItem(''); } }}
                  placeholder="Add an item…" className="flex-1 px-3 h-10 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none" />
                <button onClick={() => { if (newItem.trim()) { add('item', newItem.trim()); setNewItem(''); } }}
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-lg bg-omega-charcoal text-white text-sm font-semibold"><Plus className="w-4 h-4" /> Add</button>
              </div>

              <p className="text-[11px] font-bold uppercase tracking-wider text-omega-stone mt-5 mb-1">"Please note" lines ({notices.length})</p>
              {notices.map((r, i) => <Row key={r.id} row={r} list={notices} i={i} />)}
              <div className="flex gap-2 mt-2">
                <input value={newNotice} onChange={(e) => setNewNotice(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newNotice.trim()) { add('notice', newNotice.trim()); setNewNotice(''); } }}
                  placeholder="Add a note shown under the list…" className="flex-1 px-3 h-10 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none" />
                <button onClick={() => { if (newNotice.trim()) { add('notice', newNotice.trim()); setNewNotice(''); } }}
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-lg bg-omega-charcoal text-white text-sm font-semibold"><Plus className="w-4 h-4" /> Add</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
