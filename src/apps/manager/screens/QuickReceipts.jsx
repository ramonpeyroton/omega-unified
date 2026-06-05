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
import { Search, Receipt, MapPin, CheckCircle2, Loader2, X } from 'lucide-react';
import PageHeader from '../../../shared/components/ui/PageHeader';
import { supabase } from '../../../shared/lib/supabase';
import ReceiptCaptureModal from '../../../shared/components/ReceiptCaptureModal';
import Toast from '../../../shared/components/Toast';

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
  const [activeJob, setActiveJob] = useState(null);
  const [toast, setToast] = useState(null);
  const searchRef = useRef(null);

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
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => {
      const hay = `${j.client_name || ''} ${j.address || ''} ${j.city || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [jobs, query]);

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
          onSaved={({ amount }) => {
            setActiveJob(null);
            setToast({
              type: 'success',
              message: `Saved $${Number(amount).toFixed(2)} to ${activeJob.client_name || 'job'}`,
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
