import { useEffect, useRef, useState } from 'react';
import html2pdf from 'html2pdf.js';
import { Printer, Download } from 'lucide-react';
import { supabase } from '../../shared/lib/supabase';
import { CO_TERMS, CO_TERMS_TEXT, coItems, coPriceMode, coNumberLabel } from '../../shared/lib/changeOrders';
import { SERVICE_LABEL, parseJobServices } from '../../shared/data/services';

// Public, auth-less page that renders a single Change Order on Omega's
// letterhead and lets the client sign it online — the change-order twin of
// /estimate-view. URL: /change-order-view/:id
// Omega's side comes pre-signed by Inácio (same signature image as the
// contract). Items show their own prices or one total, per co.price_mode.

const ORANGE = '#E8732A';
const INK = '#2C2C2A';
const LICENSES = 'CT HIC.0670573 · NHC.0017262';

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 'YYYY-MM-DD' is a calendar date — read it as local, not UTC midnight
// (which shows the day before in New York).
function prettyDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Kicker({ children, color = '#8a8a8a' }) {
  return <div style={{ fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color, fontWeight: 800 }}>{children}</div>;
}

export default function ChangeOrderView() {
  const [loading, setLoading] = useState(true);
  const [co, setCo] = useState(null);
  const [job, setJob] = useState(null);
  const [company, setCompany] = useState(null);
  const [contractSignedAt, setContractSignedAt] = useState(null);
  const [err, setErr] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    const id = window.location.pathname.split('/').pop();
    if (!id) { setErr('Missing change order id'); setLoading(false); return; }
    (async () => {
      try {
        const [{ data: c }, { data: comp }] = await Promise.all([
          supabase.from('change_orders').select('*').eq('id', id).maybeSingle(),
          supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (!c) throw new Error('Change order not found');
        const { data: j } = await supabase.from('jobs').select('*').eq('id', c.job_id).maybeSingle();
        setCo(c); setJob(j || null); setCompany(comp || null);

        // "Contract: Signed <date>" in the header — optional, skipped on any error.
        try {
          const { data: k } = await supabase.from('contracts').select('signed_at')
            .eq('job_id', c.job_id).not('signed_at', 'is', null)
            .order('signed_at', { ascending: false }).limit(1).maybeSingle();
          setContractSignedAt(k?.signed_at || null);
        } catch { /* ignore */ }

        // First-open beacon — co-located in send-estimate.js (?action=opened)
        // because Vercel Hobby caps functions at 12. Fire-and-forget.
        try {
          fetch('/api/send-estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ changeOrderId: id, action: 'opened' }),
            keepalive: true,
          }).catch(() => {});
        } catch { /* ignore */ }
      } catch (er) {
        setErr(er?.message || String(er));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading change order…</p>;
  if (err)     return <p style={{ padding: 40, fontFamily: 'sans-serif', color: '#b00' }}>{err}</p>;
  if (!co) return null;

  const items = coItems(co);
  const itemized = coPriceMode(co) === 'itemized';
  const number = coNumberLabel(co);
  const companyName = company?.company_name || 'Omega Development LLC';
  const cityLine = `${[company?.city, company?.state].filter(Boolean).join(', ')}${company?.zip ? ` ${company.zip}` : ''}`.trim();
  const companyLines = [company?.address, cityLine, [company?.phone, company?.email].filter(Boolean).join(' · '), LICENSES].filter(Boolean);
  const [street, ...restAddress] = (job?.address || '').split(',');
  const projectName = parseJobServices(job?.service).map((s) => SERVICE_LABEL[s]).filter(Boolean).join(' + ') || 'Project';
  const issuedOn = co.sent_at || co.created_at;

  async function downloadPDF() {
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      const client = (job?.client_name || 'Client').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
      await html2pdf()
        .set({
          margin: [8, 4, 8, 4],
          filename: `Omega_Change_Order_${number}_${client}.pdf`,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, ignoreElements: (el) => el.classList?.contains('no-print') },
          jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
        })
        .from(contentRef.current)
        .save();
    } catch (pdfErr) {
      console.error('PDF download failed:', pdfErr);
      alert('Failed to generate PDF. Please try using Print instead.');
    } finally {
      setDownloading(false);
    }
  }

  const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' };

  return (
    <div style={{ background: '#f2f1ee', minHeight: '100vh', padding: '24px 16px', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif', color: INK }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <button onClick={() => window.print()} style={{ ...btn, border: `2px solid ${ORANGE}`, background: 'white', color: ORANGE }}>
            <Printer size={15} /> Print
          </button>
          <button onClick={downloadPDF} disabled={downloading} style={{ ...btn, border: 'none', background: downloading ? '#ccc' : ORANGE, color: 'white', cursor: downloading ? 'wait' : 'pointer' }}>
            <Download size={15} /> {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>

        <div ref={contentRef} style={{ background: 'white', borderRadius: 10, boxShadow: '0 2px 14px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ height: 6, background: ORANGE }} />
          <div style={{ padding: 'clamp(18px, 4.5vw, 36px)' }}>

            {/* Letterhead */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                {company?.logo_url ? (
                  <img src={company.logo_url} alt={companyName} style={{ height: 64, width: 'auto', display: 'block' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* /logo.png has stray letters at the bottom edge — crop them. */}
                    <div style={{ width: 62, height: 55, overflow: 'hidden', flexShrink: 0 }}>
                      <img src="/logo.png" alt="Omega Development" style={{ width: 62, height: 62, display: 'block' }} />
                    </div>
                    <div style={{ lineHeight: 1 }}>
                      <div style={{ fontSize: 21, fontWeight: 900, letterSpacing: '-0.02em' }}>OMEGA<span style={{ color: ORANGE }}>DEVELOPMENT</span></div>
                      <div style={{ fontSize: 9.5, fontWeight: 600, color: '#6b6b6b', letterSpacing: '.18em', marginTop: 6 }}>RENOVATIONS &amp; CONSTRUCTION</div>
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: '#666', lineHeight: 1.6, marginTop: 12 }}>
                  {companyLines.map((l, i) => <div key={i}>{l}</div>)}
                </div>
              </div>
              <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.01em' }}>Change Order</div>
                <table style={{ marginLeft: 'auto', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
                  <tbody>
                    {[
                      ['Change Order #', number],
                      ['Date', prettyDate(issuedOn)],
                      contractSignedAt ? ['Contract', `Signed ${prettyDate(contractSignedAt)}`] : null,
                    ].filter(Boolean).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: '#8a8a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10.5, padding: '2px 10px 2px 0', textAlign: 'right' }}>{k}</td>
                        <td style={{ fontWeight: 700, padding: '2px 0', textAlign: 'right' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Client / project */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 26 }}>
              <div style={{ background: '#fafaf8', border: '1px solid #eee', borderRadius: 8, padding: 14 }}>
                <Kicker>Client</Kicker>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 6 }}>
                  <strong>{job?.client_name || '—'}</strong>
                  {job?.client_phone && <div>{job.client_phone}</div>}
                  {job?.client_email && <div>{job.client_email}</div>}
                </div>
              </div>
              <div style={{ background: '#fafaf8', border: '1px solid #eee', borderRadius: 8, padding: 14 }}>
                <Kicker>Project</Kicker>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 6 }}>
                  <strong>{projectName}</strong>
                  {street && <div>{street.trim()}</div>}
                  {restAddress.length > 0 && <div>{restAddress.join(',').trim()}</div>}
                </div>
              </div>
            </div>

            <p style={{ fontSize: 13, color: '#444', lineHeight: 1.65, marginTop: 20 }}>
              This Change Order modifies the contract between <strong>{companyName}</strong> and <strong>{job?.client_name || 'the client'}</strong> for
              the project above. It adds the work described below. All other terms of the original contract remain unchanged.
            </p>

            {/* Items */}
            <div style={{ marginTop: 18 }}>
              <div style={{ background: INK, color: 'white', padding: '10px 16px', fontSize: 13, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{co.title || 'Changes to the scope of work'}</span>
                {itemized && <span style={{ opacity: 0.7 }}>Price</span>}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #efefef', verticalAlign: 'top' }}>
                      <td style={{ padding: '12px 0 12px 16px', width: 26, color: ORANGE, fontWeight: 900 }}>{i + 1}</td>
                      <td style={{ padding: '12px 16px 12px 6px' }}>
                        <div style={{ fontWeight: 800, whiteSpace: 'pre-wrap' }}>{it.title}</div>
                        {it.details && <div style={{ color: '#5a5a5a', fontSize: 12.5, lineHeight: 1.55, marginTop: 3, whiteSpace: 'pre-wrap' }}>{it.details}</div>}
                      </td>
                      {itemized && <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(it.price)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fdf4ee' }}>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#7a5a46' }}>
                  {itemized ? 'Total for this change order' : 'Price for all work above'}
                </span>
                <span style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{money(co.amount)}</span>
              </div>
            </div>

            {/* Terms */}
            <div style={{ marginTop: 22 }}>
              <Kicker>Terms of this change order</Kicker>
              <ol style={{ fontSize: 12, color: '#555', lineHeight: 1.65, margin: '8px 0 0', paddingLeft: 18, listStyle: 'decimal' }}>
                {CO_TERMS.map((t) => <li key={t}>{t}</li>)}
              </ol>
            </div>

            <Signatures
              co={co}
              number={number}
              customerName={job?.client_name || ''}
              omegaDate={prettyDate(issuedOn)}
              onSigned={(signed) => setCo((prev) => ({ ...prev, status: 'signed', ...signed }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Signatures: Omega (pre-signed) + client (draw, name, date, consent) ───
function Signatures({ co, number, customerName, omegaDate, onSigned }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const [hasInk, setHasInk] = useState(false);
  const [printedName, setPrintedName] = useState(customerName);
  const [signedDate, setSignedDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const isSigned = !!co.signature_png;

  useEffect(() => {
    if (isSigned) return undefined;
    const fit = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
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
  }, [isSigned]);

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }
  function onDown(e) { e.preventDefault(); drawingRef.current = true; lastRef.current = pos(e); }
  function onMove(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    if (!hasInk) setHasInk(true);
  }
  function onUp() { drawingRef.current = false; }
  function clear() {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  async function sign() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const png = canvasRef.current.toDataURL('image/png');
      const name = printedName.trim();
      const r = await fetch('/api/sign-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          change_order_id: co.id,
          signature_png: png,
          signed_by: name,
          signed_date: signedDate,
          // The terms are on the page above; the consent box accepts them.
          disclaimers: CO_TERMS_TEXT,
          disclaimers_acknowledged: true,
          consent: true,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error || `Request failed (HTTP ${r.status})`);
      onSigned({
        signature_png: png,
        signed_by: name,
        signed_at: data.signed_at || new Date().toISOString(),
        signed_date: data.signed_date || signedDate,
      });
    } catch (e) {
      setError(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSign = hasInk && printedName.trim().length >= 2 && !!signedDate && consent && !submitting;
  const field = { border: '1px solid #ddd', borderRadius: 6, padding: '9px 10px', fontSize: 16, background: 'white', boxSizing: 'border-box', outline: 'none' };

  return (
    <>
      {isSigned && (
        <div style={{ marginTop: 24, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#16a34a', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flexShrink: 0 }}>✓</div>
          <div style={{ fontSize: 13, color: '#166534' }}>
            <strong style={{ color: '#15803d' }}>Change Order approved</strong> — signed by <strong>{co.signed_by}</strong> on {prettyDate(co.signed_date || co.signed_at)}.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: isSigned ? 14 : 24 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 10, padding: 16 }}>
          <Kicker>Omega Development LLC</Kicker>
          <div style={{ height: 56, borderBottom: '1px solid #ccc', marginTop: 8, overflow: 'hidden' }}>
            <img src="/inacio-signature.png" alt="Inácio Deoliveira signature" style={{ display: 'block', height: 50, maxWidth: 220, objectFit: 'contain' }} />
          </div>
          <div style={{ paddingTop: 6, fontSize: 11.5, color: '#666' }}>Inácio Deoliveira, on behalf of Omega Development LLC{omegaDate ? ` · ${omegaDate}` : ''}</div>
        </div>

        {isSigned ? (
          <div style={{ border: '1px solid #bbf7d0', borderRadius: 10, padding: 16 }}>
            <Kicker color="#15803d">Client approval</Kicker>
            <div style={{ height: 56, borderBottom: '1px solid #ccc', marginTop: 8, overflow: 'hidden' }}>
              <img src={co.signature_png} alt="Client signature" style={{ display: 'block', height: 52, maxWidth: '100%', objectFit: 'contain' }} />
            </div>
            <div style={{ paddingTop: 6, fontSize: 11.5, color: '#666' }}>{co.signed_by} · {prettyDate(co.signed_date || co.signed_at)}</div>
          </div>
        ) : (
          <div style={{ border: `2px solid ${ORANGE}`, borderRadius: 10, padding: 16, background: '#fffaf6' }}>
            <Kicker>Client approval</Kicker>
            <div style={{ position: 'relative', marginTop: 8, background: 'white', border: '1px dashed #e0c9b8', borderRadius: 8, touchAction: 'none' }}>
              <canvas
                ref={canvasRef}
                onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
                style={{ display: 'block', width: '100%', height: 110, cursor: 'crosshair', borderRadius: 8 }}
              />
              {!hasInk && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4a48d', fontStyle: 'italic', fontSize: 12, pointerEvents: 'none' }}>
                  Sign here with your finger or mouse
                </div>
              )}
              <button type="button" onClick={clear} className="no-print" style={{ position: 'absolute', top: 6, right: 6, background: 'white', border: '1px solid #ddd', fontSize: 10, fontWeight: 700, color: '#6b6b6b', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>
                Clear
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input value={printedName} onChange={(e) => setPrintedName(e.target.value)} placeholder="Your full name" aria-label="Your full name" style={{ ...field, flex: 1, minWidth: 0 }} />
              <input type="date" value={signedDate} max={new Date().toLocaleDateString('en-CA')} onChange={(e) => setSignedDate(e.target.value)} aria-label="Date" style={{ ...field, width: 150 }} />
            </div>
          </div>
        )}
      </div>

      {!isSigned && (
        <div className="no-print">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: '#444', lineHeight: 1.55, marginTop: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2, width: 17, height: 17, accentColor: ORANGE, flexShrink: 0 }} />
            <span>
              I approve Change Order #{number} and authorize Omega Development LLC to perform the work above
              for {money(co.amount)}. I agree that my electronic signature is legally binding.
            </span>
          </label>

          {error && (
            <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={sign}
            disabled={!canSign}
            style={{
              width: '100%', marginTop: 12, padding: 14, borderRadius: 10, border: 'none',
              background: canSign ? ORANGE : '#e5e5e5', color: canSign ? 'white' : '#aaa',
              fontSize: 15, fontWeight: 800, cursor: canSign ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Signing…' : 'Sign & Approve Change Order'}
          </button>
          <p style={{ fontSize: 10.5, color: '#999', textAlign: 'center', marginTop: 8 }}>
            Your name, date, IP address and time of signing are recorded as part of the signature record.
          </p>
        </div>
      )}
    </>
  );
}
