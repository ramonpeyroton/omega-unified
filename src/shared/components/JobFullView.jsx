import { useState, useEffect } from 'react';
import {
  ArrowLeft, Edit3, Save, X, Eye, EyeOff, Trash2, Calendar, MapPin, Phone, Mail,
  User as UserIcon, Briefcase, HardHat, FileText, Hammer, Sparkles, ClipboardEdit,
  AlertCircle, DollarSign, Clock, Receipt, ArrowRight, TrendingUp, Info, MessageSquare,
  FolderClosed, RotateCcw, UserPlus,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';
import PhaseBreakdown from './PhaseBreakdown';
import JobCostingSection from './JobCostingSection';
import JobExpensesSection from './JobExpensesSection';
import DailyLogsSection from './DailyLogsSection';
import ProjectChat from './ProjectChat';
import TimeTrackingSection from './TimeTrackingSection';
import ProjectReportSection from './ProjectReportSection';
import CostProjectionSection from './CostProjectionSection';
import ContactSection from './ContactSection';
import DocumentsSection from './DocumentsSection';
import EstimateBuilder from './EstimateBuilder';
import MaterialsSection from './MaterialsSection';
import JobSubcontractorsSection from './JobSubcontractorsSection';
import JobCoverPhotoUpload from './JobCoverPhotoUpload';
import { logAudit } from '../lib/audit';
import { PIPELINE_STEP_LABEL, PIPELINE_COLORS } from '../config/phaseBreakdown';
import { formatPhoneInput, toE164 } from '../lib/phone';

// Roles allowed to see the Financials tab (Cost Projection + Job Costing + Actual Costs).
// Internal money only — sellers don't see margin/cost data.
const FINANCIAL_ROLES = new Set(['owner', 'operations', 'admin']);

// Roles allowed to see the Estimate tab (what the client receives).
// Sales needs this because the seller builds the estimate during the
// visit; operations/owner/admin also see it for oversight.
const ESTIMATE_ROLES = new Set(['sales', 'salesperson', 'owner', 'operations', 'admin']);

// Roles allowed to see the Contact tab (send SMS / WhatsApp to subs + client).
const CONTACT_ROLES = new Set(['manager', 'owner', 'operations', 'admin']);

// Roles allowed to see the Subcontractors tab. Hidden from Manager
// (Gabriel does the work, doesn't pick subs) and Receptionist (Rafaela
// only handles leads). Sales sees the assignments so they can answer
// client questions about who's doing what.
const SUBS_ROLES = new Set(['owner', 'operations', 'sales', 'salesperson', 'admin', 'marketing']);

// Reset is only allowed before the deal is sealed. Once a contract is
// signed or work has started, the user must use Delete instead — too
// many downstream artifacts (signed contract, sub agreements, milestones,
// phase progress) would silently disappear.
const RESET_BLOCKED_STATUSES = new Set(['contract_signed', 'in_progress', 'completed']);

function pipelinePaletteFor(key) {
  const c = PIPELINE_COLORS[key];
  return { bg: c?.tailwindBg || 'bg-gray-400', text: 'text-white' };
}

const EDITABLE_FIELDS = [
  { key: 'client_name',  label: 'Client Name' },
  { key: 'client_phone', label: 'Phone', type: 'phone' },
  { key: 'client_email', label: 'Email', type: 'email' },
  { key: 'address',      label: 'Address', type: 'textarea' },
  { key: 'service',      label: 'Service Type' },
];

function pickEditable(j) {
  const obj = {};
  EDITABLE_FIELDS.forEach((f) => { obj[f.key] = j?.[f.key] || ''; });
  return obj;
}

export default function JobFullView({
  job: initialJob,
  user,
  onClose,
  onJobUpdated,
  onJobDeleted,
  onOpenEstimateFlow,
  onOpenQuestionnaire,
  // Optional callback: when present, the Details tab shows a
  // "Start New Job for this Client" button. Receives a `clientData`
  // object ({ client_name, client_phone, client_email, address }) so
  // the host app can pre-fill its own NewJob form. Currently wired up
  // by the Sales app — Owner/Operations don't surface the button.
  onStartNewJobForClient,
}) {
  const [job, setJob] = useState(initialJob);
  // Report is the primary landing tab — it's why most people open the job.
  const [tab, setTab] = useState('report');
  const [estimate, setEstimate] = useState(null);
  const [contract, setContract] = useState(null);
  const [toast, setToast] = useState(null);

  // Edit mode (Details tab)
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => pickEditable(initialJob));
  const [saving, setSaving] = useState(false);

  // Delete modal
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePin, setDeletePin] = useState('');
  const [deletePinShow, setDeletePinShow] = useState(false);
  const [deletePinError, setDeletePinError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Reset-to-new-lead modal — same PIN gate as Delete, but instead of
  // dropping the row it wipes the estimate/contract/questionnaire state
  // so the seller can start fresh on the same client.
  const [resetModal, setResetModal] = useState(false);
  const [resetPin, setResetPin] = useState('');
  const [resetPinShow, setResetPinShow] = useState(false);
  const [resetPinError, setResetPinError] = useState('');
  const [resetting, setResetting] = useState(false);

  const canSeeFinancials = FINANCIAL_ROLES.has(user?.role);
  const canSeeEstimate   = ESTIMATE_ROLES.has(user?.role);
  const canContact       = CONTACT_ROLES.has(user?.role);
  const canSeeSubs       = SUBS_ROLES.has(user?.role);

  useEffect(() => {
    setJob(initialJob);
    setForm(pickEditable(initialJob));
    loadRelated();
    // eslint-disable-next-line
  }, [initialJob?.id]);

  async function loadRelated() {
    if (!initialJob?.id) return;
    try {
      const [{ data: e }, { data: c }] = await Promise.all([
        supabase.from('estimates').select('*').eq('job_id', initialJob.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('contracts').select('*').eq('job_id', initialJob.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setEstimate(e || null);
      setContract(c || null);
    } catch { /* ignore */ }
  }

  async function saveEdits() {
    setSaving(true);
    try {
      const patch = Object.fromEntries(
        Object.entries(form).map(([k, v]) => {
          if (v === '') return [k, null];
          // Persist phone in E.164 so Twilio accepts it without retries.
          if (k === 'client_phone' && v) return [k, toE164(v) || v];
          return [k, v];
        })
      );
      const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single();
      if (error) throw error;
      setJob(data);
      setEditing(false);
      onJobUpdated?.(data);
      setToast({ type: 'success', message: 'Job updated' });
      logAudit({ user, action: 'job.edit', entityType: 'job', entityId: data.id });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  function openDeleteModal() {
    setDeletePin('');
    setDeletePinError('');
    setDeletePinShow(false);
    setDeleteModal(true);
  }

  function openResetModal() {
    setResetPin('');
    setResetPinError('');
    setResetPinShow(false);
    setResetModal(true);
  }

  // Wipe estimate/contract/questionnaire state so the same job row can
  // be used for a different scope. Owner PIN required (same as Delete)
  // — the action is destructive and loses revision history. We keep the
  // job row itself (and the cover photo, materials, documents) so the
  // client/address/contact info isn't typed in twice.
  async function confirmReset() {
    if (resetPin !== '3333') {
      setResetPinError('Incorrect PIN. Try again.');
      logAudit({
        user, action: 'job.reset.pin_failed', entityType: 'job', entityId: job.id,
        details: { client: job.client_name, attempted_pin_prefix: (resetPin || '').slice(0, 1) + '***' },
      });
      return;
    }
    if (RESET_BLOCKED_STATUSES.has(job.pipeline_status)) {
      setResetPinError('Cannot reset — job has a signed contract or is in progress. Delete it instead.');
      return;
    }
    setResetting(true);
    try {
      // Drop downstream artifacts. We don't bother checking whether
      // these tables have rows — DELETE on an empty match is a no-op.
      // Order matters only for FK cascades; estimates and contracts
      // are independent rows keyed by job_id.
      await supabase.from('estimates').delete().eq('job_id', job.id);
      await supabase.from('contracts').delete().eq('job_id', job.id);
      await supabase.from('job_reports').delete().eq('job_id', job.id);

      // Reset every field that drives "where in the funnel is this job".
      // We intentionally KEEP: client_name, client_phone, client_email,
      // address, salesperson_name, pm_name, cover photo, documents,
      // materials, time logs. Those represent client identity and
      // collateral the seller wouldn't want to re-enter.
      const patch = {
        pipeline_status: 'new_lead',
        status: 'draft',
        answers: {},
        questionnaire_modified: null,
        questionnaire_modified_at: null,
        report_raw: null,
        latest_report: null,
        cost_projection: null,
        cost_projection_at: null,
        phase_data: null,
      };
      const { data, error } = await supabase
        .from('jobs').update(patch).eq('id', job.id)
        .select().single();
      if (error) throw error;

      setJob(data);
      setEstimate(null);
      setContract(null);
      onJobUpdated?.(data);

      logAudit({
        user, action: 'job.reset', entityType: 'job', entityId: job.id,
        details: {
          client: job.client_name,
          previous_status: job.pipeline_status,
          authorized_by: user?.name || null,
          authorized_by_role: user?.role || null,
        },
      });

      setResetModal(false);
      setToast({ type: 'success', message: 'Job reset — start the questionnaire fresh.' });
    } catch (err) {
      setResetPinError(err.message || 'Failed to reset');
    } finally {
      setResetting(false);
    }
  }

  async function confirmDelete() {
    // Delete always requires the Owner PIN (3333) — even Brenda has to
    // type it. The audit log captures which role/person INITIATED the
    // delete plus the PIN string actually used, so Admin can see who
    // authorized every deletion.
    if (deletePin !== '3333') {
      setDeletePinError('Incorrect PIN. Try again.');
      // Fire-and-forget attempt log (failed attempts are auditable too)
      logAudit({
        user, action: 'job.delete.pin_failed', entityType: 'job', entityId: job.id,
        details: { client: job.client_name, attempted_pin_prefix: (deletePin || '').slice(0, 1) + '***' },
      });
      return;
    }
    setDeleting(true);
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', job.id);
      if (error) throw error;
      logAudit({
        user, action: 'job.delete', entityType: 'job', entityId: job.id,
        details: {
          client: job.client_name,
          service: job.service,
          pipeline_status: job.pipeline_status,
          pin_used: '3333',                 // always the owner PIN
          authorized_by: user?.name || null, // whoever was logged in when the delete happened
          authorized_by_role: user?.role || null,
        },
      });
      onJobDeleted?.(job);
      onClose?.();
    } catch (err) {
      setDeletePinError(err.message || 'Failed to delete');
      setDeleting(false);
    }
  }

  const pipelineKey = job.pipeline_status || 'new_lead';
  const pipelinePalette = pipelinePaletteFor(pipelineKey);
  const pipelineLabel = PIPELINE_STEP_LABEL[pipelineKey] || pipelineKey.replace('_', ' ');

  // Tab order (owner-requested):
  // Report → Estimate → Contact → Documents → Time → Financials → Phases → Daily Logs → Details
  // Estimate is visible to Sales (who builds it) + Owner/Ops/Admin.
  // Financials (internal cost/margin) stays restricted to Owner/Ops/Admin.
  const TABS = [
    { id: 'report',    label: 'Report',     icon: Sparkles },
    canSeeEstimate   && { id: 'estimate',   label: 'Estimate',   icon: Receipt },
    canSeeSubs       && { id: 'subs',       label: 'Subs',       icon: HardHat },
    canContact       && { id: 'contact',    label: 'Contact',    icon: MessageSquare },
    { id: 'documents', label: 'Documents',  icon: FolderClosed },
    { id: 'time',      label: 'Time',       icon: Clock },
    canSeeFinancials && { id: 'financials', label: 'Financials', icon: DollarSign },
    { id: 'phases',    label: 'Phases',     icon: HardHat },
    { id: 'daily',     label: 'Daily Logs', icon: FileText },
    { id: 'details',   label: 'Details',    icon: Info },
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-40 bg-omega-cloud flex flex-col animate-[fadeIn_0.2s_ease-out]">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ─── Top bar ───────────────────────────────────────── */}
      <header className="bg-omega-charcoal text-white">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-semibold transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Back</span>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-omega-fog font-semibold">Job</p>
            <h1 className="font-bold text-lg sm:text-xl leading-tight truncate">
              {job.client_name || job.name || 'Untitled'}
            </h1>
          </div>
          {/* Quick actions (desktop) */}
          <div className="hidden sm:flex items-center gap-2">
            {onOpenQuestionnaire && (
              <button
                onClick={() => { onOpenQuestionnaire(job); onClose?.(); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold"
              >
                <ClipboardEdit className="w-3.5 h-3.5" /> Questionnaire
              </button>
            )}
            <button
              onClick={() => { onOpenEstimateFlow?.(job); onClose?.(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-xs font-semibold"
            >
              Estimate Flow <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-4 sm:px-6 pb-3 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${pipelinePalette.bg} ${pipelinePalette.text}`}>
            {pipelineLabel}
          </span>
          {job.service && (
            <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-omega-orange text-white">
              {job.service}
            </span>
          )}
          {job.address && (
            <span className="text-xs text-omega-fog inline-flex items-center gap-1 truncate">
              <MapPin className="w-3 h-3" />{job.address}
            </span>
          )}
        </div>

        {/* Tabs */}
        <nav className="border-t border-white/10 overflow-x-auto scrollbar-hide">
          <div className="px-2 sm:px-4 flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 sm:px-4 py-3 text-xs sm:text-sm font-semibold whitespace-nowrap inline-flex items-center gap-1.5 border-b-2 transition-colors ${
                    active
                      ? 'border-omega-orange text-white'
                      : 'border-transparent text-omega-fog hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* ─── Changes requested banner ──────────────────────── */}
      {estimate && (estimate.status === 'changes_requested' || estimate.change_request) && (
        <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-xl border-2 border-omega-orange bg-omega-pale flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-omega-orange flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-omega-charcoal uppercase">Changes Requested</p>
            {estimate.change_request && (
              <p className="text-sm text-omega-slate mt-1 whitespace-pre-wrap">{estimate.change_request}</p>
            )}
            {onOpenQuestionnaire && (
              <button
                onClick={() => { onOpenQuestionnaire(job); onClose?.(); }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold"
              >
                <ClipboardEdit className="w-3.5 h-3.5" /> Edit Questionnaire
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Body ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 sm:p-6">
          {tab === 'report' && (
            <ProjectReportSection
              job={job}
              user={user}
              onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
              onOpenQuestionnaire={onOpenQuestionnaire ? () => { onOpenQuestionnaire(job); onClose?.(); } : null}
            />
          )}

          {tab === 'phases' && (
            <div className="space-y-5">
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <h2 className="text-lg font-bold text-omega-charcoal mb-4 inline-flex items-center gap-2">
                  <HardHat className="w-4 h-4 text-omega-orange" /> Phase Breakdown
                </h2>
                <PhaseBreakdown
                  job={job}
                  user={user}
                  onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
                />
              </div>
              {/* Materials list — Manager's shopping items for this job. */}
              <MaterialsSection job={job} user={user} />
            </div>
          )}

          {tab === 'daily' && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
              <h2 className="text-lg font-bold text-omega-charcoal mb-4 inline-flex items-center gap-2">
                <FileText className="w-4 h-4 text-omega-orange" /> Daily Logs
              </h2>
              {/* Sprint 3 of the chat-per-project feature: this tab now
                  renders the Slack channel linked to the job. The legacy
                  structured DailyLogsSection (weather, workers on site,
                  etc.) is intentionally kept in the codebase so we can
                  surface that history again later if needed — it's just
                  no longer the primary UX here. */}
              <ProjectChat
                job={job}
                user={user}
                onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
              />
            </div>
          )}

          {tab === 'time' && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
              <h2 className="text-lg font-bold text-omega-charcoal mb-4 inline-flex items-center gap-2">
                <Clock className="w-4 h-4 text-omega-orange" /> Time Tracking
              </h2>
              <TimeTrackingSection job={job} user={user} />
            </div>
          )}

          {tab === 'documents' && (
            <DocumentsSection
              job={job}
              user={user}
              onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
            />
          )}

          {tab === 'contact' && canContact && (
            <ContactSection job={job} user={user} />
          )}

          {tab === 'subs' && canSeeSubs && (
            <JobSubcontractorsSection job={job} user={user} />
          )}

          {tab === 'estimate' && canSeeEstimate && (
            <div className="space-y-5">
              {/* Cost Projection — internal reference, hidden from sellers
                  (cost/margin data stays in Finance roles only). */}
              {canSeeFinancials && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                    <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-omega-orange" /> Cost Projection
                    </h2>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold uppercase tracking-wider">AI · one-time</span>
                  </div>
                  <p className="text-xs text-omega-stone mb-4">
                    AI-generated cost breakdown from the questionnaire — use it as a reference while composing the estimate below.
                  </p>
                  <CostProjectionSection
                    job={job}
                    user={user}
                    onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
                  />
                </div>
              )}

              {/* Estimate builder — the thing the client actually sees */}
              <EstimateBuilder
                job={job}
                user={user}
                onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
              />
            </div>
          )}

          {tab === 'financials' && canSeeFinancials && (
            <div className="space-y-5">
              {/* Manual Job Costing */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <h2 className="text-lg font-bold text-omega-charcoal mb-1 inline-flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-omega-orange" /> Job Costing (manual)
                </h2>
                <p className="text-xs text-omega-stone mb-4">Track revenue, costs and gross margin as the project advances.</p>
                <JobCostingSection job={job} user={user} />
              </div>

              {/* Actual expenses log */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <h2 className="text-lg font-bold text-omega-charcoal mb-1 inline-flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-omega-orange" /> Actual Costs
                </h2>
                <p className="text-xs text-omega-stone mb-4">Log real expenses as they happen. Variance vs. estimate updates automatically.</p>
                <JobExpensesSection job={job} user={user} />
              </div>
            </div>
          )}

          {tab === 'details' && (
            <DetailsTab
              job={job}
              editing={editing}
              setEditing={setEditing}
              form={form}
              setForm={setForm}
              saveEdits={saveEdits}
              saving={saving}
              estimate={estimate}
              contract={contract}
              onOpenEstimateFlow={() => { onOpenEstimateFlow?.(job); onClose?.(); }}
              onOpenQuestionnaire={onOpenQuestionnaire ? () => { onOpenQuestionnaire(job); onClose?.(); } : null}
              onDelete={openDeleteModal}
              onReset={openResetModal}
              onStartNewJobForClient={onStartNewJobForClient ? () => {
                onStartNewJobForClient({
                  client_name: job.client_name || '',
                  client_phone: job.client_phone || '',
                  client_email: job.client_email || '',
                  address: job.address || '',
                });
                onClose?.();
              } : null}
              canReset={!RESET_BLOCKED_STATUSES.has(job.pipeline_status)}
              onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
            />
          )}
        </div>
      </div>

      {/* ─── Delete-job confirmation ───────────────────────── */}
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
              <button onClick={() => setDeleteModal(false)} disabled={deleting} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmDelete} disabled={deleting || !deletePin} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-60">
                <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reset-to-new-lead confirmation ────────────────── */}
      {resetModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !resetting && setResetModal(false)}>
          <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200">
              <p className="font-bold text-amber-700 text-lg inline-flex items-center gap-2">
                <RotateCcw className="w-5 h-5" /> Reset Job
              </p>
              <p className="text-sm text-omega-stone mt-1">
                Wipes the current estimate, contract draft, questionnaire answers and AI report. The client info, address and cover photo stay. Owner PIN required.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Owner PIN</label>
                <div className="relative mt-1">
                  <input
                    autoFocus
                    type={resetPinShow ? 'text' : 'password'}
                    value={resetPin}
                    onChange={(e) => { setResetPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setResetPinError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmReset(); }}
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border-2 border-gray-200 focus:border-amber-400 focus:outline-none text-base font-mono tracking-[0.3em]"
                    placeholder="••••"
                  />
                  <button type="button" onClick={() => setResetPinShow(!resetPinShow)} className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-stone">
                    {resetPinShow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {resetPinError && <p className="text-xs text-red-600 font-semibold mt-1.5">{resetPinError}</p>}
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-800 font-semibold">{job.client_name || job.name || 'Untitled'}</p>
                <p className="text-[11px] text-amber-700 mt-0.5">{job.address || ''}</p>
                <p className="text-[11px] text-amber-700 mt-1">
                  Will become a fresh <strong>New Lead</strong>.
                </p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setResetModal(false)} disabled={resetting} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmReset} disabled={resetting || !resetPin} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-60">
                <RotateCcw className="w-4 h-4" /> {resetting ? 'Resetting…' : 'Reset Job'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Details tab (last tab) ──────────────────────────────
function DetailsTab({
  job, estimate, contract,
  editing, setEditing, form, setForm, saveEdits, saving,
  onOpenEstimateFlow, onOpenQuestionnaire, onDelete, onReset, canReset,
  onStartNewJobForClient, onJobUpdated,
}) {
  return (
    <div className="space-y-5">
      {/* Client info card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        {/* Cover photo — sits above the field grid so the user notices
            it on first read of the tab. Stays visible whether or not
            the form is in "edit mode" since the upload widget itself
            is its own self-contained editor. */}
        <div className="mb-5 pb-5 border-b border-gray-100">
          <JobCoverPhotoUpload job={job} onUpdated={onJobUpdated} />
        </div>

        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-bold text-omega-charcoal">Client & Job Info</h2>
          <div className="flex items-center gap-2">
            {!editing ? (
              <>
                <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal">
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
                {onOpenQuestionnaire && (
                  <button onClick={onOpenQuestionnaire} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal">
                    <ClipboardEdit className="w-4 h-4" /> Questionnaire
                  </button>
                )}
              </>
            ) : (
              <>
                <button onClick={() => setEditing(false)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
                <button onClick={saveEdits} disabled={saving} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                  <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>

        {!editing ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
            <Field icon={UserIcon}  label="Client"      value={job.client_name} />
            <Field icon={Phone}     label="Phone"       value={job.client_phone} />
            <Field icon={Mail}      label="Email"       value={job.client_email} />
            <Field icon={MapPin}    label="Address"     value={job.address} colSpan={3} />
            <Field icon={Briefcase} label="Salesperson" value={job.salesperson_name} />
            <Field icon={HardHat}   label="PM"          value={job.pm_name} />
            <Field icon={Calendar}  label="Created"     value={job.created_at ? new Date(job.created_at).toLocaleDateString() : '—'} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EDITABLE_FIELDS.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">{f.label}</label>
                {f.type === 'textarea' ? (
                  <textarea value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                ) : f.type === 'phone' ? (
                  <input
                    type="tel"
                    inputMode="tel"
                    value={form[f.key] || ''}
                    onChange={(e) => setForm({ ...form, [f.key]: formatPhoneInput(e.target.value) })}
                    placeholder="(203) 555-1234"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                  />
                ) : (
                  <input type={f.type || 'text'} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatusCard
          icon={FileText}
          label="Estimate"
          value={estimate ? (estimate.total_amount != null ? `$${Number(estimate.total_amount).toLocaleString()}` : 'Created') : 'None'}
          subtitle={estimate ? (estimate.status || '—') : 'Not created yet'}
        />
        <StatusCard
          icon={Hammer}
          label="Contract"
          value={contract ? (contract.signed_at ? 'Signed' : 'Sent') : 'None'}
          subtitle={contract
            ? (contract.signed_at ? new Date(contract.signed_at).toLocaleDateString()
               : contract.sent_at ? new Date(contract.sent_at).toLocaleDateString() : '—')
            : 'Not created yet'}
        />
      </div>

      {/* Primary CTA */}
      <button
        onClick={onOpenEstimateFlow}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
      >
        View Estimate Flow <ArrowRight className="w-4 h-4" />
      </button>

      {/* Start a new job for this same client. Visible only when the
          host app passed `onStartNewJobForClient` (currently the Sales
          app — Owner/Operations don't surface it). Use case: returning
          customer wants a different/larger scope than what we already
          quoted them. Their existing card stays untouched as history. */}
      {onStartNewJobForClient && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
          <h3 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-omega-orange" /> Returning Client?
          </h3>
          <p className="text-xs text-omega-stone mt-1">
            Start a brand-new job for <strong>{job.client_name || 'this client'}</strong> — different scope, fresh questionnaire and estimate. Their existing card stays as history.
          </p>
          <button
            onClick={onStartNewJobForClient}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-bold"
          >
            <UserPlus className="w-4 h-4" /> Start New Job for this Client
          </button>
        </div>
      )}

      {/* Danger Zone — destructive actions live here so they're visually
          isolated. Reset is for "I tested with this card, wipe the
          estimate so I can use it for the real lead". Delete is the
          nuclear option (drops the row entirely). Both PIN-gated by
          the Owner PIN inside their respective modals. */}
      <div className="bg-white rounded-xl border-2 border-red-200 p-4 sm:p-6">
        <h3 className="text-base font-bold text-red-800 inline-flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> Danger Zone
        </h3>
        <p className="text-xs text-omega-stone mt-1">
          These actions require the Owner PIN.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={onReset}
            disabled={!canReset}
            title={canReset ? 'Wipe estimate, contract draft, questionnaire and AI report — keep the client info.' : 'Cannot reset: job has a signed contract or is in progress.'}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-amber-300 text-amber-800 hover:bg-amber-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" /> Reset to New Lead
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-red-300 text-red-700 hover:bg-red-50 text-sm font-bold"
          >
            <Trash2 className="w-4 h-4" /> Delete Job
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value, colSpan = 1 }) {
  const span = colSpan === 3 ? 'sm:col-span-2 md:col-span-3' : colSpan === 2 ? 'sm:col-span-2' : '';
  return (
    <div className={span}>
      <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold inline-flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </p>
      <p className="text-sm font-medium text-omega-charcoal mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, subtitle }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2">
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-omega-pale text-omega-orange flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </div>
        )}
        <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">{label}</p>
      </div>
      <p className="text-xl font-bold text-omega-charcoal mt-2">{value}</p>
      {subtitle && <p className="text-xs text-omega-stone mt-0.5 capitalize">{subtitle}</p>}
    </div>
  );
}
