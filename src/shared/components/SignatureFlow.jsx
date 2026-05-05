import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────
// SignatureFlow — three-step approval block:
//   1. Initials canvas + "I have read this estimate" line
//   2. Disclaimers (rendered with light markdown) + "I read & acknowledge"
//      checkbox required to unlock the signature step
//   3. Full signature canvas + printed name + date + ESIGN consent
//
// Shared between the single-option `/estimate-view/:id` page and the
// multi-option `/estimate-options/:groupId` picker. Each caller passes
// the estimate_id (which one of the N options is being signed), the
// disclaimers text snapshot (so the seller can edit them per-estimate),
// the customer's name (for prefill), and an `onSigned` callback that
// receives the API response. When the row already has a signature_png,
// pass `existingSignature` and the block renders the locked receipt.
// ─────────────────────────────────────────────────────────────────────
export default function SignatureFlow({
  estimateId,
  customerName,
  companyPhone,
  disclaimers,
  existingSignature = null,
  signButtonLabel = 'Sign & Approve Estimate',
  onSigned,
}) {
  // Full signature canvas (bottom step)
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const [hasInk, setHasInk] = useState(false);

  // Initials canvas (top step — rubrica)
  const initialsRef = useRef(null);
  const initialsDrawingRef = useRef(false);
  const initialsLastRef = useRef({ x: 0, y: 0 });
  const [initialsHasInk, setInitialsHasInk] = useState(false);

  const [printedName, setPrintedName] = useState(customerName || '');
  const [signedDate, setSignedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [disclaimersAcknowledged, setDisclaimersAcknowledged] = useState(false);
  const [consent, setConsent] = useState(false);

  const [signed, setSigned] = useState(
    existingSignature
      ? {
          png:      existingSignature.png,
          initials: existingSignature.initials || null,
          name:     existingSignature.name,
          at:       existingSignature.at,
          date:     existingSignature.date,
        }
      : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset local form state whenever the parent swaps which estimate is
  // being signed (multi-option page: customer flips between Basic /
  // Standard / Premium). Without this, a half-typed name on Option A
  // bleeds into Option B.
  useEffect(() => {
    setSigned(
      existingSignature
        ? {
            png:      existingSignature.png,
            initials: existingSignature.initials || null,
            name:     existingSignature.name,
            at:       existingSignature.at,
            date:     existingSignature.date,
          }
        : null
    );
  }, [estimateId, existingSignature]);

  useEffect(() => {
    if (signed) return;
    const fitCanvas = (canvas, lineWidth) => {
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = '#111';
    };
    const fitAll = () => {
      fitCanvas(canvasRef.current, 2.2);
      fitCanvas(initialsRef.current, 1.8);
    };
    fitAll();
    window.addEventListener('resize', fitAll);
    return () => window.removeEventListener('resize', fitAll);
  }, [signed]);

  function pointerPos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const p = 'touches' in e ? e.touches[0] : e;
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  // Full signature canvas
  function onDown(e) {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pointerPos(canvasRef.current, e);
  }
  function onMove(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const { x, y } = pointerPos(canvasRef.current, e);
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
    const c = canvasRef.current; const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  // Initials canvas
  function onInitialsDown(e) {
    e.preventDefault();
    initialsDrawingRef.current = true;
    initialsLastRef.current = pointerPos(initialsRef.current, e);
  }
  function onInitialsMove(e) {
    if (!initialsDrawingRef.current) return;
    e.preventDefault();
    const { x, y } = pointerPos(initialsRef.current, e);
    const ctx = initialsRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(initialsLastRef.current.x, initialsLastRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    initialsLastRef.current = { x, y };
    if (!initialsHasInk) setInitialsHasInk(true);
  }
  function onInitialsUp() { initialsDrawingRef.current = false; }
  function clearInitials() {
    const c = initialsRef.current; const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setInitialsHasInk(false);
  }

  async function sign() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const png = canvasRef.current.toDataURL('image/png');
      const initialsPng = initialsRef.current ? initialsRef.current.toDataURL('image/png') : null;
      const name = printedName.trim();

      const r = await fetch('/api/sign-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estimate_id:              estimateId,
          signature_png:            png,
          initials_png:             initialsPng,
          signed_by:                name,
          signed_date:              signedDate,
          disclaimers:              disclaimers,
          disclaimers_acknowledged: disclaimersAcknowledged,
          consent:                  true,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (HTTP ${r.status})`);
      }
      const newSigned = {
        png, name,
        initials: initialsPng,
        at:   data.signed_at   || new Date().toISOString(),
        date: data.signed_date || signedDate,
      };
      setSigned(newSigned);
      onSigned?.(data, newSigned);
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSign =
    initialsHasInk &&
    disclaimersAcknowledged &&
    hasInk &&
    printedName.trim().length >= 2 &&
    !!signedDate &&
    consent &&
    !submitting;

  // ─── Locked receipt (already signed) ───────────────────────────────
  if (signed) {
    const datePretty = (() => {
      if (signed.date) {
        const [y, m, d] = signed.date.split('-').map(Number);
        const local = new Date(y, m - 1, d);
        if (!isNaN(local.getTime())) {
          return local.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        }
      }
      const at = signed.at instanceof Date ? signed.at : new Date(signed.at);
      return isNaN(at.getTime()) ? String(signed.at) : at.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    })();
    return (
      <div style={{ marginTop: 32, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#16a34a', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✓</div>
          <div>
            <div style={{ fontWeight: 800, color: '#15803d', fontSize: 16 }}>Estimate Approved</div>
            <div style={{ fontSize: 12, color: '#166534' }}>
              Signed by <strong>{signed.name}</strong> on <strong>{datePretty}</strong>
            </div>
          </div>
        </div>
        {signed.initials && (
          <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 6, padding: 10, marginTop: 8 }}>
            <Kicker color="#15803d">Initials</Kicker>
            <img src={signed.initials} alt="Initials" style={{ maxWidth: 160, display: 'block', marginTop: 6 }} />
          </div>
        )}
        <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 6, padding: 10, marginTop: 8 }}>
          <Kicker color="#15803d">Signature</Kicker>
          <img src={signed.png} alt="Signature" style={{ maxWidth: 320, display: 'block', marginTop: 6 }} />
        </div>

        {/* Permanently visible (collapsible) record of the terms the
            customer accepted. Before this section existed the disclaimer
            text disappeared as soon as the 3-step flow collapsed into
            this receipt — leaving Ramon to fish in the database to
            confirm WHAT was acknowledged. Now it's right there, one
            click away from both the customer and the team. */}
        {disclaimers && (
          <details style={{
            background: 'white', border: '1px solid #bbf7d0', borderRadius: 6,
            padding: '8px 12px', marginTop: 8, fontSize: 12,
          }}>
            <summary style={{
              cursor: 'pointer', fontWeight: 700, color: '#15803d',
              outline: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>📜</span>
              View signed terms
              <span style={{ fontSize: 11, fontWeight: 600, color: '#166534' }}>
                ({(disclaimers.match(/\*\*\d+\./g) || []).length || '12'} sections — acknowledged on signing)
              </span>
            </summary>
            <div style={{
              maxHeight: 360, overflowY: 'auto',
              marginTop: 10, paddingTop: 10, borderTop: '1px solid #bbf7d0',
              fontSize: 12, lineHeight: 1.55, color: '#1f2937',
            }}>
              {renderDisclaimers(disclaimers)}
            </div>
          </details>
        )}

        <p style={{ fontSize: 11, color: '#166534', marginTop: 10 }}>
          Omega will send the final contract shortly with a payment schedule and deposit request.
          {companyPhone ? ` Questions: ${companyPhone}.` : ''}
        </p>
      </div>
    );
  }

  // ─── Three-step approval flow ───────────────────────────────────────
  return (
    <div className="no-print" style={{ marginTop: 32 }}>

      {/* Step 1 — Initials */}
      <div style={{ background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 20, marginBottom: 16 }}>
        <Kicker>Step 1 — Initials</Kicker>
        <h3 style={{ fontSize: 17, fontWeight: 900, margin: '6px 0 4px', color: '#2C2C2A' }}>
          Confirm you've read this estimate
        </h3>
        <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginBottom: 12 }}>
          Write your initials in the box below to acknowledge you reviewed
          the scope, items, and total.
        </p>
        <div style={{ position: 'relative', background: 'white', border: '1px solid #ccc', borderRadius: 6, touchAction: 'none', maxWidth: 280 }}>
          <canvas
            ref={initialsRef}
            onMouseDown={onInitialsDown}
            onMouseMove={onInitialsMove}
            onMouseUp={onInitialsUp}
            onMouseLeave={onInitialsUp}
            onTouchStart={onInitialsDown}
            onTouchMove={onInitialsMove}
            onTouchEnd={onInitialsUp}
            style={{ display: 'block', width: '100%', height: 80, cursor: 'crosshair', borderRadius: 6 }}
          />
          {!initialsHasInk && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#c8c8c8', fontSize: 12, pointerEvents: 'none', fontStyle: 'italic' }}>
              Initials
            </div>
          )}
          <button
            type="button"
            onClick={clearInitials}
            style={{ position: 'absolute', top: 4, right: 4, background: 'white', border: '1px solid #ddd', fontSize: 10, fontWeight: 700, color: '#6b6b6b', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Step 2 — Disclaimers */}
      <div style={{
        background: disclaimersAcknowledged ? '#f0fdf4' : '#fafafa',
        border: `1px solid ${disclaimersAcknowledged ? '#bbf7d0' : '#eee'}`,
        borderRadius: 8, padding: 20, marginBottom: 16,
        opacity: initialsHasInk ? 1 : 0.55,
        pointerEvents: initialsHasInk ? 'auto' : 'none',
        transition: 'opacity 200ms',
      }}>
        <Kicker>Step 2 — Project Disclaimers</Kicker>
        <h3 style={{ fontSize: 17, fontWeight: 900, margin: '6px 0 4px', color: '#2C2C2A' }}>
          Please read carefully before signing
        </h3>
        <div style={{
          background: 'white', border: '1px solid #e5e5e5', borderRadius: 6,
          padding: '14px 16px', marginTop: 10, maxHeight: 360, overflowY: 'auto',
        }}>
          {renderDisclaimers(disclaimers)}
        </div>
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          marginTop: 14, fontSize: 13, fontWeight: 700, color: '#2C2C2A', lineHeight: 1.5,
          cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={disclaimersAcknowledged}
            onChange={(e) => setDisclaimersAcknowledged(e.target.checked)}
            style={{ marginTop: 2, width: 18, height: 18, accentColor: '#E8732A' }}
          />
          <span>I have read and acknowledge all disclaimers above.</span>
        </label>
      </div>

      {/* Step 3 — Sign */}
      <div style={{
        background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 20,
        opacity: disclaimersAcknowledged ? 1 : 0.55,
        pointerEvents: disclaimersAcknowledged ? 'auto' : 'none',
        transition: 'opacity 200ms',
      }}>
        <Kicker>Step 3 — Sign</Kicker>
        <h3 style={{ fontSize: 17, fontWeight: 900, margin: '6px 0 4px', color: '#2C2C2A' }}>
          Approve this estimate
        </h3>
        <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginBottom: 16 }}>
          Once signed, Omega will send the final contract via DocuSign to your email.
        </p>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', marginBottom: 6 }}>
          Draw your full signature
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

        <div style={{ display: 'grid', gap: 12, marginTop: 14, gridTemplateColumns: 'minmax(0, 1fr) 160px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', marginBottom: 6 }}>
              Print your full name
            </label>
            <input
              type="text"
              value={printedName}
              onChange={(e) => setPrintedName(e.target.value)}
              placeholder="e.g. Brian Salley"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#6b6b6b', marginBottom: 6 }}>
              Date
            </label>
            <input
              type="date"
              value={signedDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSignedDate(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>

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
            marginTop: 16, width: '100%', padding: '14px 20px',
            background: canSign ? '#E8732A' : '#e5e5e5',
            color: canSign ? 'white' : '#aaa',
            border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 900, letterSpacing: '.02em',
            cursor: canSign ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? 'Signing…' : signButtonLabel}
        </button>

        <p style={{ fontSize: 10, color: '#888', marginTop: 10, textAlign: 'center' }}>
          By signing, you acknowledge the estimate and scope above. The final binding contract
          will be sent separately via DocuSign. Your IP address and timestamp are recorded as
          part of the signature audit trail.
        </p>
      </div>
    </div>
  );
}

function Kicker({ children, color = '#6b6b6b' }) {
  return <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color, fontWeight: 700 }}>{children}</div>;
}

// Tiny markdown-ish renderer used by the disclaimers block. Handles
// **bold**, ***bold-italic***, paragraph breaks (blank lines), and
// horizontal rules (---). Anything else is passed through as plain text.
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
  const parts = [];
  let remaining = line;
  let key = 0;
  while (remaining.length > 0) {
    const boldItalic = remaining.match(/^\*\*\*([^*]+?)\*\*\*/);
    const bold       = !boldItalic && remaining.match(/^\*\*([^*]+?)\*\*/);
    if (boldItalic) {
      parts.push(<strong key={key++} style={{ fontStyle: 'italic', color: '#2C2C2A' }}>{boldItalic[1]}</strong>);
      remaining = remaining.slice(boldItalic[0].length);
      continue;
    }
    if (bold) {
      parts.push(<strong key={key++} style={{ color: '#2C2C2A' }}>{bold[1]}</strong>);
      remaining = remaining.slice(bold[0].length);
      continue;
    }
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
