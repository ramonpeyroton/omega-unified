import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Check, Trash2, Plus, Send, FileText, DollarSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createEnvelope, getEnvelopeStatus } from '../../../shared/lib/docusign';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';

const STEPS = [
  { id: 1, label: 'Review Estimate' },
  { id: 2, label: 'Payment Plan' },
  { id: 3, label: 'Generate Contract' },
  { id: 4, label: 'Invoice & Deposit' },
];

function Stepper({ current }) {
  return (
    <div className="flex items-center justify-between gap-2 p-4 bg-white rounded-xl border border-gray-200">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex-1 flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
            current > s.id ? 'bg-omega-success text-white border-omega-success' :
            current === s.id ? 'bg-omega-orange text-white border-omega-orange' :
            'bg-white text-omega-stone border-gray-300'
          }`}>
            {current > s.id ? <Check className="w-4 h-4" /> : s.id}
          </div>
          <p className={`text-xs font-semibold whitespace-nowrap ${current === s.id ? 'text-omega-charcoal' : 'text-omega-stone'}`}>{s.label}</p>
          {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${current > s.id ? 'bg-omega-success' : 'bg-gray-200'}`} />}
        </div>
      ))}
    </div>
  );
}

export default function EstimateFlow({ job, user, onBack }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [estimate, setEstimate] = useState(null);
  const [contract, setContract] = useState(null);
  const [paymentPlan, setPaymentPlan] = useState([]);

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [job?.id]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: est } = await supabase.from('estimates').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { data: ctr } = await supabase.from('contracts').select('*').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      setEstimate(est || null);
      setContract(ctr || null);
      if (est?.payment_plan) setPaymentPlan(est.payment_plan);
      else if (ctr?.payment_plan) setPaymentPlan(ctr.payment_plan);
      // Pick the starting step based on existing state
      if (ctr?.signed_at) setStep(4);
      else if (ctr) setStep(3);
      else if (est?.approved_at) setStep(2);
      else setStep(1);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load estimate data' });
    } finally {
      setLoading(false);
    }
  }

  async function approveEstimate() {
    if (!estimate) { setToast({ type: 'error', message: 'No estimate to approve' }); return; }
    setSaving(true);
    const { data, error } = await supabase
      .from('estimates')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: user?.name || null })
      .eq('id', estimate.id)
      .select().single();
    setSaving(false);
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setEstimate(data);
    setToast({ type: 'success', message: 'Estimate approved' });
    setStep(2);
  }

  async function requestChanges() {
    if (!estimate) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('estimates')
      .update({ status: 'rejected' })
      .eq('id', estimate.id)
      .select().single();
    setSaving(false);
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setEstimate(data);
    setToast({ type: 'info', message: 'Marked for changes' });
  }

  // Payment plan helpers
  const planTotalPct = useMemo(
    () => paymentPlan.reduce((sum, p) => sum + (Number(p.percent) || 0), 0),
    [paymentPlan]
  );

  function addInstallment() {
    setPaymentPlan((prev) => [...prev, { label: `Installment ${prev.length + 1}`, percent: 0, amount: 0, due_date: '' }]);
  }

  function updateInstallment(i, patch) {
    setPaymentPlan((prev) => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  }

  function removeInstallment(i) {
    setPaymentPlan((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function savePaymentPlanAndContinue() {
    if (Math.round(planTotalPct) !== 100) {
      setToast({ type: 'warning', message: `Payment plan must total 100% (currently ${planTotalPct}%)` });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('estimates')
      .update({ payment_plan: paymentPlan })
      .eq('id', estimate.id)
      .select().single();
    setSaving(false);
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setEstimate(data);
    setStep(3);
  }

  async function generateAndSendContract() {
    setSaving(true);
    try {
      // Save contract row first
      const { data: created, error: insErr } = await supabase
        .from('contracts')
        .insert([{
          job_id: job.id,
          estimate_id: estimate?.id || null,
          status: 'draft',
          payment_plan: paymentPlan,
          total_amount: estimate?.total_amount || null,
          deposit_amount: paymentPlan[0] && estimate?.total_amount
            ? Math.round((Number(paymentPlan[0].percent) / 100) * Number(estimate.total_amount) * 100) / 100
            : null,
          created_by: user?.id || null,
        }])
        .select().single();
      if (insErr) throw insErr;

      // Then call DocuSign
      const { envelopeId } = await createEnvelope({
        contractId: created.id,
        job,
        estimate,
        paymentPlan,
      });

      const { data: updated, error: updErr } = await supabase
        .from('contracts')
        .update({
          docusign_envelope_id: envelopeId,
          docusign_status: 'sent',
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', created.id)
        .select().single();
      if (updErr) throw updErr;

      setContract(updated);
      setToast({ type: 'success', message: 'Contract sent via DocuSign' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send contract' });
    } finally {
      setSaving(false);
    }
  }

  async function refreshContractStatus() {
    if (!contract?.docusign_envelope_id) return;
    try {
      const { status, completedAt } = await getEnvelopeStatus(contract.docusign_envelope_id);
      const patch = { docusign_status: status };
      if (status === 'completed' && completedAt) {
        patch.signed_at = completedAt;
        patch.status = 'signed';
      }
      const { data } = await supabase.from('contracts').update(patch).eq('id', contract.id).select().single();
      if (data) setContract(data);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Could not refresh status' });
    }
  }

  async function sendDepositInvoice() {
    if (!contract) return;
    setSaving(true);
    try {
      // TODO: integrate with real invoicing provider; for now just record the event.
      const { data, error } = await supabase
        .from('contracts')
        .update({ deposit_invoice_sent_at: new Date().toISOString() })
        .eq('id', contract.id)
        .select().single();
      if (error) throw error;
      setContract(data);
      setToast({ type: 'success', message: 'Deposit invoice sent' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send invoice' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-5 bg-white border-b border-gray-200 sticky top-0 z-10">
        <button onClick={onBack} className="text-sm text-omega-stone hover:text-omega-charcoal flex items-center gap-1 mb-2">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <h1 className="text-xl font-bold text-omega-charcoal">{job.client_name || job.name || 'Estimate Flow'}</h1>
        <p className="text-sm text-omega-stone">{job.address || job.city || ''}</p>
      </header>

      <div className="p-6 md:p-8 space-y-6">
        <Stepper current={step} />

        {/* STEP 1 */}
        {step === 1 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-lg font-bold text-omega-charcoal">Review Estimate</h2>
              {estimate && <StatusBadge status={estimate.status} />}
            </div>

            {!estimate ? (
              <p className="text-sm text-omega-stone py-10 text-center">No estimate has been created for this job yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                      <tr>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Unit</th>
                        <th className="px-3 py-2 text-right">Unit Price</th>
                        <th className="px-3 py-2 text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(estimate.line_items || []).length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-omega-stone text-sm">No line items.</td></tr>
                      )}
                      {(estimate.line_items || []).map((li, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{li.description || li.item || '—'}</td>
                          <td className="px-3 py-2 text-right">{li.qty ?? '—'}</td>
                          <td className="px-3 py-2 text-right">{li.unit || '—'}</td>
                          <td className="px-3 py-2 text-right">{li.unit_price != null ? `$${Number(li.unit_price).toLocaleString()}` : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium">{li.total != null ? `$${Number(li.total).toLocaleString()}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    {estimate.total_amount != null && (
                      <tfoot>
                        <tr className="font-bold">
                          <td colSpan={4} className="px-3 py-3 text-right">Total</td>
                          <td className="px-3 py-3 text-right">${Number(estimate.total_amount).toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {estimate.notes && (
                  <div className="mt-4 p-3 rounded-lg bg-omega-cloud text-sm text-omega-slate">{estimate.notes}</div>
                )}

                <div className="flex justify-end gap-2 mt-6">
                  <button onClick={requestChanges} disabled={saving} className="px-4 py-2.5 rounded-xl border border-gray-200 hover:border-red-300 text-sm font-semibold text-omega-charcoal">Request Changes</button>
                  <button onClick={approveEstimate} disabled={saving} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                    {saving ? 'Saving…' : 'Approve Estimate'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-omega-charcoal mb-1">Payment Plan</h2>
            <p className="text-sm text-omega-stone mb-4">Split the total into installments. The sum of percentages must equal 100%.</p>

            <div className="space-y-2">
              {paymentPlan.map((p, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={p.label} onChange={(e) => updateInstallment(i, { label: e.target.value })} className="col-span-4 px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Label (e.g. Deposit)" />
                  <div className="col-span-2 relative">
                    <input type="number" value={p.percent} onChange={(e) => updateInstallment(i, { percent: Number(e.target.value) || 0, amount: estimate?.total_amount ? Math.round(Number(e.target.value)/100 * Number(estimate.total_amount) * 100)/100 : 0 })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm pr-7" placeholder="0" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-omega-stone">%</span>
                  </div>
                  <div className="col-span-3 relative">
                    <input type="number" value={p.amount} onChange={(e) => updateInstallment(i, { amount: Number(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm pl-6" placeholder="0.00" />
                    <DollarSign className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-omega-stone" />
                  </div>
                  <input type="date" value={p.due_date || ''} onChange={(e) => updateInstallment(i, { due_date: e.target.value })} className="col-span-2 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                  <button onClick={() => removeInstallment(i)} className="col-span-1 text-red-500 hover:text-red-700 flex justify-center"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            <button onClick={addInstallment} className="mt-3 flex items-center gap-1 text-sm font-semibold text-omega-orange hover:text-omega-dark">
              <Plus className="w-4 h-4" /> Add Installment
            </button>

            <div className="mt-5 flex items-center justify-between border-t border-gray-200 pt-4">
              <p className={`text-sm font-semibold ${Math.round(planTotalPct) === 100 ? 'text-omega-success' : 'text-omega-warning'}`}>
                Total: {planTotalPct}% {Math.round(planTotalPct) === 100 ? '✓' : `(need ${100 - planTotalPct}% more)`}
              </p>
              <button onClick={savePaymentPlanAndContinue} disabled={saving} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : 'Continue to Contract'}
              </button>
            </div>
          </section>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-lg font-bold text-omega-charcoal">Generate Contract</h2>
              {contract && <StatusBadge status={contract.docusign_status || contract.status} />}
            </div>

            {/* PDF Preview placeholder — rendered from data */}
            <div className="border border-gray-200 rounded-lg bg-omega-cloud p-6 text-sm text-omega-charcoal space-y-4">
              <div>
                <p className="font-bold text-base">OMEGA CONSTRUCTION AGREEMENT</p>
                <p className="text-xs text-omega-stone mt-1">Preview — will be rendered as PDF on send</p>
              </div>
              <div>
                <p className="font-semibold">Client</p>
                <p>{job.client_name || '—'}</p>
                <p className="text-omega-stone">{job.address || job.city || '—'}</p>
              </div>
              <div>
                <p className="font-semibold">Scope of Work</p>
                <ul className="list-disc list-inside text-omega-slate">
                  {(estimate?.line_items || []).slice(0, 6).map((li, i) => (
                    <li key={i}>{li.description || li.item}</li>
                  ))}
                  {(!estimate?.line_items || estimate.line_items.length === 0) && <li>— see attached estimate —</li>}
                </ul>
              </div>
              <div>
                <p className="font-semibold">Payment Plan</p>
                <ol className="list-decimal list-inside text-omega-slate">
                  {paymentPlan.map((p, i) => (
                    <li key={i}>{p.label} — {p.percent}% (${Number(p.amount || 0).toLocaleString()}) {p.due_date ? `— ${p.due_date}` : ''}</li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="font-semibold">Standard Omega Terms</p>
                <p className="text-omega-stone text-xs">Includes standard warranty, change-order policy, and payment terms as per Omega master agreement.</p>
              </div>
              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-200">
                <div>
                  <div className="h-12 border-b border-omega-charcoal" />
                  <p className="text-xs text-omega-stone mt-1">Client Signature</p>
                </div>
                <div>
                  <div className="h-12 border-b border-omega-charcoal" />
                  <p className="text-xs text-omega-stone mt-1">Omega Representative</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-5 flex-wrap gap-2">
              {contract?.docusign_envelope_id ? (
                <div className="text-sm text-omega-stone">
                  Envelope ID: <span className="font-mono text-xs">{contract.docusign_envelope_id}</span>
                  <button onClick={refreshContractStatus} className="ml-3 text-omega-info font-semibold text-xs">Refresh status</button>
                </div>
              ) : <div />}

              <div className="flex gap-2">
                {contract?.signed_at
                  ? <button onClick={() => setStep(4)} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">Continue to Invoice</button>
                  : <button onClick={generateAndSendContract} disabled={saving} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2">
                      <Send className="w-4 h-4" /> {saving ? 'Sending…' : 'Send via DocuSign'}
                    </button>
                }
              </div>
            </div>

            {contract && !contract.signed_at && (
              <p className="mt-3 text-xs text-omega-stone"><FileText className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Awaiting signature…</p>
            )}
          </section>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-omega-charcoal mb-4">Invoice & Deposit</h2>

            {!contract?.signed_at ? (
              <p className="text-sm text-omega-warning">Contract must be signed before sending the deposit invoice.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-lg bg-omega-cloud">
                    <p className="text-xs text-omega-stone uppercase font-semibold">Contract Total</p>
                    <p className="text-lg font-bold text-omega-charcoal mt-1">${Number(contract.total_amount || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-omega-cloud">
                    <p className="text-xs text-omega-stone uppercase font-semibold">Deposit</p>
                    <p className="text-lg font-bold text-omega-charcoal mt-1">${Number(contract.deposit_amount || 0).toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-omega-cloud">
                    <p className="text-xs text-omega-stone uppercase font-semibold">Signed</p>
                    <p className="text-lg font-bold text-omega-charcoal mt-1">{new Date(contract.signed_at).toLocaleDateString()}</p>
                  </div>
                </div>

                <button onClick={sendDepositInvoice} disabled={saving || !!contract.deposit_invoice_sent_at}
                        className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  {contract.deposit_invoice_sent_at ? `Invoice sent ${new Date(contract.deposit_invoice_sent_at).toLocaleDateString()}` : (saving ? 'Sending…' : 'Send Deposit Invoice')}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
