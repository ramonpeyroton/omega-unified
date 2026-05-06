import { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Search, Filter, AlertTriangle, PhoneIncoming, Trash2, Home,
  Mail, MapPin, Zap, Hammer, FileText, CheckCircle2, XCircle,
  Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from './LoadingSpinner';
import Toast from './Toast';
import JobFullView from './JobFullView';
import DeleteJobModal from './DeleteJobModal';
import { PIPELINE_STEP_LABEL, PIPELINE_COLORS, PIPELINE_ORDER } from '../config/phaseBreakdown';
import { logAudit } from '../lib/audit';
import { validateUserPin } from '../lib/userPin';

// Phases that require a PIN confirmation before moving a card into
// them. Anything terminal goes here so a stray drop doesn't quietly
// archive a real lead. Currently only "Estimate Rejected" — the
// kind of phase you want the user to *think* about before committing.
const PIN_GATED_PHASES = new Set(['estimate_rejected']);

// Only Owner, Operations and Admin can initiate a delete from the card.
// The actual PIN (3333) is still required inside DeleteJobModal.
const CAN_DELETE_JOB = new Set(['owner', 'operations', 'admin']);

// ─── Pipeline columns ──────────────────────────────────────────────
// Column metadata is derived from phaseBreakdown.js so order, label
// and color all live in ONE place. Anyone needing column metadata
// imports PIPELINE_COLUMNS from here as before.
export const PIPELINE_COLUMNS = PIPELINE_ORDER.map((id) => ({
  id,
  label: PIPELINE_STEP_LABEL[id] || id,
  hex: PIPELINE_COLORS[id]?.hex || '#6B7280',
  headerBg: PIPELINE_COLORS[id]?.tailwindBg || 'bg-gray-400',
  colBg: PIPELINE_COLORS[id]?.soft || 'bg-gray-50',
}));

const COLUMN_BY_ID = Object.fromEntries(PIPELINE_COLUMNS.map((c) => [c.id, c]));

// True when there's at least one Slack message on this job's Daily
// Logs that the current user hasn't seen yet.
//   slack_last_message_at  : cached on the job row by ProjectChat
//   lastReadIso            : per-user pointer from daily_log_reads
// If we never cached a "last message" we treat the chat as silent —
// no dot. If we have a message but no read pointer, the user has
// definitely never opened the chat → dot.
function isJobUnread(job, lastReadIso) {
  const lastMsg = job?.slack_last_message_at;
  if (!lastMsg) return false;
  if (!lastReadIso) return true;
  return new Date(lastMsg).getTime() > new Date(lastReadIso).getTime();
}

// Re-sort the jobs array using the same precedence the Supabase query
// uses on first load: pipeline_position ASC NULLS LAST, then
// created_at DESC. We need this on the client too because handleDragEnd
// edits a single job in place — without re-sorting the array, the
// updated pipeline_position has no visual effect (the kanban renders
// jobs in array order, bucketized by column, and never re-sorts on its
// own).
function sortJobsForKanban(arr) {
  return [...arr].sort((a, b) => {
    const pa = Number(a?.pipeline_position);
    const pb = Number(b?.pipeline_position);
    const aHas = Number.isFinite(pa);
    const bHas = Number.isFinite(pb);
    if (aHas && bHas) return pa - pb;
    if (aHas) return -1;          // a positioned, b NULL → a first (NULLS LAST)
    if (bHas) return 1;
    // Both NULL — fall back to created_at DESC (newest first), matching
    // the legacy behavior pre-migration 028.
    const ta = new Date(a?.created_at || 0).getTime();
    const tb = new Date(b?.created_at || 0).getTime();
    return tb - ta;
  });
}

// Compact USD formatter for column totals — always shows the $ sign and
// uses K/M abbreviations once we cross thresholds so the header stays
// quiet ("$1.2M" reads better than "$1,234,567" in a narrow column).
function fmtMoneyShort(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

// Subtle "X days ago" — we want vibe, not precision. Falls back to
// the locale date string if the row is older than ~3 weeks.
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 0) return d.toLocaleDateString();
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 21)  return `${days}d ago`;
  return d.toLocaleDateString();
}

// Pick a card-footer icon that matches the pipeline phase. Just visual
// flavor — clicking still opens JobFullView, the icon doesn't drive UX.
function footerIconFor(status) {
  switch (status) {
    case 'estimate_draft':       return FileText;
    case 'estimate_sent':        return Mail;
    case 'estimate_negotiating': return MessageIconFallback;
    case 'estimate_approved':    return CheckCircle2;
    case 'contract_sent':        return Mail;
    case 'contract_signed':      return Hammer;
    case 'in_progress':          return Zap;
    case 'completed':            return CheckCircle2;
    case 'estimate_rejected':    return XCircle;
    default:                     return MapPin;
  }
}
// Tiny inline component used as a stand-in icon for "negotiating".
function MessageIconFallback(props) {
  // 16-square message bubble; reused fallback to avoid pulling another lucide import.
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ─── Cover image (or pretty placeholder) ──────────────────────────
// Always rendered at aspect 2:1 with object-cover so a square or
// portrait upload gets center-cropped horizontally instead of making
// cards taller. When the job has no cover yet we paint a soft tinted
// background using the column's hex + a tiny house icon — keeps the
// kanban looking "complete" before anyone uploads anything.
function CardCover({ url, columnHex }) {
  if (url) {
    return (
      <div className="aspect-[2/1] bg-omega-cloud overflow-hidden">
        <img
          src={url}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>
    );
  }
  return (
    <div
      className="aspect-[2/1] flex items-center justify-center"
      style={{
        background: `linear-gradient(135deg, ${columnHex}1A 0%, ${columnHex}33 100%)`,
      }}
    >
      <Home className="w-8 h-8" style={{ color: columnHex, opacity: 0.55 }} />
    </div>
  );
}

// ─── Service badge — colored to match the column ──────────────────
function ServiceBadge({ service, columnHex }) {
  if (!service) return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wider"
      style={{
        background: columnHex + '26' /* ~15% */,
        color: columnHex,
      }}
    >
      {service}
    </span>
  );
}

// ─── Job Card ─────────────────────────────────────────────────────
function JobCard({ job, coiWarning, hasUnread = false, onOpen, onDelete, canDelete, isDragging }) {
  const address = [job.address, job.city].filter(Boolean).join(', ');
  // The receptionist tags every lead with how it came in — Houzz, Angi,
  // Google, Referral, etc. Surface that in place of the old generic
  // "Called In" badge so the team sees the actual marketing channel
  // at a glance. We keep "Called In" only when the row genuinely has
  // no source AND was created by the receptionist (legacy fallback).
  const leadSource = (job.lead_source || '').trim();
  const calledIn   = !leadSource && job.created_by === 'receptionist';
  const col = COLUMN_BY_ID[job.pipeline_status] || COLUMN_BY_ID.new_lead;
  const FooterIcon = footerIconFor(job.pipeline_status);

  return (
    <div
      onClick={(e) => { if (!isDragging) onOpen(job); }}
      className={`group relative select-none bg-white rounded-2xl shadow-card border border-black/[0.04] overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'opacity-60 rotate-1' : ''
      }`}
    >
      {/* Cover banner — landscape, auto-cropped */}
      <CardCover url={job.cover_photo_url} columnHex={col.hex} />

      {/* Unread Daily Logs dot — small red bubble with an exclamation
          mark in the top-left of the cover, mirroring native push
          notifications. Only renders when the current user hasn't
          opened the chat since the latest Slack message landed. */}
      {hasUnread && (
        <span
          className="absolute top-2 left-2 w-5 h-5 rounded-full bg-red-500 ring-2 ring-white shadow-md flex items-center justify-center text-white text-[11px] font-black leading-none"
          title="Unread messages in Daily Logs"
        >
          !
        </span>
      )}

      {/* Delete (trash) — top-right, only on hover */}
      {canDelete && !isDragging && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete?.(job); }}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-omega-stone hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all shadow-sm"
          title="Delete job (requires Owner PIN)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="p-3">
        {/* Client + COI warning */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-sm text-omega-charcoal leading-tight truncate flex-1">
            {job.client_name || job.name || 'Untitled'}
          </p>
          {coiWarning && (
            <AlertTriangle
              className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5"
              title="Sub with COI expiring"
            />
          )}
        </div>

        {address && (
          <p className="text-[11px] text-omega-stone truncate mt-0.5">{address}</p>
        )}

        {/* Service + lead-source badges */}
        {(job.service || leadSource || calledIn) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ServiceBadge service={job.service} columnHex={col.hex} />
            {leadSource && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-semibold text-[10px] uppercase tracking-wider"
                title={`Lead came in via ${leadSource}`}
              >
                <PhoneIncoming className="w-2.5 h-2.5" /> {leadSource}
              </span>
            )}
            {calledIn && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-semibold text-[10px] uppercase"
                title="Called in to reception (no marketing source recorded)"
              >
                <PhoneIncoming className="w-2.5 h-2.5" /> Called In
              </span>
            )}
          </div>
        )}

        {/* Footer: small icon + relative time */}
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-omega-stone">
          <FooterIcon className="w-3 h-3" />
          <span>{relTime(job.last_touch || job.updated_at || job.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Sortable wrapper ──────────────────────────────────────────────
// Each card is sortable AND droppable. Drop on another card → reorders
// (or moves between columns and inserts at that card's slot). Drop on
// the column container → moves to the bottom of that column. The
// `touchAction: 'none'` is THE fix for iPad/tablet drag — without it,
// iOS Safari intercepts the touchmove event for native vertical scroll
// before @dnd-kit's TouchSensor sees it. Combined with the TouchSensor's
// 150ms activation delay, a quick tap still scrolls (delay isn't met)
// but a held-then-dragged gesture moves the card.
function SortableJobCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id });
  const style = {
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : 'grab',
    // We deliberately ignore @dnd-kit/sortable's `transition` value here.
    // Cards animate via the parent column's flex layout — re-running
    // the React render after handleDragEnd (which mutates `jobs`
    // ordering) is enough. Adding a CSS transition on transform makes
    // the card snap visibly after the drop, which the user reads as
    // a glitch.
    ...(transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
      : {}),
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {typeof children === 'function' ? children({ isDragging }) : children}
    </div>
  );
}

// ─── Droppable column ──────────────────────────────────────────────
// `overflow-y-auto` is the fix for "I can't see the cards at the bottom
// of New Lead anymore" — without it the column grew past the viewport
// and the parent's overflow-hidden silently clipped them. Now each
// column scrolls independently. `min-h-[200px]` ensures empty columns
// still register a hit area for cross-column drops.
function DroppableColumn({ columnId, children, isOver }) {
  const { setNodeRef } = useDroppable({ id: columnId });
  // ⚠️ min-h-[80vh]: empty columns used to collapse to ~200px,
  // which made them tiny drop targets. When a populated column had
  // 19 cards stretching the row, the user dragging from the bottom
  // had nothing to drop on for the empty siblings — the cursor was
  // way below their hit area. 80vh keeps every column at least the
  // viewport's height so any cross-column drop has somewhere to land.
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-[80vh] p-2 overflow-y-auto transition-all ${
        isOver ? 'ring-2 ring-omega-orange ring-inset rounded-2xl' : ''
      }`}
    >
      {children}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────
export default function PipelineKanban({
  user, filterBySalesperson = false, readOnly = false,
  onOpenEstimateFlow, onOpenQuestionnaire, onStartNewJobForClient,
}) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [subs, setSubs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [toast, setToast] = useState(null);

  const [activeId, setActiveId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [openJob, setOpenJob] = useState(null);
  const [deleteJob, setDeleteJob] = useState(null);

  // True once we observe a "column does not exist" error from Supabase
  // for `pipeline_position`. Toggled at runtime so the kanban keeps
  // working in environments where migration 028 hasn't been applied
  // yet (the deploy beats the SQL by a minute or two). When true, we
  // skip both the order-by and the UPDATE field that mention it.
  const [positionMigrationMissing, setPositionMigrationMissing] = useState(false);

  // Map of job_id → ISO timestamp the current user last opened that
  // job's Daily Logs. Loaded once on mount (one query for the whole
  // kanban) so we don't fan out per-card. A job whose
  // jobs.slack_last_message_at is newer than its read pointer (or
  // missing entirely) gets a red dot on its card.
  const [lastReadByJob, setLastReadByJob] = useState({});

  // PIN-gate state — when the user drops a card on a PIN-gated phase
  // (Estimate Rejected) we stash the move details and show a PIN
  // modal instead of saving immediately. The actual save runs once
  // the user confirms with their own PIN.
  const [pendingMove, setPendingMove] = useState(null);

  const canDelete = !readOnly && CAN_DELETE_JOB.has(user?.role);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [filterCity, setFilterCity] = useState('all');
  const [filterService, setFilterService] = useState('all');
  const [filterPm, setFilterPm] = useState('all');

  const canSeePmFilter = user?.role === 'operations' || user?.role === 'owner';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [user?.name]);

  async function loadAll() {
    setLoading(true);
    try {
      // Order: pipeline_position ASC NULLS LAST, then created_at DESC.
      // Cards the seller has positioned manually win; the rest fall back
      // to "newest first" so a brand-new lead still pops to the top.
      //
      // Visibility model:
      //   • Active rows: in_pipeline = true.
      //   • Estimate Rejected: trigger 038 sets in_pipeline=false on
      //     entry, so the main query MISSES rejected. We pull the 10
      //     most recent rejected separately and merge — that keeps the
      //     column populated as a "recent rejections" surface without
      //     the 200+ historical imports flooding it.
      //
      // We tolerate the column being missing in a fresh env by falling
      // back to the unfiltered query — same defensive pattern used for
      // pipeline_position.
      const [jobsResp, recentRejectedResp, { data: e }, { data: s }, { data: a }] = await Promise.all([
        positionMigrationMissing
          ? supabase.from('jobs').select('*').eq('in_pipeline', true).order('created_at', { ascending: false })
          : supabase
              .from('jobs').select('*')
              .eq('in_pipeline', true)
              .order('pipeline_position', { ascending: true, nullsFirst: false })
              .order('created_at', { ascending: false }),
        // Last 10 rejected — regardless of in_pipeline. Sorted by
        // updated_at so the most recently rejected sit at top of the
        // column. Older rejections live only in My Leads.
        supabase
          .from('jobs').select('*')
          .eq('pipeline_status', 'estimate_rejected')
          .order('updated_at', { ascending: false })
          .limit(10),
        supabase.from('estimates').select('*'),
        supabase.from('subcontractors').select('id, coi_expiry_date'),
        supabase.from('phase_subcontractor_assignments').select('job_id, subcontractor_id'),
      ]);

      let jobsData = jobsResp.data;
      if (jobsResp.error && /pipeline_position/.test(jobsResp.error.message || '')) {
        // Migration 028 hasn't been applied. Retry with legacy ordering
        // and remember so future refreshes skip the bad column straight away.
        setPositionMigrationMissing(true);
        const fallback = await supabase
          .from('jobs').select('*').eq('in_pipeline', true)
          .order('created_at', { ascending: false });
        jobsData = fallback.data;
      } else if (jobsResp.error && /in_pipeline/.test(jobsResp.error.message || '')) {
        // Migration 038 not yet applied. Drop the filter and load
        // everything so the kanban keeps working until the SQL is run.
        const fallback = await supabase
          .from('jobs').select('*')
          .order('created_at', { ascending: false });
        jobsData = fallback.data;
      } else if (jobsResp.error) {
        throw jobsResp.error;
      }

      // Merge the last-10-rejected slice in. We dedupe by id so the
      // (rare) case of a rejected job that's also in_pipeline=true
      // doesn't render twice. Older rejected rows live only in My
      // Leads — they're intentionally absent from the kanban.
      const recentRejected = recentRejectedResp?.data || [];
      const main = jobsData || [];
      const seenIds = new Set(main.map((j) => j.id));
      const merged = main.concat(recentRejected.filter((r) => !seenIds.has(r.id)));

      // Always sort client-side too. In legacy mode (migration 028
      // missing) Supabase ordered only by created_at, so any rows that
      // happened to already have a pipeline_position get bucketed
      // correctly here.
      setJobs(sortJobsForKanban(merged));
      setEstimates(e || []);
      setSubs(s || []);
      // Load this user's read pointers in a separate query so a missing
      // migration 030 doesn't take down the whole pipeline. If the
      // table doesn't exist yet, `error` populates and we just skip
      // (every card will look "unread"; no functional break).
      if (user?.name) {
        try {
          const { data: reads, error: readsErr } = await supabase
            .from('daily_log_reads')
            .select('job_id, last_read_at')
            .eq('user_name', user.name);
          if (!readsErr && Array.isArray(reads)) {
            const map = {};
            for (const row of reads) map[row.job_id] = row.last_read_at;
            setLastReadByJob(map);
          }
        } catch { /* migration 030 missing — silently skip */ }
      }
      setAssignments(a || []);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load pipeline' });
    } finally {
      setLoading(false);
    }
  }

  // Most recent estimate per job — used for column totals.
  const estByJob = useMemo(() => {
    const map = {};
    estimates.forEach((e) => {
      if (!map[e.job_id] || new Date(e.created_at) > new Date(map[e.job_id].created_at)) {
        map[e.job_id] = e;
      }
    });
    return map;
  }, [estimates]);

  // Jobs with an assigned sub whose COI is expiring within 30 days or expired.
  const coiWarningByJob = useMemo(() => {
    const expiringSubs = new Set();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    subs.forEach((s) => {
      if (!s.coi_expiry_date) return;
      const exp = new Date(s.coi_expiry_date);
      const days = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
      if (days <= 30) expiringSubs.add(s.id);
    });
    const warn = new Set();
    assignments.forEach((a) => { if (expiringSubs.has(a.subcontractor_id)) warn.add(a.job_id); });
    return warn;
  }, [subs, assignments]);

  // Salesperson filter — case-insensitive match. Falls back to all jobs
  // when nobody matches (otherwise the screen would be silently empty).
  const salesMatches = useMemo(() => {
    if (!filterBySalesperson || !user?.name) return null;
    const u = user.name.trim().toLowerCase();
    const hits = jobs.filter((j) => (j.salesperson_name || '').trim().toLowerCase() === u);
    return hits.length > 0 ? new Set(hits.map((j) => j.id)) : null;
  }, [jobs, filterBySalesperson, user?.name]);

  const visibleJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (salesMatches && !salesMatches.has(j.id)) return false;
      if (filterCity !== 'all' && (j.city || '') !== filterCity) return false;
      if (filterService !== 'all' && (j.service || '') !== filterService) return false;
      if (canSeePmFilter && filterPm !== 'all' && (j.pm_name || '') !== filterPm) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const hay = `${j.name || ''} ${j.client_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, filterCity, filterService, filterPm, searchText, canSeePmFilter, salesMatches]);

  const showSalesFallbackBanner =
    filterBySalesperson && user?.name && salesMatches === null && jobs.length > 0;

  const cityOptions    = useMemo(() => Array.from(new Set(jobs.map((j) => j.city).filter(Boolean))).sort(), [jobs]);
  const serviceOptions = useMemo(() => Array.from(new Set(jobs.map((j) => j.service).filter(Boolean))).sort(), [jobs]);
  const pmOptions      = useMemo(() => Array.from(new Set(jobs.map((j) => j.pm_name).filter(Boolean))).sort(), [jobs]);

  // Group jobs + sum estimate totals by pipeline column.
  const { jobsByColumn, totalsByColumn } = useMemo(() => {
    const grouped = {};
    const totals = {};
    PIPELINE_COLUMNS.forEach((c) => { grouped[c.id] = []; totals[c.id] = 0; });
    visibleJobs.forEach((j) => {
      const key = COLUMN_BY_ID[j.pipeline_status] ? j.pipeline_status : 'new_lead';
      grouped[key].push(j);
      const est = estByJob[j.id];
      const amount = Number(est?.total_amount) || 0;
      totals[key] += amount;
    });
    return { jobsByColumn: grouped, totalsByColumn: totals };
  }, [visibleJobs, estByJob]);

  // ─── DnD handlers ────────────────────────────────────────────────
  // The drag target (`event.over.id`) can be either a column id or
  // another job's id. Helpers below normalize that.
  function resolveTargetColumn(overId) {
    if (!overId) return null;
    if (COLUMN_BY_ID[overId]) return overId;            // dropped on column
    const overJob = jobs.find((j) => j.id === overId);  // dropped on a card
    return overJob ? (overJob.pipeline_status || 'new_lead') : null;
  }

  // Spacing constant — large enough that midpoint inserts can keep
  // halving for ~50 nests at the same slot before float precision
  // bites. In practice the seller will drop in different spots over
  // time, which keeps the spread wide.
  const POS_GAP = 1000;

  // Compute a `pipeline_position` value for the moved card so it lands
  // immediately before the row at `dropIndex` in the target column.
  // `dropIndex >= targetList.length` means "append to the bottom".
  function computeNewPosition(targetList, dropIndex) {
    if (targetList.length === 0) return POS_GAP;
    if (dropIndex <= 0) {
      const first = Number(targetList[0].pipeline_position);
      return Number.isFinite(first) ? first - POS_GAP : POS_GAP;
    }
    if (dropIndex >= targetList.length) {
      const last = Number(targetList[targetList.length - 1].pipeline_position);
      return Number.isFinite(last) ? last + POS_GAP : POS_GAP * (dropIndex + 1);
    }
    const before = Number(targetList[dropIndex - 1].pipeline_position);
    const after  = Number(targetList[dropIndex].pipeline_position);
    if (Number.isFinite(before) && Number.isFinite(after)) return (before + after) / 2;
    if (Number.isFinite(before)) return before + POS_GAP;
    if (Number.isFinite(after))  return after - POS_GAP;
    return POS_GAP * (dropIndex + 1);
  }

  function handleDragStart(event) {
    if (readOnly) return;
    setActiveId(event.active.id);
  }

  function handleDragOver(event) {
    if (readOnly) return;
    setOverColumn(resolveTargetColumn(event.over?.id));
  }

  async function handleDragEnd(event) {
    if (readOnly) { setActiveId(null); setOverColumn(null); return; }
    const activeJobId = event.active?.id;
    const overId = event.over?.id;
    setActiveId(null);
    setOverColumn(null);
    if (!activeJobId || !overId || activeJobId === overId) return;

    const targetCol = resolveTargetColumn(overId);
    if (!targetCol) return;

    const job = jobs.find((j) => j.id === activeJobId);
    if (!job) return;
    const previous = job.pipeline_status || 'new_lead';

    // Reconstruct the target column's current order from the SAME jobs
    // array (already sorted by pipeline_position then created_at via
    // loadAll). We strip the moved card so dropIndex math stays correct.
    const targetList = jobs
      .filter((j) => (j.pipeline_status || 'new_lead') === targetCol && j.id !== activeJobId);

    let dropIndex;
    if (overId === targetCol) {
      // Dropped onto the column container — bottom of the list.
      dropIndex = targetList.length;
    } else {
      const idx = targetList.findIndex((j) => j.id === overId);
      // Defensive: if the over-card isn't in the rebuilt list (shouldn't
      // happen, but cross-column drops can race state updates), append.
      dropIndex = idx === -1 ? targetList.length : idx;
    }

    const newPosition = computeNewPosition(targetList, dropIndex);

    // No-op detection: same column AND same position-neighbors.
    if (previous === targetCol && Number(job.pipeline_position) === newPosition) return;

    // PIN gate — moves into a terminal phase (e.g. Estimate Rejected)
    // pause here and pop a PIN modal so the user has to confirm with
    // their own PIN. The actual save runs from `confirmPendingMove`
    // once the PIN checks out.
    if (PIN_GATED_PHASES.has(targetCol)) {
      setPendingMove({ activeJobId, previous, targetCol, newPosition, job });
      return;
    }

    await commitMove({ activeJobId, previous, targetCol, newPosition, job });
  }

  // Shared move-persistence used by both the normal drag path and the
  // PIN-gated path. Optimistic state update first, then DB write,
  // with a fallback to legacy patch shape if migration 028 is
  // missing. Rolls back on failure and toasts the error.
  async function commitMove({ activeJobId, previous, targetCol, newPosition, job }) {
    setSavingId(activeJobId);
    // Optimistic update + RE-SORT — without the sort, the array stays
    // in the same order even though the moved card has a new
    // pipeline_position, so the kanban renders the card in its OLD
    // visual slot. The sort uses the same precedence as the Supabase
    // load query (position ASC NULLS LAST, created_at DESC).
    setJobs((prev) =>
      sortJobsForKanban(prev.map((j) => (j.id === activeJobId
        ? { ...j, pipeline_status: targetCol, pipeline_position: newPosition, in_pipeline: true }
        : j)))
    );

    // Dragging a card by definition puts it in the pipeline. Any cold
    // lead Attila drags in becomes visible to everyone else (otherwise
    // his bypass lets him see it but Brenda / Inácio still wouldn't).
    // The trigger from migration 038 still flips it back to false on
    // moves to estimate_rejected — that's the desired outcome.
    const fullPatch = { pipeline_status: targetCol, pipeline_position: newPosition, in_pipeline: true };
    const legacyPatch = { pipeline_status: targetCol, in_pipeline: true };
    let { error } = await supabase
      .from('jobs')
      .update(positionMigrationMissing ? legacyPatch : fullPatch)
      .eq('id', activeJobId);

    // If we tried to write pipeline_position but the migration is
    // missing, retry without it so the column-move still persists.
    // From there on the kanban operates in legacy mode until the
    // migration ships.
    if (error && /pipeline_position/.test(error.message || '')) {
      setPositionMigrationMissing(true);
      const retry = await supabase.from('jobs').update(legacyPatch).eq('id', activeJobId);
      error = retry.error;
    }
    setSavingId(null);

    if (error) {
      setJobs((prev) =>
        sortJobsForKanban(prev.map((j) => (j.id === activeJobId
          ? { ...j, pipeline_status: previous, pipeline_position: job.pipeline_position }
          : j)))
      );
      setToast({ type: 'error', message: `Failed to move job: ${error.message}` });
      return;
    }

    if (previous === targetCol && positionMigrationMissing) {
      setToast({
        type: 'error',
        message: 'In-column reorder needs migration 028 to persist. Run migrations/028_pipeline_position.sql.',
      });
      return;
    }

    if (previous !== targetCol) {
      logAudit({
        user,
        action: 'job.move',
        entityType: 'job',
        entityId: activeJobId,
        details: { from: previous, to: targetCol, client: job.client_name, source: 'kanban' },
      });
      setToast({ type: 'success', message: 'Job moved' });
    }
  }

  // Cancels a pending PIN-gated move — drops the optimistic state
  // change and clears the modal. Called by the modal's Cancel and the
  // outside-click handler.
  function cancelPendingMove() {
    setPendingMove(null);
  }

  async function confirmPendingMove() {
    if (!pendingMove) return;
    await commitMove(pendingMove);
    setPendingMove(null);
  }

  function clearFilters() {
    setFilterCity('all'); setFilterService('all'); setFilterPm('all'); setSearchText('');
  }

  const activeJob = activeId ? jobs.find((j) => j.id === activeId) : null;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Pipeline</h1>
            <p className="text-sm text-omega-stone mt-1">
              {filterBySalesperson
                ? 'Your jobs — drag to reorder or move between phases'
                : 'All jobs — drag to reorder or move between phases'}
            </p>
          </div>
          {savingId && <span className="text-xs text-omega-stone">Saving…</span>}
        </div>

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search client or job…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
            />
          </div>
          <select
            value={filterCity}
            onChange={(e) => setFilterCity(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
          >
            <option value="all">All cities</option>
            {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filterService}
            onChange={(e) => setFilterService(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
          >
            <option value="all">All services</option>
            {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {canSeePmFilter ? (
            <select
              value={filterPm}
              onChange={(e) => setFilterPm(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none transition"
            >
              <option value="all">All PMs</option>
              {pmOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : <div />}
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:border-omega-orange hover:text-omega-orange flex items-center justify-center gap-2 transition"
          >
            <Filter className="w-4 h-4" /> Clear filters
          </button>
        </div>

        {showSalesFallbackBanner && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-900">
              No jobs matched your name yet. Showing all jobs for now — jobs must be assigned to "{user.name}" to appear in your personal view.
            </p>
          </div>
        )}
      </header>

      <DndContext
        sensors={sensors}
        // closestCorners gives nicer feel than closestCenter when a card
        // is hovering between two siblings — the closest *edge* wins, so
        // dropping at the top vs bottom of a card is unambiguous.
        collisionDetection={closestCorners}
        // Auto-scroll: the kanban has 10 columns and the rightmost ones
        // (Completed / Rejected) are usually off-screen. Without these
        // explicit thresholds the DroppableColumn's own overflow-y-auto
        // captures the auto-scroll and the user can't drag a card past
        // the right edge of the viewport. Threshold 0.15 fires the
        // horizontal scroll a bit sooner, and the slightly higher
        // acceleration makes the trip across the kanban quick enough
        // not to feel like dragging molasses.
        autoScroll={{
          enabled: true,
          threshold: { x: 0.15, y: 0.20 },
          acceleration: 18,
          interval: 5,
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <div
            className="h-full p-4 gap-3"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${PIPELINE_COLUMNS.length}, minmax(220px, 1fr))`,
              minWidth: `${PIPELINE_COLUMNS.length * 220}px`,
            }}
          >
            {PIPELINE_COLUMNS.map((col) => {
              const list = jobsByColumn[col.id] || [];
              const total = totalsByColumn[col.id] || 0;
              return (
                <div
                  key={col.id}
                  className="flex flex-col rounded-2xl bg-white shadow-card border border-black/[0.04] overflow-hidden"
                >
                  {/* Colored header strip — column color is the source of truth */}
                  <div
                    className="px-3 py-2.5 text-white"
                    style={{ background: col.hex }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-[11px] uppercase tracking-wider truncate">
                        {col.label}
                      </p>
                      <span className="text-[10px] font-bold bg-white/25 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        {list.length}
                      </span>
                    </div>
                    {/* Disguised total — small, semi-transparent, non-shouty */}
                    <p className="text-[11px] font-semibold text-white/70 mt-0.5 tabular-nums">
                      {fmtMoneyShort(total)}
                    </p>
                  </div>

                  <DroppableColumn columnId={col.id} isOver={overColumn === col.id}>
                    <SortableContext
                      items={list.map((j) => j.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex flex-col gap-2.5 min-h-[100px]">
                        {list.map((j) => (
                          <SortableJobCard key={j.id} id={j.id}>
                            {({ isDragging }) => (
                              <JobCard
                                job={j}
                                coiWarning={coiWarningByJob.has(j.id)}
                                // hasUnread tells the card to render the
                                // small red dot when this user hasn't
                                // opened Daily Logs since the latest
                                // Slack message landed.
                                hasUnread={isJobUnread(j, lastReadByJob[j.id])}
                                // Read-only roles still open JobFullView so they can SEE
                                // the card details — JobFullView itself gates which tabs
                                // and actions render based on user.role. Used by the
                                // receptionist's read-only kanban view.
                                onOpen={setOpenJob}
                                onDelete={setDeleteJob}
                                canDelete={canDelete}
                                isDragging={isDragging}
                              />
                            )}
                          </SortableJobCard>
                        ))}
                        {list.length === 0 && (
                          <p className="text-[10px] text-omega-fog text-center py-6 border-2 border-dashed border-gray-200 rounded-xl">
                            Drop here
                          </p>
                        )}
                      </div>
                    </SortableContext>
                  </DroppableColumn>
                </div>
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {activeJob && (
            <div style={{ opacity: 0.85, width: 220 }}>
              <JobCard
                job={activeJob}
                coiWarning={coiWarningByJob.has(activeJob.id)}
                onOpen={() => {}}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {openJob && (
        <JobFullView
          job={openJob}
          user={user}
          onClose={() => setOpenJob(null)}
          onJobUpdated={(updated) => {
            setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
            setOpenJob(updated);
          }}
          onJobDeleted={(deleted) => {
            setJobs((prev) => prev.filter((j) => j.id !== deleted.id));
            setOpenJob(null);
            setToast({ type: 'success', message: 'Job deleted successfully' });
          }}
          onOpenEstimateFlow={onOpenEstimateFlow}
          onOpenQuestionnaire={onOpenQuestionnaire}
          onStartNewJobForClient={onStartNewJobForClient}
        />
      )}

      {deleteJob && (
        <DeleteJobModal
          job={deleteJob}
          user={user}
          onClose={() => setDeleteJob(null)}
          onDeleted={(d) => {
            setJobs((prev) => prev.filter((j) => j.id !== d.id));
            setDeleteJob(null);
            setToast({ type: 'success', message: 'Job deleted' });
          }}
        />
      )}

      {pendingMove && (
        <PinConfirmModal
          user={user}
          targetLabel={PIPELINE_STEP_LABEL[pendingMove.targetCol] || pendingMove.targetCol}
          jobName={pendingMove.job?.client_name || 'this job'}
          onCancel={cancelPendingMove}
          onConfirm={confirmPendingMove}
        />
      )}
    </div>
  );
}

// ─── PIN confirmation modal — opens whenever a card is dropped on a
// PIN-gated phase (Estimate Rejected). Validates the pin against the
// CURRENT user via users table + hardcoded fallback. Fails closed.
function PinConfirmModal({ user, targetLabel, jobName, onCancel, onConfirm }) {
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setErr('');
    setBusy(true);
    try {
      const ok = await validateUserPin(user, pin);
      if (!ok) { setErr('Wrong PIN. Try again.'); return; }
      onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => !busy && onCancel()}>
      <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200">
          <p className="font-bold text-omega-charcoal text-lg">Confirm move to {targetLabel}</p>
          <p className="text-sm text-omega-stone mt-1">
            Moving <strong>{jobName}</strong> to a terminal phase. Type your own PIN to confirm — this stops accidental drops.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase">Your PIN</label>
            <div className="relative mt-1">
              <input
                autoFocus
                type={show ? 'text' : 'password'}
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
                className="w-full px-3 py-2.5 pr-10 rounded-lg border-2 border-gray-200 focus:border-omega-orange focus:outline-none text-base font-mono tracking-[0.3em]"
                placeholder="••••"
              />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-omega-stone">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {err && <p className="text-xs text-red-600 font-semibold mt-1.5">{err}</p>}
          </div>
        </div>
        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={busy || !pin} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Confirming…' : 'Confirm Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
