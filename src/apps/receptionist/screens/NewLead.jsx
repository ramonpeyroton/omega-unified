import { useState } from 'react';
import {
  Mail, MapPin, Hammer, Users, UserCheck, Calendar as CalendarIcon,
  Send, CheckCircle2, Plus, List, CalendarPlus, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from '../components/Toast';
import PhoneInput from '../../../shared/components/PhoneInput';
import { toE164 } from '../../../shared/lib/phone';
import { logAudit } from '../../../shared/lib/audit';
import { CITIES_BY_STATE, STATES, SERVICES, LEAD_SOURCES } from '../lib/leadCatalog';

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

  // ─── FORM screen ──────────────────────────────────────────────────
  const canSave = !saving && !phoneDup;

  return (
    <div className="flex-1 flex flex-col bg-omega-cloud overflow-y-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="bg-white border-b border-gray-200 px-6 md:px-8 py-5 sticky top-0 z-10">
        <h1 className="text-xl font-bold text-omega-charcoal">New Lead</h1>
        <p className="text-xs text-omega-stone mt-0.5">Create a client and schedule the visit on the next step.</p>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-5 max-w-xl mx-auto w-full space-y-4">

        {/* SECTION 0 — Lead Date (default today, editable to backfill old leads) */}
        <Section title="Lead Date" icon={CalendarIcon}>
          <Field label="Date lead was captured" required hint="Defaults to today. Change it when backfilling older leads.">
            <input
              type="date"
              className={inputCls}
              value={form.lead_date}
              max={todayIso()}
              onChange={(e) => set('lead_date', e.target.value)}
            />
          </Field>
        </Section>

        {/* SECTION 1 — Client Info */}
        <Section title="Client Info" icon={UserCheck}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First Name" required>
              <input className={inputCls} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            </Field>
            <Field label="Last Name" required>
              <input className={inputCls} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
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
        </Section>

        {/* SECTION 2 — Service Location */}
        <Section title="Service Location" icon={MapPin}>
          <Field label="Street Address" required>
            <input className={inputCls} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="123 Main St" />
          </Field>
          <Field label="Unit #" hint="Apt, Suite, Unit — leave blank for a single-family home.">
            <input className={inputCls} value={form.unit_number} onChange={(e) => set('unit_number', e.target.value)} placeholder="Apt 4B" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" required>
              <select
                className={inputCls}
                value={form.state}
                onChange={(e) => {
                  // Switching state clears the city — picking from the
                  // wrong list is a worse error than typing it again.
                  set('state', e.target.value);
                  set('city', '');
                }}
              >
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </Field>
            <Field label="City" required>
              <select className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)}>
                <option value="">Select…</option>
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
        </Section>

        {/* SECTION 3 — Service Interest (multi-select) */}
        <Section title="Service Interest" icon={Hammer}>
          <p className="text-xs text-omega-stone -mt-2 mb-1">Select all services the client asked about.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SERVICES.map((s) => (
              <ChoiceButton
                key={s.value}
                label={s.label}
                selected={form.services.includes(s.value)}
                onClick={() => toggleService(s.value)}
              />
            ))}
          </div>
          {form.services.length > 1 && (
            <p className="text-[11px] text-omega-stone mt-1">
              {form.services.length} services selected. Primary: <strong>{serviceLabel(form.services[0])}</strong>.
            </p>
          )}
        </Section>

        {/* SECTION 5 — Lead Info */}
        <Section title="Lead Info" icon={Users}>
          <Field label="How did they hear about us?">
            <select className={inputCls} value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)}>
              <option value="">Select…</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {form.lead_source === 'Referral' && (
            <Field label="Referral Name">
              <input className={inputCls} value={form.referral_name} onChange={(e) => set('referral_name', e.target.value)} placeholder="Who referred them?" />
            </Field>
          )}
          <Field label="Notes" hint="Details from the call — project notes, budget hints, etc.">
            <textarea rows={4} className={`${inputCls} resize-none`} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </Section>

        {/* SECTION 6 — Assignment */}
        <Section title="Assignment" icon={UserCheck}>
          <Field label="Assign to Salesperson">
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
        </Section>

        <div className="pt-2 pb-8">
          <button
            onClick={submit}
            disabled={!canSave}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-base shadow-lg shadow-omega-orange/25"
          >
            <Send className="w-5 h-5" />
            {saving ? 'Creating…' : phoneDup ? 'Duplicate phone — cannot save' : 'CREATE LEAD & NOTIFY SALESPERSON'}
          </button>
        </div>
      </main>
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
