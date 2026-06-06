// Unified job financials — ONE source of truth for revenue, cost,
// profit and margin, shared by the Owner dashboard Active Jobs table
// and the Financials tab (JobCostingSection) so the numbers always
// agree.
//
// Revenue priority:
//   1. Sum of ACCEPTED estimates (status 'approved' | 'signed') when any exist.
//   2. Otherwise the manual Job Costing revenue (job_costs.estimated_revenue) —
//      this is the only source for jobs imported from the old app.
//
// Cost = every logged receipt / expense (job_expenses) PLUS the manual
// cost fields entered on the Financials tab (material + labor + sub + other).
// Receipts cover material purchases; the manual fields cover labor, subs
// and other lump costs that don't have a receipt — so they sum, they
// don't overlap.
//
// Margin % = (revenue − cost) / revenue × 100   (null when no revenue).

export function sumAcceptedEstimates(estimates = []) {
  return (estimates || [])
    .filter((e) => e?.status === 'approved' || e?.status === 'signed')
    .reduce((s, e) => s + (Number(e?.total_amount) || 0), 0);
}

export function manualCostTotal(cost) {
  if (!cost) return 0;
  return (Number(cost.material_cost) || 0)
       + (Number(cost.labor_cost) || 0)
       + (Number(cost.sub_cost) || 0)
       + (Number(cost.other_costs) || 0);
}

/**
 * @param {object} args
 * @param {number} [args.acceptedEstimateTotal] sum of approved/signed estimates
 * @param {number} [args.manualRevenue]          job_costs.estimated_revenue
 * @param {number} [args.manualCost]             material+labor+sub+other
 * @param {number} [args.expensesTotal]          sum of job_expenses
 * @returns {{revenue:number, cost:number, profit:number, margin:number|null, revenueSource:'estimates'|'manual'|'none'}}
 */
export function computeJobFinancials({
  acceptedEstimateTotal = 0,
  manualRevenue = 0,
  manualCost = 0,
  expensesTotal = 0,
} = {}) {
  const accepted = Number(acceptedEstimateTotal) || 0;
  const manualRev = Number(manualRevenue) || 0;

  const revenue = accepted > 0 ? accepted : manualRev;
  const cost = (Number(expensesTotal) || 0) + (Number(manualCost) || 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;
  const revenueSource = accepted > 0 ? 'estimates' : (manualRev > 0 ? 'manual' : 'none');

  return { revenue, cost, profit, margin, revenueSource };
}
