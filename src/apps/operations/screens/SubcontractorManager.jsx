import { useState, useEffect, useMemo } from 'react';
import { Plus, Upload, Send, AlertTriangle, X, Edit3, Trash2, Save, FileDown, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createEnvelope } from '../../../shared/lib/docusign';
import { downloadSubAgreementPdf } from '../../../shared/lib/subAgreementPdf';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import COIBadge, { getCoiState } from '../components/COIBadge';
import SubcontractorCardsView from '../components/SubcontractorCardsView';
import { logAudit } from '../../../shared/lib/audit';
import { subInlineLabel, subDisplayNames } from '../../../shared/lib/subcontractor';
import { formatPhoneInput, toE164 } from '../../../shared/lib/phone';

// Mirrors the same flag EstimateFlow uses. When the env var isn't '1',
// DocuSign API endpoints aren't deployed (api/docusign/* don't exist
// yet), so we route the agreement through the local PDF fallback
// instead of 404-ing against /api/docusign/create-envelope.
const DOCUSIGN_CLIENT_ENABLED = import.meta.env?.VITE_DOCUSIGN_ENABLED === '1';

// Curated list of trades shown as autocomplete suggestions in the
// Add/Edit Sub forms. <datalist> means Brenda can pick one with a
// click OR type something custom (e.g. "Cabinet refinishing") that
// isn't on the list — best of both worlds vs. a hard <select>.
const TRADE_OPTIONS = [
  'Demolition',
  'Framing / Carpentry',
  'Plumbing',
  'Electrical',
  'HVAC',
  'Insulation',
  'Drywall / Sheetrock',
  'Taping / Mudding',
  'Tile',
  'Flooring',
  'Hardwood',
  'Painting',
  'Roofing',
  'Siding',
  'Masonry / Concrete',
  'Excavation',
  'Glass / Windows',
  'Doors / Trim',
  'Cabinetry',
  'Countertop',
  'Plumbing Fixtures',
  'Appliances',
  'Cleaning',
  'Landscaping',
  'Decking',
  'Survey',
  'Building Plans',
];

function maskTaxId(taxId) {
  if (!taxId) return '—';
  const s = String(taxId);
  if (s.length <= 4) return '••••';
  return '•'.repeat(s.length - 4) + s.slice(-4);
}

export default function SubcontractorManager({ user }) {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('cards');

  // modals
  const [showAddSub, setShowAddSub] = useState(false);
  const [showAddAgr, setShowAddAgr] = useState(false);
  const [subForm, setSubForm] = useState({
    name: '', contact_name: '', trade: '', phone: '', email: '', tax_id: '',
    insurance_company: '', insurance_policy_number: '', workers_comp_expiry: '', general_liability_expiry: '',
    // Sub-facing pages (offer Accept/Reject) translate based on this.
    // The internal app stays in English no matter what.
    preferred_language: 'en',
  });
  const [coiFile, setCoiFile] = useState(null);
  const [editSub, setEditSub] = useState(null); // sub row being edited
  const [editForm, setEditForm] = useState(null);
  const [editCoiFile, setEditCoiFile] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteSub, setDeleteSub] = useState(null);
  const [deletingSub, setDeletingSub] = useState(false);
  const [agrForm, setAgrForm] = useState({
    job_id: '', subcontractor_id: '', scope_of_work: '',
    their_estimate: 0, payment_plan: [], start_date: '', end_date: '',
  });
  // Profile modal — opens when the seller clicks a card in the Cards
  // tab. Shows the full sub profile with an "Edit profile" button.
  const [profileSub, setProfileSub] = useState(null);
  // Agreement detail modal — opens when the seller clicks an agreement
  // card in the Agreements tab. Shows the saved metadata, lets them
  // re-download the printable PDF, and offers a delete option.
  const [openAgreement, setOpenAgreement] = useState(null);
  const [deletingAgreement, setDeletingAgreement] = useState(false);
  // Free-text search box on the Agreements tab.
  const [agrSearch, setAgrSearch] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: s }, { data: a }, { data: j }] = await Promise.all([
        supabase.from('subcontractors').select('*').order('name'),
        supabase.from('subcontractor_agreements').select('*').order('created_at', { ascending: false }),
        supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      ]);
      setSubs(s || []);
      setAgreements(a || []);
      setJobs(j || []);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load subcontractors' });
    } finally {
      setLoading(false);
    }
  }

  const expiringCount = useMemo(
    () => subs.filter((s) => {
      const { state } = getCoiState(s.coi_expiry_date);
      return state === 'expiring' || state === 'expired';
    }).length,
    [subs]
  );

  async function uploadCoi(subId, file) {
    if (!file) return null;
    const path = `coi/${subId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('subcontractor-docs').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('subcontractor-docs').getPublicUrl(path);
    return data?.publicUrl || null;
  }

  function openEditSub(sub) {
    setEditSub(sub);
    setEditForm({
      name: sub.name || '',
      contact_name: sub.contact_name || '',
      trade: sub.trade || '',
      phone: sub.phone || '',
      email: sub.email || '',
      tax_id: sub.tax_id || '',
      preferred_language: sub.preferred_language || 'en',
      insurance_company: sub.insurance_company || '',
      insurance_policy_number: sub.insurance_policy_number || '',
      workers_comp_expiry: sub.workers_comp_expiry || '',
      general_liability_expiry: sub.general_liability_expiry || '',
    });
    setEditCoiFile(null);
  }

  async function saveEditSub(e) {
    e.preventDefault();
    setSavingEdit(true);
    try {
      // Convert empty strings to null so Postgres accepts typed columns
      // (date), and normalize phone to E.164 for Twilio.
      const patch = Object.fromEntries(
        Object.entries(editForm).map(([k, v]) => {
          if (v === '') return [k, null];
          if (k === 'phone' && v) return [k, toE164(v) || v];
          return [k, v];
        })
      );
      if (editCoiFile) {
        try {
          const url = await uploadCoi(editSub.id, editCoiFile);
          if (url) patch.coi_url = url;
        } catch { /* ignore upload error */ }
      }
      const { data, error } = await supabase.from('subcontractors').update(patch).eq('id', editSub.id).select().single();
      if (error) throw error;
      setSubs((prev) => prev.map((s) => s.id === data.id ? data : s));
      logAudit({ user, action: 'subcontractor.update', entityType: 'subcontractor', entityId: data.id, details: { name: data.name } });
      setToast({ type: 'success', message: 'Subcontractor updated' });
      setEditSub(null);
      setEditForm(null);
      setEditCoiFile(null);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to update subcontractor' });
    } finally {
      setSavingEdit(false);
    }
  }

  // Count agreements that are active for a given sub (pending/sent/signed,
  // i.e. not explicitly cancelled or declined).
  function activeAgreementsFor(subId) {
    return agreements.filter((a) => a.subcontractor_id === subId && !['declined', 'cancelled'].includes((a.status || '').toLowerCase()));
  }

  // Delete a single agreement row (used when an agreement was cancelled
  // and is being re-issued). Triggered from the AgreementDetailModal.
  // The row is hard-deleted — there's no soft-delete column on
  // subcontractor_agreements yet. If we add one later, this is the
  // place to flip it instead.
  async function confirmDeleteAgreement() {
    if (!openAgreement) return;
    setDeletingAgreement(true);
    try {
      const { error } = await supabase.from('subcontractor_agreements').delete().eq('id', openAgreement.id);
      if (error) throw error;
      setAgreements((prev) => prev.filter((a) => a.id !== openAgreement.id));
      logAudit({
        user: null,
        action: 'sub_agreement.delete',
        entityType: 'subcontractor_agreement',
        entityId: openAgreement.id,
        details: { sub_id: openAgreement.subcontractor_id, job_id: openAgreement.job_id },
      });
      setToast({ type: 'success', message: 'Agreement deleted' });
      setOpenAgreement(null);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to delete agreement' });
    } finally {
      setDeletingAgreement(false);
    }
  }

  async function confirmDeleteSub() {
    if (!deleteSub) return;
    // Hard-block if the sub has active agreements — per spec we do NOT delete
    const active = activeAgreementsFor(deleteSub.id);
    if (active.length > 0) {
      setToast({ type: 'warning', message: 'This subcontractor has active agreements and was not removed.' });
      setDeleteSub(null);
      return;
    }
    setDeletingSub(true);
    try {
      const { error } = await supabase.from('subcontractors').delete().eq('id', deleteSub.id);
      if (error) throw error;
      setSubs((prev) => prev.filter((s) => s.id !== deleteSub.id));
      logAudit({ user, action: 'subcontractor.delete', entityType: 'subcontractor', entityId: deleteSub.id, details: { name: deleteSub.name } });
      setToast({ type: 'success', message: 'Subcontractor removed' });
      setDeleteSub(null);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to remove' });
    } finally {
      setDeletingSub(false);
    }
  }

  async function submitAddSub(e) {
    e.preventDefault();
    try {
      // Convert empty strings to null (Postgres rejects '' for date/numeric)
      // and normalize phone to E.164 so Twilio works everywhere.
      const payload = Object.fromEntries(
        Object.entries(subForm).map(([k, v]) => {
          if (v === '') return [k, null];
          if (k === 'phone' && v) return [k, toE164(v) || v];
          return [k, v];
        })
      );
      const { data, error } = await supabase.from('subcontractors').insert([payload]).select().single();
      if (error) throw error;
      if (coiFile) {
        try {
          const url = await uploadCoi(data.id, coiFile);
          if (url) {
            const { data: updated } = await supabase.from('subcontractors').update({ coi_url: url }).eq('id', data.id).select().single();
            if (updated) {
              setSubs((prev) => [updated, ...prev]);
            } else {
              setSubs((prev) => [data, ...prev]);
            }
          } else {
            setSubs((prev) => [data, ...prev]);
          }
        } catch (uploadErr) {
          // TODO: surface upload error more prominently; row was already created
          setSubs((prev) => [data, ...prev]);
          setToast({ type: 'warning', message: 'Sub created but COI upload failed' });
        }
      } else {
        setSubs((prev) => [data, ...prev]);
      }
      setShowAddSub(false);
      setSubForm({ name: '', contact_name: '', trade: '', phone: '', email: '', tax_id: '', insurance_company: '', insurance_policy_number: '', workers_comp_expiry: '', general_liability_expiry: '', preferred_language: 'en' });
      setCoiFile(null);
      setToast({ type: 'success', message: 'Subcontractor added' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to add subcontractor' });
    }
  }

  async function uploadCoiFor(sub, file) {
    if (!file) return;
    try {
      const url = await uploadCoi(sub.id, file);
      const { data } = await supabase.from('subcontractors').update({ coi_url: url }).eq('id', sub.id).select().single();
      if (data) {
        setSubs((prev) => prev.map((s) => s.id === data.id ? data : s));
        setToast({ type: 'success', message: 'COI uploaded' });
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Upload failed' });
    }
  }

  async function submitAddAgr(e) {
    e.preventDefault();
    if (!agrForm.job_id || !agrForm.subcontractor_id) { setToast({ type: 'warning', message: 'Select a job and a subcontractor' }); return; }

    const sub = subs.find((s) => s.id === agrForm.subcontractor_id);
    const job = jobs.find((j) => j.id === agrForm.job_id);

    try {
      // 1. Save the agreement row first so it shows up in the list even
      //    if PDF generation or DocuSign sending fails afterwards.
      const { data: created, error: insErr } = await supabase.from('subcontractor_agreements').insert([{
        job_id: agrForm.job_id,
        subcontractor_id: agrForm.subcontractor_id,
        status: 'pending',
        scope_of_work: agrForm.scope_of_work,
        their_estimate: Number(agrForm.their_estimate) || 0,
        payment_plan: agrForm.payment_plan,
        start_date: agrForm.start_date || null,
        end_date: agrForm.end_date || null,
      }]).select().single();
      if (insErr) throw insErr;

      const agreementPayload = {
        job, subcontractor: sub,
        scope: agrForm.scope_of_work,
        amount: Number(agrForm.their_estimate) || 0,
        paymentPlan: agrForm.payment_plan,
        startDate: agrForm.start_date || null,
        endDate: agrForm.end_date || null,
      };

      let updated = created;
      let successMessage = '';

      if (DOCUSIGN_CLIENT_ENABLED) {
        // 2a. DocuSign path — call /api/docusign/create-envelope, then
        //     stamp the row with the returned envelope id and "sent".
        const { envelopeId } = await createEnvelope({
          kind: 'subcontractor_agreement',
          agreementId: created.id,
          ...agreementPayload,
        });
        const { data, error: updErr } = await supabase.from('subcontractor_agreements').update({
          docusign_envelope_id: envelopeId,
          docusign_status: 'sent',
          status: 'sent',
        }).eq('id', created.id).select().single();
        if (updErr) throw updErr;
        updated = data;
        successMessage = 'Agreement sent via DocuSign';
      } else {
        // 2b. PDF fallback — DocuSign isn't wired up in this environment.
        //     Generate a printable PDF the crew can hand to the sub for
        //     a wet-ink signature. The row stays "pending" until the
        //     signed copy comes back; Brenda can mark it "signed"
        //     manually from the agreement actions.
        await downloadSubAgreementPdf(agreementPayload);
        successMessage = 'Agreement PDF downloaded — print, sign and upload the scan when it comes back.';
      }

      logAudit({
        user: null, // Operations screen — keeping the existing pattern
        action: DOCUSIGN_CLIENT_ENABLED ? 'sub_agreement.send_docusign' : 'sub_agreement.generate_pdf',
        entityType: 'subcontractor_agreement',
        entityId: created.id,
        details: { job_id: agrForm.job_id, sub_id: agrForm.subcontractor_id, amount: Number(agrForm.their_estimate) || 0 },
      });

      setAgreements((prev) => [updated, ...prev]);
      setShowAddAgr(false);
      setAgrForm({ job_id: '', subcontractor_id: '', scope_of_work: '', their_estimate: 0, payment_plan: [], start_date: '', end_date: '' });
      setToast({ type: 'success', message: successMessage });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to create agreement' });
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Shared trade autocomplete — both Add and Edit Sub forms reference
          this via <input list="omega-trades">. Pre-fills the most common
          trades Omega works with; Brenda can still type anything custom. */}
      <datalist id="omega-trades">
        {TRADE_OPTIONS.map((t) => <option key={t} value={t} />)}
      </datalist>

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-omega-charcoal">Subcontractors</h1>
        <p className="text-sm text-omega-stone mt-1">Roster, COI tracking and agreements</p>
      </header>

      {/* Tabs */}
      <div className="px-6 md:px-8 mt-4">
        <div className="border-b border-gray-200 flex gap-1">
          {[
            { id: 'cards',      label: 'Cards' },
            { id: 'agreements', label: 'Agreements' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.id ? 'border-omega-orange text-omega-orange' : 'border-transparent text-omega-stone hover:text-omega-charcoal'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 md:p-8 pt-4 space-y-4">

        {tab === 'cards' && (
          <SubcontractorCardsView
            subs={subs}
            agreements={agreements}
            jobs={jobs}
            onAddSub={() => setShowAddSub(true)}
            onAddAgreement={() => setShowAddAgr(true)}
            onSelectSub={setProfileSub}
          />
        )}

        {/* Roster tab was removed per Ramon's reorg — the Cards tab now
            covers everything the seller needs to see at a glance, and
            the per-sub profile modal (opened by clicking a card) holds
            the legacy roster fields (tax id, expiry, COI upload, etc). */}

        {tab === 'agreements' && (
          <AgreementsList
            agreements={agreements}
            subs={subs}
            jobs={jobs}
            search={agrSearch}
            onSearchChange={setAgrSearch}
            onAdd={() => setShowAddAgr(true)}
            onSelect={setOpenAgreement}
          />
        )}
      </div>

      {/* Add Sub modal */}
      {showAddSub && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowAddSub(false)}>
          <form onSubmit={submitAddSub} className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">Add Subcontractor</p>
              <button type="button" onClick={() => setShowAddSub(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                // Contact name comes first — at Omega the field crew
                // recognizes subs by the person, not the LLC, so making
                // it the very first field nudges new entries into the
                // right shape from day one.
                { k: 'contact_name', label: 'Contact Name', required: true, colSpan: 2 },
                { k: 'name',         label: 'Company Name', required: true, colSpan: 2 },
                { k: 'trade',        label: 'Trade' },
                { k: 'phone',        label: 'Phone', type: 'phone' },
                { k: 'email',        label: 'Email', type: 'email' },
                { k: 'tax_id',       label: 'Tax ID' },
                { k: 'insurance_company',        label: 'Insurance Company' },
                { k: 'insurance_policy_number',  label: 'License Number' },
                { k: 'workers_comp_expiry',      label: 'Workers Comp', type: 'date' },
                { k: 'general_liability_expiry', label: 'General Liability', type: 'date' },
              ].map((f) => (
                <div key={f.k} className={f.colSpan === 2 ? 'sm:col-span-2' : ''}>
                  <label className="text-xs font-semibold text-omega-stone uppercase">{f.label}</label>
                  {f.type === 'phone' ? (
                    <input
                      type="tel"
                      inputMode="tel"
                      value={subForm[f.k] || ''}
                      onChange={(e) => setSubForm({ ...subForm, [f.k]: formatPhoneInput(e.target.value) })}
                      placeholder="(203) 555-1234"
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                    />
                  ) : f.k === 'trade' ? (
                    <input
                      type="text"
                      list="omega-trades"
                      value={subForm[f.k] || ''}
                      onChange={(e) => setSubForm({ ...subForm, [f.k]: e.target.value })}
                      placeholder="Pick or type…"
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                    />
                  ) : (
                    <input type={f.type || 'text'} required={!!f.required} value={subForm[f.k]} onChange={(e) => setSubForm({ ...subForm, [f.k]: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  )}
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-omega-stone uppercase">Preferred Language</label>
                <select
                  value={subForm.preferred_language || 'en'}
                  onChange={(e) => setSubForm({ ...subForm, preferred_language: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                >
                  <option value="en">English</option>
                  <option value="pt">Português (PT-BR)</option>
                  <option value="es">Español</option>
                </select>
                <p className="text-[10px] text-omega-stone mt-1">
                  Sub-facing pages (Accept/Reject) will translate to this language. The internal app stays English.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-omega-stone uppercase">Upload COI (PDF)</label>
                <input type="file" accept="application/pdf" onChange={(e) => setCoiFile(e.target.files?.[0] || null)} className="mt-1 w-full text-sm" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddSub(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">Save</button>
            </div>
          </form>
        </div>
      )}

      {/* Add Agreement modal */}
      {showAddAgr && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowAddAgr(false)}>
          <form onSubmit={submitAddAgr} className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">New Subcontractor Agreement</p>
              <button type="button" onClick={() => setShowAddAgr(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Job</label>
                <select required value={agrForm.job_id} onChange={(e) => setAgrForm({ ...agrForm, job_id: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  <option value="">Select…</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.client_name || j.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Subcontractor</label>
                <select required value={agrForm.subcontractor_id} onChange={(e) => setAgrForm({ ...agrForm, subcontractor_id: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  <option value="">Select…</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-omega-stone uppercase">Scope of Work</label>
                <textarea required value={agrForm.scope_of_work} onChange={(e) => setAgrForm({ ...agrForm, scope_of_work: e.target.value })} rows={3} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Their Estimate ($)</label>
                <input type="number" required value={agrForm.their_estimate} onChange={(e) => setAgrForm({ ...agrForm, their_estimate: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Payment Schedule</label>
                <p className="text-xs text-omega-stone mt-0.5 mb-1">Enter each milestone as: Label – Percentage. One per line.</p>
                <textarea
                  rows={3}
                  placeholder={"50% on start\n50% on completion"}
                  value={(agrForm.payment_plan || []).map((m) => `${m.label} – ${m.percent}%`).join('\n')}
                  onChange={(e) => {
                    const lines = e.target.value.split('\n').filter(Boolean);
                    const parsed = lines.map((line) => {
                      const match = line.match(/^(.+?)\s*[-–]\s*(\d+)%?$/);
                      return match ? { label: match[1].trim(), percent: parseInt(match[2]) } : null;
                    }).filter(Boolean);
                    setAgrForm({ ...agrForm, payment_plan: parsed });
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
                {/* TODO: replace with visual plan builder like in EstimateFlow */}
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Start Date</label>
                <input type="date" value={agrForm.start_date} onChange={(e) => setAgrForm({ ...agrForm, start_date: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">End Date</label>
                <input type="date" value={agrForm.end_date} onChange={(e) => setAgrForm({ ...agrForm, end_date: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddAgr(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold inline-flex items-center gap-2">
                {DOCUSIGN_CLIENT_ENABLED
                  ? (<><Send className="w-4 h-4" /> Generate & Send via DocuSign</>)
                  : (<><FileDown className="w-4 h-4" /> Generate Agreement PDF</>)}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Sub modal */}
      {editSub && editForm && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => !savingEdit && setEditSub(null)}>
          <form onSubmit={saveEditSub} className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">Edit Subcontractor</p>
              <button type="button" onClick={() => setEditSub(null)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                // Contact name comes first — at Omega the field crew
                // recognizes subs by the person, not the LLC, so making
                // it the very first field nudges new entries into the
                // right shape from day one.
                { k: 'contact_name', label: 'Contact Name', required: true, colSpan: 2 },
                { k: 'name',         label: 'Company Name', required: true, colSpan: 2 },
                { k: 'trade',        label: 'Trade' },
                { k: 'phone',        label: 'Phone', type: 'phone' },
                { k: 'email',        label: 'Email', type: 'email' },
                { k: 'tax_id',       label: 'Tax ID' },
                { k: 'insurance_company',        label: 'Insurance Company' },
                { k: 'insurance_policy_number',  label: 'License Number' },
                { k: 'workers_comp_expiry',      label: 'Workers Comp', type: 'date' },
                { k: 'general_liability_expiry', label: 'General Liability', type: 'date' },
              ].map((f) => (
                <div key={f.k} className={f.colSpan === 2 ? 'sm:col-span-2' : ''}>
                  <label className="text-xs font-semibold text-omega-stone uppercase">{f.label}</label>
                  {f.type === 'phone' ? (
                    <input
                      type="tel"
                      inputMode="tel"
                      value={editForm[f.k] || ''}
                      onChange={(e) => setEditForm({ ...editForm, [f.k]: formatPhoneInput(e.target.value) })}
                      placeholder="(203) 555-1234"
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                    />
                  ) : f.k === 'trade' ? (
                    <input
                      type="text"
                      list="omega-trades"
                      value={editForm[f.k] || ''}
                      onChange={(e) => setEditForm({ ...editForm, [f.k]: e.target.value })}
                      placeholder="Pick or type…"
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                    />
                  ) : (
                    <input
                      type={f.type || 'text'}
                      required={!!f.required}
                      value={editForm[f.k] || ''}
                      onChange={(e) => setEditForm({ ...editForm, [f.k]: e.target.value })}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                    />
                  )}
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-omega-stone uppercase">Preferred Language</label>
                <select
                  value={editForm.preferred_language || 'en'}
                  onChange={(e) => setEditForm({ ...editForm, preferred_language: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                >
                  <option value="en">English</option>
                  <option value="pt">Português (PT-BR)</option>
                  <option value="es">Español</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-omega-stone uppercase">Upload new COI (optional)</label>
                <input type="file" accept="application/pdf,image/*" onChange={(e) => setEditCoiFile(e.target.files?.[0] || null)} className="mt-1 w-full text-sm" />
                {editSub.coi_url && !editCoiFile && (
                  <a href={editSub.coi_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-omega-info font-semibold mt-1 inline-block">View current COI ↗</a>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setEditSub(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button type="submit" disabled={savingEdit} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                <Save className="w-4 h-4" /> {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Sub confirmation */}
      {deleteSub && (() => {
        const active = activeAgreementsFor(deleteSub.id);
        const blocked = active.length > 0;
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !deletingSub && setDeleteSub(null)}>
            <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-gray-200">
                <p className="font-bold text-red-700 text-lg">Remove Subcontractor</p>
                <p className="text-sm text-omega-slate mt-2">
                  Are you sure you want to remove <span className="font-semibold">{deleteSub.name}</span>? This action cannot be undone.
                </p>
                {blocked && (
                  <div className="mt-3 p-3 rounded-lg border border-amber-300 bg-amber-50 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-900">
                      <strong>Warning:</strong> This subcontractor has {active.length} active agreement{active.length > 1 ? 's' : ''}. They will not be removed.
                    </p>
                  </div>
                )}
              </div>
              <div className="p-5 flex justify-end gap-2">
                <button onClick={() => setDeleteSub(null)} disabled={deletingSub} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold">
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteSub}
                  disabled={deletingSub || blocked}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold"
                >
                  <Trash2 className="w-4 h-4" /> {deletingSub ? 'Removing…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sub profile modal — opened from a Cards-tab row click. Read-only
          view of the full profile with an Edit profile button that hands
          off to the existing Edit Sub form. */}
      {profileSub && (
        <SubProfileModal
          sub={profileSub}
          agreements={agreements.filter((a) => a.subcontractor_id === profileSub.id)}
          jobs={jobs}
          onClose={() => setProfileSub(null)}
          onUploadCoi={(file) => uploadCoiFor(profileSub, file)}
          onEditProfile={() => {
            const sub = profileSub;
            setProfileSub(null);
            openEditSub(sub);
          }}
        />
      )}

      {/* Agreement detail modal — opened from a row click on the
          Agreements tab. Re-download the printable PDF or hard-delete
          the row when an agreement was cancelled. */}
      {openAgreement && (
        <AgreementDetailModal
          agreement={openAgreement}
          sub={subs.find((s) => s.id === openAgreement.subcontractor_id)}
          job={jobs.find((j) => j.id === openAgreement.job_id)}
          deleting={deletingAgreement}
          onClose={() => setOpenAgreement(null)}
          onDelete={confirmDeleteAgreement}
        />
      )}
    </div>
  );
}

// ─── AgreementsList ─────────────────────────────────────────────────
// Card-style list of agreements with a search box. Cards are clickable
// — clicking one opens the detail modal. Replaces the old wide HTML
// table that didn't fit smaller viewports and didn't scale past ~20
// rows visually.
function AgreementsList({ agreements, subs, jobs, search, onSearchChange, onAdd, onSelect }) {
  const subsById = useMemo(() => {
    const m = new Map();
    subs.forEach((s) => m.set(s.id, s));
    return m;
  }, [subs]);
  const jobsById = useMemo(() => {
    const m = new Map();
    jobs.forEach((j) => m.set(j.id, j));
    return m;
  }, [jobs]);

  const visible = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    if (!q) return agreements;
    return agreements.filter((a) => {
      const sub = subsById.get(a.subcontractor_id);
      const job = jobsById.get(a.job_id);
      const hay = [
        sub ? subInlineLabel(sub) : '',
        sub?.contact_name || '', sub?.name || '',
        sub?.phone || '', sub?.email || '', sub?.trade || '',
        job?.client_name || '', job?.address || '',
        a.scope_of_work || '',
        String(a.their_estimate || ''),
        a.status || '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [agreements, subsById, jobsById, search]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-omega-stone">
          {visible.length} of {agreements.length} agreement{agreements.length === 1 ? '' : 's'}
        </p>
        <button onClick={onAdd} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
          <Plus className="w-4 h-4" /> New Agreement
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-stone pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by sub, client, address, scope, status…"
          className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-omega-stone hover:text-omega-charcoal"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-omega-stone">
          {agreements.length === 0 ? 'No agreements yet.' : `No agreements match "${search}".`}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((a) => {
            const sub = subsById.get(a.subcontractor_id);
            const job = jobsById.get(a.job_id);
            return (
              // Use a clickable <div role="button"> instead of a <button>:
              // an actual <button> only legally accepts phrasing content,
              // and StatusBadge/inline <p> trip the React DOM-nesting
              // check at runtime. Keyboard activation is wired so screen
              // readers and keyboard users still get the button affordance.
              <div
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(a)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a); } }}
                className="cursor-pointer bg-white rounded-xl border border-gray-200 hover:border-omega-orange hover:shadow-sm transition-colors px-4 py-3 flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-omega-charcoal truncate">
                      {sub ? subInlineLabel(sub) : 'Unknown sub'}
                    </span>
                    <span className="text-xs text-omega-stone">→</span>
                    <span className="text-sm text-omega-charcoal truncate">
                      {job?.client_name || job?.name || 'Unknown client'}
                    </span>
                  </div>
                  {a.scope_of_work && (
                    <span className="block text-xs text-omega-stone truncate mt-0.5">{a.scope_of_work}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <StatusBadge status={a.docusign_status || a.status} />
                  <span className="text-sm font-black text-omega-charcoal tabular-nums">
                    ${Number(a.their_estimate || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── SubProfileModal ────────────────────────────────────────────────
// Read-only profile card opened by clicking a row in the Cards tab.
// Mirrors every field from the Add/Edit Sub forms, plus a quick
// summary of jobs and a CTA to edit. The Edit profile button hands
// off to the existing Edit Sub modal handled by the parent component.
function SubProfileModal({ sub, agreements, jobs, onClose, onEditProfile, onUploadCoi }) {
  const { primary, secondary } = subDisplayNames(sub);
  const totalValue = (agreements || []).reduce((acc, a) => acc + (Number(a.their_estimate) || 0), 0);
  const completedCount = (agreements || []).filter((a) => a.status === 'completed' || a.status === 'signed').length;
  const jobsById = useMemo(() => {
    const m = new Map();
    (jobs || []).forEach((j) => m.set(j.id, j));
    return m;
  }, [jobs]);

  const [coiDocs, setCoiDocs] = useState([]);
  const [uploadingCoi, setUploadingCoi] = useState(false);
  const [coiError, setCoiError] = useState(null);

  useEffect(() => {
    supabase
      .from('subcontractor_coi_documents')
      .select('*')
      .eq('subcontractor_id', sub.id)
      .order('uploaded_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setCoiError('Could not load COI history: ' + error.message);
        else setCoiDocs(data || []);
      });
  }, [sub.id]);

  async function handleCoiUpload(file) {
    if (!file) return;
    setUploadingCoi(true);
    try {
      const path = `coi/${sub.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('subcontractor-docs')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('subcontractor-docs').getPublicUrl(path);
      const fileUrl = pub?.publicUrl || null;
      const { data: row, error: insErr } = await supabase
        .from('subcontractor_coi_documents')
        .insert([{ subcontractor_id: sub.id, file_url: fileUrl, file_name: file.name }])
        .select().single();
      if (insErr) throw insErr;
      setCoiDocs((prev) => [row, ...prev]);
      // Also keep legacy coi_url in sync for COIBadge
      await supabase.from('subcontractors').update({ coi_url: fileUrl }).eq('id', sub.id);
    } catch (err) {
      setCoiError('Upload failed: ' + (err.message || 'Unknown error'));
    } finally {
      setUploadingCoi(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-omega-stone uppercase tracking-wider">Subcontractor</p>
            <h2 className="text-xl font-bold text-omega-charcoal mt-0.5">{primary}</h2>
            {secondary && <p className="text-sm text-omega-stone mt-0.5">{secondary}</p>}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <COIBadge expiryDate={sub.coi_expiry_date} />
              {sub.trade && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-omega-stone bg-omega-cloud border border-gray-200 px-1.5 py-0.5 rounded">
                  {sub.trade}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-omega-stone hover:text-omega-charcoal flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
          <Field label="Contact name" value={sub.contact_name} />
          <Field label="Company name" value={sub.name} />
          <Field label="Phone" value={sub.phone} />
          <Field label="Email" value={sub.email} />
          <Field label="Tax ID" value={maskTaxId(sub.tax_id)} mono />
          <Field label="Trade" value={sub.trade} />
          <Field label="Address" value={sub.address} colSpan={2} />
          <Field label="Insurance company" value={sub.insurance_company} />
          <Field label="Policy number" value={sub.insurance_policy_number} mono />
          <Field
            label="Workers Comp"
            value={sub.workers_comp_expiry ? new Date(sub.workers_comp_expiry).toLocaleDateString() : null}
          />
          <Field
            label="General Liability"
            value={sub.general_liability_expiry ? new Date(sub.general_liability_expiry).toLocaleDateString() : null}
          />
          <Field
            label="Preferred language"
            value={(() => {
              switch (sub.preferred_language) {
                case 'pt': return 'Português (PT-BR)';
                case 'es': return 'Español';
                default:   return 'English';
              }
            })()}
          />
          {/* COI History */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-omega-stone uppercase tracking-wider">COI Documents</p>
              <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                uploadingCoi
                  ? 'border-gray-200 text-omega-stone opacity-60 pointer-events-none'
                  : 'border-gray-200 hover:border-omega-orange text-omega-info'
              }`}>
                <Upload className="w-3.5 h-3.5" />
                {uploadingCoi ? 'Uploading…' : 'Upload COI'}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  disabled={uploadingCoi}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCoiUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {coiError && (
              <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg px-3 py-2">{coiError}</p>
            )}

            {coiDocs.length === 0 ? (
              <p className="text-xs text-omega-stone italic">No COI documents uploaded yet.</p>
            ) : (
              <ul className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-100">
                {coiDocs.map((doc, i) => (
                  <li key={doc.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-omega-charcoal truncate">
                        {doc.file_name || 'COI Document'}
                        {i === 0 && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-omega-success/10 text-omega-success">
                            Current
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-omega-stone mt-0.5">
                        {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-omega-info hover:text-blue-800 whitespace-nowrap"
                    >
                      View ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Summary of agreements — keeps the profile useful without
            duplicating the full Agreements tab. Click an agreement to
            jump into its detail. */}
        <div className="px-5 pb-2">
          <p className="text-[11px] font-semibold text-omega-stone uppercase tracking-wider mb-2">
            Agreements ({agreements.length}) · {completedCount} done · ${totalValue.toLocaleString()} total
          </p>
          {agreements.length === 0 ? (
            <p className="text-xs text-omega-stone italic mb-2">No agreements yet for this sub.</p>
          ) : (
            <ul className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-100 mb-2">
              {agreements.slice(0, 6).map((a) => {
                const job = jobsById.get(a.job_id);
                return (
                  <li key={a.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                    <span className="truncate flex-1 text-omega-charcoal">
                      {job?.client_name || 'Unknown client'}
                      {job?.address && <span className="text-omega-stone"> — {job.address}</span>}
                    </span>
                    <StatusBadge status={a.docusign_status || a.status} />
                    <span className="font-bold text-omega-charcoal tabular-nums flex-shrink-0">
                      ${Number(a.their_estimate || 0).toLocaleString()}
                    </span>
                  </li>
                );
              })}
              {agreements.length > 6 && (
                <li className="px-3 py-1.5 text-[11px] text-omega-stone italic text-center">
                  +{agreements.length - 6} more — see Agreements tab
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">
            Close
          </button>
          <button
            onClick={onEditProfile}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
          >
            <Edit3 className="w-4 h-4" /> Edit profile
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono = false, colSpan = 1 }) {
  const span = colSpan === 2 ? 'sm:col-span-2' : '';
  return (
    <div className={span}>
      <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">{label}</p>
      <p className={`text-sm text-omega-charcoal mt-0.5 break-words ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-omega-fog italic">—</span>}
      </p>
    </div>
  );
}

// ─── AgreementDetailModal ───────────────────────────────────────────
// Opens when the seller clicks an agreement row. Shows the saved
// metadata and offers two actions:
//   1. Re-download the printable PDF (handy when the original is lost
//      or wasn't sent yet — generated client-side via html2pdf, same
//      pipeline as the original "Generate Agreement PDF" button).
//   2. Delete the agreement row entirely. Used when an agreement was
//      cancelled and is being re-issued from scratch — confirmation is
//      gated by a yes/no prompt before the delete fires.
function AgreementDetailModal({ agreement, sub, job, deleting, onClose, onDelete }) {
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const planRows = Array.isArray(agreement.payment_plan) ? agreement.payment_plan : [];

  async function regeneratePdf() {
    setDownloadError('');
    setDownloading(true);
    try {
      await downloadSubAgreementPdf({
        job, subcontractor: sub,
        scope: agreement.scope_of_work,
        amount: Number(agreement.their_estimate) || 0,
        paymentPlan: planRows,
        startDate: agreement.start_date,
        endDate: agreement.end_date,
      });
    } catch (err) {
      setDownloadError(err?.message || 'Failed to generate PDF');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={() => !deleting && onClose()}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-omega-stone uppercase tracking-wider">Subcontractor Agreement</p>
            <h2 className="text-lg font-bold text-omega-charcoal mt-0.5">
              {sub ? subInlineLabel(sub) : 'Unknown sub'}
            </h2>
            <p className="text-sm text-omega-stone mt-0.5">
              {job?.client_name || 'Unknown client'}
              {job?.address && ` — ${job.address}`}
            </p>
            <div className="mt-2"><StatusBadge status={agreement.docusign_status || agreement.status} /></div>
          </div>
          <button onClick={onClose} className="p-1 rounded text-omega-stone hover:text-omega-charcoal flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1">Scope of work</p>
            <div className="text-sm text-omega-charcoal whitespace-pre-wrap border border-gray-100 bg-omega-cloud rounded-lg p-3">
              {agreement.scope_of_work || <span className="text-omega-fog italic">No scope recorded.</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Total" value={`$${Number(agreement.their_estimate || 0).toLocaleString()}`} />
            <Field label="Start date" value={agreement.start_date ? new Date(agreement.start_date).toLocaleDateString() : null} />
            <Field label="End date" value={agreement.end_date ? new Date(agreement.end_date).toLocaleDateString() : null} />
          </div>

          {planRows.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider mb-1">Payment plan</p>
              <ul className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-100">
                {planRows.map((p, i) => (
                  <li key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                    <span className="text-omega-charcoal">{p.label || `Milestone ${i + 1}`}</span>
                    <span className="font-bold tabular-nums">{p.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {agreement.docusign_envelope_id && (
            <Field label="DocuSign envelope" value={agreement.docusign_envelope_id} mono />
          )}

          {downloadError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {downloadError}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-red-700 font-semibold">Delete permanently?</span>
              <button
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold"
              >
                <Trash2 className="w-3.5 h-3.5" /> {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-300 text-red-700 hover:bg-red-50 text-xs font-bold"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete agreement
            </button>
          )}

          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">
              Close
            </button>
            <button
              onClick={regeneratePdf}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-semibold"
            >
              <FileDown className="w-4 h-4" /> {downloading ? 'Generating…' : 'Re-download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
