import { useEffect, useMemo, useState } from 'react';
import {
  Pencil, X, Search, ArrowUp, ArrowDown, ArrowUpDown,
  Edit3, Save, Lock, Eye, EyeOff, ExternalLink, Trash2,
  LayoutGrid, List, SlidersHorizontal, ClipboardList,
} from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import Toast from '../components/Toast';
import PhoneInput from '../../../shared/components/PhoneInput';
import { toE164 } from '../../../shared/lib/phone';
import { validateUserPinDetailed } from '../../../shared/lib/userPin';
import { logAudit } from '../../../shared/lib/audit';
import { CITIES_BY_STATE, STATES, SERVICES, LEAD_SOURCES, PIPELINE_STATUSES, LEAD_STATUSES, leadStatusMeta } from '../lib/leadCatalog';

const FILTERS = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all',   label: 'All' },
];

// Sort options for card view — mirrors the COLUMNS list so the same
// sort key works in both modes (list uses column headers, cards uses
// the dropdown here).
const CARD_SORT_OPTIONS = [
  { id: 'date',     label: 'Date' },
  { id: 'name',     label: 'Name' },
  { id: 'address',  label: 'Address' },
  { id: 'phone',    label: 'Phone' },
  { id: 'source',   label: 'Source' },
  { id: 'project',  label: 'Project' },
  { id: 'owner',    label: 'Owner' },
  { id: 'appt',     label: 'Appt Date' },
  { id: 'status',   label: 'Status' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'touch',    label: 'Last Touch' },
];

// Left-border accent color for card view.
// Priority: appointment_set (blue) > follow_up (amber) > lost/declined (red)
//           > in_pipeline (orange) > default (gray).
function getCardBorderColor(r) {
  if (r.lead_status === 'appointment_set')               return '#378ADD';
  if (r.lead_status === 'follow_up')                     return '#EF9F27';
  if (r.lead_status === 'lost' || r.lead_status === 'declined') return '#E24B4A';
  if (r.in_pipeline)                                     return '#D85A30';
  return '#888780';
}

// Default view mode per role.
// sales / owner (MacBook) → cards.
// receptionist / operations / marketing (desktop) → list.
function defaultViewForRole(role) {
  if (role === 'sales' || role === 'owner') return 'cards';
  return 'list';
}

function startOf(scope) {
  const d = new Date();
  if (scope === 'today') { d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (scope === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  if (scope === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString(); }
  return null;
}

function fmtShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

function fmtDateOnly(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${Number(m)}/${Number(d)}/${y.slice(-2)}`;
}

// Date used in the DATE column: lead_date is authoritative when present
// (hand-entered for backfills); falls back to created_at otherwise.
function effectiveDate(r) {
  return r.lead_date || r.created_at || null;
}

function joinedServices(r) {
  const parts = [r.service, ...(Array.isArray(r.additional_services) ? r.additional_services : [])]
    .filter(Boolean);
  return parts.join(', ');
}

// Columns configuration — label + sort key resolver.
const COLUMNS = [
  { id: 'date',     label: 'Date',         get: (r) => effectiveDate(r) || '' },
  { id: 'source',   label: 'Source',       get: (r) => r.lead_source || '' },
  { id: 'email',    label: 'Email',        get: (r) => r.client_email || '' },
  { id: 'address',  label: 'Address',      get: (r) => r.address || r.city || '' },
  { id: 'phone',    label: 'Phone #',      get: (r) => r.client_phone || '' },
  { id: 'name',     label: 'Name',         get: (r) => r.client_name || '' },
  { id: 'owner',    label: 'Owner',        get: (r) => r.lead_owner || '' },
  { id: 'project',  label: 'Project',      get: (r) => joinedServices(r) },
  { id: 'appt',     label: 'Appt Date',    get: (r) => r.appt_date_effective || '' },
  { id: 'status',   label: 'Status',       get: (r) => (leadStatusMeta(r.lead_status)?.label || '') },
  { id: 'pipeline', label: 'Pipeline',     get: (r) => (r.in_pipeline ? 'Yes' : 'No') },
  { id: 'touch',    label: 'Last Touch',   get: (r) => r.last_touch_at || '' },
  { id: 'notes',    label: 'Info / Notes', get: (r) => r.last_touch_note || '' },
  { id: 'edit',     label: '',             get: () => '', sortable: false },
];

function compare(a, b) {
  if (a === b) return 0;
  if (a === '' || a == null) return 1;
  if (b === '' || b == null) return -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export default function LeadsList({ user, onBack, onOpenJob }) {
  const [filter, setFilter]         = useState('all');
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [editing, setEditing]       = useState(null);       // last-touch modal
  const [editingLead, setEditingLead] = useState(null);     // full edit modal
  const [search, setSearch]         = useState('');
  const [sortBy, setSortBy]         = useState('date');
  const [sortDir, setSortDir]       = useState('desc');
  const [pinGate, setPinGate]       = useState(null);       // { lead } | null
  const [deletingLead, setDeletingLead] = useState(null);   // lead | null

  // ── View mode + filter state ────────────────────────────────────
  const [viewMode, setViewMode]         = useState(() => defaultViewForRole(user?.role));
  const [prefLoaded, setPrefLoaded]     = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters]           = useState({ status: '', source: '', owner: '', pipeline: '' });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  // Load saved view preferences from user_preferences table.
  // Silent on error — table may not exist yet (migration 062 pending).
  useEffect(() => {
    if (!user?.name || prefLoaded) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('user_preferences')
          .select('leads_view_mode, leads_sort_field, leads_sort_dir')
          .eq('user_name', user.name)
          .maybeSingle();
        if (!active) return;
        if (data) {
          if (data.leads_view_mode)  setViewMode(data.leads_view_mode);
          if (data.leads_sort_field) setSortBy(data.leads_sort_field);
          if (data.leads_sort_dir)   setSortDir(data.leads_sort_dir);
        }
      } catch { /* table not yet created — silent */ }
      finally   { if (active) setPrefLoaded(true); }
    })();
    return () => { active = false; };
  }, [user?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a view preference change (upsert keyed on user_name).
  async function saveViewPref({ mode, field, dir } = {}) {
    if (!user?.name) return;
    try {
      await supabase.from('user_preferences').upsert(
        {
          user_name:        user.name,
          leads_view_mode:  mode  ?? viewMode,
          leads_sort_field: field ?? sortBy,
          leads_sort_dir:   dir   ?? sortDir,
          updated_at:       new Date().toISOString(),
        },
        { onConflict: 'user_name' }
      );
    } catch { /* silent */ }
  }

  function handleViewMode(mode) {
    setViewMode(mode);
    saveViewPref({ mode });
  }

  async function load() {
    setLoading(true);
    try {
      let q = supabase
        .from('jobs')
        .select('id, client_name, client_email, client_phone, address, city, unit_number, service, additional_services, lead_source, pipeline_status, lead_status, in_pipeline, lead_owner, assigned_to, preferred_visit_date, lead_date, created_at, last_touch_at, last_touch_note')
        .order('created_at', { ascending: false })
        .limit(2000);

      const gt = startOf(filter);
      if (gt) q = q.gte('created_at', gt);

      const { data, error } = await q;
      if (error) throw error;

      const ids = (data || []).map((r) => r.id);
      let apptByJob = {};
      if (ids.length) {
        const { data: events } = await supabase
          .from('calendar_events')
          .select('id, job_id, starts_at, kind')
          .eq('kind', 'sales_visit')
          .in('job_id', ids)
          .order('starts_at', { ascending: true });
        const now = Date.now();
        const future = {};
        const past   = {};
        for (const ev of (events || [])) {
          if (!ev.job_id || !ev.starts_at) continue;
          const t = new Date(ev.starts_at).getTime();
          if (t >= now) {
            if (!future[ev.job_id]) future[ev.job_id] = ev.starts_at;
          } else {
            past[ev.job_id] = ev.starts_at;
          }
        }
        for (const jid of ids) apptByJob[jid] = future[jid] || past[jid] || null;
      }

      const decorated = (data || []).map((r) => ({
        ...r,
        appt_date_effective: apptByJob[r.id] || r.preferred_visit_date || null,
      }));
      setRows(decorated);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load leads' });
    } finally {
      setLoading(false);
    }
  }

  async function saveTouch(id, note) {
    const trimmed = (note || '').trim();
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('jobs')
        .update({
          last_touch_note: trimmed || null,
          last_touch_at:   trimmed ? nowIso : null,
        })
        .eq('id', id);
      if (error) throw error;
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, last_touch_note: trimmed || null, last_touch_at: trimmed ? nowIso : null }
            : r
        )
      );
      setToast({ type: 'success', message: trimmed ? 'Last touch saved' : 'Last touch cleared' });
      setEditing(null);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    }
  }

  async function setInPipeline(lead, nextValue) {
    const id = lead.id;
    const prevRows = rows;
    const patch = nextValue
      ? { in_pipeline: true, pipeline_status: 'new_lead' }
      : { in_pipeline: false };
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const { error } = await supabase.from('jobs').update(patch).eq('id', id);
      if (error) throw error;
      logAudit({
        user,
        action: nextValue ? 'lead.promote_to_pipeline' : 'lead.eject_from_pipeline',
        entityType: 'job',
        entityId: id,
        details: { client: lead.client_name },
      });
      setToast({
        type: 'success',
        message: nextValue
          ? `${lead.client_name || 'Lead'} promoted to pipeline.`
          : `${lead.client_name || 'Lead'} removed from pipeline.`,
      });
    } catch (err) {
      setRows(prevRows);
      setToast({ type: 'error', message: err.message || 'Failed to update pipeline.' });
    }
  }

  function requestPipelineToggle(lead) {
    if (!lead.in_pipeline) {
      setInPipeline(lead, true);
      return;
    }
    setPinGate({ lead });
  }

  async function saveLeadStatus(id, value) {
    const next = value || null;
    const prev = rows;
    setRows((p) => p.map((r) => (r.id === id ? { ...r, lead_status: next } : r)));
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ lead_status: next })
        .eq('id', id);
      if (error) throw error;
      setToast({ type: 'success', message: next ? `Status: ${leadStatusMeta(next)?.label || next}` : 'Status cleared' });
    } catch (err) {
      setRows(prev);
      setToast({ type: 'error', message: err.message || 'Failed to update status' });
    }
  }

  async function saveLead(id, patch) {
    try {
      const { error } = await supabase.from('jobs').update(patch).eq('id', id);
      if (error) throw error;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      setToast({ type: 'success', message: 'Lead updated' });
      setEditingLead(null);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save lead' });
    }
  }

  async function deleteLead(lead) {
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', lead.id);
      if (error) throw error;
      setRows((prev) => prev.filter((r) => r.id !== lead.id));
      setDeletingLead(null);
      await logAudit({ action: 'lead.delete', target_id: lead.id, details: { client_name: lead.client_name } });
      setToast({ type: 'success', message: 'Lead deleted' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to delete lead' });
    }
  }

  function toggleSort(colId) {
    let nextField = colId;
    let nextDir;
    if (sortBy === colId) {
      nextDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(nextDir);
    } else {
      nextDir = colId === 'date' || colId === 'touch' ? 'desc' : 'asc';
      setSortBy(colId);
      setSortDir(nextDir);
    }
    saveViewPref({ field: nextField, dir: nextDir });
  }

  // Unique lead owners derived from loaded rows — used by the Owner filter.
  const uniqueOwners = useMemo(() => {
    const set = new Set(rows.map((r) => r.lead_owner).filter(Boolean));
    return [...set].sort();
  }, [rows]);

  // Active filters as [key, value] pairs for chip display.
  const activeFilters = Object.entries(filters).filter(([, v]) => v !== '');

  function filterChipLabel(key, value) {
    if (key === 'status')   return leadStatusMeta(value)?.label || value;
    if (key === 'pipeline') return value === 'yes' ? 'In Pipeline' : 'Not in Pipeline';
    return value;
  }

  // Client-side search + filter + sort.
  const visibleRows = useMemo(() => {
    const needle      = search.trim().toLowerCase();
    const digitsNeedle = needle.replace(/\D/g, '');
    let out = rows;

    // Text search
    if (needle) {
      out = rows.filter((r) => {
        if (r.client_name?.toLowerCase().includes(needle)) return true;
        if (r.client_email?.toLowerCase().includes(needle)) return true;
        if (r.address?.toLowerCase().includes(needle)) return true;
        if (r.city?.toLowerCase().includes(needle)) return true;
        if (r.last_touch_note?.toLowerCase().includes(needle)) return true;
        if (digitsNeedle && (r.client_phone || '').replace(/\D/g, '').includes(digitsNeedle)) return true;
        return false;
      });
    }

    // Categorical filters
    if (filters.status)             out = out.filter((r) => r.lead_status === filters.status);
    if (filters.source)             out = out.filter((r) => r.lead_source === filters.source);
    if (filters.owner)              out = out.filter((r) => r.lead_owner  === filters.owner);
    if (filters.pipeline === 'yes') out = out.filter((r) => !!r.in_pipeline);
    if (filters.pipeline === 'no')  out = out.filter((r) => !r.in_pipeline);

    // Sort
    const col = COLUMNS.find((c) => c.id === sortBy);
    if (col) {
      const sign = sortDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => sign * compare(col.get(a), col.get(b)));
    }
    return out;
  }, [rows, search, sortBy, sortDir, filters]);

  const empty = !loading && visibleRows.length === 0;

  return (
    <div className="flex-1 flex flex-col bg-omega-cloud overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <PageHeader
        onBack={onBack}
        icon={ClipboardList}
        title="My Leads"
        subtitle="All leads — search, filter, and toggle between list and cards view."
      />

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 md:px-8 py-2 flex flex-wrap gap-2 items-center flex-shrink-0">
        {/* Period tabs */}
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${
              filter === f.id
                ? 'bg-omega-orange text-white'
                : 'bg-omega-cloud text-omega-slate hover:bg-gray-100'
            }`}
          >
            {f.label}
          </button>
        ))}

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm ml-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            type="search"
            name="omega-leads-search"
            autoComplete="off"
            data-form-type="other"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, address…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-omega-cloud focus:bg-white focus:border-omega-orange focus:outline-none"
          />
        </div>

        {/* Sort-by select (only in cards view — list uses column headers) */}
        {viewMode === 'cards' && (
          <select
            value={sortBy}
            onChange={(e) => toggleSort(e.target.value)}
            className="text-xs font-semibold border border-gray-200 rounded-xl px-3 py-2 bg-omega-cloud text-omega-slate focus:border-omega-orange focus:outline-none"
            title="Sort by"
          >
            {CARD_SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        )}

        {/* Sort direction toggle (cards view only) */}
        {viewMode === 'cards' && (
          <button
            onClick={() => {
              const next = sortDir === 'asc' ? 'desc' : 'asc';
              setSortDir(next);
              saveViewPref({ dir: next });
            }}
            title={sortDir === 'asc' ? 'Ascending — click to reverse' : 'Descending — click to reverse'}
            className="p-2 rounded-xl border border-gray-200 bg-omega-cloud text-omega-slate hover:border-omega-orange hover:text-omega-orange transition-colors"
          >
            {sortDir === 'asc'
              ? <ArrowUp className="w-3.5 h-3.5" />
              : <ArrowDown className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Filters button */}
        <button
          onClick={() => setShowFilterPanel((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
            showFilterPanel || activeFilters.length > 0
              ? 'border-omega-orange bg-omega-pale text-omega-charcoal'
              : 'border-gray-200 bg-omega-cloud text-omega-slate hover:border-omega-orange'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeFilters.length > 0 && (
            <span className="ml-0.5 w-4 h-4 rounded-full bg-omega-orange text-white text-[9px] font-bold inline-flex items-center justify-center">
              {activeFilters.length}
            </span>
          )}
        </button>

        {/* View toggle: List | Cards */}
        <div className="inline-flex items-center border border-gray-200 rounded-xl overflow-hidden">
          <button
            onClick={() => handleViewMode('list')}
            title="List view"
            className={`p-2 transition-colors ${
              viewMode === 'list'
                ? 'bg-omega-orange text-white'
                : 'bg-omega-cloud text-omega-slate hover:text-omega-charcoal'
            }`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleViewMode('cards')}
            title="Cards view"
            className={`p-2 transition-colors ${
              viewMode === 'cards'
                ? 'bg-omega-orange text-white'
                : 'bg-omega-cloud text-omega-slate hover:text-omega-charcoal'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Lead count */}
        <span className="ml-auto self-center text-xs text-omega-stone whitespace-nowrap">
          {visibleRows.length}{search || activeFilters.length > 0 ? ` / ${rows.length}` : ''} lead{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ── Filter panel ─────────────────────────────────────────── */}
      {showFilterPanel && (
        <div className="bg-white border-b border-gray-200 px-6 md:px-8 py-3 flex flex-wrap gap-3 items-center flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-omega-stone whitespace-nowrap">Status</span>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:border-omega-orange focus:outline-none"
            >
              <option value="">All</option>
              {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-omega-stone whitespace-nowrap">Source</span>
            <select
              value={filters.source}
              onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:border-omega-orange focus:outline-none"
            >
              <option value="">All</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-omega-stone whitespace-nowrap">Owner</span>
            <select
              value={filters.owner}
              onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:border-omega-orange focus:outline-none"
            >
              <option value="">All</option>
              {uniqueOwners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-omega-stone whitespace-nowrap">Pipeline</span>
            <select
              value={filters.pipeline}
              onChange={(e) => setFilters((f) => ({ ...f, pipeline: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:border-omega-orange focus:outline-none"
            >
              <option value="">All</option>
              <option value="yes">In Pipeline</option>
              <option value="no">Not in Pipeline</option>
            </select>
          </div>

          {activeFilters.length > 0 && (
            <button
              onClick={() => setFilters({ status: '', source: '', owner: '', pipeline: '' })}
              className="text-xs text-omega-stone hover:text-red-500 transition-colors font-semibold ml-auto"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── Active filter chips ───────────────────────────────────── */}
      {activeFilters.length > 0 && (
        <div className="bg-omega-cloud/50 border-b border-gray-100 px-6 md:px-8 py-2 flex flex-wrap gap-2 items-center flex-shrink-0">
          {activeFilters.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-blue-50 text-blue-900 text-xs font-semibold border border-blue-200"
            >
              <span className="text-blue-400 text-[10px] uppercase tracking-wider">{key}:</span>
              {filterChipLabel(key, value)}
              <button
                onClick={() => setFilters((f) => ({ ...f, [key]: '' }))}
                className="ml-1 w-4 h-4 rounded-full bg-blue-200 hover:bg-blue-400 text-blue-800 hover:text-white inline-flex items-center justify-center transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        {loading && <p className="text-sm text-omega-stone text-center py-10">Loading…</p>}

        {empty && (
          <div className="text-center py-12">
            <p className="text-sm text-omega-stone">
              {search || activeFilters.length > 0
                ? 'No leads match your filters.'
                : 'No leads yet.'}
            </p>
            {!search && activeFilters.length === 0 && (
              <button
                onClick={onBack}
                className="mt-4 inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
              >
                Create a lead
              </button>
            )}
          </div>
        )}

        {/* ── List view ─────────────────────────────────────────── */}
        {!loading && visibleRows.length > 0 && viewMode === 'list' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1200px]">
              <thead className="bg-omega-cloud sticky top-0 z-10">
                <tr>
                  {COLUMNS.map((col) => (
                    <SortHeader
                      key={col.id}
                      col={col}
                      active={sortBy === col.id}
                      dir={sortDir}
                      onClick={() => toggleSort(col.id)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const ls = leadStatusMeta(r.lead_status);
                  return (
                    <tr key={r.id} className="hover:bg-omega-cloud/60 border-b border-gray-100 align-top">
                      <td className="px-3 py-2 text-xs text-omega-charcoal whitespace-nowrap">{fmtShortDate(effectiveDate(r))}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.lead_source ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-omega-slate font-semibold">
                            {r.lead_source}
                          </span>
                        ) : <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate truncate max-w-[180px]" title={r.client_email || ''}>
                        {r.client_email || <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate max-w-[240px]">
                        {r.address || r.city || <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                        {r.client_phone || <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-omega-charcoal whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{r.client_name || <span className="text-omega-stone">—</span>}</span>
                          {onOpenJob && (
                            <button
                              onClick={() => onOpenJob(r)}
                              title="Open job card"
                              className="flex-shrink-0 p-0.5 rounded text-omega-stone hover:text-omega-orange hover:bg-omega-pale transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                        {r.lead_owner || <span className="text-omega-stone italic">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate capitalize max-w-[200px]">
                        {joinedServices(r) || <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                        {r.appt_date_effective
                          ? (r.appt_date_effective.includes('T')
                              ? new Date(r.appt_date_effective).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
                              : fmtDateOnly(r.appt_date_effective))
                          : <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <LeadStatusSelect
                          value={r.lead_status || ''}
                          meta={ls}
                          onChange={(v) => saveLeadStatus(r.id, v)}
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <PipelineToggle
                          on={!!r.in_pipeline}
                          onToggle={() => requestPipelineToggle(r)}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                        {r.last_touch_at ? fmtShortDate(r.last_touch_at) : <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setEditing(r)}
                          className="text-left flex items-start gap-1.5 text-xs text-omega-slate hover:text-omega-orange group max-w-[240px]"
                        >
                          <span className="line-clamp-2">
                            {r.last_touch_note || <span className="text-omega-stone italic">Add note…</span>}
                          </span>
                          <Pencil className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => setEditingLead(r)}
                            title="Edit lead details"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-omega-slate hover:text-omega-orange hover:bg-omega-pale/60 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                          {user?.role === 'operations' && (
                            <button
                              onClick={() => setDeletingLead(r)}
                              title="Delete lead"
                              className="p-1 rounded-md text-omega-stone hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Cards view ────────────────────────────────────────── */}
        {!loading && visibleRows.length > 0 && viewMode === 'cards' && (
          <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 auto-rows-min">
            {visibleRows.map((r) => (
              <LeadCard
                key={r.id}
                r={r}
                onOpenJob={onOpenJob}
                onEdit={() => setEditingLead(r)}
                onEditTouch={() => setEditing(r)}
                onStatusChange={(v) => saveLeadStatus(r.id, v)}
                onPipelineToggle={() => requestPipelineToggle(r)}
                onDelete={() => setDeletingLead(r)}
                user={user}
              />
            ))}
          </div>
        )}
      </main>

      {editing && (
        <LastTouchModal
          lead={editing}
          onClose={() => setEditing(null)}
          onSave={(note) => saveTouch(editing.id, note)}
        />
      )}

      {editingLead && (
        <EditLeadModal
          lead={editingLead}
          onClose={() => setEditingLead(null)}
          onSave={(patch) => saveLead(editingLead.id, patch)}
        />
      )}

      {pinGate && (
        <PipelinePinModal
          lead={pinGate.lead}
          user={user}
          onClose={() => setPinGate(null)}
          onConfirm={async () => {
            await setInPipeline(pinGate.lead, false);
            setPinGate(null);
          }}
        />
      )}

      {deletingLead && (
        <DeleteLeadModal
          lead={deletingLead}
          onClose={() => setDeletingLead(null)}
          onConfirm={() => deleteLead(deletingLead)}
        />
      )}
    </div>
  );
}

// ─── Lead card (card view) ────────────────────────────────────────
// Colored left border (3 px) gives instant visual priority signal.
// Footer row has the status selector, pipeline toggle, and action
// buttons so the most-frequent actions are reachable without opening
// a modal.
function LeadCard({ r, onOpenJob, onEdit, onEditTouch, onStatusChange, onPipelineToggle, onDelete, user }) {
  const ls          = leadStatusMeta(r.lead_status);
  const borderColor = getCardBorderColor(r);
  const services    = joinedServices(r);

  return (
    <div
      className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden"
      style={{ borderLeftColor: borderColor, borderLeftWidth: 3 }}
    >
      {/* ── Header: badges + date ── */}
      <div className="px-3 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {ls && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${ls.cls}`}>
              {ls.label}
            </span>
          )}
          {r.lead_source && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-omega-slate border border-gray-200">
              {r.lead_source}
            </span>
          )}
        </div>
        <span className="text-[10px] text-omega-stone whitespace-nowrap flex-shrink-0 mt-0.5">
          {fmtShortDate(effectiveDate(r))}
        </span>
      </div>

      {/* ── Name + open-job button ── */}
      <div className="px-3 pb-1 flex items-center gap-1.5">
        <span className="font-bold text-omega-charcoal text-sm truncate flex-1">
          {r.client_name || <span className="italic text-omega-stone font-normal">No name</span>}
        </span>
        {onOpenJob && (
          <button
            onClick={() => onOpenJob(r)}
            title="Open job card"
            className="flex-shrink-0 p-1 rounded text-omega-stone hover:text-omega-orange hover:bg-omega-pale transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ── Contact info ── */}
      <div className="px-3 pb-2 space-y-0.5">
        {r.client_phone && (
          <p className="text-xs text-omega-slate">{r.client_phone}</p>
        )}
        {r.client_email && (
          <p className="text-xs text-omega-slate truncate" title={r.client_email}>{r.client_email}</p>
        )}
        {(r.address || r.city) && (
          <p className="text-xs text-omega-stone truncate">{r.address || r.city}</p>
        )}
      </div>

      {/* ── Project + owner ── */}
      {(services || r.lead_owner) && (
        <div className="px-3 pb-2 flex items-center gap-2 min-w-0">
          {services && (
            <span className="text-xs text-omega-stone capitalize truncate flex-1">{services}</span>
          )}
          {r.lead_owner && (
            <span className="text-xs font-semibold text-omega-slate flex-shrink-0 whitespace-nowrap">{r.lead_owner}</span>
          )}
        </div>
      )}

      {/* ── Appointment ── */}
      {r.appt_date_effective && (
        <div className="px-3 pb-2">
          <span className="inline-flex items-center text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
            Appt:{' '}
            {r.appt_date_effective.includes('T')
              ? new Date(r.appt_date_effective).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
              : fmtDateOnly(r.appt_date_effective)}
          </span>
        </div>
      )}

      {/* ── Last touch note ── */}
      {r.last_touch_note && (
        <div className="mx-3 mb-2 p-2 rounded-lg bg-amber-50 border border-amber-100">
          <p className="text-[11px] text-amber-800 line-clamp-2">{r.last_touch_note}</p>
          {r.last_touch_at && (
            <p className="text-[9px] text-amber-500 mt-0.5">{fmtShortDate(r.last_touch_at)}</p>
          )}
        </div>
      )}

      {/* ── Footer: status select + pipeline + action buttons ── */}
      <div className="mt-auto border-t border-gray-100 px-3 py-2 flex items-center gap-2 flex-wrap">
        <LeadStatusSelect
          value={r.lead_status || ''}
          meta={ls}
          onChange={onStatusChange}
        />
        <PipelineToggle on={!!r.in_pipeline} onToggle={onPipelineToggle} />
        <div className="ml-auto flex items-center gap-0.5">
          {!r.last_touch_note && (
            <button
              onClick={onEditTouch}
              title="Add last touch note"
              className="p-1.5 rounded-lg text-omega-stone hover:text-amber-600 hover:bg-amber-50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onEdit}
            title="Edit lead"
            className="p-1.5 rounded-lg text-omega-stone hover:text-omega-orange hover:bg-omega-pale transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          {user?.role === 'operations' && (
            <button
              onClick={onDelete}
              title="Delete lead"
              className="p-1.5 rounded-lg text-omega-stone hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline visibility toggle ──────────────────────────────────
function PipelineToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex items-center gap-2 px-2.5 py-1 rounded-full border transition-colors ${
        on
          ? 'bg-omega-orange border-omega-orange text-white'
          : 'bg-gray-100 border-gray-200 text-omega-stone hover:border-omega-orange'
      }`}
      title={on ? 'Click to remove from pipeline (PIN required)' : 'Click to send to pipeline'}
    >
      <span className={`w-7 h-3.5 rounded-full relative ${on ? 'bg-white/30' : 'bg-gray-300'}`}>
        <span
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider">
        {on ? 'In Pipeline' : 'Off'}
      </span>
    </button>
  );
}

// ─── PIN gate for ejecting a lead from the pipeline ──────────────
const PIN_REASON_MSG = {
  empty_pin:    'Type your PIN to confirm.',
  no_session:   'Your session looks stale — sign out and sign back in.',
  wrong_pin:    'Wrong PIN — try again.',
  role_mismatch:'PIN matches a different role. Sign out and sign back in.',
  name_mismatch:'PIN belongs to another user — double-check the digits.',
  query_failed: 'Network error talking to the server. Try again.',
};

function DeleteLeadModal({ lead, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-omega-charcoal">Delete Lead</h3>
            <p className="text-xs text-omega-stone mt-0.5">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-sm text-omega-slate mb-6">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-omega-charcoal">{lead.client_name || 'this lead'}</span>?
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-omega-slate hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function PipelinePinModal({ lead, user, onClose, onConfirm }) {
  const [pin, setPin]         = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError]     = useState('');
  const [showPin, setShowPin] = useState(false);

  async function verify() {
    setError('');
    setVerifying(true);
    try {
      const result = await validateUserPinDetailed(user, pin);
      if (!result.ok) {
        setError(PIN_REASON_MSG[result.reason] || 'Verification failed.');
        return;
      }
      await onConfirm();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
        <div className="inline-flex items-center gap-2 mb-3">
          <span className="w-9 h-9 rounded-lg bg-red-50 inline-flex items-center justify-center">
            <Lock className="w-4 h-4 text-red-600" />
          </span>
          <div>
            <h3 className="text-base font-bold text-omega-charcoal">Remove from pipeline?</h3>
            <p className="text-xs text-omega-stone">{lead?.client_name || 'Lead'}</p>
          </div>
        </div>
        <p className="text-xs text-omega-slate mb-4">
          The lead will leave Attila's kanban but stay here in My Leads.
          You can promote it back any time. Type your PIN to confirm.
        </p>
        <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <input type="text" name="username" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }} />
          <input type="password" autoComplete="new-password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }} />
          <div className="relative">
            <input
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              name="omega-confirm-pin"
              autoComplete="new-password"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Your PIN"
              className="w-full px-3 py-3 pr-12 rounded-xl border border-gray-300 focus:border-omega-orange focus:ring-1 focus:ring-omega-orange outline-none text-center text-lg tracking-[0.4em] font-bold"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPin((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-omega-stone hover:text-omega-charcoal"
              aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-600 font-semibold">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-omega-slate text-sm font-semibold hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={verifying || !pin}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-60"
            >
              {verifying ? 'Checking…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Inline pill-shaped <select> for the Status column / card footer.
function LeadStatusSelect({ value, meta, onChange }) {
  const cls = meta?.cls || 'bg-gray-100 text-omega-stone border-gray-200';
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border focus:outline-none focus:ring-2 focus:ring-omega-orange/40 cursor-pointer ${cls}`}
    >
      <option value="">Set status…</option>
      {LEAD_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}

function SortHeader({ col, active, dir, onClick }) {
  if (col.sortable === false) {
    return <th className="px-3 py-2 text-left border-b border-gray-200 select-none">&nbsp;</th>;
  }
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="px-3 py-2 text-left border-b border-gray-200 select-none">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
          active ? 'text-omega-orange' : 'text-omega-stone hover:text-omega-charcoal'
        }`}
      >
        {col.label}
        <Icon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  );
}

function LastTouchModal({ lead, onClose, onSave }) {
  const [note, setNote]     = useState(lead.last_touch_note || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(note);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-omega-charcoal">Last Touch</h3>
            <p className="text-xs text-omega-stone mt-0.5">{lead.client_name}</p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-omega-stone hover:text-omega-charcoal">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">
          Follow-up note
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. called left vm / texted"
          rows={4}
          className="w-full px-3 py-2 text-base md:text-sm rounded-xl border border-gray-300 focus:border-omega-orange focus:ring-1 focus:ring-omega-orange outline-none resize-none"
          autoFocus
        />
        <p className="text-[10px] text-omega-stone mt-1.5">
          Timestamp will be set to now when saved. Saving an empty note clears the last touch.
        </p>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-omega-slate text-sm font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit lead modal ────────────────────────────────────────────────
function splitName(name) {
  if (!name) return { first: '', last: '' };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function extractStreet(address) {
  if (!address) return '';
  return address.split(',')[0].trim();
}

function extractState(address) {
  if (!address) return 'CT';
  const m = String(address).match(/\b(CT|NY|NJ)\b/i);
  return m ? m[1].toUpperCase() : 'CT';
}

function EditLeadModal({ lead, onClose, onSave }) {
  const initialName = splitName(lead.client_name);
  const [form, setForm] = useState({
    lead_date:       lead.lead_date || '',
    first_name:      initialName.first,
    last_name:       initialName.last,
    phone:           lead.client_phone || '',
    email:           lead.client_email || '',
    street:          extractStreet(lead.address),
    unit_number:     lead.unit_number || '',
    state:           extractState(lead.address),
    city:            lead.city || '',
    services:        [lead.service, ...(Array.isArray(lead.additional_services) ? lead.additional_services : [])].filter(Boolean),
    lead_source:     lead.lead_source || '',
    pipeline_status: lead.pipeline_status || 'new_lead',
    lead_status:     lead.lead_status || '',
    lead_owner:      lead.lead_owner || '',
    notes:           lead.last_touch_note || '',
  });
  const [saving, setSaving] = useState(false);
  const [staff, setStaff]   = useState([]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('name, role, active')
          .eq('active', true)
          .neq('role', 'admin')
          .order('name', { ascending: true });
        if (active && Array.isArray(data)) setStaff(data);
      } catch { /* fall through */ }
    })();
    return () => { active = false; };
  }, []);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function toggleService(v) {
    setForm((f) => {
      const has = f.services.includes(v);
      return { ...f, services: has ? f.services.filter((x) => x !== v) : [...f.services, v] };
    });
  }

  async function handleSave() {
    setSaving(true);
    const clientName = `${form.first_name.trim()} ${form.last_name.trim()}`.trim();
    const streetLine = form.unit_number.trim()
      ? `${form.street.trim()} ${form.unit_number.trim()}`
      : form.street.trim();
    const stateCode  = (form.state || 'CT').toUpperCase();
    const fullAddress = [streetLine, form.city, stateCode].filter(Boolean).join(', ');
    const e164       = toE164(form.phone) || form.phone.trim() || null;
    const [primary, ...extra] = form.services;

    const patch = {
      lead_date:           form.lead_date || null,
      client_name:         clientName || null,
      client_phone:        e164,
      client_email:        form.email.trim() || null,
      address:             fullAddress || null,
      unit_number:         form.unit_number.trim() || null,
      city:                form.city || null,
      service:             primary || null,
      additional_services: extra.length ? extra : null,
      lead_source:         form.lead_source || null,
      pipeline_status:     form.pipeline_status || null,
      lead_status:         form.lead_status || null,
      lead_owner:          form.lead_owner || null,
    };
    await onSave(patch);
    setSaving(false);
  }

  const labelCls = 'block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1';
  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:border-omega-orange focus:ring-1 focus:ring-omega-orange outline-none';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-2xl p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4 sticky top-0 bg-white pb-2 border-b border-gray-100">
          <div>
            <h3 className="text-base font-bold text-omega-charcoal">Edit Lead</h3>
            <p className="text-xs text-omega-stone mt-0.5">{lead.client_name}</p>
          </div>
          <button onClick={onClose} className="p-1 -m-1 text-omega-stone hover:text-omega-charcoal">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Lead Date</label>
              <input type="date" className={inputCls} value={form.lead_date} onChange={(e) => set('lead_date', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Pipeline Status</label>
              <select className={inputCls} value={form.pipeline_status} onChange={(e) => set('pipeline_status', e.target.value)}>
                {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Lead Status</label>
            <select className={inputCls} value={form.lead_status} onChange={(e) => set('lead_status', e.target.value)}>
              <option value="">— None —</option>
              {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Lead Owner</label>
            <select className={inputCls} value={form.lead_owner} onChange={(e) => set('lead_owner', e.target.value)}>
              <option value="">— Unassigned —</option>
              {staff.map((u) => (
                <option key={u.name} value={u.name}>
                  {u.name}{u.role ? ` · ${u.role}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>First Name</label>
              <input className={inputCls} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Last Name</label>
              <input className={inputCls} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Phone</label>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" inputMode="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div>
              <label className={labelCls}>Street</label>
              <input className={inputCls} value={form.street} onChange={(e) => set('street', e.target.value)} placeholder="123 Main St" />
            </div>
            <div>
              <label className={labelCls}>Unit #</label>
              <input className={inputCls} value={form.unit_number} onChange={(e) => set('unit_number', e.target.value)} placeholder="Apt 4B" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>State</label>
              <select
                className={inputCls}
                value={form.state}
                onChange={(e) => { set('state', e.target.value); set('city', ''); }}
              >
                {STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>City</label>
              <select className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)}>
                <option value="">Select…</option>
                {(CITIES_BY_STATE[form.state] || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Lead Source</label>
            <select className={inputCls} value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)}>
              <option value="">Select…</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Services · {form.services.length} selected</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {SERVICES.map((s) => {
                const active = form.services.includes(s.value);
                return (
                  <button
                    type="button"
                    key={s.value}
                    onClick={() => toggleService(s.value)}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold text-left transition-colors ${
                      active
                        ? 'border-omega-orange bg-omega-pale text-omega-charcoal'
                        : 'border-gray-200 bg-white text-omega-slate hover:border-omega-orange/40'
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5 sticky bottom-0 bg-white pt-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-omega-slate text-sm font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
