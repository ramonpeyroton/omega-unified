// TV dashboard (built for 1920×1080) — the sales side of the pipeline as a
// flow: Leads (New Lead → Visited) and Estimates (Draft → Approved), one
// tile per column with its card count, what those cards are waiting on,
// and an on-time/late health bar (same time-in-stage rules as the Kanban
// cards, see stageAge.js). A side column shows today's incoming leads and
// this month's Disqualified / Lost. Contract + job stages are left out on
// purpose (Ramon's call). Lives in Ramon's Marketing app at /tv so the
// office TV shows Inácio the funnel at a glance. Money-free (marketing is
// in HIDE_MONEY_ROLES). Refreshes every minute + on any jobs change.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Maximize2, ChevronRight } from 'lucide-react';
import logoImg from '../../../assets/logo.png';
import { supabase } from '../../../shared/lib/supabase';
import { PIPELINE_COLORS, PIPELINE_STEP_LABEL, OFF_BOARD_STAGES } from '../../../shared/config/phaseBreakdown';
import { stageAge, resolveVisit, useNow, nyDateKey, nyMidnightMs, formatNyTime } from '../../../shared/lib/stageAge';
import { lostReasonLabel } from '../../receptionist/lib/leadCatalog';

const REFRESH_MS = 60_000;
const DAY_MS = 86_400_000;
const TZ = 'America/New_York';

// The two flows on the TV, in Kanban order.
const SECTIONS = [
  { key: 'leads',     title: 'Leads',     stages: ['new_lead', 'contacted', 'visit_scheduled', 'visited'] },
  { key: 'estimates', title: 'Estimates', stages: ['estimate_draft', 'estimate_sent', 'estimate_negotiating', 'estimate_approved'] },
];
const BOARD_STAGES = SECTIONS.flatMap((s) => s.stages);

// Inside the "Estimates" flow the prefix is redundant (and doesn't fit).
const SHORT_LABEL = {
  estimate_draft: 'Draft',
  estimate_sent: 'Sent',
  estimate_negotiating: 'Negotiating',
  estimate_approved: 'Approved',
};

// What the cards in each column are waiting on. The noun follows the big
// number: "8 leads waiting for first contact".
const STAGE_COPY = {
  new_lead:             { one: 'lead',     many: 'leads',     text: 'waiting for first contact' },
  contacted:            { one: 'lead',     many: 'leads',     text: 'waiting for a visit to be scheduled' },
  visit_scheduled:      { one: 'visit',    many: 'visits',    text: 'booked on the calendar' },
  visited:              { one: 'lead',     many: 'leads',     text: 'visited, waiting for an estimate' },
  estimate_draft:       { one: 'estimate', many: 'estimates', text: 'being prepared' },
  estimate_sent:        { one: 'estimate', many: 'estimates', text: 'waiting for the client’s answer' },
  estimate_negotiating: { one: 'estimate', many: 'estimates', text: 'in negotiation' },
  estimate_approved:    { one: 'estimate', many: 'estimates', text: 'approved, contract not sent yet' },
};

// Stages where stageAge() has warn/late rules → "3 late · 2 almost late".
const TIMED_STAGES = new Set([
  'new_lead', 'contacted', 'visited', 'estimate_draft', 'estimate_sent', 'estimate_negotiating',
]);

const CHIP_TONE = {
  late:  'bg-rose-50 text-rose-700 border-rose-200',
  warn:  'bg-amber-50 text-amber-700 border-amber-200',
  ok:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  info:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  muted: 'bg-omega-cloud text-omega-stone border-black/[0.06]',
};
const BAR_TONE = { ok: 'bg-emerald-500', info: 'bg-indigo-500', warn: 'bg-amber-400', late: 'bg-rose-500' };

function toMs(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

// 'YYYY-MM-DD' of the Monday of that key's week.
function mondayKey(key) {
  const t = Date.parse(`${key}T12:00:00Z`);
  const wd = new Date(t).getUTCDay(); // 0 = Sunday
  return new Date(t - ((wd + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function topReason(rows) {
  const counts = {};
  rows.forEach((r) => { if (r.lost_reason) counts[r.lost_reason] = (counts[r.lost_reason] || 0) + 1; });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? lostReasonLabel(best[0]) : null;
}

// ─── Data ───────────────────────────────────────────────────────────
// Only the board query is required; the side tiles degrade to "—".
async function loadTvData() {
  const todayKey = nyDateKey(Date.now());
  const monthStart = new Date(nyMidnightMs(`${todayKey.slice(0, 8)}01`)).toISOString();
  const weekStart = new Date(nyMidnightMs(mondayKey(todayKey))).toISOString();

  const [boardRes, offRes, newRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, pipeline_status, stage_entered_at, last_touch_at, preferred_visit_date, preferred_visit_time')
      .eq('in_pipeline', true),
    supabase
      .from('jobs')
      .select('pipeline_status, lost_reason')
      .in('pipeline_status', [...OFF_BOARD_STAGES])
      .gte('stage_entered_at', monthStart),
    supabase
      .from('jobs')
      .select('created_at')
      .gte('created_at', weekStart),
  ]);
  if (boardRes.error) throw boardRes.error;
  const board = boardRes.data || [];

  // Sales visits for the Visit Scheduled cards (same source as the Kanban).
  const visitTimes = {};
  const visitIds = board.filter((j) => j.pipeline_status === 'visit_scheduled').map((j) => j.id);
  if (visitIds.length) {
    const { data: ev, error: evErr } = await supabase
      .from('calendar_events')
      .select('job_id, starts_at, visit_status')
      .eq('kind', 'sales_visit')
      .in('job_id', visitIds)
      .order('starts_at', { ascending: true });
    if (!evErr) {
      for (const e of ev || []) {
        if (!e.job_id || e.visit_status === 'cancelled') continue;
        const t = toMs(e.starts_at);
        if (t != null) (visitTimes[e.job_id] ||= []).push(t);
      }
    }
  }

  return {
    board,
    visitTimes,
    offBoard: offRes.error ? null : offRes.data || [],
    created: newRes.error ? null : newRes.data || [],
    loadedAt: Date.now(),
  };
}

// Health of one column: chips for the footer + bar segments ({ tone, n }).
function stageHealth(status, jobs, { now, todayKey, visitTimes }) {
  if (!jobs.length) return { chips: [], segments: [], late: 0 };

  if (status === 'visit_scheduled') {
    let today = 0, past = 0, noDate = 0;
    jobs.forEach((j) => {
      const v = resolveVisit(j, visitTimes[j.id], now);
      if (!v) noDate++;
      else if (v.dateKey === todayKey) today++;
      else if (v.dateKey < todayKey) past++;
    });
    const upcoming = jobs.length - today - past - noDate;
    return {
      late: past,
      segments: [{ tone: 'ok', n: upcoming }, { tone: 'info', n: today }, { tone: 'warn', n: noDate }, { tone: 'late', n: past }],
      chips: [
        past && { tone: 'late', text: `${past} late` },
        today && { tone: 'info', text: `${today} today` },
        noDate && { tone: 'warn', text: `${noDate} no date` },
        !past && !today && !noDate && { tone: 'ok', text: 'All upcoming' },
      ].filter(Boolean),
    };
  }

  if (TIMED_STAGES.has(status)) {
    let late = 0, warn = 0;
    jobs.forEach((j) => {
      const tone = stageAge(j, { now })?.tone;
      if (tone === 'late') late++;
      else if (tone === 'warn') warn++;
    });
    return {
      late,
      segments: [{ tone: 'ok', n: jobs.length - late - warn }, { tone: 'warn', n: warn }, { tone: 'late', n: late }],
      chips: !late && !warn
        ? [{ tone: 'ok', text: 'All on time' }]
        : [
          late && { tone: 'late', text: `${late} late` },
          warn && { tone: 'warn', text: `${warn} almost late` },
        ].filter(Boolean),
    };
  }

  // Estimate Approved has no time rule — the oldest card still tells a story.
  const oldest = Math.max(...jobs.map((j) => now - (toMs(j.stage_entered_at) ?? now)));
  const days = Math.floor(oldest / DAY_MS);
  return { late: 0, segments: [], chips: [{ tone: 'muted', text: `Oldest: ${days ? plural(days, 'day', 'days') : 'today'}` }] };
}

function buildView(data, now) {
  const todayKey = nyDateKey(now);
  const todayStartMs = nyMidnightMs(todayKey);

  const byStage = Object.fromEntries(BOARD_STAGES.map((s) => [s, []]));
  (data?.board || []).forEach((j) => {
    if (byStage[j.pipeline_status]) byStage[j.pipeline_status].push(j);
    else if (!PIPELINE_STEP_LABEL[j.pipeline_status]) byStage.new_lead.push(j); // unknown → New Lead, like the Kanban
  });

  let totalLate = 0;
  const sections = SECTIONS.map((section) => {
    let open = 0, late = 0;
    const tiles = section.stages.map((status) => {
      const jobs = byStage[status];
      const health = data
        ? stageHealth(status, jobs, { now, todayKey, visitTimes: data.visitTimes })
        : { chips: [], segments: [], late: 0 };
      open += jobs.length;
      late += health.late;
      const copy = STAGE_COPY[status];
      return {
        key: status,
        label: SHORT_LABEL[status] || PIPELINE_STEP_LABEL[status],
        hex: PIPELINE_COLORS[status]?.hex,
        count: data ? jobs.length : null,
        noun: copy,
        text: copy.text,
        chips: health.chips,
        segments: health.segments,
        alert: health.late > 0,
      };
    });
    totalLate += late;
    return { ...section, tiles, open: data ? open : null, late };
  });

  const created = data?.created;
  const offBoard = data?.offBoard;
  const offTile = (status, text) => {
    const rows = offBoard ? offBoard.filter((r) => r.pipeline_status === status) : null;
    const reason = rows ? topReason(rows) : null;
    return {
      key: status,
      label: PIPELINE_STEP_LABEL[status],
      tag: 'This month',
      hex: PIPELINE_COLORS[status]?.hex,
      count: rows ? rows.length : null,
      noun: { one: 'lead', many: 'leads' },
      text,
      chips: reason ? [{ tone: 'muted', text: `Top reason: ${reason}` }] : [],
    };
  };

  const side = [
    {
      key: 'incoming',
      label: 'Incoming',
      tag: 'Today',
      hex: '#E8732A',
      count: created ? created.filter((r) => (toMs(r.created_at) ?? 0) >= todayStartMs).length : null,
      noun: { one: 'lead', many: 'leads' },
      text: 'came in today',
      chips: created ? [{ tone: 'muted', text: `${created.length} this week` }] : [],
    },
    offTile('disqualified', 'disqualified this month'),
    offTile('estimate_rejected', 'lost this month'),
  ];

  return { sections, side, totalLate };
}

// ─── UI ─────────────────────────────────────────────────────────────
function Chip({ tone, text }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border font-bold leading-tight text-[clamp(12px,1.8vh,20px)] ${CHIP_TONE[tone]}`}>
      {tone !== 'muted' && <span className="w-2 h-2 rounded-full bg-current flex-shrink-0" />}
      {text}
    </span>
  );
}

// Segmented bar: one slice per health bucket, sized by card count.
function HealthBar({ segments }) {
  const total = segments.reduce((a, s) => a + s.n, 0);
  if (!total) return null;
  return (
    <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-black/[0.05] gap-[2px]">
      {segments.filter((s) => s.n > 0).map((s) => (
        <div key={s.tone} className={`${BAR_TONE[s.tone]} h-full transition-all duration-700`} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

function StageTile({ label, hex, count, noun, text, chips, segments, alert }) {
  return (
    <div className={`relative flex-1 min-w-0 rounded-3xl bg-white shadow-card border border-black/[0.04] overflow-hidden flex flex-col ${alert ? 'ring-[3px] ring-rose-400' : ''}`}>
      {/* Soft wash of the column color behind the number. */}
      <div className="absolute inset-x-0 top-0 h-2/3 pointer-events-none" style={{ background: `linear-gradient(180deg, ${hex}1F 0%, ${hex}00 100%)` }} />
      <div className="relative px-6 pt-5 flex items-center gap-2.5">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: hex }} />
        <p className="font-extrabold uppercase tracking-wider truncate text-[clamp(14px,2.2vh,24px)]" style={{ color: hex }}>{label}</p>
      </div>
      <div className="relative flex-1 min-h-0 px-6 pb-5 flex flex-col">
        <p className={`mt-1 font-black tabular-nums leading-none tracking-tight text-[clamp(56px,14vh,150px)] ${count ? 'text-omega-charcoal' : 'text-omega-fog'}`}>
          {count ?? '—'}
        </p>
        <p className="mt-2 text-omega-slate font-medium leading-snug line-clamp-2 text-[clamp(13px,2.1vh,22px)]">
          {count != null && `${count === 1 ? noun.one : noun.many} ${text}`}
        </p>
        <div className="mt-auto pt-3 space-y-3">
          {segments?.length > 0 && <HealthBar segments={segments} />}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => <Chip key={c.text} {...c} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SideTile({ label, tag, hex, count, noun, text, chips }) {
  return (
    <div className="flex-1 min-h-0 rounded-3xl bg-white shadow-card border border-black/[0.04] overflow-hidden flex">
      <div className="w-2.5 flex-shrink-0" style={{ background: hex }} />
      <div className="flex-1 min-w-0 px-6 py-4 flex flex-col justify-center">
        <div className="flex items-center justify-between gap-3">
          <p className="font-extrabold uppercase tracking-wider truncate text-[clamp(13px,2vh,22px)]" style={{ color: hex }}>{label}</p>
          <span className="flex-shrink-0 rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wider text-[clamp(10px,1.3vh,14px)] bg-omega-cloud text-omega-stone">
            {tag}
          </span>
        </div>
        <div className="flex items-end gap-4 mt-1">
          <p className={`font-black tabular-nums leading-none tracking-tight text-[clamp(40px,8.5vh,92px)] ${count ? 'text-omega-charcoal' : 'text-omega-fog'}`}>
            {count ?? '—'}
          </p>
          <p className="pb-2 text-omega-slate font-medium leading-snug line-clamp-2 text-[clamp(12px,1.9vh,20px)]">
            {count != null && `${count === 1 ? noun.one : noun.many} ${text}`}
          </p>
        </div>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => <Chip key={c.text} {...c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, children }) {
  return (
    <div className="flex items-baseline gap-4 px-1 mb-3 flex-shrink-0">
      <h2 className="font-black uppercase tracking-[0.2em] text-omega-charcoal text-[clamp(14px,2.2vh,24px)]">{title}</h2>
      <div className="flex-1 h-px bg-black/10 self-center" />
      {children}
    </div>
  );
}

function Flow({ section }) {
  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <SectionTitle title={section.title}>
        {section.open != null && (
          <p className="font-semibold text-omega-stone text-[clamp(12px,1.9vh,20px)]">
            <span className="text-omega-charcoal font-black">{section.open}</span> open
            {section.late > 0 && <> · <span className="text-rose-600 font-black">{section.late}</span> late</>}
          </p>
        )}
      </SectionTitle>
      <div className="flex-1 min-h-0 flex items-stretch">
        {section.tiles.map(({ key, ...tile }, i) => (
          <div key={key} className="contents">
            {i > 0 && (
              <div className="w-[clamp(20px,2.4vw,44px)] flex-shrink-0 flex items-center justify-center text-omega-fog">
                <ChevronRight className="w-full h-auto" strokeWidth={2.5} />
              </div>
            )}
            <StageTile {...tile} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function PipelineTV() {
  const navigate = useNavigate();
  const now = useNow(15_000);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [idle, setIdle] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  // Load now, every minute, and a beat after any change to jobs.
  useEffect(() => {
    let alive = true;
    let debounce;
    async function load() {
      try {
        const d = await loadTvData();
        if (alive) { setData(d); setError(false); }
      } catch {
        if (alive) setError(true);
      }
    }
    load();
    const iv = setInterval(load, REFRESH_MS);
    const chan = supabase
      .channel('marketing-tv-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        clearTimeout(debounce);
        debounce = setTimeout(load, 2000);
      })
      .subscribe();
    return () => {
      alive = false;
      clearInterval(iv);
      clearTimeout(debounce);
      supabase.removeChannel(chan);
    };
  }, []);

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

  const { sections, side, totalLate } = useMemo(() => buildView(data, now), [data, now]);

  const dateLabel = new Date(now).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const updatedLabel = !data
    ? (error ? 'Can’t reach the server — retrying…' : 'Loading…')
    : `${error ? 'Offline · last update' : 'Live · updated'} ${formatNyTime(data.loadedAt)}`;

  const exit = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    navigate('/');
  };

  return (
    <div className={`h-screen w-screen overflow-hidden bg-omega-cloud flex flex-col select-none ${idle ? 'cursor-none' : ''}`}>
      <header className="flex items-center gap-6 px-8 py-4 bg-white border-b border-black/[0.06] flex-shrink-0">
        <img src={logoImg} alt="Omega Development" className="h-[clamp(40px,6.5vh,68px)] w-auto" />
        <div className="h-10 w-px bg-black/10" />
        <div className="min-w-0">
          <p className="text-omega-orange font-bold uppercase tracking-[0.25em] text-[clamp(11px,1.4vh,15px)]">Pipeline Today</p>
          <p className="text-omega-charcoal font-black leading-tight truncate text-[clamp(20px,3.2vh,34px)]">{dateLabel}</p>
        </div>

        <div className="ml-auto flex items-center gap-8">
          {data && (
            totalLate > 0 ? (
              <span className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[clamp(14px,2.1vh,22px)]">
                <span className="w-2.5 h-2.5 rounded-full bg-current" />
                {plural(totalLate, 'card', 'cards')} late
              </span>
            ) : (
              <span className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[clamp(14px,2.1vh,22px)]">
                <span className="w-2.5 h-2.5 rounded-full bg-current" />
                Everything on time
              </span>
            )
          )}
          <div className="text-right">
            <p className="text-omega-charcoal font-black tabular-nums leading-none text-[clamp(22px,3.8vh,40px)]">{formatNyTime(now)}</p>
            <p className={`mt-1 inline-flex items-center gap-1.5 font-medium text-[clamp(11px,1.4vh,15px)] ${error ? 'text-amber-600' : 'text-omega-stone'}`}>
              {data && !error && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
              {updatedLabel}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 px-6 pt-5 pb-6 flex gap-6">
        <div className="flex-1 min-w-0 flex flex-col gap-5">
          {sections.map((s) => <Flow key={s.key} section={s} />)}
        </div>

        <aside className="w-[21%] flex-shrink-0 flex flex-col">
          <SectionTitle title="Snapshot" />
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {side.map(({ key, ...tile }) => <SideTile key={key} {...tile} />)}
          </div>
        </aside>
      </main>

      {/* Floating controls — fade out with the cursor so the TV stays clean. */}
      <div className={`fixed bottom-4 right-4 flex gap-2 transition-opacity duration-300 ${idle ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
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
