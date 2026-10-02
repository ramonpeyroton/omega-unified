// Office TV (1920×1080) — a slideshow, one area of the company per slide,
// 40 s each: Sales pipeline → This month's calendar → Projects (cost vs
// contract) → Bills to pay. Lives in Ramon's Marketing app at /tv. Only the
// office team sees this screen, so money is shown — except receivables:
// Inácio asked (02/10) that client payments / amounts due never show here,
// so the Receivables slide (./tv/ReceivablesSlide.jsx) and the "payment
// received" toast are off.
//
// The slides live in ./tv/ and share one look through ./tv/tvKit.jsx. This
// file is just the shell: header (logo, slide title, dots, clock), the 40 s
// progress bar, keyboard control, data refresh for every slide (each minute
// + realtime), and live toasts when something good happens (new lead,
// estimate approved, job started, bill paid).
//
// Keys: → / ← next / previous · Space or Enter pause · 1-4 jump to a slide.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Maximize2, Pause, Play, UserPlus, PartyPopper,
  CheckCircle2, HardHat,
} from 'lucide-react';
import logoImg from '../../../assets/logo.png';
import { supabase } from '../../../shared/lib/supabase';
import { useNow, formatNyTime } from '../../../shared/lib/stageAge';
import { TZ, ORANGE, usd, toMs } from './tv/tvKit';
import * as Sales from './tv/SalesSlide';
import * as Calendar from './tv/CalendarSlide';
import * as Projects from './tv/ProjectsSlide';
import * as Bills from './tv/BillsSlide';

const SLIDES = [Sales, Calendar, Projects, Bills];
const SLIDE_MS = 40_000;
const REFRESH_MS = 60_000;
const TOAST_MS = 9_000;
const FRESH_MS = 5 * 60_000; // a realtime update only "counts" if this recent

// ─── Slide timer + progress bar ──────────────────────────────────────
// Owns its own rAF loop and writes the bar width straight to the DOM, so
// the slide underneath doesn't re-render 60×/s. Remounted per slide.
function SlideTimer({ paused, onDone }) {
  const barRef = useRef(null);
  const elapsedRef = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let raf;
    let last = performance.now();
    const tick = (t) => {
      const dt = t - last;
      last = t;
      if (!pausedRef.current) elapsedRef.current += dt;
      const p = Math.min(1, elapsedRef.current / SLIDE_MS);
      if (barRef.current) barRef.current.style.width = `${p * 100}%`;
      if (p >= 1) { doneRef.current(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute left-0 right-0 bottom-0 h-[5px] bg-black/[0.04]">
      <div ref={barRef} className={`h-full ${paused ? 'bg-omega-fog' : 'bg-omega-orange'}`} style={{ width: 0 }} />
    </div>
  );
}

// ─── Live toasts ─────────────────────────────────────────────────────
// Realtime events worth a moment of attention on the TV. Best-effort: a
// table only streams if it's in the supabase_realtime publication
// (jobs is; migrations/082 adds bills).
const TOAST_LOOK = {
  lead:     { icon: UserPlus,     ring: 'bg-indigo-500',  label: 'New lead' },
  approved: { icon: PartyPopper,  ring: 'bg-omega-orange',label: 'Estimate approved', confetti: true },
  started:  { icon: HardHat,      ring: 'bg-emerald-500', label: 'New job in progress', confetti: true },
  billPaid: { icon: CheckCircle2, ring: 'bg-slate-700',   label: 'Bill paid' },
};

function isFresh(iso) {
  const t = toMs(iso);
  return t != null && Date.now() - t < FRESH_MS;
}

function useLiveToasts() {
  const [queue, setQueue] = useState([]);
  const seen = useRef(new Set());

  const push = useCallback((key, toast) => {
    if (seen.current.has(key)) return;
    seen.current.add(key);
    setQueue((q) => [...q, { id: key, ...toast }]);
  }, []);

  useEffect(() => {
    const jobsChan = supabase
      .channel('tv-live-jobs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, ({ new: j }) => {
        if (!j || ['import', 'legacy_import'].includes((j.created_by || '').trim())) return;
        push(`lead:${j.id}`, {
          type: 'lead',
          title: j.client_name || 'New client',
          text: [j.lead_source, j.city].filter(Boolean).join(' · '),
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, ({ new: j }) => {
        if (!j || !isFresh(j.stage_entered_at)) return;
        if (j.pipeline_status === 'estimate_approved') {
          push(`approved:${j.id}`, { type: 'approved', title: j.client_name || 'Client', text: j.service || '' });
        } else if (j.pipeline_status === 'in_progress') {
          push(`started:${j.id}`, { type: 'started', title: j.client_name || 'Client', text: j.service || '' });
        }
      })
      .subscribe();

    const billsChan = supabase
      .channel('tv-live-bills')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bills' }, ({ new: b }) => {
        if (!b || b.status !== 'paid' || !isFresh(b.paid_at)) return;
        push(`bill:${b.id}`, { type: 'billPaid', title: b.label, text: usd(b.paid_amount ?? b.amount) });
      })
      .subscribe();

    return () => {
      [jobsChan, billsChan].forEach((c) => supabase.removeChannel(c));
    };
  }, [push]);

  // Show one at a time.
  const current = queue[0] || null;
  useEffect(() => {
    if (!current) return undefined;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), TOAST_MS);
    return () => clearTimeout(t);
  }, [current]);

  return current;
}

// A short burst of brand-colored confetti behind celebratory toasts.
const CONFETTI_COLORS = [ORANGE, '#10B981', '#6366F1', '#F59E0B', '#F43F5E'];
function Confetti() {
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    x: (i % 2 ? 1 : -1) * (40 + ((i * 53) % 320)),
    y: -(120 + ((i * 97) % 260)),
    r: (i * 67) % 360,
    c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    d: 0.9 + ((i * 13) % 10) / 20,
  })), []);
  return (
    <div className="absolute left-1/2 top-1/2 pointer-events-none">
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute w-3 h-5 rounded-sm"
          style={{ background: b.c }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 260], rotate: b.r + 360, opacity: [1, 1, 0] }}
          transition={{ duration: 2.2 * b.d, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

function LiveToast({ toast }) {
  return (
    <div className="fixed inset-x-0 bottom-[6vh] z-50 flex justify-center pointer-events-none">
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="relative"
          initial={{ opacity: 0, y: 60, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          {TOAST_LOOK[toast.type]?.confetti && <Confetti />}
          <div className="relative flex items-center gap-6 rounded-3xl bg-white shadow-2xl border border-black/[0.06] pl-6 pr-10 py-5 min-w-[34vw]">
            {(() => {
              const look = TOAST_LOOK[toast.type] || TOAST_LOOK.lead;
              const Icon = look.icon;
              return (
                <>
                  <span className={`w-[clamp(56px,8vh,84px)] h-[clamp(56px,8vh,84px)] rounded-2xl flex items-center justify-center text-white flex-shrink-0 ${look.ring}`}>
                    <Icon className="w-1/2 h-1/2" strokeWidth={2.5} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold uppercase tracking-wider text-omega-stone text-[clamp(13px,1.8vh,19px)]">{look.label}</p>
                    <p className="font-black text-[#111] leading-tight truncate text-[clamp(26px,4.4vh,48px)]">{toast.title}</p>
                    {toast.text && <p className="font-medium text-omega-slate truncate text-[clamp(15px,2.2vh,24px)]">{toast.text}</p>}
                  </div>
                </>
              );
            })()}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────
export default function PipelineTV() {
  const navigate = useNavigate();
  const now = useNow(15_000);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState({});
  const [loadedAt, setLoadedAt] = useState(null);
  const [error, setError] = useState(false);
  const [idle, setIdle] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
  const toast = useLiveToasts();

  const go = useCallback((i) => setIndex(((i % SLIDES.length) + SLIDES.length) % SLIDES.length), []);
  const next = useCallback(() => setIndex((i) => (i + 1) % SLIDES.length), []);

  // Load every slide now, every minute, and a beat after any change to the
  // tables they read. A slide that fails keeps its last good data.
  useEffect(() => {
    let alive = true;
    let debounce;
    async function loadAll() {
      const results = await Promise.allSettled(SLIDES.map((s) => s.load(Date.now())));
      if (!alive) return;
      setData((prev) => {
        const out = { ...prev };
        results.forEach((r, i) => { if (r.status === 'fulfilled') out[SLIDES[i].meta.key] = r.value; });
        return out;
      });
      setError(results.some((r) => r.status === 'rejected'));
      setLoadedAt(Date.now());
    }
    const reloadSoon = () => {
      clearTimeout(debounce);
      debounce = setTimeout(loadAll, 2000);
    };
    loadAll();
    const iv = setInterval(loadAll, REFRESH_MS);
    const tables = [...new Set(SLIDES.flatMap((s) => s.meta.tables || []))];
    const chans = tables.map((table) => supabase
      .channel(`tv-data-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, reloadSoon)
      .subscribe());
    return () => {
      alive = false;
      clearInterval(iv);
      clearTimeout(debounce);
      chans.forEach((c) => supabase.removeChannel(c));
    };
  }, []);

  // Keyboard / TV remote.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPaused((p) => !p); }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= SLIDES.length) go(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index]);

  // Keep the TV from dimming/sleeping while the page is visible.
  useEffect(() => {
    let lock = null;
    async function acquire() {
      if (document.visibilityState !== 'visible') return;
      try { lock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported or denied */ }
    }
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      lock?.release?.().catch(() => {});
    };
  }, []);

  // Hide the cursor and the controls after 3 s without mouse/keyboard.
  useEffect(() => {
    let t;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const slide = SLIDES[index];
  const Slide = slide.default;
  const dateLabel = new Date(now).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const updatedLabel = !loadedAt
    ? (error ? 'Can’t reach the server — retrying…' : 'Loading…')
    : `${error ? 'Some data offline · updated' : 'Live · updated'} ${formatNyTime(loadedAt)}`;

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    navigate('/');
  };

  return (
    <div className={`h-screen w-screen overflow-hidden bg-omega-cloud flex flex-col select-none ${idle ? 'cursor-none' : ''}`}>
      <header className="relative flex items-stretch bg-white border-b border-black/[0.06] flex-shrink-0 h-[clamp(64px,9.5vh,104px)]">
        {/* Dark logo block with the orange diagonal stripe. */}
        <div className="relative w-[clamp(240px,20vw,400px)] flex-shrink-0 bg-omega-orange [clip-path:polygon(0_0,100%_0,calc(100%-3.2vw)_100%,0_100%)]">
          <div className="absolute inset-0 bg-[#141414] flex items-center pl-[2vw] [clip-path:polygon(0_0,calc(100%-1.5vw)_0,calc(100%-4.7vw)_100%,0_100%)]">
            <img src={logoImg} alt="Omega Development" className="h-full w-auto scale-110 origin-left" />
          </div>
        </div>

        <div className="min-w-0 flex-1 flex flex-col justify-center pl-[1.5vw]">
          <p className="text-omega-stone font-bold uppercase tracking-[0.25em] text-[clamp(11px,1.5vh,16px)]">{dateLabel}</p>
          <AnimatePresence mode="wait">
            <motion.p
              key={slide.meta.key}
              className="text-[#111] font-black leading-tight truncate text-[clamp(22px,3.8vh,42px)]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
            >
              {slide.meta.title}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Slide dots — the active one stretches into an orange pill. */}
        <nav className="flex items-center gap-3 px-6" aria-label="Slides">
          {SLIDES.map((s, i) => {
            const Icon = s.meta.icon;
            const on = i === index;
            return (
              <button
                key={s.meta.key}
                onClick={() => go(i)}
                title={s.meta.title}
                className={`h-[clamp(36px,5vh,52px)] rounded-full flex items-center justify-center gap-2 transition-all duration-500 ${
                  on ? 'px-5 bg-omega-orange text-white' : 'w-[clamp(36px,5vh,52px)] bg-omega-cloud text-omega-stone hover:text-[#111]'
                }`}
              >
                {Icon && <Icon className="w-[clamp(16px,2.4vh,24px)] h-[clamp(16px,2.4vh,24px)]" strokeWidth={2.5} />}
                {on && <span className="font-extrabold uppercase tracking-wide whitespace-nowrap text-[clamp(12px,1.7vh,18px)]">{i + 1}/{SLIDES.length}</span>}
              </button>
            );
          })}
          {paused && (
            <span className="ml-1 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 text-amber-700 font-bold text-[clamp(12px,1.7vh,18px)]">
              <Pause className="w-[1em] h-[1em]" /> Paused
            </span>
          )}
        </nav>

        <div className="flex items-center pr-8 pl-2">
          <div className="text-right">
            <p className="text-[#111] font-black tabular-nums leading-none text-[clamp(24px,4vh,44px)]">{formatNyTime(now)}</p>
            <p className={`mt-1.5 inline-flex items-center gap-1.5 font-medium text-[clamp(11px,1.4vh,15px)] ${error ? 'text-amber-600' : 'text-omega-slate'}`}>
              {loadedAt && !error && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
              {updatedLabel}
            </p>
          </div>
        </div>

        <SlideTimer key={`${index}`} paused={paused} onDone={next} />
      </header>

      <main className="flex-1 min-h-0 px-8 pt-5 pb-6 flex flex-col">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.meta.key}
            className="flex-1 min-h-0 flex flex-col"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <Slide data={data[slide.meta.key]} now={now} active />
          </motion.div>
        </AnimatePresence>
      </main>

      <LiveToast toast={toast} />

      {/* Floating controls — fade out with the cursor so the TV stays clean. */}
      <div className={`fixed bottom-4 right-4 flex gap-2 transition-opacity duration-300 ${idle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <button
          onClick={() => setPaused((p) => !p)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-omega-charcoal text-sm font-semibold shadow-lg border border-black/10 hover:bg-omega-cloud"
        >
          {paused ? <><Play className="w-4 h-4" /> Resume</> : <><Pause className="w-4 h-4" /> Pause</>}
        </button>
        {!isFullscreen && (
          <button
            onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-charcoal text-white text-sm font-semibold shadow-lg hover:bg-black"
          >
            <Maximize2 className="w-4 h-4" /> Full screen
          </button>
        )}
        <button
          onClick={exit}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-omega-charcoal text-sm font-semibold shadow-lg border border-black/10 hover:bg-omega-cloud"
        >
          <ArrowLeft className="w-4 h-4" /> Exit
        </button>
      </div>
    </div>
  );
}
