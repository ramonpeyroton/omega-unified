import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Search, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';

// ─────────────────────────────────────────────────────────────────
// CommissionsScreen — role-aware commissions ledger.
//
// Auto-generated rows come from the trigger in migration 040.
// Roles that hit this screen:
//   • sales        → sees ONLY own sales_signed rows, read-only.
//   • receptionist → sees ONLY own reception_visit + reception_signed
//                    rows, read-only.
//   • owner / operations / admin → sees EVERYTHING, can edit `amount`,
//                    `percent`, and the `paid` checkbox.
//
// Privacy: salesperson never sees receptionist rows and vice versa.
// Even on the same job — the 6% sales commission and the $300
// reception bonus are independent rows with their own recipient.
// ─────────────────────────────────────────────────────────────────

const SALES_PIPE_FOR_DISPLAY = ['contract_signed', 'in_progress', 'completed'];

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

const ADMIN_ROLES = new Set(['owner', 'operations', 'admin']);

export default function CommissionsScreen({ user }) {
  const role = user?.role || '';
  const isAdmin   = ADMIN_ROLES.has(role);
  const isSales   = role === 'sales';
  const isReception = role === 'receptionist';

  const [rows, setRows]     = useState([]);
  const [jobs, setJobs]     = useState({}); // job_id → { client_name, pipeline_status, signed_at }
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

      // Jobs lookup so we can render client name + sign date in the
      // table without a per-row roundtrip.
      const ids = Array.from(new Set((cs || []).map((r) => r.job_id)));
      if (ids.length) {
        const { data: js } = await supabase
          .from('jobs')
          .select('id, client_name, address, city, pipeline_status, updated_at, created_at')
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
            client_name: j.client_name || '',
            address:     j.address || '',
            city:        j.city || '',
            pipeline_status: j.pipeline_status || '',
            signed_at:   signMap[j.id] || null,
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

  // Optimistic patch helper for admin edits.
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
    // Auto-recalc amount when percent or base changes (admin
    // override of amount itself takes precedence — they edited the
    // dollar number directly, so we leave it alone).
    if (field === 'percent' && value != null && row.base_amount != null) {
      patch.amount = Math.round(Number(row.base_amount) * (value / 100) * 100) / 100;
    }
    await patchRow(row.id, patch);
  }

  // ─── Filter rows for the visible table ────────────────────────
  const filtered = useMemo(() => {
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

  // Group by kind — receptionist gets a cleaner two-section view
  // (Visit at the top, Signed below); admins also benefit visually.
  const byKind = useMemo(() => {
    const groups = { sales_signed: [], reception_visit: [], reception_signed: [] };
    for (const r of filtered) (groups[r.kind] = groups[r.kind] || []).push(r);
    return groups;
  }, [filtered]);

  const totalUnpaid = filtered.filter((r) => !r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalPaid   = filtered.filter((r) =>  r.paid).reduce((s, r) => s + (Number(r.amount) || 0), 0);

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
                ? 'Full ledger. Click amount or % to edit, click Paid to toggle.'
                : 'Auto-generated when contracts are signed (and visits start, for receptionist).'}
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
          {filtered.length} row{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      <main className="flex-1 overflow-auto px-4 md:px-8 py-4 space-y-6">
        {loading && <p className="text-sm text-omega-stone py-10 text-center">Loading…</p>}
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-omega-stone py-10 text-center italic">
            No commissions yet.
          </p>
        )}

        {/* Sales table — visible to admins + sales themselves */}
        {(isAdmin || isSales) && byKind.sales_signed.length > 0 && (
          <Section title="Sales — Contract Signed" subtitle="6% of contract value">
            <CommissionTable
              rows={byKind.sales_signed}
              jobs={jobs}
              isAdmin={isAdmin}
              showPercent
              onTogglePaid={togglePaid}
              onCommit={commitNumber}
            />
          </Section>
        )}

        {/* Receptionist — visit started ($40) */}
        {(isAdmin || isReception) && byKind.reception_visit.length > 0 && (
          <Section title="Receptionist — Visit Started" subtitle="$40 each — fires when the salesperson actually goes on the visit">
            <CommissionTable
              rows={byKind.reception_visit}
              jobs={jobs}
              isAdmin={isAdmin}
              onTogglePaid={togglePaid}
              onCommit={commitNumber}
            />
          </Section>
        )}

        {/* Receptionist — contract signed ($300) */}
        {(isAdmin || isReception) && byKind.reception_signed.length > 0 && (
          <Section title="Receptionist — Contract Signed" subtitle="$300 each — fires when the lead converts">
            <CommissionTable
              rows={byKind.reception_signed}
              jobs={jobs}
              isAdmin={isAdmin}
              onTogglePaid={togglePaid}
              onCommit={commitNumber}
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

// Single table for any commission kind. Renders extra columns
// conditionally (base_amount + percent for sales, simpler for reception).
function CommissionTable({ rows, jobs, isAdmin, showPercent = false, onTogglePaid, onCommit }) {
  return (
    <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100 shadow-card">
      <table className="w-full text-sm min-w-[820px]">
        <thead className="bg-omega-cloud">
          <tr>
            <Th>Date</Th>
            <Th>Client</Th>
            <Th>Recipient</Th>
            {showPercent && <Th align="right">Service Value</Th>}
            {showPercent && <Th align="right">%</Th>}
            <Th align="right">Amount</Th>
            <Th align="center">Paid</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
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
                {showPercent && (
                  <td className="px-3 py-2 text-xs text-right tabular-nums">
                    {isAdmin ? (
                      <NumberCell
                        value={r.base_amount}
                        prefix="$"
                        onCommit={(v) => onCommit(r, 'base_amount', v)}
                      />
                    ) : (
                      money(r.base_amount)
                    )}
                  </td>
                )}
                {showPercent && (
                  <td className="px-3 py-2 text-xs text-right tabular-nums">
                    {isAdmin ? (
                      <NumberCell
                        value={r.percent}
                        suffix="%"
                        onCommit={(v) => onCommit(r, 'percent', v)}
                      />
                    ) : (
                      `${Number(r.percent ?? 0)}%`
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-xs text-right tabular-nums font-bold text-omega-charcoal">
                  {isAdmin ? (
                    <NumberCell
                      value={r.amount}
                      prefix="$"
                      onCommit={(v) => onCommit(r, 'amount', v)}
                    />
                  ) : (
                    money(r.amount)
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

function Th({ children, align = 'left' }) {
  const cls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`px-3 py-2 ${cls} border-b border-gray-200 text-[10px] font-bold uppercase tracking-wider text-omega-stone`}>
      {children}
    </th>
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
