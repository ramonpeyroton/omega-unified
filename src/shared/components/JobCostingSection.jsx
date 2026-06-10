import { useEffect, useState, useMemo, useRef } from 'react';
import { DollarSign, Save, TrendingUp, TrendingDown, Banknote, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';
import { sumAcceptedEstimates } from '../lib/jobFinancials';

function parseNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function money(n) {
  if (n == null) return '—';
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}$${abs}`;
}

export default function JobCostingSection({ job, user }) {
  const [row, setRow] = useState(null);
  const [form, setForm] = useState({
    estimated_revenue: '',
    material_cost: '',
    labor_cost: '',
    sub_cost: '',
    other_costs: '',
    other_costs_description: '',
    amount_received: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [subsTotal, setSubsTotal] = useState(0);
  // Latest estimate.total_amount — kept separately from the form so we
  // can warn the user when their saved estimated_revenue has drifted
  // away from the current estimate. The form value is still authoritative
  // for the math; this is just a banner.
  const [latestEstimateTotal, setLatestEstimateTotal] = useState(null);
  // Milestone count — when > 0, amount_received is computed by the
  // database trigger from SUM(payment_milestones.received_amount).
  // The form field is read-only in that case so Brenda doesn't type
  // a value that would be silently overwritten on the next change.
  const [milestoneCount, setMilestoneCount] = useState(0);
  // Sum of ACCEPTED estimates (approved/signed) — prevails as revenue
  // when present, matching the Owner dashboard. 0 → fall back to the
  // manual estimated_revenue field below (imported jobs).
  const [acceptedEstTotal, setAcceptedEstTotal] = useState(0);
  // Sum of logged receipts/expenses (job_expenses) — added on top of
  // the manual cost fields so Total Cost = receipts + manual costs.
  // `expensesTotal` is the NET (positive receipts + negative returns);
  // `returnsTotal` is the credit portion alone (≤ 0), shown as its own
  // line so the cost reduction from returns stays visible.
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [returnsTotal, setReturnsTotal] = useState(0);
  const saveTimer = useRef(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load() {
    setLoading(true);
    try {
      // Load the row (if any)
      const { data: cost } = await supabase
        .from('job_costs')
        .select('*')
        .eq('job_id', job.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Sum of ALL approved/signed estimates — a job can have multiple
      // approved estimates (e.g. two separate scopes both approved by
      // the client). Using only the latest single estimate produces a
      // false mismatch when the saved revenue is the correct multi-
      // estimate total. Fall back to the latest estimate of any status
      // when no approved ones exist (early-stage jobs with only a draft).
      const { data: allEsts } = await supabase
        .from('estimates')
        .select('total_amount, status, created_at')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });

      const approvedEsts = (allEsts || []).filter((e) =>
        e.status === 'approved' || e.status === 'signed'
      );
      const estTotal = approvedEsts.length > 0
        ? approvedEsts.reduce((acc, e) => acc + (Number(e.total_amount) || 0), 0)
        : (allEsts?.[0]?.total_amount ?? null); // latest of any status as fallback

      // Sum of subcontractor_agreements.their_estimate
      const { data: agrs } = await supabase
        .from('subcontractor_agreements')
        .select('their_estimate')
        .eq('job_id', job.id);
      const subs = (agrs || []).reduce((acc, a) => acc + (Number(a.their_estimate) || 0), 0);
      setSubsTotal(subs);
      setLatestEstimateTotal(estTotal != null ? Number(estTotal) : null);
      setAcceptedEstTotal(sumAcceptedEstimates(allEsts || []));

      // Logged receipts/expenses for this job — the receipts half of
      // the unified Total Cost (manual fields + receipts).
      const { data: expRows } = await supabase
        .from('job_expenses')
        .select('amount')
        .eq('job_id', job.id);
      setExpensesTotal((expRows || []).reduce((s, e) => s + (Number(e.amount) || 0), 0));
      // Returns are stored as negative amounts — sum them alone so we can
      // surface the credit on its own line.
      setReturnsTotal((expRows || []).reduce((s, e) => {
        const a = Number(e.amount) || 0;
        return a < 0 ? s + a : s;
      }, 0));

      // Payment milestones — count AND live sum of received_amount.
      // When milestones exist the trigger (migration 058) owns
      // job_costs.amount_received, but we read the live sum directly
      // here instead of trusting the denormalized column. This ensures
      // the field is accurate even if migration 058 hasn't been applied
      // yet or if the trigger misfired.
      let milestoneRcvd = null;
      let mCount = 0;
      try {
        const { data: mRows } = await supabase
          .from('payment_milestones')
          .select('received_amount')
          .eq('job_id', job.id);
        mCount = (mRows || []).length;
        if (mCount > 0) {
          milestoneRcvd = (mRows || []).reduce((s, r) => s + (Number(r.received_amount) || 0), 0);
        }
      } catch { /* payment_milestones table missing — skip */ }
      setMilestoneCount(mCount);

      setRow(cost || null);
      setForm({
        estimated_revenue: cost?.estimated_revenue ?? (estTotal != null ? estTotal : '') ?? '',
        material_cost: cost?.material_cost ?? '',
        labor_cost: cost?.labor_cost ?? '',
        sub_cost: cost?.sub_cost ?? subs,
        other_costs: cost?.other_costs ?? '',
        other_costs_description: cost?.other_costs_description ?? '',
        // When milestones exist, always use the live sum (never trust
        // the possibly-stale denormalized column in job_costs).
        amount_received: milestoneRcvd !== null ? milestoneRcvd : (cost?.amount_received ?? ''),
      });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load costing' });
    } finally {
      setLoading(false);
    }
  }

  const calc = useMemo(() => {
    // Revenue: accepted estimates prevail; else the manual field.
    const manualRev = parseNum(form.estimated_revenue);
    const revenue = acceptedEstTotal > 0 ? acceptedEstTotal : manualRev;
    const mat = parseNum(form.material_cost);
    const labor = parseNum(form.labor_cost);
    const sub = parseNum(form.sub_cost);
    const other = parseNum(form.other_costs);
    const manualCost = mat + labor + sub + other;
    // Total cost = manual cost fields + all logged receipts.
    const totalCost = manualCost + (Number(expensesTotal) || 0);
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const received = parseNum(form.amount_received);
    const balanceDue = revenue - received;
    return { revenue, totalCost, manualCost, profit, margin, received, balanceDue };
  }, [form, acceptedEstTotal, expensesTotal]);

  function update(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save({ ...form, [k]: v }, true), 800);
  }

  async function save(formToSave = form, debounced = false) {
    if (!debounced) setSaving(true);
    try {
      const payload = {
        job_id: job.id,
        estimated_revenue: parseNum(formToSave.estimated_revenue),
        material_cost: parseNum(formToSave.material_cost),
        labor_cost: parseNum(formToSave.labor_cost),
        sub_cost: parseNum(formToSave.sub_cost),
        other_costs: parseNum(formToSave.other_costs),
        other_costs_description: formToSave.other_costs_description || null,
        gross_margin_percent: calc.margin,
        updated_at: new Date().toISOString(),
        updated_by: user?.name || null,
      };
      // When Finance milestones exist the DB trigger (migration 058) is
      // the authoritative owner of amount_received. Skip writing it here
      // so a save never resets what the trigger already computed.
      if (milestoneCount === 0) {
        payload.amount_received = parseNum(formToSave.amount_received);
      }
      let data, error;
      if (row?.id) {
        ({ data, error } = await supabase.from('job_costs').update(payload).eq('id', row.id).select().single());
      } else {
        ({ data, error } = await supabase.from('job_costs').insert([payload]).select().single());
      }
      if (error) throw error;
      setRow(data);
    } catch (err) {
      if (!debounced) setToast({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      if (!debounced) setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-omega-stone p-4">Loading costing…</div>;
  }

  const marginOk = calc.margin >= 20;

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card label="Revenue" value={money(calc.revenue)} />
        <Card label="Total Cost" value={money(calc.totalCost)} />
        <Card label="Gross Profit" value={money(calc.profit)} valueColor={calc.profit >= 0 ? 'text-omega-success' : 'text-red-600'} />
        <Card
          label="Margin %"
          value={`${calc.margin.toFixed(1)}%`}
          icon={marginOk ? TrendingUp : TrendingDown}
          valueColor={marginOk ? 'text-omega-success' : 'text-amber-600'}
        />
        <Card
          label="Received"
          value={money(calc.received)}
          icon={Banknote}
          valueColor="text-emerald-600"
        />
        <Card
          label="Balance Due"
          value={money(calc.balanceDue)}
          icon={Clock}
          valueColor={calc.balanceDue <= 0 ? 'text-omega-success' : 'text-amber-600'}
        />
      </div>

      {/* Drift warning — if the sum of approved estimates has moved
          away from the saved estimated_revenue, the form silently kept
          the old value and Finance KPIs went stale. Audit #12.
          Uses the SUM of all approved/signed estimates so a job with
          multiple approved scopes (e.g. two estimates both approved)
          doesn't produce a false "mismatch" warning. */}
      {(() => {
        const saved  = parseNum(form.estimated_revenue);
        const latest = latestEstimateTotal != null ? Number(latestEstimateTotal) : null;
        if (latest == null || saved === 0) return null;
        const diff = latest - saved;
        if (Math.abs(diff) < 0.01) return null;
        return (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-amber-200 flex items-center justify-center flex-shrink-0 text-amber-800 font-bold text-sm">!</div>
            <div className="flex-1 text-sm text-amber-900">
              The sum of approved estimates is <strong>{money(latest)}</strong> — your saved revenue says
              <strong> {money(saved)}</strong> ({diff > 0 ? '+' : '−'}{money(Math.abs(diff))} difference).
              Revenue &amp; margin already use the accepted-estimates total; sync the saved field to match.
            </div>
            <button
              onClick={() => update('estimated_revenue', latest)}
              className="self-center px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold whitespace-nowrap"
            >
              Update to {money(latest)}
            </button>
          </div>
        );
      })()}

      {/* Inputs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <Field label="Estimated Revenue" value={form.estimated_revenue} onChange={(v) => update('estimated_revenue', v)} />
        <Field label="Material Cost" value={form.material_cost} onChange={(v) => update('material_cost', v)} />
        <Field label="Labor Cost" value={form.labor_cost} onChange={(v) => update('labor_cost', v)} />
        <Field
          label="Sub Cost"
          value={form.sub_cost}
          onChange={(v) => update('sub_cost', v)}
          helper={subsTotal > 0 ? `Agreements sum: ${money(subsTotal)} (click → to fill)` : null}
          onSync={subsTotal > 0 ? () => update('sub_cost', subsTotal) : null}
        />
        <Field label="Other Costs" value={form.other_costs} onChange={(v) => update('other_costs', v)} />

        {(expensesTotal - returnsTotal) > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-omega-cloud/60 px-3 py-2 text-xs">
            <span className="text-omega-stone">+ Logged receipts (Daily Logs / Receipts)</span>
            <span className="font-bold text-omega-charcoal tabular-nums">{money(expensesTotal - returnsTotal)}</span>
          </div>
        )}
        {returnsTotal < 0 && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs">
            <span className="text-emerald-700">− Returns (credit)</span>
            <span className="font-bold text-emerald-700 tabular-nums">{money(returnsTotal)}</span>
          </div>
        )}
        <p className="text-[11px] text-omega-stone">
          Total Cost = the four fields above + logged receipts ={' '}
          <strong className="text-omega-charcoal">{money(calc.totalCost)}</strong>.
        </p>

        <div className="border-t border-gray-100 pt-3">
          <Field
            label="Amount Received from Client"
            value={form.amount_received}
            onChange={(v) => update('amount_received', v)}
            helper={
              milestoneCount > 0
                ? `Auto-synced from ${milestoneCount} Finance milestone${milestoneCount === 1 ? '' : 's'} — mark received in Finance to update.`
                : (calc.revenue > 0 ? `Balance due: ${money(calc.balanceDue)}` : null)
            }
            readOnly={milestoneCount > 0}
            highlight
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-omega-stone uppercase">Other Costs Description</label>
          <input
            value={form.other_costs_description}
            onChange={(e) => update('other_costs_description', e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-base"
            placeholder="e.g. Dumpster, equipment rental…"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-omega-stone">
            {row?.updated_at ? `Last saved ${new Date(row.updated_at).toLocaleString()}` : 'Auto-saves as you type'}
          </p>
          <button
            onClick={() => save()}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save now'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, icon: Icon, valueColor = 'text-omega-charcoal' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${valueColor} flex items-center gap-1`}>
        {Icon && <Icon className="w-4 h-4" />}
        {value}
      </p>
    </div>
  );
}

function Field({ label, value, onChange, helper, onSync, highlight, readOnly }) {
  return (
    <div>
      <label className={`text-xs font-semibold uppercase ${highlight ? 'text-emerald-600' : 'text-omega-stone'}`}>{label}</label>
      <div className="relative mt-1">
        <DollarSign className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${highlight ? 'text-emerald-500' : 'text-omega-stone'}`} />
        <input
          type="number"
          step="0.01"
          value={value}
          readOnly={readOnly}
          onChange={(e) => !readOnly && onChange(e.target.value)}
          className={`w-full pl-9 pr-20 py-2.5 rounded-lg border text-base ${readOnly ? 'bg-gray-50 text-omega-stone cursor-not-allowed border-gray-200' : (highlight ? 'border-emerald-300 bg-emerald-50 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-200' : 'border-gray-200')}`}
          placeholder="0.00"
          inputMode="decimal"
        />
        {onSync && (
          <button
            onClick={onSync}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-omega-orange hover:text-omega-dark px-2 py-1 rounded-md"
          >
            Use
          </button>
        )}
      </div>
      {helper && <p className="text-[11px] text-omega-stone mt-1">{helper}</p>}
    </div>
  );
}
