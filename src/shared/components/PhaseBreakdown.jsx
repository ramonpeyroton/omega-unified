import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { templateFor, progressFromPhaseData, normalizeService } from '../config/phaseBreakdown';
import PhasePhotos from './PhasePhotos';

/**
 * Phase breakdown with checkboxes. Persists `phase_data` JSONB on `jobs`.
 * If the job has no phase_data yet (or service changed), seeds from template.
 */
export default function PhaseBreakdown({ job, onJobUpdated, user }) {
  const template = useMemo(() => templateFor(job.service), [job.service]);
  const [phaseData, setPhaseData] = useState(() => deriveInitial(job, template));
  const [openIds, setOpenIds] = useState(() => new Set([phaseData?.phases?.[0]?.id].filter(Boolean)));
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);

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

  function toggleItem(phaseIdx, itemIdx) {
    setPhaseData((prev) => {
      const phases = prev.phases.map((p, pi) => {
        if (pi !== phaseIdx) return p;
        const items = p.items.map((it, ii) => ii === itemIdx ? { ...it, done: !it.done } : it);
        const completed = items.every((it) => it.done);
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

  if (!template && !phaseData.phases.length) {
    return (
      <div className="text-sm text-omega-stone p-4 bg-omega-cloud rounded-lg">
        No phase breakdown template for service "{job.service || '—'}".
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center justify-between text-xs">
        <div>
          <p className="text-omega-stone uppercase font-semibold">Progress</p>
          <p className="font-semibold text-omega-charcoal">{totalDone}/{totalItems} items · {currentPhaseName || '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-32 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full bg-[#D4AF37] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="font-semibold text-omega-charcoal text-xs w-8 text-right">{progress}%</span>
        </div>
      </div>
      {saving && <p className="text-[11px] text-omega-stone">Saving…</p>}

      {/* Phases */}
      <div className="space-y-2">
        {phaseData.phases.map((ph, phaseIdx) => {
          const open = openIds.has(ph.id);
          const done = ph.items.every((it) => it.done);
          const doneCount = ph.items.filter((it) => it.done).length;
          return (
            <div key={ph.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
              <button
                onClick={() => toggleOpen(ph.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-omega-cloud transition-colors"
              >
                {open ? <ChevronDown className="w-4 h-4 text-omega-stone" /> : <ChevronRight className="w-4 h-4 text-omega-stone" />}
                {done
                  ? <CheckCircle2 className="w-4 h-4 text-omega-success" />
                  : <Circle className="w-4 h-4 text-omega-stone" />
                }
                <p className="flex-1 text-left text-sm font-semibold text-omega-charcoal truncate">{ph.name}</p>
                <span className="text-[11px] text-omega-stone">{doneCount}/{ph.items.length}</span>
              </button>

              {open && (
                <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-gray-100">
                  {ph.items.map((it, itemIdx) => (
                    <div key={it.id} className="flex items-start gap-2 py-1 group">
                      <button
                        onClick={() => toggleItem(phaseIdx, itemIdx)}
                        className="flex items-start gap-2 text-left flex-1 min-w-0"
                      >
                        <span className={`w-4 h-4 mt-0.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          it.done ? 'bg-omega-success border-omega-success' : 'bg-white border-gray-300 group-hover:border-omega-orange'
                        }`}>
                          {it.done && <CheckCircle2 className="w-3 h-3 text-white" />}
                        </span>
                        <span className={`text-xs ${it.done ? 'line-through text-omega-stone' : 'text-omega-charcoal'}`}>{it.label}</span>
                      </button>
                      <PhasePhotos jobId={job.id} phaseId={ph.id} itemId={it.id} user={user} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
