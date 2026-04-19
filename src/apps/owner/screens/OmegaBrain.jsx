import { useState, useEffect } from 'react';
import { Brain, Plus, Trash2, Save, Lightbulb } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

export default function OmegaBrain() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => { loadEntries(); }, []);

  async function loadEntries() {
    setLoading(true);
    const { data } = await supabase
      .from('omega_brain')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }

  async function handleSave() {
    if (!entry.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('omega_brain').insert([{ entry: entry.trim(), active: true }]);
      if (error) throw error;
      setEntry('');
      setToast({ type: 'success', message: 'Saved to Omega Brain!' });
      loadEntries();
    } catch {
      setToast({ type: 'error', message: 'Failed to save. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      const { error } = await supabase.from('omega_brain').update({ active: false }).eq('id', id);
      if (error) throw error;
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setToast({ type: 'error', message: 'Failed to delete.' });
    } finally {
      setDeletingId(null);
    }
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center">
            <Brain className="w-5 h-5 text-omega-orange" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-omega-charcoal">Omega Brain</h1>
            <p className="text-xs text-omega-stone">Train Omega AI with real project data — injected into every report and estimate</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* How it works */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-omega-pale border border-omega-orange/20">
            <Lightbulb className="w-5 h-5 text-omega-orange flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-omega-charcoal">How it works</p>
              <p className="text-sm text-omega-stone mt-0.5">Every entry you save here is automatically injected into all Omega AI report and pricing generations. The more real data you add, the more accurate the estimates become over time.</p>
            </div>
          </div>

          {/* Input */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-omega-charcoal mb-3">Add Knowledge</p>
            <textarea
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="Tell Omega AI what you learned... e.g. 'On the Mariano basement job, framing cost $1,200 not $1,500 as estimated because the ceiling was already prepped' or 'In Westport, tile labor runs $18–22/sqft not $15 as the market average shows' or 'Always add 15% buffer on demo in older Westport homes — lead paint abatement common'"
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors resize-none text-sm leading-relaxed"
            />
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-omega-stone">{entry.length} characters</p>
              <button
                onClick={handleSave}
                disabled={saving || !entry.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-omega-orange text-white font-semibold text-sm hover:bg-omega-dark disabled:opacity-50 transition-colors"
              >
                {saving ? <LoadingSpinner size={14} color="text-white" /> : <Plus className="w-4 h-4" />}
                Save to Brain
              </button>
            </div>
          </div>

          {/* Log */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-omega-charcoal">Knowledge Log</p>
              <p className="text-xs text-omega-stone">{entries.length} entries active</p>
            </div>

            {loading ? (
              <div className="flex justify-center py-8"><LoadingSpinner size={24} /></div>
            ) : entries.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                <Brain className="w-10 h-10 text-omega-fog mx-auto mb-3" />
                <p className="font-semibold text-omega-charcoal mb-1">No knowledge yet</p>
                <p className="text-sm text-omega-stone">Add your first real-project observation above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((e) => (
                  <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-omega-charcoal leading-relaxed">{e.entry}</p>
                        <p className="text-xs text-omega-stone mt-2">{formatDate(e.created_at)}</p>
                      </div>
                      <button
                        onClick={() => handleDelete(e.id)}
                        disabled={deletingId === e.id}
                        className="p-1.5 rounded-lg text-omega-fog hover:text-omega-danger hover:bg-red-50 transition-colors flex-shrink-0"
                      >
                        {deletingId === e.id ? <LoadingSpinner size={14} /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
