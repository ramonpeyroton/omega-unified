import { useEffect, useState } from 'react';
import { supabase } from '../../shared/lib/supabase';
import { DEFAULT_ESTIMATE_DISCLAIMERS } from '../../shared/data/estimateDisclaimers';
import SignatureFlow from '../../shared/components/SignatureFlow';

// Public, auth-less page that renders a single estimate.
// URL: /estimate-view/:id  — ID is pulled from the path.
// The client receives this URL in the email and can use browser "Print"
// → "Save as PDF" to get a polished file.

// Default closing message shown on every estimate. Sellers can override
// on a per-estimate basis via the customer_message column.
const DEFAULT_CUSTOMER_MESSAGE =
  'Once estimate is approved, we will send the final contract along with a payment schedule and deposit requested. Thanks for choosing Omega Development. We look forward to working together.';

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtEstimateNumber(n) {
  if (n == null || n === '') return '—';
  return `OM-${n}`;
}

export default function EstimateView() {
  const [loading, setLoading] = useState(true);
  const [estimate, setEstimate] = useState(null);
  const [job, setJob] = useState(null);
  const [company, setCompany] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const id = window.location.pathname.split('/').pop();
    if (!id) { setErr('Missing estimate id'); setLoading(false); return; }
    (async () => {
      try {
        const [{ data: e }, { data: c }] = await Promise.all([
          supabase.from('estimates').select('*').eq('id', id).maybeSingle(),
          supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (!e) throw new Error('Estimate not found');
        const { data: j } = await supabase.from('jobs').select('*').eq('id', e.job_id).maybeSingle();
        setEstimate(e); setJob(j || null); setCompany(c || null);
      } catch (er) {
        setErr(er?.message || String(er));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading estimate…</p>;
  if (err)     return <p style={{ padding: 40, fontFamily: 'sans-serif', color: '#b00' }}>{err}</p>;
  if (!estimate) return null;

  const sections = Array.isArray(estimate.sections) ? estimate.sections : [];
  const total = estimate.total_amount ?? sections.reduce((acc, s) =>
    acc + (s.items || []).reduce((a, it) => a + (Number(it.price) || 0), 0), 0);

  const companyLines = [company?.address, company?.phone, company?.email].filter(Boolean);
  const customerLines = [job?.client_name, job?.address, job?.client_phone, job?.client_email].filter(Boolean);

  return (
    <div style={{ padding: '32px 16px', background: '#f5f5f3', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif', color: '#2C2C2A' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>

        {/* Print button hidden on print */}
        <div className="no-print" style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => window.print()}
            style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#E8732A', color: 'white', fontWeight: 700, cursor: 'pointer' }}
          >
            Print / Save as PDF
          </button>
        </div>

        <div style={{ background: 'white', padding: 32, borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: 'top' }}>
                  {company?.logo_url ? (
                    <img
                      src={company.logo_url}
                      alt={company?.company_name || 'Omega Development'}
                      style={{ height: 72, width: 'auto', display: 'block' }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <img
                        src="/logo.png"
                        alt="Omega Development"
                        style={{ height: 64, width: 64, display: 'block' }}
                      />
                      <div style={{ lineHeight: 1 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#2C2C2A', letterSpacing: '-0.02em' }}>
                          OMEGA<span style={{ color: '#E8732A' }}>DEVELOPMENT</span>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#6b6b6b', letterSpacing: '.18em', marginTop: 6 }}>
                          RENOVATIONS &amp; CONSTRUCTION
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, marginTop: 12 }}>
                    {companyLines.map((l, i) => <div key={i}>{l}</div>)}
                  </div>
                </td>
                <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                  <div style={{ fontSize: 32, fontWeight: 900 }}>Estimate</div>
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    <div><strong style={{ color: '#6b6b6b', letterSpacing: '.08em', textTransform: 'uppercase' }}>Estimate #</strong> &nbsp; {fmtEstimateNumber(estimate.estimate_number)}</div>
                    <div><strong style={{ color: '#6b6b6b', letterSpacing: '.08em', textTransform: 'uppercase' }}>Date</strong> &nbsp; {new Date(estimate.created_at || Date.now()).toLocaleDateString()}</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24 }}>
            <tbody>
              <tr>
                <td style={{ width: '50%', paddingRight: 12, verticalAlign: 'top' }}>
                  <Block title="Customer" lines={customerLines} />
                </td>
                <td style={{ width: '50%', paddingLeft: 12, verticalAlign: 'top' }}>
                  <Block title="Service Location" lines={customerLines} />
                </td>
              </tr>
            </tbody>
          </table>

          {estimate.header_description && (
            <div style={{ marginTop: 20, background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 }}>
              <Kicker>Description</Kicker>
              <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-line', lineHeight: 1.6, marginTop: 8 }}>
                {estimate.header_description}
              </div>
            </div>
          )}

          {sections.map((sec, i) => {
            const singlePrice = estimate.display_mode === 'single';
            return (
            <div key={i} style={{ marginTop: 24 }}>
              <div style={{ background: '#2C2C2A', color: 'white', padding: '10px 16px', fontSize: 14, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', textAlign: 'center' }}>
                {sec.title}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b' }}>Description</th>
                    {!singlePrice && <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', width: 120 }}>Price</th>}
                  </tr>
                </thead>
                <tbody>
                  {(sec.items || []).map((it, j) => (
                    <tr key={j} style={{ borderBottom: '1px solid #f1f1f1', verticalAlign: 'top' }}>
                      <td style={{ padding: 12 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{it.description}</div>
                        <div style={{ color: '#555', fontSize: 12, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{it.scope}</div>
                      </td>
                      {!singlePrice && <td style={{ padding: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(it.price)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            );
          })}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 28 }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: 'top', width: '60%', paddingRight: 12 }}>
                  <div style={{ background: '#fafafa', border: '1px solid #eee', padding: 16, borderRadius: 6 }}>
                    <Kicker>Customer Message</Kicker>
                    <div style={{ fontSize: 13, color: '#333', whiteSpace: 'pre-line', lineHeight: 1.6, marginTop: 8 }}>
                      {estimate.customer_message || DEFAULT_CUSTOMER_MESSAGE}
                    </div>
                  </div>
                </td>
                <td style={{ verticalAlign: 'top', width: '40%', paddingLeft: 12, textAlign: 'right' }}>
                  <Kicker>Estimate Total</Kicker>
                  <div style={{ fontSize: 34, color: '#E8732A', fontWeight: 900, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    {money(total)}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* ─── Signature flow — initials + disclaimers + signature ─── */}
          <SignatureFlow
            estimateId={estimate.id}
            customerName={job?.client_name}
            companyPhone={company?.phone}
            disclaimers={estimate.disclaimers || DEFAULT_ESTIMATE_DISCLAIMERS}
            existingSignature={
              estimate.signature_png
                ? {
                    png:       estimate.signature_png,
                    name:      estimate.signed_by,
                    at:        estimate.signed_at,
                    date:      estimate.signed_date,
                    ip:        estimate.signed_ip,
                    initials:  estimate.initials_png,
                  }
                : null
            }
          />

          <div style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid #eee', fontSize: 11, color: '#888', textAlign: 'center' }}>
            Questions? Reply to this email or call {company?.phone || ''}.
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}


function Kicker({ children }) {
  return <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>{children}</div>;
}

// Tiny markdown-ish renderer used by the disclaimers block. Handles
// **bold**, ***bold-italic***, paragraph breaks (blank lines), and
// horizontal rules (---). Anything else is passed through as plain
// text. Defensive for any input — the disclaimers come from the
// editor in EstimateBuilder so we have to assume they may not be
// well-formed markdown.
function renderDisclaimers(text) {
  if (!text) return null;
  const blocks = String(text).split(/\n\s*\n/);
  return blocks.map((block, bi) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    if (/^-{3,}$/.test(trimmed)) {
      return <hr key={bi} style={{ border: 0, borderTop: '1px solid #ddd', margin: '16px 0' }} />;
    }
    return (
      <p key={bi} style={{ fontSize: 12, color: '#333', lineHeight: 1.55, margin: '0 0 12px', whiteSpace: 'pre-line' }}>
        {renderInlineBold(trimmed)}
      </p>
    );
  });
}

function renderInlineBold(line) {
  // Splits on ***x*** (bold-italic) and **x** (bold) without altering
  // the rest of the text.
  const parts = [];
  let remaining = line;
  let key = 0;
  while (remaining.length > 0) {
    const boldItalic = remaining.match(/^\*\*\*([^*]+?)\*\*\*/);
    const bold       = !boldItalic && remaining.match(/^\*\*([^*]+?)\*\*/);
    if (boldItalic) {
      parts.push(
        <strong key={key++} style={{ fontStyle: 'italic', color: '#2C2C2A' }}>{boldItalic[1]}</strong>
      );
      remaining = remaining.slice(boldItalic[0].length);
      continue;
    }
    if (bold) {
      parts.push(
        <strong key={key++} style={{ color: '#2C2C2A' }}>{bold[1]}</strong>
      );
      remaining = remaining.slice(bold[0].length);
      continue;
    }
    // Eat plain text up to the next `**` or end of string
    const next = remaining.indexOf('**');
    if (next === -1) {
      parts.push(remaining);
      break;
    }
    parts.push(remaining.slice(0, next));
    remaining = remaining.slice(next);
  }
  return parts;
}

function Block({ title, lines }) {
  return (
    <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 }}>
      <Kicker>{title}</Kicker>
      <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 8 }}>
        {lines && lines.length
          ? lines.map((l, i) => <div key={i}>{l}</div>)
          : '—'}
      </div>
    </div>
  );
}
