// NewClient — Inácio's quick "add a client" form. Only the essentials:
// name, address, phone, email and how the client found us. Everything else
// (service, visit, notes…) gets filled in later on the client's card.
// The client lands in the Pipeline as a New Lead, same as a lead logged by
// the front desk, and Sales + Operations get a notification.

import { useState } from 'react';
import { User, Mail, MapPin, Megaphone, UserPlus, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import AddressAutocomplete from '../../../shared/components/AddressAutocomplete';
import PhoneInput from '../../../shared/components/PhoneInput';
import { supabase } from '../../../shared/lib/supabase';
import { toE164 } from '../../../shared/lib/phone';
import { notify } from '../../../shared/lib/notifications';
import { logAudit } from '../../../shared/lib/audit';
import { LEAD_SOURCES } from '../../receptionist/lib/leadCatalog';

const EMPTY = { client_name: '', address: '', city: '', client_phone: '', client_email: '', client_email_2: '', lead_source: '' };

const labelCls = 'block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2';
const fieldCls = (err) =>
  `w-full pl-10 pr-4 py-3 rounded-xl bg-white border text-base lg:text-sm text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors ${err ? 'border-omega-danger' : 'border-gray-200'}`;

// Calendar day in New York — the lead date the Leads screens sort by.
const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// Typed address without picking a suggestion: "15 Oak Ln, Fairfield, CT 06824" → "Fairfield".
function cityFromAddress(address) {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

export default function NewClient({ user, onBack, onOpenClient }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(null); // existing job with the same phone
  const [created, setCreated] = useState(null);

  const set = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((e) => ({ ...e, [key]: undefined, general: undefined }));
  };

  // Same check the front desk uses: one client per phone number.
  async function findDuplicate(raw) {
    const e164 = toE164(raw);
    if (!e164) return null;
    try {
      const { data } = await supabase.from('jobs')
        .select('id, client_name, created_at')
        .eq('client_phone', e164)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      return data || null;
    } catch {
      return null; // check is best-effort
    }
  }
  // Early warning when leaving the phone field…
  async function checkDuplicate(raw) { setDuplicate(await findDuplicate(raw)); }

  function validate() {
    const e = {};
    if (!form.client_name.trim()) e.client_name = 'Name is required';
    if (form.client_phone.replace(/\D/g, '').length < 10) e.client_phone = 'Enter a 10-digit phone number';
    if (!form.address.trim()) e.address = 'Address is required';
    if (form.client_email.trim() && !/^\S+@\S+\.\S+$/.test(form.client_email.trim())) e.client_email = 'Check the email';
    if (form.client_email_2.trim() && !/^\S+@\S+\.\S+$/.test(form.client_email_2.trim())) e.client_email_2 = 'Check the email';
    if (!form.lead_source) e.lead_source = 'Select how the client found us';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (saving || !validate()) return;
    setSaving(true);
    try {
      // …and again on save: typing the phone and clicking straight away
      // beats the blur check.
      const dup = duplicate || await findDuplicate(form.client_phone);
      if (dup) {
        setDuplicate(dup);
        setErrors({ general: 'This phone number is already on file — open the existing client instead.' });
        return;
      }
      const name = form.client_name.trim();
      const { data: job, error } = await supabase.from('jobs').insert([{
        client_name:     name,
        client_phone:    toE164(form.client_phone) || form.client_phone.trim(),
        client_email:    form.client_email.trim() || null,
        // 2nd email only when filled, so saving works before migration 087.
        ...(form.client_email_2.trim() ? { client_email_2: form.client_email_2.trim() } : {}),
        address:         form.address.trim(),
        city:            form.city || cityFromAddress(form.address),
        lead_source:     form.lead_source,
        lead_date:       todayNY(),
        pipeline_status: 'new_lead',
        status:          'new_lead',
        lead_owner:      user?.name || null,
        created_by:      'owner',
      }]).select().single();
      if (error) throw error;

      const message = `${user?.name || 'Owner'} added ${name} (${form.lead_source}). Service and visit still to be set.`;
      notify({ recipientRole: 'sales', title: `New Client — ${name}`, message, type: 'new_lead', jobId: job.id });
      notify({ recipientRole: 'operations', title: `New Client — ${name}`, message, type: 'new_lead', jobId: job.id });
      logAudit({ user, action: 'lead.create', entityType: 'job', entityId: job.id, details: { client: name, source: form.lead_source, via: 'owner_quick_add' } });

      setCreated(job);
    } catch (err) {
      setErrors({ general: err?.message || 'Could not save the client. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  function addAnother() {
    setForm(EMPTY); setErrors({}); setDuplicate(null); setCreated(null);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <PageHeader icon={UserPlus} title="New Client" subtitle="Add the basics now — fill in the rest on the client card" onBack={onBack} />

      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6">
        {created ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-omega-success mx-auto" />
            <h2 className="text-lg font-black text-omega-charcoal mt-3">{created.client_name} added</h2>
            <p className="text-sm text-omega-stone mt-1">
              They&rsquo;re in the Pipeline as a New Lead. Sales and Operations were notified.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
              <button onClick={() => onOpenClient(created)} className="px-5 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold">
                Open client card
              </button>
              <button onClick={addAnother} className="px-5 py-3 rounded-xl border border-gray-200 bg-white hover:border-omega-orange text-sm font-bold text-omega-charcoal">
                Add another client
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 space-y-5">
            <div>
              <label className={labelCls}>Client name *</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
                <input
                  value={form.client_name}
                  onChange={(e) => set('client_name', e.target.value)}
                  placeholder="Full name"
                  autoFocus
                  className={fieldCls(errors.client_name)}
                />
              </div>
              {errors.client_name && <p className="text-xs text-omega-danger mt-1">{errors.client_name}</p>}
            </div>

            <div>
              <label className={labelCls}>Address *</label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none z-10" />
                <AddressAutocomplete
                  value={form.address}
                  onChange={(val) => set('address', val)}
                  onPlaceSelected={({ formatted, city }) => {
                    setForm((f) => ({ ...f, address: formatted, city: city || '' }));
                    setErrors((e) => ({ ...e, address: undefined }));
                  }}
                  placeholder="123 Main St, Westport, CT 06880"
                  className={fieldCls(errors.address)}
                />
              </div>
              {errors.address && <p className="text-xs text-omega-danger mt-1">{errors.address}</p>}
            </div>

            <div>
              <label className={labelCls}>Phone *</label>
              <PhoneInput
                value={form.client_phone}
                onChange={(val) => { set('client_phone', val); setDuplicate(null); }}
                onBlur={(e) => checkDuplicate(e.target.value)}
                className={fieldCls(errors.client_phone)}
              />
              {errors.client_phone && <p className="text-xs text-omega-danger mt-1">{errors.client_phone}</p>}
              {duplicate && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 flex-1">
                    This phone is already on file for <strong>{duplicate.client_name || 'a client'}</strong>.
                  </p>
                  <button onClick={() => onOpenClient(duplicate)} className="text-xs font-bold text-omega-orange hover:text-omega-dark whitespace-nowrap">
                    Open client
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>Email <span className="text-omega-fog font-normal normal-case">(optional)</span></label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
                <input
                  type="email"
                  inputMode="email"
                  value={form.client_email}
                  onChange={(e) => set('client_email', e.target.value)}
                  placeholder="client@email.com"
                  className={fieldCls(errors.client_email)}
                />
              </div>
              {errors.client_email && <p className="text-xs text-omega-danger mt-1">{errors.client_email}</p>}
            </div>

            <div>
              <label className={labelCls}>Second email <span className="text-omega-fog font-normal normal-case">(optional — gets everything we send too)</span></label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
                <input
                  type="email"
                  inputMode="email"
                  value={form.client_email_2}
                  onChange={(e) => set('client_email_2', e.target.value)}
                  placeholder="spouse@email.com"
                  className={fieldCls(errors.client_email_2)}
                />
              </div>
              {errors.client_email_2 && <p className="text-xs text-omega-danger mt-1">{errors.client_email_2}</p>}
            </div>

            <div>
              <label className={labelCls}>How did they find us? *</label>
              <div className="relative">
                <Megaphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
                <select
                  value={form.lead_source}
                  onChange={(e) => set('lead_source', e.target.value)}
                  className={`${fieldCls(errors.lead_source)} appearance-none`}
                >
                  <option value="">Select…</option>
                  {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {errors.lead_source && <p className="text-xs text-omega-danger mt-1">{errors.lead_source}</p>}
            </div>

            {errors.general && (
              <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">{errors.general}</div>
            )}

            <button
              onClick={save}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><UserPlus className="w-4 h-4" /> Add client</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
