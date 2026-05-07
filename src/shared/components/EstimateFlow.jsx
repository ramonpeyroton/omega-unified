import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Check, Trash2, Plus, Send, FileText, DollarSign, Lock, Info, MessageSquare, X, Clock, CheckCircle2 } from 'lucide-react';
import { validateUserPinDetailed } from '../lib/userPin';
import { supabase } from '../lib/supabase';
import { createEnvelope, getEnvelopeStatus, downloadSignedDocument } from '../lib/docusign';
import LoadingSpinner from './LoadingSpinner';
import Toast from './Toast';
import StatusBadge from './StatusBadge';
import ContractTemplate from './Contract/ContractTemplate';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notifications';

// Build-time flag toggling the DocuSign send button. We deliberately
// use VITE_DOCUSIGN_ENABLED (string '1') so Ramon can flip it on a
// single Vercel env var the day DocuSign is contracted, without us
// shipping a code change. The button stays visible-but-disabled in
// the meantime so Brenda can see what the future flow will look like.
const DOCUSIGN_CLIENT_ENABLED = import.meta.env?.VITE_DOCUSIGN_ENABLED === '1';

const STEPS = [
  { id: 1, label: 'Review Estimate' },
  { id: 2, label: 'Payment Plan' },
  { id: 3, label: 'Generate Contract' },
  { id: 4, label: 'Awaiting Signature' },
  { id: 5, label: 'Invoice & Deposit' },
];

// Permissions matrix
function permsFor(role) {
  switch (role) {
    case 'sales':
    case 'salesperson': // legacy alias
      return {
        canEditEstimate: true,
        canEditPaymentPlan: true,
        canSendContract: true,     // full sales-cycle access
        canSendInvoice: true,
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
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [toast, setToast] = useState(null);

  const [estimate, setEstimate] = useState(null);
  const [contract, setContract] = useState(null);
  const [paymentPlan, setPaymentPlan] = useState([]);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [changeText, setChangeText] = useState('');
  const [showManualAdvanceModal, setShowManualAdvanceModal] = useState(false);
  const [showInvoiceEditor, setShowInvoiceEditor] = useState(false);

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
      if (ctr?.signed_at) setStep(5);
      else if (ctr?.status === 'sent' || ctr?.docusign_envelope_id) setStep(4);
      else if (ctr) setStep(3);
      else if (est?.approved_at) setStep(2);
      else setStep(1);

      // When EstimateFlow opens on a job that still sits at `new_lead`,
      // the estimate is now "in review" — promote to estimate_draft so
      // the kanban reflects that work has started.
      if (est && (!job.pipeline_status || job.pipeline_status === 'new_lead')) {
        await setJobPipeline('estimate_draft');
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load estimate data' });
    } finally {
      setLoading(false);
    }
  }

  // Single helper for pipeline_status writes. Keeps the state machine
  // transitions in one place and audits each promotion.
  async function setJobPipeline(next) {
    try {
      await supabase.from('jobs').update({ pipeline_status: next }).eq('id', job.id);
      logAudit({ user, action: 'pipeline.transition', entityType: 'job', entityId: job.id, details: { to: next } });
    } catch { /* non-fatal */ }
  }

  async function sendEstimateToClient() {
    if (!perms.canEditEstimate) { setToast({ type: 'warning', message: 'Only Operations or Owner can send the estimate' }); return; }
    if (!estimate) { setToast({ type: 'error', message: 'No estimate to send' }); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('estimates')
        .update({ status: 'sent', sent_at: new Date().toISOString(), sent_by: user?.name || null })
        .eq('id', estimate.id)
        .select().single();
      if (error) throw error;
      setEstimate(data);
      await setJobPipeline('estimate_sent');
      notify({ recipientRole: 'sales', title: 'Estimate sent to client', message: `${job.client_name || 'Job'} — estimate has been sent.`, type: 'estimate', jobId: job.id });
      setToast({ type: 'success', message: 'Estimate sent to client' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send estimate' });
    } finally {
      setSaving(false);
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
    // Client accepted the estimate → promote job to estimate_approved.
    await setJobPipeline('estimate_approved');
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
    // Hard rejection → promote job to estimate_rejected so the card
    // moves to the last column on the Kanban.
    await setJobPipeline('estimate_rejected');
    logAudit({ user, action: 'estimate.reject', entityType: 'estimate', entityId: data.id, details: { job_id: job.id } });
    notify({ recipientRole: 'sales', title: 'Estimate rejected', message: `${job.client_name || 'Job'} — client rejected the estimate.`, type: 'estimate', jobId: job.id });
    setToast({ type: 'info', message: 'Marked as rejected' });
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
    // Client wants changes → move to estimate_negotiating so the board
    // shows that a back-and-forth is happening (not approved, not dead).
    await setJobPipeline('estimate_negotiating');
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
    if (!perms.canSendContract) { setToast({ type: 'warning', message: 'You do not have permission to send contracts' }); return; }
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
      setStep(4);
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
          setStep(5);
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

  async function handleDownloadSignedPdf() {
    if (!contract?.docusign_envelope_id) return;
    setDownloadingPdf(true);
    try {
      const blob = await downloadSignedDocument(contract.docusign_envelope_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `signed-contract-${job.client_name || contract.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Could not download PDF' });
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function sendDepositInvoice(invoiceData) {
    if (!perms.canSendInvoice) { setToast({ type: 'warning', message: 'Only Operations or Owner can send the deposit invoice' }); return; }
    if (!contract) return;
    setSaving(true);
    try {
      const patch = {
        deposit_invoice_sent_at: new Date().toISOString(),
        deposit_amount: invoiceData.depositAmount != null ? Number(invoiceData.depositAmount) : contract.deposit_amount,
        invoice_due_date: invoiceData.dueDate || null,
        invoice_notes: invoiceData.notes || null,
      };
      const { data, error } = await supabase.from('contracts').update(patch).eq('id', contract.id).select().single();
      if (error) throw error;
      setContract(data);
      setShowInvoiceEditor(false);
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
                  {/* Send to Client — only when estimate hasn't been sent yet.
                      Moves pipeline to estimate_sent so the client-side team
                      knows the estimate is now with the client. */}
                  {estimate.status !== 'sent' && estimate.status !== 'approved' && (
                    <button onClick={sendEstimateToClient} disabled={saving || !perms.canEditEstimate} className="px-4 py-2.5 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-semibold disabled:opacity-60">
                      {saving ? 'Sending…' : 'Send to Client'}
                    </button>
                  )}
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

            {/* Sales gated message — shown above the editable contract so
                the seller knows they can review but Operations sends. */}
            {!perms.canSendContract && (
              <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                <Info className="w-4 h-4 text-blue-700 mt-0.5" />
                <p className="text-sm text-blue-900">Contract will be sent by the Operations team.</p>
              </div>
            )}
            {!DOCUSIGN_CLIENT_ENABLED && perms.canSendContract && (
              <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <Info className="w-4 h-4 text-amber-700 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <p className="font-semibold">DocuSign not configured yet</p>
                  <p className="text-xs mt-0.5">
                    Use <strong>Download PDF</strong> below for now and email it to the client manually.
                    The DocuSign button activates the moment <code>VITE_DOCUSIGN_ENABLED=1</code>
                    {' '}is set on Vercel and the server-side credentials are in place.
                  </p>
                </div>
              </div>
            )}

            <ContractTemplate
              job={job}
              estimate={estimate}
              paymentPlan={paymentPlan}
              canSendDocuSign={DOCUSIGN_CLIENT_ENABLED && perms.canSendContract && !contract?.signed_at}
              onSendDocuSign={generateAndSendContract}
              saving={saving}
            />

            {contract?.docusign_envelope_id && (
              <div className="mt-4 text-sm text-omega-stone">
                Envelope ID: <span className="font-mono text-xs">{contract.docusign_envelope_id}</span>
                <button onClick={refreshContractStatus} className="ml-3 text-omega-info font-semibold text-xs">Refresh status</button>
              </div>
            )}

            {contract?.signed_at && (
              <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
                <button
                  onClick={handleDownloadSignedPdf}
                  disabled={downloadingPdf || !contract.docusign_envelope_id}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal disabled:opacity-50"
                >
                  <FileText className="w-4 h-4" />
                  {downloadingPdf ? 'Downloading…' : 'Download Signed PDF'}
                </button>
                <button
                  onClick={() => setStep(5)}
                  className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
                >
                  Continue to Invoice
                </button>
              </div>
            )}

          </section>
        )}

        {/* STEP 4 — Awaiting Signature */}
        {step === 4 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
              <h2 className="text-lg font-bold text-omega-charcoal">Awaiting Signature</h2>
              {contract && <StatusBadge status={contract.docusign_status || contract.status} />}
            </div>

            <div className="flex flex-col items-center py-10 gap-4">
              <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
                <Clock className="w-8 h-8 text-amber-500" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-omega-charcoal">Waiting for client's signature</p>
                <p className="text-sm text-omega-stone mt-1">
                  The contract was sent to <span className="font-medium">{job.client_name || 'the client'}</span> via DocuSign.
                  This step will advance automatically once they sign.
                </p>
              </div>

              <div className="flex items-center gap-3 mt-2 flex-wrap justify-center">
                <button
                  onClick={refreshContractStatus}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal transition-colors"
                >
                  <Clock className="w-4 h-4" /> Check Signature Status
                </button>

                {(user?.role === 'owner' || user?.role === 'operations' || user?.role === 'sales' || user?.role === 'salesperson') && (
                  <button
                    onClick={() => setShowManualAdvanceModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-stone hover:text-omega-charcoal transition-colors"
                  >
                    <Lock className="w-4 h-4" /> Mark as Signed Manually
                  </button>
                )}
              </div>

              {contract?.docusign_envelope_id && (
                <p className="text-xs text-omega-stone mt-2">
                  Envelope: <span className="font-mono">{contract.docusign_envelope_id}</span>
                </p>
              )}
            </div>
          </section>
        )}

        {/* STEP 5 — Invoice & Deposit */}
        {step === 5 && (
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

                {contract.deposit_invoice_sent_at ? (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-cloud text-sm font-semibold text-omega-success">
                    <Check className="w-4 h-4" />
                    Invoice sent {new Date(contract.deposit_invoice_sent_at).toLocaleDateString()}
                  </div>
                ) : perms.canSendInvoice ? (
                  <button
                    onClick={() => setShowInvoiceEditor(true)}
                    className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" /> Review & Send Invoice
                  </button>
                ) : null}
              </>
            )}
          </section>
        )}
      </div>

      {showInvoiceEditor && contract && (
        <InvoiceEditorModal
          contract={contract}
          job={job}
          paymentPlan={paymentPlan}
          saving={saving}
          onClose={() => setShowInvoiceEditor(false)}
          onSend={(data) => sendDepositInvoice(data)}
        />
      )}

      {showManualAdvanceModal && (
        <ManualAdvancePinModal
          user={user}
          onClose={() => setShowManualAdvanceModal(false)}
          onConfirm={async () => {
            try {
              const now = new Date().toISOString();
              const patch = { status: 'signed', signed_at: now, docusign_status: 'manually_confirmed' };
              const { data, error } = await supabase.from('contracts').update(patch).eq('id', contract.id).select().single();
              if (error) throw error;
              setContract(data);
              await supabase.from('jobs').update({ status: 'contracted' }).eq('id', job.id);
              logAudit({ user, action: 'contract.manual_sign', entityType: 'contract', entityId: contract.id, details: { job_id: job.id } });
              setShowManualAdvanceModal(false);
              setStep(5);
              setToast({ type: 'success', message: 'Contract marked as signed — advancing to Invoice.' });
            } catch (err) {
              setToast({ type: 'error', message: err.message || 'Failed to advance' });
            }
          }}
        />
      )}

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

function ManualAdvancePinModal({ user, onClose, onConfirm }) {
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!pin.trim()) { setError('Enter your PIN'); return; }
    setVerifying(true);
    setError('');
    try {
      const result = await validateUserPinDetailed({ name: user?.name, pin, role: user?.role });
      if (result.ok) {
        await onConfirm();
      } else {
        setError(PIN_ERRORS[result.reason] || 'Invalid PIN');
      }
    } catch {
      setError('Verification failed — try again');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-omega-charcoal">Mark as Signed Manually</h3>
            <p className="text-xs text-omega-stone mt-0.5">Enter your PIN to confirm.</p>
          </div>
        </div>
        <p className="text-xs text-omega-stone mb-4">
          Use this only if the client signed outside of DocuSign (e.g. printed and mailed). This will advance the flow to Invoice & Deposit.
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          placeholder="Your PIN"
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm mb-2 focus:outline-none focus:border-omega-orange text-center tracking-widest"
        />
        {error && <p className="text-xs text-red-500 mb-2 text-center">{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-omega-slate hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={verifying}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-omega-orange text-white hover:bg-omega-dark transition-colors disabled:opacity-60"
          >
            {verifying ? 'Verifying…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

const PIN_ERRORS = {
  wrong_pin:     'Wrong PIN — try again.',
  role_mismatch: 'PIN matches a different role.',
  name_mismatch: 'PIN belongs to another user.',
  query_failed:  'Network error — try again.',
};

function InvoiceEditorModal({ contract, job, paymentPlan, saving, onClose, onSend }) {
  const today = new Date().toISOString().split('T')[0];
  const [depositAmount, setDepositAmount] = useState(
    contract.deposit_amount != null ? String(contract.deposit_amount) : ''
  );
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const total = Number(contract.total_amount || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-base font-bold text-omega-charcoal">Deposit Invoice</h3>
            <p className="text-xs text-omega-stone mt-0.5">{job.client_name} — review before sending</p>
          </div>
          <button onClick={onClose} className="text-omega-stone hover:text-omega-charcoal">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-omega-cloud">
              <p className="text-xs text-omega-stone uppercase font-semibold">Contract Total</p>
              <p className="text-base font-bold text-omega-charcoal mt-0.5">${total.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-omega-cloud">
              <p className="text-xs text-omega-stone uppercase font-semibold">Signed</p>
              <p className="text-base font-bold text-omega-charcoal mt-0.5">
                {contract.signed_at ? new Date(contract.signed_at).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>

          {/* Payment plan summary */}
          {paymentPlan.length > 0 && (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-omega-stone uppercase">Payment Plan</div>
              {paymentPlan.map((p, i) => {
                const amt = p.amount
                  ? Number(p.amount)
                  : p.percent ? Math.round(total * Number(p.percent) / 100 * 100) / 100 : 0;
                return (
                  <div key={i} className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-sm">
                    <span className="text-omega-slate">{p.label || `Installment ${i + 1}`}</span>
                    <span className="font-semibold text-omega-charcoal">${amt.toLocaleString()}{p.percent ? ` (${p.percent}%)` : ''}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-omega-stone uppercase mb-1">Deposit Amount</label>
              <div className="relative">
                <DollarSign className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone" />
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-omega-orange"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-omega-stone uppercase mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                min={today}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-omega-orange"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-omega-stone uppercase mb-1">Notes / Payment Instructions</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Please make check payable to Omega Development LLC, or bank transfer to…"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-omega-orange resize-none"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-omega-slate hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onSend({ depositAmount: depositAmount || contract.deposit_amount, dueDate, notes })}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            {saving ? 'Sending…' : 'Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
