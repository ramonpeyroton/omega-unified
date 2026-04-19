import { useState, useEffect } from 'react';
import { X, Edit3, ArrowRight, Save, Calendar, User as UserIcon, MapPin, FileText, ClipboardEdit, AlertCircle, Trash2, Eye, EyeOff, Phone, Mail, Briefcase, HardHat, Hammer, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';
import StatusBadge from './StatusBadge';
import PhaseBreakdown from './PhaseBreakdown';
import JobCostingSection from './JobCostingSection';
import JobExpensesSection from './JobExpensesSection';
import DailyLogsSection from './DailyLogsSection';
import TimeTrackingSection from './TimeTrackingSection';
import ProjectReportSection from './ProjectReportSection';
import { logAudit } from '../lib/audit';
import { PIPELINE_STEP_LABEL } from '../config/phaseBreakdown';

// Maps pipeline_status → the same palette used by the Kanban columns so the
// drawer header feels connected to the board.
const PIPELINE_BADGE = {
  new_lead:          { bg: 'bg-gray-400',    text: 'text-white' },
  estimate_sent:     { bg: 'bg-blue-500',    text: 'text-white' },
  estimate_approved: { bg: 'bg-purple-500',  text: 'text-white' },
  contract_sent:     { bg: 'bg-omega-orange',text: 'text-white' },
  contract_signed:   { bg: 'bg-amber-400',   text: 'text-white' },
  in_progress:       { bg: 'bg-green-500',   text: 'text-white' },
  completed:         { bg: 'bg-green-700',   text: 'text-white' },
  on_hold:           { bg: 'bg-red-500',     text: 'text-white' },
};

// Must match the columns actually inserted by NewJob.jsx on creation.
// If you add city / notes / etc. here, first add the columns to the
// `jobs` table via migration AND persist them in NewJob.jsx so the
// create and edit forms stay consistent.
const EDITABLE_FIELDS = [
  { key: 'client_name',  label: 'Client Name' },
  { key: 'client_phone', label: 'Phone' },
  { key: 'client_email', label: 'Email', type: 'email' },
  { key: 'address',      label: 'Address', type: 'textarea' },
  { key: 'service',      label: 'Service Type' },
];

export default function JobDetailDrawer({ job, user, onClose, onJobUpdated, onJobDeleted, onOpenEstimateFlow, onOpenQuestionnaire }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => pickEditable(job));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [contract, setContract] = useState(null);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePin, setDeletePin] = useState('');
  const [deletePinShow, setDeletePinShow] = useState(false);
  const [deletePinError, setDeletePinError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm(pickEditable(job));
    loadRelated();
    // eslint-disable-next-line
  }, [job?.id]);

  function pickEditable(j) {
    const obj = {};
    EDITABLE_FIELDS.forEach((f) => { obj[f.key] = j?.[f.key] || ''; });
    return obj;
  }

  async function loadRelated() {
    if (!job?.id) return;
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from('estimates').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('contracts').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setEstimate(e || null);
    setContract(c || null);
  }

  async function save() {
    setSaving(true);
    const { data, error } = await supabase.from('jobs').update(form).eq('id', job.id).select().single();
    setSaving(false);
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setEditing(false);
    setToast({ type: 'success', message: 'Job updated' });
    onJobUpdated?.(data);
  }

  function openDeleteModal() {
    setDeletePin('');
    setDeletePinError('');
    setDeletePinShow(false);
    setDeleteModal(true);
  }

  async function confirmDelete() {
    // Owner PIN gate — hardcoded per spec. A future improvement is checking
    // against `users` table for any user with role=owner + active=true.
    if (deletePin !== '3333') {
      setDeletePinError('Incorrect PIN. Try again.');
      return;
    }
    setDeleting(true);
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', job.id);
      if (error) throw error;
      logAudit({
        user,
        action: 'job.delete',
        entityType: 'job',
        entityId: job.id,
        details: { client: job.client_name, service: job.service },
      });
      onJobDeleted?.(job);
      onClose?.();
    } catch (err) {
      setDeletePinError(err.message || 'Failed to delete job');
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-30" onClick={onClose} />

      {/* Slide-in panel */}
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[460px] bg-omega-cloud z-40 shadow-2xl flex flex-col animate-[slideIn_0.2s_ease-out]">
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        {/* ─── Hero header ──────────────────────────────────────── */}
        <header className="bg-omega-charcoal text-white px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-omega-fog font-semibold">Job</p>
              <h2 className="font-bold text-lg leading-tight truncate mt-0.5">
                {job.client_name || job.name || 'Untitled'}
              </h2>
              {job.address && (
                <p className="text-xs text-omega-fog truncate mt-0.5 inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />{job.address}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Pills row: pipeline status + service */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {(() => {
              const key = job.pipeline_status || 'new_lead';
              const palette = PIPELINE_BADGE[key] || PIPELINE_BADGE.new_lead;
              return (
                <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${palette.bg} ${palette.text}`}>
                  {PIPELINE_STEP_LABEL[key] || key.replace('_', ' ')}
                </span>
              );
            })()}
            {job.service && (
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-omega-orange text-white">
                {job.service}
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Changes requested banner */}
          {estimate && (estimate.status === 'changes_requested' || estimate.change_request) && (
            <div className="mx-5 mt-4 p-3 rounded-xl border-2 border-omega-orange bg-omega-pale flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-omega-orange flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-omega-charcoal uppercase">Changes Requested</p>
                {estimate.change_request && (
                  <p className="text-sm text-omega-slate mt-1 whitespace-pre-wrap">{estimate.change_request}</p>
                )}
                {onOpenQuestionnaire && (
                  <button
                    onClick={() => { onOpenQuestionnaire(job); onClose(); }}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold"
                  >
                    <ClipboardEdit className="w-3.5 h-3.5" /> Edit Questionnaire
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Summary / Edit form */}
          <section className="p-5">
            {!editing ? (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 gap-3">
                  <Field icon={UserIcon}    label="Client"      value={job.client_name} />
                  <Field icon={Phone}       label="Phone"       value={job.client_phone} />
                  <Field icon={Mail}        label="Email"       value={job.client_email} colSpan={2} />
                  <Field icon={Briefcase}   label="Salesperson" value={job.salesperson_name} />
                  <Field icon={HardHat}     label="PM"          value={job.pm_name} />
                  <Field icon={Calendar}    label="Created"     value={job.created_at ? new Date(job.created_at).toLocaleDateString() : '—'} colSpan={2} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:border-omega-orange text-sm font-semibold text-omega-charcoal"
                  >
                    <Edit3 className="w-4 h-4" /> Edit Job
                  </button>
                  {onOpenQuestionnaire && (
                    <button
                      onClick={() => { onOpenQuestionnaire(job); onClose(); }}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:border-omega-orange text-sm font-semibold text-omega-charcoal"
                    >
                      <ClipboardEdit className="w-4 h-4" /> Questionnaire
                    </button>
                  )}
                  <button
                    onClick={openDeleteModal}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-300 bg-white text-red-700 hover:bg-red-50 text-sm font-semibold"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                  {EDITABLE_FIELDS.map((f) => (
                    <div key={f.key}>
                      <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">{f.label}</label>
                      {f.type === 'textarea' ? (
                        <textarea value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} rows={3} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                      ) : (
                        <input type={f.type || 'text'} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-3">
                  <button onClick={() => { setEditing(false); setForm(pickEditable(job)); }} className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-semibold">Cancel</button>
                  <button onClick={save} disabled={saving} className="px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2">
                    <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Quick status cards (Estimate + Contract) */}
          <section className="px-5 pb-5">
            <div className="grid grid-cols-2 gap-3">
              <StatusCard
                icon={FileText}
                label="Estimate"
                value={estimate ? (estimate.total_amount != null ? `$${Number(estimate.total_amount).toLocaleString()}` : 'Created') : 'None'}
                subtitle={estimate ? estimate.status : 'Not created yet'}
              />
              <StatusCard
                icon={Hammer}
                label="Contract"
                value={contract ? (contract.signed_at ? 'Signed' : 'Sent') : 'None'}
                subtitle={contract
                  ? (contract.signed_at ? new Date(contract.signed_at).toLocaleDateString() : contract.sent_at ? new Date(contract.sent_at).toLocaleDateString() : '—')
                  : 'Not created yet'}
              />
            </div>
          </section>

          {/* Project Report — visible to all roles reaching the drawer */}
          <div data-drawer-report>
            <CollapsibleSection title="Project Report" hint="AI-generated from questionnaire" defaultOpen>
              <ProjectReportSection job={job} />
            </CollapsibleSection>
          </div>

          {/* Phase Breakdown — visible to all */}
          <CollapsibleSection title="Phase Breakdown" hint="Track progress in the field">
            <PhaseBreakdown job={job} onJobUpdated={onJobUpdated} user={user} />
          </CollapsibleSection>

          {/* Daily Logs — visible to all */}
          <CollapsibleSection title="Daily Logs" hint="Field notes, weather, workers">
            <DailyLogsSection job={job} user={user} />
          </CollapsibleSection>

          {/* Time Tracking — visible to all */}
          <CollapsibleSection title="Time Tracking" hint="Hours by worker">
            <TimeTrackingSection job={job} user={user} />
          </CollapsibleSection>

          {/* Financial reports — owner + admin only */}
          {(user?.role === 'owner' || user?.role === 'admin') && (
            <>
              <CollapsibleSection title="Job Costing" hint="Revenue, costs and margin (Owner only)">
                <JobCostingSection job={job} user={user} />
              </CollapsibleSection>
              <CollapsibleSection title="Actual Costs" hint="Logged expenses (Owner only)">
                <JobExpensesSection job={job} user={user} />
              </CollapsibleSection>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t border-gray-200 bg-white space-y-2">
          <button
            onClick={() => { onOpenEstimateFlow?.(job); onClose(); }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
          >
            View Estimate Flow <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              // Scroll the report section into view and expand it
              const el = document.querySelector('[data-drawer-report]');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white border-2 border-omega-charcoal text-omega-charcoal hover:bg-omega-cloud text-sm font-semibold"
          >
            <Sparkles className="w-4 h-4 text-omega-orange" /> View Project Report
          </button>

          <p className="text-[11px] text-omega-stone text-center">Both actions stay in this drawer</p>
        </div>
      </aside>

      {/* Delete-job confirmation modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !deleting && setDeleteModal(false)}>
          <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200">
              <p className="font-bold text-red-700 text-lg">Delete Job</p>
              <p className="text-sm text-omega-stone mt-1">This action cannot be undone. Enter Owner PIN to confirm.</p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Owner PIN</label>
                <div className="relative mt-1">
                  <input
                    autoFocus
                    type={deletePinShow ? 'text' : 'password'}
                    value={deletePin}
                    onChange={(e) => { setDeletePin(e.target.value.replace(/\D/g, '').slice(0, 6)); setDeletePinError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmDelete(); }}
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border-2 border-gray-200 focus:border-red-400 focus:outline-none text-base font-mono tracking-[0.3em]"
                    placeholder="••••"
                  />
                  <button type="button" onClick={() => setDeletePinShow(!deletePinShow)} className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-stone">
                    {deletePinShow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {deletePinError && <p className="text-xs text-red-600 font-semibold mt-1.5">{deletePinError}</p>}
              </div>
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-xs text-red-800 font-semibold">{job.client_name || job.name || 'Untitled'}</p>
                <p className="text-[11px] text-red-700 mt-0.5">{job.address || ''}</p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || !deletePin}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

function CollapsibleSection({ title, hint, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-omega-cloud transition-colors"
      >
        <div>
          <p className="text-sm font-bold text-omega-charcoal">{title}</p>
          {hint && <p className="text-[11px] text-omega-stone mt-0.5">{hint}</p>}
        </div>
        <span className={`text-omega-stone text-lg transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {open && <div className="px-5 pb-5 bg-omega-cloud/50">{children}</div>}
    </section>
  );
}

function Field({ icon: Icon, label, value, colSpan = 1 }) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold inline-flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </p>
      <p className="text-sm font-medium text-omega-charcoal mt-0.5 truncate">{value || '—'}</p>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, subtitle }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        {Icon && (
          <div className="w-7 h-7 rounded-lg bg-omega-pale text-omega-orange flex items-center justify-center">
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
        <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">{label}</p>
      </div>
      <p className="text-base font-bold text-omega-charcoal mt-1.5">{value}</p>
      {subtitle && <p className="text-[11px] text-omega-stone mt-0.5 capitalize">{subtitle}</p>}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="w-4 h-4 text-omega-stone mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-omega-stone uppercase font-semibold">{label}</p>
        <p className="text-omega-charcoal">{value || '—'}</p>
      </div>
    </div>
  );
}
