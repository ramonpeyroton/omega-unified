// How an estimate shows its prices to the client (estimates.display_mode).
//
//   'breakdown' — every line item shows its own price (default)
//   'section'   — one price per section; the seller types it on the
//                 section and the items inside are listed without prices
//   'single'    — only the grand total; no item or section prices
//
// The client estimate page, the options / bundle pages, the contract
// (Schedule A) and the invoice all follow the SAME mode, so a price the
// estimate hid never shows up in a later document.

export function priceMode(mode) {
  return mode === 'section' || mode === 'single' ? mode : 'breakdown';
}

// Mode a section renders with. When several estimates are merged into
// one contract, EstimateFlow tags each section with its source
// estimate's mode (`price_mode`); a plain estimate row falls back to its
// own display_mode.
export function sectionMode(section, estimateMode) {
  return priceMode(section?.price_mode || estimateMode);
}

export function itemsTotal(section) {
  return (section?.items || []).reduce((acc, it) => acc + (Number(it.price) || 0), 0);
}

// What one section is worth: the typed section price in 'section' mode,
// the sum of its items otherwise.
export function sectionPrice(section, mode) {
  return priceMode(mode) === 'section' ? (Number(section?.price) || 0) : itemsTotal(section);
}

export function sectionsTotal(sections, mode) {
  return (sections || []).reduce((acc, s) => acc + sectionPrice(s, sectionMode(s, mode)), 0);
}

// Saved total first (it is what finance and the contract use); the
// section math is only a fallback for rows saved without one.
export function estimateTotal(estimate) {
  if (estimate?.total_amount != null) return Number(estimate.total_amount) || 0;
  return sectionsTotal(Array.isArray(estimate?.sections) ? estimate.sections : [], estimate?.display_mode);
}
