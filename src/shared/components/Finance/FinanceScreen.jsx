// FinanceScreen — Brenda + Inácio + Admin only.
//
// Three tabs:
//   * Company  — stub on v1; future home for QB-synced balances and
//     aggregated health metrics.
//   * Clients  — list of signed contracts with payment milestones.
//                Drawer per contract: timeline, mark-received (full or
//                partial), audit-logged.
//   * Subs     — mirror for subcontractor_agreements / sub_payments.
//
// Data model lives in payment_milestones / sub_payments tables (see
// migration 026 + src/shared/lib/finance.js). The contract.payment_plan
// JSONB stays the SPEC; milestones are materialized on signing or on
// first open of a card whose plan never got materialized.

import { useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Building2, Users, Wallet, X, Plus, Pencil, Save,
  Check, AlertTriangle, Clock, ArrowDownCircle, ArrowUpCircle, Loader2,
  Trash2, ChevronRight, Banknote, FileText,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  effectiveStatus, milestoneAmount, ensureMilestonesForContract,
  ensureSubPaymentsForAgreement, markMilestoneReceived, markSubPaymentPaid,
  loadFinanceTotals,
} from '../../lib/finance';

const TABS = [
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'clients', label: 'Clients', icon: Users },
  { id: 'subs',    label: 'Subs',    icon: ArrowUpCircle },
];

function money(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function FinanceScreen({ user }) {
  const [tab, setTab] = useState('clients');
  const [accounts, setAccounts] = useState([]);
  const [accountsOpen, setAccountsOpen] = useState(false);

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
              Visão consolidada de contratos, recebimentos e pagamentos a subs.
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
        {tab === 'company' && <CompanyTab />}
        {tab === 'clients' && <ClientsTab user={user} accounts={accounts} />}
        {tab === 'subs'    && <SubsTab user={user} accounts={accounts} />}
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

// ────────────────────────────────────────────────────────────────────
// COMPANY TAB — quick aggregates today; QB-synced balances later
// ────────────────────────────────────────────────────────────────────

function CompanyTab() {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await loadFinanceTotals();
        if (!cancelled) setTotals(t);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          icon={ArrowDownCircle} tone="green"
          label="A receber (30d)"  value={money(totals.receivableNext30)}
          sub={`Overdue: ${money(totals.receivableOverdue)}`}
        />
        <SummaryCard
          icon={Check} tone="charcoal"
          label="Recebido no mês"  value={money(totals.receivedThisMonth)}
        />
        <SummaryCard
          icon={ArrowUpCircle} tone="orange"
          label="A pagar subs (30d)" value={money(totals.payableNext30)}
          sub={`Pago no mês: ${money(totals.paidThisMonth)} · Overdue: ${money(totals.payableOverdue)}`}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-bold text-omega-charcoal flex items-center gap-2">
          <Building2 className="w-4 h-4 text-omega-orange" /> Saldos das contas
        </h3>
        <p className="text-sm text-omega-stone mt-1 mb-4">
          Vai puxar do QuickBooks na próxima onda. Por enquanto, gerencie as
          contas em <strong>Bank Accounts</strong> no topo.
        </p>
        <div className="rounded-xl bg-omega-cloud border border-dashed border-gray-300 p-4 text-sm text-omega-stone">
          Integração com QuickBooks: read-only para saldos e identificação de
          conta destino. <em>Sprint 2.</em>
        </div>
      </div>
    </div>
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
      <p className="text-2xl font-bold mt-1.5">{value}</p>
      {sub && <p className="text-[11px] opacity-70 mt-1">{sub}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// CLIENTS TAB — list of signed contracts + drawer with milestones
// ────────────────────────────────────────────────────────────────────

function ClientsTab({ user, accounts }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // {contract, job, milestones, totals}
  const [drawerContractId, setDrawerContractId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      // 1. All signed contracts.
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

      // 2. For contracts that have a payment_plan but NO milestones yet,
      //    materialize. Done in parallel; ignore individual failures.
      const toMaterialize = (contracts || []).filter((c) => {
        const has = (milestonesByContract[c.id] || []).length > 0;
        const hasPlan = Array.isArray(c.payment_plan) && c.payment_plan.length > 0;
        return !has && hasPlan;
      });
      if (toMaterialize.length > 0) {
        await Promise.all(toMaterialize.map((c) => ensureMilestonesForContract(c).catch(() => null)));
        // Refetch milestones for those.
        const { data: refetch } = await supabase
          .from('payment_milestones')
          .select('*')
          .in('contract_id', toMaterialize.map((c) => c.id))
          .order('order_idx');
        (refetch || []).forEach((m) => {
          (milestonesByContract[m.contract_id] = milestonesByContract[m.contract_id] || []).push(m);
        });
      }

      const built = (contracts || []).map((c) => {
        const ms = milestonesByContract[c.id] || [];
        const totals = computeContractTotals(ms, c.total_amount);
        return { contract: c, job: jobsById[c.job_id] || {}, milestones: ms, totals };
      });
      setRows(built);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> Loading contracts…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-omega-stone">
        <FileText className="w-10 h-10 mx-auto mb-2 text-omega-fog" />
        <p className="text-sm">Nenhum contrato assinado ainda.</p>
        <p className="text-[11px] mt-1">Quando o cliente assinar via DocuSign, aparece aqui.</p>
      </div>
    );
  }

  const drawerRow = rows.find((r) => r.contract.id === drawerContractId);

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <ContractCard
          key={r.contract.id}
          row={r}
          onOpen={() => setDrawerContractId(r.contract.id)}
        />
      ))}
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

function computeContractTotals(milestones, contractTotal) {
  const total = Number(contractTotal || 0);
  const due = milestones.reduce((s, m) => s + Number(m.due_amount || 0), 0);
  const received = milestones.reduce((s, m) => s + Number(m.received_amount || 0), 0);
  const remaining = Math.max(0, due - received);
  const paidCount = milestones.filter((m) => effectiveStatus(m) === 'paid').length;
  const overdueCount = milestones.filter((m) => effectiveStatus(m) === 'overdue').length;
  const next = milestones
    .filter((m) => effectiveStatus(m) !== 'paid')
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date) - new Date(b.due_date);
    })[0] || null;
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
              <div
                className={`h-full transition-all ${hasOverdue ? 'bg-red-500' : 'bg-omega-success'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold text-omega-stone w-16 text-right">
              {totals.paidCount}/{totals.count} parcelas
            </span>
          </div>
        </div>

        <div className="flex-shrink-0 text-right min-w-[140px]">
          <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">Total contract</p>
          <p className="text-base font-bold text-omega-charcoal">{money(totals.total || totals.due)}</p>
          <p className="text-[11px] text-omega-stone mt-0.5">Recebido: {money(totals.received)}</p>
          {totals.next && (
            <p className="text-[11px] text-omega-charcoal mt-1">
              Próxima: <span className="font-semibold">{shortDate(totals.next.due_date)}</span> · {money(totals.next.due_amount - (totals.next.received_amount || 0))}
            </p>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-omega-stone group-hover:text-omega-orange flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// PAYMENT DRAWER — timeline + mark received
// ────────────────────────────────────────────────────────────────────

function PaymentDrawer({ row, accounts, user, onClose, onChanged }) {
  const { contract, job, milestones, totals } = row;
  const [markFor, setMarkFor] = useState(null);
  const accountById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <p className="font-bold text-omega-charcoal truncate">{job.client_name || '—'}</p>
            <p className="text-xs text-omega-stone truncate">
              {[job.address, job.city].filter(Boolean).join(', ') || '—'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 grid grid-cols-3 gap-3 border-b border-gray-100 flex-shrink-0 bg-omega-cloud">
          <SmallStat label="Total" value={money(totals.total || totals.due)} />
          <SmallStat label="Recebido" value={money(totals.received)} />
          <SmallStat label="Restante" value={money(totals.remaining)} />
        </div>

        <div className="overflow-y-auto p-5 space-y-2 flex-1">
          {milestones.map((m) => {
            const status = effectiveStatus(m);
            const remaining = Math.max(0, Number(m.due_amount || 0) - Number(m.received_amount || 0));
            return (
              <div key={m.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusPill status={status} />
                      <p className="font-semibold text-omega-charcoal text-sm">{m.label || `Parcela ${m.order_idx + 1}`}</p>
                    </div>
                    <p className="text-[11px] text-omega-stone mt-1">
                      Due: {shortDate(m.due_date)}
                      {Number(m.received_amount) > 0 && (
                        <> · Última entrada: {shortDate(m.received_at)}</>
                      )}
                      {m.received_to_account_id && accountById[m.received_to_account_id] && (
                        <> · {accountById[m.received_to_account_id].name}</>
                      )}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-omega-charcoal">{money(m.due_amount)}</p>
                    {Number(m.received_amount) > 0 && (
                      <p className="text-[11px] text-green-700">Pago: {money(m.received_amount)}</p>
                    )}
                    {status !== 'paid' && (
                      <button
                        onClick={() => setMarkFor({ milestone: m, suggestedAmount: remaining })}
                        className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-omega-success hover:bg-green-700 text-white text-[11px] font-semibold"
                      >
                        <Check className="w-3 h-3" /> Mark received
                      </button>
                    )}
                  </div>
                </div>
                {m.notes && (
                  <p className="text-[11px] text-omega-stone mt-2 whitespace-pre-line border-t border-gray-100 pt-2">
                    {m.notes}
                  </p>
                )}
              </div>
            );
          })}
          {milestones.length === 0 && (
            <p className="text-sm text-omega-stone p-4 text-center">
              Esse contrato não tem payment plan definido. Edite o estimate primeiro.
            </p>
          )}
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
    </div>
  );
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
    paid:     { label: 'Paid',     cls: 'bg-green-50 text-green-700 border-green-200', icon: Check },
    partial:  { label: 'Partial',  cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Clock },
    overdue:  { label: 'Overdue',  cls: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
    due_soon: { label: 'Due',      cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: Clock },
    pending:  { label: 'Pending',  cls: 'bg-gray-100 text-gray-700 border-gray-200', icon: Clock },
  };
  const m = map[status] || map.pending;
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${m.cls}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// MARK RECEIVED MODAL — works for both contract and sub payments
// ────────────────────────────────────────────────────────────────────

function MarkReceivedModal({ milestone, suggestedAmount, accounts, user, kind, onClose, onSaved }) {
  const [amount, setAmount] = useState(String(Number(suggestedAmount || 0).toFixed(2)));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(milestone.received_to_account_id || milestone.paid_from_account_id || (accounts[0]?.id || ''));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setError('');
    const amt = Number(amount);
    if (!(amt > 0)) { setError('Valor deve ser maior que 0'); return; }
    setSaving(true);
    try {
      if (kind === 'sub') {
        await markSubPaymentPaid(milestone.id, { amount: amt, date, accountId, notes, user });
      } else {
        await markMilestoneReceived(milestone.id, { amount: amt, date, accountId, notes, user });
      }
      onSaved();
    } catch (err) {
      setError(err?.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal">
            {kind === 'sub' ? 'Registrar pagamento ao sub' : 'Registrar recebimento'}
          </p>
          <button onClick={onClose}><X className="w-5 h-5 text-omega-stone" /></button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Valor (USD)">
            <input
              type="number" step="0.01" min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono"
            />
            <p className="text-[10px] text-omega-stone mt-1">
              Sugestão: {money(suggestedAmount)} (valor restante). Pode ser parcial.
            </p>
          </Field>
          <Field label="Data">
            <input
              type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </Field>
          <Field label={kind === 'sub' ? 'Conta de origem' : 'Conta destino'}>
            {accounts.length === 0 ? (
              <p className="text-[11px] text-omega-stone">Nenhuma conta cadastrada. Adicione em <strong>Bank Accounts</strong>.</p>
            ) : (
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
              >
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.last4 ? ` ··${a.last4}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Notas (opcional)">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cheque #, transferência, observação…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
            />
          </Field>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// SUBS TAB — same shape, reverse direction
// ────────────────────────────────────────────────────────────────────

function SubsTab({ user, accounts }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [drawerAgreementId, setDrawerAgreementId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const { data: agreements } = await supabase
        .from('subcontractor_agreements')
        .select('*')
        .not('signed_at', 'is', null)
        .order('signed_at', { ascending: false });

      // subcontractor_agreements doesn't necessarily carry payment_plan
      // (different schema from contracts). Fall back to subcontractor_offers
      // if needed for the spec.
      const { data: offers } = await supabase
        .from('subcontractor_offers')
        .select('id, payment_plan, their_estimate, subcontractor_id, job_id');
      const offersById = Object.fromEntries((offers || []).map((o) => [o.id, o]));

      const enriched = (agreements || []).map((a) => {
        // Try to attach payment_plan/estimate from the originating offer
        const offer = a.offer_id ? offersById[a.offer_id] : null;
        return {
          ...a,
          payment_plan: a.payment_plan || offer?.payment_plan || null,
          their_estimate: a.their_estimate || offer?.their_estimate || a.total_amount || 0,
          subcontractor_id: a.subcontractor_id || offer?.subcontractor_id || null,
          job_id: a.job_id || offer?.job_id || null,
        };
      });

      const ids = enriched.map((a) => a.id);
      const subIds = [...new Set(enriched.map((a) => a.subcontractor_id).filter(Boolean))];
      const jobIds = [...new Set(enriched.map((a) => a.job_id).filter(Boolean))];

      const [{ data: payments }, { data: subs }, { data: jobs }] = await Promise.all([
        ids.length
          ? supabase.from('sub_payments').select('*').in('agreement_id', ids).order('order_idx')
          : Promise.resolve({ data: [] }),
        subIds.length
          ? supabase.from('subcontractors').select('id, name, contact_name').in('id', subIds)
          : Promise.resolve({ data: [] }),
        jobIds.length
          ? supabase.from('jobs').select('id, client_name, address, city, service').in('id', jobIds)
          : Promise.resolve({ data: [] }),
      ]);

      const subsById = Object.fromEntries((subs || []).map((s) => [s.id, s]));
      const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
      const paymentsByAgreement = {};
      (payments || []).forEach((p) => {
        (paymentsByAgreement[p.agreement_id] = paymentsByAgreement[p.agreement_id] || []).push(p);
      });

      // Materialize for agreements with plan but no payments yet.
      const toMaterialize = enriched.filter((a) => {
        const has = (paymentsByAgreement[a.id] || []).length > 0;
        const hasPlan = Array.isArray(a.payment_plan) && a.payment_plan.length > 0;
        return !has && hasPlan;
      });
      if (toMaterialize.length > 0) {
        await Promise.all(toMaterialize.map((a) => ensureSubPaymentsForAgreement(a).catch(() => null)));
        const { data: refetch } = await supabase
          .from('sub_payments')
          .select('*')
          .in('agreement_id', toMaterialize.map((a) => a.id))
          .order('order_idx');
        (refetch || []).forEach((p) => {
          (paymentsByAgreement[p.agreement_id] = paymentsByAgreement[p.agreement_id] || []).push(p);
        });
      }

      const built = enriched.map((a) => {
        const ms = paymentsByAgreement[a.id] || [];
        const due = ms.reduce((s, m) => s + Number(m.due_amount || 0), 0);
        const paid = ms.reduce((s, m) => s + Number(m.paid_amount || 0), 0);
        const total = Number(a.their_estimate || 0);
        return {
          agreement: a,
          sub: subsById[a.subcontractor_id] || {},
          job: jobsById[a.job_id] || {},
          payments: ms,
          totals: {
            total, due, paid,
            remaining: Math.max(0, due - paid),
            paidCount: ms.filter((p) => p.status === 'paid').length,
            count: ms.length,
            overdueCount: ms.filter((p) => effectiveStatus(toMilestoneShape(p)) === 'overdue').length,
            next: ms.filter((p) => p.status !== 'paid')
              .sort((a, b) => {
                if (!a.due_date) return 1;
                if (!b.due_date) return -1;
                return new Date(a.due_date) - new Date(b.due_date);
              })[0] || null,
          },
        };
      });
      setRows(built);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-omega-stone">
        <Users className="w-10 h-10 mx-auto mb-2 text-omega-fog" />
        <p className="text-sm">Nenhum agreement assinado com sub ainda.</p>
      </div>
    );
  }

  const drawerRow = rows.find((r) => r.agreement.id === drawerAgreementId);

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <SubAgreementCard
          key={r.agreement.id}
          row={r}
          onOpen={() => setDrawerAgreementId(r.agreement.id)}
        />
      ))}
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

// Adapt sub_payment row shape so effectiveStatus() works on it (reads
// `due_date` and `status`; we never read `received_amount`/`paid_amount`).
function toMilestoneShape(p) {
  return { due_date: p.due_date, status: p.status };
}

function SubAgreementCard({ row, onOpen }) {
  const { agreement, sub, job, totals } = row;
  const progressPct = totals.due > 0 ? Math.round((totals.paid / totals.due) * 100) : 0;
  const hasOverdue = totals.overdueCount > 0;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border border-gray-200 rounded-2xl p-4 hover:border-omega-orange hover:shadow-card transition group"
    >
      <div className="flex items-start gap-4 flex-wrap md:flex-nowrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-omega-charcoal truncate">
              {sub.contact_name || sub.name || '—'}
            </p>
            {sub.contact_name && sub.name && (
              <span className="text-xs text-omega-stone">· {sub.name}</span>
            )}
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
              <div
                className={`h-full transition-all ${hasOverdue ? 'bg-red-500' : 'bg-omega-orange'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[11px] font-semibold text-omega-stone w-16 text-right">
              {totals.paidCount}/{totals.count} parcelas
            </span>
          </div>
        </div>

        <div className="flex-shrink-0 text-right min-w-[140px]">
          <p className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">Total agreement</p>
          <p className="text-base font-bold text-omega-charcoal">{money(totals.total || totals.due)}</p>
          <p className="text-[11px] text-omega-stone mt-0.5">Pago: {money(totals.paid)}</p>
          {totals.next && (
            <p className="text-[11px] text-omega-charcoal mt-1">
              Próxima: <span className="font-semibold">{shortDate(totals.next.due_date)}</span> · {money(totals.next.due_amount - (totals.next.paid_amount || 0))}
            </p>
          )}
        </div>

        <ChevronRight className="w-5 h-5 text-omega-stone group-hover:text-omega-orange flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

function SubPaymentDrawer({ row, accounts, user, onClose, onChanged }) {
  const { agreement, sub, job, payments, totals } = row;
  const [markFor, setMarkFor] = useState(null);
  const accountById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <p className="font-bold text-omega-charcoal truncate">
              {sub.contact_name || sub.name || '—'}
            </p>
            <p className="text-xs text-omega-stone truncate">
              {job.client_name} · {[job.address, job.city].filter(Boolean).join(', ')}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 grid grid-cols-3 gap-3 border-b border-gray-100 bg-omega-cloud">
          <SmallStat label="Total"    value={money(totals.total || totals.due)} />
          <SmallStat label="Pago"     value={money(totals.paid)} />
          <SmallStat label="Restante" value={money(totals.remaining)} />
        </div>

        <div className="overflow-y-auto p-5 space-y-2 flex-1">
          {payments.map((p) => {
            const status = effectiveStatus(toMilestoneShape(p));
            const remaining = Math.max(0, Number(p.due_amount || 0) - Number(p.paid_amount || 0));
            return (
              <div key={p.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusPill status={status} />
                      <p className="font-semibold text-omega-charcoal text-sm">
                        {p.label || `Parcela ${p.order_idx + 1}`}
                      </p>
                    </div>
                    <p className="text-[11px] text-omega-stone mt-1">
                      Due: {shortDate(p.due_date)}
                      {Number(p.paid_amount) > 0 && <> · Última saída: {shortDate(p.paid_at)}</>}
                      {p.paid_from_account_id && accountById[p.paid_from_account_id] && (
                        <> · {accountById[p.paid_from_account_id].name}</>
                      )}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-omega-charcoal">{money(p.due_amount)}</p>
                    {Number(p.paid_amount) > 0 && (
                      <p className="text-[11px] text-omega-orange">Pago: {money(p.paid_amount)}</p>
                    )}
                    {status !== 'paid' && (
                      <button
                        onClick={() => setMarkFor({ milestone: p, suggestedAmount: remaining })}
                        className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-[11px] font-semibold"
                      >
                        <Check className="w-3 h-3" /> Marcar pago
                      </button>
                    )}
                  </div>
                </div>
                {p.notes && (
                  <p className="text-[11px] text-omega-stone mt-2 whitespace-pre-line border-t border-gray-100 pt-2">
                    {p.notes}
                  </p>
                )}
              </div>
            );
          })}
          {payments.length === 0 && (
            <p className="text-sm text-omega-stone p-4 text-center">
              Esse agreement não tem payment plan definido.
            </p>
          )}
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
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// BANK ACCOUNTS — inline CRUD modal
// ────────────────────────────────────────────────────────────────────

function BankAccountsModal({ user, accounts, onClose, onChanged }) {
  const [editing, setEditing] = useState(null); // row or 'new'
  const [form, setForm] = useState({ name: '', last4: '' });
  const [saving, setSaving] = useState(false);

  function openNew() { setEditing('new'); setForm({ name: '', last4: '' }); }
  function openEdit(a) { setEditing(a); setForm({ name: a.name || '', last4: a.last4 || '' }); }

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
        const { data, error } = await supabase
          .from('bank_accounts')
          .insert([{ ...payload, sort_order: sortOrder }])
          .select().single();
        if (error) throw error;
        const { logAudit } = await import('../../lib/audit');
        logAudit({ user, action: 'bank_account.create', entityType: 'bank_account', entityId: data.id, details: payload });
      } else {
        const { error } = await supabase.from('bank_accounts').update(payload).eq('id', editing.id);
        if (error) throw error;
        const { logAudit } = await import('../../lib/audit');
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
    const { logAudit } = await import('../../lib/audit');
    logAudit({
      user, action: a.active ? 'bank_account.deactivate' : 'bank_account.activate',
      entityType: 'bank_account', entityId: a.id, details: { name: a.name },
    });
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <p className="font-bold text-omega-charcoal flex items-center gap-2">
            <Banknote className="w-4 h-4 text-omega-orange" /> Bank Accounts
          </p>
          <button onClick={onClose}><X className="w-5 h-5 text-omega-stone" /></button>
        </div>

        <div className="p-4 space-y-3">
          {accounts.length === 0 && (
            <p className="text-sm text-omega-stone text-center py-2">
              Nenhuma conta cadastrada.
            </p>
          )}
          {accounts.map((a) => (
            <div key={a.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${a.active ? 'bg-white border-gray-200' : 'bg-omega-cloud border-gray-200 opacity-60'}`}>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-omega-charcoal text-sm truncate">{a.name}</p>
                <p className="text-[11px] text-omega-stone font-mono">
                  {a.last4 ? `··${a.last4}` : '—'} {!a.active && '· inactive'}
                </p>
              </div>
              <button
                onClick={() => openEdit(a)}
                className="p-1.5 rounded-lg text-omega-stone hover:bg-omega-cloud"
                title="Editar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => toggleActive(a)}
                className="text-[11px] font-semibold text-omega-stone hover:text-omega-charcoal px-2"
              >
                {a.active ? 'Disable' : 'Enable'}
              </button>
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
              <p className="font-bold text-omega-charcoal">
                {editing === 'new' ? 'Nova conta' : 'Editar conta'}
              </p>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-4 space-y-3">
              <Field label="Nome">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Wells Fargo Operations"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
                />
              </Field>
              <Field label="Últimos 4 dígitos">
                <input
                  value={form.last4}
                  onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  placeholder="9842"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
