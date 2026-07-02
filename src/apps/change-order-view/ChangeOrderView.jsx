import { useEffect, useState } from 'react';
import { supabase } from '../../shared/lib/supabase';
import { DEFAULT_ESTIMATE_DISCLAIMERS } from '../../shared/data/estimateDisclaimers';
import SignatureFlow from '../../shared/components/SignatureFlow';

// Public, auth-less page that renders a single Change Order and lets the
// client sign it online — mirrors /estimate-view but for change_orders.
// URL: /change-order-view/:id

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ChangeOrderView() {
  const [loading, setLoading] = useState(true);
  const [co, setCo] = useState(null);
  const [job, setJob] = useState(null);
  const [company, setCompany] = useState(null);
  const [err, setErr] = useState(null);

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

  const companyLines = [company?.address, company?.phone, company?.email].filter(Boolean);
  const customerLines = [job?.client_name, job?.address, job?.client_phone, job?.client_email].filter(Boolean);
  const disclaimers = (co.disclaimers && co.disclaimers.trim()) ? co.disclaimers : DEFAULT_ESTIMATE_DISCLAIMERS;

  const existingSignature = co.signature_png ? {
    png:      co.signature_png,
    initials: co.initials_png || null,
    name:     co.signed_by,
    at:       co.signed_at,
    date:     co.signed_date,
  } : null;

  return (
    <div style={{ padding: '32px 16px', background: '#f5f5f3', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif', color: '#2C2C2A' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: 12, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, borderBottom: '2px solid #f0f0ee', paddingBottom: 16, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#E8590C', fontWeight: 800 }}>Change Order</div>
              <h1 style={{ fontSize: 24, margin: '4px 0 0', fontWeight: 900 }}>
                {co.co_number ? `#CO-${co.co_number}` : 'Change Order'}
              </h1>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#6b6b6b' }}>
              <div style={{ fontWeight: 800, color: '#2C2C2A', fontSize: 14 }}>{company?.company_name || 'Omega Development'}</div>
              {companyLines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>

          {/* Client */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9a9a9a', fontWeight: 700, marginBottom: 4 }}>Prepared for</div>
            {customerLines.map((l, i) => <div key={i} style={{ fontSize: 14 }}>{l}</div>)}
          </div>

          {/* Details */}
          <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0ee' }}>
              <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a9a9a', fontWeight: 700, marginBottom: 4 }}>Description of change</div>
              <div style={{ fontSize: 15, whiteSpace: 'pre-wrap' }}>{co.description || '—'}</div>
            </div>
            {co.reason && (
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0ee' }}>
                <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9a9a9a', fontWeight: 700, marginBottom: 4 }}>Reason</div>
                <div style={{ fontSize: 14 }}>{co.reason}</div>
              </div>
            )}
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#faf7f4' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6b6b6b', textTransform: 'uppercase', letterSpacing: '.06em' }}>Additional amount</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{money(co.amount)}</div>
            </div>
          </div>

          {/* Signature */}
          <SignatureFlow
            changeOrderId={co.id}
            customerName={job?.client_name || ''}
            companyPhone={company?.phone}
            disclaimers={disclaimers}
            existingSignature={existingSignature}
            signButtonLabel="Sign & Approve Change Order"
            onSigned={(data, signed) => setCo((prev) => ({
              ...prev,
              status: 'signed',
              signature_png: signed.png,
              signed_by: signed.name,
              signed_at: signed.at,
              signed_date: signed.date,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
