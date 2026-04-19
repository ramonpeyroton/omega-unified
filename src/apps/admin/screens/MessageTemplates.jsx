import { useEffect, useState } from 'react';
import { Plus, Edit3, X, Save, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { logAudit } from '../../../shared/lib/audit';

const CATEGORIES = ['Schedule Update', 'Delay', 'Inspection', 'Payment', 'General'];

function emptyForm() { return { name: '', category: 'General', message: '' }; }

export default function MessageTemplates({ user }) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('category')
        .order('name');
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load templates' });
    } finally {
      setLoading(false);
    }
  }

  function openNew() { setEditing('new'); setForm(emptyForm()); }
  function openEdit(t) {
    setEditing(t);
    setForm({ name: t.name || '', category: t.category || 'General', message: t.message || '' });
  }
  function close() { setEditing(null); setForm(emptyForm()); }

  async function save() {
    if (!form.name.trim()) { setToast({ type: 'warning', message: 'Name required' }); return; }
    if (!form.message.trim()) { setToast({ type: 'warning', message: 'Message required' }); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        message: form.message,
      };
      if (editing === 'new') {
        const { data, error } = await supabase.from('message_templates').insert([payload]).select().single();
        if (error) throw error;
        setTemplates((prev) => [data, ...prev]);
        logAudit({ user, action: 'template.create', entityType: 'message_template', entityId: data.id, details: { name: data.name } });
      } else {
        const { data, error } = await supabase.from('message_templates').update(payload).eq('id', editing.id).select().single();
        if (error) throw error;
        setTemplates((prev) => prev.map((x) => x.id === data.id ? data : x));
        logAudit({ user, action: 'template.update', entityType: 'message_template', entityId: data.id, details: { name: data.name } });
      }
      setToast({ type: 'success', message: 'Saved' });
      close();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(t) {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      const { error } = await supabase.from('message_templates').delete().eq('id', t.id);
      if (error) throw error;
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      logAudit({ user, action: 'template.delete', entityType: 'message_template', entityId: t.id, details: { name: t.name } });
      setToast({ type: 'success', message: 'Deleted' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed' });
    }
  }

  const visible = filterCategory === 'all' ? templates : templates.filter((t) => t.category === filterCategory);

  function categoryColor(cat) {
    switch (cat) {
      case 'Schedule Update': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Delay':           return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Inspection':      return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Payment':         return 'bg-green-50 text-green-700 border-green-200';
      default:                return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Message Templates</h1>
            <p className="text-sm text-omega-stone mt-1">Reusable messages that Operations uses to communicate with clients</p>
          </div>
          <div className="flex gap-2">
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={openNew} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
              <Plus className="w-4 h-4" /> Add Template
            </button>
          </div>
        </div>
      </header>

      <div className="p-6 md:p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.length === 0 && (
          <div className="col-span-full bg-white rounded-xl border border-gray-200 p-10 text-center text-omega-stone">
            No templates match. Add some to give Operations a head-start when messaging clients.
          </div>
        )}
        {visible.map((t) => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-bold text-omega-charcoal truncate flex-1">{t.name}</p>
              <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded border ${categoryColor(t.category)}`}>
                {t.category}
              </span>
            </div>
            <p className="text-xs text-omega-slate whitespace-pre-wrap flex-1 line-clamp-6">{t.message}</p>
            <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
              <button onClick={() => openEdit(t)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark">
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </button>
              <button onClick={() => remove(t)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">{editing === 'new' ? 'New Template' : 'Edit Template'}</p>
              <button onClick={close}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Name</label>
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Message</label>
                <p className="text-[11px] text-omega-stone mt-0.5 mb-1">Use placeholders like [Client Name], [Address], [Phase], [Date], [Amount].</p>
                <textarea rows={10} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
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
