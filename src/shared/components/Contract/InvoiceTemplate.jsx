import { forwardRef, useMemo } from 'react';

// Per-installment invoice. Cópia simplificada do estimate (sem
// assinatura, sem checkboxes) que a Brenda envia pro cliente quando
// chega a hora de cobrar uma parcela específica do payment plan.
//
// O componente é PURAMENTE VISUAL — quem renderiza ele off-screen,
// chama html2pdf no DOM e faz upload do PDF é o EstimateFlow step 5.
// Mantemos o markup em divs (não inputs) pra ficar idêntico ao print.

function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function todayLocal() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const InvoiceTemplate = forwardRef(function InvoiceTemplate(
  { job, estimate, milestone, contract, company, installmentNumber, totalInstallments },
  ref
) {
  const lineItems = useMemo(() => {
    const items = [];
    if (Array.isArray(estimate?.sections)) {
      estimate.sections.forEach((sec) => {
        (sec.items || []).forEach((it) =>
          items.push({
            description: it.description || sec.title || '',
            scope: it.scope || '',
            price: Number(it.price) || 0,
          })
        );
      });
    } else if (Array.isArray(estimate?.line_items)) {
      estimate.line_items.forEach((li) =>
        items.push({
          description: li.description || li.item || '',
          scope: li.scope || '',
          price: Number(li.total ?? li.unit_price ?? 0),
        })
      );
    }
    return items;
  }, [estimate]);

  const contractTotal = Number(contract?.total_amount || estimate?.total_amount || 0);
  const dueAmount     = Number(milestone?.due_amount || 0);
  const dueDate       = milestone?.due_date || null;
  const installmentLabel = milestone?.label || `Installment ${installmentNumber}`;
  const invoiceNumber = `INV-${String(milestone?.id || '').slice(0, 8).toUpperCase()}`;

  const companyName = company?.company_name || 'Omega Development LLC';
  const companyAddr = [
    company?.address,
    [company?.city, company?.state].filter(Boolean).join(', '),
    company?.zip,
  ].filter(Boolean).join(' · ');
  const companyPhone = company?.phone || '';
  const companyEmail = company?.email || '';

  return (
    <div
      ref={ref}
      className="invoice-doc"
      style={{
        // Full US-Letter width so the PDF (jsPDF format: 'letter') never
        // clips the right edge. Horizontal whitespace comes from this
        // element's own side padding (the html2pdf horizontal margin is 0),
        // so content sits safely inside the page.
        width: '8.5in',
        padding: '0 0.6in',
        boxSizing: 'border-box',
        background: '#ffffff',
        color: '#2C2C2A',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        fontSize: '13px',
        lineHeight: 1.55,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #E8732A', paddingBottom: 16 }}>
        <div>
          {company?.logo_url ? (
            <img src={company.logo_url} alt={companyName} style={{ height: 64, display: 'block' }} />
          ) : (
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1 }}>
                OMEGA<span style={{ color: '#E8732A' }}>DEVELOPMENT</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#6b6b6b', letterSpacing: '.18em', marginTop: 6 }}>
                RENOVATIONS &amp; CONSTRUCTION
              </div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
            {companyAddr && <div>{companyAddr}</div>}
            {(companyPhone || companyEmail) && (
              <div>
                {companyPhone}
                {companyPhone && companyEmail ? ' · ' : ''}
                {companyEmail}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1 }}>INVOICE</div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#555', lineHeight: 1.6 }}>
            <div><strong>Invoice #:</strong> {invoiceNumber}</div>
            <div><strong>Date:</strong> {todayLocal()}</div>
            {dueDate && <div><strong>Due:</strong> {fmtDate(dueDate)}</div>}
          </div>
        </div>
      </div>

      {/* Bill to */}
      <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
        <div style={{ flex: 1, background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>Bill To</div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>{job?.client_name || '—'}</div>
            {job?.address && <div>{job.address}</div>}
            {job?.client_phone && <div>{job.client_phone}</div>}
            {job?.client_email && <div>{job.client_email}</div>}
          </div>
        </div>
        <div style={{ flex: 1, background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>Project</div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>{job?.service || job?.name || 'Project'}</div>
            {job?.address && <div>{job.address}</div>}
            <div style={{ color: '#888', marginTop: 4 }}>
              Contract total: {money(contractTotal)}
            </div>
          </div>
        </div>
      </div>

      {/* Scope */}
      <div style={{ marginTop: 24 }}>
        <div style={{ background: '#2C2C2A', color: 'white', padding: '8px 14px', fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
          Scope of Work
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', width: 120 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr>
                <td colSpan={2} style={{ padding: 16, textAlign: 'center', color: '#888' }}>See attached estimate</td>
              </tr>
            ) : lineItems.map((it, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f1f1', verticalAlign: 'top' }}>
                <td style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{it.description}</div>
                  {it.scope && (
                    <div style={{ color: '#555', fontSize: 11, whiteSpace: 'pre-line', lineHeight: 1.6, marginTop: 4 }}>{it.scope}</div>
                  )}
                </td>
                <td style={{ padding: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {money(it.price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Amount due now — destacado em laranja */}
      <div style={{ marginTop: 28, border: '2px solid #E8732A', borderRadius: 8, padding: 18, background: '#FFF7F1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#E8732A', fontWeight: 800 }}>Amount Due — This Invoice</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>
              {installmentLabel}
              {totalInstallments > 1 && (
                <span style={{ color: '#888', fontWeight: 500, marginLeft: 8, fontSize: 13 }}>
                  ({installmentNumber} of {totalInstallments})
                </span>
              )}
            </div>
            {dueDate && (
              <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>Due by {fmtDate(dueDate)}</div>
            )}
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#E8732A', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {money(dueAmount)}
          </div>
        </div>
      </div>

      {/* Payment instructions + notes */}
      <div style={{ marginTop: 24, background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 }}>
        <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>How to Pay</div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#333', lineHeight: 1.7 }}>
          Make checks payable to <strong>{companyName}</strong>{companyAddr ? ` and mail to ${companyAddr}` : ''}.
          {companyPhone && <> For ACH or wire instructions, call us at <strong>{companyPhone}</strong>.</>}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #eee', fontSize: 10, color: '#888', textAlign: 'center' }}>
        Thank you for your business. Questions? Reply to this email{companyPhone ? ` or call ${companyPhone}` : ''}.
      </div>
    </div>
  );
});

export default InvoiceTemplate;
