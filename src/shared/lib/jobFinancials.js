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

// Sum of SIGNED change orders — extra scope the client approved and
// signed, added on top of the base contract revenue.
export function sumSignedChangeOrders(changeOrders = []) {
  return (changeOrders || [])
    .filter((c) => c?.status === 'signed')
    .reduce((s, c) => s + (Number(c?.amount) || 0), 0);
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
  changeOrderTotal = 0,
} = {}) {
  const accepted = Number(acceptedEstimateTotal) || 0;
  const manualRev = Number(manualRevenue) || 0;
  const changeOrders = Number(changeOrderTotal) || 0;

  // Base revenue = accepted estimates (else manual). Signed change orders
  // are extra approved scope, so they add ON TOP of the base.
  const baseRevenue = accepted > 0 ? accepted : manualRev;
  const revenue = baseRevenue + changeOrders;
  const cost = (Number(expensesTotal) || 0) + (Number(manualCost) || 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : null;
  const revenueSource = accepted > 0 ? 'estimates' : (manualRev > 0 ? 'manual' : 'none');

  return { revenue, baseRevenue, changeOrders, cost, profit, margin, revenueSource };
}
