import { estimateDiscount } from '../lib/estimatePricing';

// "Subtotal / Fall promotion (5%) −$2,000" above an estimate's total on the
// client pages (estimate, alternatives, bundle). Renders nothing when the
// estimate has no discount. Inline styles: those pages print to PDF.

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EstimateDiscountLines({ estimate, fontSize = 13, style }) {
  const d = estimateDiscount(estimate);
  if (!d) return null;
  const row = { display: 'flex', justifyContent: 'space-between', gap: 16, fontVariantNumeric: 'tabular-nums' };
  return (
    <div style={{ fontSize, color: '#555', lineHeight: 1.7, ...style }}>
      <div style={row}>
        <span>Subtotal</span>
        <span>{money(d.subtotal)}</span>
      </div>
      <div style={row}>
        <span>{d.label}</span>
        <span style={{ color: '#15803d', fontWeight: 700 }}>−{money(d.amount)}</span>
      </div>
    </div>
  );
}
