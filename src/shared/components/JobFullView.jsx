import { useState, useEffect } from 'react';
import {
  ArrowLeft, Edit3, Save, X, Eye, EyeOff, Trash2, Calendar, MapPin, Phone, Mail,
  User as UserIcon, Briefcase, HardHat, FileText, Hammer, Sparkles, ClipboardEdit,
  AlertCircle, DollarSign, Clock, Receipt, ArrowRight, TrendingUp, Info, MessageSquare,
  FolderClosed, RotateCcw, UserPlus, Globe, Loader2, Plus, MoreHorizontal,
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
import { PIPELINE_STEP_LABEL, PIPELINE_COLORS, PIPELINE_ORDER } from '../config/phaseBreakdown';
import { formatPhoneInput, toE164 } from '../lib/phone';
import { SERVICES, parseJobServices, joinJobServices } from '../data/services';
import { validateUserPin, validateOwnerPin } from '../lib/userPin';

// Phases that require a PIN confirmation when moved into via the
// status picker. Mirrors the kanban's PIN_GATED_PHASES set so both
// surfaces have the same friction for terminal phases.
const PICKER_PIN_GATED = new Set(['estimate_rejected']);

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

// Roles that see a stripped-down JobFullView: Details + Daily Logs
// only, no Edit/Delete/Reset/Estimate-Flow buttons. Used by the
// receptionist (Rafaela) and the field manager (Gabriel) — they need
// to see basic info + the project chat, but they're not responsible
// for editing the funnel or running the estimate flow. Gabriel
// specifically cannot edit client info on the card; that gate is
// applied below via the `canEditClient` check.
const READ_ONLY_BASIC_ROLES = new Set(['receptionist', 'manager']);

// Subset of the above that still cannot edit the client/contact info
// on the Details tab. Per Ramon's rules: Rafaela can edit (intake is
// her job); Gabriel can read but not change — he's the field guy,
// not the office.
const READ_ONLY_EDIT_BLOCKED = new Set(['manager']);

function pipelinePaletteFor(key) {
  const c = PIPELINE_COLORS[key];
  return { bg: c?.tailwindBg || 'bg-gray-400', text: 'text-white' };
}

const EDITABLE_FIELDS = [
  { key: 'client_name',  label: 'Client Name' },
  { key: 'client_phone', label: 'Phone', type: 'phone' },
  { key: 'client_email', label: 'Email', type: 'email' },
  { key: 'address',      label: 'Address', type: 'textarea' },
  // `service` renders as multi-select chips so the seller can change
  // "deck" to "flooring" (or pick more than one) after the lead was
  // created. Persisted back to the same comma-separated string we've
  // always used.
  { key: 'service',      label: 'Services',     type: 'services' },
];

function pickEditable(j) {
  const obj = {};
  EDITABLE_FIELDS.forEach((f) => {
    if (f.type === 'services') {
      // Edit mode keeps `service` as an array of ids; saveEdits joins
      // it back to the canonical comma-separated string for storage.
      obj[f.key] = parseJobServices(j?.[f.key]);
    } else {
      obj[f.key] = j?.[f.key] || '';
    }
  });
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
  // For receptionist (READ_ONLY_BASIC_ROLES), we land on Details directly
  // because that's the only tab they have.
  const [tab, setTab] = useState(
    READ_ONLY_BASIC_ROLES.has(user?.role) ? 'details' : 'report'
  );
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

  // Read-only-basic view (Rafaela + Gabriel): Details + Daily Logs
  // tabs only, no Edit/Delete/Reset/Estimate-Flow buttons. Every
  // other role check below carries an explicit `&& !readOnlyBasic` so
  // it evaluates to false for these roles, hiding their tabs.
  const readOnlyBasic    = READ_ONLY_BASIC_ROLES.has(user?.role);
  // Gabriel (manager) is read-only-basic AND specifically blocked from
  // editing the client info on the Details tab — he's the field guy,
  // not the office. Rafaela stays editable because intake is her job.
  const editBlocked      = READ_ONLY_EDIT_BLOCKED.has(user?.role);
  const canSeeFinancials = !readOnlyBasic && FINANCIAL_ROLES.has(user?.role);
  const canSeeEstimate   = !readOnlyBasic && ESTIMATE_ROLES.has(user?.role);
  const canContact       = !readOnlyBasic && CONTACT_ROLES.has(user?.role);
  const canSeeSubs       = !readOnlyBasic && SUBS_ROLES.has(user?.role);

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
          // The Services chip editor stores an array in form state; we
          // collapse it back to the comma-separated string the rest of
          // the app expects. An empty selection becomes null.
          if (k === 'service' && Array.isArray(v)) {
            const joined = joinJobServices(v);
            return [k, joined || null];
          }
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
    // Owner PIN gate — looked up against the users table now (the
    // hardcoded "3333" was retired once Ramon registered the real
    // owner row through Admin → Users).
    const ok = await validateOwnerPin(resetPin);
    if (!ok) {
      setResetPinError('Incorrect Owner PIN. Try again.');
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
    // Delete always requires the Owner PIN — even Brenda has to type
    // it. We validate against the live users.role='owner' row instead
    // of the old hardcoded "3333" so changing the owner's PIN through
    // Admin → Users updates the gate automatically.
    const ok = await validateOwnerPin(deletePin);
    if (!ok) {
      setDeletePinError('Incorrect Owner PIN. Try again.');
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
          // We don't store the pin string anymore — validation runs
          // against users table; logging just records WHO confirmed.
          authorized_by: user?.name || null,
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
  // Read-only-basic view (Rafaela + Gabriel): Daily Logs lands first
  // because they spend most of their time in the per-job chat.
  // Documents is exposed for the receptionist (paperwork that arrives
  // by mail — permits, signed checks — typically lands on her desk
  // first), but the field manager keeps the leaner two-tab view.
  // Full-access roles get the order Ramon specified:
  //   Daily Logs → Report → Estimate → Phases → Subs → Contact →
  //   Time → Financials → Documents → Details
  const TABS = readOnlyBasic
    ? [
        { id: 'daily',   label: 'Daily Logs', icon: FileText },
        user?.role === 'receptionist' && { id: 'documents', label: 'Documents', icon: FolderClosed },
        { id: 'details', label: 'Details',    icon: Info },
      ].filter(Boolean)
    : [
        { id: 'daily',     label: 'Daily Logs', icon: FileText },
        { id: 'report',    label: 'Report',     icon: Sparkles },
        canSeeEstimate   && { id: 'estimate',   label: 'Estimate',   icon: Receipt },
        { id: 'phases',    label: 'Phases',     icon: HardHat },
        canSeeSubs       && { id: 'subs',       label: 'Subs',       icon: HardHat },
        canContact       && { id: 'contact',    label: 'Contact',    icon: MessageSquare },
        { id: 'time',      label: 'Time',       icon: Clock },
        canSeeFinancials && { id: 'financials', label: 'Financials', icon: DollarSign },
        { id: 'documents', label: 'Documents',  icon: FolderClosed },
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
          {/* Quick actions (desktop). The Estimate Flow shortcut now
              lives in the header again — it's the seller's most-used
              gateway and the field crew asked to keep it one click
              away from anywhere in the job, not buried in a tab.
              Call / Email open the OS handler so the seller can dial
              or send straight from any tab. */}
          <div className="hidden sm:flex items-center gap-2">
            {job.client_phone && (
              <a
                href={`tel:${job.client_phone}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold"
                title={`Call ${job.client_phone}`}
              >
                <Phone className="w-3.5 h-3.5" /> Call
              </a>
            )}
            {job.client_email && (
              <a
                href={`mailto:${job.client_email}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold"
                title={`Email ${job.client_email}`}
              >
                <Mail className="w-3.5 h-3.5" /> Email
              </a>
            )}
            {onOpenQuestionnaire && (
              <button
                onClick={() => { onOpenQuestionnaire(job); onClose?.(); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold"
              >
                <ClipboardEdit className="w-3.5 h-3.5" /> Questionnaire
              </button>
            )}
            {onOpenEstimateFlow && (
              <button
                onClick={() => { onOpenEstimateFlow(job); onClose?.(); }}
                className="inline-flex items-center gap-2 pl-3 pr-2 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold shadow-sm transition-colors"
                title="Review · Payment plan · Contract · Invoice"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span className="text-left leading-tight">
                  <span className="block text-[11px] font-bold">Open Estimate Flow</span>
                  <span className="block text-[9px] font-medium text-white/85">Review · Payment plan · Contract · Invoice</span>
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-6 pb-3 flex items-center gap-2 flex-wrap">
          {/* Pipeline status — click to move the job to another phase
              without having to drag-and-drop on the Kanban. Especially
              useful for the rightmost phases (Completed / Estimate
              Rejected) that often sit off-screen on the pipeline. */}
          {readOnlyBasic ? (
            <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${pipelinePalette.bg} ${pipelinePalette.text}`}>
              {pipelineLabel}
            </span>
          ) : (
            <PipelineStatusPicker
              currentKey={pipelineKey}
              user={user}
              jobId={job.id}
              onMoved={(updated) => { setJob(updated); onJobUpdated?.(updated); }}
              palette={pipelinePalette}
              label={pipelineLabel}
            />
          )}
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
              {/* The Open Estimate Flow shortcut moved back to the header
                  bar (top-right) so it's reachable from any tab without
                  scrolling. */}

              {/* Cost Projection — internal reference, hidden from sellers
                  (cost/margin data stays in Finance roles only). */}
              {canSeeFinancials && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                  {/* Step header with the numbered badge — matches the
                      seller-facing redesign so each section reads as a
                      checklist (1 → 2 → 3 → 4) instead of a flat scroll. */}
                  <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                    <div className="inline-flex items-start gap-3">
                      <StepBadge n={1} />
                      <div>
                        <h2 className="text-lg font-bold text-omega-charcoal">Cost Projection</h2>
                        <p className="text-xs text-omega-stone mt-0.5 max-w-xl">
                          AI-generated cost breakdown from the questionnaire — use it as a reference while composing the estimate below.
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold uppercase tracking-wider self-start">AI · one-time</span>
                  </div>

                  {/* Two-column layout: the projection / empty state on
                      the left, a small "How it works" sidebar on the
                      right that explains where the numbers come from.
                      Stacks on small viewports. */}
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px] gap-5">
                    <div>
                      <CostProjectionSection
                        job={job}
                        user={user}
                        onJobUpdated={(u) => { setJob(u); onJobUpdated?.(u); }}
                      />
                    </div>
                    <aside className="bg-omega-cloud border border-gray-100 rounded-lg p-4 self-start">
                      <p className="text-[11px] font-bold text-omega-charcoal uppercase tracking-wider mb-3">How it works</p>
                      <ul className="space-y-3 text-xs text-omega-slate">
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-omega-pale text-omega-orange text-[10px] font-bold inline-flex items-center justify-center flex-shrink-0">1</span>
                          <span>
                            <strong className="block text-omega-charcoal">AI analyzes questionnaire</strong>
                            <span className="text-omega-stone">We review the client's answers</span>
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-omega-pale text-omega-orange text-[10px] font-bold inline-flex items-center justify-center flex-shrink-0">2</span>
                          <span>
                            <strong className="block text-omega-charcoal">Connects live pricing</strong>
                            <span className="text-omega-stone">Labor rates + Home Depot materials</span>
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-omega-pale text-omega-orange text-[10px] font-bold inline-flex items-center justify-center flex-shrink-0">3</span>
                          <span>
                            <strong className="block text-omega-charcoal">Generates estimate</strong>
                            <span className="text-omega-stone">Review and adjust as needed</span>
                          </span>
                        </li>
                      </ul>
                    </aside>
                  </div>

                  {/* Quick tip callout — a soft blue strip at the bottom
                      of the card that nudges the user toward generating
                      a projection before they hand-type the estimate. */}
                  <div className="mt-4 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-900 inline-flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span><strong>Tip:</strong> Generate a projection to get a starting point. You can customize all sections before sending.</span>
                  </div>
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
              user={user}
              editing={editing}
              setEditing={setEditing}
              form={form}
              setForm={setForm}
              saveEdits={saveEdits}
              saving={saving}
              estimate={estimate}
              contract={contract}
              readOnlyBasic={readOnlyBasic}
              editBlocked={editBlocked}
              onOpenEstimateFlow={readOnlyBasic ? null : () => { onOpenEstimateFlow?.(job); onClose?.(); }}
              onOpenQuestionnaire={!readOnlyBasic && onOpenQuestionnaire ? () => { onOpenQuestionnaire(job); onClose?.(); } : null}
              onDelete={readOnlyBasic ? null : openDeleteModal}
              onReset={readOnlyBasic ? null : openResetModal}
              onStartNewJobForClient={!readOnlyBasic && onStartNewJobForClient ? () => {
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
  job, user, estimate, contract,
  editing, setEditing, form, setForm, saveEdits, saving,
  readOnlyBasic = false, editBlocked = false,
  onOpenEstimateFlow, onOpenQuestionnaire, onDelete, onReset, canReset,
  onStartNewJobForClient, onJobUpdated,
}) {
  return (
    <div className="space-y-5">
      {/* ─── Cover banner — full-width edge-to-edge image with the
            "Change Photo" button overlayed bottom-left. Mirrors
            Ramon's redesign mockup. */}
      {!editBlocked && (
        <div className="rounded-xl overflow-hidden border border-gray-200">
          <JobCoverPhotoUpload job={job} onUpdated={onJobUpdated} variant="banner" />
        </div>
      )}

      {/* ─── Client & Job Info card ─────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-omega-orange" /> Client &amp; Job Info
          </h2>
          {!editBlocked && (
            <div className="flex items-center gap-2">
              {!editing ? (
                <>
                  {/* Move Phase — same picker that's on the header
                      (compact badge), surfaced here as an obvious pill
                      so Inácio / Brenda can jump a card to any phase
                      without dragging it across the kanban. Useful for
                      backfilling old projects straight to "Completed"
                      or "Estimate Rejected". */}
                  <PipelineStatusPicker
                    currentKey={job.pipeline_status || 'new_lead'}
                    user={user}
                    jobId={job.id}
                    onMoved={(updated) => onJobUpdated?.(updated)}
                    palette={{ bg: 'bg-omega-pale', text: 'text-omega-orange' }}
                    label="Move Phase"
                    variant="pill"
                  />
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
          )}
        </div>

        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            <Field icon={UserIcon}  label="Client"          value={job.client_name} />
            <Field icon={Phone}     label="Phone"           value={job.client_phone} />
            <Field icon={Mail}      label="Email"           value={job.client_email} />
            <Field icon={MapPin}    label="Address"         value={job.address} />
            <Field icon={Briefcase} label="Salesperson"     value={job.salesperson_name} />
            <Field icon={HardHat}   label="Project Manager" value={job.pm_name} />
            <Field icon={Globe}     label="Source"          value={job.lead_source} />
            <Field icon={Calendar}  label="Created"         value={job.created_at ? new Date(job.created_at).toLocaleDateString() : null} />
            <Field icon={Clock}     label="Last Contact"    value={job.last_touch ? new Date(job.last_touch).toLocaleDateString() : null} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EDITABLE_FIELDS.map((f) => {
              const colSpan = (f.type === 'textarea' || f.type === 'services') ? 'sm:col-span-2' : '';
              return (
                <div key={f.key} className={colSpan}>
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
                  ) : f.type === 'services' ? (
                    <ServicePicker
                      value={Array.isArray(form[f.key]) ? form[f.key] : []}
                      onChange={(next) => setForm({ ...form, [f.key]: next })}
                    />
                  ) : (
                    <input type={f.type || 'text'} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Estimate + Contract summary (2 cols) ───────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SummaryCard
          icon={FileText}
          label="Estimate"
          headline={estimate
            ? (estimate.total_amount != null ? `$${Number(estimate.total_amount).toLocaleString()}` : 'Created')
            : 'None'}
          status={estimate?.status}
          subtitle={estimate
            ? `Last updated on ${new Date(estimate.updated_at || estimate.created_at).toLocaleDateString()}`
            : 'Not created yet'}
          empty={!estimate}
        />
        <SummaryCard
          icon={Hammer}
          label="Contract"
          headline={contract ? (contract.signed_at ? 'Signed' : 'Sent') : 'None'}
          status={contract ? (contract.signed_at ? 'signed' : 'sent') : null}
          subtitle={contract
            ? (contract.signed_at
                ? `Signed on ${new Date(contract.signed_at).toLocaleDateString()}`
                : contract.sent_at
                  ? `Sent on ${new Date(contract.sent_at).toLocaleDateString()}`
                  : '—')
            : 'No contract has been created for this job.'}
          empty={!contract}
          emptyTag="Not Created Yet"
        />
      </div>

      {/* ─── Notes + Activity (2 cols) ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <JobNotesPanel jobId={job.id} user={user} canEdit={!editBlocked} />
        <JobActivityPanel jobId={job.id} />
      </div>

      {/* Note: the "View Estimate Flow" CTA used to live here. It's been
          consolidated into the Estimate tab so all estimate-related
          actions stay grouped. */}

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
          the Owner PIN inside their respective modals. Hidden entirely
          for read-only-basic (receptionist) since neither callback
          gets passed in that mode. */}
      {(onDelete || onReset) && (
        <div className="bg-white rounded-xl border-2 border-red-200 p-4 sm:p-6">
          <h3 className="text-base font-bold text-red-800 inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> Danger Zone
          </h3>
          <p className="text-xs text-omega-stone mt-1">
            These actions require the Owner PIN.
          </p>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {onReset && (
              <button
                onClick={onReset}
                disabled={!canReset}
                title={canReset ? 'Wipe estimate, contract draft, questionnaire and AI report — keep the client info.' : 'Cannot reset: job has a signed contract or is in progress.'}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-amber-300 text-amber-800 hover:bg-amber-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" /> Reset to New Lead
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-red-300 text-red-700 hover:bg-red-50 text-sm font-bold"
              >
                <Trash2 className="w-4 h-4" /> Delete Job
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pipeline status picker (header badge with dropdown) ───────────
// The kanban's drag-and-drop is the primary way to move a card across
// phases, but with 10 columns the rightmost ones (Completed / Estimate
// Rejected) often sit off-screen. This picker — clickable badge in the
// JobFullView header — gives a one-click alternative that always
// works regardless of viewport width, and is the only path for
// receptionists / readOnlyBasic roles (which we explicitly hide it
// from at the call site).
function PipelineStatusPicker({ currentKey, user, jobId, onMoved, palette, label, variant = 'badge' }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // PIN-gate state: when the user picks a terminal phase (Estimate
  // Rejected) we open a PIN modal instead of saving immediately.
  const [pendingKey, setPendingKey] = useState(null);

  async function performMove(nextKey) {
    if (nextKey === currentKey) { setOpen(false); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('jobs')
        .update({ pipeline_status: nextKey })
        .eq('id', jobId)
        .select().single();
      if (error) throw error;
      onMoved?.(data);
      logAudit({
        user, action: 'job.move', entityType: 'job', entityId: jobId,
        details: { from: currentKey, to: nextKey, source: 'status_picker' },
      });
      setOpen(false);
    } catch (err) {
      console.warn('Failed to move job phase', err);
    } finally {
      setSaving(false);
    }
  }

  function moveTo(nextKey) {
    if (nextKey === currentKey) { setOpen(false); return; }
    if (PICKER_PIN_GATED.has(nextKey)) {
      // Hold the move open for PIN confirmation. The picker dropdown
      // closes so the modal isn't visually competing with it.
      setPendingKey(nextKey);
      setOpen(false);
      return;
    }
    void performMove(nextKey);
  }

  async function confirmPin(pin) {
    const ok = await validateUserPin(user, pin);
    if (!ok) return false;
    await performMove(pendingKey);
    setPendingKey(null);
    return true;
  }

  // Two skins: 'badge' (compact, used on the header chip strip) and
  // 'pill' (larger, used inside the Client & Job Info card so the
  // "Move phase" affordance reads as a real button).
  const triggerCls = variant === 'pill'
    ? `inline-flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-bold transition-colors disabled:opacity-60`
    : `inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${palette.bg} ${palette.text} hover:opacity-90 transition-opacity disabled:opacity-60`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={triggerCls}
        title="Click to move this job to another phase"
      >
        {variant === 'pill' && <ArrowRight className="w-4 h-4" />}
        {saving ? 'Moving…' : label}
        <svg viewBox="0 0 12 12" className={variant === 'pill' ? 'w-3 h-3' : 'w-2.5 h-2.5'} fill="currentColor"><path d="M6 8L2 4h8z"/></svg>
      </button>

      {open && (
        <>
          {/* Click-outside catcher — covers the screen below the menu. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 w-56 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-[10px] font-bold text-omega-stone uppercase tracking-wider">Move to phase</p>
            </div>
            <ul className="max-h-72 overflow-y-auto py-1">
              {PIPELINE_ORDER.map((key) => {
                const isActive = key === currentKey;
                const c = PIPELINE_COLORS[key];
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => moveTo(key)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs ${
                        isActive ? 'bg-omega-pale font-bold' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: c?.hex || '#6B7280' }}
                      />
                      <span className="flex-1 text-omega-charcoal">{PIPELINE_STEP_LABEL[key] || key}</span>
                      {isActive && <span className="text-[9px] uppercase tracking-wider text-omega-stone">current</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      {pendingKey && (
        <PickerPinModal
          targetLabel={PIPELINE_STEP_LABEL[pendingKey] || pendingKey}
          onCancel={() => setPendingKey(null)}
          onSubmit={confirmPin}
        />
      )}
    </div>
  );
}

// Inline PIN modal used by the picker when moving to a terminal phase
// (Estimate Rejected). Same UX as the Kanban's PinConfirmModal but
// doesn't depend on it (different file). Returns true from onSubmit
// when the PIN was correct so the caller can proceed.
function PickerPinModal({ targetLabel, onCancel, onSubmit }) {
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function handle() {
    setErr('');
    setBusy(true);
    try {
      const ok = await onSubmit(pin);
      if (!ok) setErr('Wrong PIN. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !busy && onCancel()}>
      <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200">
          <p className="font-bold text-omega-charcoal text-lg">Confirm move to {targetLabel}</p>
          <p className="text-sm text-omega-stone mt-1">Type your own PIN to confirm. This is a terminal phase.</p>
        </div>
        <div className="p-5">
          <label className="text-xs font-semibold text-omega-stone uppercase">Your PIN</label>
          <div className="relative mt-1">
            <input
              autoFocus
              type={show ? 'text' : 'password'}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handle(); }}
              className="w-full px-3 py-2.5 pr-10 rounded-lg border-2 border-gray-200 focus:border-omega-orange focus:outline-none text-base font-mono tracking-[0.3em]"
              placeholder="••••"
            />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-stone">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {err && <p className="text-xs text-red-600 font-semibold mt-1.5">{err}</p>}
        </div>
        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={handle} disabled={busy || !pin} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Confirming…' : 'Confirm Move'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Small numbered circle used as the leading badge for each step on
// the Estimate tab redesign (Cost Projection = 1, Estimate Details =
// 2, Sections = 3, Disclaimers = 4). Matches the seller-facing
// mockup. Exported because EstimateBuilder uses it for steps 2-4.
export function StepBadge({ n }) {
  return (
    <span className="w-7 h-7 rounded-full bg-omega-orange text-white text-sm font-black inline-flex items-center justify-center flex-shrink-0 shadow-sm">
      {n}
    </span>
  );
}

function Field({ icon: Icon, label, value, colSpan = 1 }) {
  const span = colSpan === 3 ? 'sm:col-span-2 md:col-span-3' : colSpan === 2 ? 'sm:col-span-2' : '';
  return (
    <div className={span}>
      <p className="text-[11px] uppercase tracking-wider text-omega-stone font-semibold inline-flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </p>
      <p className={`text-base mt-1 break-words leading-snug ${value ? 'font-semibold text-omega-charcoal' : 'text-omega-fog italic'}`}>
        {value || '—'}
      </p>
    </div>
  );
}

// ─── SummaryCard — Estimate / Contract quick summary ────────────────
// Two of these sit side-by-side on the Details tab (Estimate +
// Contract). Headline shows the total / state, status pill shows the
// current status, subtitle line shows when it changed last. When
// `empty` is true, headline reads "None" and we render a small grey
// "Not Created Yet" pill alongside.
function SummaryCard({ icon: Icon, label, headline, status, subtitle, empty = false, emptyTag = 'Not Created Yet' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="inline-flex items-center gap-2 mb-2">
        {Icon && (
          <div className="w-7 h-7 rounded-lg bg-omega-pale text-omega-orange flex items-center justify-center">
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
        <p className="text-[10px] font-bold text-omega-stone uppercase tracking-wider">{label}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xl font-black text-omega-charcoal tabular-nums leading-none">{headline}</p>
        {empty ? (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 text-omega-stone">{emptyTag}</span>
        ) : status ? (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            /sign|approve|completed|paid/i.test(status)
              ? 'bg-emerald-100 text-emerald-700'
              : /reject|cancel/i.test(status)
                ? 'bg-red-100 text-red-700'
                : /sent|negotiat|pending/i.test(status)
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-omega-pale text-omega-orange'
          }`}>
            {status}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-omega-stone mt-1.5">{subtitle}</p>
    </div>
  );
}

// ─── JobNotesPanel — per-job notes the team writes on the Details tab.
// Powered by the job_notes table (migration 031). Anyone with edit
// permissions can add a note; everyone sees the timeline. Notes are
// timestamped and labeled with the author's name.
function JobNotesPanel({ jobId, user, canEdit }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [missingMigration, setMissingMigration] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('job_notes')
          .select('*')
          .eq('job_id', jobId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!cancelled) {
          if (error && /job_notes/.test(error.message || '')) {
            // Migration 031 hasn't been applied yet — show an empty
            // panel without crashing the tab.
            setMissingMigration(true);
            setNotes([]);
          } else if (!error) {
            setNotes(data || []);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  async function addNote() {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      // Schema check: production job_notes uses author_name /
      // author_role / body. The migration-031 doc said
      // user_name/user_role/content; that was a planning typo —
      // the live table predates that migration. Keep the field
      // names matching what's in Supabase.
      const { data, error } = await supabase.from('job_notes').insert([{
        job_id: jobId,
        author_name: user?.name || 'unknown',
        author_role: user?.role || null,
        body: draft.trim(),
      }]).select().single();
      if (error) throw error;
      setNotes((prev) => [data, ...prev]);
      setDraft('');
      setComposing(false);
    } catch (err) {
      // Most likely cause: missing migration 031. Switch the panel to
      // its "table doesn't exist yet" empty state instead of failing
      // silently.
      if (/job_notes/.test(err?.message || '')) setMissingMigration(true);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
          <FileText className="w-4 h-4 text-omega-orange" /> Notes
        </h3>
        {canEdit && !composing && !missingMigration && (
          <button
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-omega-orange text-xs font-bold text-omega-charcoal"
          >
            <Plus className="w-3.5 h-3.5" /> Add Note
          </button>
        )}
      </div>

      {composing && canEdit && (
        <div className="mb-3 rounded-xl border border-omega-orange/30 bg-omega-pale/40 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="What's on the call? Project notes, budget hints, client mood…"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white resize-none"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => { setComposing(false); setDraft(''); }} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold">
              Cancel
            </button>
            <button
              onClick={addNote}
              disabled={posting || !draft.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-xs font-bold"
            >
              {posting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <>Save Note</>}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-omega-stone py-6 text-center">Loading notes…</p>
      ) : missingMigration ? (
        <p className="text-xs text-omega-stone py-6 text-center italic">
          Notes feature waiting on migration 031.
        </p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-omega-stone py-6 text-center italic">
          No notes yet. {canEdit ? 'Add the first one to capture call details.' : ''}
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const initial = (n.author_name || '?').charAt(0).toUpperCase();
            return (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3 rounded-lg bg-omega-cloud">
                <span className="w-9 h-9 rounded-md bg-omega-orange text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                  {initial}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-omega-charcoal whitespace-pre-wrap break-words leading-relaxed">{n.body}</p>
                  <p className="text-xs text-omega-stone mt-1.5">
                    <strong className="text-omega-charcoal">{n.author_name}</strong>
                    {n.author_role && <span className="text-omega-fog"> · {n.author_role}</span>}
                    <span className="text-omega-fog"> · {new Date(n.created_at).toLocaleString()}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── JobActivityPanel — read-only timeline of audit_log entries for
// this job. Surfaces every action that touches this job (creates,
// edits, moves, sends, signs, etc.) so the team has a single chronology
// without having to dig through Slack history.
function JobActivityPanel({ jobId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('audit_log')
          .select('*')
          .eq('entity_id', jobId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!cancelled) setRows(data || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  function summarize(row) {
    const action = String(row.action || '').replace(/_/g, ' ');
    const who = row.user_name || 'Someone';
    return { who, action };
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <h3 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-omega-orange" /> Activity
      </h3>
      {loading ? (
        <p className="text-xs text-omega-stone py-6 text-center">Loading activity…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-omega-stone py-6 text-center italic">No activity recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const { who, action } = summarize(row);
            return (
              <li key={row.id} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-omega-pale text-omega-orange flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-omega-charcoal">
                    <span className="font-semibold capitalize">{action}</span>
                  </p>
                  <p className="text-xs text-omega-stone mt-1">
                    {new Date(row.created_at).toLocaleString()}
                    {who && <span> · by {who}</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Multi-toggle chip picker for services. Click to add, click again to
// remove. Persists as the canonical comma-separated string via the
// parent's saveEdits handler.
function ServicePicker({ value, onChange }) {
  const selected = new Set(value || []);
  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Preserve insertion order across the canonical SERVICES list
    // — keeps "deck, kitchen" stable instead of jumping around as
    // the user toggles chips.
    onChange(SERVICES.filter((s) => next.has(s.id)).map((s) => s.id));
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {SERVICES.map((s) => {
        const isOn = selected.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              isOn
                ? 'bg-omega-orange border-omega-orange text-white'
                : 'bg-white border-gray-200 text-omega-slate hover:border-omega-orange'
            }`}
          >
            {s.label}
          </button>
        );
      })}
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
