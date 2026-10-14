// Change orders — one set of rules for the maker (ChangeOrderEditor), the
// job's Documents list (ChangeOrdersFolder) and the client page
// (/change-order-view/:id). The email template in api/send-estimate.js
// mirrors coItems/coPriceMode (api code can't import from src).
//
// price_mode: 'itemized' = each item shows its own price
//             'single'   = items listed without prices, one price for all
// Rows created before migration 085 have only description + amount: they
// read as a single item and show one total.

export const CO_TERMS = [
  'Once signed by both parties, this Change Order becomes part of the original contract.',
  'Payment for this Change Order is due upon signing.',
  'Work described above begins only after this Change Order is signed.',
  'Pricing is valid for 15 days from the date above.',
  'All other terms, warranties and conditions of the original contract stay the same.',
];

// Snapshot saved with the signature (change_orders.disclaimers).
export const CO_TERMS_TEXT = CO_TERMS.map((t, i) => `${i + 1}. ${t}`).join('\n');

// 'void' = cancelled by Omega (e.g. an old version the client should no
// longer sign). Can't be edited, sent or signed; never counts as revenue.
export function isCoVoid(co) {
  return co?.status === 'void';
}

export function isLegacyCo(co) {
  return !(Array.isArray(co?.items) && co.items.length);
}

export function coItems(co) {
  if (!isLegacyCo(co)) return co.items.filter((i) => i && (i.title || i.details));
  return co?.description ? [{ title: co.description, details: '', price: Number(co.amount) || 0 }] : [];
}

// Legacy rows have one total, so they always read as 'single'.
export function coPriceMode(co) {
  if (isLegacyCo(co)) return 'single';
  return co?.price_mode === 'single' ? 'single' : 'itemized';
}

export function itemsTotal(items) {
  return (items || []).reduce((sum, i) => sum + (Number(i.price) || 0), 0);
}

// Short text kept in change_orders.description for the screens that list it.
export function summarizeCo(title, items) {
  const t = (title || '').trim();
  if (t) return t;
  return (items || []).map((i) => i.title).filter(Boolean).join('; ');
}

// ─── Kinds ────────────────────────────────────────────────────────
// The same table, editor, client page and signature also carry the
// "Survey & Plans" agreement (kind = 'plans', migration 089): small jobs
// sold without a contract. Rows from before 089 have no kind → change order.

export const PLANS_TERMS = [
  'This agreement covers only the survey and/or drawing services described above. Construction work is not included and is quoted separately.',
  'Payment follows the schedule below. The deposit is due upon signing, and work starts once it is received.',
  'Deposits are non-refundable once work has started.',
  'Drawings and survey documents are released to the client when paid in full.',
  'Pricing is valid for 15 days from the date above.',
];

export const DEFAULT_PLANS_PLAN = [
  { label: 'Deposit', percent: 50 },
  { label: 'Upon delivery', percent: 50 },
];

const KINDS = {
  change_order: { name: 'Change Order', prefix: 'CO', terms: CO_TERMS },
  plans:        { name: 'Survey & Plans', prefix: 'SP', terms: PLANS_TERMS },
};

export function coKind(co) {
  return co?.kind === 'plans' ? 'plans' : 'change_order';
}

export function kindMeta(kind) {
  return KINDS[kind === 'plans' ? 'plans' : 'change_order'];
}

export function coTerms(co) {
  return kindMeta(coKind(co)).terms;
}

export function coTermsText(co) {
  return coTerms(co).map((t, i) => `${i + 1}. ${t}`).join('\n');
}

export function coNumberLabel(co) {
  const { name, prefix } = kindMeta(coKind(co));
  return co?.co_number ? `${prefix}-${co.co_number}` : name;
}

// How the client pays: a change order is due in full on signing; a Survey
// & Plans agreement follows its own plan (default 50/50). Percent-based —
// amounts come from co.amount.
export function coPaymentPlan(co) {
  if (coKind(co) === 'change_order') return [{ label: 'Due upon signing', percent: 100 }];
  const plan = Array.isArray(co?.payment_plan) ? co.payment_plan.filter((p) => Number(p?.percent) > 0) : [];
  return plan.length ? plan : DEFAULT_PLANS_PLAN;
}
