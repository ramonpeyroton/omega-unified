import { useState } from 'react';
import { ArrowLeft, ArrowRight, User, Phone, Mail, MapPin, ChevronRight, Check } from 'lucide-react';
import { SERVICES } from '../data/questionnaire';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import * as Icons from 'lucide-react';
import { notify } from '../../../shared/lib/notifications';

function ServiceIcon({ name }) {
  const Icon = Icons[name] || Icons.Wrench;
  return <Icon className="w-6 h-6" />;
}

function maskPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function NewJob({ user, onNavigate, onJobCreated }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    client_name: '',
    client_phone: '',
    client_email: '',
    address: '',
  });
  const [services, setServices] = useState([]);
  const [errors, setErrors] = useState({});

  const updateForm = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const validateStep1 = () => {
    const e = {};
    if (!form.client_name.trim()) e.client_name = 'Name is required';
    if (!form.client_phone.replace(/\D/g, '') || form.client_phone.replace(/\D/g, '').length < 10)
      e.client_phone = 'Valid 10-digit phone required';
    if (!form.address.trim()) e.address = 'Address is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    if (services.length === 0) {
      setErrors({ services: 'Select at least one service' });
      return false;
    }
    setErrors({});
    return true;
  };

  const toggleService = (id) => {
    setServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
    setErrors({});
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) handleCreate();
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const jobData = {
        client_name: form.client_name.trim(),
        client_phone: form.client_phone,
        client_email: form.client_email.trim() || null,
        address: form.address.trim(),
        salesperson_name: user.name,
        service: services.join(', '),
        status: 'draft',
        answers: {},
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('jobs')
        .insert([jobData])
        .select()
        .single();

      if (error) throw error;
      // Notify operations that a new job came in
      notify({
        recipientRole: 'operations',
        title: 'New job created',
        message: `${user.name} created a new ${services.join(', ')} for ${form.client_name.trim()}.`,
        type: 'job',
        jobId: data.id,
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
      {/* Header */}
      <div className="bg-omega-charcoal px-5 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => step === 1 ? onNavigate('home') : setStep(1)} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-omega-fog text-xs font-medium">New Job</p>
            <h1 className="text-white font-bold text-lg">
              {step === 1 ? 'Client Information' : 'Select Services'}
            </h1>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2">
          {[1, 2].map((s) => (
            <div key={s} className={`h-1.5 rounded-full flex-1 transition-all ${s <= step ? 'bg-omega-orange' : 'bg-white/20'}`} />
          ))}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[11px] text-omega-fog">Step {step} of 2</span>
          <span className="text-[11px] text-omega-fog">{step === 1 ? 'Client Info' : 'Services'}</span>
        </div>
      </div>

      <div className="px-5 py-6">
        {step === 1 && (
          <div className="space-y-4">
            {/* Client Name */}
            <div>
              <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">
                Client Name *
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
                <input
                  type="text"
                  value={form.client_name}
                  onChange={(e) => updateForm('client_name', e.target.value)}
                  placeholder="Full name"
                  autoFocus
                  className={`w-full pl-10 pr-4 py-3.5 rounded-xl bg-white border text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors ${errors.client_name ? 'border-omega-danger' : 'border-gray-200'}`}
                />
              </div>
              {errors.client_name && <p className="text-xs text-omega-danger mt-1">{errors.client_name}</p>}
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">
                Phone Number *
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
                <input
                  type="tel"
                  value={form.client_phone}
                  onChange={(e) => updateForm('client_phone', maskPhone(e.target.value))}
                  placeholder="(203) 555-0100"
                  className={`w-full pl-10 pr-4 py-3.5 rounded-xl bg-white border text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors ${errors.client_phone ? 'border-omega-danger' : 'border-gray-200'}`}
                />
              </div>
              {errors.client_phone && <p className="text-xs text-omega-danger mt-1">{errors.client_phone}</p>}
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">
                Email <span className="text-omega-fog font-normal normal-case">(optional)</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-omega-fog" />
                <input
                  type="email"
                  value={form.client_email}
                  onChange={(e) => updateForm('client_email', e.target.value)}
                  placeholder="client@email.com"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl bg-white border border-gray-200 text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">
                Property Address *
              </label>
              <div className="relative">
                <MapPin className="absolute left-3.5 top-3.5 w-4 h-4 text-omega-fog" />
                <textarea
                  value={form.address}
                  onChange={(e) => updateForm('address', e.target.value)}
                  placeholder="123 Main St, Westport, CT 06880"
                  rows={3}
                  className={`w-full pl-10 pr-4 py-3 rounded-xl bg-white border text-omega-charcoal placeholder-omega-fog focus:outline-none focus:border-omega-orange transition-colors resize-none ${errors.address ? 'border-omega-danger' : 'border-gray-200'}`}
                />
              </div>
              {errors.address && <p className="text-xs text-omega-danger mt-1">{errors.address}</p>}
            </div>

            {errors.general && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                <p className="text-sm text-omega-danger">{errors.general}</p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="text-sm text-omega-stone mb-4">Select all services needed for <strong className="text-omega-charcoal">{form.client_name}</strong></p>

            {errors.services && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-sm text-omega-warning">{errors.services}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {SERVICES.map((svc) => {
                const selected = services.includes(svc.id);
                return (
                  <button
                    key={svc.id}
                    onClick={() => toggleService(svc.id)}
                    className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all duration-200 ${
                      selected
                        ? 'border-omega-orange bg-omega-pale'
                        : 'border-gray-200 bg-white hover:border-omega-orange/40'
                    }`}
                  >
                    {selected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-omega-orange flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div className={`${selected ? 'text-omega-orange' : 'text-omega-stone'}`}>
                      <ServiceIcon name={svc.icon} />
                    </div>
                    <span className={`text-xs font-semibold text-center leading-tight ${selected ? 'text-omega-charcoal' : 'text-omega-slate'}`}>
                      {svc.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {services.length > 0 && (
              <div className="mt-4 p-3 rounded-xl bg-omega-pale border border-omega-orange/20">
                <p className="text-xs text-omega-orange font-medium">
                  {services.length} service{services.length > 1 ? 's' : ''} selected
                </p>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleNext}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white font-semibold text-base transition-all duration-200 mt-8 shadow-lg shadow-omega-orange/25"
        >
          {saving ? (
            <LoadingSpinner size={20} color="text-white" />
          ) : (
            <>
              {step === 1 ? 'Next' : 'Start Questionnaire'}
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
