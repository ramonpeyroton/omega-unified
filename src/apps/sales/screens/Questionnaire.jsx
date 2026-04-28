import { useState, useMemo, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles, Pencil, X } from 'lucide-react';
import * as Icons from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  getSchemaForServices, isVisible, serviceLabel,
  hasSectionMarkers, splitIntoSections, SERVICES,
  NO_QUESTIONNAIRE_SERVICES,
} from '../data/questionnaire';
import LoadingSpinner from '../components/LoadingSpinner';
import ProgressBar from '../components/ProgressBar';
import Toast from '../components/Toast';

// ════════════════════════════════════════════════════════════════════
// Minimalist, conditional questionnaire.
// One question at a time with smooth fade transitions. Auto-saves each
// answer to Supabase. On completion, navigates straight to Report which
// auto-generates the AI report.
// ════════════════════════════════════════════════════════════════════

function modifiedFlags() {
  return {
    questionnaire_modified: true,
    questionnaire_modified_at: new Date().toISOString(),
  };
}

// ─── Services editor ──────────────────────────────────────────────
// Little pencil button that sits in the header. Opens a modal listing
// every service the shop offers; the seller toggles what's part of
// this job. Writes the comma-separated list to `jobs.service`, which
// causes `getSchemaForServices()` to rebuild with the new set — adding
// new service sections or removing orphan ones without losing prior
// answers for services the seller kept.
function ServicesEditorButton({ job, onUpdated }) {
  const [open, setOpen]   = useState(false);
  const [picked, setPicked] = useState(() => splitServices(job.service));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => { setPicked(splitServices(job.service)); }, [job?.service]);

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function save() {
    if (picked.length === 0) { setError('Select at least one service.'); return; }
    setSaving(true);
    setError('');
    try {
      const joined = picked.join(', ');
      const { data, error: e } = await supabase
        .from('jobs').update({ service: joined }).eq('id', job.id).select().single();
      if (e) throw e;
      onUpdated?.(data || { ...job, service: joined });
      setOpen(false);
    } catch (e) {
      setError(e?.message || 'Failed to save');
    }
    setSaving(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-[11px] font-bold flex-shrink-0 shadow-sm"
        title="Edit services for this job"
      >
        <Pencil className="w-3 h-3" /> Services
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={() => !saving && setOpen(false)}>
          <div
            className="bg-white rounded-2xl max-w-md w-full max-h-[88vh] overflow-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-omega-stone font-bold">Edit services</p>
                <p className="text-base font-bold text-omega-charcoal">{job.client_name || 'Job'}</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-omega-charcoal" />
              </button>
            </div>

            <div className="p-5 space-y-2">
              <p className="text-xs text-omega-stone mb-2">
                Pick every service that applies to this job. Adding one later pulls in its questions; removing one clears its section from the flow (saved answers stay in the database for history).
              </p>
              {SERVICES.map((s) => {
                const selected = picked.includes(s.id);
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => toggle(s.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                      selected
                        ? 'border-omega-orange bg-omega-pale'
                        : 'border-gray-200 bg-white hover:border-omega-orange/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-5 h-5 flex-shrink-0 rounded-md border-2 flex items-center justify-center ${
                        selected ? 'bg-omega-orange border-omega-orange' : 'border-gray-300'
                      }`}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="text-sm font-semibold text-omega-charcoal">{s.label}</span>
                    </div>
                  </button>
                );
              })}
              {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
            </div>

            <div className="sticky bottom-0 bg-white p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={saving} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
              >
                {saving ? 'Saving…' : 'Save services'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function splitServices(raw) {
  return String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// ─── Dimension helpers ─────────────────────────────────────────────
// Accepts either the legacy single-number shape or the new {ft, in} shape
// and always returns { ft, in } so the UI and validators only deal with one.
function asFtIn(raw) {
  if (raw && typeof raw === 'object') {
    return { ft: raw.ft ?? '', in: raw.in ?? '' };
  }
  if (raw == null || raw === '') return { ft: '', in: '' };
  // Legacy single string/number — assume it was feet.
  return { ft: String(raw), in: '' };
}

function hasFtIn(v) {
  const x = asFtIn(v);
  return x.ft !== '' && x.ft != null;
}

/** "9'2" — nice for reading back in saved answers. */
export function formatFtIn(raw) {
  const x = asFtIn(raw);
  const ft = x.ft === '' ? '0' : x.ft;
  const inch = x.in === '' ? '' : `${x.in}"`;
  return `${ft}'${inch}`;
}

function FtInField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            value={value.ft ?? ''}
            onChange={(e) => onChange('ft', e.target.value)}
            placeholder="0"
            className="w-full pl-4 pr-8 py-4 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base font-semibold focus:outline-none focus:border-omega-orange transition-colors"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-omega-stone font-bold">ft</span>
        </div>
        <div className="relative flex-1">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="11"
            value={value.in ?? ''}
            onChange={(e) => onChange('in', e.target.value)}
            placeholder="0"
            className="w-full pl-4 pr-8 py-4 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base font-semibold focus:outline-none focus:border-omega-orange transition-colors"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-omega-stone font-bold">in</span>
        </div>
      </div>
    </div>
  );
}

// ─── Large button used for single/multi answer cards ────────────────
function OptionButton({ label, selected, onClick, type = 'single' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-5 py-4 rounded-2xl border-2 transition-all duration-150 ${
        selected
          ? 'border-omega-orange bg-omega-pale text-omega-charcoal shadow-sm'
          : 'border-gray-200 bg-white text-omega-slate hover:border-omega-orange/40 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-3">
        {type === 'multi' ? (
          <div className={`w-5 h-5 flex-shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-omega-orange border-omega-orange' : 'border-gray-300'
          }`}>
            {selected && <Check className="w-3.5 h-3.5 text-white" />}
          </div>
        ) : (
          <div className={`w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-omega-orange border-omega-orange' : 'border-gray-300'
          }`}>
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        )}
        <span className="text-base font-semibold">{label}</span>
      </div>
    </button>
  );
}

// ─── Question renderer ──────────────────────────────────────────────
// `options` may be an array OR a function of answers (dynamic cascades,
// e.g. cabinet color list depends on brand+series+line). The resolver
// below normalizes both shapes.
function resolveOptions(q, answers) {
  const opts = typeof q.options === 'function' ? q.options(answers || {}) : q.options;
  return Array.isArray(opts) ? opts : [];
}

function QuestionField({ question, value, onChange, answers }) {
  const q = question;
  const options = resolveOptions(q, answers);

  if (q.type === 'single') {
    return (
      <div className="space-y-2.5">
        {options.map((opt) => (
          <OptionButton
            key={opt.value}
            label={opt.label}
            selected={value === opt.value}
            onClick={() => onChange(opt.value)}
          />
        ))}
      </div>
    );
  }

  if (q.type === 'multi') {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (opt) => {
      let next;
      if (opt.exclusive) {
        next = arr.includes(opt.value) ? [] : [opt.value];
      } else {
        // Toggling a normal option clears any exclusive selection
        const exclusiveValues = options.filter((o) => o.exclusive).map((o) => o.value);
        const cleaned = arr.filter((v) => !exclusiveValues.includes(v));
        next = cleaned.includes(opt.value)
          ? cleaned.filter((v) => v !== opt.value)
          : [...cleaned, opt.value];
      }
      onChange(next);
    };
    return (
      <div className="space-y-2.5">
        {options.map((opt) => (
          <OptionButton
            key={opt.value}
            type="multi"
            label={opt.label}
            selected={arr.includes(opt.value)}
            onClick={() => toggle(opt)}
          />
        ))}
      </div>
    );
  }

  if (q.type === 'dimensions') {
    // Support two shapes side-by-side:
    //   Legacy: { width: "10", length: "8" }  (single number, assumed feet)
    //   New:    { width: { ft: "9", in: "2" }, length: { ft: "10", in: "5" } }
    // The helper `asFtIn` coerces either shape into { ft, in } so the
    // rest of the component can stay simple.
    const dims = (value && typeof value === 'object') ? value : {};
    const w = asFtIn(dims.width);
    const l = asFtIn(dims.length);

    function update(dim, part, raw) {
      // Strip everything that isn't a digit; cap inches at 11 so the
      // user can't enter 9'99".
      const digits = String(raw).replace(/\D/g, '').slice(0, part === 'in' ? 2 : 3);
      const current = dim === 'width' ? w : l;
      const next = { ...current, [part]: digits };
      if (part === 'in' && Number(digits) > 11) next.in = '11';
      onChange({ ...dims, [dim]: next });
    }

    return (
      <div className="grid grid-cols-2 gap-3">
        <FtInField label="Width"  value={w} onChange={(part, v) => update('width',  part, v)} />
        <FtInField label="Length" value={l} onChange={(part, v) => update('length', part, v)} />
      </div>
    );
  }

  if (q.type === 'number') {
    return (
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.placeholder || '0'}
        className="w-full px-4 py-4 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base font-semibold focus:outline-none focus:border-omega-orange transition-colors"
      />
    );
  }

  if (q.type === 'text') {
    return (
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.placeholder || ''}
        rows={4}
        className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base focus:outline-none focus:border-omega-orange transition-colors resize-none"
      />
    );
  }

  // `select` — native dropdown. Better than radio buttons when there are
  // many options (e.g. appliance sizes, cabinet colors). Auto-advances on
  // pick, same as `single`. The first <option> is a disabled placeholder.
  if (q.type === 'select') {
    // If the stored value isn't in the current (possibly dynamic) options
    // list — e.g. user changed an upstream answer — fall back to blank
    // so the placeholder shows and the user can re-pick.
    const valid = options.some((o) => o.value === value);
    return (
      <div className="relative">
        <select
          value={valid ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none px-4 py-4 pr-10 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base font-semibold focus:outline-none focus:border-omega-orange transition-colors cursor-pointer"
        >
          <option value="" disabled>{q.placeholder || 'Select an option'}</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-omega-stone">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M5 8l5 5 5-5H5z"/></svg>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Main screen ────────────────────────────────────────────────────
// Most of the time the seller arrives here with `job.service` already
// populated — either by the receptionist during phone intake, or by
// the seller themselves on the brand-new "What service?" picker that
// kicks off the New Job flow. So we skip the service-picker step in
// that common case and go straight to the questions.
//
// We still keep the picker around for the two legitimate edit cases:
//   1. Receptionist mis-categorized the lead on the phone
//   2. Client changes their mind between the call and the visit
// Both are reachable via the small "Edit services" link rendered next
// to the section header — opens the same picker on demand.
//
// If the job arrived with NO service set (legacy data, edge case), we
// still default to opening the picker first so we don't drop the
// seller into an empty questionnaire.
export default function Questionnaire(props) {
  const { job, onJobUpdated } = props;
  // Treat the picker as "already passed" when the job has a service
  // assigned. The seller can re-open it with the editor button below.
  const [servicesConfirmed, setServicesConfirmed] = useState(() => !!job?.service);

  const schema = useMemo(() => getSchemaForServices(job.service), [job.service]);

  if (!servicesConfirmed) {
    return (
      <ServiceSelectionScreen
        job={job}
        onBack={() => props.onNavigate?.('pipeline')}
        onConfirm={(updatedJob) => {
          onJobUpdated?.(updatedJob);
          setServicesConfirmed(true);
        }}
      />
    );
  }

  // Both variants already render a <ServicesEditorButton> in their
  // headers — that opens the same picker as a modal when the seller
  // genuinely needs to add/remove services mid-flow (client changed
  // their mind, receptionist mis-categorized). So we don't need an
  // extra "edit services" callback here; the button handles it.
  if (hasSectionMarkers(schema)) {
    return <SectionModeQuestionnaire {...props} schema={schema} />;
  }
  return <LegacyQuestionnaire {...props} schema={schema} />;
}

// ─── Service selection step ───────────────────────────────────────────
// Shown when the seller first opens the questionnaire. Shows every
// service offered, pre-checks the ones already on the job (what the
// receptionist picked during intake), and lets the seller toggle.
// "Start Questionnaire" saves the set and hands off to the flow.
function ServiceSelectionScreen({ job, onBack, onConfirm }) {
  const initial = splitServices(job.service);
  const [picked, setPicked] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Services that have at least one question.
  const billable = picked.filter((id) => !NO_QUESTIONNAIRE_SERVICES.has(id));
  const allSubcontracted = picked.length > 0 && billable.length === 0;

  async function start() {
    if (picked.length === 0) { setError('Select at least one service before starting.'); return; }
    setSaving(true);
    setError('');
    try {
      const joined = picked.join(', ');
      const originalJoined = initial.join(', ');
      // Only hit the DB if the seller actually changed the set.
      let savedJob = job;
      if (joined !== originalJoined) {
        const { data, error: e } = await supabase
          .from('jobs').update({ service: joined }).eq('id', job.id).select().single();
        if (e) throw e;
        savedJob = data || { ...job, service: joined };
      }
      // When everything selected is subcontracted, there's no form to
      // fill — route back to the pipeline instead of opening an empty
      // questionnaire.
      if (allSubcontracted) {
        onBack?.();
        return;
      }
      onConfirm(savedJob);
    } catch (e) {
      setError(e?.message || 'Failed to save. Try again.');
      setSaving(false);
    }
  }

  const clientLabel = [job.client_name, job.city].filter(Boolean).join(' · ');
  const primaryLabel = saving
    ? 'Saving…'
    : allSubcontracted ? 'Save & Close (no form)' : 'Start Questionnaire';

  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      <header className="bg-omega-charcoal text-white px-5 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-white/60 font-semibold">Questionnaire</p>
            <h1 className="text-base sm:text-lg font-bold truncate">{clientLabel || 'New Project'}</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-5">
          <h2 className="text-lg sm:text-xl font-bold text-omega-charcoal">What services does this project cover?</h2>
          <p className="text-sm text-omega-stone mt-1">
            Pick every service the client wants a price on. You can change these later from inside the questionnaire if the scope shifts.
          </p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SERVICES.map((svc) => {
            const selected = picked.includes(svc.id);
            const Icon = Icons[svc.icon] || Icons.Wrench;
            const noQuestionnaire = NO_QUESTIONNAIRE_SERVICES.has(svc.id);
            return (
              <button
                key={svc.id}
                onClick={() => toggle(svc.id)}
                type="button"
                className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all duration-150 ${
                  selected
                    ? 'border-omega-orange bg-omega-pale shadow-sm'
                    : 'border-gray-200 bg-white hover:border-omega-orange/40'
                }`}
              >
                {selected && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-omega-orange flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </span>
                )}
                <Icon className={`w-6 h-6 ${selected ? 'text-omega-orange' : 'text-omega-stone'}`} />
                <span className={`text-xs font-semibold text-center leading-tight ${selected ? 'text-omega-charcoal' : 'text-omega-slate'}`}>
                  {svc.label}
                </span>
                {noQuestionnaire && (
                  <span className="absolute bottom-1 left-1 right-1 text-[9px] font-bold uppercase tracking-wider text-omega-stone bg-white/70 rounded px-1 py-0.5">
                    Subcontracted · no form
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-omega-stone">
          {picked.length} service{picked.length === 1 ? '' : 's'} selected.
          {(() => {
            const billable = picked.filter((id) => !NO_QUESTIONNAIRE_SERVICES.has(id));
            if (picked.length > 0 && billable.length === 0) {
              return ' All of them are subcontracted — no questions to answer. Go straight to the estimate.';
            }
            return '';
          })()}
        </p>
      </main>

      <footer className="border-t border-gray-200 bg-white px-4 sm:px-6 py-4 sticky bottom-0">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button onClick={onBack} className="flex-1 px-4 py-3 rounded-xl border border-gray-300 text-omega-slate font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={start}
            disabled={saving || picked.length === 0}
            className="flex-[2] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {primaryLabel}
            {!allSubcontracted && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </footer>
    </div>
  );
}

function LegacyQuestionnaire({ job, schema, onNavigate, onJobUpdated, onComplete, onReviewReady }) {
  const [answers, setAnswers] = useState(() => job.answers || {});
  const [idx, setIdx] = useState(() => {
    const first = schema.findIndex((q) => isVisible(q, job.answers || {}));
    return Math.max(0, first);
  });
  const [toast, setToast] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const saveTimer = useRef(null);

  // Clamp idx if the schema shrank after a service was removed.
  useEffect(() => {
    if (idx >= schema.length) setIdx(Math.max(0, schema.length - 1));
  }, [schema.length, idx]);

  const currentQ = schema[idx];
  const currentValue = currentQ ? answers[currentQ.id] : undefined;

  // Visible count / done count for progress bar
  const { totalVisible, doneVisible } = useMemo(() => {
    let total = 0, done = 0;
    schema.forEach((q, i) => {
      if (!isVisible(q, answers)) return;
      total += 1;
      if (i < idx) done += 1;
    });
    return { totalVisible: total, doneVisible: done };
  }, [schema, answers, idx]);

  const progress = totalVisible > 0 ? Math.round((doneVisible / totalVisible) * 100) : 0;

  // ─── Persist answers (realtime, debounced) ────────────────────────
  async function persistAnswers(next) {
    try {
      const patch = { answers: next, status: 'draft', ...modifiedFlags() };
      await supabase.from('jobs').update(patch).eq('id', job.id);
      onJobUpdated?.({ ...job, ...patch });
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to save. Will retry.' });
    }
  }

  function scheduleSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistAnswers(next), 500);
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // ─── Navigation helpers ────────────────────────────────────────────
  function findNextVisible(fromIdx, a) {
    for (let i = fromIdx; i < schema.length; i++) {
      if (isVisible(schema[i], a)) return i;
    }
    return -1;
  }
  function findPrevVisible(fromIdx, a) {
    for (let i = fromIdx; i >= 0; i--) {
      if (isVisible(schema[i], a)) return i;
    }
    return -1;
  }

  function goNext(nextAnswers) {
    const a = nextAnswers || answers;
    const n = findNextVisible(idx + 1, a);
    if (n === -1) {
      void complete(a);
    } else {
      setIdx(n);
    }
  }

  function goBack() {
    const p = findPrevVisible(idx - 1, answers);
    if (p !== -1) setIdx(p);
  }

  // ─── Answer handlers ──────────────────────────────────────────────
  function setAnswer(id, value) {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    scheduleSave(next);
    return next;
  }

  function handleSingleChoice(value) {
    if (!currentQ) return;
    const next = setAnswer(currentQ.id, value);
    // auto-advance after a short beat for visual feedback
    setTimeout(() => goNext(next), 150);
  }

  function handleAnswerChange(value) {
    if (!currentQ) return;
    setAnswer(currentQ.id, value);
  }

  // ─── Completion ───────────────────────────────────────────────────
  async function complete(finalAnswers) {
    setFinishing(true);
    try {
      const patch = { answers: finalAnswers, status: 'draft', ...modifiedFlags() };
      const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single();
      if (error) throw error;
      const updatedJob = data || { ...job, ...patch };
      onJobUpdated?.(updatedJob);
      if (onComplete) {
        onComplete(updatedJob);
      } else if (onReviewReady) {
        onReviewReady(updatedJob, finalAnswers);
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to save final answers. Please try again.' });
      setFinishing(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  if (schema.length === 0) {
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col items-center justify-center p-6 text-center">
        <p className="text-omega-stone mb-4">No questions available for this service.</p>
        <button onClick={() => onNavigate('home')} className="px-4 py-2 rounded-xl bg-omega-orange text-white font-semibold">Back to Home</button>
      </div>
    );
  }

  if (finishing) {
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-omega-pale flex items-center justify-center mb-5 animate-pulse">
          <Sparkles className="w-9 h-9 text-omega-orange" />
        </div>
        <p className="font-bold text-omega-charcoal text-lg">Finalizing…</p>
        <p className="text-sm text-omega-stone mt-1">Saving your answers and preparing the report</p>
        <div className="mt-5"><LoadingSpinner /></div>
      </div>
    );
  }

  if (!currentQ) {
    // Shouldn't happen but guard anyway
    return null;
  }

  // single + select both auto-advance on pick
  const isSingle = currentQ.type === 'single' || currentQ.type === 'select';
  // Continue button enabled conditions
  const canContinue = (() => {
    const v = currentValue;
    if (currentQ.type === 'single' || currentQ.type === 'select') return v !== undefined && v !== null && v !== '';
    if (currentQ.type === 'multi') return Array.isArray(v); // allow empty array (but usually user picks something)
    if (currentQ.type === 'dimensions') return !!v && hasFtIn(v.width) && hasFtIn(v.length);
    if (currentQ.type === 'number') return v !== undefined && v !== null && String(v).trim() !== '';
    if (currentQ.type === 'text') return v !== undefined && String(v).trim() !== '';
    return true;
  })();

  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header with progress */}
      <header className="bg-omega-charcoal px-5 pt-10 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => (idx === 0 ? onNavigate('home') : goBack())}
            className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <ServicesEditorButton job={job} onUpdated={onJobUpdated} />
          <div className="min-w-0 flex-1">
            <p className="text-omega-fog text-[11px] uppercase tracking-wider truncate">
              {serviceLabel(currentQ._service)}
            </p>
            <p className="text-white text-sm font-bold truncate">{job.client_name}</p>
          </div>
          <p className="text-omega-fog text-xs font-semibold flex-shrink-0">
            {doneVisible + 1} / {totalVisible}
          </p>
        </div>
        <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full bg-omega-orange transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* Question card — fade in on change */}
      <div key={currentQ.id} className="flex-1 px-5 py-6 animate-[fadeIn_0.25s_ease-out]">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold text-omega-charcoal leading-snug mb-1.5">
            {currentQ.label}
          </h1>
          {currentQ.helper && (
            <p className="text-sm text-omega-stone mb-4">{currentQ.helper}</p>
          )}
          {!currentQ.helper && <div className="mb-4" />}

          <QuestionField
            question={currentQ}
            value={currentValue}
            answers={answers}
            onChange={isSingle ? handleSingleChoice : handleAnswerChange}
          />
        </div>
      </div>

      {/* Footer — Continue (for non-single types) */}
      {!isSingle && (
        <div className="sticky bottom-0 bg-omega-cloud/95 backdrop-blur px-5 py-4 border-t border-gray-200 safe-bottom">
          <div className="max-w-md mx-auto">
            <button
              onClick={() => goNext()}
              disabled={!canContinue}
              className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base transition-all duration-200 shadow-lg shadow-omega-orange/25"
            >
              {doneVisible + 1 === totalVisible ? 'Finish & Generate Report' : 'Continue'}
              <ArrowRight className="w-5 h-5" />
            </button>
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

// ────────────────────────────────────────────────────────────────────
// SECTION MODE
// Renders one section at a time with ALL its visible questions stacked
// vertically. Conditional follow-ups appear inline below their parent
// because `splitIntoSections` recomputes visibility whenever `answers`
// changes. The Continue button advances one whole section at a time.
// ────────────────────────────────────────────────────────────────────

function hasValue(q, v) {
  if (q.type === 'single' || q.type === 'select') return v !== undefined && v !== null && v !== '';
  if (q.type === 'multi')       return Array.isArray(v);
  if (q.type === 'dimensions')  return !!v && hasFtIn(v.width) && hasFtIn(v.length);
  if (q.type === 'number')      return v !== undefined && v !== null && String(v).trim() !== '';
  if (q.type === 'text')        return v !== undefined && String(v).trim() !== '';
  return true;
}

function SectionModeQuestionnaire({ job, schema, onNavigate, onJobUpdated, onComplete, onReviewReady }) {
  const [answers, setAnswers] = useState(() => job.answers || {});
  const [toast, setToast] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const saveTimer = useRef(null);

  // Recompute every render — section contents depend on answers (showIf).
  const sections = useMemo(() => splitIntoSections(schema, answers), [schema, answers]);
  const [sectionIdx, setSectionIdx] = useState(0);

  // Clamp sectionIdx if the list of visible sections shrinks
  useEffect(() => {
    if (sectionIdx > sections.length - 1) setSectionIdx(Math.max(0, sections.length - 1));
  }, [sections.length, sectionIdx]);

  const section = sections[sectionIdx];

  // ─── Persist (debounced) ───────────────────────────────────────────
  async function persistAnswers(next) {
    try {
      const patch = { answers: next, status: 'draft', ...modifiedFlags() };
      await supabase.from('jobs').update(patch).eq('id', job.id);
      onJobUpdated?.({ ...job, ...patch });
    } catch {
      setToast({ type: 'error', message: 'Failed to save. Will retry.' });
    }
  }
  function scheduleSave(next) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistAnswers(next), 500);
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  function setAnswer(id, value) {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    scheduleSave(next);
    return next;
  }

  async function complete(finalAnswers) {
    setFinishing(true);
    try {
      const patch = { answers: finalAnswers, status: 'draft', ...modifiedFlags() };
      const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select().single();
      if (error) throw error;
      const updatedJob = data || { ...job, ...patch };
      onJobUpdated?.(updatedJob);
      if (onComplete) onComplete(updatedJob);
      else if (onReviewReady) onReviewReady(updatedJob, finalAnswers);
    } catch {
      setToast({ type: 'error', message: 'Failed to save final answers. Please try again.' });
      setFinishing(false);
    }
  }

  function goBack() {
    if (sectionIdx === 0) onNavigate('home');
    else setSectionIdx(sectionIdx - 1);
  }
  function goForward() {
    if (sectionIdx >= sections.length - 1) void complete(answers);
    else setSectionIdx(sectionIdx + 1);
  }

  // Continue is allowed when every non-optional visible question in the
  // current section has a value.
  const canContinue = !section || section.questions.every(
    (q) => q.optional || hasValue(q, answers[q.id])
  );

  const progress = sections.length > 0
    ? Math.round(((sectionIdx + 1) / sections.length) * 100)
    : 0;

  if (schema.length === 0 || !section) {
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col items-center justify-center p-6 text-center">
        <p className="text-omega-stone mb-4">No questions available for this service.</p>
        <button onClick={() => onNavigate('home')} className="px-4 py-2 rounded-xl bg-omega-orange text-white font-semibold">
          Back to Home
        </button>
      </div>
    );
  }

  if (finishing) {
    return (
      <div className="min-h-screen bg-omega-cloud flex flex-col items-center justify-center p-6">
        <div className="w-20 h-20 rounded-full bg-omega-pale flex items-center justify-center mb-5 animate-pulse">
          <Sparkles className="w-9 h-9 text-omega-orange" />
        </div>
        <p className="font-bold text-omega-charcoal text-lg">Finalizing…</p>
        <p className="text-sm text-omega-stone mt-1">Saving your answers and preparing the report</p>
        <div className="mt-5"><LoadingSpinner /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header with progress */}
      <header className="bg-omega-charcoal px-5 pt-10 pb-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={goBack}
            className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <ServicesEditorButton job={job} onUpdated={onJobUpdated} />
          <div className="min-w-0 flex-1">
            <p className="text-omega-fog text-[11px] uppercase tracking-wider truncate">
              {serviceLabel(section.service || job.service)}
            </p>
            <p className="text-white text-sm font-bold truncate">{job.client_name}</p>
          </div>
          <p className="text-omega-fog text-xs font-semibold flex-shrink-0">
            {sectionIdx + 1} / {sections.length}
          </p>
        </div>
        <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full bg-omega-orange transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* Section body */}
      <div key={section.id + ':' + sectionIdx} className="flex-1 px-5 py-6 animate-[fadeIn_0.25s_ease-out]">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold text-omega-charcoal mb-1">{section.label}</h1>
          <div className="h-1 w-12 bg-omega-orange rounded-full mb-6" />

          <div className="space-y-6">
            {section.questions.map((q) => (
              <QuestionBlock
                key={q.id}
                question={q}
                value={answers[q.id]}
                answers={answers}
                onChange={(v) => setAnswer(q.id, v)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer — Continue */}
      <div className="sticky bottom-0 bg-omega-cloud/95 backdrop-blur px-5 py-4 border-t border-gray-200 safe-bottom">
        <div className="max-w-md mx-auto">
          <button
            onClick={goForward}
            disabled={!canContinue}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-omega-orange hover:bg-omega-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base transition-all duration-200 shadow-lg shadow-omega-orange/25"
          >
            {sectionIdx + 1 === sections.length ? 'Finish & Generate Report' : 'Continue'}
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// Card-style block for a single question inside a section page.
function QuestionBlock({ question, value, answers, onChange }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-omega-charcoal mb-1">
        {question.label}
        {question.optional && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-omega-stone font-semibold">optional</span>
        )}
      </label>
      {question.helper && (
        <p className="text-xs text-omega-stone mb-2">{question.helper}</p>
      )}
      <QuestionField
        question={question}
        value={value}
        answers={answers}
        onChange={onChange}
      />
    </div>
  );
}
