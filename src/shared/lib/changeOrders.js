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

export function coNumberLabel(co) {
  return co?.co_number ? `CO-${co.co_number}` : 'Change Order';
}
