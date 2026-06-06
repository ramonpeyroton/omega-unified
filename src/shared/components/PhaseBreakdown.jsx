import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronDown, ChevronRight, CheckCircle2, Circle,
  MessageSquare, MessageCircle, Phone, ThumbsUp, ThumbsDown, AlertTriangle,
  Pencil, Trash2, Plus, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { templateFor, progressFromPhaseData, normalizeService } from '../config/phaseBreakdown';
import PhasePhotos from './PhasePhotos';
import ContactMessageModal from './ContactMessageModal';
import { subConfirmTemplate, waDeepLink } from '../lib/twilio';
import { logAudit } from '../lib/audit';

// Roles allowed to contact subs directly from the phase header.
// Sales/marketing/screen are read-only; admin has global access.
const CAN_CONTACT_SUBS = new Set(['manager', 'owner', 'operations', 'admin']);
// Same roles can mark item verification status (Pass/Fail/Fix).
const CAN_VERIFY = CAN_CONTACT_SUBS;
// Roles allowed to edit the phase breakdown structure (rename phases,
// add/remove items, add/remove phases). Everyone else sees the same
// list read-only and can still toggle done/undone.
const CAN_EDIT_PHASES = new Set(['sales', 'operations', 'owner', 'admin']);

/**
 * Phase breakdown with checkboxes. Persists `phase_data` JSONB on `jobs`.
 * If the job has no phase_data yet (or service changed), seeds from template.
 */
export default function PhaseBreakdown({ job, onJobUpdated, user }) {
  const template = useMemo(() => templateFor(job.service), [job.service]);
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
  const saveTimer = useRef(null);

  // ─── Sub assignments (for the "Contact Subs" button per phase) ───
  // job_subs rows are keyed by phase *name* (legacy AssignSubs behavior).
  // Grouped client-side: { [phaseName]: [{sub_name, sub_phone, id}, ...] }.
  const [subsByPhase, setSubsByPhase] = useState({});
  const canContact = CAN_CONTACT_SUBS.has(user?.role);
  const canEdit = CAN_EDIT_PHASES.has(user?.role);
  const [pickerFor, setPickerFor] = useState(null); // {phase, assignments} or null
  const [contactFor, setContactFor] = useState(null); // {sub, phase, channel} or null

  // Edit mode toggle — only meaningful for roles in CAN_EDIT_PHASES.
  // When on: phase names become inputs, items get delete + edit affordances,
  // and "+ Add item" / "+ Add phase" buttons appear. Checkbox toggling stays
  // on so a user can mark progress mid-edit if they want.
  const [editing, setEditing] = useState(false);

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
    if (!error && data) onJobUpdated?.(data);
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
      const assignments = subsByPhase[phase.name] || subsByPhase[phase.id] || [];
      if (assignments.length > 0) {
        const sub = assignments[0];
        const body =
          `Hi ${sub.sub_name || ''}, quick note from Omega field:\n\n` +
          `Job: ${job.client_name || 'client'}\n` +
          `Phase: ${phase.name}\n` +
          `Item needing ${nextStatus === 'fail' ? 'rework' : 'a fix'}: ${item.label}\n\n` +
          `Please reach out so we can coordinate. Thanks!`;
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

  function toggleOpen(id) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const { totalDone, totalItems, progress, currentPhaseName } = progressFromPhaseData(phaseData);

  // Empty state — only when there's no template AND no phase_data AND
  // the current user can't edit (so there's nothing to do here). When
  // they CAN edit, drop them straight into edit mode with an "Add phase"
  // affordance so they can build the breakdown from scratch.
  if (!template && !phaseData.phases.length && !canEdit) {
    return (
      <div className="text-sm text-omega-stone p-4 bg-omega-cloud rounded-lg">
        No phase breakdown template for service "{job.service || '—'}".
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary + Edit toggle */}
      <div className="flex items-center justify-between text-xs gap-3">
        <div className="min-w-0">
          <p className="text-omega-stone uppercase font-semibold">Progress</p>
          <p className="font-semibold text-omega-charcoal">{totalDone}/{totalItems} items · {currentPhaseName || '—'}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-32 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full bg-[#D4AF37] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="font-semibold text-omega-charcoal text-xs w-8 text-right">{progress}%</span>
          {canEdit && (
            <button
              onClick={() => setEditing((v) => !v)}
              className={`ml-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold uppercase tracking-wider transition ${
                editing
                  ? 'bg-omega-charcoal text-white border-omega-charcoal'
                  : 'border-gray-300 text-omega-stone hover:border-omega-orange hover:text-omega-orange'
              }`}
              title={editing ? 'Finish editing' : 'Edit phases & items'}
            >
              {editing ? <><Check className="w-3 h-3" /> Done</> : <><Pencil className="w-3 h-3" /> Edit</>}
            </button>
          )}
        </div>
      </div>
      {saving && <p className="text-[11px] text-omega-stone">Saving…</p>}
      {editing && phaseData.phases.length === 0 && (
        <div className="text-xs text-omega-stone bg-omega-cloud rounded-lg p-3">
          No phases yet. Use <strong>Add phase</strong> below to start.
        </div>
      )}

      {/* Phases */}
      <div className="space-y-2">
        {phaseData.phases.map((ph, phaseIdx) => {
          const open = openIds.has(ph.id);
          const done = ph.items.every((it) => it.done);
          const doneCount = ph.items.filter((it) => it.done).length;
          // `job_subs` keys assignments by phase *name*; fall back to legacy id.
          const assignments = subsByPhase[ph.name] || subsByPhase[ph.id] || [];
          return (
            <div key={ph.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <div className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-omega-cloud transition-colors">
                <button
                  onClick={() => toggleOpen(ph.id)}
                  className="flex items-center gap-2 text-left flex-shrink-0"
                  aria-label={open ? 'Collapse phase' : 'Expand phase'}
                >
                  {open ? <ChevronDown className="w-4 h-4 text-omega-stone" /> : <ChevronRight className="w-4 h-4 text-omega-stone" />}
                  {done
                    ? <CheckCircle2 className="w-4 h-4 text-omega-success" />
                    : <Circle className="w-4 h-4 text-omega-stone" />
                  }
                </button>
                {editing ? (
                  <input
                    value={ph.name}
                    onChange={(e) => renamePhase(phaseIdx, e.target.value)}
                    placeholder="Phase name"
                    className="flex-1 min-w-0 px-2 py-1 rounded border border-gray-200 text-sm font-semibold text-omega-charcoal focus:border-omega-orange focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => toggleOpen(ph.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-sm font-semibold text-omega-charcoal truncate">{ph.name}</p>
                  </button>
                )}
                <span className="text-[11px] text-omega-stone flex-shrink-0">{doneCount}/{ph.items.length}</span>
                {!editing && canContact && assignments.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setPickerFor({ phase: ph, assignments }); }}
                    className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-omega-orange/40 text-omega-orange hover:bg-omega-pale text-[11px] font-bold"
                    title={`Contact ${assignments.length} sub${assignments.length > 1 ? 's' : ''}`}
                  >
                    <Phone className="w-3 h-3" /> {assignments.length}
                  </button>
                )}
                {editing && (
                  <button
                    onClick={() => removePhase(phaseIdx)}
                    className="ml-1 p-1.5 rounded-lg text-omega-stone hover:bg-red-50 hover:text-red-600 transition"
                    title="Delete this phase"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {open && (
                <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-gray-100">
                  {ph.items.map((it, itemIdx) => (
                    <div key={it.id} className="flex items-start gap-2 py-1 group">
                      <button
                        onClick={() => toggleItem(phaseIdx, itemIdx)}
                        className="flex items-start gap-2 text-left flex-shrink-0 mt-0.5"
                        aria-label={it.done ? 'Mark undone' : 'Mark done'}
                      >
                        <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                          it.done ? 'bg-omega-success border-omega-success' : 'bg-white border-gray-300 group-hover:border-omega-orange'
                        }`}>
                          {it.done && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </span>
                      </button>
                      {editing ? (
                        <input
                          value={it.label}
                          onChange={(e) => renameItem(phaseIdx, itemIdx, e.target.value)}
                          placeholder="Item label"
                          className="flex-1 min-w-0 px-2 py-1 rounded border border-gray-200 text-xs text-omega-charcoal focus:border-omega-orange focus:outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => toggleItem(phaseIdx, itemIdx)}
                          className="flex-1 text-left min-w-0"
                        >
                          <span className={`text-xs ${it.done ? 'line-through text-omega-stone' : 'text-omega-charcoal'}`}>
                            {it.label}
                          </span>
                          {it.verify_status && <VerifyBadge status={it.verify_status} />}
                          {it.done && it.done_by && (
                            <span className="block text-[9px] text-omega-stone/70 leading-tight mt-0.5">
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
                          className="p-1 rounded text-omega-stone hover:bg-red-50 hover:text-red-600 transition flex-shrink-0"
                          title="Delete this item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {editing && (
                    <button
                      onClick={() => addItem(phaseIdx)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-semibold text-omega-orange hover:bg-omega-pale transition mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add item
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {editing && (
          <button
            onClick={addPhase}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm font-semibold text-omega-stone hover:border-omega-orange hover:text-omega-orange transition"
          >
            <Plus className="w-4 h-4" /> Add phase
          </button>
        )}
      </div>

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
            sub:   { name: contactFor.sub.sub_name },
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
