// finance.js — helpers shared by the Finance area, the DocuSign webhook
// and any other surface that touches payment_milestones / sub_payments.
//
// Why these tables vs. the contracts.payment_plan JSONB:
//   * The JSONB stays the SPEC (defined in EstimateFlow step 2 and used
//     by the contract PDF). It's stable and immutable once the customer
//     signs.
//   * The MUTABLE state — what was actually received, when, to which
//     account, partial vs full, audit trail — lives in the SQL tables.
//
// Status state machine (stored on rows):
//   pending → partial → paid
// "Overdue" is NEVER stored — it's derived at render time from
// (status === 'pending') AND (due_date < today − 3 days). Kept as a
// pure UI projection so we never need a cron just to flip flags.

import { supabase } from './supabase';
import { logAudit } from './audit';

const OVERDUE_GRACE_DAYS = 3;

// ─── Effective status (UI-only projection) ───────────────────────
export function effectiveStatus(m, today = new Date()) {
  if (!m) return 'pending';
  if (m.status === 'paid' || m.status === 'partial') return m.status;
  if (!m.due_date) return 'pending';
  const due = new Date(m.due_date);
  due.setHours(0, 0, 0, 0);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const daysPast = Math.floor((t - due) / (1000 * 60 * 60 * 24));
  if (daysPast > OVERDUE_GRACE_DAYS) return 'overdue';
  if (daysPast >= 0) return 'due_soon'; // due today or within grace
  return 'pending';
}

// Compute amount of a milestone from the JSONB shape — supports both
// explicit `amount` and `percent` of total.
export function milestoneAmount(item, totalAmount) {
  if (item == null) return 0;
  if (item.amount != null && item.amount !== '') return Number(item.amount) || 0;
  if (item.percent != null && totalAmount != null) {
    return (Number(totalAmount) || 0) * (Number(item.percent) || 0) / 100;
  }
  return 0;
}

// ─── Materialize milestones from a contract's payment_plan JSONB ──
// Idempotent: bails out (returns existing) if the contract already has
// milestone rows. Called from the DocuSign webhook on signing AND on
// demand from the Finance UI when an admin opens a card whose plan
// hasn't been materialized yet (legacy / test data).
export async function ensureMilestonesForContract(contract) {
  if (!contract?.id) throw new Error('contract is required');

  const { data: existing } = await supabase
    .from('payment_milestones')
    .select('id')
    .eq('contract_id', contract.id)
    .limit(1);
  if (existing && existing.length > 0) return { created: 0, alreadyExisted: true };

  const plan = Array.isArray(contract.payment_plan) ? contract.payment_plan : [];
  if (plan.length === 0) return { created: 0, alreadyExisted: false };

  const rows = plan.map((p, idx) => {
    const amount = milestoneAmount(p, contract.total_amount);
    const wasPaid = !!p.paid;
    return {
      contract_id: contract.id,
      job_id: contract.job_id || null,
      order_idx: idx,
      label: p.label || `Installment ${idx + 1}`,
      due_amount: amount,
      due_date: p.due_date || null,
      received_amount: wasPaid ? amount : 0,
      received_at: wasPaid ? (p.paid_at || new Date().toISOString()) : null,
      status: wasPaid ? 'paid' : 'pending',
    };
  });

  const { data, error } = await supabase
    .from('payment_milestones')
    .insert(rows)
    .select();
  if (error) throw error;
  return { created: data?.length || 0, alreadyExisted: false };
}

// ─── Mark a milestone as received (full or partial) ───────────────
// Adds `amount` to whatever was previously received (so multiple
// partial payments stack on the same milestone). Recomputes status.
// Always logs audit so finance changes are traceable.
export async function markMilestoneReceived(milestoneId, opts) {
  const { amount, date, accountId, notes, user } = opts || {};
  if (!milestoneId) throw new Error('milestoneId required');
  if (!(Number(amount) > 0)) throw new Error('amount must be > 0');

  const { data: m, error: getErr } = await supabase
    .from('payment_milestones')
    .select('*')
    .eq('id', milestoneId)
    .single();
  if (getErr || !m) throw getErr || new Error('Milestone not found');

  const prevReceived = Number(m.received_amount || 0);
  const newReceived = prevReceived + Number(amount);
  const due = Number(m.due_amount || 0);
  const newStatus = newReceived >= due ? 'paid' : 'partial';

  const noteAppend = notes
    ? `[${new Date().toISOString().slice(0, 10)}] +$${Number(amount).toFixed(2)} ${notes}`
    : null;
  const mergedNotes = noteAppend
    ? (m.notes ? `${m.notes}\n${noteAppend}` : noteAppend)
    : m.notes;

  const { data: updated, error: upErr } = await supabase
    .from('payment_milestones')
    .update({
      received_amount: newReceived,
      received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
      received_to_account_id: accountId || m.received_to_account_id || null,
      status: newStatus,
      notes: mergedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', milestoneId)
    .select()
    .single();
  if (upErr) throw upErr;

  logAudit({
    user,
    action: 'payment.received',
    entityType: 'payment_milestone',
    entityId: milestoneId,
    details: {
      amount: Number(amount),
      date,
      accountId,
      prevReceived,
      newReceived,
      due,
      newStatus,
      contractId: m.contract_id,
    },
  });

  return updated;
}

// ─── Reverse: mark a sub payment as paid (we're paying the sub) ───
export async function ensureSubPaymentsForAgreement(agreement) {
  if (!agreement?.id) throw new Error('agreement is required');

  const { data: existing } = await supabase
    .from('sub_payments')
    .select('id')
    .eq('agreement_id', agreement.id)
    .limit(1);
  if (existing && existing.length > 0) return { created: 0, alreadyExisted: true };

  const plan = Array.isArray(agreement.payment_plan) ? agreement.payment_plan : [];
  if (plan.length === 0) return { created: 0, alreadyExisted: false };

  // subcontractor_offers stores the agreed total in `their_estimate`.
  const total = Number(agreement.their_estimate || agreement.total_amount || 0);

  const rows = plan.map((p, idx) => {
    const amount = milestoneAmount(p, total);
    const wasPaid = !!p.paid;
    return {
      agreement_id: agreement.id,
      subcontractor_id: agreement.subcontractor_id || null,
      job_id: agreement.job_id || null,
      order_idx: idx,
      label: p.label || `Installment ${idx + 1}`,
      due_amount: amount,
      due_date: p.due_date || null,
      paid_amount: wasPaid ? amount : 0,
      paid_at: wasPaid ? (p.paid_at || new Date().toISOString()) : null,
      status: wasPaid ? 'paid' : 'pending',
    };
  });

  const { data, error } = await supabase
    .from('sub_payments')
    .insert(rows)
    .select();
  if (error) throw error;
  return { created: data?.length || 0, alreadyExisted: false };
}

export async function markSubPaymentPaid(paymentId, opts) {
  const { amount, date, accountId, notes, user } = opts || {};
  if (!paymentId) throw new Error('paymentId required');
  if (!(Number(amount) > 0)) throw new Error('amount must be > 0');

  const { data: p, error: getErr } = await supabase
    .from('sub_payments')
    .select('*')
    .eq('id', paymentId)
    .single();
  if (getErr || !p) throw getErr || new Error('Sub payment not found');

  const prevPaid = Number(p.paid_amount || 0);
  const newPaid = prevPaid + Number(amount);
  const due = Number(p.due_amount || 0);
  const newStatus = newPaid >= due ? 'paid' : 'partial';

  const noteAppend = notes
    ? `[${new Date().toISOString().slice(0, 10)}] +$${Number(amount).toFixed(2)} ${notes}`
    : null;
  const mergedNotes = noteAppend
    ? (p.notes ? `${p.notes}\n${noteAppend}` : noteAppend)
    : p.notes;

  const { data: updated, error: upErr } = await supabase
    .from('sub_payments')
    .update({
      paid_amount: newPaid,
      paid_at: date ? new Date(date).toISOString() : new Date().toISOString(),
      paid_from_account_id: accountId || p.paid_from_account_id || null,
      status: newStatus,
      notes: mergedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .select()
    .single();
  if (upErr) throw upErr;

  logAudit({
    user,
    action: 'sub_payment.paid',
    entityType: 'sub_payment',
    entityId: paymentId,
    details: {
      amount: Number(amount),
      date,
      accountId,
      prevPaid,
      newPaid,
      due,
      newStatus,
      agreementId: p.agreement_id,
    },
  });

  return updated;
}

// ─── Aggregates for dashboard / Company tab ───────────────────────
// Computed from the milestone tables — no QB integration yet.
export async function loadFinanceTotals() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon30 = new Date(today);
  horizon30.setDate(horizon30.getDate() + 30);

  const [{ data: milestones }, { data: subs }] = await Promise.all([
    supabase.from('payment_milestones').select('due_amount, received_amount, due_date, status, received_at'),
    supabase.from('sub_payments').select('due_amount, paid_amount, due_date, status, paid_at'),
  ]);

  const sumOpenIn30 = (rows, paidField) => (rows || []).reduce((s, r) => {
    if (r.status === 'paid') return s;
    const remaining = Number(r.due_amount || 0) - Number(r[paidField] || 0);
    if (remaining <= 0) return s;
    if (!r.due_date) return s;
    const d = new Date(r.due_date);
    return d <= horizon30 ? s + remaining : s;
  }, 0);

  const sumOverdue = (rows, paidField) => (rows || []).reduce((s, r) => {
    if (r.status === 'paid') return s;
    const remaining = Number(r.due_amount || 0) - Number(r[paidField] || 0);
    if (remaining <= 0) return s;
    if (!r.due_date) return s;
    const d = new Date(r.due_date);
    d.setHours(0, 0, 0, 0);
    const days = Math.floor((today - d) / (1000 * 60 * 60 * 24));
    return days > OVERDUE_GRACE_DAYS ? s + remaining : s;
  }, 0);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const sumThisMonth = (rows, paidField, dateField) => (rows || []).reduce((s, r) => {
    const v = Number(r[paidField] || 0);
    if (!r[dateField] || v <= 0) return s;
    const d = new Date(r[dateField]);
    return d >= monthStart ? s + v : s;
  }, 0);

  return {
    receivableNext30: sumOpenIn30(milestones, 'received_amount'),
    receivableOverdue: sumOverdue(milestones, 'received_amount'),
    receivedThisMonth: sumThisMonth(milestones, 'received_amount', 'received_at'),
    payableNext30: sumOpenIn30(subs, 'paid_amount'),
    payableOverdue: sumOverdue(subs, 'paid_amount'),
    paidThisMonth: sumThisMonth(subs, 'paid_amount', 'paid_at'),
  };
}
