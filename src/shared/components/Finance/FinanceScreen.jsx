// FinanceScreen — Brenda + Inácio + Admin only.
//
// Tabs:
//   Company  — internal financial overview (no QuickBooks). Print report.
//   Clients  — signed contracts + payment milestones. Full CRUD.
//   Subs     — subcontractor agreements + payments. Full CRUD.
//   Ghost    — private check ledger. Full CRUD (GhostAccountTab).
//
// QuickBooks is NOT integrated here. Brenda manages everything inside
// the app and prints a report to enter manually into QB.

import { useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Building2, Users, Wallet, X, Plus, Pencil, Save,
  Check, AlertTriangle, Clock, ArrowDownCircle, ArrowUpCircle, Loader2,
  Trash2, ChevronRight, Banknote, FileText, Receipt, Printer, RefreshCw,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  effectiveStatus, milestoneAmount, ensureMilestonesForContract,
  ensureSubPaymentsForAgreement, markMilestoneReceived, markSubPaymentPaid,
  loadFinanceTotals,
} from '../../lib/finance';
import { logAudit } from '../../lib/audit';
import GhostAccountTab from './GhostAccountTab';

const GHOST_TAB_ROLES = new Set(['owner', 'operations', 'admin']);

const ALL_TABS = [
  { id: 'company', label: 'Company',       icon: Building2     },
  { id: 'clients', label: 'Clients',       icon: Users         },
  { id: 'subs',    label: 'Subs',          icon: ArrowUpCircle },
  { id: 'ghost',   label: 'Ghost Account', icon: Receipt, ghostOnly: true },
];

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

// ─────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────

export default function FinanceScreen({ user }) {
  const [tab, setTab] = useState('clients');
  const [accounts, setAccounts] = useState([]);
  const [accountsOpen, setAccountsOpen] = useState(false);

  const TABS = useMemo(
    () => ALL_TABS.filter((t) => !t.ghostOnly || GHOST_TAB_ROLES.has(user?.role)),
    [user?.role],
  );

  useEffect(() => { loadAccounts(); }, []);

  async function loadAccounts() {
    const { data } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    setAccounts(data || []);
  }

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-omega-charcoal flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-omega-orange" /> Finance
            </h1>
            <p className="text-sm text-omega-stone mt-1">
              Control receivables, sub payments and print your QB report.
            </p>
          </div>
          <button
            onClick={() => setAccountsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-sm font-semibold text-omega-charcoal"
          >
            <Banknote className="w-4 h-4" /> Bank Accounts
            <span className="ml-1 text-[11px] text-omega-stone">({accounts.length})</span>
          </button>
        </div>

        <nav className="mt-5 flex gap-1 border-b border-gray-100 -mb-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-3 inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition ${
                tab === id
                  ? 'border-omega-orange text-omega-orange'
                  : 'border-transparent text-omega-stone hover:text-omega-charcoal'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="p-6 md:p-8">
        {tab === 'company' && <CompanyTab user={user} />}
        {tab === 'clients' && <ClientsTab user={user} accounts={accounts} />}
        {tab === 'subs'    && <SubsTab    user={user} accounts={accounts} />}
        {tab === 'ghost'   && GHOST_TAB_ROLES.has(user?.role) && <GhostAccountTab user={user} />}
      </div>

      {accountsOpen && (
        <BankAccountsModal
          user={user}
          accounts={accounts}
          onClose={() => setAccountsOpen(false)}
          onChanged={loadAccounts}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// COMPANY TAB — internal overview, no QuickBooks
// ─────────────────────────────────────────────────────────────────────

function CompanyTab({ user }) {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState(null);
  const [jobCosts, setJobCosts] = useState([]);
  const [ghostTotal, setGhostTotal] = useState(0);
  const [printing, setPrinting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [t, { data: costs }, { data: ghost }] = await Promise.all([
        loadFinanceTotals(),
        supabase.from('job_costs').select('estimated_revenue, material_cost, labor_cost, sub_cost, other_costs, amount_received, gross_margin_percent, job_id'),
        supabase.from('ghost_payments').select('amount, paid_at').is('deleted_at', null).gte('paid_at', monthStart.slice(0, 10)),
      ]);

      setTotals(t);
      setJobCosts(costs || []);
      setGhostTotal((ghost || []).reduce((s, g) => s + Number(g.amount || 0), 0));
    } finally {
      setLoading(false);
    }
  }

  const costStats = useMemo(() => {
    let totalRevenue = 0, totalCost = 0, totalReceived = 0;
    let profitable = 0, atRisk = 0, loss = 0;

    for (const c of jobCosts) {
      const rev = Number(c.estimated_revenue || 0);
      const cost = Number(c.material_cost || 0) + Number(c.labor_cost || 0) + Number(c.sub_cost || 0) + Number(c.other_costs || 0);
      const rec = Number(c.amount_received || 0);
      totalRevenue += rev;
      totalCost += cost;
      totalReceived += rec;

      const margin = rev > 0 ? ((rev - cost) / rev) * 100 : null;
      if (margin === null) { /* skip */ }
      else if (margin >= 15) profitable++;
      else if (margin >= 5) atRisk++;
      else loss++;
    }

    return { totalRevenue, totalCost, totalReceived, profitable, atRisk, loss, jobCount: jobCosts.length };
  }, [jobCosts]);

  async function printReport() {
    setPrinting(true);
    try {
      await openPrintReport();
    } finally {
      setPrinting(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard icon={ArrowDownCircle} tone="green"
          label="Receivable (30d)" value={money(totals.receivableNext30)}
          sub={`Overdue: ${money(totals.receivableOverdue)}`}
        />
        <SummaryCard icon={Check} tone="charcoal"
          label="Received MTD" value={money(totals.receivedThisMonth)}
        />
        <SummaryCard icon={ArrowUpCircle} tone="orange"
          label="Owed to Subs (30d)" value={money(totals.payableNext30)}
          sub={`Paid MTD: ${money(totals.paidThisMonth)}`}
        />
        <SummaryCard icon={Receipt} tone="charcoal"
          label="Ghost Checks MTD" value={money(ghostTotal)}
        />
        <SummaryCard icon={DollarSign} tone="green"
          label="Net Cash MTD"
          value={money(totals.receivedThisMonth - totals.paidThisMonth - ghostTotal)}
        />
      </div>

      {/* Job costing health */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="font-bold text-omega-charcoal flex items-center gap-2">
            <Wallet className="w-4 h-4 text-omega-orange" /> Job Costing Overview
          </h3>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 hover:border-omega-orange text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MiniStat label="Total Revenue (est.)" value={money(costStats.totalRevenue)} />
          <MiniStat label="Total Costs (est.)" value={money(costStats.totalCost)} color="text-red-600" />
          <MiniStat label="Total Received" value={money(costStats.totalReceived)} color="text-green-700" />
          <MiniStat label="Balance Outstanding"
            value={money(costStats.totalRevenue - costStats.totalReceived)}
            color={costStats.totalRevenue - costStats.totalReceived > 0 ? 'text-amber-600' : 'text-green-700'}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <HealthBadge icon={TrendingUp} label="Profitable" count={costStats.profitable} color="text-green-700 bg-green-50 border-green-200" />
          <HealthBadge icon={AlertTriangle} label="At Risk" count={costStats.atRisk} color="text-amber-700 bg-amber-50 border-amber-200" />
          <HealthBadge icon={TrendingDown} label="Loss" count={costStats.loss} color="text-red-700 bg-red-50 border-red-200" />
        </div>
        <p className="text-[11px] text-omega-stone mt-3">
          Based on {costStats.jobCount} jobs with costing data. Margin thresholds: ≥15% profitable · 5–14% at risk · &lt;5% loss.
        </p>
      </div>

      {/* Print report */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-bold text-omega-charcoal">QuickBooks Report</p>
          <p className="text-sm text-omega-stone mt-0.5">
            Generate a full financial report to print and enter manually into QuickBooks.
          </p>
        </div>
        <button
          onClick={printReport}
          disabled={printing}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60"
        >
          {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          Print Report
        </button>
      </div>
    </div>
  );
}

function MiniStat({ label, value, color = 'text-omega-charcoal' }) {
  return (
    <div className="bg-omega-cloud rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">{label}</p>
      <p className={`text-base font-bold mt-0.5 tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function HealthBadge({ icon: Icon, label, count, color }) {
  return (
    <div className={`rounded-xl border p-3 flex items-center gap-2 ${color}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      <div>
        <p className="text-lg font-black leading-none">{count}</p>
        <p className="text-[11px] font-semibold">{label}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PRINT REPORT — opens new window, formatted for printing
// ─────────────────────────────────────────────────────────────────────

async function openPrintReport() {
  // Fetch all data needed for the report
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [
    { data: contracts },
    { data: milestones },
    { data: agreements },
    { data: subPayments },
    { data: ghost },
    { data: jobs },
    { data: subs },
  ] = await Promise.all([
    supabase.from('contracts').select('id, job_id, total_amount, signed_at').not('signed_at', 'is', null),
    supabase.from('payment_milestones').select('*').order('order_idx'),
    supabase.from('subcontractor_agreements').select('*').not('signed_at', 'is', null),
    supabase.from('sub_payments').select('*').order('order_idx'),
    supabase.from('ghost_payments').select('*').is('deleted_at', null).order('paid_at', { ascending: false }),
    supabase.from('jobs').select('id, client_name, address, city, service'),
    supabase.from('subcontractors').select('id, name, contact_name'),
  ]);

  const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
  const subsById = Object.fromEntries((subs || []).map((s) => [s.id, s]));
  const milestonesByContract = {};
  (milestones || []).forEach((m) => {
    (milestonesByContract[m.contract_id] = milestonesByContract[m.contract_id] || []).push(m);
  });
  const paysByAgreement = {};
  (subPayments || []).forEach((p) => {
    (paysByAgreement[p.agreement_id] = paysByAgreement[p.agreement_id] || []).push(p);
  });

  const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dt = (s) => s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  let totalReceived = 0, totalOwed = 0, totalSubsPaid = 0, totalSubsOwed = 0, totalGhost = 0;
  (milestones || []).forEach((m) => {
    totalReceived += Number(m.received_amount || 0);
    totalOwed += Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0));
  });
  (subPayments || []).forEach((p) => {
    totalSubsPaid += Number(p.paid_amount || 0);
    totalSubsOwed += Math.max(0, Number(p.due_amount || 0) - Number(p.paid_amount || 0));
  });
  (ghost || []).forEach((g) => { totalGhost += Number(g.amount || 0); });

  const contractRows = (contracts || []).map((c) => {
    const job = jobsById[c.job_id] || {};
    const ms = milestonesByContract[c.id] || [];
    const received = ms.reduce((s, m) => s + Number(m.received_amount || 0), 0);
    const due = ms.reduce((s, m) => s + Number(m.due_amount || 0), 0);
    return { contract: c, job, milestones: ms, received, due };
  });

  const agreementRows = (agreements || []).map((a) => {
    const job = jobsById[a.job_id] || {};
    const sub = subsById[a.subcontractor_id] || {};
    const ps = paysByAgreement[a.id] || [];
    const paid = ps.reduce((s, p) => s + Number(p.paid_amount || 0), 0);
    const due = ps.reduce((s, p) => s + Number(p.due_amount || 0), 0);
    return { agreement: a, job, sub, payments: ps, paid, due };
  });

  const ghostThisMonth = (ghost || []).filter((g) => g.paid_at >= monthStart);

  const statusLabel = (m, isPay = false) => {
    const eff = effectiveStatus({ due_date: m.due_date, status: m.status });
    return eff.charAt(0).toUpperCase() + eff.slice(1);
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Financial Report — Omega Development LLC</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 32px; }
  h1 { font-size: 22px; color: #E8732A; margin-bottom: 4px; }
  h2 { font-size: 15px; border-bottom: 2px solid #E8732A; padding-bottom: 4px; margin: 24px 0 12px; color: #1a1a1a; }
  h3 { font-size: 12px; font-weight: 700; margin: 12px 0 4px; color: #374151; }
  .meta { font-size: 11px; color: #6b7280; margin-bottom: 20px; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .summary-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .summary-card .label { font-size: 10px; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.05em; }
  .summary-card .value { font-size: 20px; font-weight: 800; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .green { color: #16a34a; }
  .red { color: #dc2626; }
  .orange { color: #E8732A; }
  .gray { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
  th { background: #f9fafb; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
  td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .client-block { margin-bottom: 20px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .client-header { background: #f9fafb; padding: 8px 12px; font-weight: 700; display: flex; justify-content: space-between; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 20px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  .pill-paid { background: #dcfce7; color: #15803d; }
  .pill-partial { background: #fef3c7; color: #92400e; }
  .pill-overdue { background: #fee2e2; color: #dc2626; }
  .pill-pending { background: #f3f4f6; color: #6b7280; }
  .pill-due_soon { background: #fef3c7; color: #92400e; }
  .net-box { margin-top: 24px; background: #1a1a1a; color: white; padding: 16px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
  .net-box .net-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; }
  .net-box .net-value { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
  @media print { body { padding: 16px; } @page { margin: 1.5cm; } }
</style>
</head>
<body>

<h1>Omega Development LLC</h1>
<p class="meta">Financial Report · Generated ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</p>

<div class="summary-grid">
  <div class="summary-card">
    <div class="label">Total Received (Clients)</div>
    <div class="value green">${fmt(totalReceived)}</div>
  </div>
  <div class="summary-card">
    <div class="label">Outstanding A/R</div>
    <div class="value orange">${fmt(totalOwed)}</div>
  </div>
  <div class="summary-card">
    <div class="label">Sub Payments Made</div>
    <div class="value red">${fmt(totalSubsPaid)}</div>
  </div>
  <div class="summary-card">
    <div class="label">Still Owed to Subs</div>
    <div class="value orange">${fmt(totalSubsOwed)}</div>
  </div>
  <div class="summary-card">
    <div class="label">Ghost Checks (All)</div>
    <div class="value red">${fmt(totalGhost)}</div>
  </div>
  <div class="summary-card">
    <div class="label">Net (Received − Sub − Ghost)</div>
    <div class="value ${totalReceived - totalSubsPaid - totalGhost >= 0 ? 'green' : 'red'}">${fmt(totalReceived - totalSubsPaid - totalGhost)}</div>
  </div>
</div>

<h2>Client Receivables</h2>
${contractRows.length === 0 ? '<p class="gray">No signed contracts.</p>' : contractRows.map(({ contract, job, milestones: ms, received, due }) => `
<div class="client-block">
  <div class="client-header">
    <span>${job.client_name || '—'} · ${job.service || ''} · ${[job.address, job.city].filter(Boolean).join(', ') || '—'}</span>
    <span>Contract: ${fmt(contract.total_amount || due)} · Received: ${fmt(received)} · Balance: ${fmt(due - received)}</span>
  </div>
  <table>
    <thead><tr><th>Installment</th><th>Due Date</th><th>Due Amount</th><th>Received</th><th>Balance</th><th>Status</th></tr></thead>
    <tbody>
      ${ms.length === 0 ? '<tr><td colspan="6" style="color:#9ca3af;font-style:italic">No installments defined.</td></tr>' : ms.map((m) => {
        const eff = effectiveStatus({ due_date: m.due_date, status: m.status });
        const bal = Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0));
        return `<tr>
          <td>${m.label || `Installment ${(m.order_idx || 0) + 1}`}</td>
          <td>${dt(m.due_date)}</td>
          <td>${fmt(m.due_amount)}</td>
          <td>${fmt(m.received_amount)}</td>
          <td>${fmt(bal)}</td>
          <td><span class="pill pill-${eff}">${eff}</span></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>`).join('')}

<h2>Subcontractor Payments</h2>
${agreementRows.length === 0 ? '<p class="gray">No signed agreements.</p>' : agreementRows.map(({ agreement, job, sub, payments: ps, paid, due }) => `
<div class="client-block">
  <div class="client-header">
    <span>${sub.contact_name || sub.name || '—'} · ${job.client_name || '—'} (${job.service || ''})</span>
    <span>Total: ${fmt(agreement.their_estimate || due)} · Paid: ${fmt(paid)} · Remaining: ${fmt(due - paid)}</span>
  </div>
  <table>
    <thead><tr><th>Installment</th><th>Due Date</th><th>Due Amount</th><th>Paid</th><th>Remaining</th><th>Status</th></tr></thead>
    <tbody>
      ${ps.length === 0 ? '<tr><td colspan="6" style="color:#9ca3af;font-style:italic">No installments defined.</td></tr>' : ps.map((p) => {
        const eff = effectiveStatus({ due_date: p.due_date, status: p.status });
        const rem = Math.max(0, Number(p.due_amount || 0) - Number(p.paid_amount || 0));
        return `<tr>
          <td>${p.label || `Installment ${(p.order_idx || 0) + 1}`}</td>
          <td>${dt(p.due_date)}</td>
          <td>${fmt(p.due_amount)}</td>
          <td>${fmt(p.paid_amount)}</td>
          <td>${fmt(rem)}</td>
          <td><span class="pill pill-${eff}">${eff}</span></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>`).join('')}

<h2>Ghost Account Checks</h2>
${ghost.length === 0 ? '<p class="gray">No ghost payments recorded.</p>' : `
<table>
  <thead><tr><th>Date</th><th>Subcontractor</th><th>Project</th><th>Check #</th><th style="text-align:right">Amount</th><th>Notes</th></tr></thead>
  <tbody>
    ${ghost.map((g) => `<tr>
      <td>${dt(g.paid_at)}</td>
      <td>${g.subcontractor_id ? '—' : '—'}</td>
      <td>—</td>
      <td>${g.check_number || '—'}</td>
      <td style="text-align:right;font-weight:700">${fmt(g.amount)}</td>
      <td>${g.notes || '—'}</td>
    </tr>`).join('')}
    <tr style="font-weight:800;background:#f9fafb">
      <td colspan="4">Total Ghost Payments</td>
      <td style="text-align:right">${fmt(totalGhost)}</td>
      <td></td>
    </tr>
  </tbody>
</table>`}

<div class="net-box">
  <div>
    <div class="net-label">Net Cash Flow</div>
    <div class="net-label" style="margin-top:4px">Received − Sub Payments − Ghost Checks</div>
  </div>
  <div class="net-value">${fmt(totalReceived - totalSubsPaid - totalGhost)}</div>
</div>

<div class="footer">
  <span>Omega Development LLC · Internal Financial Report</span>
  <span>Generated ${new Date().toLocaleString()}</span>
</div>

<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked. Please allow pop-ups for this site.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
}

// ─────────────────────────────────────────────────────────────────────
// CLIENTS TAB — flat list of received payments, newest first
// ─────────────────────────────────────────────────────────────────────

function ClientsTab({ user, accounts }) {
  const [loading, setLoading] = useState(true);
  const [receivedRows, setReceivedRows] = useState([]);  // flat, paid milestones
  const [contractRows, setContractRows] = useState([]);  // full contract rows for drawer
  const [drawerContractId, setDrawerContractId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data: contracts } = await supabase
        .from('contracts')
        .select('*')
        .not('signed_at', 'is', null)
        .order('signed_at', { ascending: false });

      const ids = (contracts || []).map((c) => c.id);
      const jobIds = [...new Set((contracts || []).map((c) => c.job_id).filter(Boolean))];

      const [{ data: milestones }, { data: jobs }] = await Promise.all([
        ids.length
          ? supabase.from('payment_milestones').select('*').in('contract_id', ids).order('order_idx')
          : Promise.resolve({ data: [] }),
        jobIds.length
          ? supabase.from('jobs').select('id, client_name, address, city, service').in('id', jobIds)
          : Promise.resolve({ data: [] }),
      ]);

      const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
      const milestonesByContract = {};
      (milestones || []).forEach((m) => {
        (milestonesByContract[m.contract_id] = milestonesByContract[m.contract_id] || []).push(m);
      });

      const toMat = (contracts || []).filter((c) => {
        const has = (milestonesByContract[c.id] || []).length > 0;
        const hasPlan = Array.isArray(c.payment_plan) && c.payment_plan.length > 0;
        return !has && hasPlan;
      });
      if (toMat.length > 0) {
        await Promise.all(toMat.map((c) => ensureMilestonesForContract(c).catch(() => null)));
        const { data: refetch } = await supabase
          .from('payment_milestones').select('*')
          .in('contract_id', toMat.map((c) => c.id)).order('order_idx');
        (refetch || []).forEach((m) => {
          (milestonesByContract[m.contract_id] = milestonesByContract[m.contract_id] || []).push(m);
        });
      }

      const built = (contracts || []).map((c) => {
        const ms = milestonesByContract[c.id] || [];
        return { contract: c, job: jobsById[c.job_id] || {}, milestones: ms, totals: contractTotals(ms, c.total_amount) };
      });
      setContractRows(built);

      // Flat list: milestones with received amount, newest first
      const flat = [];
      built.forEach(({ contract, job, milestones: ms }) => {
        ms.forEach((m) => {
          if (Number(m.received_amount) > 0) {
            flat.push({ milestone: m, contract, job });
          }
        });
      });
      flat.sort((a, b) => {
        const ta = a.milestone.received_at ? new Date(a.milestone.received_at).getTime() : 0;
        const tb = b.milestone.received_at ? new Date(b.milestone.received_at).getTime() : 0;
        return tb - ta;
      });
      setReceivedRows(flat);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Spinner />;

  const drawerRow = contractRows.find((r) => r.contract.id === drawerContractId);
  const totalReceived = receivedRows.reduce((s, r) => s + Number(r.milestone.received_amount || 0), 0);

  return (
    <div className="space-y-5">
      {/* Received payments flat list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-bold text-omega-charcoal flex items-center gap-2">
            <ArrowDownCircle className="w-4 h-4 text-green-600" /> Received Payments
          </p>
          <span className="text-sm font-bold text-green-700">{money(totalReceived)}</span>
        </div>

        {receivedRows.length === 0 ? (
          <div className="p-8 text-center text-omega-stone">
            <ArrowDownCircle className="w-8 h-8 mx-auto mb-2 text-omega-fog" />
            <p className="text-sm font-semibold">No payments received yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {receivedRows.map(({ milestone: m, contract, job }) => (
              <button
                key={m.id}
                onClick={() => setDrawerContractId(contract.id)}
                className="w-full text-left px-4 py-3 hover:bg-omega-cloud transition flex items-center gap-4 flex-wrap sm:flex-nowrap"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-omega-charcoal text-sm truncate">{job.client_name || '—'}</p>
                  <p className="text-[11px] text-omega-stone truncate">
                    {m.label || `Installment ${(m.order_idx || 0) + 1}`}
                    {job.service && <> · <span className="text-omega-orange font-semibold uppercase">{job.service}</span></>}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-green-700">{money(m.received_amount)}</p>
                  <p className="text-[11px] text-omega-stone">{shortDate(m.received_at)}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-omega-stone flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Contracts section — for managing milestones */}
      <div>
        <p className="text-[11px] font-semibold text-omega-stone uppercase tracking-wider mb-3 px-1">
          All Contracts ({contractRows.length})
        </p>
        {contractRows.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-omega-stone">
            <FileText className="w-10 h-10 mx-auto mb-2 text-omega-fog" />
            <p className="text-sm font-semibold">No signed contracts yet.</p>
            <p className="text-[11px] mt-1">Once a client signs via DocuSign it appears here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {contractRows.map((r) => (
              <ContractCard key={r.contract.id} row={r} onOpen={() => setDrawerContractId(r.contract.id)} />
            ))}
          </div>
        )}
      </div>

      {drawerRow && (
        <PaymentDrawer
          row={drawerRow}
          accounts={accounts}
          user={user}
          onClose={() => setDrawerContractId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function contractTotals(milestones, contractTotal) {
  const total = Number(contractTotal || 0);
  const due = milestones.reduce((s, m) => s + Number(m.due_amount || 0), 0);
  const received = milestones.reduce((s, m) => s + Number(m.received_amount || 0), 0);
  const remaining = Math.max(0, due - received);
  const paidCount = milestones.filter((m) => effectiveStatus(m) === 'paid').length;
  const overdueCount = milestones.filter((m) => effectiveStatus(m) === 'overdue').length;
  const next = milestones
    .filter((m) => effectiveStatus(m) !== 'paid')
    .sort((a, b) => (!a.due_date ? 1 : !b.due_date ? -1 : new Date(a.due_date) - new Date(b.due_date)))[0] || null;
  return { total, due, received, remaining, paidCount, overdueCount, next, count: milestones.length };
}

function ContractCard({ row, onOpen }) {
  const { contract, job, milestones, totals } = row;
  const progressPct = totals.due > 0 ? Math.round((totals.received / totals.due) * 100) : 0;
  const hasOverdue = totals.overdueCount > 0;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border border-gray-200 rounded-2xl p-4 hover:border-omega-orange hover:shadow-card transition group"
    >
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-omega-charcoal truncate">{job.client_name || '—'}</p>
            {hasOverdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold uppercase">
                <AlertTriangle className="w-3 h-3" /> {totals.overdueCount} overdue
              </span>
            )}
          </div>
          <p className="text-xs text-omega-stone truncate mt-0.5">
            {[job.address, job.city].filter(Boolean).join(', ') || '—'}
            {job.service && <> · <span className="uppercase text-omega-orange font-semibold">{job.service}</span></>}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full transition-all ${hasOverdue ? 'bg-red-500' : 'bg-omega-success'}`} style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-omega-stone w-16 text-right">
              {totals.paidCount}/{totals.count} paid
            </span>
          </div>
        </div>
        <div className="flex-shrink-0 text-right min-w-[140px]">
          <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">Contract total</p>
          <p className="text-base font-bold text-omega-charcoal">{money(totals.total || totals.due)}</p>
          <p className="text-[11px] text-green-700 mt-0.5">Received: {money(totals.received)}</p>
          {totals.next && (
            <p className="text-[11px] text-omega-charcoal mt-1">
              Next: <span className="font-semibold">{shortDate(totals.next.due_date)}</span> · {money(Math.max(0, Number(totals.next.due_amount) - Number(totals.next.received_amount || 0)))}
            </p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-omega-stone group-hover:text-omega-orange flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PAYMENT DRAWER — milestones + full CRUD
// ─────────────────────────────────────────────────────────────────────

function PaymentDrawer({ row, accounts, user, onClose, onChanged }) {
  const { contract, job, milestones, totals } = row;
  const [markFor, setMarkFor]   = useState(null);
  const [editFor, setEditFor]   = useState(null); // milestone or null
  const [addingNew, setAddingNew] = useState(false);

  async function deleteMilestone(m) {
    if (!confirm(`Delete "${m.label || 'this installment'}" (${money(m.due_amount)})? This cannot be undone.`)) return;
    const { error } = await supabase.from('payment_milestones').delete().eq('id', m.id);
    if (error) { alert(error.message); return; }
    logAudit({ user, action: 'milestone.delete', entityType: 'payment_milestone', entityId: m.id, details: { label: m.label, amount: m.due_amount } });
    onChanged();
  }

  async function saveMilestone(form) {
    if (form.__new) {
      const maxIdx = milestones.reduce((max, m) => Math.max(max, m.order_idx || 0), -1);
      const { error } = await supabase.from('payment_milestones').insert([{
        contract_id: contract.id,
        job_id: contract.job_id || null,
        order_idx: maxIdx + 1,
        label: form.label || `Installment ${maxIdx + 2}`,
        due_amount: Number(form.due_amount) || 0,
        due_date: form.due_date || null,
        received_amount: 0,
        status: 'pending',
      }]);
      if (error) throw error;
      logAudit({ user, action: 'milestone.create', entityType: 'payment_milestone', entityId: contract.id, details: form });
    } else {
      const { error } = await supabase.from('payment_milestones').update({
        label: form.label,
        due_amount: Number(form.due_amount) || 0,
        due_date: form.due_date || null,
        updated_at: new Date().toISOString(),
      }).eq('id', form.id);
      if (error) throw error;
      logAudit({ user, action: 'milestone.update', entityType: 'payment_milestone', entityId: form.id, details: form });
    }
    setAddingNew(false);
    setEditFor(null);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <p className="font-bold text-omega-charcoal truncate">{job.client_name || '—'}</p>
            <p className="text-xs text-omega-stone truncate">{[job.address, job.city].filter(Boolean).join(', ') || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-gray-100 flex-shrink-0 bg-omega-cloud">
          <SmallStat label="Contract" value={money(totals.total || totals.due)} />
          <SmallStat label="Received" value={money(totals.received)} />
          <SmallStat label="Balance" value={money(totals.remaining)} />
        </div>

        <div className="overflow-y-auto p-5 space-y-2 flex-1">
          {milestones.map((m) => {
            const status = effectiveStatus(m);
            const remaining = Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0));
            return (
              <div key={m.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusPill status={status} />
                      <p className="font-semibold text-omega-charcoal text-sm">{m.label || `Installment ${(m.order_idx || 0) + 1}`}</p>
                    </div>
                    <p className="text-[11px] text-omega-stone mt-1">
                      Due: {shortDate(m.due_date)}
                      {Number(m.received_amount) > 0 && <> · Received: {shortDate(m.received_at)}</>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1">
                    <p className="text-sm font-bold text-omega-charcoal">{money(m.due_amount)}</p>
                    {Number(m.received_amount) > 0 && (
                      <p className="text-[11px] text-green-700">Received: {money(m.received_amount)}</p>
                    )}
                    <div className="flex items-center gap-1 justify-end flex-wrap">
                      {status !== 'paid' && (
                        <button
                          onClick={() => setMarkFor({ milestone: m, suggestedAmount: remaining })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-omega-success hover:bg-green-700 text-white text-[11px] font-semibold"
                        >
                          <Check className="w-3 h-3" /> Mark received
                        </button>
                      )}
                      <button
                        onClick={() => setEditFor(m)}
                        className="p-1 rounded-lg text-omega-stone hover:bg-omega-cloud hover:text-omega-charcoal"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {status === 'pending' && (
                        <button
                          onClick={() => deleteMilestone(m)}
                          className="p-1 rounded-lg text-omega-stone hover:bg-red-50 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {m.notes && (
                  <p className="text-[11px] text-omega-stone mt-2 whitespace-pre-line border-t border-gray-100 pt-2">{m.notes}</p>
                )}
              </div>
            );
          })}

          {milestones.length === 0 && (
            <p className="text-sm text-omega-stone p-4 text-center">No installments yet. Add one below.</p>
          )}

          <button
            onClick={() => setAddingNew(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold text-omega-stone hover:border-omega-orange hover:text-omega-orange"
          >
            <Plus className="w-4 h-4" /> Add Installment
          </button>
        </div>
      </div>

      {markFor && (
        <MarkReceivedModal
          milestone={markFor.milestone}
          suggestedAmount={markFor.suggestedAmount}
          accounts={accounts}
          user={user}
          kind="contract"
          onClose={() => setMarkFor(null)}
          onSaved={() => { setMarkFor(null); onChanged(); }}
        />
      )}

      {(editFor || addingNew) && (
        <MilestoneFormModal
          initial={addingNew ? { __new: true } : editFor}
          onClose={() => { setEditFor(null); setAddingNew(false); }}
          onSave={saveMilestone}
        />
      )}
    </div>
  );
}

function MilestoneFormModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState({
    id: initial?.id || null,
    __new: !!initial?.__new,
    label: initial?.label || '',
    due_amount: initial?.due_amount || '',
    due_date: initial?.due_date || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!(Number(form.due_amount) > 0)) { setError('Amount must be greater than 0'); return; }
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal">{form.__new ? 'Add Installment' : 'Edit Installment'}</p>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-omega-stone" /></button>
        </div>
        <div className="p-4 space-y-3">
          <FormField label="Label">
            <input value={form.label} onChange={(e) => set('label', e.target.value)}
              placeholder="e.g. Deposit, Final Payment…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </FormField>
          <FormField label="Amount ($) *">
            <input type="number" min="0.01" step="0.01" required value={form.due_amount}
              onChange={(e) => set('due_amount', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm tabular-nums" placeholder="0.00" />
          </FormField>
          <FormField label="Due Date">
            <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </FormField>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUBS TAB
// ─────────────────────────────────────────────────────────────────────

function SubsTab({ user, accounts }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [drawerAgreementId, setDrawerAgreementId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data: agreements } = await supabase
        .from('subcontractor_agreements').select('*')
        .not('signed_at', 'is', null).order('signed_at', { ascending: false });

      const { data: offers } = await supabase
        .from('subcontractor_offers').select('id, payment_plan, their_estimate, subcontractor_id, job_id');
      const offersById = Object.fromEntries((offers || []).map((o) => [o.id, o]));

      const enriched = (agreements || []).map((a) => {
        const offer = a.offer_id ? offersById[a.offer_id] : null;
        return {
          ...a,
          payment_plan: a.payment_plan || offer?.payment_plan || null,
          their_estimate: a.their_estimate || offer?.their_estimate || a.total_amount || 0,
          subcontractor_id: a.subcontractor_id || offer?.subcontractor_id || null,
          job_id: a.job_id || offer?.job_id || null,
        };
      });

      const ids    = enriched.map((a) => a.id);
      const subIds = [...new Set(enriched.map((a) => a.subcontractor_id).filter(Boolean))];
      const jobIds = [...new Set(enriched.map((a) => a.job_id).filter(Boolean))];

      const [{ data: payments }, { data: subs }, { data: jobs }] = await Promise.all([
        ids.length    ? supabase.from('sub_payments').select('*').in('agreement_id', ids).order('order_idx')    : Promise.resolve({ data: [] }),
        subIds.length ? supabase.from('subcontractors').select('id, name, contact_name').in('id', subIds)       : Promise.resolve({ data: [] }),
        jobIds.length ? supabase.from('jobs').select('id, client_name, address, city, service').in('id', jobIds): Promise.resolve({ data: [] }),
      ]);

      const subsById = Object.fromEntries((subs || []).map((s) => [s.id, s]));
      const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
      const paysByAgreement = {};
      (payments || []).forEach((p) => {
        (paysByAgreement[p.agreement_id] = paysByAgreement[p.agreement_id] || []).push(p);
      });

      const toMat = enriched.filter((a) => {
        const has = (paysByAgreement[a.id] || []).length > 0;
        const hasPlan = Array.isArray(a.payment_plan) && a.payment_plan.length > 0;
        return !has && hasPlan;
      });
      if (toMat.length > 0) {
        await Promise.all(toMat.map((a) => ensureSubPaymentsForAgreement(a).catch(() => null)));
        const { data: refetch } = await supabase.from('sub_payments').select('*')
          .in('agreement_id', toMat.map((a) => a.id)).order('order_idx');
        (refetch || []).forEach((p) => {
          (paysByAgreement[p.agreement_id] = paysByAgreement[p.agreement_id] || []).push(p);
        });
      }

      setRows(enriched.map((a) => {
        const ps = paysByAgreement[a.id] || [];
        const due  = ps.reduce((s, p) => s + Number(p.due_amount  || 0), 0);
        const paid = ps.reduce((s, p) => s + Number(p.paid_amount || 0), 0);
        return {
          agreement: a,
          sub: subsById[a.subcontractor_id] || {},
          job: jobsById[a.job_id] || {},
          payments: ps,
          totals: {
            total: Number(a.their_estimate || 0),
            due, paid,
            remaining: Math.max(0, due - paid),
            paidCount: ps.filter((p) => p.status === 'paid').length,
            count: ps.length,
            overdueCount: ps.filter((p) => effectiveStatus({ due_date: p.due_date, status: p.status }) === 'overdue').length,
            next: ps.filter((p) => p.status !== 'paid').sort((a, b) => (!a.due_date ? 1 : !b.due_date ? -1 : new Date(a.due_date) - new Date(b.due_date)))[0] || null,
          },
        };
      }));
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Spinner />;

  const drawerRow = rows.find((r) => r.agreement.id === drawerAgreementId);

  // Split: to pay = remaining > 0 or no installments defined yet; paid = fully paid
  const toPay = rows.filter((r) => r.totals.remaining > 0 || r.totals.count === 0);
  const paid  = rows.filter((r) => r.totals.remaining === 0 && r.totals.count > 0);

  const totalOwed = toPay.reduce((s, r) => s + r.totals.remaining, 0);
  const totalPaid = paid.reduce((s, r) => s + r.totals.paid, 0);

  return (
    <div className="space-y-6">
      {/* Subs to pay */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-bold text-omega-charcoal flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-omega-orange" /> To Pay
            <span className="text-[11px] font-semibold text-omega-stone bg-omega-cloud px-2 py-0.5 rounded-full">{toPay.length}</span>
          </p>
          {toPay.length > 0 && (
            <span className="text-sm font-bold text-omega-orange">{money(totalOwed)} remaining</span>
          )}
        </div>
        {toPay.length === 0 ? (
          <div className="p-8 text-center text-omega-stone">
            <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm font-semibold">All subs are paid up.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {toPay.map((r) => (
              <SubAgreementCard key={r.agreement.id} row={r} onOpen={() => setDrawerAgreementId(r.agreement.id)} inline />
            ))}
          </div>
        )}
      </div>

      {/* Subs paid */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-bold text-omega-charcoal flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600" /> Paid
            <span className="text-[11px] font-semibold text-omega-stone bg-omega-cloud px-2 py-0.5 rounded-full">{paid.length}</span>
          </p>
          {paid.length > 0 && (
            <span className="text-sm font-bold text-green-700">{money(totalPaid)} paid</span>
          )}
        </div>
        {paid.length === 0 ? (
          <div className="p-6 text-center text-omega-stone">
            <p className="text-sm">No completed sub payments yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {paid.map((r) => (
              <SubAgreementCard key={r.agreement.id} row={r} onOpen={() => setDrawerAgreementId(r.agreement.id)} inline />
            ))}
          </div>
        )}
      </div>

      {drawerRow && (
        <SubPaymentDrawer
          row={drawerRow}
          accounts={accounts}
          user={user}
          onClose={() => setDrawerAgreementId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function SubAgreementCard({ row, onOpen, inline = false }) {
  const { agreement, sub, job, totals } = row;
  const progressPct = totals.due > 0 ? Math.round((totals.paid / totals.due) * 100) : 0;
  const hasOverdue = totals.overdueCount > 0;

  return (
    <button
      onClick={onOpen}
      className={
        inline
          ? 'w-full text-left px-4 py-3 hover:bg-omega-cloud transition group flex items-center gap-4 flex-wrap sm:flex-nowrap'
          : 'w-full text-left bg-white border border-gray-200 rounded-2xl p-4 hover:border-omega-orange hover:shadow-card transition group'
      }
    >
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-omega-charcoal truncate">{sub.contact_name || sub.name || '—'}</p>
            {sub.contact_name && sub.name && <span className="text-xs text-omega-stone">· {sub.name}</span>}
            {hasOverdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold uppercase">
                <AlertTriangle className="w-3 h-3" /> {totals.overdueCount} overdue
              </span>
            )}
          </div>
          <p className="text-xs text-omega-stone truncate mt-0.5">
            Job: {job.client_name || '—'} · {[job.address, job.city].filter(Boolean).join(', ')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full transition-all ${hasOverdue ? 'bg-red-500' : 'bg-omega-orange'}`} style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-omega-stone w-16 text-right">{totals.paidCount}/{totals.count} paid</span>
          </div>
        </div>
        <div className="flex-shrink-0 text-right min-w-[140px]">
          <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">Total agreed</p>
          <p className="text-base font-bold text-omega-charcoal">{money(totals.total || totals.due)}</p>
          <p className="text-[11px] text-omega-stone mt-0.5">Paid: {money(totals.paid)}</p>
          {totals.next && (
            <p className="text-[11px] text-omega-charcoal mt-1">
              Next: <span className="font-semibold">{shortDate(totals.next.due_date)}</span> · {money(Math.max(0, Number(totals.next.due_amount) - Number(totals.next.paid_amount || 0)))}
            </p>
          )}
        </div>
        <ChevronRight className="w-5 h-5 text-omega-stone group-hover:text-omega-orange flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUB PAYMENT DRAWER — payments + full CRUD
// ─────────────────────────────────────────────────────────────────────

function SubPaymentDrawer({ row, accounts, user, onClose, onChanged }) {
  const { agreement, sub, job, payments, totals } = row;
  const [markFor, setMarkFor]   = useState(null);
  const [editFor, setEditFor]   = useState(null);
  const [addingNew, setAddingNew] = useState(false);

  async function deletePayment(p) {
    if (!confirm(`Delete "${p.label || 'this installment'}" (${money(p.due_amount)})? Cannot be undone.`)) return;
    const { error } = await supabase.from('sub_payments').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    logAudit({ user, action: 'sub_payment.delete', entityType: 'sub_payment', entityId: p.id, details: { label: p.label, amount: p.due_amount } });
    onChanged();
  }

  async function savePayment(form) {
    if (form.__new) {
      const maxIdx = payments.reduce((max, p) => Math.max(max, p.order_idx || 0), -1);
      const { error } = await supabase.from('sub_payments').insert([{
        agreement_id: agreement.id,
        subcontractor_id: agreement.subcontractor_id || null,
        job_id: agreement.job_id || null,
        order_idx: maxIdx + 1,
        label: form.label || `Installment ${maxIdx + 2}`,
        due_amount: Number(form.due_amount) || 0,
        due_date: form.due_date || null,
        paid_amount: 0,
        status: 'pending',
      }]);
      if (error) throw error;
      logAudit({ user, action: 'sub_payment.create', entityType: 'sub_payment', entityId: agreement.id, details: form });
    } else {
      const { error } = await supabase.from('sub_payments').update({
        label: form.label,
        due_amount: Number(form.due_amount) || 0,
        due_date: form.due_date || null,
        updated_at: new Date().toISOString(),
      }).eq('id', form.id);
      if (error) throw error;
      logAudit({ user, action: 'sub_payment.update', entityType: 'sub_payment', entityId: form.id, details: form });
    }
    setAddingNew(false);
    setEditFor(null);
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <p className="font-bold text-omega-charcoal truncate">{sub.contact_name || sub.name || '—'}</p>
            <p className="text-xs text-omega-stone truncate">{job.client_name} · {[job.address, job.city].filter(Boolean).join(', ')}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-gray-100 flex-shrink-0 bg-omega-cloud">
          <SmallStat label="Total"     value={money(totals.total || totals.due)} />
          <SmallStat label="Paid"      value={money(totals.paid)} />
          <SmallStat label="Remaining" value={money(totals.remaining)} />
        </div>

        <div className="overflow-y-auto p-5 space-y-2 flex-1">
          {payments.map((p) => {
            const status = effectiveStatus({ due_date: p.due_date, status: p.status });
            const remaining = Math.max(0, Number(p.due_amount || 0) - Number(p.paid_amount || 0));
            return (
              <div key={p.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusPill status={status} />
                      <p className="font-semibold text-omega-charcoal text-sm">{p.label || `Installment ${(p.order_idx || 0) + 1}`}</p>
                    </div>
                    <p className="text-[11px] text-omega-stone mt-1">
                      Due: {shortDate(p.due_date)}
                      {Number(p.paid_amount) > 0 && <> · Paid: {shortDate(p.paid_at)}</>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1">
                    <p className="text-sm font-bold text-omega-charcoal">{money(p.due_amount)}</p>
                    {Number(p.paid_amount) > 0 && (
                      <p className="text-[11px] text-omega-orange">Paid: {money(p.paid_amount)}</p>
                    )}
                    <div className="flex items-center gap-1 justify-end flex-wrap">
                      {status !== 'paid' && (
                        <button
                          onClick={() => setMarkFor({ milestone: p, suggestedAmount: remaining })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-[11px] font-semibold"
                        >
                          <Check className="w-3 h-3" /> Mark paid
                        </button>
                      )}
                      <button onClick={() => setEditFor(p)} className="p-1 rounded-lg text-omega-stone hover:bg-omega-cloud hover:text-omega-charcoal" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {status === 'pending' && (
                        <button onClick={() => deletePayment(p)} className="p-1 rounded-lg text-omega-stone hover:bg-red-50 hover:text-red-600" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {p.notes && <p className="text-[11px] text-omega-stone mt-2 whitespace-pre-line border-t border-gray-100 pt-2">{p.notes}</p>}
              </div>
            );
          })}

          {payments.length === 0 && <p className="text-sm text-omega-stone p-4 text-center">No installments yet. Add one below.</p>}

          <button
            onClick={() => setAddingNew(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold text-omega-stone hover:border-omega-orange hover:text-omega-orange"
          >
            <Plus className="w-4 h-4" /> Add Installment
          </button>
        </div>
      </div>

      {markFor && (
        <MarkReceivedModal
          milestone={markFor.milestone}
          suggestedAmount={markFor.suggestedAmount}
          accounts={accounts}
          user={user}
          kind="sub"
          onClose={() => setMarkFor(null)}
          onSaved={() => { setMarkFor(null); onChanged(); }}
        />
      )}

      {(editFor || addingNew) && (
        <MilestoneFormModal
          initial={addingNew ? { __new: true } : editFor}
          onClose={() => { setEditFor(null); setAddingNew(false); }}
          onSave={savePayment}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────

function Spinner() {
  return <div className="flex items-center gap-2 text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
}

function SmallStat({ label, value }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">{label}</p>
      <p className="text-sm font-bold text-omega-charcoal">{value}</p>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    paid:     { label: 'Paid',     cls: 'bg-green-50 text-green-700 border-green-200',   icon: Check },
    partial:  { label: 'Partial',  cls: 'bg-amber-50 text-amber-800 border-amber-200',   icon: Clock },
    overdue:  { label: 'Overdue',  cls: 'bg-red-50 text-red-700 border-red-200',          icon: AlertTriangle },
    due_soon: { label: 'Due',      cls: 'bg-amber-50 text-amber-800 border-amber-200',   icon: Clock },
    pending:  { label: 'Pending',  cls: 'bg-gray-100 text-gray-700 border-gray-200',     icon: Clock },
  };
  const m = map[status] || map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${m.cls}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, tone }) {
  const tones = {
    green:    'bg-green-50 border-green-200 text-green-800',
    charcoal: 'bg-white border-gray-200 text-omega-charcoal',
    orange:   'bg-omega-pale border-omega-orange/20 text-omega-orange',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.charcoal}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="text-2xl font-bold mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] opacity-70 mt-1">{sub}</p>}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MARK RECEIVED / PAID MODAL
// ─────────────────────────────────────────────────────────────────────

function MarkReceivedModal({ milestone, suggestedAmount, accounts, user, kind, onClose, onSaved }) {
  const [amount, setAmount]    = useState(String(Number(suggestedAmount || 0).toFixed(2)));
  const [date, setDate]        = useState(todayISO());
  const [accountId, setAccountId] = useState(milestone.received_to_account_id || milestone.paid_from_account_id || (accounts[0]?.id || ''));
  const [notes, setNotes]      = useState('');
  const [saving, setSaving]    = useState(false);
  const [error, setError]      = useState('');

  async function handleSave() {
    setError('');
    const amt = Number(amount);
    if (!(amt > 0)) { setError('Amount must be greater than 0'); return; }
    setSaving(true);
    try {
      if (kind === 'sub') {
        await markSubPaymentPaid(milestone.id, { amount: amt, date, accountId, notes, user });
      } else {
        await markMilestoneReceived(milestone.id, { amount: amt, date, accountId, notes, user });
      }
      onSaved();
    } catch (err) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal">
            {kind === 'sub' ? 'Register payment to sub' : 'Register received payment'}
          </p>
          <button onClick={onClose}><X className="w-5 h-5 text-omega-stone" /></button>
        </div>
        <div className="p-4 space-y-3">
          <FormField label="Amount (USD)">
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono" />
            <p className="text-[10px] text-omega-stone mt-1">Suggested: {money(suggestedAmount)}. Can be partial.</p>
          </FormField>
          <FormField label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </FormField>
          <FormField label={kind === 'sub' ? 'From account' : 'To account'}>
            {accounts.length === 0 ? (
              <p className="text-[11px] text-omega-stone">No accounts yet. Add them via Bank Accounts.</p>
            ) : (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ··${a.last4}` : ''}</option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="Notes (optional)">
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Check #, wire transfer, note…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none" />
          </FormField>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BANK ACCOUNTS MODAL
// ─────────────────────────────────────────────────────────────────────

function BankAccountsModal({ user, accounts, onClose, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({ name: '', last4: '' });
  const [saving, setSaving]   = useState(false);

  function openNew()  { setEditing('new'); setForm({ name: '', last4: '' }); }
  function openEdit(a){ setEditing(a);    setForm({ name: a.name || '', last4: a.last4 || '' }); }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        last4: form.last4.trim().replace(/\D/g, '').slice(0, 4) || null,
      };
      if (editing === 'new') {
        const sortOrder = accounts.length > 0 ? Math.max(...accounts.map((a) => a.sort_order || 0)) + 1 : 0;
        const { data, error } = await supabase.from('bank_accounts').insert([{ ...payload, sort_order: sortOrder }]).select().single();
        if (error) throw error;
        logAudit({ user, action: 'bank_account.create', entityType: 'bank_account', entityId: data.id, details: payload });
      } else {
        const { error } = await supabase.from('bank_accounts').update(payload).eq('id', editing.id);
        if (error) throw error;
        logAudit({ user, action: 'bank_account.update', entityType: 'bank_account', entityId: editing.id, details: payload });
      }
      setEditing(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(a) {
    await supabase.from('bank_accounts').update({ active: !a.active }).eq('id', a.id);
    logAudit({ user, action: a.active ? 'bank_account.deactivate' : 'bank_account.activate', entityType: 'bank_account', entityId: a.id, details: { name: a.name } });
    onChanged();
  }

  async function deleteAccount(a) {
    if (!confirm(`Delete bank account "${a.name}"? This cannot be undone.`)) return;
    await supabase.from('bank_accounts').delete().eq('id', a.id);
    logAudit({ user, action: 'bank_account.delete', entityType: 'bank_account', entityId: a.id, details: { name: a.name } });
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal flex items-center gap-2"><Banknote className="w-4 h-4 text-omega-orange" /> Bank Accounts</p>
          <button onClick={onClose}><X className="w-5 h-5 text-omega-stone" /></button>
        </div>
        <div className="p-4 space-y-2">
          {accounts.length === 0 && <p className="text-sm text-omega-stone text-center py-2">No accounts yet.</p>}
          {accounts.map((a) => (
            <div key={a.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${a.active ? 'bg-white border-gray-200' : 'bg-omega-cloud border-gray-200 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-omega-charcoal text-sm truncate">{a.name}</p>
                <p className="text-[11px] text-omega-stone font-mono">{a.last4 ? `··${a.last4}` : '—'} {!a.active && '· inactive'}</p>
              </div>
              <button onClick={() => openEdit(a)} className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => toggleActive(a)} className="text-[11px] font-semibold text-omega-stone hover:text-omega-charcoal px-2">{a.active ? 'Disable' : 'Enable'}</button>
              <button onClick={() => deleteAccount(a)} className="p-1.5 rounded-lg text-omega-stone hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button
            onClick={openNew}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-semibold text-omega-stone hover:border-omega-orange hover:text-omega-orange"
          >
            <Plus className="w-4 h-4" /> Add bank account
          </button>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <p className="font-bold text-omega-charcoal">{editing === 'new' ? 'New account' : 'Edit account'}</p>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-4 space-y-3">
              <FormField label="Name">
                <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Wells Fargo Operations"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </FormField>
              <FormField label="Last 4 digits">
                <input value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="9842" className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono" />
              </FormField>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button onClick={save} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
