import { useEffect, useMemo, useState } from 'react';
import { FileText, Search, ChevronRight, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import PageHeader from '../../../shared/components/ui/PageHeader';
import LoadingSpinner from '../components/LoadingSpinner';

// Status chip palette — matches the verbs carriers/clients see in the
// estimate lifecycle. Anything unexpected falls through to a neutral chip.
const STATUS_META = {
  draft:       { label: 'DRAFT',       cls: 'bg-gray-200 text-gray-700' },
  sent:        { label: 'SENT',        cls: 'bg-blue-100 text-blue-700' },
  negotiating: { label: 'NEGOTIATING', cls: 'bg-amber-100 text-amber-800' },
  approved:    { label: 'APPROVED',    cls: 'bg-green-100 text-green-800' },
  rejected:    { label: 'LOST',        cls: 'bg-red-100 text-red-700' },
  signed:      { label: 'SIGNED',      cls: 'bg-emerald-600 text-white' },
};

const FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'open',   label: 'Open' },     // draft + sent + negotiating
  { id: 'won',    label: 'Won' },      // approved + signed
  { id: 'lost',   label: 'Lost' },     // rejected
];

function money(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

function bucketOf(status) {
  if (status === 'approved' || status === 'signed') return 'won';
  if (status === 'rejected') return 'lost';
  return 'open';
}

// Sales-side estimates dashboard. All sellers see every estimate (no
// per-user scoping), matching the rest of the Sales role.
export default function Estimates({ onBack, onOpenEstimate }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      // Latest estimate per job (limit generous, we page client-side).
      const { data: ests, error: eE } = await supabase
        .from('estimates')
        .select('id, job_id, status, total_amount, sent_at, approved_at, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(500);
      if (eE) throw eE;

      const jobIds = [...new Set((ests || []).map((e) => e.job_id).filter(Boolean))];
      let jobsById = {};
      if (jobIds.length) {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, client_name, city, service, address, pipeline_status, salesperson_name')
          .in('id', jobIds);
        jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
      }

      // Collapse to one row per job (latest estimate wins — first in the
      // list because we ordered desc).
      const seen = new Set();
      const merged = [];
      for (const est of ests || []) {
        if (!est.job_id || seen.has(est.job_id)) continue;
        seen.add(est.job_id);
        merged.push({ ...est, job: jobsById[est.job_id] || null });
      }
      setRows(merged);
    } catch (err) {
      setError(err.message || 'Failed to load estimates');
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && bucketOf(r.status) !== filter) return false;
      if (needle) {
        const hay = [
          r.job?.client_name, r.job?.city, r.job?.service, r.job?.address,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  const totals = useMemo(() => {
    let open = 0, won = 0;
    for (const r of rows) {
      const b = bucketOf(r.status);
      if (b === 'open') open += Number(r.total_amount) || 0;
      else if (b === 'won') won += Number(r.total_amount) || 0;
    }
    return { open, won };
  }, [rows]);

  return (
    <div className="min-h-screen bg-omega-cloud flex flex-col">
      <PageHeader
        icon={FileText}
        title="Estimates"
        subtitle={`${visible.length} shown · sorted by latest activity`}
        onBack={onBack}
      />

      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        <TotalCard
          label="Open pipeline"
          value={money(totals.open)}
          tint="bg-blue-50 border-blue-100 text-blue-900"
        />
        <TotalCard
          label="Won this year"
          value={money(totals.won)}
          tint="bg-green-50 border-green-100 text-green-900"
        />
      </div>

      {/* Filter tabs + search */}
      <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${
              filter === f.id
                ? 'bg-omega-orange text-white'
                : 'bg-white text-omega-slate border border-gray-200 hover:border-omega-orange/40'
            }`}
          >
            {f.label}
          </button>
        ))}

        <div className="relative flex-1 min-w-[200px] ml-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, city, service…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:border-omega-orange focus:outline-none"
          />
        </div>
      </div>

      {/* List */}
      <main className="flex-1 px-4 py-4">
        {loading && <div className="flex justify-center py-16"><LoadingSpinner /></div>}
        {!loading && error && (
          <div className="px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="text-center py-16">
            <FileText className="w-10 h-10 text-omega-stone mx-auto mb-3" />
            <p className="text-sm text-omega-stone">No estimates match this filter.</p>
          </div>
        )}
        {!loading && !error && visible.length > 0 && (
          <div className="space-y-2">
            {visible.map((r) => (
              <EstimateRow key={r.id} row={r} onClick={() => onOpenEstimate?.(r.job)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TotalCard({ label, value, tint }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${tint}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-black tabular-nums mt-1">{value}</p>
    </div>
  );
}

function EstimateRow({ row, onClick }) {
  const meta = STATUS_META[row.status] || { label: (row.status || '').toUpperCase() || '—', cls: 'bg-gray-200 text-gray-700' };
  const job  = row.job || {};
  return (
    <button
      onClick={onClick}
      disabled={!job.id}
      className="w-full text-left bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:border-omega-orange/60 hover:shadow-sm transition-all disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
        <DollarSign className="w-5 h-5 text-omega-orange" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-omega-charcoal truncate">
            {job.client_name || '—'}
          </p>
          <span className={`flex-shrink-0 inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
        <p className="text-xs text-omega-stone truncate mt-0.5">
          {[job.service, job.city].filter(Boolean).join(' · ') || 'No details'}
        </p>
        <p className="text-[11px] text-omega-stone mt-0.5 tabular-nums">
          {fmtDate(row.sent_at || row.created_at)}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-black text-omega-charcoal tabular-nums">{money(row.total_amount)}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-omega-stone flex-shrink-0" />
    </button>
  );
}
