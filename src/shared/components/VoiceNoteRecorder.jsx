import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Check, X, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/apiFetch.js';

/**
 * One-tap microphone button. Records audio via MediaRecorder, POSTs
 * to `/api/transcribe` (Whisper), and calls `onTranscribed(text)` so
 * the parent can persist it however it wants (e.g. job_notes row).
 *
 * Visual states: idle → recording → transcribing → done/error.
 *
 * Assumes the page is served over HTTPS (required for mic access).
 */
export default function VoiceNoteRecorder({
  onTranscribed,
  language = 'en',       // pass 'pt' for Portuguese-first transcription
  maxSeconds = 120,      // hard cap to protect API cost
  compact = false,       // smaller variant for inline use
}) {
  const [state, setState]       = useState('idle'); // idle | recording | busy | error
  const [errorMsg, setErrorMsg] = useState('');
  const [elapsed, setElapsed]   = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const timerRef         = useRef(null);
  const startedAtRef     = useRef(0);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    clearInterval(timerRef.current);
    timerRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    // Always release the mic stream so the browser drops the red indicator
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }

  async function startRecording() {
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Browsers disagree on which mime is supported. webm/opus is
      // widely available; fall back to default if not.
      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : {};
      const mr = new MediaRecorder(stream, options);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        await finalize(mr.mimeType || 'audio/webm');
      };
      mr.start(250); // small timeslice keeps chunks small
      mediaRecorderRef.current = mr;
      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(secs);
        if (secs >= maxSeconds) stopRecording();
      }, 250);
      setState('recording');
    } catch (err) {
      setErrorMsg(err?.message || 'Microphone access denied');
      setState('error');
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;
    try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    clearInterval(timerRef.current);
    timerRef.current = null;
    setState('busy');
  }

  async function finalize(mimeType) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const form = new FormData();
      form.append('audio', blob, `note-${Date.now()}.webm`);
      if (language) form.append('language', language);

      const r = await apiFetch('/api/transcribe', { method: 'POST', body: form });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error || `HTTP ${r.status}`);

      const text = (data.text || '').trim();
      cleanup();
      setState('idle');
      if (text) onTranscribed?.(text);
    } catch (err) {
      cleanup();
      setErrorMsg(err?.message || 'Transcription failed');
      setState('error');
    }
  }

  const isIdle   = state === 'idle';
  const isRec    = state === 'recording';
  const isBusy   = state === 'busy';
  const isError  = state === 'error';

  const wrapperCls = compact ? 'inline-flex items-center gap-2' : 'flex items-center gap-3';

  if (isRec) {
    return (
      <div className={wrapperCls}>
        <button
          type="button"
          onClick={stopRecording}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-lg shadow-red-600/30 animate-pulse"
          title="Stop & transcribe"
        >
          <Square className="w-4 h-4" fill="currentColor" />
          Recording {formatElapsed(elapsed)}
        </button>
        <span className="text-[11px] text-red-600 font-bold">Tap to stop</span>
      </div>
    );
  }

  if (isBusy) {
    return (
      <div className={wrapperCls}>
        <button type="button" disabled className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-200 text-omega-stone text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin" /> Transcribing…
        </button>
      </div>
    );
  }

  return (
    <div className={wrapperCls}>
      <button
        type="button"
        onClick={startRecording}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-bold"
        title="Record a voice note"
      >
        <Mic className="w-4 h-4" /> {compact ? 'Voice' : 'Voice Note'}
      </button>
      {isError && (
        <span className="inline-flex items-center gap-1 text-xs text-red-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5" /> {errorMsg || 'Error'}
        </span>
      )}
    </div>
  );
}

function formatElapsed(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
