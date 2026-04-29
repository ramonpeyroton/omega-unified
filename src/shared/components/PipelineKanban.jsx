import { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import {
  Search, Filter, AlertTriangle, PhoneIncoming, Trash2, Home,
  Mail, MapPin, Zap, Hammer, FileText, CheckCircle2, XCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from './LoadingSpinner';
import Toast from './Toast';
import JobFullView from './JobFullView';
import DeleteJobModal from './DeleteJobModal';
import { PIPELINE_STEP_LABEL, PIPELINE_COLORS, PIPELINE_ORDER } from '../config/phaseBreakdown';
import { logAudit } from '../lib/audit';

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
function JobCard({ job, coiWarning, onOpen, onDelete, canDelete, isDragging }) {
  const address = [job.address, job.city].filter(Boolean).join(', ');
  const calledIn = job.created_by === 'receptionist';
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

        {/* Service + called-in badges */}
        {(job.service || calledIn) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ServiceBadge service={job.service} columnHex={col.hex} />
            {calledIn && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-semibold text-[10px] uppercase"
                title="Called in to reception"
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

// ─── Draggable wrapper ─────────────────────────────────────────────
// `touchAction: 'none'` is THE fix for iPad/tablet drag — without it,
// iOS Safari intercepts the touchmove event for native vertical scroll
// before @dnd-kit's TouchSensor sees it. Combined with the TouchSensor's
// 150ms activation delay, a quick tap still scrolls (delay isn't met)
// but a held-then-dragged gesture moves the card.
function DraggableJobCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = {
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : 'grab',
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
function DroppableColumn({ columnId, children, isOver }) {
  const { setNodeRef } = useDroppable({ id: columnId });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-[200px] p-2 transition-all ${
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
  onOpenEstimateFlow, onOpenQuestionnaire,
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
      const [{ data: j }, { data: e }, { data: s }, { data: a }] = await Promise.all([
        supabase.from('jobs').select('*').order('created_at', { ascending: false }),
        supabase.from('estimates').select('*'),
        supabase.from('subcontractors').select('id, coi_expiry_date'),
        supabase.from('phase_subcontractor_assignments').select('job_id, subcontractor_id'),
      ]);
      setJobs(j || []);
      setEstimates(e || []);
      setSubs(s || []);
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
      const amount = Number(est?.total) || 0;
      totals[key] += amount;
    });
    return { jobsByColumn: grouped, totalsByColumn: totals };
  }, [visibleJobs, estByJob]);

  // ─── DnD handlers ────────────────────────────────────────────────
  function handleDragStart(event) {
    if (readOnly) return;
    setActiveId(event.active.id);
  }

  function handleDragOver(event) {
    if (readOnly) return;
    setOverColumn(event.over?.id || null);
  }

  async function handleDragEnd(event) {
    if (readOnly) { setActiveId(null); setOverColumn(null); return; }
    const activeJobId = event.active?.id;
    const targetCol = event.over?.id;
    setActiveId(null);
    setOverColumn(null);
    if (!activeJobId || !targetCol) return;
    if (!COLUMN_BY_ID[targetCol]) return;

    const job = jobs.find((j) => j.id === activeJobId);
    if (!job) return;
    const previous = job.pipeline_status || 'new_lead';
    if (previous === targetCol) return;

    setSavingId(activeJobId);
    setJobs((prev) =>
      prev.map((j) => (j.id === activeJobId ? { ...j, pipeline_status: targetCol } : j))
    );

    const { error } = await supabase
      .from('jobs')
      .update({ pipeline_status: targetCol })
      .eq('id', activeJobId);
    setSavingId(null);

    if (error) {
      setJobs((prev) =>
        prev.map((j) => (j.id === activeJobId ? { ...j, pipeline_status: previous } : j))
      );
      setToast({ type: 'error', message: `Failed to move job: ${error.message}` });
      return;
    }
    logAudit({
      user,
      action: 'job.move',
      entityType: 'job',
      entityId: activeJobId,
      details: { from: previous, to: targetCol, client: job.client_name },
    });
    setToast({ type: 'success', message: 'Job moved' });
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
                ? 'Your jobs — drag cards between phases'
                : 'All jobs — drag cards between phases'}
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
        collisionDetection={closestCenter}
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
                    <div className="flex flex-col gap-2.5 min-h-[100px]">
                      {list.map((j) => (
                        <DraggableJobCard key={j.id} id={j.id}>
                          {({ isDragging }) => (
                            <JobCard
                              job={j}
                              coiWarning={coiWarningByJob.has(j.id)}
                              onOpen={readOnly ? () => {} : setOpenJob}
                              onDelete={setDeleteJob}
                              canDelete={canDelete}
                              isDragging={isDragging}
                            />
                          )}
                        </DraggableJobCard>
                      ))}
                      {list.length === 0 && (
                        <p className="text-[10px] text-omega-fog text-center py-6 border-2 border-dashed border-gray-200 rounded-xl">
                          Drop here
                        </p>
                      )}
                    </div>
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
    </div>
  );
}
