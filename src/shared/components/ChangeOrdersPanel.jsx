// ChangeOrdersPanel — create, send and track signable Change Orders for
// a single job, from inside the job card (JobFullView → Financials tab).
//
// A Change Order works like a mini-estimate: create it, email the client
// a signable link (/change-order-view/:id), and when they sign it online
// the status flips to 'signed' and its amount is added to the job's
// revenue by the financials layer (jobFinancials.sumSignedChangeOrders).
//
// Backend:
//   - send  → /api/send-estimate  { changeOrderId }        (requireSecret)
//   - sign  → /api/sign-estimate  { change_order_id, ... } (public page)

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Send, Link as LinkIcon, CheckCircle2, Clock, FileText, Loader2, X, DollarSign,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch';
import { logAudit } from '../lib/audit';

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_META = {
  draft:  { label: 'Draft',  cls: 'bg-gray-100 text-gray-600', Icon: FileText },
  sent:   { label: 'Sent',   cls: 'bg-blue-50 text-blue-700',  Icon: Clock },
  signed: { label: 'Signed', cls: 'bg-green-50 text-omega-success', Icon: CheckCircle2 },
  // Legacy values still render sensibly.
  pending:  { label: 'Pending',  cls: 'bg-amber-50 text-omega-warning', Icon: Clock },
  approved: { label: 'Approved', cls: 'bg-green-50 text-omega-success', Icon: CheckCircle2 },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-600', Icon: X },
};

export default function ChangeOrdersPanel({ job, user, onChanged }) {
  const [cos, setCos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  async function load() {
    if (!job?.id) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('change_orders').select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });
      setCos(data || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  const signedTotal = useMemo(
    () => cos.filter((c) => c.status === 'signed').reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [cos]
  );

  function coLink(id) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/change-order-view/${id}`;
  }

  async function create(e) {
    e.preventDefault();
    setError('');
    const amount = Number(form.amount);
    if (!form.description.trim()) { setError('Add a description.'); return; }
    if (!(amount > 0)) { setError('Enter the additional amount.'); return; }
    setSaving(true);
    try {
      const nextNum = Math.max(0, ...cos.map((c) => Number(c.co_number) || 0)) + 1;
      const { data, error: insErr } = await supabase.from('change_orders').insert([{
        job_id: job.id,
        co_number: nextNum,
        status: 'draft',
        description: form.description.trim(),
        amount,
        reason: form.reason.trim() || null,
        created_by: user?.name || null,
      }]).select().single();
      if (insErr) throw insErr;
      setCos((prev) => [data, ...prev]);
      logAudit({ user, action: 'change_order.create', entityType: 'change_order', entityId: data.id, details: { job_id: job.id, amount, reason: form.reason } });
      setForm({ description: '', amount: '', reason: '' });
      setShowForm(false);
    } catch (err) {
      setError(err.message || 'Failed to create change order.');
    } finally {
      setSaving(false);
    }
  }

  async function send(co) {
    if (busyId) return;
    setError('');
    if (!job?.client_email) { setError('This client has no email on file — add one on the Details tab, or copy the link and send it manually.'); return; }
    setBusyId(co.id);
    try {
      const r = await apiFetch('/api/send-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-omega-user': user?.name || '', 'x-omega-role': user?.role || '' },
        body: JSON.stringify({ changeOrderId: co.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error || `Send failed (HTTP ${r.status})`);
      logAudit({ user, action: 'change_order.send', entityType: 'change_order', entityId: co.id, details: { job_id: job.id, to: job.client_email } });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Failed to send.');
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(co) {
    try {
      await navigator.clipboard.writeText(coLink(co.id));
      setCopiedId(co.id);
      setTimeout(() => setCopiedId((v) => (v === co.id ? null : v)), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-base font-bold text-omega-charcoal">Change Orders</h3>
          <p className="text-xs text-omega-stone mt-0.5">
            Signable online. Signed change orders add to this job&apos;s revenue
            {signedTotal > 0 && <> — <span className="font-bold text-omega-success">+{money(signedTotal)}</span> signed</>}.
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setError(''); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}

      {showForm && (
        <form onSubmit={create} className="mb-4 rounded-xl border border-gray-200 p-3 space-y-3 bg-omega-cloud/40">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">Description of change</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="e.g. Add recessed lighting in living room (4 cans)"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-sm"
            />
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="w-40">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">Additional amount</label>
              <div className="relative">
                <DollarSign className="w-3.5 h-3.5 text-omega-stone absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full pl-7 pr-2 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-sm font-semibold"
                />
              </div>
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">Reason (optional)</label>
              <input
                type="text"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="e.g. Client request"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 rounded-lg text-sm font-semibold text-omega-stone hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-omega-stone" /></div>
      ) : cos.length === 0 ? (
        <p className="text-sm text-omega-stone text-center py-6">No change orders yet. Create one to send it to the client for signature.</p>
      ) : (
        <div className="space-y-2">
          {cos.map((co) => {
            const meta = STATUS_META[co.status] || STATUS_META.draft;
            const isSigned = co.status === 'signed';
            return (
              <div key={co.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-omega-charcoal">{co.co_number ? `#CO-${co.co_number}` : 'Change Order'}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.cls}`}>
                        <meta.Icon className="w-3 h-3" /> {meta.label}
                      </span>
                    </div>
                    <p className="text-sm text-omega-charcoal mt-1 break-words">{co.description || '—'}</p>
                    {co.reason && <p className="text-[11px] text-omega-stone mt-0.5">Reason: {co.reason}</p>}
                    {isSigned && (
                      <p className="text-[11px] text-omega-success mt-1">
                        Signed by {co.signed_by || 'client'}{co.signed_at ? ` · ${new Date(co.signed_at).toLocaleDateString()}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-black text-omega-charcoal tabular-nums">{money(co.amount)}</p>
                  </div>
                </div>

                {!isSigned && (
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => send(co)}
                      disabled={busyId === co.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-xs font-bold disabled:opacity-50"
                    >
                      {busyId === co.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      {co.status === 'sent' ? 'Resend' : 'Send to client'}
                    </button>
                    <button
                      onClick={() => copyLink(co)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-omega-orange text-xs font-semibold text-omega-charcoal"
                    >
                      <LinkIcon className="w-3.5 h-3.5" /> {copiedId === co.id ? 'Copied!' : 'Copy link'}
                    </button>
                    {co.status === 'sent' && co.client_opened_at && (
                      <span className="text-[11px] text-omega-stone">Opened {new Date(co.client_opened_at).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
