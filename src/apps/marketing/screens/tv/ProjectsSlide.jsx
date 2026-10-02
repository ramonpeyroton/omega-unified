// TV slide 3 — Projects. How every job in execution (pipeline_status =
// 'in_progress') is moving: its cover photo, how much of the phase
// checklist is done, which phase it's in (phase N of M + a step bar) and
// when someone last touched it. No money on this slide — Inácio asked
// (02/10) that the office TV shows progress, not values. The dated plan of
// each phase lives on the Jobs Calendar slide; this one is the snapshot.
// Read-only: nothing here writes to the database.
//
// The card photo is always the job's cover (Ramon, 02/10). Photos sent from
// the Phases tab (phase_photos) and Daily Logs photos (job_documents,
// folder daily_logs) still count as activity: "updated …" and the strip.

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { HardHat, Gauge as GaugeIcon, Images, AlertTriangle, ClipboardList } from 'lucide-react';
import { supabase } from '../../../../shared/lib/supabase';
import { serviceBadgeLabel } from '../../../../shared/data/services';
import {
  T, CARD, TONE, CHIP_TONE, ORANGE, DAY_MS, selectIn, toMs,
  SectionTitle, CountUp, SlideLoading, EmptyState,
} from './tvKit';

export const meta = {
  key: 'projects',
  title: 'Projects',
  eyebrow: 'Jobs in progress',
  icon: HardHat,
  tables: ['jobs', 'phase_photos', 'job_documents'],
};

const EASE = [0.22, 1, 0.36, 1];
const STALE_DAYS = 7; // no check-off and no photo for this long → "needs an update"
const IMAGE_RE = /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i;

// Cards are CSS size containers: everything inside is sized in cqmin (1% of
// the card's shorter side), so the content grows with the card.
const CQ = {
  name:    'font-black leading-[1.1] tracking-tight text-[clamp(14px,7.5cqmin,72px)]',
  chip:    'text-[clamp(11px,4.2cqmin,34px)]',
  pct:     'font-black tabular-nums leading-none text-[clamp(12px,7cqmin,64px)]',
  eyebrow: 'font-bold uppercase tracking-wider text-omega-stone leading-tight text-[clamp(10px,3.6cqmin,30px)]',
  phase:   'font-extrabold leading-[1.12] text-[#111] text-[clamp(13px,6cqmin,52px)]',
  meta:    'font-semibold leading-tight text-[clamp(11px,4.2cqmin,34px)]',
};

// ─── Helpers ─────────────────────────────────────────────────────────

// "12 Main St, Norwalk, CT 06850, USA" / "12 Main St, Norwalk - CT" → "Norwalk".
function cityFromAddress(address) {
  if (!address) return '';
  const parts = String(address).split(',').map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1 && /^(usa|us|united states)$/i.test(parts[parts.length - 1])) parts.pop();
  while (parts.length > 1 && /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length < 2) return '';
  const city = parts[parts.length - 1].replace(/\s*-\s*[A-Z]{2}(\s+\d{5})?$/, '').trim();
  return /\d/.test(city) ? '' : city;
}

function serviceLabel(value) {
  return serviceBadgeLabel(value)
    .split(', ')
    .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(', ');
}

// "just now" / "3h ago" / "yesterday" / "5d ago" / "Aug 15".
function ago(ms, now) {
  if (ms == null) return '';
  const diff = Math.max(0, now - ms);
  const h = diff / 3_600_000;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(diff / DAY_MS);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// Phase checklist → progress, current phase, last check-off.
function phaseSummary(phaseData) {
  const phases = (phaseData?.phases || []).map((ph) => {
    const items = ph.items || [];
    return { id: ph.id, name: ph.name || 'Phase', total: items.length, done: items.filter((i) => i.done).length, items };
  });
  const total = phases.reduce((s, p) => s + p.total, 0);
  const done = phases.reduce((s, p) => s + p.done, 0);
  let current = phases.findIndex((p) => p.done < p.total);
  if (current < 0 && phases.length) current = phases.length - 1;
  let lastCheck = null;
  for (const p of phases) {
    for (const it of p.items) {
      const at = toMs(it.done_at);
      if (it.done && at != null && (!lastCheck || at > lastCheck.at)) {
        lastCheck = { at, by: it.done_by || '', label: it.label || it.name || '' };
      }
    }
  }
  return {
    phases: phases.map(({ items, ...p }) => p),
    total,
    done,
    pct: total ? done / total : null,
    current,
    lastCheck,
  };
}

// ─── Data ────────────────────────────────────────────────────────────

export async function load(now = Date.now()) {
  const { data: jobRows, error } = await supabase
    .from('jobs')
    .select('id, client_name, service, city, address, cover_photo_url, phase_data')
    .eq('pipeline_status', 'in_progress');
  if (error) throw error;
  const jobs = jobRows || [];
  if (!jobs.length) return { jobs: [], loadedAt: now };
  const ids = jobs.map((j) => j.id);

  // Photos are nice-to-have: a failing query just means "no photo".
  const [phasePhotos, logDocs] = await Promise.all([
    selectIn('phase_photos', 'job_id, phase_id, photo_url, taken_by, taken_at', 'job_id', ids).catch(() => []),
    selectIn('job_documents', 'job_id, folder, photo_url, uploaded_by, created_at', 'job_id', ids,
      (q) => q.eq('folder', 'daily_logs')).catch(() => []),
  ]);

  return {
    loadedAt: now,
    jobs: jobs.map((job) => {
      const summary = phaseSummary(job.phase_data);
      const phaseName = Object.fromEntries(summary.phases.map((p) => [p.id, p.name]));

      const candidates = [
        ...phasePhotos.filter((p) => p.job_id === job.id && p.photo_url).map((p) => ({
          url: p.photo_url, at: toMs(p.taken_at), by: p.taken_by || '', where: phaseName[p.phase_id] || 'Phases',
        })),
        ...logDocs.filter((d) => d.job_id === job.id && IMAGE_RE.test(d.photo_url || '')).map((d) => ({
          url: d.photo_url, at: toMs(d.created_at), by: d.uploaded_by || '', where: 'Daily Logs',
        })),
      ].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      const photo = job.cover_photo_url ? { url: job.cover_photo_url } : null;

      const lastAt = Math.max(summary.lastCheck?.at ?? 0, candidates[0]?.at ?? 0) || null;
      return {
        id: job.id,
        name: (job.client_name || '').trim() || 'Unnamed job',
        service: serviceLabel(job.service),
        city: (job.city || '').trim() || cityFromAddress(job.address),
        photo,
        lastPhotoAt: candidates[0]?.at ?? null,
        recentPhotos: candidates.filter((c) => c.at != null && now - c.at < STALE_DAYS * DAY_MS).length,
        ...summary,
        lastAt,
        lastBy: summary.lastCheck && summary.lastCheck.at === lastAt ? summary.lastCheck.by : (candidates[0]?.by || ''),
      };
    }),
  };
}

// ─── View model ──────────────────────────────────────────────────────

function gridFor(n) {
  if (n <= 4) return { rows: 1, cols: n, capacity: n };
  if (n <= 10) return { rows: 2, cols: Math.ceil(n / 2), capacity: n };
  const cols = Math.min(6, Math.ceil(n / 3));
  return { rows: 3, cols, capacity: cols * 3 };
}

function buildView(data, now) {
  const jobs = [...(data?.jobs || [])].map((j) => ({
    ...j,
    stale: !j.lastAt || now - j.lastAt > STALE_DAYS * DAY_MS,
  }));
  // Most advanced first; jobs without a checklist at the end.
  jobs.sort((a, b) => {
    if (a.pct == null || b.pct == null) return a.pct == null && b.pct == null ? a.name.localeCompare(b.name) : a.pct == null ? 1 : -1;
    return b.pct - a.pct;
  });
  const withChecklist = jobs.filter((j) => j.pct != null);
  const lastPhoto = jobs
    .map((j) => (j.lastPhotoAt != null ? { at: j.lastPhotoAt, job: j.name } : null))
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)[0] || null;
  return {
    jobs,
    totals: {
      count: jobs.length,
      withChecklist: withChecklist.length,
      avgPct: withChecklist.length ? withChecklist.reduce((s, j) => s + j.pct, 0) / withChecklist.length : null,
      photosWeek: jobs.reduce((s, j) => s + j.recentPhotos, 0),
      lastPhoto,
      stale: jobs.filter((j) => j.stale).length,
    },
  };
}

// ─── Pieces ──────────────────────────────────────────────────────────

function Ring({ pct, delay, reduce }) {
  const R = 50;
  const SW = 12;
  const v = Math.max(0, Math.min(pct ?? 0, 1));
  const color = v >= 1 ? TONE.good.hex : ORANGE;
  return (
    <div className="relative flex-shrink-0 aspect-square" style={{ width: '24cqmin' }}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={SW} />
        {pct != null && v > 0 && (
          <motion.circle
            cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: v }}
            transition={{ duration: 0.8, delay, ease: EASE }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {pct != null
          ? <CountUp value={Math.round(pct * 100)} format={(n) => `${Math.round(n)}%`} className={`${CQ.pct} text-[#111]`} />
          : <ClipboardList className="w-[38%] h-[38%] text-omega-fog" strokeWidth={2} />}
      </div>
    </div>
  );
}

// One segment per phase: done = green, current = orange (filled by its own
// progress, with a small stub so it shows even at 0), ahead = grey.
function PhaseSteps({ phases, current, delay, reduce }) {
  return (
    <div className="flex gap-[1.2cqmin] h-[clamp(5px,2.2cqmin,16px)]">
      {phases.map((p, i) => {
        const complete = p.total > 0 && p.done >= p.total;
        const fill = complete ? 1 : i === current ? Math.max(p.total ? p.done / p.total : 0, 0.12) : 0;
        const color = complete ? TONE.good.hex : ORANGE;
        return (
          <div key={p.id || i} className="relative flex-1 rounded-full overflow-hidden bg-black/[0.08]">
            {fill > 0 && (
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: color }}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${fill * 100}%` }}
                transition={{ duration: 0.5, delay: delay + 0.2 + i * 0.04, ease: EASE }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhotoBox({ photo }) {
  const [ok, setOk] = useState(true);
  const has = photo?.url && ok;
  return (
    <div className="relative flex-1 min-h-[30%] overflow-hidden">
      {has ? (
        <img src={photo.url} alt="" onError={() => setOk(false)} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-omega-charcoal via-[#4A3426] to-omega-orange">
          <HardHat className="absolute -right-[4%] -top-[10%] h-[120%] w-auto text-white/10" strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

function JobCard({ job, index, now, reduce }) {
  const delay = Math.min(index * 0.04, 0.3);
  const hasPhases = job.phases.length > 0;
  const currentPhase = hasPhases ? job.phases[job.current] : null;
  return (
    <motion.div
      className={`${CARD} relative min-w-0 min-h-0 overflow-hidden flex flex-col [container-type:size]`}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      <PhotoBox photo={job.photo} />

      <div className="flex-shrink-0 flex flex-col gap-[2.6cqmin] px-[5cqmin] pt-[3.5cqmin] pb-[4cqmin]">
        <div className="min-w-0">
          <p className={`truncate text-[#111] ${CQ.name}`}>{job.name}</p>
          <div className="mt-[1.2cqmin] flex items-center gap-[2.4cqmin] min-w-0">
            {job.service && (
              <span className={`inline-flex min-w-0 max-w-[70%] flex-shrink-0 items-center px-[2.8cqmin] py-[0.8cqmin] rounded-full font-bold leading-tight ${CQ.chip} ${CHIP_TONE.muted}`}>
                <span className="truncate">{job.service}</span>
              </span>
            )}
            {job.city && <span className={`${CQ.chip} font-semibold text-omega-slate truncate min-w-0`}>{job.city}</span>}
          </div>
        </div>

        <div className="flex items-center gap-[4cqmin] min-w-0">
          <Ring pct={job.pct} delay={delay} reduce={reduce} />
          <div className="flex-1 min-w-0">
            {hasPhases ? (
              <>
                <p className={CQ.eyebrow}>Phase {job.current + 1} of {job.phases.length}</p>
                <p className={`${CQ.phase} line-clamp-2`}>{currentPhase?.name}</p>
              </>
            ) : (
              <>
                <p className={CQ.eyebrow}>Phases</p>
                <p className={`${CQ.phase} !text-omega-fog`}>No checklist yet</p>
              </>
            )}
          </div>
        </div>

        {hasPhases && <PhaseSteps phases={job.phases} current={job.current} delay={delay} reduce={reduce} />}

        <p className={`${CQ.meta} truncate ${job.stale ? 'text-amber-600' : 'text-omega-slate'}`}>
          {job.lastAt
            ? <>{job.stale ? 'Last update ' : 'Updated '}{ago(job.lastAt, now)}{job.lastBy ? ` · ${firstName(job.lastBy)}` : ''}</>
            : 'No updates yet'}
        </p>
      </div>
    </motion.div>
  );
}

// When there are more jobs than tiles: one card that names the rest.
function MoreCard({ jobs }) {
  return (
    <div className={`${CARD} min-w-0 min-h-0 overflow-hidden [container-type:size]`}>
      <div className="h-full flex flex-col items-center justify-center text-center gap-[2cqmin] px-[5cqmin]">
        <p className={`${CQ.name} text-[#111]`}>+{jobs.length} more</p>
        <p className={`${CQ.meta} text-omega-stone line-clamp-3`}>{jobs.map((j) => j.name).join(', ')}</p>
      </div>
    </div>
  );
}

// One segment of the bottom strip: small icon, caps label, then the number
// with its explanation on the same line.
function TotalItem({ icon: Icon, label, value, format, sub, tone }) {
  const t = tone ? TONE[tone] : null;
  return (
    <div className="flex items-center gap-4 min-w-0 px-6">
      <span className={`w-[clamp(32px,4.4vh,46px)] h-[clamp(32px,4.4vh,46px)] rounded-xl flex items-center justify-center flex-shrink-0 ${t ? `${t.bg} ${t.text}` : 'bg-omega-cloud text-omega-slate'}`}>
        <Icon className="w-1/2 h-1/2" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`${T.eyebrow} leading-tight truncate`}>{label}</p>
        <p className="flex items-baseline gap-3 min-w-0 leading-tight">
          <CountUp
            value={value}
            format={format}
            className={`font-bold tabular-nums whitespace-nowrap text-[clamp(18px,2.6vh,28px)] ${t ? t.text : 'text-[#111]'}`}
          />
          {sub && <span className={`${T.meta} truncate min-w-0`}>{sub}</span>}
        </p>
      </div>
    </div>
  );
}

// ─── Slide ───────────────────────────────────────────────────────────

export default function ProjectsSlide({ data, now = Date.now() }) {
  const reduce = useReducedMotion();
  const { jobs, totals } = useMemo(() => buildView(data, now), [data, now]);
  if (!data) return <SlideLoading />;

  if (!jobs.length) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <EmptyState icon={HardHat} title="No jobs in progress" text="Jobs show up here as soon as work starts." />
      </div>
    );
  }

  const grid = gridFor(jobs.length);
  const overflow = jobs.length > grid.capacity;
  const shown = overflow ? jobs.slice(0, grid.capacity - 1) : jobs;
  const rest = overflow ? jobs.slice(grid.capacity - 1) : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <section className="flex-1 min-h-0 flex flex-col">
        <SectionTitle title="Jobs in progress" />
        <div
          className="flex-1 min-h-0 grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          }}
        >
          {shown.map((job, i) => <JobCard key={job.id} job={job} index={i} now={now} reduce={reduce} />)}
          {overflow && <MoreCard jobs={rest} />}
        </div>
      </section>

      <div className={`${CARD} grid grid-cols-4 divide-x divide-black/[0.06] py-3 flex-shrink-0`}>
        <TotalItem
          icon={HardHat}
          label="Jobs in progress"
          value={totals.count}
          sub={`${totals.withChecklist} with a phase checklist`}
        />
        <TotalItem
          icon={GaugeIcon}
          label="Average progress"
          value={totals.avgPct != null ? Math.round(totals.avgPct * 100) : null}
          format={(n) => `${Math.round(n)}%`}
          sub="of checklist items done"
        />
        <TotalItem
          icon={Images}
          label="Photos this week"
          value={totals.photosWeek}
          sub={totals.lastPhoto ? `last: ${totals.lastPhoto.job} · ${ago(totals.lastPhoto.at, now)}` : 'none yet'}
        />
        <TotalItem
          icon={AlertTriangle}
          label="Need an update"
          value={totals.stale}
          sub={`no check-off or photo in ${STALE_DAYS}+ days`}
          tone={totals.stale ? 'warn' : 'good'}
        />
      </div>
    </div>
  );
}
