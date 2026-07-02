// ChangeOrdersFolder — the "Change Orders" block in a job's Documents tab.
// Sits next to Estimates and behaves like it: lists each change order with
// its status + amount + a link to the signable public page. The "+ Add"
// opens a full-screen popup to create one; on save it closes and the new
// change order shows up in the list. Each unsigned row can be emailed to
// the client (or its link copied). A signed change order's amount is added
// to the job's revenue by the financials layer.

import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, X, Send, Link as LinkIcon, ExternalLink, Loader2, DollarSign, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch';
import { logAudit } from '../lib/audit';

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const STATUS_META = {
  draft:    { label: 'DRAFT',    cls: 'bg-gray-200 text-gray-700' },
  sent:     { label: 'SENT',     cls: 'bg-blue-100 text-blue-700' },
  signed:   { label: 'SIGNED',   cls: 'bg-emerald-600 text-white' },
  pending:  { label: 'PENDING',  cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'APPROVED', cls: 'bg-green-100 text-green-800' },
  rejected: { label: 'REJECTED', cls: 'bg-red-100 text-red-700' },
};

export default function ChangeOrdersFolder({ job, user }) {
  const [cos, setCos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
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

  const coLink = (id) => `${typeof window !== 'undefined' ? window.location.origin : ''}/change-order-view/${id}`;

  function openModal() { setForm({ description: '', amount: '', reason: '' }); setError(''); setShowModal(true); }

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
      setShowModal(false);
    } catch (err) {
      setError(err.message || 'Failed to create change order.');
    } finally {
      setSaving(false);
    }
  }

  async function send(co) {
    if (busyId) return;
    setError('');
    if (!job?.client_email) { setError('This client has no email on file — copy the link and send it manually, or add an email on the Details tab.'); return; }
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-100 flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-omega-pale flex items-center justify-center">
          <FileText className="w-4 h-4 text-omega-orange" />
        </div>
        <h3 className="text-sm font-bold text-omega-charcoal flex-1">Change Orders</h3>
        <span className="text-[10px] font-bold text-omega-stone bg-gray-100 px-2 py-0.5 rounded-full">{cos.length}</span>
        <button onClick={openModal} className="inline-flex items-center gap-1 text-omega-orange hover:text-omega-dark text-xs font-bold">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {error && <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-omega-stone" /></div>
      ) : cos.length === 0 ? (
        <p className="px-4 py-5 text-xs text-omega-stone italic text-center">No change orders yet. Tap &ldquo;Add&rdquo; to create one.</p>
      ) : (
        cos.map((co) => {
          const meta = STATUS_META[co.status] || STATUS_META.draft;
          const isSigned = co.status === 'signed';
          const link = co.pdf_url || coLink(co.id);
          return (
            <div key={co.id} className="px-4 py-3 border-t border-gray-100 flex items-start gap-3 hover:bg-white first:border-t-0">
              <div className="w-10 h-10 rounded-lg bg-omega-pale flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-omega-orange" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-omega-charcoal">{co.co_number ? `#CO-${co.co_number}` : 'Change Order'}</p>
                  <span className={`flex-shrink-0 inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                </div>
                <p className="text-[12px] text-omega-charcoal mt-0.5 break-words">{co.description || '—'}</p>
                <p className="text-[11px] text-omega-stone mt-0.5">
                  {isSigned
                    ? <>Signed by <strong>{co.signed_by || 'client'}</strong>{co.signed_at ? ` · ${new Date(co.signed_at).toLocaleDateString()}` : ''}</>
                    : co.sent_at
                      ? <>Sent {new Date(co.sent_at).toLocaleDateString()}{co.client_opened_at ? ' · opened' : ''}</>
                      : <>Created {new Date(co.created_at).toLocaleDateString()}</>}
                </p>
                {!isSigned && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button
                      onClick={() => send(co)}
                      disabled={busyId === co.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-omega-orange hover:bg-omega-dark text-white text-[11px] font-bold disabled:opacity-50"
                    >
                      {busyId === co.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      {co.status === 'sent' ? 'Resend' : 'Send'}
                    </button>
                    <button
                      onClick={() => copyLink(co)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-omega-orange text-[11px] font-semibold text-omega-charcoal"
                    >
                      <LinkIcon className="w-3 h-3" /> {copiedId === co.id ? 'Copied!' : 'Link'}
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <p className="text-sm font-black text-omega-charcoal tabular-nums">{money(co.amount)}</p>
                <a href={link} target="_blank" rel="noopener noreferrer" className="text-omega-stone hover:text-omega-orange" title="Open the change order the client sees">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          );
        })
      )}

      {/* Full-screen create popup */}
      {showModal && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="inline-flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-omega-pale inline-flex items-center justify-center">
                  <FileText className="w-4 h-4 text-omega-orange" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-omega-charcoal">New Change Order</h3>
                  <p className="text-[11px] text-omega-stone">{job?.client_name || 'Job'}</p>
                </div>
              </div>
              <button onClick={() => !saving && setShowModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-omega-stone" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>

            <form onSubmit={create} className="p-5 space-y-4">
              {error && <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1">Description of change</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  autoFocus
                  placeholder="e.g. Add recessed lighting in living room (4 cans)"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-sm"
                />
              </div>
              <div className="flex gap-3 flex-wrap">
                <div className="w-44">
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
            </form>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
              <button onClick={() => setShowModal(false)} disabled={saving} className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-white text-sm font-bold text-omega-charcoal disabled:opacity-60">Cancel</button>
              <button onClick={create} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60">
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="w-4 h-4" /> Create</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
