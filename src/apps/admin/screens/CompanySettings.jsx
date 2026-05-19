import { useEffect, useState } from 'react';
import { Save, Upload, Target } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import { logAudit } from '../../../shared/lib/audit';
import { getSettingNumber, setSetting } from '../../../shared/lib/settings';
import GmailIntegrationCard from '../../../shared/components/GmailIntegrationCard';

const GOAL_KEY = 'annual_goal_2026';

const FIELDS = [
  { key: 'company_name',    label: 'Company Name' },
  { key: 'address',         label: 'Address', type: 'textarea' },
  { key: 'phone',           label: 'Phone' },
  { key: 'email',           label: 'Email', type: 'email' },
  { key: 'license_number',  label: 'License Number' },
  { key: 'insurance_info',  label: 'Insurance Info', type: 'textarea' },
];

export default function CompanySettings({ user }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [row, setRow] = useState(null);
  const [form, setForm] = useState({});
  const [goal, setGoal] = useState('6000000');
  const [savingGoal, setSavingGoal] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [settingsRes, goalValue] = await Promise.all([
        supabase
          .from('company_settings')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        getSettingNumber(GOAL_KEY, 6_000_000),
      ]);
      if (settingsRes.error) throw settingsRes.error;
      const data = settingsRes.data;
      setRow(data || null);
      const base = {};
      FIELDS.forEach((f) => { base[f.key] = data?.[f.key] || ''; });
      setForm(base);
      setGoal(String(goalValue || 0));
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  async function saveGoal() {
    const n = Number(String(goal).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      setToast({ type: 'error', message: 'Goal must be a positive number' });
      return;
    }
    setSavingGoal(true);
    const ok = await setSetting(GOAL_KEY, Math.round(n), user);
    setSavingGoal(false);
    if (ok) {
      logAudit({ user, action: 'settings.goal.update', entityType: 'app_settings', details: { value: n } });
      setToast({ type: 'success', message: 'Annual goal updated' });
    } else {
      setToast({ type: 'error', message: 'Failed to save goal' });
    }
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { ...form, updated_at: new Date().toISOString() };
      let data, error;
      if (row?.id) {
        ({ data, error } = await supabase.from('company_settings').update(payload).eq('id', row.id).select().single());
      } else {
        ({ data, error } = await supabase.from('company_settings').insert([payload]).select().single());
      }
      if (error) throw error;
      setRow(data);
      logAudit({ user, action: 'company.settings.update', entityType: 'company_settings', entityId: data.id });
      setToast({ type: 'success', message: 'Settings saved' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file) {
    if (!file) return;
    setUploading(true);
    try {
      const path = `company/logo-${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('company-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('company-assets').getPublicUrl(path);
      const url = pub?.publicUrl;
      if (url) {
        const payload = { logo_url: url, updated_at: new Date().toISOString() };
        const { data, error } = row?.id
          ? await supabase.from('company_settings').update(payload).eq('id', row.id).select().single()
          : await supabase.from('company_settings').insert([{ ...form, ...payload }]).select().single();
        if (error) throw error;
        setRow(data);
        setToast({ type: 'success', message: 'Logo uploaded' });
        logAudit({ user, action: 'company.logo.upload', entityType: 'company_settings', entityId: data.id });
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Upload failed — check if bucket "company-assets" exists in Supabase' });
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-omega-charcoal">Company Settings</h1>
        <p className="text-sm text-omega-stone mt-1">General company info used in contracts and communications</p>
      </header>

      <div className="p-6 md:p-8 max-w-2xl space-y-6">

        {/* ─── Annual sales goal ───────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-omega-orange" />
            <h2 className="text-base font-bold text-omega-charcoal">Annual Sales Goal</h2>
          </div>
          <p className="text-xs text-omega-stone mb-3">
            Shown on the office Screen dashboard. YTD revenue is compared against this number.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-omega-stone text-lg font-bold">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={goal}
              onChange={(e) => setGoal(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="6000000"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-base font-mono tracking-tight"
            />
            <button
              onClick={saveGoal}
              disabled={savingGoal}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
            >
              <Save className="w-4 h-4" /> {savingGoal ? 'Saving…' : 'Save Goal'}
            </button>
          </div>
          <p className="text-[11px] text-omega-stone mt-2">
            Preview: <span className="font-bold text-omega-charcoal">
              ${Number(goal || 0).toLocaleString()}
            </span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase">Logo</label>
            <div className="mt-2 flex items-center gap-4">
              {row?.logo_url ? (
                <img src={row.logo_url} alt="Logo" className="h-16 w-auto rounded-lg border border-gray-200" />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-gray-100 flex items-center justify-center text-omega-stone text-xs">
                  No logo
                </div>
              )}
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-omega-charcoal hover:border-omega-orange cursor-pointer">
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading…' : 'Upload Logo'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} disabled={uploading} />
              </label>
            </div>
          </div>

          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs font-semibold text-omega-stone uppercase">{f.label}</label>
              {f.type === 'textarea' ? (
                <textarea rows={2} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              ) : (
                <input type={f.type || 'text'} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              )}
            </div>
          ))}

          <div className="flex justify-end pt-2">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>

          {row?.updated_at && (
            <p className="text-xs text-omega-stone">Last updated {new Date(row.updated_at).toLocaleString()}</p>
          )}
        </div>

        {/* ─── Gmail Integration ───────────────────────────────── */}
        <GmailIntegrationCard />

      </div>
    </div>
  );
}
