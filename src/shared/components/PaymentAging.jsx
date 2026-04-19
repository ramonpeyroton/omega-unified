import { useEffect, useState, useMemo } from 'react';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysBetween(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((d - today) / (1000 * 60 * 60 * 24));
}

function bucketFor(daysLeft, paid) {
  if (paid) return 'paid';
  if (daysLeft == null) return 'upcoming';
  if (daysLeft > 0) return 'upcoming';
  if (daysLeft === 0) return 'due_today';
  const overdue = -daysLeft;
  if (overdue <= 30) return 'overdue_1_30';
  if (overdue <= 60) return 'overdue_31_60';
  return 'overdue_60_plus';
}

const BUCKET_STYLE = {
  paid:            { label: 'Paid',         cls: 'bg-green-50 text-green-700 border-green-200' },
  upcoming:        { label: 'Upcoming',     cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  due_today:       { label: 'Due Today',    cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  overdue_1_30:    { label: 'Overdue 1-30', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  overdue_31_60:   { label: 'Overdue 31-60',cls: 'bg-red-50 text-red-700 border-red-200' },
  overdue_60_plus: { label: 'Overdue 60+',  cls: 'bg-red-100 text-red-900 border-red-300' },
};

export default function PaymentAging({ user }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // flattened installments
  const [toast, setToast] = useState(null);
  const [updating, setUpdating] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      // Pull signed contracts with a payment_plan
      const { data: contracts } = await supabase
        .from('contracts')
        .select('*')
        .not('signed_at', 'is', null);

      const jobIds = (contracts || []).map((c) => c.job_id);
      let jobsById = {};
      if (jobIds.length) {
        const { data: jobs } = await supabase.from('jobs').select('id, client_name, address, city').in('id', jobIds);
        jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
      }

      const flat = [];
      (contracts || []).forEach((c) => {
        const plan = Array.isArray(c.payment_plan) ? c.payment_plan : [];
        const job = jobsById[c.job_id] || {};
        plan.forEach((p, idx) => {
          const amount = Number(p.amount) || (c.total_amount && p.percent ? (Number(c.total_amount) * Number(p.percent) / 100) : 0);
          flat.push({
            _key: `${c.id}_${p.id || idx}`,
            contract_id: c.id,
            installment_index: idx,
            installment_id: p.id || `installment_${idx + 1}`,
            label: p.label || `Installment ${idx + 1}`,
            amount,
            due_date: p.due_date || null,
            paid: !!p.paid,
            paid_at: p.paid_at || null,
            job,
          });
        });
      });
      setRows(flat);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const d = daysBetween(r.due_date);
      return { ...r, daysLeft: d, bucket: bucketFor(d, r.paid) };
    }).sort((a, b) => {
      // paid last, overdue first, then upcoming
      const order = { overdue_60_plus: 0, overdue_31_60: 1, overdue_1_30: 2, due_today: 3, upcoming: 4, paid: 5 };
      const delta = (order[a.bucket] || 99) - (order[b.bucket] || 99);
      if (delta !== 0) return delta;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date) - new Date(b.due_date);
    });
  }, [rows]);

  const totals = useMemo(() => {
    const sum = (b) => enriched.filter((r) => r.bucket === b).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return {
      overdue: sum('overdue_1_30') + sum('overdue_31_60') + sum('overdue_60_plus'),
      dueToday: sum('due_today'),
      upcoming: sum('upcoming'),
    };
  }, [enriched]);

  async function markPaid(row) {
    setUpdating(row._key);
    try {
      // Re-fetch the contract, mutate its payment_plan, save back
      const { data: contract } = await supabase.from('contracts').select('payment_plan').eq('id', row.contract_id).maybeSingle();
      if (!contract) throw new Error('Contract not found');
      const plan = Array.isArray(contract.payment_plan) ? [...contract.payment_plan] : [];
      if (!plan[row.installment_index]) throw new Error('Installment index out of range');
      plan[row.installment_index] = {
        ...plan[row.installment_index],
        paid: true,
        paid_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('contracts').update({ payment_plan: plan }).eq('id', row.contract_id);
      if (error) throw error;
      setRows((prev) => prev.map((r) => r._key === row._key ? { ...r, paid: true, paid_at: new Date().toISOString() } : r));
      setToast({ type: 'success', message: 'Marked as paid' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed' });
    } finally {
      setUpdating(null);
    }
  }

  if (loading) return <div className="text-sm text-omega-stone p-4">Loading payments…</div>;

  const openItems = enriched.filter((r) => !r.paid);

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="grid grid-cols-3 gap-3">
        <Card label="Overdue" value={money(totals.overdue)} danger={totals.overdue > 0} />
        <Card label="Due Today" value={money(totals.dueToday)} warning={totals.dueToday > 0} />
        <Card label="Upcoming" value={money(totals.upcoming)} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <p className="font-bold text-omega-charcoal">Payments Due</p>
            <p className="text-xs text-omega-stone mt-0.5">Signed contracts with payment plans</p>
          </div>
        </div>

        {openItems.length === 0 ? (
          <div className="p-8 text-center text-omega-stone text-sm">No open payments.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {openItems.map((r) => {
              const style = BUCKET_STYLE[r.bucket];
              const isOverdue = r.bucket.startsWith('overdue') || r.bucket === 'due_today';
              return (
                <li key={r._key} className="p-3 sm:p-4 flex items-start sm:items-center gap-3 flex-wrap sm:flex-nowrap">
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-semibold text-omega-charcoal text-sm">{r.job.client_name || '—'}</p>
                    <p className="text-[11px] text-omega-stone truncate">{r.job.address || r.job.city || ''}</p>
                    <p className="text-xs text-omega-slate mt-0.5">{r.label}</p>
                  </div>
                  <div className="flex-shrink-0 text-right min-w-[100px]">
                    <p className="font-bold text-omega-charcoal">{money(r.amount)}</p>
                    <p className="text-[11px] text-omega-stone">{r.due_date ? new Date(r.due_date).toLocaleDateString() : 'No date'}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${style.cls}`}>
                      {isOverdue && <AlertTriangle className="w-3 h-3" />}
                      {style.label}
                    </span>
                    <button
                      onClick={() => markPaid(r)}
                      disabled={updating === r._key}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-omega-success hover:bg-green-700 text-white text-xs font-semibold disabled:opacity-60"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {updating === r._key ? '…' : 'Mark Paid'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, danger, warning }) {
  const color = danger ? 'text-red-700' : warning ? 'text-amber-700' : 'text-omega-charcoal';
  const bg = danger ? 'bg-red-50 border-red-200' : warning ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200';
  return (
    <div className={`rounded-xl border p-3 ${bg}`}>
      <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">{label}</p>
      <p className={`text-base sm:text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
