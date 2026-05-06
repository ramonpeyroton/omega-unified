import { useEffect, useState } from 'react';
import { supabase } from '../../shared/lib/supabase';
import SignatureFlow from '../../shared/components/SignatureFlow';

// Public, auth-less page the customer lands on when they receive a
// multi-service bundle email. Shows N proposals (different services),
// each with its own signature block — the client must approve each one
// independently. Approving the kitchen does NOT approve the bathroom.
//
// URL: /estimate-bundle/:bundle_id

const ORANGE = '#E8732A';

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function estimateTotal(est) {
  if (est?.total_amount != null) return Number(est.total_amount) || 0;
  const sections = Array.isArray(est?.sections) ? est.sections : [];
  return sections.reduce((acc, s) =>
    acc + (s.items || []).reduce((a, it) => a + (Number(it.price) || 0), 0), 0);
}

export default function EstimateBundleView() {
  const [loading, setLoading] = useState(true);
  const [estimates, setEstimates] = useState([]);
  const [job, setJob] = useState(null);
  const [company, setCompany] = useState(null);
  const [err, setErr] = useState(null);
  // Track which estimate's sign panel is open.
  const [signingId, setSigningId] = useState(null);

  useEffect(() => {
    const bundleId = window.location.pathname.split('/').pop();
    if (!bundleId) { setErr('Missing bundle id'); setLoading(false); return; }
    (async () => {
      try {
        const [{ data: ests }, { data: c }] = await Promise.all([
          supabase.from('estimates').select('*').eq('bundle_id', bundleId).order('created_at', { ascending: true }),
          supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (!ests || ests.length === 0) throw new Error('Bundle not found');
        const jobId = ests[0].job_id;
        const { data: j } = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
        setEstimates(ests);
        setJob(j || null);
        setCompany(c || null);
      } catch (er) {
        setErr(er?.message || String(er));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function handleSigned(estId) {
    // Refresh the signed estimate from DB so the receipt renders.
    supabase.from('estimates').select('*').eq('id', estId).maybeSingle().then(({ data }) => {
      if (data) setEstimates((prev) => prev.map((e) => e.id === estId ? data : e));
    });
    setSigningId(null);
  }

  if (loading) return <p style={{ padding: 40, fontFamily: 'sans-serif' }}>Loading your proposals…</p>;
  if (err)     return <p style={{ padding: 40, fontFamily: 'sans-serif', color: '#b00' }}>{err}</p>;
  if (!estimates.length) return null;

  const companyName = company?.company_name || 'Omega Development';
  const logoUrl = company?.logo_url || '/logo.png';
  const customerFirst = (job?.client_name || 'there').split(' ')[0];
  const approvedCount = estimates.filter((e) => e.signed_at).length;
  const allApproved = approvedCount === estimates.length;
  const grandTotal = estimates.reduce((s, e) => s + estimateTotal(e), 0);

  return (
    <div style={{ padding: '32px 16px', background: '#f5f5f3', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif', color: '#2C2C2A' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ background: 'white', padding: 32, borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.05)', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <img src={logoUrl} alt={companyName} style={{ height: 56, width: 'auto', objectFit: 'contain' }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.01em' }}>
                OMEGA<span style={{ color: ORANGE }}>DEVELOPMENT</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#6b6b6b', letterSpacing: '.18em', marginTop: 4 }}>RENOVATIONS &amp; CONSTRUCTION</div>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Hi {customerFirst},</h1>
            <p style={{ fontSize: 14, color: '#444', lineHeight: 1.6, margin: '8px 0 0' }}>
              We've prepared <strong>{estimates.length} separate proposals</strong> for your project.
              Please review each one and sign the ones you'd like to move forward with.
              Each proposal is independent — you can approve any combination.
            </p>
          </div>

          {/* Client info */}
          <div style={{ marginTop: 16, background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700, marginBottom: 6 }}>Project</div>
            {[job?.client_name, job?.address, job?.client_phone, job?.client_email].filter(Boolean).map((l, i) => (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>{l}</div>
            ))}
          </div>

          {/* Progress */}
          <div style={{ marginTop: 16, background: allApproved ? '#f0fdf4' : '#fff7ed', border: `1px solid ${allApproved ? '#bbf7d0' : '#fed7aa'}`, borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: allApproved ? '#15803d' : ORANGE }}>
                {allApproved ? '✓ All proposals approved' : `${approvedCount} of ${estimates.length} approved`}
              </div>
              <div style={{ fontSize: 11, color: '#6b6b6b', marginTop: 2 }}>
                Grand total: <strong>{money(grandTotal)}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {estimates.map((e) => (
                <div key={e.id} style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: e.signed_at ? '#16a34a' : '#e5e7eb',
                  color: e.signed_at ? 'white' : '#9ca3af',
                  fontSize: 14, fontWeight: 900,
                }} title={e.bundle_label || `Proposal ${estimates.indexOf(e) + 1}`}>
                  {e.signed_at ? '✓' : estimates.indexOf(e) + 1}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Estimate cards */}
        {estimates.map((est, idx) => {
          const isSigned = !!est.signed_at;
          const isSigningThis = signingId === est.id;
          const sections = Array.isArray(est.sections) ? est.sections : [];
          const total = estimateTotal(est);
          const label = est.bundle_label || `Proposal ${idx + 1}`;

          return (
            <div key={est.id} style={{ background: 'white', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.05)', marginBottom: 20, overflow: 'hidden' }}>

              {/* Card header */}
              <div style={{ background: isSigned ? '#f0fdf4' : '#fff', borderBottom: '1px solid #eee', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: ORANGE, fontWeight: 700 }}>Proposal {idx + 1}</div>
                  <div style={{ fontSize: 19, fontWeight: 900, marginTop: 2 }}>{label}</div>
                  {est.estimate_number && (
                    <div style={{ fontSize: 11, color: '#6b6b6b', marginTop: 2 }}>OM-{est.estimate_number}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700 }}>Total</div>
                  <div style={{ fontSize: 26, fontWeight: 900, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{money(total)}</div>
                  {isSigned && (
                    <div style={{ marginTop: 4, display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 700 }}>
                      ✓ Approved by {est.signed_by}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {est.header_description && (
                <div style={{ padding: '16px 24px', borderBottom: '1px solid #f3f4f6', fontSize: 13, color: '#444', lineHeight: 1.6 }}>
                  {est.header_description}
                </div>
              )}

              {/* Line items */}
              {sections.length > 0 && (
                <div style={{ padding: '16px 24px', borderBottom: '1px solid #f3f4f6' }}>
                  {sections.map((sec, sIdx) => (
                    <div key={sIdx} style={{ marginBottom: sIdx < sections.length - 1 ? 16 : 0 }}>
                      <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#6b6b6b', fontWeight: 700, marginBottom: 8 }}>{sec.title}</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ textAlign: 'left', padding: '4px 0', color: '#6b6b6b', fontWeight: 600, fontSize: 11 }}>Item</th>
                            <th style={{ textAlign: 'right', padding: '4px 0', color: '#6b6b6b', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(sec.items || []).map((item, iIdx) => (
                            <tr key={iIdx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '7px 0', verticalAlign: 'top' }}>
                                <div style={{ fontWeight: 600 }}>{item.description || '—'}</div>
                                {item.scope && <div style={{ color: '#6b6b6b', fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{item.scope}</div>}
                              </td>
                              <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                {money(item.price)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '2px solid #2C2C2A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</span>
                    <span style={{ fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{money(total)}</span>
                  </div>
                </div>
              )}

              {/* Customer message */}
              {est.customer_message && (
                <div style={{ padding: '14px 24px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#555', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {est.customer_message}
                </div>
              )}

              {/* Sign section */}
              <div style={{ padding: '20px 24px' }}>
                {isSigned ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16, textAlign: 'center' }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>✓</div>
                    <div style={{ fontWeight: 700, color: '#15803d', fontSize: 14 }}>Approved by {est.signed_by}</div>
                    <div style={{ fontSize: 11, color: '#6b6b6b', marginTop: 4 }}>
                      {est.signed_date
                        ? new Date(est.signed_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                        : new Date(est.signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                ) : isSigningThis ? (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: ORANGE }}>
                      Signing: {label}
                    </div>
                    <SignatureFlow
                      estimateId={est.id}
                      customerName={job?.client_name}
                      companyPhone={company?.phone}
                      disclaimers={est.disclaimers || ''}
                      signButtonLabel={`Sign & Approve — ${label}`}
                      onSigned={() => handleSigned(est.id)}
                    />
                    <button
                      onClick={() => setSigningId(null)}
                      style={{ marginTop: 12, fontSize: 12, color: '#6b6b6b', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12, color: '#6b6b6b', lineHeight: 1.5 }}>
                      Ready to approve this proposal? Click to sign electronically.
                    </div>
                    <button
                      onClick={() => setSigningId(est.id)}
                      style={{
                        padding: '12px 24px', background: ORANGE, color: 'white', border: 'none',
                        borderRadius: 8, fontWeight: 900, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
                        letterSpacing: '.02em',
                      }}
                    >
                      Sign &amp; Approve
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {allApproved && (
          <div style={{ background: '#15803d', color: 'white', borderRadius: 8, padding: '20px 24px', textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>🎉 All proposals approved!</div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>
              Thank you, {customerFirst}. We'll send the final contracts via DocuSign shortly.<br />
              Questions? Call {company?.phone || 'us'}.
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 8, paddingBottom: 32 }}>
          {companyName} · Questions? Call {company?.phone || ''}
        </div>
      </div>
    </div>
  );
}
