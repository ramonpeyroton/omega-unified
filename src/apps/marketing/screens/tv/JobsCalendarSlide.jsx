// TV slide 5 — Jobs Calendar. Day by day over four weeks that roll with the
// clock: today is always the 7th column, so the board shows the last six
// days and the next three weeks (Ramon, 02/10). One line per job with a
// signed contract or work in progress; its bar is split into the job's
// phases — and a phase shared by several subs into one piece per sub —
// drawn from the subs and dates planned in the job card → Phases tab
// (stored in jobs.phase_data, see shared/lib/phasePlan.js). Read-only.
//
// Phase colors: all checklist items done = grey ✓; under way (items being
// checked, or today falls in its dates) = solid green "Tile · 2/10"; still
// ahead = light green; end date passed and not done = rose. A job that hasn't started (contract signed) is striped
// yellow. Past its last phase's end and still in progress = red hatch up
// to today. Jobs with no dated phase are named in the footer so somebody
// fills them in.

import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CalendarRange, CalendarX, Flag } from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { nyDateKey } from '../../../../shared/lib/stageAge';
import { planRows } from '../../../../shared/lib/phasePlan';
import { CARD, DAY_MS, SlideLoading, EmptyState } from './tvKit';

export const meta = {
  key: 'jobsCalendar',
  title: 'Jobs Calendar',
  eyebrow: 'Schedule',
  icon: CalendarRange,
  tables: ['jobs'],
};

const DAYS_BEFORE = 6;  // today = 7th column
const WINDOW_DAYS = 28; // last 6 days + today + 3 weeks
const MAX_ROWS = 15;    // more than this stops reading from across the room
const EASE = [0.22, 1, 0.36, 1];

// Long template phase names → what fits on a bar.
const SHORT_NAME = {
  'Permit Application & Approval': 'Permit',
  'Permit Application (if required)': 'Permit',
  'Excavation & Footings': 'Footings',
  'Excavation & Foundation': 'Foundation',
  'Excavation & Grading': 'Grading',
  'Decking Installation': 'Decking',
  'Railings, Stairs & Fascia': 'Railings & Stairs',
  'Final Inspection & CO': 'Final Inspection',
  'Final Inspection & Client Walkthrough': 'Final Walkthrough',
  'Final Inspection & Cleanup': 'Final & Cleanup',
  'Demo & Debris Removal': 'Demo',
  'Drywall, Insulation & Painting': 'Drywall & Paint',
  'Cabinets, Countertops & Backsplash': 'Cabinets & Counters',
  'Appliances, Fixtures & Final Touches': 'Fixtures & Finishes',
  'Rough-In Plumbing & Waterproofing': 'Rough-In & Waterproofing',
  'Tile, Flooring & Wall Finishes': 'Tile & Floors',
  'Vanity, Fixtures & Glass': 'Vanity & Fixtures',
  'Framing, Roofing & Exterior': 'Framing & Roof',
  'Drywall, Flooring & Interior Finishes': 'Interior Finishes',
  'Doors, Windows & Trim': 'Doors & Windows',
  'Waterproofing & Structural Work': 'Waterproofing',
  'Drywall, Flooring & Painting': 'Drywall & Floors',
  'Doors, Trim & Final Touches': 'Trim & Finishes',
  'Edging, Drainage & Cleanup': 'Edging & Cleanup',
  'Pre-Installation Prep': 'Prep',
  'Underlayment & Vapor Barrier': 'Underlayment',
  'Flooring Installation': 'Install',
  'Trim & Finishing': 'Trim',
};

// Multi-service jobs name phases "Kitchen — Cabinets, …"; keep the service.
function shortName(name) {
  const cut = name.indexOf(' — ');
  if (cut === -1) return SHORT_NAME[name] || name;
  const rest = name.slice(cut + 3);
  return `${name.slice(0, cut)} — ${SHORT_NAME[rest] || rest}`;
}

const SEG = {
  done:   { bg: '#D9D6CE', fg: '#5B5A55' },
  active: { bg: '#22C55E', fg: '#FFFFFF' },
  todo:   { bg: '#DCFCE7', fg: '#166534' },
  late:   { bg: '#FFE4E6', fg: '#BE123C' },
};
const SIGNED_STRIPES = 'repeating-linear-gradient(135deg, rgba(234,179,8,.28) 0 10px, rgba(234,179,8,.12) 10px 20px)';
const LATE_HATCH = 'repeating-linear-gradient(135deg, rgba(244,63,94,.55) 0 8px, rgba(244,63,94,.22) 8px 16px)';

// ─── Day math on 'YYYY-MM-DD' keys (calendar days, no time zone) ─────
const isKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
function dayNum(key) {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}
const keyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
function keyLabel(key, opts) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}
const monthDay = (key) => keyLabel(key, { month: 'short', day: 'numeric' });
function finishLabel(key, todayKey) {
  return key.slice(0, 4) === todayKey.slice(0, 4) ? monthDay(key) : `${monthDay(key)}, ${key.slice(0, 4)}`;
}

export async function load() {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, client_name, pipeline_status, phase_data')
    .in('pipeline_status', ['contract_signed', 'in_progress']);
  if (error) throw error;
  return { jobs: data || [] };
}

function buildView({ jobs }, now) {
  const todayKey = nyDateKey(now);
  const T0 = dayNum(todayKey);
  const M0 = T0 - DAYS_BEFORE;
  const M1 = M0 + WINDOW_DAYS;
  const pct = (n) => ((Math.min(Math.max(n, M0), M1) - M0) / WINDOW_DAYS) * 100;

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const n = M0 + i;
    const dow = new Date(n * DAY_MS).getUTCDay();
    return { n, key: keyOf(n), dow, weekend: dow === 0 || dow === 6, today: n === T0, past: n < T0 };
  });
  const months = [];
  for (const d of days) {
    const last = months[months.length - 1];
    if (last && last.ym === d.key.slice(0, 7)) last.to = d.n + 1;
    else months.push({ ym: d.key.slice(0, 7), key: d.key, from: d.n, to: d.n + 1 });
  }

  const rows = [];
  const undated = [];
  for (const job of jobs) {
    const name = (job.client_name || '').trim() || 'Unnamed job';

    // One segment per sub planned on a phase (shared/lib/phasePlan.js), each
    // on its own dates; the phase's checklist colors all of them.
    const segs = [];
    for (const p of job.phase_data?.phases || []) {
      const rows = planRows(p)
        .filter((r) => isKey(r.start_date) && isKey(r.end_date))
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      if (!rows.length) continue;
      const span = rows.map((r) => {
        const s = dayNum(r.start_date);
        return { r, s, e: Math.max(dayNum(r.end_date), s) + 1 }; // exclusive
      });
      const start = Math.min(...span.map((x) => x.s));
      const end = Math.max(...span.map((x) => x.e));
      const items = p.items || [];
      const done = items.filter((it) => it.done).length;
      const complete = items.length > 0 && done === items.length;
      // "Now" = work has begun on it, or its dates include today.
      const status = complete ? 'done'
        : end <= T0 ? 'late'
        : done > 0 || start <= T0 ? 'active'
        : 'todo';
      span.forEach(({ r, s, e }, i) => segs.push({
        id: r.id || `${p.id}_${i}`, s, e, status, done, total: items.length,
        name: p.name ? shortName(p.name) : 'Phase',
        sub: (r.sub_name || '').trim(),
        multi: span.length > 1,
        first: i === 0,
      }));
    }
    if (!segs.length) { undated.push(name); continue; }
    segs.sort((a, b) => a.s - b.s);

    // Pieces that overlap in time (two subs at once) stack in lanes; only
    // the overlapping run is split — everything else keeps the full height.
    let cluster = [];
    let clusterEnd = -Infinity;
    const closeCluster = () => {
      const laneEnds = [];
      for (const seg of cluster) {
        let lane = laneEnds.findIndex((end) => end <= seg.s);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
        laneEnds[lane] = seg.e;
        seg.lane = lane;
      }
      for (const seg of cluster) seg.lanes = laneEnds.length;
      cluster = [];
    };
    for (const seg of segs) {
      if (cluster.length && seg.s >= clusterEnd) closeCluster();
      cluster.push(seg);
      clusterEnd = cluster.length === 1 ? seg.e : Math.max(clusterEnd, seg.e);
    }
    closeCluster();

    const signed = job.pipeline_status === 'contract_signed';
    const finish = Math.max(...segs.map((x) => x.e));
    const allDone = segs.every((x) => x.status === 'done');
    const late = !signed && !allDone && finish <= T0;
    const inWindow = segs.some((x) => x.s < M1 && x.e > M0);
    if (!inWindow && !late) continue;

    rows.push({
      id: job.id, name, signed, segs, late,
      first: segs[0].s,
      finish,
      finishKey: keyOf(finish - 1),
      daysLate: T0 - finish + 1,
    });
  }
  rows.sort((a, b) => a.first - b.first || a.name.localeCompare(b.name));

  return {
    todayKey, T0, M0, M1, pct, days, months,
    rows: rows.slice(0, MAX_ROWS),
    hidden: Math.max(0, rows.length - MAX_ROWS),
    undated: undated.sort((a, b) => a.localeCompare(b)),
  };
}

export default function Slide({ data, now }) {
  const view = useMemo(() => (data ? buildView(data, now) : null), [data, now]);
  if (!view) return <SlideLoading />;
  if (!view.rows.length) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <EmptyState
          icon={CalendarRange}
          title="No phases scheduled yet"
          text={`${view.undated.length ? `${view.undated.length} ${view.undated.length === 1 ? 'job has' : 'jobs have'} no phase dates. ` : ''}Add a start and end date to each phase in the job card → Phases.`}
        />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className={`${CARD} flex-1 min-h-0 flex flex-col overflow-hidden`}>
        <DayHeader view={view} />
        <div className="relative flex-1 min-h-0 flex flex-col">
          <DayColumns days={view.days} />
          {view.rows.map((row, i) => <JobRow key={row.id} row={row} index={i} view={view} />)}
        </div>
      </div>
      <Legend view={view} />
    </div>
  );
}

const LABEL_COL = 'w-[clamp(280px,19vw,380px)] flex-shrink-0';

function DayHeader({ view }) {
  const { days, months, pct, M0, M1 } = view;
  return (
    <div className="flex flex-shrink-0 border-b border-black/[0.08] pb-2">
      <div className={`${LABEL_COL} flex flex-col justify-end pl-6 pb-1 border-r border-black/[0.06]`}>
        <span className="font-bold uppercase tracking-wider text-omega-stone text-[clamp(11px,1.5vh,16px)]">Last week + next 3 weeks</span>
        <span className="font-black text-[#111] leading-tight text-[clamp(20px,3vh,34px)]">
          {monthDay(keyOf(M0))} – {monthDay(keyOf(M1 - 1))}
        </span>
      </div>
      <div className="flex-1 mr-6 flex flex-col">
        <div className="relative h-[clamp(28px,3.6vh,40px)]">
          {months.map((m, i) => {
            const width = ((m.to - m.from) / WINDOW_DAYS) * 100;
            return (
              <div
                key={m.ym}
                className={`absolute top-0 h-full flex items-center pl-2 ${i ? 'border-l-2 border-black/[0.12]' : ''}`}
                style={{ left: `${pct(m.from)}%`, width: `${width}%` }}
              >
                <span className="font-black uppercase tracking-wider text-[#111] truncate text-[clamp(13px,1.9vh,21px)]">
                  {keyLabel(m.key, { month: width > 25 ? 'long' : 'short' })}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-[2px] h-[clamp(44px,5.6vh,62px)]">
          {days.map((d) => {
            const muted = d.weekend || d.past;
            return (
              <div
                key={d.key}
                className={`flex-1 min-w-0 flex flex-col items-center justify-center rounded-lg ${
                  d.today ? 'bg-omega-orange text-white' : muted ? 'text-omega-fog' : 'text-omega-stone'
                }`}
              >
                <span className="font-bold uppercase text-[clamp(10px,1.4vh,15px)]">{'SMTWTFS'[d.dow]}</span>
                <span className={`font-black tabular-nums text-[clamp(14px,2.1vh,24px)] ${d.today ? 'text-white' : muted ? '' : 'text-[#111]'}`}>
                  {Number(d.key.slice(8))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Weekend and today tints behind the rows, lined up with the day header.
function DayColumns({ days }) {
  return (
    <div className="absolute inset-0 flex pointer-events-none">
      <div className={LABEL_COL} />
      <div className="flex-1 flex mr-6">
        {days.map((d) => (
          <div
            key={d.key}
            className={`flex-1 border-l border-black/[0.04] ${d.today ? 'bg-omega-orange/[0.14]' : d.weekend ? 'bg-[#F3F2EC]' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

function JobRow({ row, index, view }) {
  const reduce = useReducedMotion();
  const { pct, M0, M1, T0, todayKey } = view;
  const laneTop = (seg) => `calc(14% + ${seg.lane} * (72% / ${seg.lanes}))`;
  const laneHeight = (seg) => `calc(72% / ${seg.lanes} - ${seg.lanes > 1 ? 3 : 0}px)`;

  // The finish date: a flag after the bar, a chip inside it when the bar
  // ends at the right edge, an arrow chip when it ends past the window
  // (only if the last visible phase has room for it).
  let finish = null;
  if (row.late) {
    const from = pct(Math.max(row.finish, M0));
    const to = pct(T0 + 1);
    finish = (
      <>
        <div className="absolute rounded-r-lg" style={{ left: `${from}%`, width: `${to - from}%`, top: '14%', height: '72%', backgroundImage: LATE_HATCH }} />
        <span
          className="absolute top-1/2 -translate-y-1/2 pl-3 font-black text-rose-600 whitespace-nowrap text-[clamp(13px,1.9vh,20px)]"
          style={{ left: `${to}%` }}
        >
          Was due {monthDay(row.finishKey)} · {row.daysLate} {row.daysLate === 1 ? 'day' : 'days'} late
        </span>
      </>
    );
  } else if (row.finish <= M1) {
    const right = pct(row.finish);
    finish = right > 90 ? (
      <span
        className="absolute top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/95 shadow-card font-extrabold text-[#111] whitespace-nowrap text-[clamp(12px,1.7vh,18px)]"
        style={{ right: `calc(${100 - right}% + 6px)` }}
      >
        <Flag className="w-[0.95em] h-[0.95em] text-omega-orange" strokeWidth={2.75} />{monthDay(row.finishKey)}
      </span>
    ) : (
      <span
        className="absolute top-1/2 -translate-y-1/2 pl-2.5 inline-flex items-center gap-1.5 font-extrabold text-[#111] whitespace-nowrap text-[clamp(13px,1.9vh,20px)]"
        style={{ left: `${right}%` }}
      >
        <Flag className="w-[0.95em] h-[0.95em] text-omega-orange" strokeWidth={2.75} />{monthDay(row.finishKey)}
      </span>
    );
  } else {
    const visible = row.segs.filter((x) => x.s < M1);
    const lastStart = visible.length ? Math.max(...visible.map((x) => x.s)) : M0;
    if (100 - pct(lastStart) >= 22) {
      finish = (
        <span className="absolute top-1/2 -translate-y-1/2 right-1 px-2 py-0.5 rounded-md bg-white/95 shadow-card font-bold text-omega-slate whitespace-nowrap text-[clamp(12px,1.7vh,18px)]">
          → {finishLabel(row.finishKey, todayKey)}
        </span>
      );
    }
  }

  return (
    <motion.div
      className={`relative flex-1 min-h-0 max-h-[clamp(64px,10vh,110px)] flex items-stretch ${index % 2 ? 'bg-black/[0.015]' : ''}`}
      initial={reduce ? false : { opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, delay: 0.06 + index * 0.04, ease: EASE }}
    >
      <div className={`${LABEL_COL} flex items-center pl-6 pr-4 border-r border-black/[0.06] min-w-0`}>
        <span className="font-extrabold text-[#111] leading-tight truncate text-[clamp(18px,2.8vh,30px)]">{row.name}</span>
      </div>
      <div className="relative flex-1 min-w-0 mr-6">
        {row.segs.filter((x) => x.e > M0 && x.s < M1).map((seg) => (
          <Segment key={seg.id} seg={seg} row={row} view={view} top={laneTop(seg)} height={laneHeight(seg)} />
        ))}
        {finish}
      </div>
    </motion.div>
  );
}

function Segment({ seg, row, view, top, height }) {
  const { pct, M0, M1 } = view;
  const left = pct(seg.s);
  const width = pct(seg.e) - left;
  const cutL = seg.s < M0;
  const cutR = seg.e > M1;
  const c = SEG[seg.status];
  const style = row.signed
    ? { backgroundImage: SIGNED_STRIPES, color: '#854D0E' }
    : { background: c.bg, color: c.fg };
  // Leave room for the "→ date" chip on the phase that runs off the edge.
  const chipRoom = cutR && !row.late && row.finish > M1 && width >= 22;
  const progress = seg.first && !row.signed && (seg.status === 'active' || seg.status === 'late') && seg.total ? ` · ${seg.done}/${seg.total}` : '';
  // Phase split between subs → lead with the company, phase after it.
  const phaseText = `${seg.name}${progress}`;
  const lead = seg.multi && seg.sub ? seg.sub : phaseText;
  const trail = seg.multi && seg.sub ? phaseText : seg.sub;
  return (
    <div
      className={`absolute flex items-center overflow-hidden ${cutL ? '' : 'rounded-l-lg'} ${cutR ? '' : 'rounded-r-lg'} ${
        row.signed ? 'border-2 border-yellow-400/70' : seg.status === 'late' ? 'border-2 border-rose-300' : ''
      }`}
      style={{
        left: `calc(${left}% + ${cutL ? 0 : 2}px)`,
        width: `calc(${width}% - ${(cutL ? 0 : 2) + (cutR ? 0 : 2)}px)`,
        top, height, ...style,
      }}
    >
      <span className={`pl-2.5 pr-1.5 whitespace-nowrap truncate text-[clamp(12px,1.8vh,19px)] ${chipRoom ? 'pr-[9em]' : ''}`}>
        <span className="font-extrabold">
          {cutL ? '‹ ' : ''}{!row.signed && seg.status === 'done' ? '✓ ' : ''}{lead}
        </span>
        {trail && <span className="font-semibold opacity-80"> · {trail}</span>}
      </span>
    </div>
  );
}

function Legend({ view }) {
  const item = 'inline-flex items-center gap-2.5 font-bold text-omega-slate whitespace-nowrap';
  const swatch = 'w-10 h-4 rounded-md';
  const { undated, hidden } = view;
  const names = undated.slice(0, 3).join(', ') + (undated.length > 3 ? ` +${undated.length - 3}` : '');
  return (
    <div className={`${CARD} flex-shrink-0 flex items-center gap-6 px-7 py-2.5 text-[clamp(13px,1.8vh,20px)] min-w-0`}>
      <span className={item}><span className={swatch} style={{ background: SEG.done.bg }} />Done</span>
      <span className={item}><span className={swatch} style={{ background: SEG.active.bg }} />Now <span className="font-medium text-omega-stone">(items done / total)</span></span>
      <span className={item}><span className={swatch} style={{ background: SEG.todo.bg }} />Next</span>
      <span className={item}><span className={`${swatch} border-2 border-rose-300`} style={{ background: SEG.late.bg }} />Phase late</span>
      <span className={item}><span className={`${swatch} border border-yellow-400/60`} style={{ backgroundImage: SIGNED_STRIPES }} />Not started</span>
      <span className={item}><Flag className="w-[1em] h-[1em] text-omega-orange" strokeWidth={2.75} />Expected finish</span>
      <span className="ml-auto flex items-center gap-3 min-w-0">
        {hidden > 0 && (
          <span className="px-3 py-1 rounded-full bg-[#111] text-white font-extrabold whitespace-nowrap">+{hidden} more jobs</span>
        )}
        {undated.length > 0 && (
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold min-w-0">
            <CalendarX className="w-[1.1em] h-[1.1em] flex-shrink-0" strokeWidth={2.5} />
            <span className="truncate">
              {undated.length} {undated.length === 1 ? 'job' : 'jobs'} without phase dates: {names}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}
