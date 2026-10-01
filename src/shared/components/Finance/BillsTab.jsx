// BillsTab — Operations' operating bills: rent, utilities, software,
// insurance, taxes, etc. Supports one-time bills AND recurring (weekly,
// bi-weekly, monthly, quarterly, annual) with either fixed or variable
// amounts. Variable amounts show an "Enter amount" chip until Operations
// fills them in each period.
//
// Lives inside Finance for operations / owner / admin. Future reuse:
// the TV dashboard will consume loadUpcomingBills / loadRecentlyPaidBills
// from src/shared/lib/bills.js directly, without this UI.

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Save, X, Loader2, Search, Check, Clock,
  AlertTriangle, Repeat, Zap, CheckCircle2, Store, Paperclip, Calendar,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import {
  BILL_CATEGORIES, RECURRENCES, categoryLabel,
  billEffectiveStatus, daysUntilDue,
  materializeTemplate, materializeAllActiveTemplates,
  markBillPaid, unmarkBillPaid, skipBill, setBillAmount, deleteBill,
  deleteTemplateAndFutureBills,
  loadVendors,
} from '../../lib/bills';

// ─── Small format helpers ────────────────────────────────────────────

function money(n) {
  if (n == null || n === '') return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(s) {
  if (!s) return '—';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function todayISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

const STATUS_META = {
  pending:  { label: 'Pending',  tone: 'bg-gray-100 text-gray-700',       icon: Clock },
  overdue:  { label: 'Overdue',  tone: 'bg-red-50 text-red-700',           icon: AlertTriangle },
  paid:     { label: 'Paid',     tone: 'bg-emerald-50 text-emerald-700',   icon: CheckCircle2 },
  skipped:  { label: 'Skipped',  tone: 'bg-gray-100 text-gray-500',        icon: X },
};

// ─────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────

export default function BillsTab({ user }) {
  const [bills, setBills] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filter, setFilter] = useState('upcoming'); // upcoming | overdue | paid | all
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState(null);     // null | bill object | { __new: true, oneTime?: boolean }
  const [paying, setPaying]   = useState(null);     // bill being marked paid
  const [enteringAmount, setEnteringAmount] = useState(null); // bill with variable amount
  const [vendorsOpen, setVendorsOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      // Make sure every active template has its future occurrences
      // materialized before we read — covers cases where the cron
      // hasn't run yet or the user is loading the tab after a long gap.
      await materializeAllActiveTemplates(6).catch(() => {});

      const [billsRes, tplRes, vendorsRes] = await Promise.all([
        supabase.from('bills').select('*').order('due_date', { ascending: true }),
        supabase.from('bill_templates').select('*').order('created_at', { ascending: false }),
        loadVendors({ activeOnly: true }),
      ]);
      if (billsRes.error) throw billsRes.error;
      if (tplRes.error)   throw tplRes.error;
      setBills(billsRes.data || []);
      setTemplates(tplRes.data || []);
      setVendors(vendorsRes || []);
    } catch (err) {
      setError(err?.message || 'Failed to load bills.');
    } finally {
      setLoading(false);
    }
  }

  const vendorsById = useMemo(() => {
    const m = {};
    for (const v of vendors) m[v.id] = v;
    return m;
  }, [vendors]);

  // Enrich bills with effective status + search needle.
  const enriched = useMemo(() => {
    const now = Date.now();
    return bills.map((b) => ({
      ...b,
      _status: billEffectiveStatus(b, now),
      _vendorName: vendorsById[b.vendor_id]?.name || '',
      _daysUntil: daysUntilDue(b, now),
    }));
  }, [bills, vendorsById]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filter === 'upcoming') {
      list = list.filter((b) => b._status === 'pending');
    } else if (filter === 'overdue') {
      list = list.filter((b) => b._status === 'overdue');
    } else if (filter === 'paid') {
      list = list.filter((b) => b._status === 'paid');
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((b) =>
        (b.label || '').toLowerCase().includes(q) ||
        (b._vendorName || '').toLowerCase().includes(q) ||
        (b.category || '').toLowerCase().includes(q)
      );
    }
    if (filter === 'paid') {
      list = [...list].sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''));
    }
    return list;
  }, [enriched, filter, search]);

  // Counters for filter chips
  const counts = useMemo(() => ({
    upcoming: enriched.filter((b) => b._status === 'pending').length,
    overdue:  enriched.filter((b) => b._status === 'overdue').length,
    paid:     enriched.filter((b) => b._status === 'paid').length,
    all:      enriched.length,
  }), [enriched]);

  // ─── Actions ──────────────────────────────────────────────────────

  async function handleDelete(bill) {
    const isRecurring = bill.template_id != null;

    // One-time bill — straightforward delete.
    if (!isRecurring) {
      if (!confirm(`Delete this bill?\n\n${bill.label} — ${money(bill.amount)} due ${shortDate(bill.due_date)}`)) return;
      try {
        await deleteBill(bill.id);
        await logAudit({
          user,
          action: 'bill.delete', entityType: 'bill', entityId: bill.id,
          details: { label: bill.label, amount: bill.amount, due_date: bill.due_date },
        }).catch(() => {});
        loadAll();
      } catch (err) {
        alert(err?.message || 'Delete failed.');
      }
      return;
    }

    // Recurring bill — a plain delete would be instantly re-materialized
    // from the still-active template. Make the intent explicit: either
    // kill the whole series (template + every unpaid occurrence), or
    // bail. "Skip just this period" has its own button.
    const msg =
      `"${bill.label}" is a RECURRING bill.\n\n` +
      `OK will DELETE the entire series:\n` +
      `  • this bill\n` +
      `  • every future occurrence\n` +
      `  • the recurring template itself\n\n` +
      `Already-paid periods stay in history.\n\n` +
      `(To skip just this one period, click Skip instead.)`;
    if (!confirm(msg)) return;
    try {
      await deleteTemplateAndFutureBills(bill.template_id);
      await logAudit({
        user,
        action: 'bill_template.delete', entityType: 'bill_template', entityId: bill.template_id,
        details: { label: bill.label, triggered_from_bill: bill.id },
      }).catch(() => {});
      loadAll();
    } catch (err) {
      alert(err?.message || 'Delete failed.');
    }
  }

  async function handleDeleteTemplate(tpl) {
    const msg =
      `Delete the recurring bill "${tpl.label}"?\n\n` +
      `This removes the template AND every future occurrence that is not yet paid.\n` +
      `Already-paid periods stay in history.`;
    if (!confirm(msg)) return;
    try {
      await deleteTemplateAndFutureBills(tpl.id);
      await logAudit({
        user,
        action: 'bill_template.delete', entityType: 'bill_template', entityId: tpl.id,
        details: { label: tpl.label },
      }).catch(() => {});
      loadAll();
    } catch (err) {
      alert(err?.message || 'Delete failed.');
    }
  }

  async function handleSkip(bill) {
    if (!confirm(`Skip this bill?\n\n${bill.label} — ${shortDate(bill.due_date)}\n\nUse this when the vendor gave you a credit or the bill does not apply this period.`)) return;
    try {
      await skipBill(bill.id);
      await logAudit({
        user,
        action: 'bill.skip', entityType: 'bill', entityId: bill.id,
      }).catch(() => {});
      loadAll();
    } catch (err) {
      alert(err?.message || 'Skip failed.');
    }
  }

  async function handleUnpay(bill) {
    if (!confirm('Mark this bill as pending again?')) return;
    try {
      await unmarkBillPaid(bill.id);
      await logAudit({
        user,
        action: 'bill.unpay', entityType: 'bill', entityId: bill.id,
      }).catch(() => {});
      loadAll();
    } catch (err) {
      alert(err?.message || 'Unpay failed.');
    }
  }

  // ─── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-omega-stone" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { k: 'upcoming', label: 'Upcoming', count: counts.upcoming, color: 'omega-orange' },
            { k: 'overdue',  label: 'Overdue',  count: counts.overdue,  color: 'red-600' },
            { k: 'paid',     label: 'Paid',     count: counts.paid,     color: 'emerald-600' },
            { k: 'all',      label: 'All',      count: counts.all,      color: 'gray-600' },
          ].map(({ k, label, count }) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition ${
                filter === k
                  ? 'bg-omega-charcoal text-white border-omega-charcoal'
                  : 'bg-white text-omega-charcoal border-gray-200 hover:border-omega-orange'
              }`}
            >
              {label}
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 rounded-full text-[10px] font-bold ${
                filter === k ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700'
              }`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor, label…"
              className="pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:border-omega-orange focus:outline-none w-56"
            />
          </div>
          <button
            onClick={() => setVendorsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-sm font-semibold text-omega-charcoal"
          >
            <Store className="w-4 h-4" /> Vendors
            <span className="text-[11px] text-omega-stone">({vendors.length})</span>
          </button>
          <button
            onClick={() => setEditing({ __new: true, oneTime: true })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-sm font-semibold text-omega-charcoal"
          >
            <Zap className="w-4 h-4" /> New one-time bill
          </button>
          <button
            onClick={() => setEditing({ __new: true, oneTime: false })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark"
          >
            <Plus className="w-4 h-4" /> New recurring bill
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Bills list */}
      {filtered.length === 0 ? (
        <EmptyState filter={filter} onCreate={() => setEditing({ __new: true, oneTime: false })} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wider text-omega-stone font-bold">
                <th className="px-4 py-3">Bill</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((bill) => (
                <BillRow
                  key={bill.id}
                  bill={bill}
                  vendor={vendorsById[bill.vendor_id]}
                  onPay={() => setPaying(bill)}
                  onEnterAmount={() => setEnteringAmount(bill)}
                  onEdit={() => setEditing(bill)}
                  onSkip={() => handleSkip(bill)}
                  onUnpay={() => handleUnpay(bill)}
                  onDelete={() => handleDelete(bill)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recurring templates list — collapsed by default */}
      {templates.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <button
            onClick={() => setShowTemplates((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-omega-cloud transition text-left"
          >
            <div className="flex items-center gap-2">
              <Repeat className="w-4 h-4 text-omega-stone" />
              <span className="text-sm font-semibold text-omega-charcoal">
                Recurring templates ({templates.filter((t) => t.active).length} active)
              </span>
            </div>
            {showTemplates ? <ChevronUp className="w-4 h-4 text-omega-stone" /> : <ChevronDown className="w-4 h-4 text-omega-stone" />}
          </button>
          {showTemplates && (
            <table className="w-full text-sm border-t border-gray-200">
              <thead className="bg-omega-cloud">
                <tr className="text-left text-[11px] uppercase tracking-wider text-omega-stone font-bold">
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Recurrence</th>
                  <th className="px-4 py-2 text-right">Default amount</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-semibold text-omega-charcoal">{t.label}</td>
                    <td className="px-4 py-2 text-omega-stone">{vendorsById[t.vendor_id]?.name || '—'}</td>
                    <td className="px-4 py-2 text-omega-stone">
                      {RECURRENCES.find((r) => r.key === t.recurrence)?.label || t.recurrence}
                      {t.due_day ? ` · day ${t.due_day}` : ''}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-omega-charcoal">
                      {t.amount_mode === 'variable' ? <span className="text-amber-600 italic">varies</span> : money(t.default_amount)}
                    </td>
                    <td className="px-4 py-2">
                      {t.active ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold">Paused</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={async () => {
                          await supabase.from('bill_templates').update({ active: !t.active }).eq('id', t.id);
                          loadAll();
                        }}
                        className="text-xs text-omega-stone hover:text-omega-orange font-semibold mr-3"
                      >
                        {t.active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(t)}
                        className="text-omega-stone hover:text-red-600 align-middle"
                        title="Delete recurring bill"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modals */}
      {editing && (
        <BillFormModal
          user={user}
          bill={editing.__new ? null : editing}
          oneTime={editing.__new ? editing.oneTime : (editing.template_id == null)}
          vendors={vendors}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadAll(); }}
          onVendorsChange={loadAll}
        />
      )}

      {paying && (
        <PayBillModal
          bill={paying}
          user={user}
          onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); loadAll(); }}
        />
      )}

      {enteringAmount && (
        <EnterAmountModal
          bill={enteringAmount}
          user={user}
          onClose={() => setEnteringAmount(null)}
          onSaved={() => { setEnteringAmount(null); loadAll(); }}
        />
      )}

      {vendorsOpen && (
        <VendorsModal
          user={user}
          onClose={() => setVendorsOpen(false)}
          onChanged={() => { loadVendors({ activeOnly: true }).then(setVendors); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────

function BillRow({ bill, vendor, onPay, onEnterAmount, onEdit, onSkip, onUnpay, onDelete }) {
  const meta = STATUS_META[bill._status] || STATUS_META.pending;
  const Icon = meta.icon;

  const dueText = (() => {
    const d = bill._daysUntil;
    if (bill._status === 'paid')    return shortDate(bill.paid_at?.slice(0, 10)) + ' · paid';
    if (bill._status === 'skipped') return shortDate(bill.due_date) + ' · skipped';
    if (d === 0)      return `Today · ${shortDate(bill.due_date)}`;
    if (d === 1)      return `Tomorrow · ${shortDate(bill.due_date)}`;
    if (d > 1 && d <= 7) return `In ${d} days · ${shortDate(bill.due_date)}`;
    if (d < 0)        return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} late · ${shortDate(bill.due_date)}`;
    return shortDate(bill.due_date);
  })();

  const dueColor =
    bill._status === 'overdue' ? 'text-red-700 font-bold' :
    bill._status === 'paid'    ? 'text-emerald-700'       :
    bill._status === 'skipped' ? 'text-gray-400'          :
    bill._daysUntil <= 2       ? 'text-amber-700 font-semibold' :
    'text-omega-charcoal';

  const isRecurring = bill.template_id != null;
  const needsAmount = bill.amount == null && bill._status !== 'skipped';

  return (
    <tr className="border-t border-gray-100 hover:bg-omega-cloud/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {isRecurring
            ? <Repeat className="w-3.5 h-3.5 text-omega-stone flex-shrink-0" title="Recurring" />
            : <Zap    className="w-3.5 h-3.5 text-omega-stone flex-shrink-0" title="One-time" />}
          <span className="font-semibold text-omega-charcoal truncate">{bill.label}</span>
          {bill.attachment_url && (
            <a href={bill.attachment_url} target="_blank" rel="noopener noreferrer" title="View attachment">
              <Paperclip className="w-3.5 h-3.5 text-omega-stone hover:text-omega-orange" />
            </a>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-omega-stone">{vendor?.name || '—'}</td>
      <td className="px-4 py-3 text-omega-stone">{categoryLabel(bill.category)}</td>
      <td className={`px-4 py-3 ${dueColor}`}>{dueText}</td>
      <td className="px-4 py-3 text-right font-mono">
        {needsAmount ? (
          <button
            onClick={onEnterAmount}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold hover:bg-amber-100"
          >
            Enter amount →
          </button>
        ) : (
          <span className="text-omega-charcoal font-semibold">{money(bill.amount)}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${meta.tone}`}>
          <Icon className="w-3 h-3" /> {meta.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {bill._status === 'paid' ? (
          <button onClick={onUnpay} className="text-xs text-omega-stone hover:text-omega-orange font-semibold mr-2">
            Unpay
          </button>
        ) : bill._status !== 'skipped' ? (
          <>
            {!needsAmount && (
              <button
                onClick={onPay}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 mr-1"
              >
                <Check className="w-3 h-3" /> Mark paid
              </button>
            )}
            <button onClick={onSkip} className="text-xs text-omega-stone hover:text-omega-orange font-semibold mr-2">
              Skip
            </button>
          </>
        ) : null}
        <button onClick={onEdit} className="text-omega-stone hover:text-omega-orange mr-1" title="Edit">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="text-omega-stone hover:text-red-600" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────

function EmptyState({ filter, onCreate }) {
  const copy = {
    upcoming: { title: 'No upcoming bills', body: 'All caught up. Create a bill or wait for the next billing period.' },
    overdue:  { title: 'No overdue bills',  body: 'Nothing is past due. Nice.' },
    paid:     { title: 'No paid bills yet', body: 'Once you mark bills as paid they will show up here.' },
    all:      { title: 'No bills yet',      body: 'Start by adding a recurring bill like Rent or Electric — it will auto-create a row every period.' },
  }[filter];

  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-10 text-center">
      <Calendar className="w-8 h-8 text-omega-stone mx-auto mb-3 opacity-60" />
      <h3 className="text-lg font-bold text-omega-charcoal mb-1">{copy.title}</h3>
      <p className="text-sm text-omega-stone mb-4 max-w-md mx-auto">{copy.body}</p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark"
      >
        <Plus className="w-4 h-4" /> New bill
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BillFormModal — create / edit a bill (one-time) or template (recurring)
// ─────────────────────────────────────────────────────────────────────

function BillFormModal({ user, bill, oneTime, vendors, onClose, onSaved, onVendorsChange }) {
  const isNew  = !bill;
  const isTemplate = !oneTime; // recurring = template-based

  // Pre-load template if editing a recurring bill — we edit the TEMPLATE
  // not the single occurrence (editing a single occurrence of a recurring
  // bill is only for amount; use EnterAmountModal for that).
  const [tpl, setTpl] = useState(null);
  const [loadingTpl, setLoadingTpl] = useState(false);
  useEffect(() => {
    if (!isNew && isTemplate && bill?.template_id) {
      setLoadingTpl(true);
      supabase.from('bill_templates').select('*').eq('id', bill.template_id).maybeSingle()
        .then(({ data }) => { setTpl(data); setLoadingTpl(false); });
    }
  }, [bill, isNew, isTemplate]);

  const [form, setForm] = useState(() => {
    if (!isNew && !isTemplate) {
      // Editing a one-time bill
      return {
        vendor_id:   bill.vendor_id || '',
        label:       bill.label || '',
        category:    bill.category || 'other',
        amount_mode: bill.amount != null ? 'fixed' : 'variable',
        amount:      bill.amount != null ? String(bill.amount) : '',
        due_date:    bill.due_date || todayISO(),
        recurrence:  'monthly',
        due_day:     '',
        start_date:  todayISO(),
        end_date:    '',
        notes:       bill.notes || '',
      };
    }
    return {
      vendor_id:   '',
      label:       '',
      category:    'other',
      amount_mode: 'fixed',
      amount:      '',
      due_date:    todayISO(),
      recurrence:  'monthly',
      due_day:     String(new Date().getDate()),
      start_date:  todayISO(),
      end_date:    '',
      notes:       '',
    };
  });

  // Hydrate recurring form once the template loads.
  useEffect(() => {
    if (!tpl) return;
    setForm((f) => ({
      ...f,
      vendor_id:   tpl.vendor_id || '',
      label:       tpl.label,
      category:    tpl.category,
      amount_mode: tpl.amount_mode,
      amount:      tpl.default_amount != null ? String(tpl.default_amount) : '',
      recurrence:  tpl.recurrence,
      due_day:     tpl.due_day != null ? String(tpl.due_day) : '',
      start_date:  tpl.start_date,
      end_date:    tpl.end_date || '',
      notes:       tpl.notes || '',
    }));
  }, [tpl]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      if (!form.label.trim()) throw new Error('Label is required.');
      if (!form.category)     throw new Error('Category is required.');
      const amountNum = form.amount === '' ? null : Number(form.amount);
      if (form.amount_mode === 'fixed' && (amountNum == null || Number.isNaN(amountNum) || amountNum <= 0)) {
        throw new Error('Fixed bills need an amount.');
      }

      if (isTemplate) {
        const payload = {
          vendor_id:      form.vendor_id || null,
          label:          form.label.trim(),
          category:       form.category,
          amount_mode:    form.amount_mode,
          default_amount: amountNum,
          recurrence:     form.recurrence,
          due_day:        form.due_day === '' ? null : Number(form.due_day),
          start_date:     form.start_date,
          end_date:       form.end_date || null,
          notes:          form.notes || null,
        };
        let templateId;
        if (isNew) {
          const { data, error } = await supabase.from('bill_templates')
            .insert({ ...payload, created_by: user?.name || null })
            .select('id').single();
          if (error) throw error;
          templateId = data.id;
          await logAudit({
            user,
            action: 'bill_template.create', entityType: 'bill_template', entityId: templateId,
            details: payload,
          }).catch(() => {});
        } else {
          templateId = tpl.id;
          const { error } = await supabase.from('bill_templates').update(payload).eq('id', templateId);
          if (error) throw error;
          await logAudit({
            user,
            action: 'bill_template.update', entityType: 'bill_template', entityId: templateId,
            details: payload,
          }).catch(() => {});
        }
        // Materialize occurrences immediately so the user sees them right away.
        await materializeTemplate(templateId, 6).catch(() => {});
      } else {
        // One-time bill — write directly into `bills`.
        const payload = {
          vendor_id:         form.vendor_id || null,
          label:             form.label.trim(),
          category:          form.category,
          due_date:          form.due_date,
          amount:            form.amount_mode === 'fixed' ? amountNum : null,
          amount_entered_at: form.amount_mode === 'fixed' ? new Date().toISOString() : null,
          notes:             form.notes || null,
        };
        if (isNew) {
          const { data, error } = await supabase.from('bills')
            .insert({ ...payload, status: 'pending', created_by: user?.name || null })
            .select('id').single();
          if (error) throw error;
          await logAudit({
            user,
            action: 'bill.create', entityType: 'bill', entityId: data.id,
            details: payload,
          }).catch(() => {});
        } else {
          const { error } = await supabase.from('bills').update(payload).eq('id', bill.id);
          if (error) throw error;
          await logAudit({
            user,
            action: 'bill.update', entityType: 'bill', entityId: bill.id,
            details: payload,
          }).catch(() => {});
        }
      }
      onSaved();
    } catch (e) {
      setErr(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={isNew ? (isTemplate ? 'New recurring bill' : 'New one-time bill') : 'Edit bill'} onClose={onClose}>
      {loadingTpl ? (
        <div className="py-10 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-omega-stone" /></div>
      ) : (
        <div className="space-y-4">
          <FormRow label="Vendor">
            <div className="flex items-center gap-2">
              <select
                value={form.vendor_id}
                onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
              </select>
              <AddVendorInline onCreated={(v) => {
                setForm({ ...form, vendor_id: v.id });
                onVendorsChange?.();
              }} />
            </div>
          </FormRow>

          <FormRow label="Label">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder={isTemplate ? 'e.g. Office Rent' : 'e.g. Printer repair'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </FormRow>

          <div className="grid grid-cols-2 gap-4">
            <FormRow label="Category">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {BILL_CATEGORIES.map((c) => (<option key={c.key} value={c.key}>{c.label}</option>))}
              </select>
            </FormRow>

            <FormRow label="Amount">
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-omega-cloud rounded-lg p-0.5 border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, amount_mode: 'fixed' })}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold ${form.amount_mode === 'fixed' ? 'bg-omega-orange text-white' : 'text-omega-stone'}`}
                  >Fixed</button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, amount_mode: 'variable' })}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold ${form.amount_mode === 'variable' ? 'bg-omega-orange text-white' : 'text-omega-stone'}`}
                  >Varies</button>
                </div>
                <input
                  type="number" step="0.01" min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder={form.amount_mode === 'variable' ? 'Default (optional)' : '0.00'}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              {form.amount_mode === 'variable' && (
                <p className="text-[11px] text-omega-stone mt-1">
                  You'll fill in the real amount for each period before paying.
                </p>
              )}
            </FormRow>
          </div>

          {isTemplate ? (
            <div className="grid grid-cols-2 gap-4">
              <FormRow label="Repeats">
                <select
                  value={form.recurrence}
                  onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  {RECURRENCES.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
                </select>
              </FormRow>
              <FormRow label={
                form.recurrence === 'weekly' || form.recurrence === 'biweekly'
                  ? 'Day of week (0=Sun…6=Sat)'
                  : 'Day of month (1–31)'
              }>
                <input
                  type="number"
                  min={form.recurrence === 'weekly' || form.recurrence === 'biweekly' ? 0 : 1}
                  max={form.recurrence === 'weekly' || form.recurrence === 'biweekly' ? 6 : 31}
                  value={form.due_day}
                  onChange={(e) => setForm({ ...form, due_day: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </FormRow>
              <FormRow label="Start date">
                <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </FormRow>
              <FormRow label="End date (optional)">
                <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </FormRow>
            </div>
          ) : (
            <FormRow label="Due date">
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
            </FormRow>
          )}

          <FormRow label="Notes (optional)">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </FormRow>

          {err && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
              {err}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-omega-cloud">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-omega-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PayBillModal — confirm amount + optional payment method
// ─────────────────────────────────────────────────────────────────────

function PayBillModal({ bill, user, onClose, onSaved }) {
  const [amount, setAmount] = useState(bill.amount != null ? String(bill.amount) : '');
  const [method, setMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handlePay() {
    setSaving(true); setErr('');
    try {
      const amt = Number(amount);
      if (Number.isNaN(amt) || amt <= 0) throw new Error('Amount is required.');
      await markBillPaid(bill.id, { paidAmount: amt, paymentMethod: method || null });
      await logAudit({
        user,
        action: 'bill.pay', entityType: 'bill', entityId: bill.id,
        details: { amount: amt, method: method || null },
      }).catch(() => {});
      onSaved();
    } catch (e) {
      setErr(e?.message || 'Pay failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Mark paid — ${bill.label}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-omega-cloud rounded-xl p-3 text-sm">
          <div className="flex justify-between"><span className="text-omega-stone">Due</span><span className="font-semibold">{shortDate(bill.due_date)}</span></div>
          <div className="flex justify-between mt-1"><span className="text-omega-stone">Expected</span><span className="font-semibold font-mono">{money(bill.amount)}</span></div>
        </div>
        <FormRow label="Amount paid">
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" autoFocus/>
        </FormRow>
        <FormRow label="Payment method (optional)">
          <input value={method} onChange={(e) => setMethod(e.target.value)}
            placeholder="e.g. Check #1245, ACH, Visa …"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
        </FormRow>

        {err && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">{err}</div>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-omega-cloud">Cancel</button>
          <button onClick={handlePay} disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Confirm payment
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EnterAmountModal — quick inline edit for variable bills before paying
// ─────────────────────────────────────────────────────────────────────

function EnterAmountModal({ bill, user, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      const amt = Number(amount);
      if (Number.isNaN(amt) || amt <= 0) throw new Error('Amount is required.');
      await setBillAmount(bill.id, amt);
      await logAudit({
        user,
        action: 'bill.set_amount', entityType: 'bill', entityId: bill.id,
        details: { amount: amt },
      }).catch(() => {});
      onSaved();
    } catch (e) {
      setErr(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={`Enter amount — ${bill.label}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-omega-stone">
          This bill is variable — enter the actual amount for{' '}
          <strong className="text-omega-charcoal">{shortDate(bill.due_date)}</strong>.
        </p>
        <FormRow label="Amount">
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" autoFocus/>
        </FormRow>
        {err && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">{err}</div>}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-omega-cloud">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-omega-dark disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save amount
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VendorsModal — full CRUD for the reusable vendor list
// ─────────────────────────────────────────────────────────────────────

function VendorsModal({ user, onClose, onChanged }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('vendors').select('*').order('name', { ascending: true });
    setList(data || []);
    setLoading(false);
  }

  async function handleToggleActive(v) {
    await supabase.from('vendors').update({ active: !v.active }).eq('id', v.id);
    load(); onChanged?.();
  }

  async function handleDelete(v) {
    if (!confirm(`Delete vendor "${v.name}"? Bills already linked to it will keep its name.`)) return;
    await supabase.from('vendors').delete().eq('id', v.id);
    load(); onChanged?.();
  }

  return (
    <ModalShell title="Vendors" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-omega-stone">
            People and companies you pay bills to. Reused across bills + templates.
          </p>
          <button
            onClick={() => setEditing({ __new: true })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark"
          >
            <Plus className="w-4 h-4" /> New vendor
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-omega-stone" /></div>
        ) : list.length === 0 ? (
          <div className="py-10 text-center text-sm text-omega-stone">No vendors yet. Add your first one.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-omega-stone font-bold border-b border-gray-200">
                <th className="py-2">Name</th>
                <th className="py-2">Category hint</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id} className="border-b border-gray-100">
                  <td className="py-2 font-semibold text-omega-charcoal">{v.name}</td>
                  <td className="py-2 text-omega-stone">{v.category ? categoryLabel(v.category) : '—'}</td>
                  <td className="py-2">
                    {v.active
                      ? <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">Active</span>
                      : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold">Archived</span>}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(v)} className="text-omega-stone hover:text-omega-orange mr-2" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleToggleActive(v)} className="text-xs text-omega-stone hover:text-omega-orange font-semibold mr-2">
                      {v.active ? 'Archive' : 'Restore'}
                    </button>
                    <button onClick={() => handleDelete(v)} className="text-omega-stone hover:text-red-600" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && (
          <VendorEditModal
            vendor={editing.__new ? null : editing}
            user={user}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); load(); onChanged?.(); }}
          />
        )}
      </div>
    </ModalShell>
  );
}

function VendorEditModal({ vendor, user, onClose, onSaved }) {
  const [name, setName]       = useState(vendor?.name || '');
  const [category, setCategory] = useState(vendor?.category || '');
  const [notes, setNotes]     = useState(vendor?.notes || '');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      if (!name.trim()) throw new Error('Name is required.');
      const payload = {
        name: name.trim(),
        category: category || null,
        notes: notes || null,
      };
      if (vendor) {
        const { error } = await supabase.from('vendors').update(payload).eq('id', vendor.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('vendors').insert({ ...payload, created_by: user?.name || null });
        if (error) {
          if (error.code === '23505') throw new Error('A vendor with that name already exists.');
          throw error;
        }
      }
      onSaved();
    } catch (e) {
      setErr(e?.message || 'Save failed.');
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title={vendor ? 'Edit vendor' : 'New vendor'} onClose={onClose}>
      <div className="space-y-4">
        <FormRow label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Eversource"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" autoFocus/>
        </FormRow>
        <FormRow label="Category hint (optional)">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">—</option>
            {BILL_CATEGORIES.map((c) => (<option key={c.key} value={c.key}>{c.label}</option>))}
          </select>
        </FormRow>
        <FormRow label="Notes (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"/>
        </FormRow>
        {err && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">{err}</div>}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:bg-omega-cloud">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-omega-dark disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// Inline "+ Add vendor" button inside the BillFormModal
function AddVendorInline({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from('vendors').insert({ name: name.trim() }).select().single();
    setSaving(false);
    if (!error && data) {
      setName(''); setOpen(false);
      onCreated?.(data);
    } else if (error) {
      alert(error.message || 'Could not add vendor.');
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="px-2.5 py-2 rounded-lg border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-xs font-bold text-omega-charcoal whitespace-nowrap"
        title="Quick-add vendor">
        + New
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        className="w-32 border border-gray-200 rounded-lg px-2 py-2 text-xs" autoFocus/>
      <button type="button" onClick={handleAdd} disabled={saving || !name.trim()}
        className="px-2 py-2 rounded-lg bg-omega-orange text-white text-xs font-bold disabled:opacity-50">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button type="button" onClick={() => { setOpen(false); setName(''); }}
        className="px-2 py-2 rounded-lg border border-gray-200 text-xs">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared modal + form helpers
// ─────────────────────────────────────────────────────────────────────

function ModalShell({ title, children, onClose, wide = false }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-omega-charcoal">{title}</h2>
          <button onClick={onClose} className="text-omega-stone hover:text-omega-charcoal">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormRow({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-omega-stone uppercase tracking-wider mb-1.5">{label}</span>
      {children}
    </label>
  );
}
