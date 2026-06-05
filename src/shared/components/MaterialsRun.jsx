import { useEffect, useState } from 'react';
import { ShoppingCart, Store, Check, Loader2, Filter, Plus, X } from 'lucide-react';
import PageHeader from './ui/PageHeader';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

/**
 * Manager's aggregated "next run" shopping list. Reads every material
 * in status='needed' across jobs that are still active (pipeline is
 * not completed/rejected), grouped by store. Each row can be ticked as
 * bought right from here — Gabriel's one-screen checkout flow.
 *
 * Also offers a "Quick add" inline form so Gabriel can drop a material
 * straight onto the shopping list without navigating to a job first.
 * The job is still required (every material belongs to one) but the
 * dropdown makes it a two-tap flow.
 */
const EXCLUDED_PIPELINE = ['completed', 'estimate_rejected'];
const STORES = ['Home Depot', 'Lowes', "Ring's End", 'Ferguson', 'Other'];

export default function MaterialsRun({ user }) {
  const [rows, setRows]       = useState([]);
  const [activeJobs, setActiveJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStore, setFilterStore] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      // Two parallel queries + client-side join. Avoids relying on the
      // PostgREST schema cache recognising the FK.
      const [matsRes, jobsRes] = await Promise.all([
        supabase
          .from('job_materials')
          .select('*')
          .eq('status', 'needed')
          .order('added_at', { ascending: false }),
        supabase
          .from('jobs')
          .select('id, client_name, city, service, pipeline_status'),
      ]);
      const mats = matsRes.data || [];
      const jobs = jobsRes.data || [];
      const jobById = new Map(jobs.map((j) => [j.id, j]));

      // Attach job info + drop materials tied to closed/rejected jobs.
      const live = mats
        .map((m) => ({ ...m, jobs: jobById.get(m.job_id) || null }))
        .filter((m) => m.jobs && !EXCLUDED_PIPELINE.includes(m.jobs.pipeline_status));

      setRows(live);
      // Jobs available for "Quick add" = only currently active ones.
      setActiveJobs(jobs.filter((j) => !EXCLUDED_PIPELINE.includes(j.pipeline_status)));
    } catch { setRows([]); }
    setLoading(false);
  }

  async function addMaterial({ jobId, name, quantity, store, notes }) {
    const { data, error } = await supabase.from('job_materials').insert([{
      job_id: jobId,
      name: name.trim(),
      quantity: quantity.trim() || null,
      store: store || null,
      notes: notes.trim() || null,
      added_by: user?.name || null,
    }]).select().single();
    if (error) throw error;
    // Re-attach job info so the new row renders correctly.
    const job = activeJobs.find((j) => j.id === jobId) || null;
    setRows((prev) => [{ ...data, jobs: job }, ...prev]);
    logAudit({ user, action: 'material.add', entityType: 'job_material', entityId: data.id, details: { job_id: jobId, name: data.name } });
  }

  async function markBought(item) {
    try {
      const { data } = await supabase.from('job_materials').update({
        status: 'bought',
        bought_at: new Date().toISOString(),
        bought_by: user?.name || null,
      }).eq('id', item.id).select().single();
      if (data) setRows((prev) => prev.filter((r) => r.id !== item.id));
      logAudit({ user, action: 'material.bought', entityType: 'job_material', entityId: item.id });
    } catch { /* ignore */ }
  }

  const stores = Array.from(new Set(rows.map((r) => r.store || 'Unspecified'))).sort();
  const filtered = filterStore === 'all' ? rows : rows.filter((r) => (r.store || 'Unspecified') === filterStore);

  const byStore = {};
  for (const it of filtered) {
    const k = it.store || 'Unspecified';
    (byStore[k] = byStore[k] || []).push(it);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <PageHeader
        icon={ShoppingCart}
        title="Materials Run"
        subtitle="Shopping list across all active jobs. Tick items as you buy them."
      />

      {/* Count + add — kept below the header (no buttons in the head). */}
      <div className="px-4 sm:px-6 py-3 bg-white border-b border-gray-200 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-omega-stone bg-gray-100 px-2 py-0.5 rounded-full">
          {rows.length} items
        </span>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold"
          >
            <Plus className="w-4 h-4" /> Add Material
          </button>
        )}
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {showAdd && (
          <QuickAddForm
            jobs={activeJobs}
            onCancel={() => setShowAdd(false)}
            onSaved={async (payload) => {
              await addMaterial(payload);
              setShowAdd(false);
            }}
          />
        )}

        {/* Store filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-omega-stone inline-flex items-center gap-1">
            <Filter className="w-3 h-3" /> Store:
          </span>
          <button
            onClick={() => setFilterStore('all')}
            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
              filterStore === 'all' ? 'bg-omega-orange text-white' : 'bg-white text-omega-charcoal border border-gray-200'
            }`}
          >
            All
          </button>
          {stores.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStore(s)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${
                filterStore === s ? 'bg-omega-orange text-white' : 'bg-white text-omega-charcoal border border-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-omega-stone">Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <ShoppingCart className="w-10 h-10 text-omega-stone/40 mx-auto mb-3" />
            <p className="text-sm text-omega-charcoal font-bold">Nothing to buy.</p>
            <p className="text-xs text-omega-stone mt-1">Add materials from each job's Materials section.</p>
          </div>
        )}

        {Object.entries(byStore).map(([store, items]) => (
          <section key={store} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-omega-orange" />
                <p className="text-sm font-bold text-omega-charcoal">{store}</p>
              </div>
              <span className="text-[11px] font-bold text-omega-stone">{items.length} items</span>
            </div>
            <div className="divide-y divide-gray-100">
              {items.map((m) => (
                <div key={m.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                  <button
                    onClick={() => markBought(m)}
                    className="mt-0.5 w-5 h-5 rounded border-2 border-gray-300 hover:border-omega-orange hover:bg-omega-pale flex items-center justify-center flex-shrink-0"
                    title="Mark bought"
                  >
                    <Check className="w-3 h-3 text-omega-orange opacity-0 group-hover:opacity-100" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-omega-charcoal">{m.name}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-omega-stone mt-0.5">
                      {m.quantity && <span className="font-semibold">{m.quantity}</span>}
                      {m.jobs?.client_name && <span>· {m.jobs.client_name}</span>}
                      {m.jobs?.city && <span>· {m.jobs.city}</span>}
                      {m.jobs?.service && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold uppercase">
                          {m.jobs.service}
                        </span>
                      )}
                      {m.notes && <span className="italic">· {m.notes}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Inline "Quick add" form ────────────────────────────────────
// Drops a new needed material tied to an active job. Name + job are
// required; everything else is optional. No modal — the form expands
// inline so Gabriel stays on this screen while he types.
function QuickAddForm({ jobs, onCancel, onSaved }) {
  const [jobId, setJobId]       = useState('');
  const [name, setName]         = useState('');
  const [quantity, setQuantity] = useState('');
  const [store, setStore]       = useState('');
  const [notes, setNotes]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  async function submit() {
    if (!name.trim())  { setError('Name is required'); return; }
    if (!jobId)        { setError('Pick a job'); return; }
    setSaving(true);
    setError('');
    try {
      await onSaved({ jobId, name, quantity, store, notes });
    } catch (e) {
      setError(e?.message || 'Failed to save');
    }
    setSaving(false);
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-omega-orange/40 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-omega-charcoal inline-flex items-center gap-2">
          <Plus className="w-4 h-4 text-omega-orange" /> Add Material
        </h3>
        <button onClick={onCancel} className="p-1 rounded-lg text-omega-stone hover:bg-gray-100">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-1 block">Material *</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Quartz countertop slab, Calacatta"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-1 block">Quantity</label>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="2 slabs"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-1 block">Store</label>
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
            >
              <option value="">Select…</option>
              {STORES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-1 block">Job *</label>
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
          >
            <option value="">Select job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.client_name} {j.service ? `· ${j.service}` : ''} {j.city ? `· ${j.city}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-1 block">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the buyer should know"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
          />
        </div>
        {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-bold text-omega-slate hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
        >
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Plus className="w-3.5 h-3.5" /> Add</>}
        </button>
      </div>
    </div>
  );
}
