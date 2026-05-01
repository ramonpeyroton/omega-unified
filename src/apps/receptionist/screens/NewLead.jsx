import { useEffect, useState } from 'react';
import {
  Mail, MapPin, Hammer, Users, UserCheck, Calendar as CalendarIcon,
  Send, CheckCircle2, Plus, List, CalendarPlus, AlertTriangle,
  ArrowLeft, Save, FileText, Megaphone, User as UserIcon, Phone as PhoneIcon,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from '../components/Toast';
import PhoneInput from '../../../shared/components/PhoneInput';
import { toE164 } from '../../../shared/lib/phone';
import { logAudit } from '../../../shared/lib/audit';
import { StepBadge } from '../../../shared/components/JobFullView';
import { SERVICES as SHARED_SERVICES } from '../../../shared/data/services';
import { CITIES_BY_STATE, STATES, SERVICES, LEAD_SOURCES } from '../lib/leadCatalog';

// Local-storage key for the Save Draft feature. Cleared on successful
// submit so the next New Lead starts blank.
const DRAFT_KEY = 'omega_receptionist_new_lead_draft';

function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const DEFAULT_FORM = {
  lead_date: todayIso(),
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  address: '',
  unit_number: '',
  // CT default — most of Omega's leads still come from there. Switching
  // the picker rebuilds the city list (CITIES_BY_STATE).
  state: 'CT',
  city: '',
  zip: '',
  services: [],           // ← multi-select; services[0] persists in `service`
  lead_source: '',
  referral_name: '',
  notes: '',
  assigned_to: 'Attila',
  assigned_to_custom: '',
};

// ─── Reusable pieces ────────────────────────────────────────────────
function Section({ title, icon: Icon, children }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5">
      <h2 className="text-sm font-bold text-omega-charcoal uppercase tracking-wider inline-flex items-center gap-2 mb-4">
        {Icon && <Icon className="w-4 h-4 text-omega-orange" />} {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-omega-stone mt-1">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-omega-charcoal text-base focus:outline-none focus:border-omega-orange transition-colors';

// Large tap-target button used for multi-choice service + availability.
function ChoiceButton({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
        selected
          ? 'border-omega-orange bg-omega-pale text-omega-charcoal shadow-sm'
          : 'border-gray-200 bg-white text-omega-slate hover:border-omega-orange/40 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

function fmtShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

// ─── Main screen ─────────────────────────────────────────────────────
export default function NewLead({ user, onLogout, onViewLeads, onScheduleVisit }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [created, setCreated] = useState(null); // created job row on success
  const [phoneDup, setPhoneDup] = useState(null); // { client_name, lead_date, created_at } | null
  const [checkingPhone, setCheckingPhone] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function toggleService(v) {
    setForm((f) => {
      const has = f.services.includes(v);
      return { ...f, services: has ? f.services.filter((x) => x !== v) : [...f.services, v] };
    });
  }

  // Checks whether another job already exists with the same phone (E.164).
  // Fires on blur of the phone field. Blocks Save when a match is found.
  async function checkPhoneDuplicate(raw) {
    const e164 = toE164(raw);
    if (!e164) { setPhoneDup(null); return; }
    setCheckingPhone(true);
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, client_name, lead_date, created_at')
        .eq('client_phone', e164)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setPhoneDup(data || null);
    } catch {
      // Non-fatal — if the check fails, let the user proceed; the DB
      // unique-ness is not enforced, so we fall back to "warn only".
      setPhoneDup(null);
    } finally {
      setCheckingPhone(false);
    }
  }

  function validate() {
    const missing = [];
    if (!form.lead_date)         missing.push('Lead date');
    if (!form.first_name.trim()) missing.push('First name');
    if (!form.last_name.trim())  missing.push('Last name');
    if (!form.phone.trim())      missing.push('Phone');
    if (!form.address.trim())    missing.push('Street address');
    if (!form.city)              missing.push('City');
    if (!form.services.length)   missing.push('Service');
    return missing;
  }

  async function submit() {
    const missing = validate();
    if (missing.length) {
      setToast({ type: 'warning', message: `Missing: ${missing.join(', ')}` });
      return;
    }
    if (phoneDup) {
      setToast({ type: 'error', message: 'This phone is already on file — check My Leads.' });
      return;
    }
    setSaving(true);
    try {
      const clientName = `${form.first_name.trim()} ${form.last_name.trim()}`.trim();
      const streetLine = form.unit_number.trim()
        ? `${form.address.trim()} ${form.unit_number.trim()}`
        : form.address.trim();
      // Use the picked state code in the full address line so out-of-CT
      // leads aren't quietly mislabeled as Connecticut. Falls back to
      // 'CT' for any pre-state-picker rows just in case.
      const stateCode = (form.state || 'CT').toUpperCase();
      const fullAddress = [streetLine, form.city, stateCode, form.zip.trim()]
        .filter(Boolean).join(', ');
      const assigned = form.assigned_to === 'Other' ? form.assigned_to_custom.trim() : form.assigned_to;

      // Normalize phone to E.164 for Twilio. Keep raw for display only.
      const e164 = toE164(form.phone) || form.phone.trim();

      const [primary, ...extra] = form.services;

      const jobRow = {
        lead_date:            form.lead_date || null,
        client_name:          clientName,
        client_phone:         e164,
        client_email:         form.email.trim() || null,
        address:              fullAddress,
        unit_number:          form.unit_number.trim() || null,
        city:                 form.city,
        service:              primary,
        additional_services:  extra.length ? extra : null,
        pipeline_status:      'new_lead',
        status:               'new_lead',
        lead_source:          form.lead_source || null,
        notes:                form.notes.trim() || null,
        assigned_to:          assigned || null,
        referral_name:        form.lead_source === 'Referral' ? (form.referral_name.trim() || null) : null,
        created_by:           'receptionist',
      };

      const { data: job, error } = await supabase
        .from('jobs')
        .insert([jobRow])
        .select().single();
      if (error) throw error;

      // Notify sales (best-effort — table exists).
      try {
        const servicesLabel = form.services.map(serviceLabel).join(', ');
        await supabase.from('notifications').insert([{
          job_id:         job.id,
          recipient_role: 'sales',
          type:           'new_lead',
          title:          `New Lead — ${clientName}`,
          message:        `${servicesLabel} in ${form.city}. Phone: ${e164}. ${form.notes.trim() ? 'Notes: ' + form.notes.trim().slice(0, 200) : ''}`.trim(),
          seen:           false,
        }]);
      } catch { /* notifications table may be stricter — non-fatal */ }

      logAudit({
        user, action: 'lead.create', entityType: 'job', entityId: job.id,
        details: { client: clientName, services: form.services, city: form.city },
      });

      setCreated(job);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to create lead' });
    } finally {
      setSaving(false);
    }
  }

  function serviceLabel(v) { return SERVICES.find((s) => s.value === v)?.label || v; }

  // ─── SUCCESS screen ────────────────────────────────────────────────
  if (created) {
    const clientName = created.client_name;
    const assigned = created.assigned_to || 'the salesperson';
    const allServices = [created.service, ...(Array.isArray(created.additional_services) ? created.additional_services : [])]
      .filter(Boolean).map(serviceLabel).join(', ');
    return (
      <div className="flex-1 flex flex-col bg-omega-cloud overflow-y-auto">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        <main className="flex-1 px-4 sm:px-6 py-8 max-w-lg mx-auto w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-9 h-9 text-omega-success" />
            </div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Lead Created!</h1>
            <p className="text-sm text-omega-stone mt-1">{assigned} has been notified.</p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3 text-sm">
            <Row label="Client"   value={clientName} />
            <Row label="Phone"    value={created.client_phone} />
            {created.client_email && <Row label="Email" value={created.client_email} />}
            <Row label="Service"  value={allServices} />
            <Row label="Location" value={created.address} />
            {created.lead_source && <Row label="Source" value={created.lead_source} />}
            <Row label="Assigned to" value={assigned} />
          </div>

          <div className="mt-6 space-y-2">
            {/* Primary next step: pick a time slot on the calendar.
                Opens the EventForm pre-filled with this job. */}
            <button
              onClick={() => onScheduleVisit?.(created)}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark text-white font-bold text-base shadow-lg shadow-omega-orange/30"
            >
              <CalendarPlus className="w-5 h-5" /> Schedule Visit with {assigned}
            </button>
            <button
              onClick={() => { setCreated(null); setForm(DEFAULT_FORM); setPhoneDup(null); }}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-white border border-gray-200 hover:border-omega-orange text-omega-charcoal font-semibold text-base"
            >
              <Plus className="w-5 h-5" /> Create Another Lead
            </button>
            <button
              onClick={onViewLeads}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-white border border-gray-200 hover:border-omega-orange text-omega-charcoal font-semibold text-base"
            >
              <List className="w-5 h-5" /> View All Leads
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ─── Draft persistence (Save Draft button + autoload) ──────────────
  // Tiny localStorage cache so the receptionist can step away mid-form
  // and come back without retyping. Cleared on successful submit.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setForm({ ...DEFAULT_FORM, ...parsed });
          setToast({ type: 'success', message: 'Draft restored — pick up where you left off.' });
        }
      }
    } catch { /* corrupt JSON — ignore */ }
  }, []);

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      setToast({ type: 'success', message: 'Draft saved.' });
    } catch {
      setToast({ type: 'error', message: 'Could not save draft.' });
    }
  }

  // Wrap submit so the draft is wiped after a successful save. We
  // proxy here instead of mutating submit() directly to keep its
  // shape unchanged. The `created` state flips on success — easiest
  // signal we have. A useEffect handles that side too.
  useEffect(() => {
    if (created) {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    }
  }, [created]);

  // ─── FORM screen (redesign per Ramon's mockup) ────────────────────
  const canSave = !saving && !phoneDup;
  const clientFullName = `${form.first_name.trim()} ${form.last_name.trim()}`.trim();
  const locationLine = (() => {
    const street = form.unit_number.trim()
      ? `${form.address.trim()} ${form.unit_number.trim()}`
      : form.address.trim();
    const stateCode = (form.state || 'CT').toUpperCase();
    return [street, form.city, stateCode, form.zip.trim()].filter(Boolean).join(', ');
  })();

  return (
    <div className="flex-1 flex flex-col bg-omega-cloud overflow-y-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 w-full max-w-7xl mx-auto">
        {/* Top bar — back + title + Save Draft */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onViewLeads}
              className="mt-1 p-2 rounded-xl bg-white border border-gray-200 hover:border-omega-orange transition-colors flex-shrink-0"
              title="Back to leads"
            >
              <ArrowLeft className="w-4 h-4 text-omega-charcoal" />
            </button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-omega-charcoal">New Lead</h1>
              <p className="text-sm text-omega-stone mt-1">Capture a new opportunity and we'll take it from there.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={saveDraft}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold shadow-sm"
          >
            <Save className="w-4 h-4" /> Save Draft
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
          {/* LEFT — form */}
          <div className="space-y-4">
            {/* (1) Lead Date */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={1} />
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-omega-orange" /> Lead Date
                </h2>
              </div>
              <Field label="Date lead was captured" required hint="Defaults to today. Change it when backfilling older leads.">
                <input
                  type="date"
                  className={inputCls}
                  value={form.lead_date}
                  max={todayIso()}
                  onChange={(e) => set('lead_date', e.target.value)}
                />
              </Field>
            </div>

            {/* (2) Client Information */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={2} />
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-omega-orange" /> Client Information
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="First Name" required>
                  <input className={inputCls} value={form.first_name} placeholder="First name" onChange={(e) => set('first_name', e.target.value)} />
                </Field>
                <Field label="Last Name" required>
                  <input className={inputCls} value={form.last_name} placeholder="Last name" onChange={(e) => set('last_name', e.target.value)} />
                </Field>
              </div>
              <Field label="Phone" required>
                <PhoneInput
                  value={form.phone}
                  onChange={(v) => { set('phone', v); if (phoneDup) setPhoneDup(null); }}
                  onBlur={() => checkPhoneDuplicate(form.phone)}
                  className={inputCls}
                />
                {checkingPhone && (
                  <p className="text-[11px] text-omega-stone mt-1">Checking for existing lead…</p>
                )}
                {phoneDup && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-red-700">Lead already exists for this phone</p>
                      <p className="text-red-700/90 mt-0.5">
                        {phoneDup.client_name} · {fmtShortDate(phoneDup.lead_date || phoneDup.created_at)}
                      </p>
                      <button
                        type="button"
                        onClick={onViewLeads}
                        className="mt-1 text-[11px] font-bold text-red-700 underline hover:text-red-800"
                      >
                        Check My Leads →
                      </button>
                    </div>
                  </div>
                )}
              </Field>
              <Field label="Email">
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-omega-stone" />
                  <input type="email" inputMode="email" className={`${inputCls} pl-10`} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="client@email.com" />
                </div>
              </Field>
            </div>

            {/* (3) Service Location */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={3} />
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-omega-orange" /> Service Location
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                <Field label="Street Address" required>
                  <input className={inputCls} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" />
                </Field>
                <Field label="Unit #" hint="Apt, Suite, Unit — leave blank for a single-family home.">
                  <input className={inputCls} value={form.unit_number} onChange={(e) => set('unit_number', e.target.value)} placeholder="Apt 4B" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="State" required>
                  <select
                    className={inputCls}
                    value={form.state}
                    onChange={(e) => { set('state', e.target.value); set('city', ''); }}
                  >
                    {STATES.map((s) => (
                      <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </Field>
                <Field label="City" required>
                  <select className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)}>
                    <option value="">Select city…</option>
                    {(CITIES_BY_STATE[form.state] || []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </Field>
              </div>
              <Field label="Zip Code">
                <input inputMode="numeric" className={inputCls} value={form.zip} onChange={(e) => set('zip', e.target.value)} placeholder="06901" />
              </Field>
            </div>

            {/* (4) Service Interest — icon grid like the mockup */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-start gap-3 mb-1">
                <StepBadge n={4} />
                <div>
                  <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                    <Hammer className="w-4 h-4 text-omega-orange" /> Service Interest
                  </h2>
                  <p className="text-xs text-omega-stone mt-0.5">Select all services the client asked about.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {SERVICES.map((s) => {
                  const selected = form.services.includes(s.value);
                  // Icon comes from the canonical shared list so receptionist
                  // and the rest of the app stay visually in sync.
                  const meta = SHARED_SERVICES.find((x) => x.id === s.value);
                  const Icon = (meta && Icons[meta.icon]) || Icons.Wrench;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => toggleService(s.value)}
                      className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                        selected
                          ? 'border-omega-orange bg-omega-pale shadow-sm'
                          : 'border-gray-200 bg-white hover:border-omega-orange/40'
                      }`}
                    >
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${selected ? 'bg-omega-orange text-white' : 'bg-omega-cloud text-omega-stone'}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className={`text-sm font-bold leading-tight ${selected ? 'text-omega-charcoal' : 'text-omega-slate'}`}>
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {form.services.length > 1 && (
                <p className="text-[11px] text-omega-stone mt-3">
                  {form.services.length} services selected. Primary: <strong>{serviceLabel(form.services[0])}</strong>.
                </p>
              )}
            </div>

            {/* (5) Lead Info */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={5} />
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-omega-orange" /> Lead Info
                </h2>
              </div>
              <Field label="How did they hear about us?">
                <select className={inputCls} value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)}>
                  <option value="">Select an option…</option>
                  {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              {form.lead_source === 'Referral' && (
                <Field label="Referral Name">
                  <input className={inputCls} value={form.referral_name} onChange={(e) => set('referral_name', e.target.value)} placeholder="Who referred them?" />
                </Field>
              )}
              <Field label="Notes" hint="Details from the call — project notes, budget hints, etc.">
                <textarea
                  rows={4}
                  className={`${inputCls} resize-none`}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder="Add details from the call — project notes, budget hints, etc."
                />
              </Field>
            </div>

            {/* (6) Assignment */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={6} />
                <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-omega-orange" /> Assignment
                </h2>
              </div>
              <Field label="Assign to salesperson">
                <select className={inputCls} value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}>
                  <option value="Attila">Attila</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              {form.assigned_to === 'Other' && (
                <Field label="Other salesperson">
                  <input className={inputCls} value={form.assigned_to_custom} onChange={(e) => set('assigned_to_custom', e.target.value)} placeholder="Name" />
                </Field>
              )}
            </div>

            {/* Submit CTA */}
            <button
              onClick={submit}
              disabled={!canSave}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-base shadow-lg shadow-omega-orange/25"
            >
              <Send className="w-5 h-5" />
              {saving ? 'Creating…' : phoneDup ? 'Duplicate phone — cannot save' : 'Create Lead & Notify Salesperson'}
            </button>
          </div>

          {/* RIGHT — Lead Summary sidebar */}
          <aside className="lg:sticky lg:top-6 self-start space-y-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4 text-omega-orange" /> Lead Summary
              </h2>
              <SummaryRow icon={CalendarIcon} label="Lead Date" value={fmtShortDate(form.lead_date)} />
              <SummaryRow icon={UserIcon}     label="Client"           value={clientFullName || null} />
              <SummaryRow icon={MapPin}       label="Service Location" value={locationLine || null} />
              <SummaryRow
                icon={Hammer}
                label="Service Interest"
                value={form.services.length
                  ? form.services.map(serviceLabel).join(', ')
                  : null}
                empty="Not selected"
              />
              <SummaryRow
                icon={Megaphone}
                label="How they heard"
                value={form.lead_source || null}
                empty="Not selected"
              />
              <SummaryRow
                icon={UserCheck}
                label="Assigned To"
                value={form.assigned_to === 'Other' ? form.assigned_to_custom || null : form.assigned_to}
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-900">Complete all required fields</p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  Fields marked with <span className="font-bold">*</span> are required.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

// Lead Summary line — icon + label + value (or "Not provided" when empty).
function SummaryRow({ icon: Icon, label, value, empty = 'Not provided' }) {
  const hasValue = !!(value && String(value).trim());
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-gray-50 last:border-b-0">
      {Icon && <Icon className="w-4 h-4 text-omega-stone flex-shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-omega-stone">{label}</p>
        <p className={`text-sm break-words mt-0.5 ${hasValue ? 'text-omega-charcoal font-semibold' : 'text-omega-fog italic'}`}>
          {hasValue ? value : empty}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wider text-omega-stone font-semibold flex-shrink-0">{label}</span>
      <span className="text-sm text-omega-charcoal font-medium text-right break-words">{value || '—'}</span>
    </div>
  );
}
