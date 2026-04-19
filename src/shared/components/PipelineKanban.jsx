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
import { Search, Filter, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LoadingSpinner from './LoadingSpinner';
import Toast from './Toast';
import JobFullView from './JobFullView';
import { PIPELINE_STEP_LABEL } from '../config/phaseBreakdown';
import { logAudit } from '../lib/audit';

// ─── Pipeline columns (order matters) ──────────────────────────────
export const PIPELINE_COLUMNS = [
  { id: 'new_lead',           label: 'New Lead',          headerBg: 'bg-gray-400',    headerText: 'text-white',   colBg: 'bg-gray-50' },
  { id: 'estimate_sent',      label: 'Estimate Sent',     headerBg: 'bg-blue-500',    headerText: 'text-white',   colBg: 'bg-blue-50/60' },
  { id: 'estimate_approved',  label: 'Estimate Approved', headerBg: 'bg-purple-500',  headerText: 'text-white',   colBg: 'bg-purple-50/60' },
  { id: 'contract_sent',      label: 'Contract Sent',     headerBg: 'bg-omega-orange',headerText: 'text-white',   colBg: 'bg-omega-pale' },
  { id: 'contract_signed',    label: 'Contract Signed',   headerBg: 'bg-amber-400',   headerText: 'text-white',   colBg: 'bg-amber-50' },
  { id: 'in_progress',        label: 'In Progress',       headerBg: 'bg-green-400',   headerText: 'text-white',   colBg: 'bg-green-50' },
  { id: 'completed',          label: 'Completed',         headerBg: 'bg-green-700',   headerText: 'text-white',   colBg: 'bg-green-100/60' },
  { id: 'on_hold',            label: 'On Hold',           headerBg: 'bg-red-500',     headerText: 'text-white',   colBg: 'bg-red-50' },
];

// ─── Job Card (simplified) ─────────────────────────────────────────
function JobCard({ job, coiWarning, onOpen, isDragging }) {
  const address = [job.address, job.city].filter(Boolean).join(', ');
  const step = PIPELINE_STEP_LABEL[job.pipeline_status || 'new_lead'] || 'Review Estimate';
  return (
    <div
      onClick={(e) => { if (!isDragging) onOpen(job); }}
      className={`group select-none bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="font-bold text-sm text-omega-charcoal truncate flex-1">{job.client_name || job.name || 'Untitled'}</p>
        {coiWarning && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="Sub with COI expiring" />}
      </div>
      {address && <p className="text-[11px] text-omega-stone truncate mt-0.5">{address}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {job.service && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange font-semibold text-[10px] uppercase">
            {job.service}
          </span>
        )}
      </div>

      <p className="mt-2 text-[11px] font-medium text-omega-slate truncate">{step}</p>
    </div>
  );
}

// ─── Draggable wrapper ─────────────────────────────────────────────
function DraggableJobCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
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
      className={`flex-1 min-h-[200px] p-2 rounded-lg transition-all ${
        isOver ? 'ring-2 ring-[#D4AF37] ring-offset-2' : ''
      }`}
    >
      {children}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────
export default function PipelineKanban({ user, filterBySalesperson = false, readOnly = false, onOpenEstimateFlow, onOpenQuestionnaire }) {
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

  // Maps
  const estByJob = useMemo(() => {
    const map = {};
    estimates.forEach((e) => {
      if (!map[e.job_id] || new Date(e.created_at) > new Date(map[e.job_id].created_at)) {
        map[e.job_id] = e;
      }
    });
    return map;
  }, [estimates]);

  // Jobs with an assigned sub whose COI is expiring within 30 days or expired
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

  // Salesperson filter — case-insensitive match. If nothing matches we fall
  // back to showing all jobs so the screen is never empty.
  // TODO: replace with a real Supabase Auth `created_by` UUID check once PIN
  //       login is swapped for proper auth. Right now we rely on `user.name`
  //       being written to `jobs.salesperson_name` at creation time.
  const salesMatches = useMemo(() => {
    if (!filterBySalesperson || !user?.name) return null;
    const u = user.name.trim().toLowerCase();
    const hits = jobs.filter((j) => (j.salesperson_name || '').trim().toLowerCase() === u);
    return hits.length > 0 ? new Set(hits.map((j) => j.id)) : null; // null = show all
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

  const showSalesFallbackBanner = filterBySalesperson && user?.name && salesMatches === null && jobs.length > 0;

  const cityOptions = useMemo(() => Array.from(new Set(jobs.map((j) => j.city).filter(Boolean))).sort(), [jobs]);
  const serviceOptions = useMemo(() => Array.from(new Set(jobs.map((j) => j.service).filter(Boolean))).sort(), [jobs]);
  const pmOptions = useMemo(() => Array.from(new Set(jobs.map((j) => j.pm_name).filter(Boolean))).sort(), [jobs]);

  // Group jobs by pipeline_status
  const jobsByColumn = useMemo(() => {
    const map = {};
    PIPELINE_COLUMNS.forEach((c) => { map[c.id] = []; });
    visibleJobs.forEach((j) => {
      const key = PIPELINE_COLUMNS.some((c) => c.id === j.pipeline_status) ? j.pipeline_status : 'new_lead';
      map[key].push(j);
    });
    return map;
  }, [visibleJobs]);

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
    if (!PIPELINE_COLUMNS.some((c) => c.id === targetCol)) return;

    const job = jobs.find((j) => j.id === activeJobId);
    if (!job) return;
    const previous = job.pipeline_status || 'new_lead';
    if (previous === targetCol) return;

    // Optimistic update
    setSavingId(activeJobId);
    setJobs((prev) => prev.map((j) => (j.id === activeJobId ? { ...j, pipeline_status: targetCol } : j)));

    const { error } = await supabase.from('jobs').update({ pipeline_status: targetCol }).eq('id', activeJobId);
    setSavingId(null);

    if (error) {
      // Revert
      setJobs((prev) => prev.map((j) => (j.id === activeJobId ? { ...j, pipeline_status: previous } : j)));
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

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal">Pipeline</h1>
            <p className="text-sm text-omega-stone mt-1">
              {filterBySalesperson ? 'Your jobs — drag cards between phases' : 'All jobs — drag cards between phases'}
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
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>
          <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            <option value="all">All cities</option>
            {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            <option value="all">All services</option>
            {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {canSeePmFilter ? (
            <select value={filterPm} onChange={(e) => setFilterPm(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
              <option value="all">All PMs</option>
              {pmOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : <div />}
          <button onClick={clearFilters} className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-semibold hover:border-omega-orange flex items-center justify-center gap-2">
            <Filter className="w-4 h-4" /> Clear filters
          </button>
        </div>

        {showSalesFallbackBanner && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-900">
              No jobs matched your name yet. Showing all jobs for now — jobs must be assigned to "{user.name}" to appear in your personal view.
            </p>
          </div>
        )}
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <div
            className="h-full p-3 gap-2"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${PIPELINE_COLUMNS.length}, minmax(150px, 1fr))`,
              minWidth: `${PIPELINE_COLUMNS.length * 150}px`,
            }}
          >
            {PIPELINE_COLUMNS.map((col) => {
              const list = jobsByColumn[col.id] || [];
              return (
                <div key={col.id} className={`flex flex-col rounded-lg border border-gray-200 ${col.colBg}`}>
                  <div className={`flex items-center justify-between px-2 py-1.5 rounded-t-lg ${col.headerBg} ${col.headerText}`}>
                    <p className="font-bold text-[11px] uppercase tracking-wide truncate">{col.label}</p>
                    <span className="text-[10px] font-semibold bg-white/25 px-1.5 py-0.5 rounded-full flex-shrink-0">{list.length}</span>
                  </div>
                  <DroppableColumn columnId={col.id} isOver={overColumn === col.id}>
                    <div className="flex flex-col gap-2 min-h-[100px]">
                      {list.map((j) => (
                        <DraggableJobCard key={j.id} id={j.id}>
                          {({ isDragging }) => (
                            <JobCard
                              job={j}
                              coiWarning={coiWarningByJob.has(j.id)}
                              onOpen={readOnly ? () => {} : setOpenJob}
                              isDragging={isDragging}
                            />
                          )}
                        </DraggableJobCard>
                      ))}
                      {list.length === 0 && (
                        <p className="text-[10px] text-omega-fog text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">Drop here</p>
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
            <div style={{ opacity: 0.8, width: 160 }}>
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
    </div>
  );
}
