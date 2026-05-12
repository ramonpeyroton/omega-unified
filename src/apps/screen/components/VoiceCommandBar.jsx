import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, MicOff, X, Loader2, AlertTriangle, FileText, FileSignature,
  DollarSign, HardHat, Calendar,
} from 'lucide-react';
import { supabase } from '../../../shared/lib/supabase';
import { parseVoiceIntent } from '../../../shared/lib/groq';

// ─── Ambient voice assistant for the TV dashboard ──────────────
// Two modes coexist:
//   1. WAKE WORD (Chrome desktop): continuous Web Speech recognition
//      listening for "Omegatron". When the wake word lands, we
//      buffer the trailing command, wait for a silent pause, then
//      send the command to Groq for intent parsing.
//   2. MANUAL INPUT (Firestick / fallback): the bottom of the bar
//      exposes a focusable text field — the Alexa keyboard writes
//      the transcript into it and we auto-submit on detected paste.
// Both paths converge on `runIntent({ action, target, filter })`
// which fans out to Supabase queries and renders the result card.
//
// Notes:
//   * Groq key comes from VITE_GROQ_API_KEY (same env var Jarvis uses).
//   * Mic permission needs HTTPS — works on Vercel deploys, not on
//     plain file:// loads.

// Same wake-word variants as the standalone POC. Normalize() below
// strips accents so "ômegatron" still matches "omegatron".
const WAKE_WORDS = [
  'omegatron', 'omega tron', 'ômega tron',
  'ô megatron', 'ô mega tron', 'mega tron',
];

const POST_DETECTION_COOLDOWN_MS = 3000;
const SILENCE_TIMEOUT_MS = 1600;
const MAX_BUFFER_MS = 8000;
const MIN_WORDS_TO_FIRE = 1;
const VOICE_JUMP_THRESHOLD = 8;       // chars added in one event
const AUTO_SUBMIT_DELAY_MS = 900;     // pause before firing manual input

// pt-BR Chrome mangles English construction terms. Pre-translate the
// most common mis-hearings to their Portuguese canonical form before
// sending to Groq.
const TRANSCRIPTION_FIXES = [
  { from: /\b(smate|estima|estimat|estimete|esteimate|estimeite|stimate|stime|s mate)\b/gi, to: 'orcamento' },
  { from: /\b(estimate)\b/gi, to: 'orcamento' },
  { from: /\b(contract|contracto|contracts)\b/gi, to: 'contrato' },
  { from: /\b(invoice|involce|in voice)\b/gi, to: 'fatura' },
  { from: /\b(deshboard|desh board|deshibord)\b/gi, to: 'dashboard' },
  { from: /\b(pipe line|piplaine|paipalain)\b/gi, to: 'pipeline' },
];

// ─── Helpers ──────────────────────────────────────────────────
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function findWakeWord(normalizedText) {
  for (const w of WAKE_WORDS) {
    const nw = normalize(w);
    const i = normalizedText.indexOf(nw);
    if (i >= 0) return { index: i, word: nw };
  }
  return null;
}

function extractCommand(raw) {
  const norm = normalize(raw);
  const match = findWakeWord(norm);
  if (!match) return '';
  let tail = norm.slice(match.index + match.word.length).trim();
  tail = tail.replace(/^(e |ai |olha |por favor |por favor, |pf |faz |faça )/g, '').trim();
  for (const { from, to } of TRANSCRIPTION_FIXES) tail = tail.replace(from, to);
  return tail;
}

// Map a Groq intent into one of the local query "kinds" the result
// card already knows how to render. Returns null when the intent is
// "unknown" or has no usable target.
function intentToQuery(intent) {
  if (!intent || intent.action === 'unknown' || intent.confidence === 'low') return null;
  const { action, target, filter } = intent;
  const client = filter?.client || filter?.name;

  if (action === 'show_document') {
    if (target === 'estimate' && client) return { kind: 'estimate_for', name: client };
    if (target === 'contract' && client) return { kind: 'contract_for', name: client };
    if (target === 'invoice'  && client) return { kind: 'invoice_for',  name: client };
    if (client) return { kind: 'client_summary', name: client };
  }
  if (action === 'query') {
    if (target === 'jobs_count' || target === 'jobs') return { kind: 'today_jobs' };
    if (target === 'overdue' || target === 'overdue_payments') return { kind: 'overdue_payments' };
    if (target === 'receivable_total' || target === 'receivable') return { kind: 'receivable_total' };
  }
  if (action === 'navigate') {
    // The Screen role is read-only — we can't actually navigate to
    // other apps. We surface a friendly "navigation requested" card
    // so the user knows the voice was heard, but can't act on it.
    return { kind: 'navigate_unavailable', target: target || 'screen' };
  }
  return null;
}

// ─── Supabase fetchers (unchanged shapes feeding the ResultCard) ──
async function findClientJobs(nameQuery) {
  const tokens = normalize(nameQuery).split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const { data } = await supabase
    .from('jobs')
    .select('id, client_name, address, city, service, pipeline_status, salesperson_name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(400);
  return (data || []).filter((j) => {
    const hay = normalize(j.client_name || '');
    return tokens.every((t) => hay.includes(t));
  }).slice(0, 5);
}

// ════════════════════════════════════════════════════════════════
// Component
// ════════════════════════════════════════════════════════════════
export default function VoiceCommandBar() {
  // ─── State ─────────────────────────────────────────────────────
  const [voiceState, setVoiceState] = useState('idle'); // idle | listening | wake | parsing | done | error
  const [voiceMicAllowed, setVoiceMicAllowed] = useState(false);
  const [voiceWebSupported, setVoiceWebSupported] = useState(true);
  const [transcript, setTranscript] = useState({ final: '', interim: '' });
  const [currentCommand, setCurrentCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [manualText, setManualText] = useState('');
  const [autoStatus, setAutoStatus] = useState(null);

  // Refs (state that doesn't trigger re-renders)
  const recognitionRef = useRef(null);
  const recognitionShouldRunRef = useRef(false);
  const lastDetectionAtRef = useRef(0);
  const bufferingRef = useRef(false);
  const bufferedCommandRef = useRef('');
  const silenceTimerRef = useRef(null);
  const maxWaitTimerRef = useRef(null);
  const restartingAfterFireRef = useRef(false);
  const manualInputRef = useRef(null);
  const prevManualLenRef = useRef(0);
  const autoSubmitTimerRef = useRef(null);
  const clearResultTimerRef = useRef(null);

  // ─── Auto-clear result after 45s ──────────────────────────────
  useEffect(() => {
    if (clearResultTimerRef.current) clearTimeout(clearResultTimerRef.current);
    if (!result) return;
    clearResultTimerRef.current = setTimeout(() => setResult(null), 45_000);
    return () => clearTimeout(clearResultTimerRef.current);
  }, [result]);

  // ─── runIntent: query Supabase + render the result card ───────
  const runIntent = useCallback(async (rawText, intent) => {
    const query = intentToQuery(intent);
    if (!query) {
      setResult({ kind: 'unknown', text: rawText, intent });
      return;
    }
    setRunning(true);
    try {
      if (query.kind === 'estimate_for' || query.kind === 'contract_for' || query.kind === 'invoice_for' || query.kind === 'client_summary') {
        const jobs = await findClientJobs(query.name);
        if (jobs.length === 0) { setResult({ kind: 'not_found', name: query.name }); return; }
        if (jobs.length > 1)   { setResult({ kind: 'ambiguous', jobs, name: query.name }); return; }
        const job = jobs[0];

        if (query.kind === 'estimate_for') {
          const { data: est } = await supabase.from('estimates').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
          setResult({ kind: 'estimate', job, est });
        } else if (query.kind === 'contract_for') {
          const { data: ctr } = await supabase.from('contracts').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
          setResult({ kind: 'contract', job, ctr });
        } else if (query.kind === 'invoice_for') {
          // Most recent paid/sent milestone for the job.
          const { data: contracts } = await supabase.from('contracts').select('id').eq('job_id', job.id);
          const ids = (contracts || []).map((c) => c.id);
          const { data: milestones } = ids.length
            ? await supabase.from('payment_milestones').select('*').in('contract_id', ids).order('order_idx', { ascending: true })
            : { data: [] };
          setResult({ kind: 'invoice', job, milestones: milestones || [] });
        } else {
          const [{ data: est }, { data: ctr }] = await Promise.all([
            supabase.from('estimates').select('id, status, total_amount, signed_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('contracts').select('id, status, total_amount, signed_at, sent_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          ]);
          setResult({ kind: 'client', job, est, ctr });
        }
        return;
      }

      if (query.kind === 'today_jobs') {
        const { data } = await supabase.from('jobs').select('id, client_name, address, city, pipeline_status, pm_name').in('pipeline_status', ['in_progress', 'in-progress']).order('updated_at', { ascending: false }).limit(20);
        setResult({ kind: 'today_jobs', rows: data || [] });
        return;
      }
      if (query.kind === 'overdue_payments') {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const { data } = await supabase.from('payment_milestones').select('id, label, due_amount, received_amount, due_date, job_id, status').neq('status', 'paid').order('due_date', { ascending: true }).limit(50);
        const overdue = (data || []).filter((m) => { if (!m.due_date) return false; const d = new Date(m.due_date); d.setHours(0,0,0,0); return d < today; });
        const jobIds = [...new Set(overdue.map((m) => m.job_id).filter(Boolean))];
        const { data: jobs } = jobIds.length ? await supabase.from('jobs').select('id, client_name').in('id', jobIds) : { data: [] };
        const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
        const total = overdue.reduce((s, m) => s + Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0)), 0);
        setResult({ kind: 'overdue', rows: overdue, jobsById, total });
        return;
      }
      if (query.kind === 'receivable_total') {
        const { data } = await supabase.from('payment_milestones').select('due_amount, received_amount, status');
        const total = (data || []).reduce((s, m) => m.status === 'paid' ? s : s + Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0)), 0);
        setResult({ kind: 'receivable_total', total });
        return;
      }
      if (query.kind === 'navigate_unavailable') {
        setResult({ kind: 'navigate_unavailable', target: query.target });
        return;
      }
    } catch (err) {
      console.error('[voice] runIntent error', err);
      setResult({ kind: 'error', message: err?.message || 'Lookup failed' });
    } finally {
      setRunning(false);
    }
  }, []);

  // ─── Dispatch a raw command text — parse intent then run ──────
  const dispatchCommand = useCallback(async (rawText) => {
    if (!rawText) return;
    setCurrentCommand(rawText);
    setVoiceState('parsing');
    try {
      const { intent } = await parseVoiceIntent(rawText);
      console.log('[voice] intent', intent);
      setVoiceState('done');
      await runIntent(rawText, intent);
    } catch (err) {
      console.error('[voice] parse error', err);
      setVoiceState('error');
      setResult({ kind: 'error', message: err?.message || 'Parse failed' });
    } finally {
      // Drop back to listening after a short hold so the user can read
      // the result before the mic gets hot again.
      setTimeout(() => setVoiceState((s) => (s === 'parsing' || s === 'wake' ? s : (recognitionShouldRunRef.current ? 'listening' : 'idle'))), 2500);
    }
  }, [runIntent]);

  // ─── Wake-word + buffering pipeline ─────────────────────────
  const resetBuffer = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (maxWaitTimerRef.current) { clearTimeout(maxWaitTimerRef.current); maxWaitTimerRef.current = null; }
    bufferingRef.current = false;
    bufferedCommandRef.current = '';
  }, []);

  const resetRecognitionState = useCallback(() => {
    if (!recognitionRef.current) return;
    restartingAfterFireRef.current = true;
    try { recognitionRef.current.abort(); } catch {}
    setTranscript({ final: '', interim: '' });
  }, []);

  const fireBufferedCommand = useCallback((reason) => {
    const command = bufferedCommandRef.current.trim();
    console.log(`[voice] fire reason=${reason} command="${command}"`);
    resetBuffer();
    resetRecognitionState();
    if (!command) { if (recognitionShouldRunRef.current) setVoiceState('listening'); return; }
    const wordCount = command.split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS_TO_FIRE) { if (recognitionShouldRunRef.current) setVoiceState('listening'); return; }
    lastDetectionAtRef.current = Date.now();
    dispatchCommand(command);
  }, [dispatchCommand, resetBuffer, resetRecognitionState]);

  const handleRecognitionResult = useCallback((event) => {
    let finalText = '', interimText = '';
    for (let i = 0; i < event.results.length; i++) {
      const r = event.results[i];
      const t = r[0]?.transcript || '';
      if (r.isFinal) finalText += t + ' '; else interimText += t + ' ';
    }
    finalText = finalText.trim();
    interimText = interimText.trim();
    setTranscript({ final: finalText, interim: interimText });

    const combined = (finalText + ' ' + interimText).trim();
    const norm = normalize(combined);
    const wake = findWakeWord(norm);
    if (!wake) return;

    const sinceLast = Date.now() - lastDetectionAtRef.current;
    if (sinceLast < POST_DETECTION_COOLDOWN_MS) return;

    if (!bufferingRef.current) {
      bufferingRef.current = true;
      setVoiceState('wake');
      maxWaitTimerRef.current = setTimeout(() => fireBufferedCommand('max-wait'), MAX_BUFFER_MS);
    }
    const fresh = extractCommand(combined).trim();
    if (fresh && fresh !== bufferedCommandRef.current) {
      bufferedCommandRef.current = fresh;
      setCurrentCommand(fresh);
    }
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => fireBufferedCommand('silence'), SILENCE_TIMEOUT_MS);
    if (finalText && findWakeWord(normalize(finalText))) fireBufferedCommand('final');
  }, [fireBufferedCommand]);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceWebSupported(false); return; }
    if (!recognitionRef.current) {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'pt-BR';
      rec.onstart  = () => { console.log('[voice] start'); setVoiceMicAllowed(true); if (recognitionShouldRunRef.current) setVoiceState('listening'); };
      rec.onresult = handleRecognitionResult;
      rec.onerror  = (ev) => {
        console.warn('[voice] error', ev.error);
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          recognitionShouldRunRef.current = false;
          setVoiceMicAllowed(false);
          setVoiceState('error');
        }
      };
      rec.onend = () => {
        console.log('[voice] end' + (restartingAfterFireRef.current ? ' (after fire)' : ''));
        if (recognitionShouldRunRef.current) {
          restartingAfterFireRef.current = false;
          try { rec.start(); } catch (e) { setTimeout(() => { try { rec.start(); } catch {} }, 250); }
        } else {
          restartingAfterFireRef.current = false;
          setVoiceState('idle');
        }
      };
      recognitionRef.current = rec;
    }
    recognitionShouldRunRef.current = true;
    try { recognitionRef.current.start(); } catch {}
  }, [handleRecognitionResult]);

  const stopListening = useCallback(() => {
    recognitionShouldRunRef.current = false;
    resetBuffer();
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch {}
    setVoiceState('idle');
  }, [resetBuffer]);

  // ─── Auto-start wake listening on mount (TV expects ambient) ──
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceWebSupported(false); return; }
    startListening();
    return () => { recognitionShouldRunRef.current = false; if (recognitionRef.current) try { recognitionRef.current.abort(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Manual input fallback (Firestick / no-mic devices) ───────
  function onManualChange(ev) {
    const next = ev.target.value;
    const delta = next.length - prevManualLenRef.current;
    prevManualLenRef.current = next.length;
    setManualText(next);
    if (delta >= VOICE_JUMP_THRESHOLD && next.trim()) {
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
      setAutoStatus('listening');
      autoSubmitTimerRef.current = setTimeout(() => {
        autoSubmitTimerRef.current = null;
        setAutoStatus(null);
        manualSubmit();
      }, AUTO_SUBMIT_DELAY_MS);
    } else if (delta <= 0) {
      if (autoSubmitTimerRef.current) { clearTimeout(autoSubmitTimerRef.current); autoSubmitTimerRef.current = null; setAutoStatus(null); }
    }
  }
  function manualSubmit(ev) {
    ev?.preventDefault();
    const v = (manualText || '').trim();
    if (!v) return;
    // Allow a manual command with OR without wake word — strip wake if present.
    const norm = normalize(v);
    const wake = findWakeWord(norm);
    const cmd = wake ? extractCommand(v) : v;
    setManualText('');
    prevManualLenRef.current = 0;
    setAutoStatus(null);
    dispatchCommand(cmd);
  }

  function dismiss() {
    setResult(null);
    setCurrentCommand('');
    setTranscript({ final: '', interim: '' });
    if (recognitionShouldRunRef.current) setVoiceState('listening');
    else setVoiceState('idle');
  }

  // ─── Render ───────────────────────────────────────────────────
  const stateStyle = (() => {
    switch (voiceState) {
      case 'listening': return { color: '#22c55e', label: 'Ouvindo — diga "Omegatron…"', emoji: '🟢' };
      case 'wake':      return { color: '#f97316', label: 'Capturando comando…', emoji: '🎤' };
      case 'parsing':   return { color: '#3b82f6', label: 'Processando…', emoji: '💭' };
      case 'done':      return { color: '#22c55e', label: 'Pronto', emoji: '✅' };
      case 'error':     return { color: '#ef4444', label: 'Erro', emoji: '❌' };
      default:          return { color: '#8b95b8', label: 'Inativo', emoji: '⚪' };
    }
  })();

  return (
    <div className="relative">
      {/* Compact status strip — narrow, doesn't dominate the dashboard. */}
      <div className="px-6 py-2 flex items-center gap-3 bg-black/30 backdrop-blur border-b border-white/[0.06] text-white">
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex w-2 h-2 rounded-full ${voiceState === 'listening' ? 'animate-pulse' : ''}`} style={{ background: stateStyle.color }} />
          <span style={{ color: stateStyle.color }} className="font-semibold tracking-wider uppercase text-[10px]">
            {stateStyle.label}
          </span>
        </div>

        {currentCommand && voiceState !== 'idle' && voiceState !== 'listening' && (
          <div className="flex-1 min-w-0 text-sm truncate text-white/80">
            "<span className="text-white font-semibold">{currentCommand}</span>"
          </div>
        )}

        {!currentCommand && transcript.interim && (
          <div className="flex-1 min-w-0 text-sm truncate text-white/40 italic">
            {transcript.interim}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!voiceWebSupported && (
            <span className="text-[10px] text-white/40 uppercase tracking-wider">Web Speech indisponível</span>
          )}
          {voiceWebSupported && (
            <button
              onClick={() => recognitionShouldRunRef.current ? stopListening() : startListening()}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/10"
              title={recognitionShouldRunRef.current ? 'Parar de ouvir' : 'Começar a ouvir'}
            >
              {recognitionShouldRunRef.current ? <><MicOff className="w-3 h-3" /> Stop</> : <><Mic className="w-3 h-3" /> Listen</>}
            </button>
          )}

          {/* Manual input — small, only shows when expanded or no mic */}
          <form onSubmit={manualSubmit} className="flex items-center gap-1">
            <input
              ref={manualInputRef}
              value={manualText}
              onChange={onManualChange}
              placeholder='ou digite: "abre o orçamento da Yulia"'
              className={`w-64 px-3 py-1 rounded-md bg-white/5 border ${autoStatus ? 'border-omega-orange' : 'border-white/10 focus:border-omega-orange'} text-[12px] text-white placeholder:text-white/30 focus:outline-none transition-colors`}
            />
            {autoStatus && <Loader2 className="w-3 h-3 animate-spin text-omega-orange" />}
          </form>
        </div>
      </div>

      {/* Result overlay — full-width card hanging below the strip. */}
      {result && (
        <div className="absolute inset-x-4 top-12 z-40">
          <ResultCard result={result} running={running} onDismiss={dismiss} />
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ResultCard — TV-optimized large readable result display
// ════════════════════════════════════════════════════════════════
function ResultCard({ result, running, onDismiss }) {
  const baseCls = 'relative rounded-3xl bg-white text-omega-charcoal shadow-2xl p-6';
  const close = (
    <button onClick={onDismiss} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 inline-flex items-center justify-center text-omega-stone">
      <X className="w-4 h-4" />
    </button>
  );

  if (running) {
    return (
      <div className={baseCls}>
        {close}
        <div className="flex items-center gap-3"><Loader2 className="w-5 h-5 animate-spin text-omega-orange" /><p className="text-base font-semibold">Buscando…</p></div>
      </div>
    );
  }

  if (result.kind === 'unknown') {
    return (
      <div className={`${baseCls} bg-amber-50`}>
        {close}
        <AlertTriangle className="w-6 h-6 text-amber-600 mb-2" />
        <p className="text-xl font-bold">Não entendi.</p>
        <p className="text-sm text-omega-stone mt-1">Heard: "{result.text}"</p>
        <p className="text-sm text-omega-stone mt-3">Tente: <em>"abre o orçamento da Yulia"</em>, <em>"obras de hoje"</em>, <em>"pagamentos atrasados"</em>, <em>"total a receber"</em>.</p>
      </div>
    );
  }
  if (result.kind === 'not_found')  return (<div className={`${baseCls} bg-red-50`}>{close}<p className="text-xl font-bold text-red-900">Cliente não encontrado: "{result.name}"</p><p className="text-sm text-red-800/70 mt-1">Tente o primeiro nome ou verifique a grafia.</p></div>);
  if (result.kind === 'ambiguous')  return (<div className={baseCls}>{close}<p className="text-xl font-bold">Múltiplos clientes com "{result.name}"</p><ul className="mt-3 space-y-1 text-base">{result.jobs.map((j) => <li key={j.id}>• {j.client_name} <span className="text-omega-stone text-sm">— {j.address || j.city || '—'}</span></li>)}</ul></div>);
  if (result.kind === 'error')      return (<div className={`${baseCls} bg-red-50`}>{close}<p className="text-xl font-bold text-red-900">Erro</p><p className="text-sm text-red-800/70 mt-1">{result.message}</p></div>);
  if (result.kind === 'navigate_unavailable') return (<div className={`${baseCls} bg-blue-50`}>{close}<p className="text-xl font-bold text-blue-900">Navegação requested: {result.target}</p><p className="text-sm text-blue-800/70 mt-1">Screen mode is read-only. Use a sales/admin device to navigate.</p></div>);

  if (result.kind === 'estimate') {
    const { job, est } = result;
    return (
      <div className={baseCls}>{close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center"><FileText className="w-5 h-5 text-omega-orange" /></div>
          <div><p className="text-3xl font-bold leading-none">{job.client_name}</p><p className="text-sm text-omega-stone mt-1">{job.address || job.city || '—'}</p></div>
        </div>
        {est ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <KpiBlock label="Estimate #" value={est.estimate_number ? `OM-${est.estimate_number}` : 'OM-—'} />
            <KpiBlock label="Total" value={money(est.total_amount)} accent />
            <KpiBlock label="Status" value={(est.status || '—').toUpperCase()} />
            <KpiBlock label="Created" value={fmtDate(est.created_at)} />
            <KpiBlock label="Sent" value={fmtDate(est.sent_at)} />
            <KpiBlock label="Signed" value={est.signed_at ? fmtDate(est.signed_at) : '—'} />
          </div>
        ) : <p className="text-base text-omega-stone mt-4">Sem orçamento para este cliente.</p>}
      </div>
    );
  }
  if (result.kind === 'contract') {
    const { job, ctr } = result;
    return (
      <div className={baseCls}>{close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center"><FileSignature className="w-5 h-5 text-omega-orange" /></div>
          <div><p className="text-3xl font-bold leading-none">{job.client_name}</p><p className="text-sm text-omega-stone mt-1">{job.address || job.city || '—'}</p></div>
        </div>
        {ctr ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <KpiBlock label="Total" value={money(ctr.total_amount)} accent />
            <KpiBlock label="Deposit" value={money(ctr.deposit_amount)} />
            <KpiBlock label="Status" value={(ctr.status || '—').toUpperCase()} />
            <KpiBlock label="Sent" value={fmtDate(ctr.sent_at)} />
            <KpiBlock label="Signed" value={ctr.signed_at ? fmtDate(ctr.signed_at) : '—'} />
            <KpiBlock label="DocuSign" value={(ctr.docusign_status || '—').toUpperCase()} />
          </div>
        ) : <p className="text-base text-omega-stone mt-4">Sem contrato.</p>}
      </div>
    );
  }
  if (result.kind === 'invoice') {
    const { job, milestones } = result;
    const total = milestones.reduce((s, m) => s + (Number(m.due_amount) || 0), 0);
    const received = milestones.reduce((s, m) => s + (Number(m.received_amount) || 0), 0);
    const balance = total - received;
    return (
      <div className={baseCls}>{close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center"><DollarSign className="w-5 h-5 text-omega-orange" /></div>
          <div><p className="text-3xl font-bold leading-none">{job.client_name}</p><p className="text-sm text-omega-stone mt-1">{job.address || '—'}</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <KpiBlock label="Total" value={money(total)} accent />
          <KpiBlock label="Recebido" value={money(received)} />
          <KpiBlock label="Saldo" value={money(balance)} />
        </div>
        <p className="text-xs text-omega-stone mt-3">{milestones.length} parcela{milestones.length === 1 ? '' : 's'}</p>
      </div>
    );
  }
  if (result.kind === 'client') {
    const { job, est, ctr } = result;
    return (
      <div className={baseCls}>{close}
        <p className="text-3xl font-bold leading-none">{job.client_name}</p>
        <p className="text-sm text-omega-stone mt-1">{job.address || job.city || '—'}{job.service && ` · ${job.service}`}{job.salesperson_name && ` · ${job.salesperson_name}`}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <KpiBlock label="Última Estimate" value={est?.total_amount ? money(est.total_amount) : '—'} sub={est?.signed_at ? `Signed ${fmtDate(est.signed_at)}` : (est?.status || '').toUpperCase()} accent={!!est?.signed_at} />
          <KpiBlock label="Contrato" value={ctr?.total_amount ? money(ctr.total_amount) : '—'} sub={ctr?.signed_at ? `Signed ${fmtDate(ctr.signed_at)}` : (ctr?.status || '').toUpperCase()} accent={!!ctr?.signed_at} />
          <KpiBlock label="Pipeline" value={(job.pipeline_status || '—').replace(/_/g, ' ').toUpperCase()} />
        </div>
      </div>
    );
  }
  if (result.kind === 'today_jobs') {
    return (
      <div className={baseCls}>{close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center"><HardHat className="w-5 h-5 text-omega-orange" /></div>
          <p className="text-3xl font-bold leading-none">Obras ativas · {result.rows.length}</p>
        </div>
        {result.rows.length === 0 ? <p className="text-base text-omega-stone mt-3">Nenhuma obra em andamento.</p> : (
          <ul className="mt-4 grid grid-cols-2 gap-2 text-base">
            {result.rows.slice(0, 10).map((j) => (
              <li key={j.id} className="px-4 py-2 rounded-xl bg-omega-cloud">
                <p className="font-bold">{j.client_name}</p>
                <p className="text-xs text-omega-stone">{j.address || j.city || '—'}{j.pm_name && ` · PM: ${j.pm_name}`}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (result.kind === 'overdue') {
    return (
      <div className={baseCls}>{close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
          <div><p className="text-3xl font-bold leading-none">Atrasados · {money(result.total)}</p><p className="text-sm text-omega-stone mt-1">{result.rows.length} parcela{result.rows.length === 1 ? '' : 's'} vencida{result.rows.length === 1 ? '' : 's'}</p></div>
        </div>
        {result.rows.length === 0 ? <p className="text-base text-omega-success mt-3">Sem atrasos. 🎉</p> : (
          <ul className="mt-3 space-y-1 text-base">
            {result.rows.slice(0, 6).map((m) => (
              <li key={m.id} className="flex justify-between items-center px-3 py-1.5 rounded bg-red-50">
                <span><strong>{result.jobsById[m.job_id]?.client_name || '—'}</strong> · {m.label}</span>
                <span className="font-bold text-red-700">{money((Number(m.due_amount) || 0) - (Number(m.received_amount) || 0))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (result.kind === 'receivable_total') {
    return (
      <div className={baseCls}>{close}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-700" /></div>
          <p className="text-3xl font-bold leading-none">Total a receber</p>
        </div>
        <p className="text-7xl font-extrabold mt-4 text-omega-charcoal tabular-nums">{money(result.total)}</p>
        <p className="text-sm text-omega-stone mt-2">Soma de todas as parcelas em aberto.</p>
      </div>
    );
  }
  return null;
}

function KpiBlock({ label, value, sub, accent }) {
  return (
    <div className={`px-4 py-3 rounded-xl ${accent ? 'bg-omega-pale border border-omega-orange/30' : 'bg-omega-cloud'}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-omega-stone">{label}</p>
      <p className={`text-2xl font-bold tabular-nums leading-tight mt-1 ${accent ? 'text-omega-orange' : 'text-omega-charcoal'}`}>{value}</p>
      {sub && <p className="text-[10px] text-omega-stone mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
