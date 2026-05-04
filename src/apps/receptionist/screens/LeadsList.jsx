import { useEffect, useMemo, useState } from 'react';
import { Pencil, X, Search, ArrowUp, ArrowDown, ArrowUpDown, Edit3, Save, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from '../components/Toast';
import PhoneInput from '../../../shared/components/PhoneInput';
import { toE164 } from '../../../shared/lib/phone';
import { validateUserPin } from '../../../shared/lib/userPin';
import { logAudit } from '../../../shared/lib/audit';
import { CITIES_BY_STATE, STATES, SERVICES, LEAD_SOURCES, PIPELINE_STATUSES, LEAD_STATUSES, leadStatusMeta } from '../lib/leadCatalog';

const FILTERS = [
  { id: 'today', label: 'Today' },
  { id: 'week',  label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all',   label: 'All' },
];

// Lead status meta is sourced from leadCatalog.LEAD_STATUSES — kept
// in one place so a new option only needs the migration + the catalog.

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
  { id: 'project',  label: 'Project',      get: (r) => joinedServices(r) },
  { id: 'appt',     label: 'Appt Date',    get: (r) => r.preferred_visit_date || '' },
  // Status column reflects LEAD_STATUS (Rafaela's tag), NOT
  // pipeline_status. Sort key is the label so A→Z grouping makes sense.
  { id: 'status',   label: 'Status',       get: (r) => (leadStatusMeta(r.lead_status)?.label || '') },
  // Pipeline visibility — drives whether the lead shows on Attila's
  // kanban. Toggle ON is free, OFF requires PIN (see saveInPipeline).
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

export default function LeadsList({ user, onBack }) {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingLead, setEditingLead] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date'); // column id
  const [sortDir, setSortDir] = useState('desc'); // asc | desc
  // PIN gate when toggling OFF a lead that's currently in the pipeline.
  // Free in the other direction (promoting cold → pipeline).
  const [pinGate, setPinGate] = useState(null); // { lead } | null

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function load() {
    setLoading(true);
    try {
      let q = supabase
        .from('jobs')
        .select('id, client_name, client_email, client_phone, address, city, unit_number, service, additional_services, lead_source, pipeline_status, lead_status, in_pipeline, preferred_visit_date, lead_date, created_at, last_touch_at, last_touch_note')
        .eq('created_by', 'receptionist')
        .order('created_at', { ascending: false })
        .limit(500);

      const gt = startOf(filter);
      if (gt) q = q.gte('created_at', gt);

      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
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

  // Toggles whether this lead is visible in Attila's kanban.
  // PROMOTE (false → true): no PIN required. Also resets
  // pipeline_status to 'new_lead' so the lead lands in Attila's New
  // Lead column ready for him to start the questionnaire — same
  // entry point a brand-new lead from the receptionist takes.
  // EJECT (true → false): PIN required (own user). Pipeline_status
  // is left alone so the lead's history is preserved if it's
  // promoted again later.
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

  // PIN gate — opens the modal only when the user is trying to
  // EJECT a lead. Promotion goes straight through.
  function requestPipelineToggle(lead) {
    if (!lead.in_pipeline) {
      setInPipeline(lead, true);
      return;
    }
    setPinGate({ lead });
  }

  // Inline lead_status update from the table dropdown. Optimistic —
  // we patch the row immediately and rollback on failure. Empty string
  // resets the lead to "no status yet" (NULL in the DB).
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

  // Commits the EditLead form back to Supabase and updates the in-memory row.
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

  function toggleSort(colId) {
    if (sortBy === colId) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(colId);
      // Date/Touch default to desc (newest first); text columns default to asc.
      setSortDir(colId === 'date' || colId === 'touch' ? 'desc' : 'asc');
    }
  }

  // Client-side search across the key free-text fields.
  // Phone search ignores formatting by stripping non-digits on both sides.
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const digitsNeedle = needle.replace(/\D/g, '');
    let out = rows;
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
    const col = COLUMNS.find((c) => c.id === sortBy);
    if (col) {
      const sign = sortDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => sign * compare(col.get(a), col.get(b)));
    }
    return out;
  }, [rows, search, sortBy, sortDir]);

  const empty = !loading && visibleRows.length === 0;

  return (
    <div className="flex-1 flex flex-col bg-omega-cloud overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="bg-white border-b border-gray-200 px-6 md:px-8 py-5 flex-shrink-0">
        <h1 className="text-xl font-bold text-omega-charcoal">My Leads</h1>
        <p className="text-xs text-omega-stone mt-0.5">Leads you created — click a column to sort, use the search to find old leads.</p>
      </header>

      <div className="bg-white border-b border-gray-200 px-6 md:px-8 py-2 flex flex-wrap gap-2 items-center flex-shrink-0">
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

        <div className="relative flex-1 min-w-[220px] max-w-md ml-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, address…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-omega-cloud focus:bg-white focus:border-omega-orange focus:outline-none"
          />
        </div>

        <span className="ml-auto self-center text-xs text-omega-stone">
          {visibleRows.length}{search ? ` / ${rows.length}` : ''} lead{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <main className="flex-1 overflow-auto">
        {loading && <p className="text-sm text-omega-stone text-center py-10">Loading…</p>}
        {empty && (
          <div className="text-center py-12">
            <p className="text-sm text-omega-stone">
              {search ? `No leads match "${search}".` : 'No leads yet.'}
            </p>
            {!search && (
              <button
                onClick={onBack}
                className="mt-4 inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
              >
                Create a lead
              </button>
            )}
          </div>
        )}

        {!loading && visibleRows.length > 0 && (
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
                        {r.client_name || <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate capitalize max-w-[200px]">
                        {joinedServices(r) || <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                        {r.preferred_visit_date ? fmtDateOnly(r.preferred_visit_date) : <span className="text-omega-stone">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {/* Inline-editable lead_status. Pill is the
                            <select>'s background so the click target
                            matches the visual chip — no separate
                            "edit" affordance needed. Native select on
                            iPad gives Rafaela the standard wheel
                            picker she's already used to. */}
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
                        <button
                          onClick={() => setEditingLead(r)}
                          title="Edit lead details"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-omega-slate hover:text-omega-orange hover:bg-omega-pale/60 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
    </div>
  );
}

// ─── Pipeline visibility toggle ──────────────────────────────────
// Compact iOS-style switch. Orange when on, grey when off. Same
// visual idiom Rafaela's already familiar with from the other
// switches in the app.
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
      <span
        className={`w-7 h-3.5 rounded-full relative ${on ? 'bg-white/30' : 'bg-gray-300'}`}
      >
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
// Asks for the LOGGED-IN user's own PIN. Promoting cold → pipeline
// is intentionally NOT gated — it's a positive action and the bar
// to entry should stay low. The reverse (yanking a lead Attila has
// been working) costs a few seconds of friction so it's deliberate.
function PipelinePinModal({ lead, user, onClose, onConfirm }) {
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  async function verify() {
    setError('');
    setVerifying(true);
    try {
      const ok = await validateUserPin(user, pin);
      if (!ok) {
        setError('Wrong PIN — try again.');
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
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') verify(); }}
          placeholder="Your PIN"
          className="w-full px-3 py-3 rounded-xl border border-gray-300 focus:border-omega-orange focus:ring-1 focus:ring-omega-orange outline-none text-center text-lg tracking-[0.4em] font-bold"
        />
        {error && (
          <p className="mt-2 text-xs text-red-600 font-semibold">{error}</p>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-omega-slate text-sm font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={verify}
            disabled={verifying || !pin}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold disabled:opacity-60"
          >
            {verifying ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline pill-shaped <select> for the Status column. Tinted with the
// status's own colors when set; neutral grey + "Set status…" when null.
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
  const [note, setNote] = useState(lead.last_touch_note || '');
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
// Full-form editor for leads already in the database. The fields mirror
// NewLead so the receptionist can fix a typo, add missing info, or move
// an old backfill lead to its correct state.

// Splits `client_name` into first/last on a best-effort basis for the
// form. The user can edit both halves freely.
function splitName(name) {
  if (!name) return { first: '', last: '' };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// The lead's stored `address` already contains street + city + state + zip.
// For editing we split the FIRST segment (street+unit) out so the user can
// edit it, and keep city/unit/zip as their own columns.
function extractStreet(address) {
  if (!address) return '';
  return address.split(',')[0].trim();
}

// Best-effort: pull the state code (CT/NY/NJ) out of a stored address.
// Returns 'CT' as default for old rows that never had the state picker.
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
    notes:           lead.last_touch_note || '',
  });
  const [saving, setSaving] = useState(false);

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
    const stateCode = (form.state || 'CT').toUpperCase();
    const fullAddress = [streetLine, form.city, stateCode].filter(Boolean).join(', ');
    const e164 = toE164(form.phone) || form.phone.trim() || null;
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
          {/* Row 1: Date + Status */}
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

          {/* Row 1b: Lead Status — Rafaela's quick tag, separate from
              pipeline. Lives just below pipeline so editors see both
              tracks side by side and don't confuse them. */}
          <div>
            <label className={labelCls}>Lead Status</label>
            <select className={inputCls} value={form.lead_status} onChange={(e) => set('lead_status', e.target.value)}>
              <option value="">— None —</option>
              {LEAD_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Row 2: Name */}
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

          {/* Row 3: Phone + Email */}
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

          {/* Row 4: Address + Unit */}
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

          {/* Row 5: State + City. State drives the city list — switching
              state clears the picked city so we don't end up with a
              CT town stamped on a NY lead. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>State</label>
              <select
                className={inputCls}
                value={form.state}
                onChange={(e) => {
                  set('state', e.target.value);
                  set('city', '');
                }}
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

          {/* Row 6: Source */}
          <div>
            <label className={labelCls}>Lead Source</label>
            <select className={inputCls} value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)}>
              <option value="">Select…</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Row 7: Services (multi) */}
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
