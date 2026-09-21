import { useEffect, useMemo, useState, useRef } from 'react';
import html2pdf from 'html2pdf.js';
import { supabase } from '../../shared/lib/supabase';
import { DEFAULT_ESTIMATE_DISCLAIMERS } from '../../shared/data/estimateDisclaimers';
import SignatureFlow from '../../shared/components/SignatureFlow';

// Public, auth-less page the customer lands on when they receive a
// multi-option estimate email. Shows N proposals side-by-side, lets
// them expand the details of each, and presents ONE signature block
// where they pick the option they're going with.
//
// URL: /estimate-options/:group_id
//
// Signing flow reuses the same /api/sign-estimate endpoint as the
// single-estimate page — the API auto-rejects siblings once one is
// signed, so the picker matches whatever the customer chose.

const ORANGE = '#E8732A';

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtEstimateNumber(n) {
  if (n == null || n === '') return '—';
  return `OM-${n}`;
}

function total(est) {
  const sections = Array.isArray(est?.sections) ? est.sections : [];
  if (est?.total_amount != null) return Number(est.total_amount) || 0;
  return sections.reduce((acc, s) =>
    acc + (s.items || []).reduce((a, it) => a + (Number(it.price) || 0), 0), 0);
}

export default function EstimateOptionsView() {
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState([]);          // all estimates in the group, ordered
  const [job, setJob] = useState(null);
  const [company, setCompany] = useState(null);
  const [err, setErr] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const contentRef = useRef(null);

  // UI: which option is expanded (showing the full breakdown) and
  // which one the customer picked (radio).
  const [expandedId, setExpandedId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const groupId = window.location.pathname.split('/').pop();
    if (!groupId) { setErr('Missing group id'); setLoading(false); return; }
    (async () => {
      try {
        const [{ data: ests }, { data: c }] = await Promise.all([
          supabase.from('estimates').select('*').eq('group_id', groupId).order('option_order', { ascending: true }),
          supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (!ests || ests.length === 0) throw new Error('Estimate group not found');

        // The estimate all rows share a job — fetch once.
        const jobId = ests[0].job_id;
        const { data: j } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();

        setOptions(ests);
        setJob(j || null);
        setCompany(c || null);

        // If any option is already signed, surface that — the page goes
        // into a "thank you" state showing the chosen option.
        const alreadySigned = ests.find((e) => e.signed_at);
        if (alreadySigned) {
          setSelectedId(alreadySigned.id);
        } else {
          // Default-select the middle option (common "recommended" slot).
          const mid = Math.floor(ests.length / 2);
          setSelectedId(ests[mid]?.id || ests[0].id);
        }
      } catch (er) {
        setErr(er?.message || String(er));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading your options…</p>;
  if (err) return <p style={{ padding: 40, fontFamily: 'sans-serif', color: '#b00' }}>{err}</p>;
  if (!options.length) return null;

  const customerLines = [job?.client_name, job?.address, job?.client_phone, job?.client_email].filter(Boolean);
  const signedOption = options.find((e) => e.signed_at);

  const handleDownloadPDF = async () => {
    if (!contentRef.current || downloading) return;
    setDownloading(true);
    try {
      const clientName = (job?.client_name || 'Estimate').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
      const filename = `Omega_Estimate_Options_${clientName}.pdf`;

      await html2pdf()
        .set({
          margin: [8, 4, 8, 4],
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            ignoreElements: (el) => el.classList?.contains('no-print'),
          },
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
  };

  return (
    <div style={{ padding: '32px 16px', background: '#f5f5f3', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif', color: '#2C2C2A' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>

        <div className="no-print" style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={() => window.print()}
            style={{ padding: '10px 16px', borderRadius: 8, border: `2px solid ${ORANGE}`, background: 'white', color: ORANGE, fontWeight: 700, cursor: 'pointer' }}
          >
            🖨️ Print
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={downloading}
            style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: downloading ? '#ccc' : ORANGE, color: 'white', fontWeight: 700, cursor: downloading ? 'wait' : 'pointer', opacity: downloading ? 0.7 : 1 }}
          >
            {downloading ? '⏳ Generating…' : '📄 Download PDF'}
          </button>
        </div>

        <div ref={contentRef} style={{ background: 'white', padding: 32, borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>

          {/* Header — same visual language as the single EstimateView */}
          <Header company={company} />

          {/* Greeting + customer block */}
          <div style={{ marginTop: 28 }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.01em' }}>
              Hi {(job?.client_name || 'there').split(' ')[0]},
            </h1>
            <p style={{ fontSize: 14, color: '#444', lineHeight: 1.55, margin: '8px 0 0' }}>
              We've prepared <strong>{options.length} options</strong> for your project.
              Review each one below, expand the details, and pick the scope you'd like
              to move forward with. Once you sign, the other alternatives are withdrawn
              and we'll send the final contract via DocuSign.
            </p>
          </div>

          <div style={{ marginTop: 20, background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>Project</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 8 }}>
              {customerLines.length ? customerLines.map((l, i) => <div key={i}>{l}</div>) : '—'}
            </div>
          </div>

          {/* Side-by-side option cards */}
          <div style={{ marginTop: 24, display: 'grid', gap: 14, gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))` }}>
            {options.map((est, i) => (
              <OptionCard
                key={est.id}
                index={i}
                estimate={est}
                isSelected={selectedId === est.id}
                isExpanded={expandedId === est.id}
                isSigned={!!est.signed_at}
                isLockedOut={!!signedOption && signedOption.id !== est.id}
                disabled={!!signedOption}
                onSelect={() => !signedOption && setSelectedId(est.id)}
                onToggleExpand={() => setExpandedId(expandedId === est.id ? null : est.id)}
              />
            ))}
          </div>

          {/* Signature block — reads the chosen option live */}
          {signedOption ? (
            <SignedReceipt option={signedOption} companyPhone={company?.phone} />
          ) : (
            <MultiOptionSignSection
              options={options}
              selectedId={selectedId}
              onSelectId={setSelectedId}
              customerName={job?.client_name}
              companyPhone={company?.phone}
            />
          )}

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

// ─── Header ──────────────────────────────────────────────────────────
function Header({ company }) {
  const companyLines = [company?.address, company?.phone, company?.email].filter(Boolean);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          <td style={{ verticalAlign: 'top' }}>
            {company?.logo_url ? (
              <img src={company.logo_url} alt={company?.company_name || 'Omega Development'} style={{ height: 72, width: 'auto', display: 'block' }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img src="/logo.png" alt="Omega Development" style={{ height: 64, width: 64, display: 'block' }} />
                <div style={{ lineHeight: 1 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#2C2C2A', letterSpacing: '-0.02em' }}>
                    OMEGA<span style={{ color: ORANGE }}>DEVELOPMENT</span>
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
            <div style={{ fontSize: 28, fontWeight: 900 }}>Proposal</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div><strong style={{ color: '#6b6b6b', letterSpacing: '.08em', textTransform: 'uppercase' }}>Date</strong> &nbsp; {new Date().toLocaleDateString()}</div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Option card ─────────────────────────────────────────────────────
function OptionCard({ index, estimate, isSelected, isExpanded, isSigned, isLockedOut, disabled, onSelect, onToggleExpand }) {
  const label = estimate.option_label || `Option ${index + 1}`;
  const estTotal = total(estimate);
  const sections = Array.isArray(estimate.sections) ? estimate.sections : [];
  const borderColor = isSelected ? ORANGE : isLockedOut ? '#e5e5e5' : '#e5e5e5';
  const bg = isSelected ? '#fff8f1' : isLockedOut ? '#fafafa' : 'white';
  const opacity = isLockedOut ? 0.55 : 1;

  return (
    <div
      onClick={onSelect}
      style={{
        border: `2px solid ${borderColor}`,
        background: bg,
        borderRadius: 10,
        padding: 18,
        cursor: disabled ? 'default' : 'pointer',
        position: 'relative',
        transition: 'border-color 120ms, background 120ms',
        opacity,
      }}
    >
      {/* Selection badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            width: 18, height: 18, borderRadius: '50%',
            border: `2px solid ${isSelected ? ORANGE : '#cccccc'}`,
            background: isSelected ? ORANGE : 'white',
            flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {isSelected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'white' }} />}
        </div>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>
          Option {index + 1} · {fmtEstimateNumber(estimate.estimate_number)}
        </div>
        {isSigned && (
          <span style={{ marginLeft: 'auto', background: '#16a34a', color: 'white', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, letterSpacing: '.05em' }}>
            SIGNED
          </span>
        )}
        {isLockedOut && (
          <span style={{ marginLeft: 'auto', background: '#9ca3af', color: 'white', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, letterSpacing: '.05em' }}>
            NOT SELECTED
          </span>
        )}
      </div>

      <div style={{ fontSize: 18, fontWeight: 900, color: '#2C2C2A', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color: '#2C2C2A', marginBottom: 12, fontVariantNumeric: 'tabular-nums' }}>
        {money(estTotal)}
      </div>

      {estimate.header_description && (
        <p style={{ fontSize: 12, color: '#555', lineHeight: 1.55, marginBottom: 10, whiteSpace: 'pre-line' }}>
          {estimate.header_description}
        </p>
      )}

      {/* Quick-glance list of section titles */}
      {!isExpanded && sections.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px', fontSize: 12, color: '#444', lineHeight: 1.8 }}>
          {sections.map((s, i) => (
            <li key={i}>
              <span style={{ color: ORANGE, marginRight: 6 }}>▸</span>
              {s.title || `Section ${i + 1}`}
              <span style={{ color: '#999' }}>
                {` · ${(s.items || []).length} item${(s.items || []).length === 1 ? '' : 's'}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Full breakdown when expanded */}
      {isExpanded && sections.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {sections.map((s, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <div style={{ background: '#2C2C2A', color: 'white', padding: '6px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
                {s.title || `Section ${i + 1}`}
              </div>
              {(s.items || []).map((it, j) => (
                <div key={j} style={{ padding: 8, borderBottom: '1px solid #f1f1f1', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 700, color: '#2C2C2A' }}>{it.description}</div>
                    <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#2C2C2A', whiteSpace: 'nowrap' }}>{money(it.price)}</div>
                  </div>
                  {it.scope && <div style={{ color: '#555', fontSize: 11, whiteSpace: 'pre-line', marginTop: 3, lineHeight: 1.5 }}>{it.scope}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
        className="no-print"
        style={{
          width: '100%', marginTop: 4, padding: '8px 12px',
          background: 'white', border: `1px solid ${ORANGE}`, color: ORANGE,
          borderRadius: 6, fontSize: 12, fontWeight: 800, letterSpacing: '.04em',
          cursor: 'pointer',
        }}
      >
        {isExpanded ? '▲ Hide details' : '▼ View full details'}
      </button>
    </div>
  );
}

// ─── Signed receipt (someone already signed this group) ──────────────
function SignedReceipt({ option, companyPhone }) {
  const label = option.option_label || 'the chosen option';
  // Prefer the date the customer typed (signed_date); fall back to the
  // server timestamp for rows signed before migration 018.
  const signedLabel = (() => {
    if (option.signed_date) {
      const [y, m, d] = option.signed_date.split('-').map(Number);
      const local = new Date(y, m - 1, d);
      if (!isNaN(local.getTime())) {
        return local.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      }
    }
    const at = option.signed_at ? new Date(option.signed_at) : null;
    return at && !isNaN(at.getTime())
      ? at.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : option.signed_at;
  })();
  return (
    <div style={{ marginTop: 32, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#16a34a', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>✓</div>
        <div>
          <div style={{ fontWeight: 800, color: '#15803d', fontSize: 16 }}>Proposal Approved — {label}</div>
          <div style={{ fontSize: 12, color: '#166534' }}>
            Signed by <strong>{option.signed_by}</strong> on {signedLabel}
          </div>
        </div>
      </div>
      {option.signature_png && (
        <div style={{ background: 'white', border: '1px solid #bbf7d0', borderRadius: 6, padding: 10, marginTop: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#15803d', fontWeight: 700, marginBottom: 6 }}>Signature</div>
          <img src={option.signature_png} alt="Signature" style={{ maxWidth: 320, display: 'block' }} />
        </div>
      )}
      <p style={{ fontSize: 11, color: '#166534', marginTop: 10 }}>
        The other alternatives have been withdrawn. Omega will send the final contract shortly with a payment schedule and deposit request.
        {companyPhone ? ` Questions: ${companyPhone}.` : ''}
      </p>
    </div>
  );
}


// ─── Multi-option signing section ──────────────────────────────────
// Wraps the radio picker (which alternative is the customer signing?)
// around the shared SignatureFlow component. Reloads the page on a
// successful signature so the locked SignedReceipt becomes the new
// rendering — saves us a redundant client-side state machine.
function MultiOptionSignSection({ options, selectedId, onSelectId, customerName, companyPhone }) {
  const selectedOption = useMemo(
    () => options.find((o) => o.id === selectedId) || options[0],
    [options, selectedId]
  );
  const selectedLabel = selectedOption?.option_label || 'Option';
  const selectedTotal = selectedOption ? total(selectedOption) : 0;

  return (
    <>
      {/* Picker — radio list synced with the cards above */}
      <div className="no-print" style={{ marginTop: 32, background: '#fafafa', border: '1px solid #eee', borderRadius: 8, padding: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>
          Choose &amp; Sign
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 900, margin: '6px 0 4px', color: '#2C2C2A' }}>
          Which option are you going with?
        </h3>
        <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginBottom: 16 }}>
          Pick one below, then complete the three steps to approve. Once you sign,
          the other alternatives are automatically withdrawn.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((est, i) => {
            const isSelected = selectedOption?.id === est.id;
            return (
              <label
                key={est.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  background: isSelected ? '#fff8f1' : 'white',
                  border: `2px solid ${isSelected ? ORANGE : '#e5e5e5'}`,
                  borderRadius: 8, cursor: 'pointer',
                  transition: 'border-color 100ms',
                }}
              >
                <input
                  type="radio"
                  name="chosen-option"
                  checked={isSelected}
                  onChange={() => onSelectId?.(est.id)}
                  style={{ accentColor: ORANGE }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#2C2C2A', flex: 1 }}>
                  Option {i + 1} — {est.option_label || '—'}
                </span>
                <span style={{ fontSize: 14, fontWeight: 900, color: '#2C2C2A', fontVariantNumeric: 'tabular-nums' }}>
                  {money(total(est))}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Three-step approval (initials + disclaimers + signature) */}
      {selectedOption && (
        <SignatureFlow
          estimateId={selectedOption.id}
          customerName={customerName}
          companyPhone={companyPhone}
          disclaimers={selectedOption.disclaimers || DEFAULT_ESTIMATE_DISCLAIMERS}
          signButtonLabel={`Sign & Approve ${selectedLabel} (${money(selectedTotal)})`}
          onSigned={() => {
            // Reload so the page swaps into the locked SignedReceipt
            // state with up-to-date data from Supabase.
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
