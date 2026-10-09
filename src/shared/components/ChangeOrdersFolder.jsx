// ChangeOrdersFolder — the "Change Orders" block in a job's Documents tab.
// Sits next to Estimates and behaves like it: lists each change order with
// its status + amount + a link to the signable public page. "+ Add" (and
// "Edit" on any unsigned row) opens ChangeOrderEditor; on save the list
// refreshes. Each unsigned row can be emailed to the client (or its link
// copied) or voided (PIN) so the client can no longer sign it. A signed
// change order's amount is added to the job's revenue by the financials
// layer.

import { useEffect, useState } from 'react';
import {
  FileText, Plus, Send, Link as LinkIcon, ExternalLink, Loader2, Pencil, Ban,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch';
import { logAudit } from '../lib/audit';
import { validateUserPinDetailed } from '../lib/userPin';
import { coItems, isLegacyCo, isCoVoid } from '../lib/changeOrders';
import ChangeOrderEditor from './ChangeOrderEditor';

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
  void:     { label: 'VOID',     cls: 'bg-gray-100 text-gray-500 line-through' },
};

const PIN_ERRORS = {
  wrong_pin:     'Wrong PIN — try again.',
  role_mismatch: 'PIN matches a different role.',
  name_mismatch: 'PIN belongs to another user.',
  query_failed:  'Network error — try again.',
};

export default function ChangeOrdersFolder({ job, user }) {
  const [cos, setCos] = useState([]);
  const [loading, setLoading] = useState(true);
  // null = closed · { co: null } = new · { co: row } = editing that row
  const [editor, setEditor] = useState(null);
  const [voiding, setVoiding] = useState(null); // row waiting for the PIN
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
  const nextNumber = Math.max(0, ...cos.map((c) => Number(c.co_number) || 0)) + 1;

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

  // Called by the PIN modal once the PIN checks out.
  async function voidCo(co) {
    const { error: dbErr } = await supabase.from('change_orders')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('id', co.id);
    if (dbErr) throw new Error(dbErr.message || 'Failed to void the change order.');
    logAudit({ user, action: 'change_order.void', entityType: 'change_order', entityId: co.id, details: { job_id: job.id, co_number: co.co_number, amount: co.amount, was: co.status } });
    setVoiding(null);
    await load();
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
        <button onClick={() => { setError(''); setEditor({ co: null }); }} className="inline-flex items-center gap-1 text-omega-orange hover:text-omega-dark text-xs font-bold">
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
          const isVoid = isCoVoid(co);
          const link = co.pdf_url || coLink(co.id);
          const itemCount = isLegacyCo(co) ? 0 : coItems(co).length;
          return (
            <div key={co.id} className={`px-4 py-3 border-t border-gray-100 flex items-start gap-3 hover:bg-white first:border-t-0 ${isVoid ? 'opacity-60' : ''}`}>
              <div className="w-10 h-10 rounded-lg bg-omega-pale flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-omega-orange" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-omega-charcoal">{co.co_number ? `#CO-${co.co_number}` : 'Change Order'}</p>
                  <span className={`flex-shrink-0 inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                </div>
                <p className="text-[12px] text-omega-charcoal mt-0.5 break-words">
                  {co.title || co.description || '—'}
                  {itemCount > 1 && <span className="text-omega-stone"> · {itemCount} items</span>}
                </p>
                <p className="text-[11px] text-omega-stone mt-0.5">
                  {isSigned
                    ? <>Signed by <strong>{co.signed_by || 'client'}</strong>{co.signed_at ? ` · ${new Date(co.signed_at).toLocaleDateString()}` : ''}</>
                    : isVoid
                      ? <>Voided{co.updated_at ? ` ${new Date(co.updated_at).toLocaleDateString()}` : ''} · the client can no longer sign it</>
                      : co.sent_at
                        ? <>Sent {new Date(co.sent_at).toLocaleDateString()}{co.client_opened_at ? ' · opened' : ''}</>
                        : <>Created {new Date(co.created_at).toLocaleDateString()}</>}
                </p>
                {!isSigned && !isVoid && (
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
                      onClick={() => { setError(''); setEditor({ co }); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-omega-orange text-[11px] font-semibold text-omega-charcoal"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => copyLink(co)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-omega-orange text-[11px] font-semibold text-omega-charcoal"
                    >
                      <LinkIcon className="w-3 h-3" /> {copiedId === co.id ? 'Copied!' : 'Link'}
                    </button>
                    <button
                      onClick={() => { setError(''); setVoiding(co); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-red-300 hover:text-red-600 text-[11px] font-semibold text-omega-stone"
                      title="Cancel this change order so the client can no longer sign it"
                    >
                      <Ban className="w-3 h-3" /> Void
                    </button>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <p className={`text-sm font-black tabular-nums ${isVoid ? 'text-omega-stone line-through' : 'text-omega-charcoal'}`}>{money(co.amount)}</p>
                <a href={link} target="_blank" rel="noopener noreferrer" className="text-omega-stone hover:text-omega-orange" title="Open the change order the client sees">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          );
        })
      )}

      {editor && (
        <ChangeOrderEditor
          job={job}
          user={user}
          co={editor.co}
          nextNumber={nextNumber}
          onClose={() => setEditor(null)}
          onSaved={() => load()}
        />
      )}

      {voiding && (
        <VoidPinModal
          co={voiding}
          user={user}
          onClose={() => setVoiding(null)}
          onConfirm={() => voidCo(voiding)}
        />
      )}
    </div>
  );
}

// PIN gate before voiding — same pattern as the other terminal actions
// (validateUserPinDetailed against the logged-in user's own PIN).
function VoidPinModal({ co, user, onClose, onConfirm }) {
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (!pin.trim()) { setError('Enter your PIN'); return; }
    setVerifying(true);
    setError('');
    try {
      const result = await validateUserPinDetailed({ name: user?.name, role: user?.role }, pin);
      if (!result.ok) { setError(PIN_ERRORS[result.reason] || 'Invalid PIN'); return; }
      await onConfirm();
    } catch (err) {
      setError(err?.message || 'Verification failed — try again');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={() => !verifying && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <Ban className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-omega-charcoal">Void #CO-{co.co_number} · {money(co.amount)}</h3>
            <p className="text-xs text-omega-stone mt-0.5">Enter your PIN to confirm.</p>
          </div>
        </div>
        <p className="text-xs text-omega-stone mb-4 leading-relaxed">
          The client will no longer be able to sign this change order — the link shows it as cancelled.
          It never counts toward the job&rsquo;s revenue. This can&rsquo;t be undone.
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
          placeholder="Your PIN"
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-base mb-2 focus:outline-none focus:border-omega-orange text-center tracking-widest"
        />
        {error && <p className="text-xs text-red-600 mb-2 text-center">{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} disabled={verifying} className="px-4 py-2.5 rounded-lg text-sm font-semibold text-omega-slate hover:bg-gray-100 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={confirm} disabled={verifying} className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
            {verifying ? 'Verifying…' : 'Void change order'}
          </button>
        </div>
      </div>
    </div>
  );
}
