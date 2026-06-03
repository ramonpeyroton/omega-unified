import { useState } from 'react';
import { ArrowLeft, User, Phone, Mail, MapPin, Check, Calendar, Clock, Megaphone, PlusCircle } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { SERVICES } from '../data/questionnaire';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import * as Icons from 'lucide-react';
import { notify } from '../../../shared/lib/notifications';
import { formatPhoneInput, toE164 } from '../../../shared/lib/phone';
import { createEvent } from '../../../shared/lib/calendar';
import AddressAutocomplete from '../../../shared/components/AddressAutocomplete';

// Same list as receptionist (leadCatalog.js)
const LEAD_SOURCES = [
  'Google', 'Referral', 'Houzz', 'HomeAdvisor', 'Angi',
  'Mr.NailEdit', 'Door to Door', 'Social Media', 'Repeat Client',
  'Drove By', 'Other',
];

function ServiceIcon({ name }) {
  const Icon = Icons[name] || Icons.Wrench;
  return <Icon className="w-5 h-5" />;
}

const labelCls = 'block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2';
const inputCls = (err) =>
  `w-full px-4 py-3.5 rounded-xl bg-white border text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors ${err ? 'border-omega-danger' : 'border-gray-200'}`;
const inputWithIconCls = (err) =>
  `w-full pl-10 pr-4 py-3.5 rounded-xl bg-white border text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors ${err ? 'border-omega-danger' : 'border-gray-200'}`;

export default function NewJob({ user, onNavigate, onJobCreated, prefilledClient }) {
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    client_name:  prefilledClient?.client_name  || '',
    client_phone: prefilledClient?.client_phone || '',
    client_email: prefilledClient?.client_email || '',
    address:      prefilledClient?.address      || '',
    lead_source:  '',
    visit_date:   '',
    visit_time:   '09:00',
  });
  const [services, setServices] = useState([]);
  const [errors, setErrors]     = useState({});

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const toggleService = (id) => {
    setServices((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
    setErrors((e) => ({ ...e, services: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!form.client_name.trim())                                              e.client_name  = 'Name is required';
    if (!form.client_phone.replace(/\D/g, '') ||
        form.client_phone.replace(/\D/g, '').length < 10)                     e.client_phone = 'Valid 10-digit phone required';
    if (!form.address.trim())                                                  e.address      = 'Address is required';
    if (!form.lead_source)                                                     e.lead_source  = 'Select a lead source';
    if (!form.visit_date)                                                      e.visit_date   = 'Schedule a visit date';
    if (services.length === 0)                                                 e.services     = 'Select at least one service';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const jobData = {
        client_name:      form.client_name.trim(),
        client_phone:     toE164(form.client_phone) || form.client_phone,
        client_email:     form.client_email.trim() || null,
        address:          form.address.trim(),
        salesperson_name: user.name,
        service:          services.join(', '),
        lead_source:      form.lead_source || null,
        pipeline_status:  'new_lead',
        in_pipeline:      true,
        status:           'draft',
        answers:          {},
        created_at:       new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('jobs').insert([jobData]).select().single();
      if (error) throw error;

      // ── Create calendar sales_visit event ───────────────────────────
      if (form.visit_date) {
        try {
          const timeStr  = form.visit_time || '09:00';
          const startsAt = new Date(`${form.visit_date}T${timeStr}:00`);
          const endsAt   = new Date(startsAt.getTime() + 60 * 60 * 1000);
          await createEvent({
            kind:             'sales_visit',
            title:            `Visit: ${form.client_name.trim()}`,
            starts_at:        startsAt.toISOString(),
            ends_at:          endsAt.toISOString(),
            job_id:           data.id,
            assigned_to_name: user.name,
            notes:            form.address.trim(),
          });
        } catch (calErr) {
          console.warn('Calendar event creation failed:', calErr);
        }
      }

      notify({
        recipientRole: 'operations',
        title:   'New lead registered',
        message: `${user.name} added ${form.client_name.trim()} (${services.join(', ')}) via ${form.lead_source || 'unknown source'}.`,
        type:    'job',
        jobId:   data.id,
      });

      onJobCreated(data);
    } catch (err) {
      console.error(err);
      setErrors({ general: 'Failed to create job. Please try again.' });
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-omega-cloud">
      {/* Header — same thin bar as every other secondary screen. */}
      <PageHeader
        icon={PlusCircle}
        title="New Job"
        subtitle="Start a new client consultation"
        onBack={() => onNavigate('home')}
      />

      <div className="px-5 py-6 space-y-5 pb-32">

        {/* Returning-client banner */}
        {prefilledClient && (
          <div className="p-3 rounded-xl bg-omega-pale border border-omega-orange/30">
            <p className="text-xs font-bold text-omega-orange uppercase tracking-wider">Returning Client</p>
            <p className="text-sm text-omega-charcoal mt-0.5">
              Starting a fresh job for <strong>{prefilledClient.client_name || 'this client'}</strong>. Edit any field if it has changed.
            </p>
          </div>
        )}

        {/* ── Client Name ─────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Client Name *</label>
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
            <input
              type="text"
              value={form.client_name}
              onChange={(e) => set('client_name', e.target.value)}
              placeholder="Full name"
              autoFocus
              className={inputWithIconCls(errors.client_name)}
            />
          </div>
          {errors.client_name && <p className="text-xs text-omega-danger mt-1">{errors.client_name}</p>}
        </div>

        {/* ── Phone ───────────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Phone Number *</label>
          <div className="relative">
            <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
            <input
              type="tel"
              value={form.client_phone}
              onChange={(e) => set('client_phone', formatPhoneInput(e.target.value))}
              placeholder="(203) 555-0100"
              className={inputWithIconCls(errors.client_phone)}
            />
          </div>
          {errors.client_phone && <p className="text-xs text-omega-danger mt-1">{errors.client_phone}</p>}
        </div>

        {/* ── Email ───────────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Email <span className="text-omega-fog font-normal normal-case">(optional)</span></label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
            <input
              type="email"
              value={form.client_email}
              onChange={(e) => set('client_email', e.target.value)}
              placeholder="client@email.com"
              className={inputWithIconCls(false)}
            />
          </div>
        </div>

        {/* ── Address ─────────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Property Address *</label>
          <div className="relative">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
            <AddressAutocomplete
              value={form.address}
              onChange={(val) => { set('address', val); setErrors((e) => ({ ...e, address: undefined })); }}
              onPlaceSelected={({ formatted }) => {
                // Sales form stores the full address in one field
                set('address', formatted);
                setErrors((e) => ({ ...e, address: undefined }));
              }}
              placeholder="123 Main St, Westport, CT 06880"
              className={inputWithIconCls(errors.address)}
            />
          </div>
          {errors.address && <p className="text-xs text-omega-danger mt-1">{errors.address}</p>}
        </div>

        {/* ── Lead Source ─────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Lead Source *</label>
          <div className="relative">
            <Megaphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
            <select
              value={form.lead_source}
              onChange={(e) => set('lead_source', e.target.value)}
              className={`w-full pl-10 pr-4 py-3.5 rounded-xl bg-white border text-omega-charcoal focus:outline-none focus:border-omega-orange transition-colors appearance-none ${errors.lead_source ? 'border-omega-danger' : 'border-gray-200'}`}
            >
              <option value="">How did they find us?</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {errors.lead_source && <p className="text-xs text-omega-danger mt-1">{errors.lead_source}</p>}
        </div>

        {/* ── Schedule Visit ──────────────────────────────────────── */}
        <div>
          <label className={labelCls}>Schedule Visit *</label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
              <input
                type="date"
                value={form.visit_date}
                onChange={(e) => set('visit_date', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className={`w-full pl-10 pr-4 py-3.5 rounded-xl bg-white border text-omega-charcoal focus:outline-none focus:border-omega-orange transition-colors ${errors.visit_date ? 'border-omega-danger' : 'border-gray-200'}`}
              />
            </div>
            <div className="relative w-32">
              <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog pointer-events-none" />
              <input
                type="time"
                value={form.visit_time}
                onChange={(e) => set('visit_time', e.target.value)}
                className="w-full pl-10 pr-3 py-3.5 rounded-xl bg-white border border-gray-200 text-omega-charcoal focus:outline-none focus:border-omega-orange transition-colors"
              />
            </div>
          </div>
          {errors.visit_date && <p className="text-xs text-omega-danger mt-1">{errors.visit_date}</p>}
        </div>

        {/* ── Services ────────────────────────────────────────────── */}
        <div>
          <label className={labelCls}>
            Service Type * {services.length > 0 && <span className="text-omega-orange normal-case font-normal">· {services.length} selected</span>}
          </label>
          {errors.services && (
            <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm text-omega-warning">{errors.services}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {SERVICES.map((svc) => {
              const selected = services.includes(svc.id);
              return (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => toggleService(svc.id)}
                  className={`relative flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all duration-200 text-left ${
                    selected
                      ? 'border-omega-orange bg-omega-pale'
                      : 'border-gray-200 bg-white hover:border-omega-orange/40'
                  }`}
                >
                  {selected && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-omega-orange flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                  <div className={selected ? 'text-omega-orange' : 'text-omega-stone'}>
                    <ServiceIcon name={svc.icon} />
                  </div>
                  <span className={`text-xs font-semibold leading-tight ${selected ? 'text-omega-charcoal' : 'text-omega-slate'}`}>
                    {svc.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {errors.general && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200">
            <p className="text-sm text-omega-danger">{errors.general}</p>
          </div>
        )}
      </div>

      {/* Sticky footer button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4">
        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white font-semibold text-base transition-all duration-200 shadow-lg shadow-omega-orange/25"
        >
          {saving ? (
            <LoadingSpinner size={20} color="text-white" />
          ) : (
            <>
              <Check className="w-5 h-5" />
              Create Lead
            </>
          )}
        </button>
      </div>
    </div>
  );
}
