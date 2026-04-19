import { useState, useEffect } from 'react';
import { Search, Plus, Phone, Mail, X, Edit2, Trash2, UserPlus, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

const SPECIALTIES = ['Plumbing', 'Electrical', 'Tile', 'Framing', 'Drywall', 'Painting', 'Roofing', 'HVAC', 'Flooring', 'Landscaping', 'Concrete', 'Masonry', 'Millwork', 'Glazing', 'General'];

function SubModal({ sub, onSave, onClose }) {
  const [form, setForm] = useState(sub || { name: '', phone: '', email: '', specialty: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-omega-charcoal text-lg">{sub ? 'Edit Subcontractor' : 'Add Subcontractor'}</h3>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone hover:bg-gray-200 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          {[
            { key: 'name', label: 'Name *', placeholder: 'Full name / Company' },
            { key: 'phone', label: 'Phone', placeholder: '(203) 555-0100' },
            { key: 'email', label: 'Email', placeholder: 'contact@company.com' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-1.5">{label}</label>
              <input type="text" value={form[key] || ''} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange transition-colors" />
            </div>
          ))}

          <div>
            <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-1.5">Specialty</label>
            <select value={form.specialty || ''} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange transition-colors bg-white">
              <option value="">Select specialty</option>
              {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="flex-1 py-3 rounded-xl bg-omega-orange text-white font-semibold text-sm hover:bg-omega-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {saving ? <LoadingSpinner size={16} color="text-white" /> : null}
            {sub ? 'Save Changes' : 'Add Sub'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Subcontractors() {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('all');
  const [modal, setModal] = useState(null); // null | { sub?: sub }
  const [toast, setToast] = useState(null);

  useEffect(() => { loadSubs(); }, []);

  async function loadSubs() {
    const { data } = await supabase.from('subcontractors').select('*').order('name');
    setSubs(data || []);
    setLoading(false);
  }

  async function saveSub(form) {
    if (form.id) {
      const { data } = await supabase.from('subcontractors').update(form).eq('id', form.id).select().single();
      setSubs((p) => p.map((s) => (s.id === form.id ? data : s)));
      setToast({ type: 'success', message: 'Subcontractor updated' });
    } else {
      const { data } = await supabase.from('subcontractors').insert([{ ...form, created_at: new Date().toISOString() }]).select().single();
      setSubs((p) => [...p, data]);
      setToast({ type: 'success', message: 'Subcontractor added' });
    }
    setModal(null);
  }

  async function deleteSub(id) {
    if (!confirm('Delete this subcontractor?')) return;
    await supabase.from('subcontractors').delete().eq('id', id);
    setSubs((p) => p.filter((s) => s.id !== id));
    setToast({ type: 'success', message: 'Deleted' });
  }

  const filtered = subs.filter((s) => {
    const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.specialty?.toLowerCase().includes(search.toLowerCase());
    const matchSpec = specialty === 'all' || s.specialty === specialty;
    return matchSearch && matchSpec;
  });

  const specialties = ['all', ...new Set(subs.map((s) => s.specialty).filter(Boolean))];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {modal && <SubModal sub={modal.sub} onSave={saveSub} onClose={() => setModal(null)} />}

      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-omega-charcoal">Subcontractors</h1>
          <p className="text-xs text-omega-stone">{subs.length} in database</p>
        </div>
        <button onClick={() => setModal({})} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
          <Plus className="w-4 h-4" />
          Add Sub
        </button>
      </div>

      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or specialty..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-omega-orange transition-colors bg-omega-cloud" />
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {specialties.map((s) => (
            <button key={s} onClick={() => setSpecialty(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${specialty === s ? 'bg-omega-orange text-white' : 'bg-gray-100 text-omega-slate hover:bg-gray-200'}`}>
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size={32} /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Users className="w-12 h-12 text-omega-fog mb-3" />
            <p className="font-semibold text-omega-charcoal mb-1">No subcontractors found</p>
            <button onClick={() => setModal({})} className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
              <UserPlus className="w-4 h-4" />Add First Sub
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((sub) => (
              <div key={sub.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-omega-orange/40 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-omega-orange">{sub.name?.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-omega-charcoal text-sm">{sub.name}</p>
                      {sub.specialty && <span className="text-xs font-medium text-omega-orange">{sub.specialty}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setModal({ sub })} className="p-1.5 rounded-lg text-omega-fog hover:text-omega-orange transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteSub(sub.id)} className="p-1.5 rounded-lg text-omega-fog hover:text-omega-danger transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {sub.phone && <a href={`tel:${sub.phone}`} className="flex items-center gap-2 text-xs text-omega-stone hover:text-omega-orange transition-colors"><Phone className="w-3.5 h-3.5" />{sub.phone}</a>}
                  {sub.email && <a href={`mailto:${sub.email}`} className="flex items-center gap-2 text-xs text-omega-stone hover:text-omega-orange transition-colors"><Mail className="w-3.5 h-3.5" />{sub.email}</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
