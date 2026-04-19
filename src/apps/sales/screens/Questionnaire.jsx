import { useState, useMemo, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getSchemaForServices, isVisible, serviceLabel } from '../data/questionnaire';
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
function QuestionField({ question, value, onChange }) {
  const q = question;

  if (q.type === 'single') {
    return (
      <div className="space-y-2.5">
        {q.options.map((opt) => (
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
        const exclusiveValues = q.options.filter((o) => o.exclusive).map((o) => o.value);
        const cleaned = arr.filter((v) => !exclusiveValues.includes(v));
        next = cleaned.includes(opt.value)
          ? cleaned.filter((v) => v !== opt.value)
          : [...cleaned, opt.value];
      }
      onChange(next);
    };
    return (
      <div className="space-y-2.5">
        {q.options.map((opt) => (
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
    const dims = value && typeof value === 'object' ? value : { width: '', length: '' };
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">Width</label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              value={dims.width ?? ''}
              onChange={(e) => onChange({ ...dims, width: e.target.value })}
              placeholder="0"
              className="w-full pl-4 pr-10 py-4 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base font-semibold focus:outline-none focus:border-omega-orange transition-colors"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-omega-stone font-semibold">{q.unit || 'ft'}</span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-omega-slate uppercase tracking-wider mb-2">Length</label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              value={dims.length ?? ''}
              onChange={(e) => onChange({ ...dims, length: e.target.value })}
              placeholder="0"
              className="w-full pl-4 pr-10 py-4 rounded-xl bg-white border-2 border-gray-200 text-omega-charcoal text-base font-semibold focus:outline-none focus:border-omega-orange transition-colors"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-omega-stone font-semibold">{q.unit || 'ft'}</span>
          </div>
        </div>
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

  return null;
}

// ─── Main screen ────────────────────────────────────────────────────
export default function Questionnaire({ job, onNavigate, onJobUpdated, onComplete, onReviewReady }) {
  const schema = useMemo(() => getSchemaForServices(job.service), [job.service]);
  const [answers, setAnswers] = useState(() => job.answers || {});
  const [idx, setIdx] = useState(() => {
    const first = schema.findIndex((q) => isVisible(q, job.answers || {}));
    return Math.max(0, first);
  });
  const [toast, setToast] = useState(null);
  const [finishing, setFinishing] = useState(false);
  const saveTimer = useRef(null);

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

  const isSingle = currentQ.type === 'single';
  // Continue button enabled conditions
  const canContinue = (() => {
    const v = currentValue;
    if (currentQ.type === 'single') return v !== undefined && v !== null;
    if (currentQ.type === 'multi') return Array.isArray(v); // allow empty array (but usually user picks something)
    if (currentQ.type === 'dimensions') return v && v.width !== '' && v.length !== '' && v.width != null && v.length != null;
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
