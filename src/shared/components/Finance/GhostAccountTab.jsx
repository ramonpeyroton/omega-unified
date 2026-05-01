// GhostAccountTab — manual ledger of checks the office writes against
// the GHOST account. Lives inside Finance for owner/operations/admin
// only. Soft-deleted rows are excluded from the visible list and
// totals — full history stays in the DB for auditing.
//
// Each row: who got paid (sub, optional), which job (optional),
// paid date, check amount, check number (optional), notes (optional).

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, Receipt, AlertTriangle, Save, X, Loader2, Search,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { subInlineLabel } from '../../lib/subcontractor';

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

export default function GhostAccountTab({ user }) {
  const [payments, setPayments] = useState([]);
  const [subs, setSubs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(null); // null | { …row } | { __new: true }
  const [search, setSearch] = useState('');

  // ─── Initial + refresh load ──────────────────────────────────────
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);
  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: pays }, { data: ss }, { data: js }] = await Promise.all([
        supabase
          .from('ghost_payments')
          .select('*')
          .is('deleted_at', null)
          .order('paid_at', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('subcontractors')
          .select('id, name, contact_name')
          .order('name'),
        supabase
          .from('jobs')
          .select('id, client_name, address, city, pipeline_status')
          .order('created_at', { ascending: false }),
      ]);
      setPayments(pays || []);
      setSubs(ss || []);
      setJobs(js || []);
    } catch {
      // Most likely cause: migration 032 not yet applied. Empty UI is
      // fine — the table itself shows a friendly hint at the top.
    } finally {
      setLoading(false);
    }
  }

  // ─── Derived: this-month total + filtered list ──────────────────
  const monthTotal = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    return payments.reduce((acc, p) => {
      const d = p.paid_at ? new Date(p.paid_at) : null;
      if (!d) return acc;
      // paid_at is stored as DATE which JS parses as UTC midnight —
      // pull month/year off the underlying Date directly.
      if (d.getUTCFullYear() === y && d.getUTCMonth() === m) {
        return acc + Number(p.amount || 0);
      }
      return acc;
    }, 0);
  }, [payments]);

  const subsById = useMemo(() => {
    const m = new Map();
    for (const s of subs) m.set(s.id, s);
    return m;
  }, [subs]);
  const jobsById = useMemo(() => {
    const m = new Map();
    for (const j of jobs) m.set(j.id, j);
    return m;
  }, [jobs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) => {
      const sub = p.subcontractor_id ? subsById.get(p.subcontractor_id) : null;
      const job = p.job_id ? jobsById.get(p.job_id) : null;
      const hay = [
        sub?.name, sub?.contact_name,
        job?.client_name, job?.address, job?.city,
        p.check_number, p.notes,
        String(p.amount),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [payments, subsById, jobsById, search]);

  // ─── CRUD handlers ───────────────────────────────────────────────
  async function savePayment(form) {
    const isNew = !!form.__new;
    const payload = {
      subcontractor_id: form.subcontractor_id || null,
      job_id:           form.job_id || null,
      paid_at:          form.paid_at || todayISO(),
      amount:           Number(form.amount) || 0,
      check_number:     form.check_number?.trim() || null,
      notes:            form.notes?.trim() || null,
      updated_by:       user?.name || null,
      updated_at:       new Date().toISOString(),
    };
    if (isNew) {
      payload.created_by = user?.name || null;
    }

    if (isNew) {
      const { data, error } = await supabase
        .from('ghost_payments')
        .insert([payload])
        .select().single();
      if (error) throw error;
      setPayments((prev) => [data, ...prev]);
      logAudit({
        user, action: 'ghost_payment.create',
        entityType: 'ghost_payment', entityId: data.id,
        details: { amount: payload.amount, paid_at: payload.paid_at, sub: payload.subcontractor_id, job: payload.job_id },
      });
    } else {
      const { data, error } = await supabase
        .from('ghost_payments')
        .update(payload)
        .eq('id', form.id)
        .select().single();
      if (error) throw error;
      setPayments((prev) => prev.map((p) => p.id === data.id ? data : p));
      logAudit({
        user, action: 'ghost_payment.update',
        entityType: 'ghost_payment', entityId: data.id,
        details: { amount: payload.amount, paid_at: payload.paid_at, sub: payload.subcontractor_id, job: payload.job_id },
      });
    }
  }

  async function softDelete(row) {
    if (!confirm(`Delete this $${row.amount} payment? It will stay in the audit trail but won't show in the list.`)) return;
    const { error } = await supabase
      .from('ghost_payments')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.name || null })
      .eq('id', row.id);
    if (error) {
      alert('Failed to delete: ' + error.message);
      return;
    }
    setPayments((prev) => prev.filter((p) => p.id !== row.id));
    logAudit({
      user, action: 'ghost_payment.delete',
      entityType: 'ghost_payment', entityId: row.id,
      details: { amount: row.amount, paid_at: row.paid_at },
    });
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header strip: monthly total + actions */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-bold text-omega-stone uppercase tracking-wider">Pago este mês</p>
          <p className="text-2xl font-black text-omega-charcoal tabular-nums leading-none mt-1">
            {money(monthTotal)}
          </p>
          <p className="text-xs text-omega-stone mt-1">
            {payments.length} {payments.length === 1 ? 'cheque registrado' : 'cheques registrados'} no histórico ativo
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sub, client, check #, notes…"
              className="pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:border-omega-orange focus:outline-none w-72"
            />
          </div>
          <button
            onClick={() => setEditing({ __new: true, paid_at: todayISO() })}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold"
          >
            <Plus className="w-4 h-4" /> Register Payment
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-omega-stone">Loading payments…</p>
        ) : visible.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Receipt className="w-8 h-8 text-omega-fog mx-auto mb-2" />
            <p className="text-sm font-semibold text-omega-charcoal">
              {payments.length === 0 ? 'Nenhum pagamento registrado ainda.' : 'Nada bate com a busca.'}
            </p>
            {payments.length === 0 && (
              <p className="text-xs text-omega-stone mt-1">Clique em <strong>Register Payment</strong> pra começar.</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud text-omega-stone uppercase text-[11px] tracking-wider">
              <tr>
                <th className="px-4 py-2.5 text-left">Subcontractor</th>
                <th className="px-4 py-2.5 text-left">Project</th>
                <th className="px-4 py-2.5 text-left">Date</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 text-left">Check #</th>
                <th className="px-4 py-2.5 text-left">Notes</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((p) => {
                const sub = p.subcontractor_id ? subsById.get(p.subcontractor_id) : null;
                const job = p.job_id ? jobsById.get(p.job_id) : null;
                return (
                  <tr key={p.id} className="hover:bg-omega-cloud/40">
                    <td className="px-4 py-2.5 font-medium text-omega-charcoal">
                      {sub ? subInlineLabel(sub) : <span className="text-omega-fog italic">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-omega-slate">
                      {job ? (job.client_name || job.address || '—') : <span className="text-omega-fog italic">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-omega-slate">{shortDate(p.paid_at)}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-omega-charcoal tabular-nums">
                      {money(p.amount)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-omega-slate">{p.check_number || '—'}</td>
                    <td className="px-4 py-2.5 max-w-xs truncate text-omega-slate" title={p.notes || ''}>
                      {p.notes || <span className="text-omega-fog italic">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(p)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-omega-orange hover:bg-omega-pale"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => softDelete(p)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-red-600 hover:bg-red-50 ml-1"
                        title="Delete (soft)"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit hint */}
      <p className="text-[11px] text-omega-stone text-center">
        Each create / edit / delete is logged in the audit trail. Deleted rows stay in the database for auditing.
      </p>

      {editing && (
        <PaymentFormModal
          initial={editing}
          subs={subs}
          jobs={jobs}
          onClose={() => setEditing(null)}
          onSave={async (form) => {
            try {
              await savePayment(form);
              setEditing(null);
            } catch (err) {
              alert(err.message || 'Failed to save');
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: create / edit a payment ─────────────────────────────────
function PaymentFormModal({ initial, subs, jobs, onClose, onSave }) {
  const [form, setForm] = useState({
    id:               initial.id || null,
    __new:            !!initial.__new,
    subcontractor_id: initial.subcontractor_id || '',
    job_id:           initial.job_id || '',
    paid_at:          initial.paid_at || todayISO(),
    amount:           initial.amount || '',
    check_number:     initial.check_number || '',
    notes:            initial.notes || '',
  });
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!Number(form.amount) || Number(form.amount) <= 0) {
      alert('Amount must be greater than zero.');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <p className="font-bold text-omega-charcoal">
            {form.__new ? 'Register Payment' : 'Edit Payment'}
          </p>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-omega-stone" /></button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-omega-stone uppercase">Subcontractor (optional)</label>
            <select
              value={form.subcontractor_id}
              onChange={(e) => set('subcontractor_id', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            >
              <option value="">— No specific sub (solo payment) —</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>{subInlineLabel(s)}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-omega-stone uppercase">Project (optional)</label>
            <select
              value={form.job_id}
              onChange={(e) => set('job_id', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            >
              <option value="">— No specific project —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.client_name || '(unnamed)'}
                  {j.address && ` — ${j.address.split(',')[0]}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase">Date *</label>
            <input
              type="date"
              required
              value={form.paid_at}
              onChange={(e) => set('paid_at', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-omega-stone uppercase">Check Amount ($) *</label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm tabular-nums"
              placeholder="0.00"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-omega-stone uppercase">Check Number (optional)</label>
            <input
              type="text"
              value={form.check_number}
              onChange={(e) => set('check_number', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono"
              placeholder="e.g. 1042"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-semibold text-omega-stone uppercase">Notes (optional)</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none"
              placeholder="Anything to remember about this payment…"
            />
          </div>
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save</>}
          </button>
        </div>
      </form>
    </div>
  );
}
