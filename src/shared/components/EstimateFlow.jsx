import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Check, Trash2, Plus, Send, FileText, DollarSign, Lock, Info, MessageSquare, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createEnvelope, getEnvelopeStatus } from '../lib/docusign';
import LoadingSpinner from './LoadingSpinner';
import Toast from './Toast';
import StatusBadge from './StatusBadge';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notifications';

const STEPS = [
  { id: 1, label: 'Review Estimate' },
  { id: 2, label: 'Payment Plan' },
  { id: 3, label: 'Generate Contract' },
  { id: 4, label: 'Invoice & Deposit' },
];

// Permissions matrix
function permsFor(role) {
  switch (role) {
    case 'sales':
    case 'salesperson': // legacy alias
      return {
        canEditEstimate: true,     // step 1
        canEditPaymentPlan: true,  // step 2
        canSendContract: false,    // step 3 — gated
        canSendInvoice: false,     // step 4 — gated
      };
    case 'operations':
      return {
        canEditEstimate: true,
        canEditPaymentPlan: true,
        canSendContract: true,
        canSendInvoice: true,
      };
    case 'owner':
      return {
        canEditEstimate: true,
        canEditPaymentPlan: true,
        canSendContract: true,
        canSendInvoice: true,
      };
    default:
      return { canEditEstimate: false, canEditPaymentPlan: false, canSendContract: false, canSendInvoice: false };
  }
}

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
  const perms = permsFor(user?.role);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [estimate, setEstimate] = useState(null);
  const [contract, setContract] = useState(null);
  const [paymentPlan, setPaymentPlan] = useState([]);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeText, setChangeText] = useState('');

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
    if (!perms.canEditEstimate) return;
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
    logAudit({ user, action: 'estimate.approve', entityType: 'estimate', entityId: data.id, details: { job_id: job.id, total: data.total_amount } });
    notify({ recipientRole: 'operations', title: 'Estimate approved', message: `${job.client_name || 'A client'} approved the estimate for ${job.service || 'their project'}.`, type: 'estimate', jobId: job.id });
    notify({ recipientRole: 'owner', title: 'Estimate approved', message: `${job.client_name || 'Client'}: $${Number(data.total_amount || 0).toLocaleString()}`, type: 'estimate', jobId: job.id });
    setToast({ type: 'success', message: 'Estimate approved' });
    setStep(2);
  }

  async function requestChanges() {
    if (!perms.canEditEstimate) return;
    if (!estimate) return;
    setSaving(true);
    const { data, error } = await supabase.from('estimates').update({ status: 'rejected' }).eq('id', estimate.id).select().single();
    setSaving(false);
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setEstimate(data);
    logAudit({ user, action: 'estimate.reject', entityType: 'estimate', entityId: data.id, details: { job_id: job.id } });
    setToast({ type: 'info', message: 'Marked for changes' });
  }

  async function submitChangeRequest() {
    if (!estimate) { setToast({ type: 'error', message: 'No estimate to update' }); return; }
    if (!changeText.trim()) { setToast({ type: 'warning', message: 'Describe what needs to change' }); return; }
    setSaving(true);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('estimates')
      .update({
        status: 'changes_requested',
        status_detail: 'Changes requested',
        change_request: changeText.trim(),
        change_requested_at: nowIso,
      })
      .eq('id', estimate.id)
      .select().single();
    if (error) { setSaving(false); setToast({ type: 'error', message: error.message }); return; }
    setEstimate(data);
    logAudit({ user, action: 'estimate.request_changes', entityType: 'estimate', entityId: data.id, details: { job_id: job.id, text: changeText.trim().slice(0, 200) } });
    notify({ recipientRole: 'sales', title: 'Changes requested', message: `${job.client_name || 'Job'}: ${changeText.trim().slice(0, 120)}`, type: 'estimate', jobId: job.id });
    // Best-effort notification to Attila (or sales team).
    try {
      await supabase.from('notifications').insert([{
        job_id: job.id,
        message: `Changes requested on estimate for ${job.client_name || job.name}: ${changeText.trim().slice(0, 120)}`,
        seen: false,
      }]);
    } catch { /* notifications table may not exist */ }
    setSaving(false);
    setShowChangeModal(false);
    setChangeText('');
    setToast({ type: 'success', message: 'Change request sent' });
  }

  const planTotalPct = useMemo(
    () => paymentPlan.reduce((sum, p) => sum + (Number(p.percent) || 0), 0),
    [paymentPlan]
  );

  function addInstallment() {
    if (!perms.canEditPaymentPlan) return;
    setPaymentPlan((prev) => [...prev, { label: `Installment ${prev.length + 1}`, percent: 0, amount: 0, due_date: '' }]);
  }
  function updateInstallment(i, patch) {
    if (!perms.canEditPaymentPlan) return;
    setPaymentPlan((prev) => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  }
  function removeInstallment(i) {
    if (!perms.canEditPaymentPlan) return;
    setPaymentPlan((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function savePaymentPlanAndContinue() {
    if (!perms.canEditPaymentPlan) return;
    if (Math.round(planTotalPct) !== 100) {
      setToast({ type: 'warning', message: `Payment plan must total 100% (currently ${planTotalPct}%)` });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from('estimates').update({ payment_plan: paymentPlan }).eq('id', estimate.id).select().single();
    setSaving(false);
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setEstimate(data);
    setStep(3);
  }

  async function generateAndSendContract() {
    if (!perms.canSendContract) { setToast({ type: 'warning', message: 'Only Operations or Owner can send contracts' }); return; }
    setSaving(true);
    try {
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

      const { envelopeId } = await createEnvelope({ contractId: created.id, job, estimate, paymentPlan });

      const { data: updated, error: updErr } = await supabase
        .from('contracts')
        .update({ docusign_envelope_id: envelopeId, docusign_status: 'sent', status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', created.id)
        .select().single();
      if (updErr) throw updErr;

      // Also promote job to contract_sent in the pipeline
      await supabase.from('jobs').update({ pipeline_status: 'contract_sent' }).eq('id', job.id);

      setContract(updated);
      logAudit({ user, action: 'contract.send', entityType: 'contract', entityId: updated.id, details: { job_id: job.id, envelope: envelopeId } });
      notify({ recipientRole: 'sales', title: 'Contract sent', message: `Contract for ${job.client_name || 'job'} was sent via DocuSign.`, type: 'contract', jobId: job.id });
      notify({ recipientRole: 'owner', title: 'Contract sent', message: `${job.client_name || 'Client'}: $${Number(updated.total_amount || 0).toLocaleString()}`, type: 'contract', jobId: job.id });
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
      const wasSigned = contract.status === 'signed';
      if (status === 'completed' && completedAt) { patch.signed_at = completedAt; patch.status = 'signed'; }
      const { data } = await supabase.from('contracts').update(patch).eq('id', contract.id).select().single();
      if (data) {
        setContract(data);
        if (!wasSigned && data.status === 'signed') {
          logAudit({ user, action: 'contract.sign', entityType: 'contract', entityId: data.id, details: { job_id: job.id } });
          notify({ recipientRole: 'owner', title: 'Contract signed', message: `${job.client_name || 'Client'} signed — $${Number(data.total_amount || 0).toLocaleString()}`, type: 'contract', jobId: job.id });
          notify({ recipientRole: 'operations', title: 'Contract signed', message: `${job.client_name || 'Client'} — deposit invoice is next.`, type: 'contract', jobId: job.id });
          notify({ recipientRole: 'sales', title: 'Contract signed', message: `Your client ${job.client_name || ''} signed the contract.`, type: 'contract', jobId: job.id });
        }
      }
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Could not refresh status' });
    }
  }

  async function sendDepositInvoice() {
    if (!perms.canSendInvoice) { setToast({ type: 'warning', message: 'Only Operations or Owner can send the deposit invoice' }); return; }
    if (!contract) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('contracts').update({ deposit_invoice_sent_at: new Date().toISOString() }).eq('id', contract.id).select().single();
      if (error) throw error;
      setContract(data);
      logAudit({ user, action: 'contract.invoice_sent', entityType: 'contract', entityId: data.id, details: { job_id: job.id, deposit: data.deposit_amount } });
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
          <ArrowLeft className="w-4 h-4" /> Back
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

                <div className="flex justify-end gap-2 mt-6 flex-wrap">
                  <button onClick={requestChanges} disabled={saving || !perms.canEditEstimate} className="px-4 py-2.5 rounded-xl border border-gray-200 hover:border-red-300 text-sm font-semibold text-omega-charcoal disabled:opacity-50">Reject</button>
                  <button onClick={() => setShowChangeModal(true)} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-info hover:bg-blue-900 text-white text-sm font-semibold disabled:opacity-60">
                    <MessageSquare className="w-4 h-4" /> Request Changes
                  </button>
                  <button onClick={approveEstimate} disabled={saving || !perms.canEditEstimate} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
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
                  <input disabled={!perms.canEditPaymentPlan} value={p.label} onChange={(e) => updateInstallment(i, { label: e.target.value })} className="col-span-4 px-3 py-2 rounded-lg border border-gray-200 text-sm disabled:bg-gray-50" placeholder="Label (e.g. Deposit)" />
                  <div className="col-span-2 relative">
                    <input disabled={!perms.canEditPaymentPlan} type="number" value={p.percent} onChange={(e) => updateInstallment(i, { percent: Number(e.target.value) || 0, amount: estimate?.total_amount ? Math.round(Number(e.target.value)/100 * Number(estimate.total_amount) * 100)/100 : 0 })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm pr-7 disabled:bg-gray-50" placeholder="0" />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-omega-stone">%</span>
                  </div>
                  <div className="col-span-3 relative">
                    <input disabled={!perms.canEditPaymentPlan} type="number" value={p.amount} onChange={(e) => updateInstallment(i, { amount: Number(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm pl-6 disabled:bg-gray-50" placeholder="0.00" />
                    <DollarSign className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-omega-stone" />
                  </div>
                  <input disabled={!perms.canEditPaymentPlan} type="date" value={p.due_date || ''} onChange={(e) => updateInstallment(i, { due_date: e.target.value })} className="col-span-2 px-3 py-2 rounded-lg border border-gray-200 text-sm disabled:bg-gray-50" />
                  <button disabled={!perms.canEditPaymentPlan} onClick={() => removeInstallment(i)} className="col-span-1 text-red-500 hover:text-red-700 flex justify-center disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            {perms.canEditPaymentPlan && (
              <button onClick={addInstallment} className="mt-3 flex items-center gap-1 text-sm font-semibold text-omega-orange hover:text-omega-dark">
                <Plus className="w-4 h-4" /> Add Installment
              </button>
            )}

            <div className="mt-5 flex items-center justify-between border-t border-gray-200 pt-4">
              <p className={`text-sm font-semibold ${Math.round(planTotalPct) === 100 ? 'text-omega-success' : 'text-omega-warning'}`}>
                Total: {planTotalPct}% {Math.round(planTotalPct) === 100 ? '✓' : `(need ${100 - planTotalPct}% more)`}
              </p>
              <button onClick={savePaymentPlanAndContinue} disabled={saving || !perms.canEditPaymentPlan} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
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

            {/* Sales gated message */}
            {!perms.canSendContract && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                <Info className="w-4 h-4 text-blue-700 mt-0.5" />
                <p className="text-sm text-blue-900">Contract will be sent by Operations team.</p>
              </div>
            )}

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
                  : <button onClick={generateAndSendContract} disabled={saving || !perms.canSendContract} className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2">
                      {perms.canSendContract ? <Send className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {saving ? 'Sending…' : 'Send via DocuSign'}
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

                {!perms.canSendInvoice && (
                  <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <Info className="w-4 h-4 text-blue-700 mt-0.5" />
                    <p className="text-sm text-blue-900">The deposit invoice will be sent by the Operations team.</p>
                  </div>
                )}

                <button onClick={sendDepositInvoice} disabled={saving || !!contract.deposit_invoice_sent_at || !perms.canSendInvoice}
                        className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2">
                  {perms.canSendInvoice ? <Send className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  {contract.deposit_invoice_sent_at ? `Invoice sent ${new Date(contract.deposit_invoice_sent_at).toLocaleDateString()}` : (saving ? 'Sending…' : 'Send Deposit Invoice')}
                </button>
              </>
            )}
          </section>
        )}
      </div>

      {showChangeModal && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowChangeModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">Request Changes</p>
              <button onClick={() => setShowChangeModal(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5">
              <label className="text-xs font-semibold text-omega-stone uppercase">Describe what needs to be changed…</label>
              <textarea
                autoFocus
                value={changeText}
                onChange={(e) => setChangeText(e.target.value)}
                rows={5}
                className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                placeholder="e.g. Adjust quantity of deck boards, reduce the hardware line by $200, etc."
              />
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowChangeModal(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={submitChangeRequest} disabled={saving || !changeText.trim()} className="px-4 py-2 rounded-xl bg-omega-info hover:bg-blue-900 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2">
                <Send className="w-4 h-4" /> {saving ? 'Sending…' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
