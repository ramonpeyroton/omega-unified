import { useEffect, useState } from 'react';
import { HardHat, Plus, X, DollarSign, FileText, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

// Status chip palette — agreement.status comes from a small whitelist
// the rest of the app already understands.
const STATUS_META = {
  draft:     { label: 'DRAFT',     cls: 'bg-gray-200 text-gray-700' },
  sent:      { label: 'SENT',      cls: 'bg-blue-100 text-blue-700' },
  accepted:  { label: 'ACCEPTED',  cls: 'bg-green-100 text-green-700' },
  rejected:  { label: 'REJECTED',  cls: 'bg-red-100 text-red-700' },
  signed:    { label: 'SIGNED',    cls: 'bg-emerald-600 text-white' },
  completed: { label: 'COMPLETED', cls: 'bg-emerald-700 text-white' },
};

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─────────────────────────────────────────────────────────────────────
// Subcontractors panel inside JobFullView. Lists every agreement linked
// to this job and lets Owner / Operations / Sales (per role gating in
// the parent) assign a new sub with a tight inline form.
//
// The full Accept/Reject workflow (SMS the sub a unique link, capture
// their response, auto-generate a signed agreement) lives outside this
// section — it'll arrive in Sprint 4 of the rebuild. For now this is
// the minimum viable: pick a sub, write the scope and number, save.
// ─────────────────────────────────────────────────────────────────────
export default function JobSubcontractorsSection({ job, user }) {
  const [agreements, setAgreements] = useState([]);
  const [subs,       setSubs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [adding,     setAdding]     = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  const [form, setForm] = useState({
    subcontractor_id: '',
    scope_of_work:    '',
    their_estimate:   '',
    payment_terms:    'multiple', // single | 50_50 | multiple
  });

  useEffect(() => { if (job?.id) load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      // Pull every agreement on this job + the active sub catalog so the
      // dropdown only offers people we can actually reach.
      const [{ data: agr }, { data: subRows }] = await Promise.all([
        supabase.from('subcontractor_agreements')
          .select('*, subcontractors(name, trade, phone, email)')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false }),
        supabase.from('subcontractors')
          .select('id, name, trade, phone')
          .order('name'),
      ]);
      setAgreements(agr || []);
      setSubs(subRows || []);
    } catch (e) {
      setError(e?.message || 'Failed to load subcontractors');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({ subcontractor_id: '', scope_of_work: '', their_estimate: '', payment_terms: 'multiple' });
    setError('');
  }

  async function saveAgreement() {
    if (!form.subcontractor_id) { setError('Pick a subcontractor.'); return; }
    if (!form.scope_of_work.trim()) { setError('Describe the scope of work.'); return; }
    setSaving(true);
    setError('');
    try {
      // Translate the friendly payment term into the JSONB shape the
      // rest of the app uses on `subcontractor_agreements.payment_plan`.
      // The seller can refine this later — this is the default starting
      // point so Brenda doesn't stare at an empty field.
      const payment_plan = form.payment_terms === 'single'
        ? [{ label: 'Upon completion', percent: 100 }]
        : form.payment_terms === '50_50'
          ? [{ label: 'Deposit', percent: 50 }, { label: 'Upon completion', percent: 50 }]
          : [{ label: 'Deposit', percent: 30 }, { label: 'Mid-project', percent: 40 }, { label: 'Upon completion', percent: 30 }];

      const { data, error } = await supabase.from('subcontractor_agreements').insert([{
        job_id:           job.id,
        subcontractor_id: form.subcontractor_id,
        scope_of_work:    form.scope_of_work.trim(),
        their_estimate:   Number(form.their_estimate) || 0,
        payment_plan,
        status:           'draft',
      }]).select('*, subcontractors(name, trade, phone, email)').single();
      if (error) throw error;

      setAgreements((prev) => [data, ...prev]);
      logAudit({ user, action: 'subcontractor.assign', entityType: 'subcontractor_agreement',
                 entityId: data.id, details: { job_id: job.id, sub_id: form.subcontractor_id } });
      resetForm();
      setAdding(false);
    } catch (e) {
      setError(e?.message || 'Failed to save assignment');
    } finally {
      setSaving(false);
    }
  }

  async function removeAgreement(id) {
    if (!confirm('Remove this subcontractor assignment?')) return;
    try {
      await supabase.from('subcontractor_agreements').delete().eq('id', id);
      setAgreements((prev) => prev.filter((a) => a.id !== id));
      logAudit({ user, action: 'subcontractor.unassign', entityType: 'subcontractor_agreement', entityId: id });
    } catch (e) {
      setError(e?.message || 'Failed to remove assignment');
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <p className="text-sm text-omega-stone">Loading subcontractors…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
              <HardHat className="w-4 h-4 text-omega-orange" /> Subcontractors
            </h2>
            <p className="text-xs text-omega-stone mt-0.5">
              {agreements.length === 0
                ? 'No subs assigned yet. Add one with the button on the right.'
                : `${agreements.length} ${agreements.length === 1 ? 'sub assigned' : 'subs assigned'} on this project`}
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold shadow-sm flex-shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Assign Sub
            </button>
          )}
        </div>

        {/* Add form */}
        {adding && (
          <div className="p-4 sm:p-6 bg-omega-pale/40 border-b border-omega-orange/20 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-omega-charcoal">New assignment</h3>
              <button
                type="button"
                onClick={() => { resetForm(); setAdding(false); }}
                className="p-1.5 rounded-lg hover:bg-white"
                aria-label="Cancel"
              >
                <X className="w-4 h-4 text-omega-stone" />
              </button>
            </div>

            <label className="block">
              <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Subcontractor</span>
              <select
                value={form.subcontractor_id}
                onChange={(e) => setForm({ ...form, subcontractor_id: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
              >
                <option value="">Pick a sub…</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.trade ? ` — ${s.trade}` : ''}
                  </option>
                ))}
              </select>
              {subs.length === 0 && (
                <p className="text-[11px] text-red-600 mt-1">
                  No subcontractors in the catalog yet — Brenda needs to add one first.
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Scope of Work</span>
              <textarea
                rows={3}
                value={form.scope_of_work}
                onChange={(e) => setForm({ ...form, scope_of_work: e.target.value })}
                placeholder='e.g. "Demolition of existing bathroom — tub, vanity, tile, floor"'
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Their estimate ($)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.their_estimate}
                  onChange={(e) => setForm({ ...form, their_estimate: e.target.value })}
                  placeholder="2500"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Payment terms</span>
                <select
                  value={form.payment_terms}
                  onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
                >
                  <option value="single">Pay 100% on completion</option>
                  <option value="50_50">Deposit 50% / Completion 50%</option>
                  <option value="multiple">Multiple (30 / 40 / 30)</option>
                </select>
              </label>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-xs font-semibold">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { resetForm(); setAdding(false); }}
                disabled={saving}
                className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-omega-stone hover:border-omega-orange disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAgreement}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold disabled:opacity-60"
              >
                {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save assignment'}
              </button>
            </div>
          </div>
        )}

        {/* Existing assignments */}
        {agreements.length === 0 && !adding && (
          <div className="px-4 sm:px-6 py-10 text-center text-omega-stone">
            <HardHat className="w-8 h-8 text-omega-fog mx-auto mb-2" />
            <p className="text-sm">No subcontractors assigned yet.</p>
            <p className="text-xs mt-1">Click <strong>Assign Sub</strong> to designate the first one.</p>
          </div>
        )}

        {agreements.map((a) => {
          const meta = STATUS_META[a.status] || { label: (a.status || 'DRAFT').toUpperCase(), cls: 'bg-gray-200 text-gray-700' };
          const subInfo = a.subcontractors || {};
          return (
            <div key={a.id} className="px-4 sm:px-6 py-4 border-t border-gray-100 hover:bg-omega-pale/20 group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-omega-pale flex items-center justify-center flex-shrink-0">
                  <HardHat className="w-4 h-4 text-omega-orange" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-bold text-omega-charcoal">
                      {subInfo.name || 'Sub removed'}
                    </p>
                    {subInfo.trade && (
                      <span className="text-[10px] uppercase tracking-wider text-omega-stone font-bold">
                        {subInfo.trade}
                      </span>
                    )}
                    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-omega-slate whitespace-pre-line">{a.scope_of_work}</p>
                  <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-omega-stone">
                    {a.their_estimate > 0 && (
                      <span className="inline-flex items-center gap-1 font-bold text-omega-charcoal">
                        <DollarSign className="w-3 h-3" /> {money(a.their_estimate)}
                      </span>
                    )}
                    {Array.isArray(a.payment_plan) && a.payment_plan.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {a.payment_plan.map((p) => `${p.percent}%`).join(' / ')}
                      </span>
                    )}
                    {a.signed_at && (
                      <span>Signed {new Date(a.signed_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAgreement(a.id)}
                  className="p-1.5 rounded-lg text-omega-stone hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  title="Remove assignment"
                  aria-label="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
