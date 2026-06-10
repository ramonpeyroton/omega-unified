// Mobile-first receipt drop. Gabriel opens this on his phone, taps
// a client, snaps a receipt, types the amount, done. No phases, no
// notes, no tabs — the simplest possible "money out the door" trail.
//
// The capture flow itself is the shared ReceiptCaptureModal — same
// component used on the tablet's "Job of the Day" row. It already
// opens the back camera automatically on mount and writes BOTH the
// document row (folder='receipts') AND the job_expenses row so the
// Financials totals stay honest without an extra step.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Receipt, MapPin, CheckCircle2, Loader2, X, ArrowUpDown, Building2 } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../../../shared/lib/supabase';
import ReceiptCaptureModal from '../../../shared/components/ReceiptCaptureModal';
import Toast from '../../../shared/components/Toast';

const SORT_KEY = 'omega_receipts_sort';
const SORT_OPTIONS = [
  { id: 'status',  label: 'Status' },
  { id: 'name',    label: 'Name' },
  { id: 'city',    label: 'City' },
];
// Active statuses first, then done/completed
const STATUS_RANK = {
  in_progress: 0, 'in-progress': 0,
  awaiting_kickoff: 1, contract_signed: 2,
  completed: 3,
};

// Phases where it actually makes sense to log a material receipt.
// We deliberately leave out leads/estimate-stage jobs — Gabriel
// wouldn't be buying for those anyway, and showing them just makes
// the list noisier on a small screen.
const RECEIPT_PHASES = new Set([
  'contract_signed',
  'awaiting_kickoff',
  'in_progress',
  'in-progress',
  'completed',
]);

export default function QuickReceipts({ user }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState(() => {
    try { return localStorage.getItem(SORT_KEY) || 'status'; } catch { return 'status'; }
  });
  const [activeJob, setActiveJob] = useState(null);
  // Company-overhead capture (no client): Office / Personal expenses
  // that must NOT land on any project's cost.
  const [companyOpen, setCompanyOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);

  function changeSort(id) {
    setSortBy(id);
    try { localStorage.setItem(SORT_KEY, id); } catch { /* quota */ }
  }

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      // Single query — we want everything visible on the kanban so
      // Gabriel can find any active card. Sorting by updated_at puts
      // the cards he touched today right at the top.
      const { data, error } = await supabase
        .from('jobs')
        .select('id, client_name, address, city, service, pipeline_status, updated_at')
        .eq('in_pipeline', true)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const filtered = (data || []).filter((j) => RECEIPT_PHASES.has(j.pipeline_status));
      setJobs(filtered);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load jobs' });
    } finally {
      setLoading(false);
    }
  }

  const filteredJobs = useMemo(() => {
    let list = [...jobs];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((j) => {
        const hay = `${j.client_name || ''} ${j.address || ''} ${j.city || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    // Sort
    list.sort((a, b) => {
      if (sortBy === 'name') {
        return (a.client_name || '').localeCompare(b.client_name || '');
      }
      if (sortBy === 'city') {
        return (a.city || '').localeCompare(b.city || '');
      }
      // 'status' — active first, then done
      const ra = STATUS_RANK[a.pipeline_status] ?? 9;
      const rb = STATUS_RANK[b.pipeline_status] ?? 9;
      if (ra !== rb) return ra - rb;
      return (a.client_name || '').localeCompare(b.client_name || '');
    });
    return list;
  }, [jobs, query, sortBy]);

  return (
    <div className="flex-1 overflow-y-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Sticky header. Big touch target on the search row; on mobile
          the input is large enough to comfortably one-thumb. */}
      <PageHeader
        icon={Receipt}
        title="Quick Receipts"
        subtitle={loading ? 'Loading…' : `${filteredJobs.length} client${filteredJobs.length === 1 ? '' : 's'} ready`}
      />

      {/* Search bar — its own row under the header. */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client or address…"
            className="w-full h-12 pl-10 pr-10 rounded-xl border border-gray-200 bg-white text-[16px] focus:outline-none focus:border-omega-orange"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-omega-stone hover:bg-gray-100"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Company expense (no client) — Office / Personal overhead that
          must not touch any project's cost. */}
      <div className="px-3 pt-3">
        <button
          onClick={() => setCompanyOpen(true)}
          className="w-full flex items-center gap-3 bg-white border border-dashed border-gray-300 rounded-2xl px-4 py-3 active:scale-[.99] active:border-omega-orange transition-all min-h-[56px]"
        >
          <div className="w-10 h-10 rounded-xl bg-omega-cloud flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-omega-stone" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[15px] font-bold text-omega-charcoal">Company expense</p>
            <p className="text-[12px] text-omega-stone">No client — Office or Personal</p>
          </div>
        </button>
      </div>

      {/* Sort chips */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-omega-cloud">
        <ArrowUpDown className="w-3.5 h-3.5 text-omega-stone flex-shrink-0" />
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => changeSort(opt.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              sortBy === opt.id
                ? 'bg-omega-orange text-white'
                : 'bg-white text-omega-stone border border-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Job list — chunky rows, ≥56px tall for safe thumb tapping. */}
      <ul className="px-3 py-3 space-y-2">
        {loading && (
          <li className="flex items-center justify-center py-12 text-omega-stone gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading clients…
          </li>
        )}
        {!loading && filteredJobs.length === 0 && (
          <li className="text-center py-12 text-sm text-omega-stone">
            {query
              ? <>No clients match &quot;<strong>{query}</strong>&quot;.</>
              : 'No active jobs right now.'}
          </li>
        )}
        {!loading && filteredJobs.map((j) => (
          <li key={j.id}>
            <button
              onClick={() => setActiveJob(j)}
              className="w-full text-left bg-white border border-gray-200 rounded-2xl px-4 py-3.5 active:scale-[.99] active:border-omega-orange transition-all flex items-center gap-3 min-h-[64px]"
            >
              <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
                <Receipt className="w-5 h-5 text-omega-orange" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-omega-charcoal truncate">
                  {j.client_name || '(no name)'}
                </p>
                <p className="text-[12px] text-omega-stone truncate flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {j.address || j.city || j.service || 'No address on file'}
                </p>
              </div>
              <PhaseBadge status={j.pipeline_status} />
            </button>
          </li>
        ))}
      </ul>

      {activeJob && (
        <ReceiptCaptureModal
          job={activeJob}
          user={user}
          onClose={() => setActiveJob(null)}
          onSaved={({ amount, isReturn }) => {
            const name = activeJob.client_name || 'job';
            setActiveJob(null);
            setToast({
              type: 'success',
              message: isReturn
                ? `Logged $${Number(amount).toFixed(2)} return for ${name}`
                : `Saved $${Number(amount).toFixed(2)} to ${name}`,
            });
          }}
        />
      )}

      {companyOpen && (
        <ReceiptCaptureModal
          companyMode
          user={user}
          onClose={() => setCompanyOpen(false)}
          onSaved={({ amount, kind }) => {
            setCompanyOpen(false);
            setToast({
              type: 'success',
              message: `Saved $${Number(amount).toFixed(2)} company expense (${kind})`,
            });
          }}
        />
      )}
    </div>
  );
}

function PhaseBadge({ status }) {
  const map = {
    contract_signed:   { label: 'NEW',      cls: 'bg-blue-100 text-blue-800' },
    awaiting_kickoff:  { label: 'KICKOFF',  cls: 'bg-indigo-100 text-indigo-800' },
    in_progress:       { label: 'ACTIVE',   cls: 'bg-green-100 text-green-800' },
    'in-progress':     { label: 'ACTIVE',   cls: 'bg-green-100 text-green-800' },
    completed:         { label: 'DONE',     cls: 'bg-gray-100 text-gray-700' },
  };
  const m = map[status] || { label: status || '—', cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${m.cls}`}>
      {m.label}
    </span>
  );
}
