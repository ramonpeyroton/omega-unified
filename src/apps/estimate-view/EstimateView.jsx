import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../shared/lib/supabase';

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

          {sections.map((sec, i) => (
            <div key={i} style={{ marginTop: 24 }}>
              <div style={{ background: '#2C2C2A', color: 'white', padding: '10px 16px', fontSize: 14, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', textAlign: 'center' }}>
                {sec.title}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b' }}>Description</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', width: 120 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(sec.items || []).map((it, j) => (
                    <tr key={j} style={{ borderBottom: '1px solid #f1f1f1', verticalAlign: 'top' }}>
                      <td style={{ padding: 12 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{it.description}</div>
                        <div style={{ color: '#555', fontSize: 12, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{it.scope}</div>
                      </td>
                      <td style={{ padding: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(it.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

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

          {/* ─── Signature block — posts to /api/sign-estimate on approve ─── */}
          <SignatureBlock
            estimateId={estimate.id}
            customerName={job?.client_name}
            companyPhone={company?.phone}
            existingSignature={
              estimate.signature_png
                ? {
                    png: estimate.signature_png,
                    name: estimate.signed_by,
                    at: estimate.signed_at,
                    ip: estimate.signed_ip,
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

// ─────────────────────────────────────────────────────────────────────
// SignatureBlock — canvas + name + consent. Persists via
// POST /api/sign-estimate (migration 016 adds the columns). Once a
// row has `signature_png` set, the block renders in read-only mode
// showing who signed, when, and from which IP.
// ─────────────────────────────────────────────────────────────────────
function SignatureBlock({ estimateId, customerName, companyPhone, existingSignature }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const [hasInk, setHasInk] = useState(false);

  const [printedName, setPrintedName] = useState(customerName || '');
  const [consent, setConsent] = useState(false);

  // `signed` renders the locked receipt. Seeded from `existingSignature`
  // when the page loads and the estimate is already signed; otherwise
  // gets populated on successful API response.
  const [signed, setSigned] = useState(
    existingSignature
      ? { png: existingSignature.png, name: existingSignature.name, at: existingSignature.at }
      : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Skip the canvas setup when the block opens in locked mode — the
  // form isn't rendered so there's no canvas element to size.
  useEffect(() => {
    if (signed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = '#111';
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [signed]);

  function pointerPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  function onDown(e) {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pointerPos(e);
  }
  function onMove(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const { x, y } = pointerPos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastRef.current = { x, y };
    if (!hasInk) setHasInk(true);
  }
  function onUp() { drawingRef.current = false; }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  async function sign() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const canvas = canvasRef.current;
      const png = canvas.toDataURL('image/png');
      const name = printedName.trim();

      const r = await fetch('/api/sign-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimate_id:   estimateId,
          signature_png: png,
          signed_by:     name,
          consent:       true,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (HTTP ${r.status})`);
      }
      setSigned({ png, name, at: data.signed_at || new Date().toISOString() });
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSign = hasInk && printedName.trim().length >= 2 && consent && !submitting;

  // ─── Already signed — show static receipt ───────────────────────────
  if (signed) {
    const signedAtDate = signed.at instanceof Date ? signed.at : new Date(signed.at);
    const signedAtLabel = isNaN(signedAtDate.getTime())
      ? String(signed.at)
      : signedAtDate.toLocaleString();
    return (
      <div style={{ marginTop: 32, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#16a34a', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✓</div>
          <div>
            <div style={{ fontWeight: 800, color: '#15803d', fontSize: 16 }}>Estimate Approved</div>
            <div style={{ fontSize: 12, color: '#166534' }}>
              Signed by <strong>{signed.name}</strong> on {signedAtLabel}
            </div>
          </div>
        </div>
        <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 6, padding: 10, marginTop: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#15803d', fontWeight: 700, marginBottom: 6 }}>Signature</div>
          <img src={signed.png} alt="Signature" style={{ maxWidth: 320, display: 'block' }} />
        </div>
        <p style={{ fontSize: 11, color: '#166534', marginTop: 10 }}>
          Omega will send the final contract shortly with a payment schedule and deposit request.
          {companyPhone ? ` Questions: ${companyPhone}.` : ''}
        </p>
      </div>
    );
  }

  // ─── Unsigned — show the sign-in form ───────────────────────────────
  return (
    <div className="no-print" style={{ marginTop: 32, background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>
        Approve & Sign
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 900, margin: '6px 0 4px', color: '#2C2C2A' }}>
        Ready to move forward?
      </h3>
      <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginBottom: 16 }}>
        Sign below to approve this estimate. Once signed, Omega will send the final
        contract (with payment schedule and deposit request) via DocuSign to your email.
      </p>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', marginBottom: 6 }}>
        Draw your signature
      </label>
      <div style={{ position: 'relative', background: 'white', border: '1px solid #ccc', borderRadius: 6, touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onTouchStart={onDown}
          onTouchMove={onMove}
          onTouchEnd={onUp}
          style={{ display: 'block', width: '100%', height: 160, cursor: 'crosshair', borderRadius: 6 }}
        />
        {!hasInk && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#c8c8c8', fontSize: 13, pointerEvents: 'none', fontStyle: 'italic' }}>
            Draw with your finger or mouse
          </div>
        )}
        <button
          type="button"
          onClick={clearCanvas}
          style={{ position: 'absolute', top: 8, right: 8, background: 'white', border: '1px solid #ddd', fontSize: 11, fontWeight: 700, color: '#6b6b6b', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', margin: '14px 0 6px' }}>
        Print your full name
      </label>
      <input
        type="text"
        value={printedName}
        onChange={(e) => setPrintedName(e.target.value)}
        placeholder="e.g. Brian Salley"
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
      />

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, fontSize: 12, color: '#333', lineHeight: 1.55, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          I agree to sign this estimate electronically and confirm my electronic signature
          is legally binding under the U.S. ESIGN Act. I authorize Omega Development LLC
          to proceed with scheduling the contract based on this approval.
        </span>
      </label>

      {error && (
        <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={sign}
        disabled={!canSign}
        style={{
          marginTop: 16,
          width: '100%',
          padding: '14px 20px',
          background: canSign ? '#E8732A' : '#e5e5e5',
          color: canSign ? 'white' : '#aaa',
          border: 'none',
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 900,
          letterSpacing: '.02em',
          cursor: canSign ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Signing…' : 'Sign & Approve Estimate'}
      </button>

      <p style={{ fontSize: 10, color: '#888', marginTop: 10, textAlign: 'center' }}>
        By signing, you acknowledge the estimate and scope above. The final binding contract
        will be sent separately via DocuSign. Your IP address and timestamp are recorded as
        part of the signature audit trail.
      </p>
    </div>
  );
}

function Kicker({ children }) {
  return <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>{children}</div>;
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
