import { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Check, Trash2, Plus, Send, FileText, DollarSign, Lock, Info, MessageSquare, X, Clock, CheckCircle2, AlertTriangle, RotateCw, PartyPopper } from 'lucide-react';
import { validateUserPinDetailed } from '../lib/userPin';
import { supabase } from '../lib/supabase';
import { createEnvelope, getEnvelopeStatus, downloadSignedDocument } from '../lib/docusign';
import LoadingSpinner from './LoadingSpinner';
import Toast from './Toast';
import StatusBadge from './StatusBadge';
import ContractTemplate, { buildContractDocFromDom } from './Contract/ContractTemplate';
import InvoiceTemplate from './Contract/InvoiceTemplate';
import { ensureMilestonesForContract, markMilestoneReceived, effectiveStatus } from '../lib/finance';
import { logAudit } from '../lib/audit';
import { notify } from '../lib/notifications';

// Build-time flag toggling the DocuSign send button. We deliberately
// use VITE_DOCUSIGN_ENABLED (string '1') so Ramon can flip it on a
// single Vercel env var the day DocuSign is contracted, without us
// shipping a code change. The button stays visible-but-disabled in
// the meantime so Brenda can see what the future flow will look like.
const DOCUSIGN_CLIENT_ENABLED = import.meta.env?.VITE_DOCUSIGN_ENABLED === '1';

// Parse a free-text payment schedule out of estimate.customer_message.
// Attila/Brenda typically write blocks like:
//   "Payment Schedule:
//    Deposit - 50%
//    Upon Completion 50%"
// We split on newlines and commas, then for each chunk look for an
// "<optional label> <N>%" pattern. Returns an array shaped like the
// rest of the payment_plan UI expects:
//   [{ label, percent, amount, due_date }]
// Returns [] when the message doesn't look like a schedule so the
// caller can fall back to the default starter plan.
export function parsePlanFromMessage(message) {
  if (!message || typeof message !== 'string') return [];
  // Strip a leading "Payment Schedule:" header if present so it doesn't
  // get parsed as a row on its own.
  const cleaned = message.replace(/payment\s*schedule\s*:?/i, '');
  const chunks = cleaned
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const pct = /([\d]+(?:\.\d+)?)\s*%/;
  const out = [];
  for (const chunk of chunks) {
    const m = chunk.match(pct);
    if (!m) continue;
    const percent = Number(m[1]);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) continue;
    // Label = everything except the matched percent, minus connectors
    // like dashes/colons. Falls back to "Installment N" if empty.
    const label = chunk
      .replace(pct, '')
      .replace(/^\s*[-–:•]+\s*/, '')
      .replace(/\s*[-–:•]+\s*$/, '')
      .trim() || `Installment ${out.length + 1}`;
    out.push({ label, percent, amount: 0, due_date: '' });
  }
  // Sanity check — if the parsed plan doesn't add up close to 100%
  // (within 5 points either way), bail. Probably noise, not a plan.
  const total = out.reduce((s, r) => s + r.percent, 0);
  if (out.length === 0) return [];
  if (Math.abs(total - 100) > 5) return [];
  return out;
}

// Returns a stable string fingerprint of a payment plan so we can
// detect "do these plans differ?" with a simple === comparison.
// Compares the percent breakdown, not the dollar amounts (because
// amounts scale with the estimate total — only the percent split
// matters when deciding "is this plan structurally the same?").
function planFingerprint(plan) {
  if (!Array.isArray(plan) || plan.length === 0) return '__empty__';
  return plan.map((p) => `${Math.round((Number(p?.percent) || 0) * 100) / 100}`).join('/');
}

// Take a "source" payment plan (a list of { label, percent }) and
// re-derive its amounts against the given total. Used when Attila
// selects multiple estimates and we have to scale a single chosen
// plan to the combined total.
function scalePlanToTotal(plan, total) {
  if (!Array.isArray(plan) || plan.length === 0) return [];
  const t = Number(total) || 0;
  return plan.map((p) => {
    const pct = Number(p?.percent) || 0;
    return {
      label: p?.label || '',
      percent: pct,
      amount: Math.round((pct / 100) * t * 100) / 100,
      due_date: p?.due_date || '',
    };
  });
}

// Build a single virtual estimate from the rows the user picked,
// including the merged Schedule A sections, total, and a single
// payment plan scaled to the merged total. Returns an object shaped
// like a row from `estimates` so the rest of the flow can keep using
// `estimate.*` without caring whether one or many estimates feed it.
//
//   estimates:    all approved estimate rows for the job
//   pickedIds:    array of estimate.id the user has checked
//   planSourceId: id of the estimate whose payment_plan to scale.
//                 When omitted we use the LATEST picked estimate.
//
// The function is pure — no side effects, no state.
function buildPickedEstimate({ estimates, pickedIds, planSourceId }) {
  const list = (estimates || []).filter((e) => pickedIds?.includes?.(e.id));
  if (list.length === 0) {
    return { estimate: null, mergedTotal: 0, scaledPlan: [], plansDiffer: false, planFingerprints: [] };
  }

  const mergedSections = [];
  let mergedTotal = 0;
  list.forEach((e, idx) => {
    const numberTag = e.estimate_number ? `#${e.estimate_number}` : `Estimate ${idx + 1}`;
    const labelTag = e.option_label || e.bundle_label || numberTag;
    const total = Number(e.total_amount) || 0;
    mergedTotal += total;
    let pushed = false;
    if (Array.isArray(e.sections) && e.sections.length) {
      e.sections.forEach((s) => {
        mergedSections.push({
          title: list.length > 1 ? `[${labelTag}] ${s.title || ''}`.trim() : (s.title || ''),
          items: Array.isArray(s.items) ? s.items : [],
        });
        pushed = true;
      });
    }
    if (!pushed && Array.isArray(e.line_items) && e.line_items.length) {
      mergedSections.push({
        title: list.length > 1 ? `[${labelTag}] Description of Work` : 'Description of Work',
        items: e.line_items.map((li) => ({
          description: li.description || li.item || '',
          scope: li.scope || '',
          price: Number(li.price ?? li.total ?? li.unit_price ?? 0),
        })),
      });
      pushed = true;
    }
    if (!pushed) {
      mergedSections.push({
        title: list.length > 1 ? `[${labelTag}] Combined work` : 'Combined work',
        items: [{
          description: e.estimate_number ? `Estimate #${e.estimate_number}` : `Estimate ${idx + 1}`,
          scope: e.header_description || e.customer_message || '',
          price: total,
        }],
      });
    }
  });

  // Detect "different payment plans" so the parent can pop a modal.
  // Empty / missing plans count as their own bucket — when one estimate
  // has a plan and the other doesn't, that's still "differs".
  const planFingerprints = list.map((e) => planFingerprint(e.payment_plan));
  const plansDiffer = list.length > 1 && new Set(planFingerprints).size > 1;

  // Pick the source plan. Priority:
  //   1. The estimate explicitly chosen via planSourceId (from the modal).
  //   2. The most-recent picked estimate's plan.
  //   3. Default 30/30/30/10.
  const sourceEst = list.find((e) => e.id === planSourceId) || list[list.length - 1];
  const sourcePlan = Array.isArray(sourceEst?.payment_plan) && sourceEst.payment_plan.length > 0
    ? sourceEst.payment_plan
    : DEFAULT_PAYMENT_PLAN_TEMPLATE;
  const scaledPlan = scalePlanToTotal(sourcePlan, mergedTotal);

  // Use the latest picked estimate as the "carrier" — the id/number we
  // keep so DB writes (mark approved, etc.) still target a real row.
  const carrier = list[list.length - 1];
  const estimate = {
    ...carrier,
    sections: mergedSections,
    total_amount: mergedTotal,
    payment_plan: scaledPlan,
    picked_estimate_ids: list.map((e) => e.id),
    picked_count: list.length,
  };

  return { estimate, mergedTotal, scaledPlan, plansDiffer, planFingerprints };
}

// Stable default for new payment plans — moved to module scope so
// buildPickedEstimate can reach it without depending on component state.
const DEFAULT_PAYMENT_PLAN_TEMPLATE = [
  { label: 'Deposit',         percent: 30 },
  { label: 'Upon start',      percent: 30 },
  { label: 'After painting',  percent: 30 },
  { label: 'Upon completion', percent: 10 },
];

const STEPS = [
  { id: 1, label: 'Review Estimate' },
  { id: 2, label: 'Select Estimates' },
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

  // Step 2 (Estimate Picker) — replaces the old Payment Plan editor.
  // Attila selects WHICH approved/signed estimates feed the contract;
  // the math is derived from those rows. Picker is always shown so we
  // get an explicit confirmation, even when there's only one estimate.
  const [approvedEstimates, setApprovedEstimates] = useState([]); // list of estimate rows shown in the picker
  const [pickedEstimateIds, setPickedEstimateIds] = useState([]); // currently checked
  const [planSourceEstimateId, setPlanSourceEstimateId] = useState(null); // when plans differ, which plan to use
  const [showPlanChooserModal, setShowPlanChooserModal] = useState(false);
  const [showPickerConfirm, setShowPickerConfirm] = useState(false);

  // Step 5 — per-milestone invoicing.
  const [milestones, setMilestones] = useState([]);
  const [loadingMilestones, setLoadingMilestones] = useState(false);
  const [sendingMilestoneId, setSendingMilestoneId] = useState(null);
  const [confirmResendId, setConfirmResendId] = useState(null);
  const [companySettings, setCompanySettings] = useState(null);
  // Off-screen InvoiceTemplate rendered into this ref while we run html2pdf.
  const invoiceRef = useRef(null);
  const [pendingInvoiceMilestone, setPendingInvoiceMilestone] = useState(null);

  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [job?.id]);

  async function loadData() {
    setLoading(true);
    try {
      // ─── 1. Pull all non-rejected estimates for the job ─────────
      // We pull EVERY non-rejected estimate (draft/sent/approved/signed/
      // changes_requested). The picker UI later filters to show only
      // the ones that have been approved/signed by the customer — the
      // others stay loaded so Step 1 can still surface the latest one.
      const { data: allEstimates } = await supabase
        .from('estimates')
        .select('*')
        .eq('job_id', job.id)
        .neq('status', 'rejected')
        .order('created_at', { ascending: true });
      const list = allEstimates || [];
      // Picker source — only show estimates the client has approved
      // or signed. These are the candidates Attila can include in a
      // contract. Drafts and sent-but-not-yet-approved stay off the
      // picker so they don't pollute the math.
      const approved = list.filter((e) => e.status === 'approved' || e.status === 'signed' || e.signed_at);
      setApprovedEstimates(approved);

      // ─── 2. Load the existing contract (if any) ─────────────────
      const { data: rawCtr } = await supabase
        .from('contracts').select('*').eq('job_id', job.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      let ctr = rawCtr;
      setContract(ctr || null);

      // ─── 3. Decide which estimates are PICKED ────────────────────
      // Priority:
      //   a) Contract has `estimate_ids` (new column from migration 060)
      //   b) Contract has legacy `estimate_id` (single) — wrap as [id]
      //   c) The most recent approved estimate (sensible default)
      // The picker UI lets Attila change this selection at Step 2.
      let pickedIds = [];
      if (Array.isArray(ctr?.estimate_ids) && ctr.estimate_ids.length > 0) {
        pickedIds = ctr.estimate_ids.filter((id) => approved.some((e) => e.id === id));
      } else if (ctr?.estimate_id) {
        pickedIds = approved.some((e) => e.id === ctr.estimate_id) ? [ctr.estimate_id] : [];
      }
      if (pickedIds.length === 0 && approved.length > 0) {
        pickedIds = [approved[approved.length - 1].id];
      }
      setPickedEstimateIds(pickedIds);

      // Choose default plan source — the most recent of the picked
      // estimates. The plan-chooser modal in the picker UI lets Attila
      // override this when the picked estimates have different plans.
      const defaultPlanSource = pickedIds.length > 0 ? pickedIds[pickedIds.length - 1] : null;
      setPlanSourceEstimateId(defaultPlanSource);

      // ─── 4. Build the merged virtual estimate ────────────────────
      const { estimate: pickedEstimate, scaledPlan } = buildPickedEstimate({
        estimates: approved,
        pickedIds,
        planSourceId: defaultPlanSource,
      });

      // If the picker produced nothing (no approved estimates yet),
      // fall back to the most recent estimate of any status so Step 1
      // still has something to render.
      const est = pickedEstimate || (list.length ? list[list.length - 1] : null);
      setEstimate(est);

      // ─── 5. Payment plan in state ────────────────────────────────
      // Priority: scaled plan from picker → estimate.payment_plan →
      // contract.payment_plan → parse customer_message → empty.
      if (Array.isArray(scaledPlan) && scaledPlan.length > 0) {
        setPaymentPlan(scaledPlan);
      } else if (Array.isArray(est?.payment_plan) && est.payment_plan.length > 0) {
        setPaymentPlan(est.payment_plan);
      } else if (Array.isArray(ctr?.payment_plan) && ctr.payment_plan.length > 0) {
        setPaymentPlan(ctr.payment_plan);
      } else {
        const parsed = parsePlanFromMessage(est?.customer_message);
        if (parsed.length > 0) setPaymentPlan(parsed);
      }

      // ─── 6. Step routing ─────────────────────────────────────────
      // signed contract  → step 5 (Invoice & Deposit)
      // sent  contract   → step 4 (Awaiting Signature)
      // draft contract   → step 3 (Generate Contract)
      // approved estimate → step 2 (Select Estimates) — skips Step 1
      // anything else    → step 1 (Review Estimate)
      if (ctr?.signed_at) setStep(5);
      else if (ctr?.status === 'sent' || ctr?.docusign_envelope_id) setStep(4);
      else if (ctr) setStep(3);
      else if (est?.approved_at || est?.signed_at || est?.status === 'approved' || est?.status === 'signed') setStep(2);
      else setStep(1);

      // Step 5 prep — milestones + company info, only if signed.
      if (ctr?.signed_at) await loadMilestonesAndCompany(ctr);

      // Pipeline promotion when the user first opens an existing estimate.
      if (est && (!job.pipeline_status || job.pipeline_status === 'new_lead')) {
        await setJobPipeline('estimate_draft');
      }

      // Informational toast when the contract is rendering off a
      // multi-estimate selection — keeps the seller aware of the merge.
      if (pickedIds.length > 1) {
        setToast({
          type: 'info',
          message: `${pickedIds.length} estimates feed this contract — total $${(pickedEstimate?.total_amount || 0).toLocaleString()}.`,
        });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load estimate data' });
    } finally {
      setLoading(false);
    }
  }

  // Re-derive merged estimate + plan whenever the user changes the
  // picker selection. Pure UI state — no DB writes; the contract gets
  // updated on the explicit "Continue to Contract" click in Step 2.
  function rebuildFromPicked(nextPickedIds, nextPlanSourceId) {
    const sourceId = nextPlanSourceId !== undefined ? nextPlanSourceId : planSourceEstimateId;
    const { estimate: pickedEstimate, scaledPlan } = buildPickedEstimate({
      estimates: approvedEstimates,
      pickedIds: nextPickedIds,
      planSourceId: sourceId,
    });
    setEstimate(pickedEstimate);
    setPaymentPlan(scaledPlan || []);
  }

  // ─── Step 5 helpers ──────────────────────────────────────────────
  // Materializes payment_milestones from contract.payment_plan if they
  // don't exist yet (idempotent) and reloads the rows + the company
  // info used by the InvoiceTemplate.
  async function loadMilestonesAndCompany(ctr) {
    if (!ctr?.id) return;
    setLoadingMilestones(true);
    try {
      try { await ensureMilestonesForContract(ctr); } catch { /* non-fatal */ }
      const [{ data: ms }, { data: comp }] = await Promise.all([
        supabase.from('payment_milestones').select('*').eq('contract_id', ctr.id).order('order_idx', { ascending: true }),
        supabase.from('company_settings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      setMilestones(ms || []);
      setCompanySettings(comp || null);
    } finally {
      setLoadingMilestones(false);
    }
  }

  async function refreshMilestones() {
    if (!contract?.id) return;
    const { data } = await supabase
      .from('payment_milestones')
      .select('*')
      .eq('contract_id', contract.id)
      .order('order_idx', { ascending: true });
    const next = data || [];
    setMilestones(next);
    // If everything has been received → flag the job as completed and
    // notify the team. Idempotent on `pipeline_status` so a Brenda
    // mistake-then-undo doesn't spam.
    const allPaid = next.length > 0 && next.every((m) => m.status === 'paid');
    if (allPaid && job.pipeline_status !== 'completed') {
      try {
        await supabase.from('jobs').update({ pipeline_status: 'completed' }).eq('id', job.id);
        logAudit({ user, action: 'pipeline.complete', entityType: 'job', entityId: job.id, details: { reason: 'all_milestones_paid' } });
        notify({ recipientRole: 'owner',      title: 'Job completed', message: `${job.client_name || 'Client'} — all installments received.`, type: 'finance', jobId: job.id });
        notify({ recipientRole: 'operations', title: 'Job completed', message: `${job.client_name || 'Client'} — final installment received.`, type: 'finance', jobId: job.id });
        notify({ recipientRole: 'sales',      title: 'Job completed', message: `${job.client_name || 'Your client'} — project closed and fully paid. 🎉`, type: 'finance', jobId: job.id });
      } catch { /* non-fatal */ }
    }
  }

  async function updateMilestoneDueDate(milestoneId, due_date) {
    try {
      const { error } = await supabase
        .from('payment_milestones')
        .update({ due_date: due_date || null, updated_at: new Date().toISOString() })
        .eq('id', milestoneId);
      if (error) throw error;
      setMilestones((prev) => prev.map((m) => m.id === milestoneId ? { ...m, due_date: due_date || null } : m));
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Could not save due date' });
    }
  }

  // Lazy-load html2pdf from CDN — same approach as ContractTemplate.
  async function loadHtml2Pdf() {
    if (window.html2pdf) return window.html2pdf;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = () => resolve(window.html2pdf);
      s.onerror = () => reject(new Error('Could not load html2pdf.js from CDN'));
      document.head.appendChild(s);
    });
  }

  async function generateInvoicePdfBlob(milestone) {
    setPendingInvoiceMilestone(milestone);
    // Two animation frames + a small grace period so React commits the
    // hidden render and the browser settles layout before html2pdf
    // measures it. Same pattern as resendTestEnvelope.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 80));

    const node = invoiceRef.current;
    if (!node) {
      setPendingInvoiceMilestone(null);
      throw new Error('Invoice template did not mount — try again in a second.');
    }
    const html2pdf = await loadHtml2Pdf();
    const blob = await html2pdf()
      .set({
        margin: [0.5, 0.5, 0.6, 0.5],
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      })
      .from(node)
      .outputPdf('blob');

    setPendingInvoiceMilestone(null);
    return blob;
  }

  async function handleSendMilestoneInvoice(milestone, isResend = false) {
    if (!perms.canSendInvoice) {
      setToast({ type: 'warning', message: 'Only Operations or Owner can send invoices' });
      return;
    }
    if (!job.client_email) {
      setToast({ type: 'error', message: 'Client has no email on file — add one in the job card.' });
      return;
    }
    if (!milestone.due_date && !isResend) {
      setToast({ type: 'warning', message: 'Set a due date for this installment first.' });
      return;
    }
    setSendingMilestoneId(milestone.id);
    try {
      const blob = await generateInvoicePdfBlob(milestone);
      const safeClient = (job.client_name || 'client').replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
      const safeLabel  = (milestone.label || `installment-${milestone.order_idx + 1}`).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
      const filename   = `invoice-${safeClient}-${safeLabel}-${Date.now()}.pdf`;
      const path       = `${job.id}/invoices/${filename}`;

      const { error: upErr } = await supabase.storage
        .from('job-documents')
        .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('job-documents').getPublicUrl(path);
      const pdfUrl = pub?.publicUrl;
      if (!pdfUrl) throw new Error('Could not get public URL for the uploaded invoice.');

      // job_documents row only on first send so we don't pile up
      // duplicates on every resend.
      let docId = milestone.invoice_doc_id || null;
      if (!docId) {
        const { data: doc, error: docErr } = await supabase
          .from('job_documents')
          .insert([{
            job_id: job.id,
            folder: 'invoices',
            title: `Invoice — ${milestone.label || `Installment ${milestone.order_idx + 1}`}`,
            photo_url: pdfUrl,
            uploaded_by: user?.name || null,
          }])
          .select().single();
        if (docErr) throw docErr;
        docId = doc.id;
      }

      const r = await fetch('/api/send-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Omega-Role': user?.role || '',
          'X-Omega-User': user?.name || '',
        },
        body: JSON.stringify({ milestoneId: milestone.id, pdfUrl, docId, isResend }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error || `Send failed (HTTP ${r.status})`);

      logAudit({
        user,
        action: isResend ? 'invoice.resent' : 'invoice.sent',
        entityType: 'payment_milestone',
        entityId: milestone.id,
        details: { jobId: job.id, milestoneLabel: milestone.label, amount: milestone.due_amount, docId },
      });
      setToast({ type: 'success', message: isResend ? 'Invoice re-sent to client' : 'Invoice sent to client' });
      await refreshMilestones();
      setConfirmResendId(null);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send invoice' });
    } finally {
      setSendingMilestoneId(null);
    }
  }

  async function handleMarkMilestoneReceived(milestone) {
    if (!perms.canSendInvoice) {
      setToast({ type: 'warning', message: 'Only Operations or Owner can mark received' });
      return;
    }
    const remaining = Number(milestone.due_amount || 0) - Number(milestone.received_amount || 0);
    if (remaining <= 0) return;
    try {
      await markMilestoneReceived(milestone.id, {
        amount: remaining,
        date: new Date().toISOString(),
        user,
      });
      setToast({ type: 'success', message: 'Marked as received' });
      await refreshMilestones();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Could not mark as received' });
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
    notify({ recipientRole: 'sales', title: 'Estimate approved', message: `${job.client_name || 'Your client'} approved the estimate — $${Number(data.total_amount || 0).toLocaleString()}. Operations will follow up with the contract.`, type: 'estimate', jobId: job.id });
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

  // Picker-flow Continue handler. Persists the picked plan into the
  // carrier estimate's `payment_plan` column (so a reload doesn't lose
  // the scaling we just applied) and advances to Step 3. The picker
  // already showed an explicit math-check modal before getting here.
  async function confirmPickerAndContinue() {
    if (!estimate) {
      setToast({ type: 'error', message: 'No estimate selected.' });
      return;
    }
    setSaving(true);
    try {
      // Best-effort persistence — failure here is non-fatal because
      // the state in memory still drives the next steps. If the user
      // refreshes before sending, loadData re-applies buildPickedEstimate.
      try {
        await supabase
          .from('estimates')
          .update({ payment_plan: paymentPlan })
          .eq('id', estimate.id);
      } catch { /* tolerated */ }
      setShowPickerConfirm(false);
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function generateAndSendContract(contractHtml) {
    if (!perms.canSendContract) { setToast({ type: 'warning', message: 'You do not have permission to send contracts' }); return; }
    if (!contractHtml) { setToast({ type: 'error', message: 'Could not snapshot the contract — please reload and try again.' }); return; }
    setSaving(true);
    try {
      // Snapshot which estimates Attila picked at the time of sending.
      // The migration 060 column `estimate_ids` records this on the
      // contract row so we can later re-render Schedule A from the same
      // picks even after the user edits the estimates.
      const pickedIdsForContract = pickedEstimateIds.length > 0
        ? pickedEstimateIds
        : (estimate?.id ? [estimate.id] : []);
      const contractInsertBase = {
        job_id: job.id,
        estimate_id: estimate?.id || null,
        status: 'draft',
        payment_plan: paymentPlan,
        total_amount: estimate?.total_amount || null,
        deposit_amount: paymentPlan[0] && estimate?.total_amount
          ? Math.round((Number(paymentPlan[0].percent) / 100) * Number(estimate.total_amount) * 100) / 100
          : null,
        created_by: user?.id || null,
      };
      const contractInsertWithPicks = { ...contractInsertBase, estimate_ids: pickedIdsForContract };

      // First try with the new estimate_ids column; if the migration
      // hasn't been applied yet (PGRST204 missing column), fall back
      // to the legacy shape so the send doesn't break.
      let { data: created, error: insErr } = await supabase
        .from('contracts').insert([contractInsertWithPicks]).select().single();
      if (insErr && /estimate_ids/i.test(insErr.message || '')) {
        const retry = await supabase.from('contracts').insert([contractInsertBase]).select().single();
        created = retry.data;
        insErr = retry.error;
      }
      if (insErr) throw insErr;

      const { envelopeId } = await createEnvelope({ contractId: created.id, job, estimate, paymentPlan, html: contractHtml });

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

  // Test convenience: re-issue the envelope from the Awaiting Signature
  // step without walking the full Review→Approve→PaymentPlan wizard
  // again. Switches to step 3 so ContractTemplate mounts, waits a beat
  // for layout, then serializes the freshly-rendered DOM and creates a
  // brand-new envelope (DB row + DocuSign send) via the same code path
  // the regular Send button uses.
  async function resendTestEnvelope() {
    if (!perms.canSendContract) {
      setToast({ type: 'warning', message: 'You do not have permission to send contracts' });
      return;
    }
    // SAFETY: do NOT auto-send. The button used to snapshot the
    // contract DOM and ship the envelope immediately, which was
    // dangerous when the seller needed to verify a fresh clause was
    // present. Now we just rewind to step 3 so Attila can read the
    // template, confirm the changes are there, and hit the explicit
    // "Send via DocuSign" button when ready.
    setStep(3);
    setToast({
      type: 'info',
      message: 'Review the updated contract below. When ready, click "Send via DocuSign" to issue a new envelope.',
    });
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
          await loadMilestonesAndCompany(data);
          logAudit({ user, action: 'contract.sign', entityType: 'contract', entityId: data.id, details: { job_id: job.id } });
          notify({ recipientRole: 'owner', title: 'Contract signed', message: `${job.client_name || 'Client'} signed — $${Number(data.total_amount || 0).toLocaleString()}`, type: 'contract', jobId: job.id });
          notify({ recipientRole: 'operations', title: 'Contract signed', message: `${job.client_name || 'Client'} — deposit invoice is next.`, type: 'contract', jobId: job.id });
          notify({ recipientRole: 'sales', title: 'Contract signed', message: `Your client ${job.client_name || ''} signed the contract.`, type: 'contract', jobId: job.id });
          // Save signed PDF to Documents → Contracts (fire-and-forget)
          if (contract?.docusign_envelope_id) {
            fetch('/api/docusign/save-signed-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contractId: contract.id, envelopeId: contract.docusign_envelope_id, jobId: job.id }),
            }).catch(() => {});
          }
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

        {/* STEP 2 — Select Estimates (replaces old Payment Plan editor) */}
        {step === 2 && (
          <EstimatePicker
            approvedEstimates={approvedEstimates}
            pickedEstimateIds={pickedEstimateIds}
            planSourceEstimateId={planSourceEstimateId}
            onTogglePick={(id, checked) => {
              const next = checked
                ? Array.from(new Set([...pickedEstimateIds, id]))
                : pickedEstimateIds.filter((x) => x !== id);
              setPickedEstimateIds(next);
              // If we removed the plan-source estimate, fall back to
              // whatever's still picked (the latest of them).
              const nextPlanSource = next.includes(planSourceEstimateId)
                ? planSourceEstimateId
                : (next[next.length - 1] || null);
              if (nextPlanSource !== planSourceEstimateId) setPlanSourceEstimateId(nextPlanSource);
              rebuildFromPicked(next, nextPlanSource);
            }}
            onPickPlanSource={(id) => {
              setPlanSourceEstimateId(id);
              rebuildFromPicked(pickedEstimateIds, id);
            }}
            onContinue={() => {
              // Check 1 of 3: explicit confirmation modal with the math.
              setShowPickerConfirm(true);
            }}
            onBack={() => setStep(1)}
            saving={saving}
          />
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

                {perms.canSendContract && (
                  <button
                    onClick={resendTestEnvelope}
                    disabled={saving}
                    title="Go back to the contract template so you can review the latest changes BEFORE sending a fresh DocuSign envelope."
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-omega-orange/40 hover:border-omega-orange text-sm font-semibold text-omega-orange hover:bg-omega-pale transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FileText className="w-4 h-4" /> Review &amp; Re-send
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
          <Step5Invoices
            contract={contract}
            job={job}
            user={user}
            perms={perms}
            milestones={milestones}
            loading={loadingMilestones}
            sendingMilestoneId={sendingMilestoneId}
            confirmResendId={confirmResendId}
            onConfirmResendChange={setConfirmResendId}
            onSend={handleSendMilestoneInvoice}
            onMarkReceived={handleMarkMilestoneReceived}
            onUpdateDueDate={updateMilestoneDueDate}
          />
        )}
      </div>

      {/* Off-screen InvoiceTemplate — html2pdf renders this DOM. */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', left: -10000, top: 0, opacity: 0, pointerEvents: 'none' }}
      >
        {pendingInvoiceMilestone && (
          <InvoiceTemplate
            ref={invoiceRef}
            job={job}
            estimate={estimate}
            contract={contract}
            company={companySettings}
            milestone={pendingInvoiceMilestone}
            installmentNumber={(milestones.findIndex((m) => m.id === pendingInvoiceMilestone.id) + 1) || 1}
            totalInstallments={milestones.length || 1}
          />
        )}
      </div>

      {showPickerConfirm && (
        <PickerConfirmModal
          approvedEstimates={approvedEstimates}
          pickedEstimateIds={pickedEstimateIds}
          total={(approvedEstimates || []).filter((e) => pickedEstimateIds.includes(e.id))
            .reduce((s, e) => s + (Number(e.total_amount) || 0), 0)}
          saving={saving}
          onClose={() => setShowPickerConfirm(false)}
          onConfirm={confirmPickerAndContinue}
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
              await loadMilestonesAndCompany(data);
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

// ─── Step 2 — Estimate Picker ──────────────────────────────────
// Replaces the old Payment Plan editor. Lists every approved/signed
// estimate for the job as a row of checkboxes. The total at the
// bottom updates live as boxes are toggled. When the picked set has
// MULTIPLE estimates with DIFFERENT payment-plan structures, a
// secondary "Plan source" radio appears so Attila tells the system
// which plan should drive the contract installments.
//
// Math check is enforced in 3 places — this picker shows the running
// total + a green/red consistency badge, an explicit confirmation
// modal pops on Continue, and Step 3 has a chip that re-validates.
function EstimatePicker({
  approvedEstimates,
  pickedEstimateIds,
  planSourceEstimateId,
  onTogglePick,
  onPickPlanSource,
  onContinue,
  onBack,
  saving,
}) {
  const picked = (approvedEstimates || []).filter((e) => pickedEstimateIds.includes(e.id));
  const total  = picked.reduce((s, e) => s + (Number(e.total_amount) || 0), 0);

  // Distinct plan fingerprints among the picked rows — when there's
  // more than one distinct shape we have to ask the user which to use.
  const planSet = new Set(picked.map((e) => planFingerprint(e.payment_plan)));
  const plansDiffer = picked.length > 1 && planSet.size > 1;

  if (!approvedEstimates || approvedEstimates.length === 0) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <h2 className="text-lg font-bold text-omega-charcoal">Select Estimates</h2>
        <p className="text-sm text-omega-stone mt-3">
          No approved estimates yet for this job. Once the customer signs an
          estimate the contract flow will pick up automatically here.
        </p>
        <button
          onClick={onBack}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Review
        </button>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-bold text-omega-charcoal mb-1">Select Estimates</h2>
      <p className="text-sm text-omega-stone mb-5">
        Pick which approved estimate(s) feed this contract. The Schedule A
        and total are derived from your selection.
      </p>

      <ul className="space-y-2">
        {approvedEstimates.map((e) => {
          const checked = pickedEstimateIds.includes(e.id);
          const tag = e.estimate_number ? `OM-${e.estimate_number}` : 'Estimate';
          const amount = Number(e.total_amount) || 0;
          return (
            <li key={e.id}>
              <label
                className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                  checked
                    ? 'border-omega-orange bg-omega-pale/40'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(ev) => onTogglePick(e.id, ev.target.checked)}
                  className="w-5 h-5 accent-omega-orange flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-omega-charcoal">
                    {tag}
                    {e.option_label && <span className="ml-2 text-xs text-omega-stone font-normal">({e.option_label})</span>}
                  </p>
                  <p className="text-xs text-omega-stone mt-0.5">
                    {e.status?.toUpperCase() || 'APPROVED'}
                    {e.signed_at && ` · signed ${new Date(e.signed_at).toLocaleDateString()}`}
                    {!e.signed_at && e.approved_at && ` · approved ${new Date(e.approved_at).toLocaleDateString()}`}
                  </p>
                </div>
                <span className="text-lg font-bold text-omega-charcoal tabular-nums whitespace-nowrap">
                  ${amount.toLocaleString()}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Plan-source picker — only shown when picked plans diverge */}
      {plansDiffer && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900 flex items-center gap-2">
            <Info className="w-4 h-4" /> These estimates use different payment plans
          </p>
          <p className="text-xs text-amber-900/80 mt-1 mb-3">
            Pick which plan structure to scale up to the combined total. Percents
            from the chosen plan are reapplied; the amounts get recomputed.
          </p>
          <div className="space-y-1.5">
            {picked.map((e) => {
              const tag = e.estimate_number ? `OM-${e.estimate_number}` : 'Estimate';
              const plan = Array.isArray(e.payment_plan) ? e.payment_plan : [];
              const summary = plan.length
                ? plan.map((p) => `${p.percent || 0}%`).join(' / ')
                : '(no plan)';
              return (
                <label key={e.id} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="plan-source"
                    checked={planSourceEstimateId === e.id}
                    onChange={() => onPickPlanSource(e.id)}
                    className="accent-omega-orange"
                  />
                  <span className="font-semibold text-omega-charcoal">{tag}</span>
                  <span className="text-omega-stone text-xs">— {summary}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Live total + math-check badge */}
      <div className="mt-6 border-t border-gray-200 pt-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase font-semibold text-omega-stone tracking-wider">Selected total</p>
          <p className="text-2xl font-bold text-omega-charcoal mt-0.5 tabular-nums">
            ${total.toLocaleString()}
            <span className="text-sm font-normal text-omega-stone ml-2">
              ({picked.length} of {approvedEstimates.length} estimate{approvedEstimates.length === 1 ? '' : 's'})
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="px-4 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal">
            Back
          </button>
          <button
            onClick={onContinue}
            disabled={saving || picked.length === 0}
            className="px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            Continue to Contract <ChevronRightIcon />
          </button>
        </div>
      </div>
    </section>
  );
}

// Tiny inline arrow — Lucide ChevronRight collides with existing import
// scopes elsewhere; defining a local SVG keeps the picker self-contained.
function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 5 5 5-5 5" />
    </svg>
  );
}

// ─── Math-check confirmation modal ─────────────────────────────
// Shown when the user clicks "Continue" in Step 2. Echoes the
// selected estimates back with their individual totals and the
// final sum, so Attila has to confirm the math BEFORE moving on.
// One of three math-check layers (modal + chip + send guard).
function PickerConfirmModal({ approvedEstimates, pickedEstimateIds, total, saving, onConfirm, onClose }) {
  const picked = (approvedEstimates || []).filter((e) => pickedEstimateIds.includes(e.id));
  if (!picked.length) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(ev) => ev.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-base font-bold text-omega-charcoal flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-omega-success" /> Confirm contract total
          </h3>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-omega-stone mb-3">
            Verify the math before generating the contract:
          </p>
          <ul className="space-y-1 mb-3">
            {picked.map((e) => {
              const tag = e.estimate_number ? `OM-${e.estimate_number}` : 'Estimate';
              return (
                <li key={e.id} className="flex justify-between text-sm">
                  <span className="text-omega-charcoal font-medium">{tag}</span>
                  <span className="text-omega-charcoal tabular-nums">${Number(e.total_amount || 0).toLocaleString()}</span>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-gray-200 pt-3 flex justify-between items-baseline">
            <span className="text-xs uppercase tracking-wider font-bold text-omega-stone">Total</span>
            <span className="text-2xl font-bold text-omega-charcoal tabular-nums">${total.toLocaleString()}</span>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-omega-charcoal hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm & Continue'}
          </button>
        </div>
      </div>
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

// ─── Step 5: Per-installment invoicing ───────────────────────────
// One row per `payment_milestones` entry. Each row gets:
//   * Editable due_date (Brenda must set this before sending).
//   * Send button — generates PDF (html2pdf), uploads, emails. Locks
//     to `Sent {date}` after the first click; a separate Resend
//     button (with double-click confirmation) sits next to it.
//   * Mark Received — full-amount mark for the common case; partial /
//     account selection still happens in the Finance area.
// When every row is `paid`, the parent flips pipeline_status to
// 'completed' and we show the celebration block instead of the list.
function Step5Invoices({
  contract, job, perms, milestones, loading,
  sendingMilestoneId, confirmResendId, onConfirmResendChange,
  onSend, onMarkReceived, onUpdateDueDate,
}) {
  const allPaid = milestones.length > 0 && milestones.every((m) => m.status === 'paid');
  const sentCount = milestones.filter((m) => !!m.invoice_sent_at).length;
  const paidCount = milestones.filter((m) => m.status === 'paid').length;

  if (!contract?.signed_at) {
    return (
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-omega-charcoal mb-4">Invoice & Deposit</h2>
        <p className="text-sm text-omega-warning">Contract must be signed before sending invoices.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-lg font-bold text-omega-charcoal">Invoice &amp; Deposit</h2>
        {milestones.length > 0 && (
          <p className="text-xs text-omega-stone">
            {sentCount} of {milestones.length} sent · {paidCount} of {milestones.length} received
          </p>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-lg bg-omega-cloud">
          <p className="text-xs text-omega-stone uppercase font-semibold">Contract Total</p>
          <p className="text-lg font-bold text-omega-charcoal mt-1">${Number(contract.total_amount || 0).toLocaleString()}</p>
        </div>
        <div className="p-4 rounded-lg bg-omega-cloud">
          <p className="text-xs text-omega-stone uppercase font-semibold">Signed</p>
          <p className="text-lg font-bold text-omega-charcoal mt-1">{new Date(contract.signed_at).toLocaleDateString()}</p>
        </div>
        <div className="p-4 rounded-lg bg-omega-cloud">
          <p className="text-xs text-omega-stone uppercase font-semibold">Installments</p>
          <p className="text-lg font-bold text-omega-charcoal mt-1">{milestones.length || '—'}</p>
        </div>
      </div>

      {!perms.canSendInvoice && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
          <Info className="w-4 h-4 text-blue-700 mt-0.5" />
          <p className="text-sm text-blue-900">Invoices are sent by the Operations team.</p>
        </div>
      )}

      {allPaid ? (
        <div className="rounded-2xl border-2 border-omega-success bg-green-50 p-8 flex flex-col items-center text-center gap-3">
          <PartyPopper className="w-12 h-12 text-omega-success" />
          <p className="text-xl font-bold text-omega-success">Job Completed</p>
          <p className="text-sm text-omega-slate max-w-md">
            All installments have been received. The job has been moved to <strong>Completed</strong> on the pipeline.
          </p>
        </div>
      ) : loading ? (
        <p className="text-sm text-omega-stone py-8 text-center">Loading installments…</p>
      ) : milestones.length === 0 ? (
        <p className="text-sm text-omega-warning py-8 text-center">
          No installments found yet. The DocuSign webhook materializes them on signing — try refreshing in a few seconds.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-omega-stone uppercase text-xs tracking-wider border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left w-10">#</th>
                <th className="px-3 py-2 text-left">Installment</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Due Date</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {milestones.map((m, idx) => (
                <MilestoneRow
                  key={m.id}
                  index={idx + 1}
                  milestone={m}
                  perms={perms}
                  isSending={sendingMilestoneId === m.id}
                  isConfirmingResend={confirmResendId === m.id}
                  onConfirmResendChange={onConfirmResendChange}
                  onSend={onSend}
                  onMarkReceived={onMarkReceived}
                  onUpdateDueDate={onUpdateDueDate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MilestoneRow({
  index, milestone, perms, isSending, isConfirmingResend,
  onConfirmResendChange, onSend, onMarkReceived, onUpdateDueDate,
}) {
  const status = effectiveStatus(milestone);
  const isFirst = index === 1;
  const sentAt = milestone.invoice_sent_at ? new Date(milestone.invoice_sent_at) : null;
  const remaining = Number(milestone.due_amount || 0) - Number(milestone.received_amount || 0);
  const isPaid = milestone.status === 'paid';
  const canSend = perms.canSendInvoice && !!milestone.due_date && !isSending && !isPaid;

  const statusPill = isPaid ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
      <CheckCircle2 className="w-3 h-3" /> Received
    </span>
  ) : milestone.status === 'partial' ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
      Partial
    </span>
  ) : status === 'overdue' ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-800 text-xs font-semibold">
      <AlertTriangle className="w-3 h-3" /> Overdue
    </span>
  ) : sentAt ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-semibold">
      Sent
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold">
      Pending
    </span>
  );

  return (
    <tr className="align-middle">
      <td className="px-3 py-3 text-omega-stone text-xs font-mono">{index}</td>
      <td className="px-3 py-3">
        <div className="font-semibold text-omega-charcoal">
          {milestone.label || `Installment ${index}`}
          {isFirst && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-omega-orange/10 text-omega-orange tracking-wider">Deposit</span>}
        </div>
        {sentAt && (
          <div className="text-xs text-omega-stone mt-0.5">
            Sent {sentAt.toLocaleDateString()}
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-right font-semibold text-omega-charcoal tabular-nums whitespace-nowrap">
        ${Number(milestone.due_amount || 0).toLocaleString()}
      </td>
      <td className="px-3 py-3">
        <input
          type="date"
          value={milestone.due_date || ''}
          onChange={(e) => onUpdateDueDate(milestone.id, e.target.value)}
          disabled={!perms.canSendInvoice || isPaid}
          className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-omega-orange disabled:bg-gray-50 disabled:text-omega-stone"
        />
      </td>
      <td className="px-3 py-3 text-center">{statusPill}</td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {/* Send / Sent display */}
          {sentAt ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-omega-success">
              <Check className="w-3.5 h-3.5" /> Sent
            </span>
          ) : (
            <button
              onClick={() => onSend(milestone, false)}
              disabled={!canSend}
              title={!milestone.due_date ? 'Set a due date first' : ''}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" /> {isSending ? 'Sending…' : 'Send'}
            </button>
          )}

          {/* Resend (only after a first send, with double-click confirm) */}
          {sentAt && perms.canSendInvoice && !isPaid && (
            isConfirmingResend ? (
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => onSend(milestone, true)}
                  disabled={isSending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-60"
                >
                  <RotateCw className="w-3.5 h-3.5" /> {isSending ? 'Resending…' : 'Confirm resend'}
                </button>
                <button
                  onClick={() => onConfirmResendChange(null)}
                  className="px-2 py-1.5 rounded-lg text-omega-stone hover:bg-gray-100 text-xs font-semibold"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => onConfirmResendChange(milestone.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-semibold"
                title="Re-send the invoice email to the client"
              >
                <RotateCw className="w-3.5 h-3.5" /> Resend
              </button>
            )
          )}

          {/* Received */}
          {isPaid ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-omega-success">
              <Check className="w-3.5 h-3.5" /> Received
            </span>
          ) : (
            <button
              onClick={() => onMarkReceived(milestone)}
              disabled={!perms.canSendInvoice || remaining <= 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-omega-success hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Received
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
