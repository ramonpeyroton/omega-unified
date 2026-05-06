import { useEffect, useState, useMemo, useRef } from 'react';
import { DollarSign, Save, TrendingUp, TrendingDown, Banknote, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Toast from './Toast';

function parseNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

      // Load estimate total (for default revenue)
      const { data: est } = await supabase
        .from('estimates')
        .select('total_amount')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Sum of subcontractor_agreements.their_estimate
      const { data: agrs } = await supabase
        .from('subcontractor_agreements')
        .select('their_estimate')
        .eq('job_id', job.id);
      const subs = (agrs || []).reduce((acc, a) => acc + (Number(a.their_estimate) || 0), 0);
      setSubsTotal(subs);

      setRow(cost || null);
      setForm({
        estimated_revenue: cost?.estimated_revenue ?? est?.total_amount ?? '',
        material_cost: cost?.material_cost ?? '',
        labor_cost: cost?.labor_cost ?? '',
        sub_cost: cost?.sub_cost ?? subs,
        other_costs: cost?.other_costs ?? '',
        other_costs_description: cost?.other_costs_description ?? '',
        amount_received: cost?.amount_received ?? '',
      });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to load costing' });
    } finally {
      setLoading(false);
    }
  }

  const calc = useMemo(() => {
    const revenue = parseNum(form.estimated_revenue);
    const mat = parseNum(form.material_cost);
    const labor = parseNum(form.labor_cost);
    const sub = parseNum(form.sub_cost);
    const other = parseNum(form.other_costs);
    const totalCost = mat + labor + sub + other;
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const received = parseNum(form.amount_received);
    const balanceDue = revenue - received;
    return { revenue, totalCost, profit, margin, received, balanceDue };
  }, [form]);

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
        amount_received: parseNum(formToSave.amount_received),
        gross_margin_percent: calc.margin,
        updated_at: new Date().toISOString(),
        updated_by: user?.name || null,
      };
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

        <div className="border-t border-gray-100 pt-3">
          <Field
            label="Amount Received from Client"
            value={form.amount_received}
            onChange={(v) => update('amount_received', v)}
            helper={calc.revenue > 0 ? `Balance due: ${money(calc.balanceDue)}` : null}
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

function Field({ label, value, onChange, helper, onSync, highlight }) {
  return (
    <div>
      <label className={`text-xs font-semibold uppercase ${highlight ? 'text-emerald-600' : 'text-omega-stone'}`}>{label}</label>
      <div className="relative mt-1">
        <DollarSign className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${highlight ? 'text-emerald-500' : 'text-omega-stone'}`} />
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full pl-9 pr-20 py-2.5 rounded-lg border text-base ${highlight ? 'border-emerald-300 bg-emerald-50 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-200' : 'border-gray-200'}`}
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
