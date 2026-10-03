import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronDown, ChevronRight, MoreVertical, Clock3,
  MessageSquare, MessageCircle, Phone, ThumbsUp, ThumbsDown, AlertTriangle,
  Pencil, Trash2, Plus, Check, HardHat, Sparkles, Loader2, GripVertical, Send,
} from 'lucide-react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, pointerWithin, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import { templateForJob, progressFromPhaseData } from '../config/phaseBreakdown';
import { generatePhasesFromEstimate } from '../lib/phaseGenerator';
import { planRows, blankPlanRow, withPlanRows } from '../lib/phasePlan';
import { nyDateKey } from '../lib/stageAge';
import PhasePhotos from './PhasePhotos';
import ContactMessageModal from './ContactMessageModal';
import SubScheduleModal from './SubScheduleModal';
import { waDeepLink } from '../lib/twilio';
import { subConfirmTemplate, subReworkMessage, findSubByPhone } from '../lib/subMessages';
import { logAudit } from '../lib/audit';
import { subDisplayNames, subInlineLabel } from '../lib/subcontractor';

// Roles allowed to contact subs directly from the phase header.
// Sales/marketing/screen are read-only; admin has global access.
const CAN_CONTACT_SUBS = new Set(['manager', 'owner', 'operations', 'admin']);
// Same roles can mark item verification status (Pass/Fail/Fix).
const CAN_VERIFY = CAN_CONTACT_SUBS;
// Roles allowed to edit the phase breakdown structure (rename phases,
// add/remove items, add/remove phases, build it from the estimate).
// Everyone else sees the same list read-only and can still toggle
// done/undone. Ramon (marketing) and Rafaela (receptionist) joined 02/10.
const CAN_EDIT_PHASES = new Set(['sales', 'operations', 'owner', 'admin', 'marketing', 'receptionist']);
// Roles that plan each phase: which sub does it + start / end date. Ramon's
// list (02/10): Ramon (marketing), Attila (sales), Inácio (owner) and Rafaela
// (receptionist). The dates feed the office TV's Jobs Calendar
// (apps/marketing/screens/tv/JobsCalendarSlide.jsx). Everyone else sees the
// plan read-only.
const CAN_SCHEDULE = new Set(['marketing', 'sales', 'owner', 'receptionist', 'operations', 'admin']);

// 'YYYY-MM-DD' → 'Oct 5'. Noon keeps the date from sliding a day.
function shortDay(key) {
  if (!key) return '';
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Phase breakdown with checkboxes. Persists `phase_data` JSONB on `jobs`.
 * If the job has no phase_data yet (or service changed), seeds from template.
 */
export default function PhaseBreakdown({ job, onJobUpdated, user }) {
  // Services with a template seed themselves the first time the tab opens;
  // the rest start empty and get an "Add phase breakdown automatically"
  // button that builds the phases from the estimate.
  const template = useMemo(() => templateForJob(job.service), [job.service]);
  const [phaseData, setPhaseData] = useState(() => deriveInitial(job, template));
  const [openIds, setOpenIds] = useState(() => {
    // Auto-expand the phase that's currently being worked on: the LAST
    // phase that has at least one done item but isn't fully complete.
    // Falls back to the first incomplete phase, then to the very first.
    const phases = phaseData?.phases || [];
    let target = null;
    for (let i = phases.length - 1; i >= 0; i--) {
      const p = phases[i];
      const doneCount = (p.items || []).filter((it) => it.done).length;
      const total = (p.items || []).length;
      if (doneCount > 0 && doneCount < total) { target = p.id; break; }
    }
    if (!target) {
      const firstIncomplete = phases.find((p) => !(p.items || []).every((it) => it.done));
      target = firstIncomplete?.id || phases[0]?.id;
    }
    return new Set([target].filter(Boolean));
  });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveTimer = useRef(null);

  // ─── Sub assignments (for the "Contact Subs" button per phase) ───
  // job_subs rows are keyed by phase *name* (legacy AssignSubs behavior).
  // Grouped client-side: { [phaseName]: [{sub_name, sub_phone, id}, ...] }.
  const [subsByPhase, setSubsByPhase] = useState({});
  const canContact = CAN_CONTACT_SUBS.has(user?.role);
  const canEdit = CAN_EDIT_PHASES.has(user?.role);
  const canSchedule = CAN_SCHEDULE.has(user?.role);
  // Every sub on file — the per-phase "who does it" dropdown, and the phone
  // number behind the Contact button when the phase has a sub picked.
  const [subs, setSubs] = useState([]);
  const [pickerFor, setPickerFor] = useState(null); // {phase, assignments} or null
  const [contactFor, setContactFor] = useState(null); // {sub, phase, channel} or null
  const [scheduleOpen, setScheduleOpen] = useState(false); // "Send schedule to subs"

  // Edit mode toggle — only meaningful for roles in CAN_EDIT_PHASES.
  // When on: phase names become inputs, items get delete + edit affordances,
  // and "+ Add item" / "+ Add phase" buttons appear. Checkbox toggling stays
  // on so a user can mark progress mid-edit if they want.
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);

  // Edit mode: drag a phase by its grip to change the order.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!canContact || !job?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('job_subs')
          .select('id, phase, sub_name, sub_phone')
          .eq('job_id', job.id);
        if (cancelled) return;
        const map = {};
        (data || []).forEach((row) => {
          const k = row.phase;
          if (!k) return;
          (map[k] = map[k] || []).push(row);
        });
        setSubsByPhase(map);
      } catch { /* table may not exist yet */ }
    })();
    return () => { cancelled = true; };
  }, [job?.id, canContact]);

  useEffect(() => {
    if (!canSchedule && !canContact) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('subcontractors')
        .select('id, name, contact_name, trade, phone, preferred_language')
        .order('name');
      if (!cancelled && !error) setSubs(data || []);
    })();
    return () => { cancelled = true; };
  }, [canSchedule, canContact]);

  // Who to call about a phase: legacy job_subs rows (keyed by phase name)
  // plus every sub planned on the phase itself, when we have a phone.
  // Each one carries contact_name + preferred_language so the message to
  // the sub is written in its primary language (shared/lib/subMessages.js);
  // legacy rows find their sub on file by phone.
  function assignmentsFor(ph) {
    const list = (subsByPhase[ph.name] || subsByPhase[ph.id] || []).map((row) => {
      const onFile = findSubByPhone(subs, row.sub_phone);
      return { ...row, contact_name: onFile?.contact_name || null, preferred_language: onFile?.preferred_language || null };
    });
    const planned = planRows(ph)
      .map((r) => (r.sub_id ? subs.find((s) => s.id === r.sub_id) : null))
      .filter((s) => s?.phone);
    for (const sub of planned.reverse()) {
      if (!list.some((a) => a.sub_phone === sub.phone)) {
        list.unshift({
          id: sub.id, sub_name: subInlineLabel(sub), sub_phone: sub.phone,
          contact_name: sub.contact_name, preferred_language: sub.preferred_language,
        });
      }
    }
    return list;
  }

  // Persist seed if we generated a new one
  useEffect(() => {
    if (!template) return;
    const currentPhases = job.phase_data?.phases;
    const hasSameShape = Array.isArray(currentPhases) && currentPhases.length === template.length &&
      currentPhases.every((p, i) => p.id === template[i].id && (p.items?.length || 0) === template[i].items.length);
    if (!hasSameShape) {
      void persist(phaseData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.service]);

  function deriveInitial(j, tpl) {
    const stored = j?.phase_data;
    if (stored?.phases?.length) return stored;
    if (tpl) return { phases: tpl };
    return { phases: [] };
  }

  // Debounced save on changes
  function scheduleSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 350);
  }

  async function persist(next) {
    setSaving(true);
    const { data, error } = await supabase.from('jobs').update({ phase_data: next }).eq('id', job.id).select().single();
    setSaving(false);
    // A failed save used to vanish silently: the change showed on screen
    // and was gone on the next open. Now it says so.
    setSaveFailed(!!error);
    if (!error && data) onJobUpdated?.(data);
    return error;
  }

  // Set a verification status on an item (pass | fail | fix | null).
  // 'pass' also marks done=true; 'fail'/'fix' force done=false so the
  // phase doesn't look complete while rework is pending.
  async function setVerify(phaseIdx, itemIdx, nextStatus) {
    const phase = phaseData.phases[phaseIdx];
    const item  = phase?.items?.[itemIdx];
    if (!item) return;

    // Optimistic update in local state.
    const newPhaseData = {
      ...phaseData,
      phases: phaseData.phases.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const items = p.items.map((it, ii) => {
          if (ii !== itemIdx) return it;
          const next = { ...it, verify_status: nextStatus };
          if (nextStatus === 'pass') next.done = true;
          if (nextStatus === 'fail' || nextStatus === 'fix') next.done = false;
          next.verified_by = user?.name || null;
          next.verified_at = new Date().toISOString();
          return next;
        });
        const completed = items.every((it) => it.done);
        return { ...p, items, completed };
      }),
    };
    setPhaseData(newPhaseData);
    scheduleSave(newPhaseData);

    // Fail / Fix → create a punch_list row so the issue doesn't get lost.
    if (nextStatus === 'fail' || nextStatus === 'fix') {
      try {
        await supabase.from('punch_list').insert([{
          job_id: job.id,
          task: `[${nextStatus.toUpperCase()}] ${phase.name} — ${item.label}`,
          completed: false,
          created_at: new Date().toISOString(),
        }]);
      } catch { /* non-fatal */ }

      // WhatsApp the assigned sub (if any) with a pre-filled message.
      const assignments = assignmentsFor(phase);
      if (assignments.length > 0) {
        const sub = assignments[0];
        const body = subReworkMessage({ sub, job, phase, item, kind: nextStatus });
        const url = waDeepLink(sub.sub_phone, body);
        if (url) {
          // Open the user's WhatsApp with the message pre-filled. Using
          // window.open instead of a plain anchor so this can be triggered
          // from a non-anchor element without React warnings.
          try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
        }
      }

      logAudit({
        user, action: `phase.verify.${nextStatus}`, entityType: 'job',
        entityId: job.id, details: { phase: phase.name, item: item.label },
      });
    } else if (nextStatus === 'pass') {
      logAudit({ user, action: 'phase.verify.pass', entityType: 'job', entityId: job.id, details: { phase: phase.name, item: item.label } });
    }
  }

  function toggleItem(phaseIdx, itemIdx) {
    setPhaseData((prev) => {
      const phases = prev.phases.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const items = p.items.map((it, ii) => {
          if (ii !== itemIdx) return it;
          const nowDone = !it.done;
          return {
            ...it,
            done: nowDone,
            done_by: nowDone ? (user?.name || null) : null,
            done_at: nowDone ? new Date().toISOString() : null,
          };
        });
        const completed = items.every((it) => it.done);
        return { ...p, items, completed };
      });
      const next = { ...prev, phases };
      scheduleSave(next);
      return next;
    });
  }

  // ─── Structural edits (rename / add / remove) ────────────────────
  // All of these mutate `phaseData`, optimistically update local state,
  // and schedule a debounced save. IDs use Date.now() because phase_data
  // is JSONB and we just need uniqueness within the document.

  function renamePhase(phaseIdx, name) {
    setPhaseData((prev) => {
      const phases = prev.phases.map((p, pi) => pi === phaseIdx ? { ...p, name } : p);
      const next = { ...prev, phases };
      scheduleSave(next);
      return next;
    });
  }

  function addPhase() {
    const id = `phase_${Date.now()}`;
    setPhaseData((prev) => {
      const next = {
        ...prev,
        phases: [
          ...prev.phases,
          { id, name: 'New Phase', completed: false, items: [] },
        ],
      };
      scheduleSave(next);
      return next;
    });
    setOpenIds((prev) => new Set([...prev, id]));
    logAudit({
      user, action: 'phase.add', entityType: 'job', entityId: job.id,
      details: { phaseId: id },
    });
  }

  function removePhase(phaseIdx) {
    const phase = phaseData.phases[phaseIdx];
    if (!phase) return;
    if (!window.confirm(`Delete phase "${phase.name}" and all its items?`)) return;
    setPhaseData((prev) => {
      const next = { ...prev, phases: prev.phases.filter((_, i) => i !== phaseIdx) };
      scheduleSave(next);
      return next;
    });
    logAudit({
      user, action: 'phase.remove', entityType: 'job', entityId: job.id,
      details: { phaseId: phase.id, name: phase.name },
    });
  }

  function reorderPhases({ active, over }) {
    if (!over || active.id === over.id) return;
    const from = phaseData.phases.findIndex((p) => p.id === active.id);
    const to = phaseData.phases.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = phaseData.phases[from];
    setPhaseData((prev) => {
      const next = { ...prev, phases: arrayMove(prev.phases, from, to) };
      scheduleSave(next);
      return next;
    });
    logAudit({
      user, action: 'phase.reorder', entityType: 'job', entityId: job.id,
      details: { phase: moved?.name, from: from + 1, to: to + 1 },
    });
  }

  function renameItem(phaseIdx, itemIdx, label) {
    setPhaseData((prev) => {
      const phases = prev.phases.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const items = p.items.map((it, ii) => ii === itemIdx ? { ...it, label } : it);
        return { ...p, items };
      });
      const next = { ...prev, phases };
      scheduleSave(next);
      return next;
    });
  }

  function addItem(phaseIdx) {
    setPhaseData((prev) => {
      const phases = prev.phases.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const id = `${p.id}_item_${Date.now()}`;
        return {
          ...p,
          items: [...p.items, { id, label: 'New item', done: false }],
          completed: false,
        };
      });
      const next = { ...prev, phases };
      scheduleSave(next);
      return next;
    });
  }

  function removeItem(phaseIdx, itemIdx) {
    setPhaseData((prev) => {
      const phases = prev.phases.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const items = p.items.filter((_, j) => j !== itemIdx);
        const completed = items.length > 0 && items.every((it) => it.done);
        return { ...p, items, completed };
      });
      const next = { ...prev, phases };
      scheduleSave(next);
      return next;
    });
  }

  // ─── Phase plan: who does it + when (shared/lib/phasePlan.js) ────
  // One row per sub, each with its own dates; a phase with nothing planned
  // shows one blank row. sub_name is kept so the TV can label the bar
  // without a lookup. An end before the start is pulled up to it.
  const shownRows = (phase) => {
    const rows = planRows(phase);
    return rows.length ? rows : [blankPlanRow(phase, `${phase.id}_r0`)];
  };

  function savePlan(phaseIdx, rows, details) {
    const phase = phaseData.phases[phaseIdx];
    if (!phase) return;
    const updated = withPlanRows(phase, rows);
    setPhaseData((prev) => {
      const next = { ...prev, phases: prev.phases.map((p, pi) => (pi === phaseIdx ? updated : p)) };
      scheduleSave(next);
      return next;
    });
    logAudit({
      user, action: 'phase.schedule', entityType: 'job', entityId: job.id,
      details: { phase: phase.name, ...details },
    });
  }

  function setPlanRow(phaseIdx, rowIdx, patch) {
    const phase = phaseData.phases[phaseIdx];
    if (!phase) return;
    const rows = shownRows(phase).map((r, i) => {
      if (i !== rowIdx) return r;
      const merged = { ...r, ...patch };
      for (const k of ['start_date', 'end_date']) if (merged[k] === '') merged[k] = null;
      if (merged.start_date && merged.end_date && merged.end_date < merged.start_date) {
        merged.end_date = merged.start_date;
      }
      return merged;
    });
    const row = rows[rowIdx];
    savePlan(phaseIdx, rows, { sub: row.sub_name || null, start_date: row.start_date || null, end_date: row.end_date || null });
  }

  function pickSub(phaseIdx, rowIdx, subId) {
    const sub = subs.find((s) => s.id === subId);
    setPlanRow(phaseIdx, rowIdx, {
      sub_id: sub?.id || null,
      sub_name: sub ? subDisplayNames(sub).primary : null,
    });
  }

  function addPlanRow(phaseIdx) {
    const phase = phaseData.phases[phaseIdx];
    if (!phase) return;
    savePlan(phaseIdx, [...shownRows(phase), blankPlanRow(phase)], { added: 'sub row' });
  }

  function removePlanRow(phaseIdx, rowIdx) {
    const phase = phaseData.phases[phaseIdx];
    if (!phase) return;
    const removed = shownRows(phase)[rowIdx];
    savePlan(phaseIdx, shownRows(phase).filter((_, i) => i !== rowIdx), { removed: removed?.sub_name || 'sub row' });
  }

  // Empty breakdown → build it from the estimate (AI). Only offered while
  // the job has no phases, so it never overwrites anything.
  async function generateFromEstimate() {
    if (generating || phaseData.phases.length) return;
    setGenerating(true);
    setGenError(null);
    try {
      const phases = await generatePhasesFromEstimate(job);
      const next = { ...phaseData, phases };
      const saveError = await persist(next);
      if (saveError) throw saveError;
      setPhaseData(next);
      setOpenIds(new Set([phases[0].id]));
      logAudit({
        user, action: 'phase.generate', entityType: 'job', entityId: job.id,
        details: { phases: phases.length, items: phases.reduce((n, ph) => n + ph.items.length, 0) },
      });
    } catch (err) {
      setGenError(err?.message || 'Could not build the phases. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  function toggleOpen(id) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const { totalDone, totalItems, progress, currentPhaseName } = progressFromPhaseData(phaseData);

  // Empty breakdown (the service has no template and nobody built one yet).
  // Editors get the "build it from the estimate" button, or can start by
  // hand; everyone else just sees that there's nothing yet.
  const isEmpty = !phaseData.phases.length;
  if (isEmpty && !canEdit) {
    return (
      <div className="text-sm text-omega-stone p-4 bg-omega-cloud rounded-lg">
        No phases yet for this job.
      </div>
    );
  }
  if (isEmpty && !editing) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-omega-cloud/60 px-5 py-8 text-center">
        <Sparkles className="w-7 h-7 text-omega-orange mx-auto" />
        <p className="mt-2 font-bold text-omega-charcoal">No phases yet</p>
        <p className="mt-1 text-sm text-omega-stone max-w-md mx-auto">
          Build this job's phases and checklists from its estimate. You can add, rename or delete anything afterwards.
        </p>
        <button
          onClick={generateFromEstimate}
          disabled={generating}
          className="mt-4 inline-flex items-center gap-2 px-5 h-11 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold transition"
        >
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading the estimate…</>
            : <><Sparkles className="w-4 h-4" /> Add phase breakdown automatically</>}
        </button>
        {genError && <p className="mt-3 text-sm text-red-600 max-w-md mx-auto">{genError}</p>}
        <button
          onClick={() => setEditing(true)}
          disabled={generating}
          className="block mx-auto mt-3 text-xs font-semibold text-omega-stone hover:text-omega-orange hover:underline underline-offset-2 disabled:opacity-50"
        >
          or add phases by hand
        </button>
      </div>
    );
  }

  // Which phase is "now": the first one with an unchecked item (same rule as
  // progressFromPhaseData's currentPhaseName).
  const currentIdx = phaseData.phases.findIndex((p) => (p.items || []).some((it) => !it.done));
  const hasPlannedSubs = phaseData.phases.some((p) => planRows(p).some((r) => r.sub_id || r.sub_name));
  const todayKey = nyDateKey(Date.now());

  return (
    <div className="font-optical space-y-3">
      {/* Title + overall progress + Edit toggle */}
      <div className="flex flex-wrap items-stretch justify-between gap-x-6 gap-y-3 pb-1">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <HardHat className="w-9 h-9 sm:w-11 sm:h-11 text-[#F26B1D] flex-shrink-0" strokeWidth={2.2} />
          <div className="min-w-0">
            <h2 className="text-[24px] sm:text-[30px] font-extrabold text-[#141413] tracking-[-0.025em] leading-tight">
              Phase Breakdown
            </h2>
            <p className="text-[14px] sm:text-[15px] text-[#5F5F5B] truncate">
              {totalDone}/{totalItems} items
              {currentPhaseName && <><span className="mx-1.5 text-[#A3A39E]">·</span>{currentPhaseName}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-1 sm:flex-none justify-end">
          <div className="flex-1 sm:flex-none sm:w-[260px] sm:pl-6 sm:border-l border-[#ECECE9]">
            <p className="text-[14px] font-medium text-[#3A3A37]">Overall Progress</p>
            <div className="flex items-center gap-3">
              <span className="flex-1 h-2.5 rounded-full bg-[#ECECE9] overflow-hidden">
                <span className="block h-full rounded-full bg-[#F26B1D] transition-all" style={{ width: `${progress}%` }} />
              </span>
              <span className="text-[24px] sm:text-[28px] font-extrabold text-[#141413] tracking-[-0.02em] tabular-nums">{progress}%</span>
            </div>
          </div>
          {(canSchedule || canContact) && hasPlannedSubs && (
            <button
              onClick={() => setScheduleOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-[#DADAD6] text-[13px] font-semibold text-[#3A3A37] hover:border-omega-orange hover:text-omega-orange transition flex-shrink-0"
              title="Text each sub its phases and dates"
            >
              <Send className="w-4 h-4" /> <span className="hidden sm:inline">Send schedule</span>
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setEditing((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[13px] font-semibold transition flex-shrink-0 ${
                editing
                  ? 'bg-[#141413] text-white border-[#141413]'
                  : 'border-[#DADAD6] text-[#3A3A37] hover:border-omega-orange hover:text-omega-orange'
              }`}
              title={editing ? 'Finish editing' : 'Edit phases & items'}
            >
              {editing ? <><Check className="w-4 h-4" /> Done</> : <><Pencil className="w-4 h-4" /> Edit</>}
            </button>
          )}
        </div>
      </div>
      {saving && <p className="text-[12px] text-[#8A8A85]">Saving…</p>}
      {saveFailed && !saving && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[14px] text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 min-w-0">Couldn't save your last change. Check the connection and try again.</span>
          <button
            onClick={() => persist(phaseData)}
            className="h-8 px-3 rounded-lg bg-white border border-red-200 font-semibold hover:bg-red-100 transition"
          >
            Retry
          </button>
        </div>
      )}
      {editing && phaseData.phases.length === 0 && (
        <div className="text-sm text-[#5F5F5B] bg-[#FAFAF9] border border-[#E7E7E4] rounded-xl p-4">
          No phases yet. Use <strong>Add phase</strong> below to start.
        </div>
      )}

      {/* Phases */}
      <DndContext sensors={sensors} collisionDetection={phaseCollision} onDragEnd={reorderPhases}>
      <SortableContext items={phaseData.phases.map((p) => p.id)} strategy={verticalListSortingStrategy}>
      <div className="space-y-3">
        {phaseData.phases.map((ph, phaseIdx) => {
          const open = openIds.has(ph.id);
          const items = ph.items || [];
          const doneCount = items.filter((it) => it.done).length;
          const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
          const status = phaseStatus(ph, phaseIdx, currentIdx);
          const look = PHASE_LOOK[status];
          const isCurrent = status === 'current';
          const assignments = assignmentsFor(ph);
          return (
            <SortablePhase key={ph.id} id={ph.id} name={ph.name} editing={editing} className={look.card}>
              {(grip) => (<>
              <div className={`flex items-center gap-2.5 sm:gap-4 pl-3 sm:pl-5 pr-2 sm:pr-3 ${isCurrent ? 'py-4 sm:py-5' : 'py-3.5'}`}>
                {grip}
                <button
                  onClick={() => toggleOpen(ph.id)}
                  className="no-touch-min flex items-center gap-2 sm:gap-3 text-left flex-shrink-0"
                  aria-label={open ? 'Collapse phase' : 'Expand phase'}
                >
                  {open
                    ? <ChevronDown className="w-5 h-5 text-[#3A3A37]" strokeWidth={2.4} />
                    : <ChevronRight className="w-5 h-5 text-[#3A3A37]" strokeWidth={2.4} />}
                  <StatusIcon status={status} />
                </button>
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <input
                      value={ph.name}
                      onChange={(e) => renamePhase(phaseIdx, e.target.value)}
                      placeholder="Phase name"
                      className="w-full px-3 h-10 rounded-lg border border-[#E2E2DE] bg-white text-[16px] font-semibold text-[#141413] focus:border-omega-orange focus:outline-none"
                    />
                  ) : (
                    <button onClick={() => toggleOpen(ph.id)} className="no-touch-min w-full text-left min-w-0">
                      <span className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <span className={`${isCurrent ? 'text-[18px] sm:text-[21px] font-bold' : 'text-[16px] sm:text-[17px] font-semibold'} text-[#141413] tracking-[-0.01em] truncate`}>
                          {ph.name}
                        </span>
                        {isCurrent && (
                          <span className="hidden sm:inline-flex items-center h-7 px-3 rounded-full bg-[#F26B1D] text-white text-[12px] font-bold uppercase tracking-[0.04em] flex-shrink-0">
                            Current phase
                          </span>
                        )}
                      </span>
                      <span className="block mt-0.5 text-[14px] sm:text-[15px] text-[#5F5F5B] truncate">
                        {planSummary(ph, subs)}
                      </span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2.5 sm:gap-4 flex-shrink-0">
                  <span className="hidden lg:block w-[150px] h-2.5 rounded-full overflow-hidden" style={{ background: look.track }}>
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: look.bar }} />
                  </span>
                  <span className={`${isCurrent ? 'text-[16px] sm:text-[18px]' : 'text-[15px] sm:text-[17px]'} font-semibold text-[#1C1C1A] tabular-nums`}>
                    {doneCount}/{items.length}
                  </span>
                  {isCurrent ? (
                    <span className="text-[20px] sm:text-[24px] font-extrabold text-[#D35A12] tabular-nums">{pct}%</span>
                  ) : (
                    <span className={`hidden sm:inline-flex items-center justify-center h-8 px-3.5 rounded-full text-[14px] font-semibold ${look.pill}`}>
                      {look.label}
                    </span>
                  )}
                  {editing ? (
                    <button
                      onClick={() => removePhase(phaseIdx)}
                      className="no-touch-min p-2 rounded-lg text-[#5F5F5B] hover:bg-red-50 hover:text-red-600 transition"
                      title="Delete this phase"
                    >
                      <Trash2 className="w-[18px] h-[18px]" />
                    </button>
                  ) : (
                    <PhaseMenu
                      phaseName={ph.name}
                      onContact={canContact && assignments.length ? () => setPickerFor({ phase: ph, assignments }) : null}
                      contactCount={assignments.length}
                      onEdit={canEdit ? () => { setEditing(true); setOpenIds((prev) => new Set([...prev, ph.id])); } : null}
                      onDelete={canEdit ? () => removePhase(phaseIdx) : null}
                    />
                  )}
                </div>
              </div>

              {open && (
                <div className="px-3 sm:px-4 pb-4 space-y-3">
                  <PlanTable
                    phase={ph}
                    rows={canSchedule ? shownRows(ph) : planRows(ph)}
                    subs={subs}
                    canSchedule={canSchedule}
                    todayKey={todayKey}
                    onPickSub={(rowIdx, id) => pickSub(phaseIdx, rowIdx, id)}
                    onDates={(rowIdx, patch) => setPlanRow(phaseIdx, rowIdx, patch)}
                    onAddRow={() => addPlanRow(phaseIdx)}
                    onRemoveRow={(rowIdx) => removePlanRow(phaseIdx, rowIdx)}
                  />

                  <div className="rounded-xl border border-[#E7E7E4] bg-white px-4 sm:px-5 py-2">
                    <p className="pt-2 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8A8A85]">
                      Checklist · {doneCount}/{items.length}
                    </p>
                    {!items.length && !editing && (
                      <p className="py-2 text-[14px] text-[#8A8A85]">No checklist items yet.</p>
                    )}
                    {items.map((it, itemIdx) => (
                      <div key={it.id} className="flex items-center gap-3 py-2.5 border-t border-[#F1F1EE] first-of-type:border-t-0 group">
                        <button
                          onClick={() => toggleItem(phaseIdx, itemIdx)}
                          className="no-touch-min flex-shrink-0"
                          aria-label={it.done ? 'Mark undone' : 'Mark done'}
                        >
                          {it.done ? (
                            <span className="w-[22px] h-[22px] rounded-full bg-[#16A34A] flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 text-white" strokeWidth={3.2} />
                            </span>
                          ) : (
                            <span className="block w-[22px] h-[22px] rounded-full border-2 border-[#C9C9C4] bg-white group-hover:border-omega-orange transition-colors" />
                          )}
                        </button>
                        {editing ? (
                          <input
                            value={it.label}
                            onChange={(e) => renameItem(phaseIdx, itemIdx, e.target.value)}
                            placeholder="Item label"
                            className="flex-1 min-w-0 px-3 h-9 rounded-lg border border-[#E2E2DE] text-[15px] text-[#2A2A27] focus:border-omega-orange focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => toggleItem(phaseIdx, itemIdx)}
                            className="no-touch-min flex-1 text-left min-w-0"
                          >
                            <span className={`text-[15px] ${it.done ? 'line-through text-[#9A9A95]' : 'text-[#2A2A27]'}`}>
                              {it.label}
                            </span>
                            {it.verify_status && <VerifyBadge status={it.verify_status} />}
                            {it.done && it.done_by && (
                              <span className="block text-[11px] text-[#9A9A95] leading-tight mt-0.5">
                                {it.done_by}{it.done_at ? ` · ${new Date(it.done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${new Date(it.done_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}
                              </span>
                            )}
                          </button>
                        )}
                        {!editing && canContact && (
                          <VerifyControls
                            current={it.verify_status}
                            onSet={(s) => setVerify(phaseIdx, itemIdx, s)}
                          />
                        )}
                        {!editing && <PhasePhotos jobId={job.id} phaseId={ph.id} itemId={it.id} user={user} />}
                        {editing && (
                          <button
                            onClick={() => removeItem(phaseIdx, itemIdx)}
                            className="no-touch-min p-1.5 rounded-lg text-[#5F5F5B] hover:bg-red-50 hover:text-red-600 transition flex-shrink-0"
                            title="Delete this item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {editing && (
                      <button
                        onClick={() => addItem(phaseIdx)}
                        className="w-full flex items-center gap-2 px-1 py-2.5 border-t border-[#F1F1EE] text-[14px] font-semibold text-omega-orange hover:text-omega-dark transition"
                      >
                        <Plus className="w-4 h-4" /> Add item
                      </button>
                    )}
                  </div>
                </div>
              )}
              </>)}
            </SortablePhase>
          );
        })}
        {/* Always there for editors — outside edit mode it switches edit on
            too, so nobody has to find the Edit pill first to add a phase. */}
        {canEdit && (
          <button
            onClick={() => { setEditing(true); addPhase(); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm font-semibold text-omega-stone hover:border-omega-orange hover:text-omega-orange transition"
          >
            <Plus className="w-4 h-4" /> Add phase
          </button>
        )}
      </div>
      </SortableContext>
      </DndContext>

      {scheduleOpen && (
        <SubScheduleModal
          job={job}
          phases={phaseData.phases}
          subs={subs}
          user={user}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {/* Picker: which sub + SMS/WhatsApp ─────────────────────── */}
      {pickerFor && (
        <SubPicker
          phase={pickerFor.phase}
          assignments={pickerFor.assignments}
          onClose={() => setPickerFor(null)}
          onPick={(sub, channel) => {
            setContactFor({ sub, phase: pickerFor.phase, channel });
            setPickerFor(null);
          }}
        />
      )}

      {/* Compose + send ────────────────────────────────────────── */}
      {contactFor && (
        <ContactMessageModal
          open
          onClose={() => setContactFor(null)}
          toName={contactFor.sub.sub_name}
          toPhone={contactFor.sub.sub_phone}
          channel={contactFor.channel}
          setChannel={(ch) => setContactFor((prev) => prev ? { ...prev, channel: ch } : prev)}
          initialBody={subConfirmTemplate({
            sub:   contactFor.sub,
            phase: { name: contactFor.phase.name },
            job,
          })}
          user={user}
          meta={{ jobId: job.id, phaseId: contactFor.phase.id, subId: contactFor.sub.id, kind: 'sub.confirm' }}
          auditAction={`sub.contact.${contactFor.channel}`}
        />
      )}
    </div>
  );
}

// Drop target = the phase under the pointer. An open phase can be very tall,
// so its center (closestCenter's yardstick) stays far from where the user is
// pointing. Keyboard drags have no pointer — those fall back to the center.
function phaseCollision(args) {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
}

// ─── One phase card; in edit mode its grip drags it to a new spot ─
// Only the grip starts a drag, so typing in the inputs never moves the card.
function SortablePhase({ id, name, editing, className = '', children }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id, disabled: !editing });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 30 : undefined,
  };
  const grip = editing ? (
    <button
      ref={setActivatorNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      className="p-1.5 -ml-1.5 rounded text-omega-fog hover:text-omega-stone hover:bg-omega-cloud cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
      title="Drag to reorder phase"
      aria-label={`Drag to reorder ${name}`}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  ) : null;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl ${className} ${isDragging ? 'ring-2 ring-omega-orange shadow-card-hover' : ''}`}
    >
      {children(grip)}
    </div>
  );
}

// ─── Look of each phase by status (Ramon's design, 02/10) ─────────
//   done     = every checklist item checked            → green
//   current  = first phase with an unchecked item      → orange
//   upcoming = not started yet, but subs/dates planned → blue
//   idle     = nothing planned yet                     → grey
// The office TV's Jobs Calendar uses the same colors.
const PHASE_LOOK = {
  done: {
    card: 'bg-[#F1FAF4] border border-[#CFEBD8]',
    bar: '#16A34A', track: '#D7EEDF', pill: 'bg-[#DDF3E4] text-[#15803D]', label: 'Completed',
  },
  current: {
    card: 'bg-gradient-to-b from-[#FFF5EC] to-white border-2 border-[#F7A766] border-l-[6px] border-l-[#F26B1D] shadow-[0_6px_20px_-8px_rgba(232,115,42,0.35)]',
    bar: '#F26B1D', track: '#F3E3D4', pill: '', label: 'Current phase',
  },
  upcoming: {
    card: 'bg-[#F6FAFF] border border-[#C5DBF5] border-l-[5px] border-l-[#4A8FE2]',
    bar: '#3B82F6', track: '#E3ECF7', pill: 'bg-[#DCEBFC] text-[#2563EB]', label: 'Upcoming',
  },
  idle: {
    card: 'bg-[#FAFAF9] border border-[#E7E7E4]',
    bar: '#9CA3AF', track: '#E9E9E6', pill: 'bg-[#EDEDEA] text-[#5F5F5B]', label: 'Not started',
  },
};

function phaseStatus(ph, idx, currentIdx) {
  const items = ph.items || [];
  if (items.length && items.every((it) => it.done)) return 'done';
  if (idx === currentIdx) return 'current';
  if (planRows(ph).some((r) => r.sub_id || r.sub_name || r.start_date)) return 'upcoming';
  return 'idle';
}

function StatusIcon({ status }) {
  if (status === 'done') {
    return (
      <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#16A34A] flex items-center justify-center">
        <Check className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-white" strokeWidth={3.2} />
      </span>
    );
  }
  if (status === 'current') {
    return <span className="block w-7 h-7 sm:w-8 sm:h-8 rounded-full border-[6px] border-[#F26B1D] bg-white" />;
  }
  return <span className="block w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-[#B9B9B4] bg-white" />;
}

// Collapsed-row subtitle: who does it and when.
function planSummary(ph, subs) {
  const rows = planRows(ph).filter((r) => r.sub_id || r.sub_name || r.start_date);
  if (!rows.length) return 'No sub assigned';
  const starts = rows.map((r) => r.start_date).filter(Boolean).sort();
  const ends = rows.map((r) => r.end_date).filter(Boolean).sort();
  const when = starts.length ? ` · ${shortDay(starts[0])} → ${ends.length ? shortDay(ends[ends.length - 1]) : '—'}` : '';
  if (rows.length === 1) {
    const sub = subs.find((s) => s.id === rows[0].sub_id);
    const who = sub ? `${subInlineLabel(sub)}${sub.trade ? ` · ${sub.trade}` : ''}` : (rows[0].sub_name || 'No sub assigned');
    return `${who}${when}`;
  }
  const names = rows.map((r) => {
    const sub = subs.find((s) => s.id === r.sub_id);
    return sub ? subDisplayNames(sub).primary : r.sub_name;
  }).filter(Boolean);
  return `${rows.length} subs${names.length ? ` · ${names.join(', ')}` : ''}${when}`;
}

// A sub's status comes from its dates — nobody has to update it by hand.
function SubStatus({ row, todayKey }) {
  if (!row.start_date || !row.end_date) return <span className="text-[14px] text-[#A3A39E]">—</span>;
  if (row.end_date < todayKey) {
    return (
      <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#DDF3E4] text-[#15803D] text-[14px] font-semibold whitespace-nowrap">
        <Check className="w-4 h-4" strokeWidth={2.6} /> Done
      </span>
    );
  }
  if (row.start_date <= todayKey) {
    return (
      <span className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-[#FFE9D8] text-[#C2410C] text-[14px] font-semibold whitespace-nowrap">
        <span className="w-2 h-2 rounded-full bg-[#F26B1D]" /> On site
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#DCEBFC] text-[#2563EB] text-[14px] font-semibold whitespace-nowrap">
      <Clock3 className="w-4 h-4" strokeWidth={2.4} /> Scheduled
    </span>
  );
}

// ⋮ per phase: contact its subs, jump into edit mode, delete it.
function PhaseMenu({ phaseName, onContact, contactCount, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!onContact && !onEdit && !onDelete) return <span className="w-9" />;
  const item = 'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[14px] font-medium hover:bg-[#F5F5F2]';
  const run = (fn) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="no-touch-min w-9 h-9 rounded-lg flex items-center justify-center text-[#3A3A37] hover:bg-black/[0.05]"
        aria-label={`More actions for ${phaseName}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-52 py-1.5 rounded-xl bg-white border border-[#E7E7E4] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)]">
          {onContact && (
            <button role="menuitem" onClick={run(onContact)} className={`${item} text-[#2A2A27]`}>
              <Phone className="w-4 h-4 text-omega-orange" /> Contact subs ({contactCount})
            </button>
          )}
          {onEdit && (
            <button role="menuitem" onClick={run(onEdit)} className={`${item} text-[#2A2A27]`}>
              <Pencil className="w-4 h-4 text-[#5F5F5B]" /> Edit phases & items
            </button>
          )}
          {onDelete && (
            <button role="menuitem" onClick={run(onDelete)} className={`${item} text-red-600`}>
              <Trash2 className="w-4 h-4" /> Delete phase
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Who does the phase, and when: one row per sub ───────────────
// Table on wide screens (Subcontractor · Start · End · Status); on tablets
// in portrait / phones each sub stacks (sub on top, dates + status below).
const PLAN_COLS = 'lg:grid-cols-[minmax(0,1.7fr)_minmax(150px,1fr)_minmax(150px,1fr)_128px_48px]';
const PLAN_INPUT = 'h-11 w-full px-3 rounded-lg border border-[#E2E2DE] bg-white text-base lg:text-[15px] text-[#1C1C1A] focus:border-omega-orange focus:outline-none';

function PlanTable({ phase, rows, subs, canSchedule, todayKey, onPickSub, onDates, onAddRow, onRemoveRow }) {
  const shown = canSchedule ? rows : rows.filter((r) => r.sub_id || r.sub_name || r.start_date || r.end_date);
  if (!canSchedule && !shown.length) return null;
  const many = shown.length > 1;
  return (
    <div className="rounded-xl border border-[#E7E7E4] bg-white overflow-hidden">
      <div className={`hidden lg:grid ${PLAN_COLS} bg-[#F7F7F5] text-[14px] font-semibold text-[#5F5F5B]`}>
        <div className="px-5 py-3">Subcontractor</div>
        <div className="px-3 py-3">Start Date</div>
        <div className="px-3 py-3">End Date</div>
        <div className="px-3 py-3">Status</div>
        <div />
      </div>
      {shown.map((r, i) => {
        const tag = many ? ` (${i + 1})` : '';
        const sub = subs.find((s) => s.id === r.sub_id);
        // A sub that was removed from the list stays selectable under its
        // saved name, so the dropdown never blanks out on its own.
        const known = !r.sub_id || !!sub;
        return (
          <div key={r.id} className={`grid grid-cols-1 ${PLAN_COLS} gap-2 lg:gap-0 items-center px-3 py-3 lg:p-0 border-t border-[#EEEEEB] [&:nth-child(2)]:border-t-0 lg:[&:nth-child(2)]:border-t`}>
            <div className="flex items-center gap-3 lg:px-5 lg:py-3 min-w-0">
              <HardHat className="w-5 h-5 text-[#3A3A37] flex-shrink-0" />
              {canSchedule ? (
                <>
                  <span className="sr-only">Subcontractor for {phase.name}{tag}</span>
                  <select
                    value={r.sub_id || ''}
                    onChange={(e) => onPickSub(i, e.target.value || null)}
                    className={`${PLAN_INPUT} font-semibold`}
                  >
                    <option value="">No sub assigned</option>
                    {!known && <option value={r.sub_id}>{r.sub_name || 'Removed sub'}</option>}
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>{subInlineLabel(s)}{s.trade ? ` · ${s.trade}` : ''}</option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="text-[16px] font-semibold text-[#1C1C1A] truncate">
                  {sub ? subDisplayNames(sub).primary : (r.sub_name || 'No sub assigned')}
                  {sub && subDisplayNames(sub).secondary && (
                    <span className="font-normal text-[#5F5F5B]"> ({subDisplayNames(sub).secondary})</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:contents">
              <div className={`${canSchedule ? 'flex-1 min-w-[140px]' : ''} lg:px-3 lg:py-3`}>
                {canSchedule ? (
                  <input
                    type="date"
                    aria-label={`${phase.name} start date${tag}`}
                    value={r.start_date || ''}
                    onChange={(e) => onDates(i, { start_date: e.target.value })}
                    className={PLAN_INPUT}
                  />
                ) : (
                  <span className="text-[15px] text-[#1C1C1A]">{r.start_date ? shortDay(r.start_date) : '—'}</span>
                )}
              </div>
              <span className="lg:hidden text-[#8A8A85]">→</span>
              <div className={`${canSchedule ? 'flex-1 min-w-[140px]' : ''} lg:px-3 lg:py-3`}>
                {canSchedule ? (
                  <input
                    type="date"
                    aria-label={`${phase.name} end date${tag}`}
                    value={r.end_date || ''}
                    min={r.start_date || undefined}
                    onChange={(e) => onDates(i, { end_date: e.target.value })}
                    className={PLAN_INPUT}
                  />
                ) : (
                  <span className="text-[15px] text-[#1C1C1A]">{r.end_date ? shortDay(r.end_date) : '—'}</span>
                )}
              </div>
              <div className="lg:px-3 lg:py-3">
                <SubStatus row={r} todayKey={todayKey} />
              </div>
              <div className="lg:py-3 flex lg:justify-center">
                {canSchedule && many ? (
                  <button
                    type="button"
                    onClick={() => onRemoveRow(i)}
                    className="no-touch-min w-10 h-10 rounded-lg border border-[#E2E2DE] bg-white flex items-center justify-center text-[#5F5F5B] hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
                    title="Remove this sub from the phase"
                    aria-label={`Remove sub${tag} from ${phase.name}`}
                  >
                    <Trash2 className="w-[18px] h-[18px]" />
                  </button>
                ) : <span className="hidden lg:block w-10" />}
              </div>
            </div>
          </div>
        );
      })}
      {canSchedule && (
        <div className="border-t border-[#EEEEEB] p-3">
          <button
            type="button"
            onClick={onAddRow}
            className="w-full flex items-center gap-2 px-3 h-11 rounded-lg border border-dashed border-[#DADAD6] text-[15px] text-[#5F5F5B] hover:border-omega-orange hover:text-omega-orange transition"
          >
            <Plus className="w-[18px] h-[18px]" /> Add another sub
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sub picker (which sub? sms or whatsapp?) ───────────────────
function VerifyBadge({ status }) {
  const map = {
    pass: { label: 'Pass', cls: 'bg-green-100 text-green-700 border-green-200' },
    fail: { label: 'Fail', cls: 'bg-red-100 text-red-700 border-red-200' },
    fix:  { label: 'Fix',  cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

function VerifyControls({ current, onSet }) {
  // Three tiny icon buttons shown on hover/focus. Click toggles — so
  // clicking 'pass' when already 'pass' clears the status.
  function click(e, status) {
    e.stopPropagation();
    onSet?.(current === status ? null : status);
  }
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => click(e, 'pass')}
        className={`p-1 rounded transition-colors ${current === 'pass' ? 'bg-green-100 text-green-700' : 'text-omega-stone hover:bg-green-50 hover:text-green-700'}`}
        title="Mark as passed"
      >
        <ThumbsUp className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={(e) => click(e, 'fix')}
        className={`p-1 rounded transition-colors ${current === 'fix' ? 'bg-amber-100 text-amber-700' : 'text-omega-stone hover:bg-amber-50 hover:text-amber-700'}`}
        title="Needs a fix — opens WhatsApp to sub"
      >
        <AlertTriangle className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={(e) => click(e, 'fail')}
        className={`p-1 rounded transition-colors ${current === 'fail' ? 'bg-red-100 text-red-700' : 'text-omega-stone hover:bg-red-50 hover:text-red-700'}`}
        title="Fail — rework required, opens WhatsApp to sub"
      >
        <ThumbsDown className="w-3 h-3" />
      </button>
    </div>
  );
}

function SubPicker({ phase, assignments, onClose, onPick }) {
  return (
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200">
          <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">Contact Subs</p>
          <p className="font-bold text-omega-charcoal text-base mt-0.5">{phase.name}</p>
          <p className="text-xs text-omega-stone mt-0.5">{assignments.length} assigned</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {assignments.map((a) => (
            <div key={a.id} className="px-5 py-3 border-b border-gray-100 last:border-b-0">
              <p className="font-semibold text-sm text-omega-charcoal">{a.sub_name}</p>
              <p className="text-xs text-omega-stone mb-2">{a.sub_phone || '—'}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onPick(a, 'sms')}
                  disabled={!a.sub_phone}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-xs font-bold"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> SMS
                </button>
                <button
                  onClick={() => onPick(a, 'whatsapp')}
                  disabled={!a.sub_phone}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
