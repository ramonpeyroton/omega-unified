// Field "Today" — Joel's central on the phone (Ramon, 03/10). Built from the
// subs + dates planned on each phase (job card → Phases, stored in
// jobs.phase_data — see shared/lib/phasePlan.js) and today's field events
// on the calendar:
//   1. On site today        — sub, job, phase, address (→ Maps), sub's phone
//   2. Late phases          — end date passed, checklist not closed
//   3. Starting soon        — next 7 days
//   4. No sub assigned      — dated phases starting in the next 7 days with
//                             nobody on them
//   5. Today's agenda       — inspections, deliveries, job starts…
// The small bell in the header holds the alerts (they left the bottom bar).

import { useEffect, useMemo, useState } from 'react';
import {
  HardHat, AlertTriangle, CalendarClock, UserX, CalendarDays, Phone,
  Navigation, RefreshCw,
} from 'lucide-react';
import { supabase } from '../../../shared/lib/supabase';
import NotificationsBell from '../../../shared/components/NotificationsBell';
import { planRows } from '../../../shared/lib/phasePlan';
import { subDisplayNames } from '../../../shared/lib/subcontractor';
import { nyDateKey, nyMidnightMs, formatNyTime } from '../../../shared/lib/stageAge';
import { EVENT_KIND_META } from '../../../shared/lib/calendar';

const SOON_DAYS = 7;
const DAY = 86_400_000;
// Calendar kinds that matter on site (sales visits and meetings don't).
const FIELD_KINDS = new Set(['inspection', 'material_delivery', 'cabinet_delivery', 'service_day', 'job_start', 'media_visit']);

const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const daysBetween = (a, b) => dayNum(b) - dayNum(a);
const md = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const wmd = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const telHref = (phone) => {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
};
const mapsHref = (job) => {
  const where = [job.address, job.city].filter(Boolean).join(', ');
  return where ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(where)}` : null;
};
const shortAddress = (a) => (a || '').replace(/\s*\d{5}(-\d{4})?\s*$/, '').replace(/,\s*(USA|US)\s*$/i, '').replace(/,\s*$/, '').trim();

async function loadToday() {
  const todayKey = nyDateKey(Date.now());
  const [jobsRes, subsRes, evRes] = await Promise.all([
    supabase.from('jobs')
      .select('id, client_name, address, city, pipeline_status, phase_data')
      .in('pipeline_status', ['contract_signed', 'in_progress']),
    supabase.from('subcontractors').select('id, name, contact_name, trade, phone'),
    supabase.from('calendar_events')
      .select('id, title, kind, starts_at, all_day, location, job_id, visit_status')
      .gte('starts_at', new Date(nyMidnightMs(todayKey)).toISOString())
      .lt('starts_at', new Date(nyMidnightMs(addDays(todayKey, 1))).toISOString())
      .order('starts_at', { ascending: true }),
  ]);
  if (jobsRes.error) throw jobsRes.error;
  return {
    todayKey,
    jobs: jobsRes.data || [],
    subs: subsRes.error ? [] : subsRes.data || [],
    events: evRes.error ? [] : (evRes.data || []).filter((e) => FIELD_KINDS.has(e.kind) && e.visit_status !== 'cancelled'),
  };
}

function buildView({ todayKey, jobs, subs, events }) {
  const soonEnd = addDays(todayKey, SOON_DAYS);
  const subById = Object.fromEntries(subs.map((s) => [s.id, s]));
  const jobById = Object.fromEntries(jobs.map((j) => [j.id, j]));
  const onSite = [];
  const late = [];
  const soon = [];
  const noSub = [];

  for (const job of jobs) {
    for (const ph of job.phase_data?.phases || []) {
      const items = ph.items || [];
      const complete = items.length > 0 && items.every((it) => it.done);
      if (complete) continue;
      const rows = planRows(ph).filter((r) => r.start_date && r.end_date);
      if (!rows.length) continue;
      const phaseEnd = rows.map((r) => r.end_date).sort().pop();
      if (phaseEnd < todayKey) {
        late.push({ key: `${job.id}:${ph.id}`, job, phase: ph.name, due: phaseEnd, days: daysBetween(phaseEnd, todayKey) });
        continue;
      }
      for (const r of rows) {
        const sub = r.sub_id ? subById[r.sub_id] : null;
        const who = sub ? subDisplayNames(sub).primary : (r.sub_name || '').trim();
        const base = { key: `${job.id}:${ph.id}:${r.id}`, job, phase: ph.name, who, trade: sub?.trade || null, phone: sub?.phone || null, start: r.start_date, end: r.end_date };
        if (!who) {
          if (r.end_date >= todayKey && r.start_date <= soonEnd) noSub.push(base);
          continue;
        }
        if (r.start_date <= todayKey && r.end_date >= todayKey) onSite.push(base);
        else if (r.start_date > todayKey && r.start_date <= soonEnd) soon.push(base);
      }
    }
  }
  onSite.sort((a, b) => a.end.localeCompare(b.end));
  late.sort((a, b) => b.days - a.days);
  soon.sort((a, b) => a.start.localeCompare(b.start));
  noSub.sort((a, b) => a.start.localeCompare(b.start));
  const agenda = events.map((e) => ({ ...e, job: e.job_id ? jobById[e.job_id] : null }));
  return { todayKey, onSite, late, soon, noSub, agenda };
}

export default function FieldToday({ user, onOpenJob, onOpenAlertJob }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setData(await loadToday()); setError(null); } catch (e) { setError(e.message || 'Could not load'); }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  const view = useMemo(() => (data ? buildView(data) : null), [data]);
  const todayLabel = view
    ? new Date(`${view.todayKey}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="font-optical flex-1 overflow-y-auto bg-omega-cloud">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-black/[0.06] px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-[26px] font-extrabold text-[#141413] tracking-[-0.025em] leading-tight">Today</h1>
          <p className="text-[14px] text-[#5F5F5B]">{todayLabel}</p>
        </div>
        <button
          onClick={refresh}
          className="no-touch-min w-10 h-10 rounded-xl flex items-center justify-center text-[#5F5F5B] hover:bg-black/[0.05]"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <NotificationsBell user={user} onOpenJob={onOpenAlertJob} />
      </header>

      {error && <p className="m-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</p>}
      {!view && !error && <p className="p-6 text-center text-[#8A8A85]">Loading…</p>}

      {view && (
        <div className="px-4 py-4 space-y-5 pb-8">
          <div className="flex flex-wrap gap-2">
            <Stat n={view.onSite.length} label="on site" tone="orange" />
            <Stat n={view.late.length} label="late" tone="rose" />
            <Stat n={view.soon.length} label="starting soon" tone="blue" />
            <Stat n={view.noSub.length} label="no sub" tone="amber" />
          </div>

          <Section icon={HardHat} tone="orange" title="On site today" count={view.onSite.length} empty="Nobody scheduled on site today.">
            {view.onSite.map((r) => (
              <Card key={r.key} onClick={() => onOpenJob(r.job)}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[17px] font-semibold text-[#141413] tracking-[-0.01em] truncate">{r.who}</p>
                    <p className="text-[14px] text-[#5F5F5B] truncate">{r.phase}</p>
                    <p className="mt-1 text-[15px] font-medium text-[#2A2A27] truncate">{r.job.client_name}</p>
                    <p className="text-[13px] text-[#8A8A85] truncate">{shortAddress(r.job.address) || 'No address'}</p>
                  </div>
                  <span className="flex-shrink-0 inline-flex items-center h-7 px-2.5 rounded-full bg-[#FFE9D8] text-[#C2410C] text-[12px] font-semibold">
                    until {md(r.end)}
                  </span>
                </div>
                <Actions phone={r.phone} maps={mapsHref(r.job)} />
              </Card>
            ))}
          </Section>

          {view.late.length > 0 && (
            <Section icon={AlertTriangle} tone="rose" title="Late phases" count={view.late.length}>
              {view.late.map((r) => (
                <Card key={r.key} onClick={() => onOpenJob(r.job)} tone="rose">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[16px] font-semibold text-[#141413] truncate">{r.phase}</p>
                      <p className="text-[14px] text-[#5F5F5B] truncate">{r.job.client_name}</p>
                    </div>
                    <span className="flex-shrink-0 text-right">
                      <span className="block text-[14px] font-bold text-rose-600">{r.days} {r.days === 1 ? 'day' : 'days'} late</span>
                      <span className="block text-[12px] text-[#8A8A85]">was due {md(r.due)}</span>
                    </span>
                  </div>
                </Card>
              ))}
            </Section>
          )}

          <Section icon={CalendarClock} tone="blue" title={`Starting in the next ${SOON_DAYS} days`} count={view.soon.length} empty="No subs starting this week.">
            {view.soon.map((r) => (
              <Card key={r.key} onClick={() => onOpenJob(r.job)}>
                <div className="flex items-center gap-3">
                  <span className="w-14 flex-shrink-0 text-center rounded-xl bg-[#DCEBFC] text-[#1D4ED8] py-1.5">
                    <span className="block text-[11px] font-semibold uppercase">{wmd(r.start).split(',')[0]}</span>
                    <span className="block text-[17px] font-extrabold leading-tight">{md(r.start).split(' ')[1]}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-semibold text-[#141413] truncate">{r.who}</p>
                    <p className="text-[14px] text-[#5F5F5B] truncate">{r.job.client_name} · {r.phase}</p>
                  </div>
                  {r.phone && (
                    <a href={telHref(r.phone)} onClick={(e) => e.stopPropagation()} className="no-touch-min w-10 h-10 rounded-xl bg-[#F7F7F5] border border-[#E7E7E4] flex items-center justify-center text-[#141413]" aria-label={`Call ${r.who}`}>
                      <Phone className="w-[18px] h-[18px]" />
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </Section>

          {view.noSub.length > 0 && (
            <Section icon={UserX} tone="amber" title="No sub assigned" count={view.noSub.length}>
              {view.noSub.map((r) => (
                <Card key={r.key} onClick={() => onOpenJob(r.job)} tone="amber">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[16px] font-semibold text-[#141413] truncate">{r.phase}</p>
                      <p className="text-[14px] text-[#5F5F5B] truncate">{r.job.client_name}</p>
                    </div>
                    <span className="flex-shrink-0 text-[13px] font-semibold text-amber-700">
                      {r.start <= view.todayKey ? 'now' : `starts ${md(r.start)}`}
                    </span>
                  </div>
                </Card>
              ))}
            </Section>
          )}

          <Section icon={CalendarDays} tone="slate" title="Today's agenda" count={view.agenda.length} empty="No inspections or deliveries today.">
            {view.agenda.map((e) => {
              const meta = EVENT_KIND_META[e.kind] || { label: 'Event', color: '#6B7280' };
              return (
                <Card key={e.id} onClick={e.job ? () => onOpenJob(e.job) : undefined}>
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 self-stretch rounded-full" style={{ background: meta.color }} />
                    <span className="w-16 flex-shrink-0 text-[15px] font-bold text-[#141413] tabular-nums">
                      {e.all_day ? 'All day' : formatNyTime(new Date(e.starts_at).getTime())}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-[#141413] truncate">{e.job?.client_name || e.title}</p>
                      <p className="text-[13px] text-[#5F5F5B] truncate">{meta.label}{e.location ? ` · ${shortAddress(e.location)}` : ''}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </Section>
        </div>
      )}
    </div>
  );
}

const TONES = {
  orange: { icon: 'bg-[#FFE9D8] text-[#F26B1D]', stat: 'bg-[#FFE9D8] text-[#C2410C]' },
  rose:   { icon: 'bg-rose-100 text-rose-600',  stat: 'bg-rose-100 text-rose-700' },
  blue:   { icon: 'bg-[#DCEBFC] text-[#2563EB]', stat: 'bg-[#DCEBFC] text-[#1D4ED8]' },
  amber:  { icon: 'bg-amber-100 text-amber-700', stat: 'bg-amber-100 text-amber-800' },
  slate:  { icon: 'bg-[#EDEDEA] text-[#3A3A37]', stat: 'bg-[#EDEDEA] text-[#3A3A37]' },
};

function Stat({ n, label, tone }) {
  return (
    <span className={`flex-shrink-0 inline-flex items-baseline gap-1.5 h-9 px-3.5 rounded-full ${TONES[tone].stat}`}>
      <span className="text-[17px] font-extrabold leading-9">{n}</span>
      <span className="text-[13px] font-semibold">{label}</span>
    </span>
  );
}

function Section({ icon: Icon, tone, title, count, empty, children }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${TONES[tone].icon}`}>
          <Icon className="w-[18px] h-[18px]" strokeWidth={2.4} />
        </span>
        <h2 className="flex-1 text-[18px] font-bold text-[#141413] tracking-[-0.015em]">{title}</h2>
        <span className="text-[15px] font-semibold text-[#8A8A85] tabular-nums">{count}</span>
      </div>
      <div className="space-y-2">
        {has ? children : <p className="px-4 py-3 rounded-2xl bg-white border border-[#E7E7E4] text-[14px] text-[#8A8A85]">{empty}</p>}
      </div>
    </section>
  );
}

function Card({ children, onClick, tone }) {
  const border = tone === 'rose' ? 'border-rose-200' : tone === 'amber' ? 'border-amber-200' : 'border-[#E7E7E4]';
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      className={`relative w-full text-left bg-white rounded-2xl border ${border} px-4 py-3.5 ${onClick ? 'active:scale-[0.99] transition-transform cursor-pointer' : ''}`}
    >
      {children}
    </div>
  );
}

// Call the sub + open the job site in Maps.
function Actions({ phone, maps }) {
  const tel = telHref(phone);
  if (!tel && !maps) return null;
  const btn = 'no-touch-min flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl text-[15px] font-semibold';
  return (
    <div className="mt-3 flex gap-2">
      {tel && (
        <a href={tel} onClick={(e) => e.stopPropagation()} className={`${btn} bg-[#141413] text-white`}>
          <Phone className="w-[18px] h-[18px]" /> Call sub
        </a>
      )}
      {maps && (
        <a href={maps} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={`${btn} bg-[#F7F7F5] border border-[#E7E7E4] text-[#141413]`}>
          <Navigation className="w-[18px] h-[18px]" /> Navigate
        </a>
      )}
    </div>
  );
}
