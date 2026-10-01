// Bills helpers — the companion to src/shared/lib/finance.js.
//
// Shape mirrors finance.js: pure JS, Supabase queries live here, UI
// components call these instead of hand-writing SQL. Reused by the
// Finance → Bills tab today and (planned) by the TV dashboard for
// Inácio's "upcoming / recently paid" strip.

import { supabase } from './supabase';

// ─── Static vocabulary ──────────────────────────────────────────────

export const BILL_CATEGORIES = [
  { key: 'rent',         label: 'Rent / Office'   },
  { key: 'utilities',    label: 'Utilities'       },
  { key: 'insurance',    label: 'Insurance'       },
  { key: 'software',     label: 'Software'        },
  { key: 'vehicle',      label: 'Vehicle'         },
  { key: 'marketing',    label: 'Marketing'       },
  { key: 'taxes',        label: 'Taxes'           },
  { key: 'professional', label: 'Professional'    },
  { key: 'supplies',     label: 'Office Supplies' },
  { key: 'other',        label: 'Other'           },
];

export function categoryLabel(key) {
  return BILL_CATEGORIES.find((c) => c.key === key)?.label || key;
}

export const RECURRENCES = [
  { key: 'weekly',    label: 'Weekly'    },
  { key: 'biweekly',  label: 'Bi-weekly' },
  { key: 'monthly',   label: 'Monthly'   },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'annual',    label: 'Annual'    },
];

// ─── Status (overdue is a projection, not persisted) ────────────────

export function billEffectiveStatus(bill, nowMs = Date.now()) {
  if (bill.status === 'paid' || bill.status === 'skipped') return bill.status;
  const dueMs = new Date(bill.due_date + 'T23:59:59').getTime();
  return nowMs > dueMs ? 'overdue' : 'pending';
}

export function daysUntilDue(bill, nowMs = Date.now()) {
  const due = new Date(bill.due_date);
  const now = new Date(nowMs);
  const d1 = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const d2 = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((d1 - d2) / (24 * 60 * 60 * 1000));
}

// ─── Due-date arithmetic ────────────────────────────────────────────
// Clamp a day-of-month to the actual last day of that month so monthly
// bills with due_day=31 land on Feb 28/29, Apr 30, etc. — not May 1.

function clampDay(year, monthIdx, wantedDay) {
  const lastDay = new Date(year, monthIdx + 1, 0).getDate();
  return Math.min(wantedDay, lastDay);
}

function toISODate(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

// Given a template, generate due dates from `fromDate` (inclusive)
// through `horizonMonths` from now. Returns ISO date strings.
export function nextDueDates(template, fromDate, horizonMonths = 6) {
  if (!template?.recurrence || !template.start_date) return [];
  const start = new Date(template.start_date + 'T00:00:00');
  const from  = new Date(fromDate + 'T00:00:00');
  const end   = template.end_date ? new Date(template.end_date + 'T00:00:00') : null;
  const horizon = new Date(from);
  horizon.setMonth(horizon.getMonth() + horizonMonths);

  const out = [];
  const cursor = new Date(start);

  // Advance up to and past `from`.
  while (cursor <= horizon && (!end || cursor <= end)) {
    if (cursor >= from) out.push(toISODate(cursor));
    advance(cursor, template);
    // Safety stop: never emit more than ~500 dates in one call.
    if (out.length > 500) break;
  }
  return out;
}

function advance(cursor, template) {
  switch (template.recurrence) {
    case 'weekly':
      cursor.setDate(cursor.getDate() + 7);
      break;
    case 'biweekly':
      cursor.setDate(cursor.getDate() + 14);
      break;
    case 'monthly': {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const wanted = template.due_day || cursor.getDate();
      cursor.setFullYear(y, m, clampDay(y, m, wanted));
      break;
    }
    case 'quarterly': {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 3;
      const wanted = template.due_day || cursor.getDate();
      cursor.setFullYear(y, m, clampDay(y, m, wanted));
      break;
    }
    case 'annual': {
      const y = cursor.getFullYear() + 1;
      const m = cursor.getMonth();
      const wanted = template.due_day || cursor.getDate();
      cursor.setFullYear(y, m, clampDay(y, m, wanted));
      break;
    }
    default:
      // Unknown recurrence — bail by jumping past horizon so the loop ends.
      cursor.setFullYear(cursor.getFullYear() + 100);
  }
}

// ─── Materialization ────────────────────────────────────────────────
// Insert any missing bill occurrences for one template, up to horizon.
// Idempotent: the unique (template_id, due_date) index prevents dupes
// even under race conditions.

export async function materializeTemplate(templateId, horizonMonths = 6) {
  const { data: tpl, error: tplErr } = await supabase
    .from('bill_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();
  if (tplErr) throw tplErr;
  if (!tpl || !tpl.active) return { materialized: 0 };

  const today = toISODate(new Date());
  const dueDates = nextDueDates(tpl, today, horizonMonths);
  if (dueDates.length === 0) return { materialized: 0 };

  const { data: existing } = await supabase
    .from('bills')
    .select('due_date')
    .eq('template_id', templateId);
  const have = new Set((existing || []).map((b) => b.due_date));

  const toInsert = dueDates
    .filter((d) => !have.has(d))
    .map((due) => ({
      template_id:  tpl.id,
      vendor_id:    tpl.vendor_id,
      label:        tpl.label,
      category:     tpl.category,
      due_date:     due,
      amount:       tpl.amount_mode === 'fixed' ? tpl.default_amount : null,
      amount_entered_at: tpl.amount_mode === 'fixed' ? new Date().toISOString() : null,
      status:       'pending',
    }));
  if (toInsert.length === 0) return { materialized: 0 };

  const { error } = await supabase.from('bills').insert(toInsert);
  if (error) {
    // Unique-violation on parallel materialize is harmless — the row
    // already exists. Anything else is a real error.
    if (error.code !== '23505') throw error;
  }
  return { materialized: toInsert.length };
}

export async function materializeAllActiveTemplates(horizonMonths = 6) {
  const { data: templates } = await supabase
    .from('bill_templates')
    .select('id')
    .eq('active', true);
  let total = 0;
  for (const t of templates || []) {
    try {
      const r = await materializeTemplate(t.id, horizonMonths);
      total += r.materialized || 0;
    } catch (err) {
      console.warn('[bills] materialize failed for template', t.id, err?.message);
    }
  }
  return { templates: templates?.length || 0, materialized: total };
}

// ─── Mutations ──────────────────────────────────────────────────────

export async function markBillPaid(billId, { paidAmount, paymentMethod }) {
  const { error } = await supabase
    .from('bills')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_amount: paidAmount,
      payment_method: paymentMethod || null,
    })
    .eq('id', billId);
  if (error) throw error;
}

export async function unmarkBillPaid(billId) {
  const { error } = await supabase
    .from('bills')
    .update({
      status: 'pending',
      paid_at: null,
      paid_amount: null,
      payment_method: null,
    })
    .eq('id', billId);
  if (error) throw error;
}

export async function skipBill(billId) {
  const { error } = await supabase
    .from('bills')
    .update({ status: 'skipped' })
    .eq('id', billId);
  if (error) throw error;
}

export async function setBillAmount(billId, amount) {
  const { error } = await supabase
    .from('bills')
    .update({
      amount,
      amount_entered_at: new Date().toISOString(),
    })
    .eq('id', billId);
  if (error) throw error;
}

export async function deleteBill(billId) {
  const { error } = await supabase.from('bills').delete().eq('id', billId);
  if (error) throw error;
}

// Delete a whole recurring series — the template + every bill from it
// that is NOT paid. Already-paid bills stay in history (their
// template_id becomes null via on-delete-set-null). Prevents the bug
// where deleting a single recurring bill was re-materialized on the
// next load.
export async function deleteTemplateAndFutureBills(templateId) {
  const { error: billsErr } = await supabase
    .from('bills')
    .delete()
    .eq('template_id', templateId)
    .neq('status', 'paid');
  if (billsErr) throw billsErr;
  const { error: tplErr } = await supabase
    .from('bill_templates')
    .delete()
    .eq('id', templateId);
  if (tplErr) throw tplErr;
}

// ─── Queries ────────────────────────────────────────────────────────

// Totals for the Company tab KPIs.
export async function loadBillsTotals(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const in30 = toISODate(new Date(nowMs + 30 * 24 * 60 * 60 * 1000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [upRes, paidRes] = await Promise.all([
    supabase.from('bills')
      .select('amount')
      .eq('status', 'pending')
      .lte('due_date', in30),
    supabase.from('bills')
      .select('paid_amount, amount')
      .eq('status', 'paid')
      .gte('paid_at', monthStart),
  ]);

  const bills_due_30d = (upRes.data || []).reduce(
    (sum, b) => sum + (Number(b.amount) || 0), 0,
  );
  const bills_paid_mtd = (paidRes.data || []).reduce(
    (sum, b) => sum + (Number(b.paid_amount) || Number(b.amount) || 0), 0,
  );
  return { bills_due_30d, bills_paid_mtd };
}

// Upcoming bills (for list + TV dashboard reuse). Includes overdue.
export async function loadUpcomingBills({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .in('status', ['pending'])
    .order('due_date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function loadRecentlyPaidBills({ limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function loadVendors({ activeOnly = true } = {}) {
  let q = supabase.from('vendors').select('*').order('name', { ascending: true });
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
