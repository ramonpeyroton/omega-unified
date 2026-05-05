import { useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Search, CheckCircle2, Loader2,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

// ─────────────────────────────────────────────────────────────────
// CommissionsScreen — role-aware commissions ledger.
//
// Auto-generated rows come from the trigger in migration 040.
// Roles that hit this screen:
//   • sales        → sees ONLY own sales_signed rows, read-only.
//   • receptionist → sees the consolidated per-client view (visit
//                    + signed merged into one row, amount summed).
//                    Can edit appt_status (her tracking dropdown).
//   • owner / operations / admin → full ledger. Receptionist data
//                    is rendered consolidated; sales stays per-row.
//                    Can edit amount, percent, paid, and appt_status.
//
// Privacy: salesperson never sees receptionist rows and vice versa.
// Even on the same job — the 6% sales commission and the $300
// reception bonus live in independent rows.
// ─────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['owner', 'operations', 'admin']);

const PIPELINE_LABEL = {
  new_lead:             'New Lead',
  estimate_draft:       'Estimate Draft',
  estimate_sent:        'Estimate Sent',
  estimate_negotiating: 'Negotiating',
  estimate_approved:    'Approved',
  estimate_rejected:    'Rejected',
  contract_sent:        'Contract Sent',
  contract_signed:      'Contract Signed',
  in_progress:          'In Progress',
  completed:            'Completed',
};

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Generic comparator used by all sortable columns. Treats null /
// '' as "go last" so unset rows sink to the bottom of an asc sort.
function cmp(a, b) {
  if (a === b) return 0;
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export default function CommissionsScreen({ user }) {
  const role        = user?.role || '';
  const isAdmin     = ADMIN_ROLES.has(role);
  const isSales     = role === 'sales';
  const isReception = role === 'receptionist';

  const [rows, setRows]       = useState([]);
  const [jobs, setJobs]       = useState({}); // job_id → { client_name, ..., pipeline_status, signed_at, preferred_visit_date }
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [error, setError]     = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.name, role]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      // Pull the recipient-scoped slice. Admin/owner/operations get
      // the whole ledger; the others only their own.
      let query = supabase.from('commissions').select('*').order('trigger_at', { ascending: false });
      if (isSales) query = query.eq('kind', 'sales_signed').eq('recipient_name', user?.name || '__none__');
      else if (isReception) query = query.in('kind', ['reception_visit', 'reception_signed']).eq('recipient_name', user?.name || '__none__');
      // admins see all kinds, all recipients
      const { data: cs, error: cErr } = await query;
      if (cErr) throw cErr;
      setRows(cs || []);

      // Jobs lookup so we can render client name + pipeline + dates.
      const ids = Array.from(new Set((cs || []).map((r) => r.job_id)));
      if (ids.length) {
        const { data: js } = await supabase
          .from('jobs')
          .select('id, client_name, address, city, pipeline_status, preferred_visit_date, lead_date, updated_at, created_at')
          .in('id', ids);
        // Map signed_at from the most recent contract for each job.
        const { data: contracts } = await supabase
          .from('contracts')
          .select('job_id, signed_at')
          .in('job_id', ids);
        const signMap = {};
        for (const c of (contracts || [])) {
          if (!c.signed_at) continue;
          const prev = signMap[c.job_id];
          if (!prev || new Date(c.signed_at) > new Date(prev)) signMap[c.job_id] = c.signed_at;
        }
        const map = {};
        for (const j of (js || [])) {
          map[j.id] = {
            client_name:          j.client_name || '',
            address:              j.address || '',
            city:                 j.city || '',
            pipeline_status:      j.pipeline_status || '',
            preferred_visit_date: j.preferred_visit_date || null,
            lead_date:            j.lead_date || null,
            signed_at:            signMap[j.id] || null,
          };
        }
        setJobs(map);
      } else {
        setJobs({});
      }
    } catch (err) {
      setError(err?.message || 'Failed to load commissions.');
    } finally {
      setLoading(false);
    }
  }

  // Optimistic patch helper — used by both admin edits AND Rafa's
  // appt_status edits (the latter is allowed for any role since
  // it's *her* tracking column).
  async function patchRow(id, patch) {
    const prev = rows;
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const { error: e } = await supabase.from('commissions').update(patch).eq('id', id);
      if (e) throw e;
      logAudit({
        user, action: 'commission.update', entityType: 'commission',
        entityId: id, details: patch,
      });
    } catch (err) {
      setRows(prev);
      setError(err?.message || 'Failed to save.');
    }
  }

  async function togglePaid(row) {
    if (!isAdmin) return;
    const next = !row.paid;
    await patchRow(row.id, {
      paid: next,
      paid_at: next ? new Date().toISOString() : null,
      paid_by: next ? (user?.name || null) : null,
    });
  }

  // Edit cell — used for amount + percent.
  async function commitNumber(row, field, raw) {
    if (!isAdmin) return;
    const value = raw === '' || raw == null ? null : Number(raw);
    if (raw !== '' && raw != null && !Number.isFinite(value)) return;
    const patch = { [field]: value };
    if (field === 'percent' && value != null && row.base_amount != null) {
      patch.amount = Math.round(Number(row.base_amount) * (value / 100) * 100) / 100;
    }
    await patchRow(row.id, patch);
  }

  // Receptionist rows are aggregated PER JOB so the table reads
  // "one client per row" with the amount summed across visit + signed.
  // The aggregate keeps a reference to every underlying commission
  // row id so:
  //   • the appt_status dropdown propagates to ALL of them at once
  //     (consistent UX — the merged row IS the unit of bookkeeping);
  //   • the paid pill (admin) toggles every row together.
  const filteredRaw = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!needle) return true;
      const j = jobs[r.job_id] || {};
      return (
        (j.client_name || '').toLowerCase().includes(needle) ||
        (r.recipient_name || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, jobs, search]);

  const salesRows = useMemo(
    () => filteredRaw.filter((r) => r.kind === 'sales_signed'),
    [filteredRaw],
  );

  // Aggregate reception_visit + reception_signed into one synthetic
  // row per (job_id, recipient_name). Field semantics on the aggregate:
  //   • amount: sum.
  //   • appt_status: from any underlying row (they should converge —
  //     when split, prefer the most recent edit). Editing the dropdown
  //     writes back to ALL underlying rows.
  //   • paid: AND across rows (only checked if every component paid).
  //   • _ids: array of underlying commission ids — used by patchers.
  const receptionAgg = useMemo(() => {
    const groups = new Map();
    for (const r of filteredRaw) {
      if (r.kind !== 'reception_visit' && r.kind !== 'reception_signed') continue;
      const key = `${r.job_id}::${r.recipient_name}`;
      const acc = groups.get(key) || {
        job_id: r.job_id,
        recipient_name: r.recipient_name,
        recipient_role: r.recipient_role,
        amount: 0,
        paid: true,
        appt_status: null,
        _ids: [],
        _trigger_at_max: null,
        has_visit: false,
        has_signed: false,
      };
      acc.amount += Number(r.amount) || 0;
      acc.paid = acc.paid && !!r.paid;
      // Latest non-null appt_status wins.
      if (r.appt_status && (!acc._appt_at || new Date(r.updated_at) > new Date(acc._appt_at))) {
        acc.appt_status = r.appt_status;
        acc._appt_at = r.updated_at;
      } else if (r.appt_status && !acc.appt_status) {
        acc.appt_status = r.appt_status;
      }
      acc._ids.push(r.id);
      acc._trigger_at_max = !acc._trigger_at_max || new Date(r.trigger_at) > new Date(acc._trigger_at_max)
        ? r.trigger_at
        : acc._trigger_at_max;
      if (r.kind === 'reception_visit')  acc.has_visit  = true;
      if (r.kind === 'reception_signed') acc.has_signed = true;
      groups.set(key, acc);
    }
    return Array.from(groups.values());
  }, [filteredRaw]);

  // Update every underlying commission row tied to an aggregate.
  // Uses Promise.all so the optimistic UI is fast; failures roll
  // back to the pre-patch state.
  async function patchAggregate(agg, patch) {
    const prev = rows;
    setRows((p) => p.map((r) => agg._ids.includes(r.id) ? { ...r, ...patch } : r));
    try {
      const { error: e } = await supabase
        .from('commissions')
        .update(patch)
        .in('id', agg._ids);
      if (e) throw e;
      logAudit({
        user, action: 'commission.update_aggregate',
        entityType: 'commission',
        details: { ids: agg._ids, ...patch },
      });
    } catch (err) {
      setRows(prev);
      setError(err?.message || 'Failed to save.');
    }
  }

  async function toggleAggregatePaid(agg) {
    if (!isAdmin) return;
    const next = !agg.paid;
    await patchAggregate(agg, {
      paid: next,
      paid_at: next ? new Date().toISOString() : null,
      paid_by: next ? (user?.name || null) : null,
    });
  }

  // Totals strip on the header.
  const totalUnpaid = filteredRaw.filter((r) => !r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalPaid   = filteredRaw.filter((r) =>  r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div className="flex-1 flex flex-col bg-omega-cloud overflow-hidden">
      <header className="bg-white border-b border-gray-200 px-6 md:px-8 py-5 flex-shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-omega-charcoal inline-flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-omega-orange" /> Commissions
            </h1>
            <p className="text-xs text-omega-stone mt-0.5">
              {isAdmin
                ? 'Full ledger. Click any column header to sort. Click Amount, %, or Paid to edit.'
                : isReception
                  ? 'One row per client. Amount sums every visit + signed bonus you earned.'
                  : 'Auto-generated when contracts are signed.'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">
              Unpaid: {money(totalUnpaid)}
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
              Paid: {money(totalPaid)}
            </span>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 px-6 md:px-8 py-2 flex flex-wrap gap-2 items-center flex-shrink-0">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or recipient…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-omega-cloud focus:bg-white focus:border-omega-orange focus:outline-none"
          />
        </div>
        <span className="ml-auto text-xs text-omega-stone">
          {salesRows.length + receptionAgg.length} row{(salesRows.length + receptionAgg.length) === 1 ? '' : 's'}
        </span>
      </div>

      <main className="flex-1 overflow-auto px-4 md:px-8 py-4 space-y-6">
        {loading && <p className="text-sm text-omega-stone py-10 text-center">Loading…</p>}
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && salesRows.length === 0 && receptionAgg.length === 0 && (
          <p className="text-sm text-omega-stone py-10 text-center italic">
            No commissions yet.
          </p>
        )}

        {/* Sales table — visible to admins + sales themselves */}
        {(isAdmin || isSales) && salesRows.length > 0 && (
          <Section title="Sales — Contract Signed" subtitle="6% of contract value">
            <SalesTable
              rows={salesRows}
              jobs={jobs}
              isAdmin={isAdmin}
              onTogglePaid={togglePaid}
              onCommit={commitNumber}
            />
          </Section>
        )}

        {/* Receptionist — consolidated per client */}
        {(isAdmin || isReception) && receptionAgg.length > 0 && (
          <Section
            title="Receptionist — Per Client"
            subtitle="$40 per visit + $300 when the contract is signed. Amount sums everything earned for this client."
          >
            <ReceptionTable
              rows={receptionAgg}
              jobs={jobs}
              isAdmin={isAdmin}
              onTogglePaid={toggleAggregatePaid}
            />
          </Section>
        )}
      </main>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="text-base font-bold text-omega-charcoal">{title}</h2>
        {subtitle && <p className="text-[11px] text-omega-stone mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

// ─── Sortable header cell ──────────────────────────────────────────
function SortHeader({ label, columnId, sortBy, sortDir, onClick, align = 'left' }) {
  const cls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const active = sortBy === columnId;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2 ${cls} border-b border-gray-200 select-none`}>
      <button
        type="button"
        onClick={() => onClick(columnId)}
        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
          active ? 'text-omega-orange' : 'text-omega-stone hover:text-omega-charcoal'
        }`}
      >
        {label}
        <Icon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />
      </button>
    </th>
  );
}

// ─── Sales table — one row per signed contract ────────────────────
function SalesTable({ rows, jobs, isAdmin, onTogglePaid, onCommit }) {
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir(col === 'date' ? 'desc' : 'asc'); }
  }

  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    const get = (r) => {
      const j = jobs[r.job_id] || {};
      switch (sortBy) {
        case 'date':      return j.signed_at || r.trigger_at;
        case 'client':    return j.client_name || '';
        case 'recipient': return r.recipient_name || '';
        case 'base':      return Number(r.base_amount) || 0;
        case 'percent':   return Number(r.percent) || 0;
        case 'amount':    return Number(r.amount) || 0;
        case 'paid':      return r.paid ? 1 : 0;
        default:          return '';
      }
    };
    return [...rows].sort((a, b) => sign * cmp(get(a), get(b)));
  }, [rows, jobs, sortBy, sortDir]);

  return (
    <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-card">
      <table className="w-full text-sm min-w-[820px]">
        <thead className="bg-omega-cloud">
          <tr>
            <SortHeader label="Date"          columnId="date"      sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Client"        columnId="client"    sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Recipient"     columnId="recipient" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Service Value" columnId="base"      sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="right" />
            <SortHeader label="%"             columnId="percent"   sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="right" />
            <SortHeader label="Amount"        columnId="amount"    sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="right" />
            <SortHeader label="Paid"          columnId="paid"      sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="center" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const j = jobs[r.job_id] || {};
            const date = j.signed_at || r.trigger_at;
            return (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-omega-cloud/40">
                <td className="px-3 py-2 text-xs text-omega-charcoal whitespace-nowrap">{fmtDate(date)}</td>
                <td className="px-3 py-2 text-xs">
                  <p className="font-semibold text-omega-charcoal truncate max-w-[260px]">
                    {j.client_name || '—'}
                  </p>
                  {(j.address || j.city) && (
                    <p className="text-[10px] text-omega-stone truncate max-w-[260px]">
                      {[j.address, j.city].filter(Boolean).join(', ')}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                  {r.recipient_name}
                  {r.recipient_role && (
                    <span className="ml-1 text-[10px] text-omega-stone">· {r.recipient_role}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums">
                  {isAdmin ? (
                    <NumberCell value={r.base_amount} prefix="$" onCommit={(v) => onCommit(r, 'base_amount', v)} />
                  ) : money(r.base_amount)}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums">
                  {isAdmin ? (
                    <NumberCell value={r.percent} suffix="%" onCommit={(v) => onCommit(r, 'percent', v)} />
                  ) : `${Number(r.percent ?? 0)}%`}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums font-bold text-omega-charcoal">
                  {isAdmin ? (
                    <NumberCell value={r.amount} prefix="$" onCommit={(v) => onCommit(r, 'amount', v)} />
                  ) : money(r.amount)}
                </td>
                <td className="px-3 py-2 text-xs text-center">
                  <PaidPill paid={r.paid} editable={isAdmin} onClick={() => onTogglePaid(r)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Receptionist consolidated table ──────────────────────────────
// One row per (job_id, recipient_name). Amount = sum across the
// underlying visit + signed commissions.
function ReceptionTable({ rows, jobs, isAdmin, onTogglePaid }) {
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir(col === 'date' ? 'desc' : 'asc'); }
  }

  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    const get = (r) => {
      const j = jobs[r.job_id] || {};
      switch (sortBy) {
        case 'date':       return j.preferred_visit_date || j.signed_at || j.lead_date || r._trigger_at_max;
        case 'client':     return j.client_name || '';
        case 'pipeline':   return PIPELINE_LABEL[j.pipeline_status] || '';
        case 'recipient':  return r.recipient_name || '';
        case 'amount':     return Number(r.amount) || 0;
        case 'paid':       return r.paid ? 1 : 0;
        default:           return '';
      }
    };
    return [...rows].sort((a, b) => sign * cmp(get(a), get(b)));
  }, [rows, jobs, sortBy, sortDir]);

  return (
    <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-card">
      <table className="w-full text-sm min-w-[860px]">
        <thead className="bg-omega-cloud">
          <tr>
            <SortHeader label="Date"      columnId="date"      sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Client"    columnId="client"    sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Pipeline"  columnId="pipeline"  sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Recipient" columnId="recipient" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
            <SortHeader label="Amount"    columnId="amount"    sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="right" />
            <SortHeader label="Paid"      columnId="paid"      sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} align="center" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const j = jobs[r.job_id] || {};
            const date = j.preferred_visit_date || j.signed_at || j.lead_date || r._trigger_at_max;
            return (
              <tr key={`${r.job_id}::${r.recipient_name}`} className="border-b border-gray-100 hover:bg-omega-cloud/40">
                <td className="px-3 py-2 text-xs text-omega-charcoal whitespace-nowrap">{fmtDate(date)}</td>
                <td className="px-3 py-2 text-xs">
                  <p className="font-semibold text-omega-charcoal truncate max-w-[260px]">
                    {j.client_name || '—'}
                  </p>
                  {(j.address || j.city) && (
                    <p className="text-[10px] text-omega-stone truncate max-w-[260px]">
                      {[j.address, j.city].filter(Boolean).join(', ')}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <PipelinePill status={j.pipeline_status} />
                </td>
                <td className="px-3 py-2 text-xs text-omega-slate whitespace-nowrap">
                  {r.recipient_name}
                  {r.recipient_role && (
                    <span className="ml-1 text-[10px] text-omega-stone">· {r.recipient_role}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums font-bold text-omega-charcoal">
                  {money(r.amount)}
                  {r.has_signed && (
                    <span className="ml-1 text-[9px] font-bold text-emerald-700 uppercase tracking-wider">+ signed</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-center">
                  <PaidPill paid={r.paid} editable={isAdmin} onClick={() => onTogglePaid(r)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PipelinePill({ status }) {
  if (!status) return <span className="text-omega-stone italic">—</span>;
  const label = PIPELINE_LABEL[status] || status;
  // Tone hints — mirror the kanban accents.
  const tone = ['contract_signed', 'in_progress', 'completed'].includes(status)
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : status === 'estimate_rejected'
      ? 'bg-red-100 text-red-800 border-red-200'
      : 'bg-gray-100 text-omega-slate border-gray-200';
  return (
    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${tone}`}>
      {label}
    </span>
  );
}

// Inline editable numeric cell. Click to enter edit mode.
function NumberCell({ value, prefix = '', suffix = '', onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);

  if (!editing) {
    const display = value == null
      ? <span className="text-omega-stone italic">—</span>
      : `${prefix}${Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${suffix}`;
    return (
      <button
        onClick={() => setEditing(true)}
        className="hover:bg-omega-pale/60 px-1.5 py-0.5 rounded -mx-1.5"
        title="Click to edit"
      >
        {display}
      </button>
    );
  }

  return (
    <input
      type="number"
      step="0.01"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onCommit(draft); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { onCommit(draft); setEditing(false); }
        if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); setEditing(false); }
      }}
      className="w-24 px-2 py-1 text-xs text-right rounded border border-omega-orange focus:outline-none focus:ring-1 focus:ring-omega-orange tabular-nums"
    />
  );
}

function PaidPill({ paid, editable, onClick }) {
  const cls = paid
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : 'bg-amber-100 text-amber-800 border-amber-200';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!editable}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${cls} ${editable ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
    >
      {paid ? <CheckCircle2 className="w-3 h-3" /> : <Loader2 className="w-3 h-3" />}
      {paid ? 'Paid' : 'Pending'}
    </button>
  );
}
