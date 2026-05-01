import { useState, useEffect, useMemo } from 'react';
import { Plus, Upload, Send, AlertTriangle, X, Edit3, Trash2, Save, FileDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createEnvelope } from '../../../shared/lib/docusign';
import { downloadSubAgreementPdf } from '../../../shared/lib/subAgreementPdf';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import COIBadge, { getCoiState } from '../components/COIBadge';
import SubcontractorCardsView from '../components/SubcontractorCardsView';
import { logAudit } from '../../../shared/lib/audit';
import { subInlineLabel } from '../../../shared/lib/subcontractor';
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
    insurance_company: '', insurance_policy_number: '', coi_expiry_date: '',
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
      coi_expiry_date: sub.coi_expiry_date || '',
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
      setSubForm({ name: '', contact_name: '', trade: '', phone: '', email: '', tax_id: '', insurance_company: '', insurance_policy_number: '', coi_expiry_date: '', preferred_language: 'en' });
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
            { id: 'subs',       label: 'Roster' },
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
            onEditSub={openEditSub}
          />
        )}

        {tab === 'subs' && (
          <>
            {expiringCount > 0 && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
                <p className="text-sm text-amber-800 font-medium">
                  {expiringCount} subcontractor(s) have a COI expiring within 30 days or already expired.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={() => setShowAddSub(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
                <Plus className="w-4 h-4" /> Add Subcontractor
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Trade</th>
                    <th className="px-4 py-3 text-left">Tax ID</th>
                    <th className="px-4 py-3 text-left">Phone</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">COI</th>
                    <th className="px-4 py-3 text-left">Expiry</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {subs.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-omega-stone">No subcontractors yet.</td></tr>
                  )}
                  {subs.map((s) => (
                    <tr key={s.id} className="hover:bg-omega-cloud/40">
                      <td className="px-4 py-3 font-medium text-omega-charcoal">{s.name}</td>
                      <td className="px-4 py-3">{s.trade || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{maskTaxId(s.tax_id)}</td>
                      <td className="px-4 py-3">{s.phone || '—'}</td>
                      <td className="px-4 py-3">{s.email || '—'}</td>
                      <td className="px-4 py-3"><COIBadge expiryDate={s.coi_expiry_date} /></td>
                      <td className="px-4 py-3">{s.coi_expiry_date ? new Date(s.coi_expiry_date).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap gap-2 justify-end">
                          <label className="inline-flex items-center gap-1 text-xs font-semibold text-omega-info hover:text-blue-900 cursor-pointer">
                            <Upload className="w-3.5 h-3.5" /> COI
                            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => uploadCoiFor(s, e.target.files?.[0])} />
                          </label>
                          <button onClick={() => openEditSub(s)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark">
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={() => setDeleteSub(s)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'agreements' && (
          <>
            <div className="flex justify-end">
              <button onClick={() => setShowAddAgr(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
                <Plus className="w-4 h-4" /> New Agreement
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Sub</th>
                    <th className="px-4 py-3 text-left">Job</th>
                    <th className="px-4 py-3 text-left">Scope</th>
                    <th className="px-4 py-3 text-left">Amount</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Start</th>
                    <th className="px-4 py-3 text-left">End</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {agreements.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-omega-stone">No agreements yet.</td></tr>
                  )}
                  {agreements.map((a) => {
                    const sub = subs.find((s) => s.id === a.subcontractor_id);
                    const job = jobs.find((j) => j.id === a.job_id);
                    return (
                      <tr key={a.id} className="hover:bg-omega-cloud/40">
                        <td className="px-4 py-3 font-medium text-omega-charcoal">{sub ? subInlineLabel(sub) : '—'}</td>
                        <td className="px-4 py-3">{job?.client_name || job?.name || '—'}</td>
                        <td className="px-4 py-3 max-w-xs truncate">{a.scope_of_work || '—'}</td>
                        <td className="px-4 py-3">${Number(a.their_estimate || 0).toLocaleString()}</td>
                        <td className="px-4 py-3"><StatusBadge status={a.docusign_status || a.status} /></td>
                        <td className="px-4 py-3">{a.start_date || '—'}</td>
                        <td className="px-4 py-3">{a.end_date || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
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
                { k: 'insurance_policy_number',  label: 'Policy Number' },
                { k: 'coi_expiry_date',          label: 'COI Expiry Date', type: 'date' },
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
                { k: 'insurance_policy_number',  label: 'Policy Number' },
                { k: 'coi_expiry_date',          label: 'COI Expiry Date', type: 'date' },
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
    </div>
  );
}
