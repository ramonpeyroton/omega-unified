import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft, ChevronDown, CheckSquare, Square, Camera, Image, X,
  AlertTriangle, CheckCircle, Plus, Trash2, ClipboardCheck, MessageSquare, MessageCircle,
  Clock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { uploadPhoto } from '../lib/imageUtils';
import { getPhasesForService } from '../data/phases';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import ProgressRing from '../components/ProgressRing';

// Parse __duration__ and __warning__ prefixed tasks added by Omega AI
function parsePhaseData(tasks) {
  let duration = null;
  const warnings = [];
  const normalTasks = [];
  for (const t of (tasks || [])) {
    if (t.startsWith('__duration__')) {
      duration = t.replace('__duration__', '');
    } else if (t.startsWith('__warning__')) {
      warnings.push(t.replace('__warning__', ''));
    } else {
      normalTasks.push(t);
    }
  }
  return { duration, warnings, normalTasks };
}

function buildSubWhatsApp(subPhone, subName, phaseName, tasks, jobAddress) {
  const phone = (subPhone || '').replace(/\D/g, '');
  if (!phone) return null;
  const taskList = (tasks || []).map((t) => `• ${t}`).join('\n');
  const msg = `Hi ${subName}! 👷\n\nYou've been assigned to the *${phaseName}* phase at:\n📍 ${jobAddress}\n\nTasks for this phase:\n${taskList}\n\nPlease confirm your availability and expected start date.\n\n— Omega Development Team\n📞 203-451-4846\n🌐 omeganyct.com`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-center font-semibold text-omega-charcoal mb-2">Uncheck Task?</p>
        <p className="text-center text-sm text-omega-stone mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition-colors">Uncheck</button>
        </div>
      </div>
    </div>
  );
}

// ─── Clean Check Modal ────────────────────────────────────────────────────────
function CleanCheckModal({ phase, onSave, onClose }) {
  const [status, setStatus] = useState(phase.clean || null);
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const cleanMessage = `Hi! The ${phase.phase} phase at your job site needs a clean-up before we proceed. Please ensure the area is cleared and cleaned. Thank you — Omega Development`;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="bg-white rounded-t-3xl w-full p-6 pb-8 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-omega-charcoal text-lg">Clean Check</h3>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-omega-stone mb-4">Phase: <strong className="text-omega-charcoal">{phase.phase}</strong></p>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <button onClick={() => setStatus('yes')} className={`py-4 rounded-xl border-2 font-semibold text-sm transition-all ${status === 'yes' ? 'border-omega-success bg-green-50 text-omega-success' : 'border-gray-200 text-omega-slate'}`}>
            <CheckCircle className="w-6 h-6 mx-auto mb-1" />Clean
          </button>
          <button onClick={() => setStatus('no')} className={`py-4 rounded-xl border-2 font-semibold text-sm transition-all ${status === 'no' ? 'border-omega-danger bg-red-50 text-omega-danger' : 'border-gray-200 text-omega-slate'}`}>
            <AlertTriangle className="w-6 h-6 mx-auto mb-1" />Needs Cleaning
          </button>
        </div>

        {status === 'no' && (
          <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs font-semibold text-amber-700 mb-2">Message to copy for sub:</p>
            <p className="text-sm text-amber-800">{cleanMessage}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(cleanMessage); }}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Copy Message
            </button>
          </div>
        )}

        <button onClick={() => onSave(status, photos)} disabled={!status}
          className="w-full py-3.5 rounded-xl bg-omega-orange disabled:opacity-50 text-white font-semibold text-sm hover:bg-omega-dark transition-colors">
          Save Clean Status
        </button>
      </div>
    </div>
  );
}

// ─── Phase Card ───────────────────────────────────────────────────────────────
function PhaseCard({ phase, jobId, managerName, onUpdate, darkMode, subInfo, jobAddress, onToast }) {
  const [open, setOpen] = useState(phase.started || false);
  const [confirm, setConfirm] = useState(null);
  const [showClean, setShowClean] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoView, setPhotoView] = useState(null);
  const fileRef = useRef(null);

  const { duration, warnings, normalTasks } = parsePhaseData(phase.tasks);
  const allTasks = [...normalTasks, ...(phase.extra_tasks || [])];
  const completed = phase.completed_tasks || [];
  const pct = allTasks.length > 0 ? Math.round((completed.length / allTasks.length) * 100) : 0;

  const toggleTask = async (task) => {
    const isCompleted = completed.includes(task);
    if (isCompleted) {
      setConfirm({ task });
      return;
    }
    await doToggle(task, false);
  };

  const doToggle = async (task, unchecking) => {
    const newCompleted = unchecking
      ? completed.filter((t) => t !== task)
      : [...completed, task];

    const audit = [
      ...(phase.audit || []),
      {
        task,
        action: unchecking ? 'unchecked' : 'checked',
        user: managerName,
        time: new Date().toISOString(),
      },
    ];

    const started = !phase.started ? true : phase.started;

    const { data, error } = await supabase
      .from('job_phases')
      .update({ completed_tasks: newCompleted, audit, started, updated_at: new Date().toISOString() })
      .eq('id', phase.id)
      .select()
      .single();

    if (!error) {
      // Log to task_audit table
      await supabase.from('task_audit').insert([{
        job_id: jobId,
        phase: phase.phase,
        task_text: task,
        action: unchecking ? 'unchecked' : 'checked',
        user_name: managerName,
        created_at: new Date().toISOString(),
      }]);
      onUpdate(data);
    }
    setConfirm(null);
  };

  const addExtraTask = async () => {
    if (!newTask.trim()) return;
    const extra = [...(phase.extra_tasks || []), newTask.trim()];
    const { data } = await supabase.from('job_phases').update({ extra_tasks: extra }).eq('id', phase.id).select().single();
    if (data) onUpdate(data);
    setNewTask('');
  };

  const handlePhotoUpload = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = [];
      for (const file of Array.from(files)) {
        const url = await uploadPhoto(supabase, file, 'job-photos', `phases/${phase.id}`);
        urls.push(url);
      }
      const newPhotos = [...(phase.photos || []), ...urls];
      const { data } = await supabase.from('job_phases').update({ photos: newPhotos }).eq('id', phase.id).select().single();
      if (data) onUpdate(data);
    } finally {
      setUploading(false);
    }
  };

  const handleCleanSave = async (status, photos) => {
    const { data } = await supabase.from('job_phases').update({ clean: status }).eq('id', phase.id).select().single();
    if (data) onUpdate(data);
    setShowClean(false);
  };

  const handlePhaseComplete = async () => {
    await supabase.from('notifications').insert([{
      job_id: jobId,
      message: `✅ Phase "${phase.phase}" completed at ${jobAddress}`,
      created_at: new Date().toISOString(),
      seen: false,
    }]);
    onToast?.({ type: 'success', message: `Phase "${phase.phase}" marked complete!` });
  };

  return (
    <>
      {confirm && (
        <ConfirmModal
          message={`Uncheck "${confirm.task}"? This will be logged.`}
          onConfirm={() => doToggle(confirm.task, true)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {showClean && <CleanCheckModal phase={phase} onSave={handleCleanSave} onClose={() => setShowClean(false)} />}
      {photoView && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" onClick={() => setPhotoView(null)}>
          <img src={photoView} alt="" className="max-w-full max-h-full object-contain" />
          <button onClick={() => setPhotoView(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/20 text-white"><X className="w-6 h-6" /></button>
        </div>
      )}

      <div className={`rounded-2xl border overflow-hidden shadow-sm transition-all ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} ${pct === 100 ? 'border-l-4 border-l-omega-success' : ''}`}>
        <button type="button" onClick={() => setOpen(!open)} className={`w-full flex items-center justify-between px-4 py-4 ${darkMode ? 'hover:bg-gray-750' : 'hover:bg-gray-50'} transition-colors`}>
          <div className="flex items-center gap-3">
            <ProgressRing pct={pct} size={44} stroke={3} />
            <div className="text-left">
              <p className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-omega-charcoal'}`}>{phase.phase}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <p className="text-xs text-omega-stone">{completed.length}/{allTasks.length} tasks</p>
                {duration && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-omega-stone bg-gray-100 px-1.5 py-0.5 rounded-full">
                    <Clock className="w-2.5 h-2.5" />{duration}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {phase.clean && (
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${phase.clean === 'yes' ? 'bg-green-100' : 'bg-red-100'}`}>
                {phase.clean === 'yes' ? <CheckCircle className="w-3.5 h-3.5 text-omega-success" /> : <AlertTriangle className="w-3.5 h-3.5 text-omega-danger" />}
              </div>
            )}
            <ChevronDown className={`w-5 h-5 text-omega-stone transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {open && (
          <div className={`px-4 pb-4 border-t ${darkMode ? 'border-gray-700 bg-gray-850' : 'border-gray-100 bg-omega-cloud'}`}>
            {/* CT Warnings from Omega AI */}
            {warnings.length > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />CT Code / Safety Alerts
                </p>
                <div className="space-y-1.5">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-800 leading-snug">• {w}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks */}
            <div className="pt-3 space-y-2">
              {allTasks.map((task, i) => {
                const done = completed.includes(task);
                return (
                  <button key={i} type="button" onClick={() => toggleTask(task)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${done ? 'bg-green-50 border border-green-200' : darkMode ? 'bg-gray-700 border border-gray-600 hover:border-omega-orange/40' : 'bg-white border border-gray-200 hover:border-omega-orange/40'}`}>
                    {done ? <CheckSquare className="w-5 h-5 text-omega-success flex-shrink-0" /> : <Square className="w-5 h-5 text-omega-fog flex-shrink-0" />}
                    <span className={`text-sm flex-1 text-left ${done ? 'line-through text-omega-stone' : darkMode ? 'text-white' : 'text-omega-charcoal'}`}>{task}</span>
                  </button>
                );
              })}
            </div>

            {/* Add Task */}
            <div className="flex gap-2 mt-3">
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExtraTask()}
                placeholder="Add task..."
                className={`flex-1 px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:border-omega-orange transition-colors ${darkMode ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-200 text-omega-charcoal placeholder-omega-fog'}`} />
              <button onClick={addExtraTask} className="p-2.5 rounded-xl bg-omega-orange text-white hover:bg-omega-dark transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Audit Trail */}
            {phase.audit && phase.audit.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-2">Audit Trail</p>
                <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-hide">
                  {[...phase.audit].reverse().slice(0, 10).map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-omega-stone">
                      {entry.action === 'checked' ? <CheckCircle className="w-3 h-3 text-omega-success flex-shrink-0" /> : <X className="w-3 h-3 text-omega-danger flex-shrink-0" />}
                      <span className="font-medium text-omega-slate">{entry.user}</span>
                      <span>{entry.action}</span>
                      <span className="truncate flex-1">{entry.task}</span>
                      <span className="text-omega-fog flex-shrink-0">{new Date(entry.time).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Photos + Clean */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoUpload(e.target.files)} />
              <button onClick={() => { fileRef.current.setAttribute('capture', 'environment'); fileRef.current.click(); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-omega-stone hover:border-omega-orange hover:text-omega-orange transition-colors text-xs font-medium">
                {uploading ? <LoadingSpinner size={14} /> : <Camera className="w-4 h-4" />}
                Photo
              </button>
              <button onClick={() => setShowClean(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-omega-stone hover:border-omega-orange hover:text-omega-orange transition-colors text-xs font-medium">
                <ClipboardCheck className="w-4 h-4" />
                Clean Check
              </button>
            </div>

            {/* Phase Complete button — only when 100% */}
            {pct === 100 && (
              <button
                onClick={handlePhaseComplete}
                className="w-full flex items-center justify-center gap-2 mt-2 py-3 rounded-xl bg-omega-success text-white text-sm font-bold hover:bg-green-700 transition-colors shadow-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Phase Complete
              </button>
            )}

            {/* WhatsApp Sub */}
            {subInfo && (() => {
              const waUrl = buildSubWhatsApp(subInfo.sub_phone, subInfo.sub_name, phase.phase, phase.tasks, jobAddress);
              return waUrl ? (
                <a href={waUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 mt-2 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors">
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp {subInfo.sub_name}
                </a>
              ) : null;
            })()}

            {/* Photo thumbnails */}
            {phase.photos && phase.photos.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                {phase.photos.map((url, i) => (
                  <button key={i} onClick={() => setPhotoView(url)} className="aspect-square rounded-lg overflow-hidden">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main PhaseBoard Screen ───────────────────────────────────────────────────
export default function PhaseBoard({ job, initialPhases, user, onNavigate, darkMode }) {
  const [phases, setPhases] = useState(initialPhases);
  const [loading, setLoading] = useState(initialPhases.length === 0);
  const [toast, setToast] = useState(null);
  const [subsMap, setSubsMap] = useState({});

  useEffect(() => {
    if (initialPhases.length === 0) {
      initializePhases();
    }
    loadSubs();
  }, []);

  async function loadSubs() {
    const { data } = await supabase.from('job_subs').select('*').eq('job_id', job.id);
    const map = {};
    (data || []).forEach((s) => { map[s.phase] = s; });
    setSubsMap(map);
  }

  async function initializePhases() {
    const templates = getPhasesForService(job.service);
    const rows = templates.map((t, i) => ({
      job_id: job.id,
      phase: t.phase,
      phase_index: i,
      tasks: t.tasks,
      extra_tasks: [],
      completed_tasks: [],
      photos: [],
      started: false,
      audit: [],
      clean: null,
      updated_at: new Date().toISOString(),
    }));

    const { data } = await supabase.from('job_phases').insert(rows).select();
    if (data) setPhases(data);
    setLoading(false);
  }

  const handlePhaseUpdate = (updated) => {
    setPhases((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setToast({ type: 'success', message: 'Saved' });
  };

  const totalTasks = phases.reduce((s, p) => {
    const normal = (p.tasks || []).filter((t) => !t.startsWith('__duration__') && !t.startsWith('__warning__'));
    return s + normal.length + (p.extra_tasks || []).length;
  }, 0);
  const doneTasks = phases.reduce((s, p) => s + (p.completed_tasks || []).length, 0);
  const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  if (loading) return (
    <div className={`min-h-screen flex items-center justify-center ${darkMode ? 'bg-gray-900' : 'bg-omega-cloud'}`}>
      <LoadingSpinner size={40} />
    </div>
  );

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-gray-900' : 'bg-omega-cloud'}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="bg-omega-charcoal px-5 pt-12 pb-5">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => onNavigate('dashboard')} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <p className="text-omega-fog text-xs">{job.service}</p>
            <h1 className="text-white font-bold text-base">{job.client_name}</h1>
          </div>
          <ProgressRing pct={overallPct} size={52} />
        </div>
        <p className="text-omega-stone text-xs">{job.address}</p>
      </div>

      <div className="px-4 py-5 space-y-3">
        {phases.map((phase) => (
          <PhaseCard
            key={phase.id}
            phase={phase}
            jobId={job.id}
            managerName={user.name}
            onUpdate={handlePhaseUpdate}
            darkMode={darkMode}
            subInfo={subsMap[phase.phase] || null}
            jobAddress={job.address}
            onToast={setToast}
          />
        ))}
      </div>

      <div className="px-4 pb-6">
        <button
          onClick={() => onNavigate('punch-list')}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-omega-orange/40 text-omega-orange text-sm font-semibold hover:border-omega-orange hover:bg-omega-pale transition-all"
        >
          <ClipboardCheck className="w-5 h-5" />
          View Punch List
        </button>
      </div>
    </div>
  );
}
