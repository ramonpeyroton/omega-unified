import { useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart, Calendar, ChevronRight, Store, Check, HardHat, Briefcase,
  AlertTriangle, CalendarDays, Plus, Camera, Clock, Package, FolderOpen,
  Edit3, AlertCircle, Box, Bell, Receipt,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';
import Avatar, { colorFromName } from '../../../shared/components/ui/Avatar';
import { useUserProfile } from '../../../shared/hooks/useUserProfile';
import QuickTasksList from '../../../shared/components/QuickTasksList';
import ReceiptCaptureModal from '../../../shared/components/ReceiptCaptureModal';
import { logAudit } from '../../../shared/lib/audit';

/**
 * Gabriel's home screen — the three things that drive his day:
 *   1. My Punch List — tasks he writes down (from Inácio + subs)
 *   2. Materials Run — inline shopping list grouped by store, with
 *      tap-to-buy checkboxes right here (no need to open a separate
 *      screen unless he wants filters)
 *   3. Today's Schedule — calendar events for today + work-in-progress
 *      jobs as implicit "working on…" markers
 *
 * Active Jobs list lives on the Jobs tab — kept off this screen so
 * the three actionable blocks above get room to breathe.
 */
const EXCLUDED_PIPELINE = ['completed', 'estimate_rejected'];

export default function JobOfTheDay({ user, onNavigate, onSelectJob, onOpenFullJob }) {
  const [todayEvents, setTodayEvents] = useState([]);
  const [activeJobs, setActiveJobs]   = useState([]);  // still fetched — shown in schedule
  const [materials, setMaterials]     = useState([]);  // [{ ...mat, jobs: {...} }]
  const [loading, setLoading]         = useState(true);
  const [notifCount, setNotifCount]   = useState(0);
  // Job currently feeding the Receipt capture modal. Null when closed.
  const [receiptJob, setReceiptJob]   = useState(null);
  const [error, setError]             = useState(null);
  const { photoUrl } = useUserProfile(user);

  useEffect(() => {
    (async () => {
      try {
        const { count } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('seen', false);
        setNotifCount(count || 0);
      } catch { /* badge stays at 0 */ }
    })();
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(now); dayEnd.setHours(23, 59, 59, 999);

    try {
      const [evRes, jobsRes, matsRes, jobsAllRes] = await Promise.all([
        supabase
          .from('calendar_events')
          .select('*, jobs:job_id ( id, client_name, address, city, client_phone, service, phase_data )')
          .gte('starts_at', dayStart.toISOString())
          .lte('starts_at', dayEnd.toISOString())
          .order('starts_at', { ascending: true }),
        supabase
          .from('jobs')
          .select('id, client_name, address, city, client_phone, service, phase_data, updated_at, pipeline_status')
          .eq('pipeline_status', 'in_progress')
          .order('updated_at', { ascending: false }),
        supabase
          .from('job_materials')
          .select('*')
          .eq('status', 'needed')
          .order('added_at', { ascending: false }),
        supabase
          .from('jobs')
          .select('id, client_name, city, service, pipeline_status'),
      ]);

      setTodayEvents(evRes.data || []);
      setActiveJobs(jobsRes.data || []);

      // Join materials ↔ jobs client-side and drop any tied to closed jobs.
      const jobById = new Map((jobsAllRes.data || []).map((j) => [j.id, j]));
      const live = (matsRes.data || [])
        .map((m) => ({ ...m, jobs: jobById.get(m.job_id) || null }))
        .filter((m) => m.jobs && !EXCLUDED_PIPELINE.includes(m.jobs.pipeline_status));
      setMaterials(live);
    } catch (err) { setError(err?.message || 'Failed to load data'); }
    setLoading(false);
  }

  async function markBought(item) {
    try {
      await supabase.from('job_materials').update({
        status: 'bought',
        bought_at: new Date().toISOString(),
        bought_by: user?.name || null,
      }).eq('id', item.id);
      setMaterials((prev) => prev.filter((m) => m.id !== item.id));
      logAudit({ user, action: 'material.bought', entityType: 'job_material', entityId: item.id });
    } catch { /* ignore */ }
  }

  const nowLabel = useMemo(() => new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }), []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // ─── Issues That Need Attention ─────────────────────────────────
  // Computed client-side from data we already have:
  //   • Jobs that are in_progress AND haven't been touched in 7+
  //     days → "behind schedule".
  //   • Materials needed for 3+ days that nobody has bought yet →
  //     "delivery delayed".
  //   • Calendar events of kind 'inspection' scheduled for today
  //     or earlier that have no resolution yet → "inspection
  //     pending".
  const issues = useMemo(() => {
    const now = Date.now();
    const ms7 = 7 * 24 * 60 * 60 * 1000;
    const ms3 = 3 * 24 * 60 * 60 * 1000;

    const stale = activeJobs.filter((j) => {
      const t = j.updated_at ? new Date(j.updated_at).getTime() : 0;
      return t > 0 && now - t > ms7;
    });

    const oldMaterials = materials.filter((m) => {
      const t = m.added_at ? new Date(m.added_at).getTime() : 0;
      return t > 0 && now - t > ms3;
    });

    const pendingInspections = todayEvents.filter((e) => e.kind === 'inspection');

    const out = [];
    if (stale.length > 0) {
      out.push({
        id: 'stale',
        icon: AlertCircle,
        tone: 'red',
        title: `${stale.length} job${stale.length === 1 ? '' : 's'} behind schedule`,
        subtitle: stale.slice(0, 2).map((j) => j.client_name).filter(Boolean).join(', ') || '—',
      });
    }
    if (oldMaterials.length > 0) {
      out.push({
        id: 'mats',
        icon: Briefcase,
        tone: 'orange',
        title: 'Material delivery delayed',
        subtitle: 'Check the Materials Run',
      });
    }
    if (pendingInspections.length > 0) {
      const ev = pendingInspections[0];
      const job = ev.jobs;
      out.push({
        id: 'inspection',
        icon: CalendarDays,
        tone: 'blue',
        title: `${pendingInspections.length} inspection${pendingInspections.length === 1 ? '' : 's'} pending`,
        subtitle: job?.client_name ? `${job.client_name}${job.service ? ' – ' + job.service : ''}` : ev.title,
      });
    }
    return out;
  }, [activeJobs, materials, todayEvents]);

  // ─── Today's Jobs progress + status ────────────────────────────
  function jobProgressPct(job) {
    const phases = job?.phase_data?.phases || [];
    let total = 0, done = 0;
    for (const p of phases) {
      for (const it of (p.items || [])) {
        total += 1;
        if (it.done || it.completed) done += 1;
      }
    }
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }
  function jobOnTrack(job) {
    // No fancy schedule yet — heuristic: stale = at risk, fresh = on
    // track. Same threshold as the issues panel.
    const t = job.updated_at ? new Date(job.updated_at).getTime() : Date.now();
    return Date.now() - t <= 7 * 24 * 60 * 60 * 1000;
  }

  // Group materials by store for the shopping list.
  const byStore = useMemo(() => {
    const map = {};
    for (const m of materials) {
      const k = m.store || 'Unspecified';
      (map[k] = map[k] || []).push(m);
    }
    // Stable sort: named stores A→Z, Unspecified last.
    return Object.entries(map).sort(([a], [b]) => {
      if (a === 'Unspecified') return 1;
      if (b === 'Unspecified') return -1;
      return a.localeCompare(b);
    });
  }, [materials]);

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      <div className="p-4 md:p-6 lg:p-8 space-y-5 max-w-6xl mx-auto">

        {/* ─── Header — brand row (logo + alerts) then the greeting,
            so the home screen is clearly identified as Omega. ───── */}
        <div className="flex items-center justify-between gap-3">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            <Avatar
              name={user?.name || ''}
              photoUrl={photoUrl || undefined}
              size="sm"
              color={colorFromName(user?.name || '')}
            />
            <button
              onClick={() => onNavigate?.('notifications')}
              className="relative p-2.5 rounded-xl bg-white border border-gray-100 shadow-sm hover:border-omega-orange transition-colors"
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5 text-omega-charcoal" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-omega-orange text-white">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
          </div>
        </div>
        <header>
          <h1 className="text-2xl sm:text-3xl font-black text-omega-charcoal inline-flex items-center gap-2">
            {greeting}, {user?.name || 'there'} <span>👋</span>
          </h1>
          <p className="text-sm text-omega-stone mt-1">{nowLabel}</p>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => { setError(null); load(); }} className="text-xs font-bold text-red-700 hover:text-red-900 px-2 py-1 rounded-lg hover:bg-red-100">Retry</button>
          </div>
        )}

        {/* ─── Today's Jobs ──────────────────────────────────── */}
        <section id="manager-jobs-today" className="bg-white rounded-2xl border border-gray-100 shadow-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-omega-charcoal">Today's Jobs</h2>
            <button onClick={() => onNavigate?.('calendar')} className="text-xs font-semibold text-omega-orange hover:text-omega-dark">
              View full schedule
            </button>
          </div>

          {loading ? (
            <p className="text-xs text-omega-stone py-8 text-center">Loading…</p>
          ) : activeJobs.length === 0 ? (
            <p className="text-xs text-omega-stone py-8 text-center italic">No jobs in progress today.</p>
          ) : (
            <ul className="space-y-3">
              {activeJobs.map((j) => {
                const pct = jobProgressPct(j);
                const onTrack = jobOnTrack(j);
                return (
                  <li key={j.id} className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_auto_auto] gap-3 items-center border-l-4 border-omega-orange pl-3 sm:pl-4 py-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-omega-charcoal truncate">{j.client_name || 'Untitled'}</p>
                        {j.service && (
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-omega-pale text-omega-orange">
                            {j.service}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-omega-stone truncate mt-0.5">
                        {[j.address, j.city].filter(Boolean).join(', ')}
                      </p>
                    </div>
                    <div className="min-w-[120px]">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-bold text-omega-charcoal">{pct}%</span>
                        <span className="text-omega-stone">Progress</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full bg-omega-orange" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md whitespace-nowrap ${
                      onTrack ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {onTrack ? 'On Track' : 'At Risk'}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => onOpenFullJob?.(j)}
                        className="inline-flex items-center gap-1 px-2 py-2.5 rounded-lg border border-gray-200 hover:border-omega-orange text-[11px] font-bold text-omega-charcoal"
                        title="Open job"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> Open
                      </button>
                      <button
                        onClick={() => onSelectJob?.(j)}
                        className="inline-flex items-center gap-1 px-2 py-2.5 rounded-lg border border-gray-200 hover:border-omega-orange text-[11px] font-bold text-omega-charcoal"
                        title="Update progress (Phase Breakdown)"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Update
                      </button>
                      <button
                        onClick={() => onSelectJob?.(j)}
                        className="inline-flex items-center gap-1 px-2 py-2.5 rounded-lg border border-red-200 hover:bg-red-50 text-[11px] font-bold text-red-700"
                        title="Flag an issue (Phase Breakdown)"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> Issue
                      </button>
                      <button
                        onClick={() => setReceiptJob(j)}
                        className="inline-flex items-center gap-1 px-2.5 py-2.5 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-[12px] font-bold shadow-sm"
                        title="Snap a material receipt"
                      >
                        <Receipt className="w-4 h-4" /> Receipt
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ─── To Do List ─────────────────────────────────────── */}
        <section id="manager-punch-list">
          <QuickTasksList user={user} />
        </section>

        {/* ─── Materials Run ──────────────────────────────────── */}
        <section>
          <MaterialsInline
            byStore={byStore}
            totalCount={materials.length}
            loading={loading}
            onMark={markBought}
            onOpenFull={() => onNavigate?.('materials-run')}
          />
        </section>
      </div>

      {receiptJob && (
        <ReceiptCaptureModal
          job={receiptJob}
          user={user}
          onClose={() => setReceiptJob(null)}
          onSaved={() => {
            // Materials list is independent of expenses, but the
            // Issues panel uses `updated_at` heuristics — a fresh
            // reload keeps everything in sync after a save.
            load();
          }}
        />
      )}
    </div>
  );
}

// ─── Materials Run inline ──────────────────────────────────────
// Soft orange tint in the header so Gabriel can spot this block at
// a glance. Body stays white for readability over long lists.
function MaterialsInline({ byStore, totalCount, loading, onMark, onOpenFull }) {
  return (
    <section className="bg-white rounded-2xl border border-omega-orange/20 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-omega-orange/15 bg-omega-pale/50 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-omega-orange" />
          <h2 className="text-sm font-bold text-omega-charcoal tracking-tight">Materials Run</h2>
          <span className="text-[10px] font-bold text-omega-orange bg-white/70 px-2 py-0.5 rounded-full">
            {totalCount} {totalCount === 1 ? 'item' : 'items'}
          </span>
        </div>
        <button
          onClick={onOpenFull}
          className="text-[11px] text-omega-orange font-bold inline-flex items-center gap-1 hover:underline"
        >
          Open full <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {loading && <p className="px-4 py-3 text-xs text-omega-stone">Loading…</p>}

      {!loading && totalCount === 0 && (
        <p className="px-4 py-6 text-xs text-omega-stone italic text-center">
          Nothing to buy right now. Materials added inside a job show up here.
        </p>
      )}

      {!loading && byStore.map(([store, items]) => (
        <div key={store} className="border-t border-gray-100 first-of-type:border-t-0">
          <div className="px-4 py-2 bg-omega-pale/30 flex items-center gap-1.5">
            <Store className="w-3 h-3 text-omega-orange" />
            <p className="text-[11px] uppercase tracking-wider font-bold text-omega-slate">{store}</p>
            <span className="text-[10px] font-bold text-omega-stone ml-auto">{items.length}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
                <button
                  onClick={() => onMark(m)}
                  className="mt-0.5 w-5 h-5 rounded border-2 border-gray-300 hover:border-omega-orange hover:bg-omega-pale flex-shrink-0 flex items-center justify-center transition-colors"
                  title="Mark bought"
                  aria-label="Mark bought"
                >
                  <Check className="w-3 h-3 text-omega-orange opacity-40 hover:opacity-100" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-omega-charcoal">{m.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-omega-stone mt-0.5">
                    {m.quantity && <span className="font-semibold">{m.quantity}</span>}
                    {m.jobs?.client_name && <span>· {m.jobs.client_name}</span>}
                    {m.jobs?.city && <span>· {m.jobs.city}</span>}
                    {m.notes && <span className="italic">· {m.notes}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ─── Today's schedule ──────────────────────────────────────────
// Formal calendar events + an implicit "working on" row for every
// in-progress job. The whole card is clickable to open the month view.
function TodaySchedule({ events, inProgress, loading, onOpenCalendar, onOpenJob }) {
  const hasEvents  = events.length > 0;
  const hasJobs    = inProgress.length > 0;
  const empty      = !loading && !hasEvents && !hasJobs;

  return (
    <section className="bg-white rounded-2xl border border-violet-200 overflow-hidden shadow-sm">
      <button
        onClick={onOpenCalendar}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-violet-100 bg-violet-50/60 hover:bg-violet-50 text-left transition-colors"
      >
        <div className="inline-flex items-center gap-2">
          <Calendar className="w-4 h-4 text-violet-600" />
          <h2 className="text-sm font-bold text-omega-charcoal tracking-tight">Today's Schedule</h2>
          <span className="text-[10px] font-bold text-violet-700 bg-white/70 px-2 py-0.5 rounded-full">
            {events.length + inProgress.length}
          </span>
        </div>
        <span className="text-[11px] text-violet-600 font-bold inline-flex items-center gap-1">
          Open calendar <ChevronRight className="w-3 h-3" />
        </span>
      </button>

      {loading && <p className="px-4 py-3 text-xs text-omega-stone">Loading…</p>}

      {empty && (
        <p className="px-4 py-6 text-xs text-omega-stone italic text-center">
          Nothing scheduled today.
        </p>
      )}

      {hasEvents && (
        <ul className="divide-y divide-gray-100">
          {events.map((ev) => (
            <li key={ev.id} className="px-4 py-2.5 flex items-center gap-3">
              <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-700 font-bold text-[11px] tabular-nums flex-shrink-0">
                {new Date(ev.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </span>
              <span className="text-sm text-omega-charcoal truncate flex-1">{ev.title}</span>
            </li>
          ))}
        </ul>
      )}

      {hasJobs && (
        <div className={hasEvents ? 'border-t border-gray-100' : ''}>
          <p className="px-4 pt-2 text-[10px] uppercase tracking-wider text-omega-stone font-bold">
            Jobs in progress
          </p>
          <ul className="divide-y divide-gray-100">
            {inProgress.map((j) => (
              <li key={j.id} className="px-4 py-2 flex items-center gap-3">
                <HardHat className="w-3.5 h-3.5 text-omega-orange flex-shrink-0" />
                <button
                  onClick={() => onOpenJob?.(j)}
                  className="text-sm text-omega-charcoal truncate flex-1 text-left hover:text-omega-orange"
                >
                  {j.client_name || 'Untitled'}
                  {j.service && <span className="text-omega-stone font-normal"> · {j.service}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
