import { useState, useEffect } from 'react';
import { Eye, Download, RotateCw, X, Plus, Copy, DollarSign, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getEnvelopeStatus, sendReminder, downloadSignedDocument } from '../../../shared/lib/docusign';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import StatusBadge from '../components/StatusBadge';
import { logAudit } from '../../../shared/lib/audit';
import { findSimilarItems } from '../../../shared/lib/textSimilarity';

export default function ContractManager({ user }) {
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [toast, setToast] = useState(null);
  const [openDetail, setOpenDetail] = useState(null); // contract row
  const [timeline, setTimeline] = useState([]);
  const [showCO, setShowCO] = useState(false);
  const [coForm, setCoForm] = useState({ job_id: '', description: '', amount: 0, reason: '' });
  // Similarity warning state — when the operator hits Submit, we run
  // a Jaccard match against every line item already on the estimate /
  // signed contract for that job. If anything looks duplicate, we
  // pause the insert and show this modal so they can decide whether
  // to continue billing for an already-billed scope.
  const [coWarning, setCoWarning] = useState(null); // { matches: [...], original: {coForm}, contractId }

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: c }, { data: j }, { data: co }] = await Promise.all([
        supabase.from('contracts').select('*').order('created_at', { ascending: false }),
        supabase.from('jobs').select('*'),
        supabase.from('change_orders').select('*').order('created_at', { ascending: false }),
      ]);
      setContracts(c || []);
      setJobs(j || []);
      setChangeOrders(co || []);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to load contracts' });
    } finally {
      setLoading(false);
    }
  }

  function jobOf(contract) {
    return jobs.find((j) => j.id === contract.job_id);
  }

  async function openDetailModal(contract) {
    setOpenDetail(contract);
    setTimeline([]);
    if (!contract.docusign_envelope_id) return;
    try {
      const { status, completedAt, history } = await getEnvelopeStatus(contract.docusign_envelope_id);
      setTimeline(history || []);
      if (status && status !== contract.docusign_status) {
        const patch = { docusign_status: status };
        if (status === 'completed' && completedAt) { patch.signed_at = completedAt; patch.status = 'signed'; }
        const { data } = await supabase.from('contracts').update(patch).eq('id', contract.id).select().single();
        if (data) {
          setContracts((prev) => prev.map((c) => c.id === data.id ? data : c));
          setOpenDetail(data);
        }
      }
    } catch (err) {
      // silent
    }
  }

  async function resend(contract) {
    if (!contract.docusign_envelope_id) { setToast({ type: 'warning', message: 'No envelope to resend' }); return; }
    try {
      await sendReminder(contract.docusign_envelope_id);
      setToast({ type: 'success', message: 'Reminder sent' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send reminder' });
    }
  }

  async function downloadPdf(contract) {
    if (!contract.docusign_envelope_id) { setToast({ type: 'warning', message: 'No envelope to download' }); return; }
    try {
      const blob = await downloadSignedDocument(contract.docusign_envelope_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `contract-${contract.id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Download failed' });
    }
  }

  async function togglePaid(co) {
    const nextPaid = !co.paid;
    const patch = { paid: nextPaid, paid_at: nextPaid ? new Date().toISOString() : null };
    // Optimistic update
    setChangeOrders((prev) => prev.map((c) => c.id === co.id ? { ...c, ...patch } : c));
    const { error } = await supabase.from('change_orders').update(patch).eq('id', co.id);
    if (error) {
      // Revert
      setChangeOrders((prev) => prev.map((c) => c.id === co.id ? co : c));
      setToast({ type: 'error', message: error.message });
    } else {
      logAudit({ user, action: nextPaid ? 'change_order.mark_paid' : 'change_order.mark_unpaid', entityType: 'change_order', entityId: co.id, details: { job_id: co.job_id, amount: co.amount } });
    }
  }

  function copyChangeOrderMessage(co) {
    const j = jobs.find((x) => x.id === co.job_id);
    const jobName = j?.name || j?.client_name || '—';
    const client = j?.client_name || '—';
    const amount = Number(co.amount || 0).toLocaleString();
    const message =
`Change Order — ${jobName}
Client: ${client}
Description: ${co.description || '—'}
Amount: $${amount}
Reason: ${co.reason || '—'}
Status: ${co.status || 'pending'}

Please confirm your approval.
— Omega Development LLC`;
    navigator.clipboard.writeText(message).then(
      () => setToast({ type: 'success', message: 'Message copied to clipboard!' }),
      () => setToast({ type: 'error', message: 'Failed to copy message' })
    );
  }

  async function submitChangeOrder(e) {
    e.preventDefault();
    if (!coForm.job_id) { setToast({ type: 'warning', message: 'Select a job' }); return; }
    const contract = contracts.find((c) => c.job_id === coForm.job_id);

    // Pull every line item already on this job's estimates and signed
    // contract, then look for one that overlaps with what we're about
    // to bill. Matches are sorted by score so the closest duplicate is
    // shown first in the warning modal.
    const text = `${coForm.description || ''} ${coForm.reason || ''}`.trim();
    let matches = [];
    if (text) {
      try {
        const [{ data: ests }, { data: ctrs }] = await Promise.all([
          supabase.from('estimates').select('id, estimate_number, status, sections')
            .eq('job_id', coForm.job_id).in('status', ['approved', 'signed', 'sent']),
          supabase.from('contracts').select('id, line_items, signed_at')
            .eq('job_id', coForm.job_id).not('signed_at', 'is', null),
        ]);
        const flat = [];
        for (const e of (ests || [])) {
          for (const sec of (Array.isArray(e.sections) ? e.sections : [])) {
            for (const it of (sec.items || [])) {
              flat.push({
                description: it.description,
                scope: it.scope,
                _source: `Estimate OM-${e.estimate_number || '?'} (${e.status})`,
              });
            }
          }
        }
        for (const c of (ctrs || [])) {
          for (const it of (Array.isArray(c.line_items) ? c.line_items : [])) {
            flat.push({
              description: it.description,
              scope: it.scope,
              _source: 'Signed contract',
            });
          }
        }
        matches = findSimilarItems(text, flat, 0.5);
      } catch { /* if the lookup fails, just skip the warning */ }
    }

    if (matches.length > 0) {
      // Pause the insert and let the operator decide.
      setCoWarning({ matches, contract });
      return;
    }
    await actuallyInsertChangeOrder({ contract });
  }

  async function actuallyInsertChangeOrder({ contract }) {
    const { data, error } = await supabase.from('change_orders').insert([{
      job_id: coForm.job_id,
      contract_id: contract?.id || null,
      status: 'pending',
      description: coForm.description,
      amount: Number(coForm.amount) || 0,
      reason: coForm.reason,
    }]).select().single();
    if (error) { setToast({ type: 'error', message: error.message }); return; }
    setChangeOrders((prev) => [data, ...prev]);
    logAudit({ user, action: 'change_order.create', entityType: 'change_order', entityId: data.id, details: { job_id: data.job_id, amount: data.amount, reason: data.reason } });
    setShowCO(false);
    setCoWarning(null);
    setCoForm({ job_id: '', description: '', amount: 0, reason: '' });
    setToast({ type: 'success', message: 'Change order created' });
  }

  if (loading) return <div className="flex-1 flex items-center justify-center"><LoadingSpinner size={32} /></div>;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="px-6 md:px-8 py-6 bg-white border-b border-gray-200 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-omega-charcoal">Contracts</h1>
        <p className="text-sm text-omega-stone mt-1">DocuSign status, history and change orders</p>
      </header>

      <div className="p-6 md:p-8 space-y-6">
        {/* Contracts table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Job</th>
                <th className="px-4 py-3 text-left">Client</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">DocuSign</th>
                <th className="px-4 py-3 text-left">Sent</th>
                <th className="px-4 py-3 text-left">Signed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contracts.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-omega-stone">No contracts yet.</td></tr>
              )}
              {contracts.map((c) => {
                const j = jobOf(c);
                return (
                  <tr key={c.id} className="hover:bg-omega-cloud/40">
                    <td className="px-4 py-3 font-medium text-omega-charcoal">{j?.name || j?.client_name || '—'}</td>
                    <td className="px-4 py-3">{j?.client_name || '—'}</td>
                    <td className="px-4 py-3">{c.total_amount != null ? `$${Number(c.total_amount).toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.docusign_status || c.status} /></td>
                    <td className="px-4 py-3">{c.sent_at ? new Date(c.sent_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">{c.signed_at ? new Date(c.signed_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button onClick={() => openDetailModal(c)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark"><Eye className="w-3.5 h-3.5" /> View</button>
                        <button onClick={() => downloadPdf(c)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-info hover:text-blue-900"><Download className="w-3.5 h-3.5" /> PDF</button>
                        <button onClick={() => resend(c)} className="inline-flex items-center gap-1 text-xs font-semibold text-omega-slate hover:text-omega-charcoal"><RotateCw className="w-3.5 h-3.5" /> Resend</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Change Orders */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div>
              <h2 className="text-base font-bold text-omega-charcoal">Change Orders</h2>
              <p className="text-xs text-omega-stone">Pending / approved / rejected</p>
            </div>
            <button onClick={() => setShowCO(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">
              <Plus className="w-4 h-4" /> New Change Order
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-omega-cloud text-omega-stone uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Job</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Amount</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Paid</th>
                  <th className="px-4 py-3 text-center">Msg</th>
                  <th className="px-4 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {changeOrders.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-omega-stone">No change orders yet.</td></tr>
                )}
                {changeOrders.map((co) => {
                  const j = jobs.find((x) => x.id === co.job_id);
                  return (
                    <tr key={co.id} className="hover:bg-omega-cloud/40">
                      <td className="px-4 py-3">{j?.client_name || j?.name || '—'}</td>
                      <td className="px-4 py-3">{co.description || '—'}</td>
                      <td className="px-4 py-3">${Number(co.amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">{co.reason || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={co.status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!co.paid}
                              onChange={() => togglePaid(co)}
                              className="w-4 h-4 rounded border-gray-300 text-omega-success focus:ring-omega-success"
                            />
                            <span className={`text-xs font-semibold ${co.paid ? 'text-omega-success' : 'text-omega-stone'}`}>
                              {co.paid ? 'Paid' : 'Unpaid'}
                            </span>
                          </label>
                          {co.paid && co.paid_at && (
                            <span className="text-[10px] text-omega-stone mt-0.5">{new Date(co.paid_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => copyChangeOrderMessage(co)}
                          title="Copy message to clipboard"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-omega-stone hover:text-omega-orange hover:bg-omega-pale transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </td>
                      <td className="px-4 py-3">{new Date(co.created_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Contract detail modal */}
      {openDetail && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpenDetail(null)}>
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <p className="text-xs uppercase text-omega-stone font-semibold">Contract</p>
                <p className="font-bold text-omega-charcoal">{jobOf(openDetail)?.client_name || '—'}</p>
              </div>
              <button onClick={() => setOpenDetail(null)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-omega-stone">Envelope ID</p><p className="font-mono text-xs break-all">{openDetail.docusign_envelope_id || '—'}</p></div>
                <div><p className="text-xs text-omega-stone">Status</p><p><StatusBadge status={openDetail.docusign_status || openDetail.status} /></p></div>
                <div><p className="text-xs text-omega-stone">Sent</p><p>{openDetail.sent_at ? new Date(openDetail.sent_at).toLocaleString() : '—'}</p></div>
                <div><p className="text-xs text-omega-stone">Signed</p><p>{openDetail.signed_at ? new Date(openDetail.signed_at).toLocaleString() : '—'}</p></div>
              </div>

              <div>
                <p className="text-sm font-semibold text-omega-charcoal mb-2">Timeline</p>
                <ol className="border-l-2 border-gray-200 pl-4 space-y-3">
                  {timeline.length === 0 && <li className="text-xs text-omega-stone">No envelope history available.</li>}
                  {timeline.map((ev, i) => (
                    <li key={i}>
                      <p className="text-sm font-medium text-omega-charcoal">{ev.event}</p>
                      <p className="text-xs text-omega-stone">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ''} {ev.actor ? `— ${ev.actor}` : ''}</p>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
                <button onClick={() => downloadPdf(openDetail)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold hover:border-omega-orange">Download PDF</button>
                <button onClick={() => resend(openDetail)} className="px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">Resend</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Similarity warning — surfaces overlapping line items already
          billed on this job's estimates / signed contract before the
          insert lands. Operator can still continue (legitimate cases:
          e.g. additional fixtures of the same kind), but they are
          forced to acknowledge the duplicate first. */}
      {coWarning && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={() => setCoWarning(null)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-5 border-b border-amber-200 bg-amber-50">
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-amber-900">Looks like this might already be billed</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  {coWarning.matches.length} item{coWarning.matches.length === 1 ? '' : 's'} on prior estimate / contract overlap with what you're about to charge.
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-omega-stone">
                <strong className="text-omega-charcoal">You're billing:</strong> "{coForm.description}"{coForm.amount ? ` — $${Number(coForm.amount).toLocaleString('en-US')}` : ''}
              </p>
              <div className="space-y-2">
                {coWarning.matches.map((m, i) => (
                  <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="text-sm font-bold text-omega-charcoal">{m.description || '(no description)'}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                        {Math.round(m._score * 100)}% match
                      </span>
                    </div>
                    {m.scope && <p className="text-xs text-omega-slate mt-0.5 line-clamp-2">{m.scope}</p>}
                    <p className="text-[10px] text-omega-stone mt-1 italic">From: {m._source}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-omega-stone">
                If this Change Order is for <strong>extra</strong> work beyond what's listed above (e.g. extra fixtures, extra footage), continue. If it's the same scope, hit Cancel and adjust.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setCoWarning(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-omega-charcoal text-sm font-bold"
              >
                Cancel — let me adjust
              </button>
              <button
                type="button"
                onClick={() => actuallyInsertChangeOrder({ contract: coWarning.contract })}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New change order modal */}
      {showCO && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowCO(false)}>
          <form onSubmit={submitChangeOrder} className="bg-white rounded-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <p className="font-bold text-omega-charcoal">New Change Order</p>
              <button type="button" onClick={() => setShowCO(false)}><X className="w-5 h-5 text-omega-stone" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Job</label>
                <select required value={coForm.job_id} onChange={(e) => setCoForm({ ...coForm, job_id: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  <option value="">Select a job…</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.client_name || j.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Description</label>
                <textarea required value={coForm.description} onChange={(e) => setCoForm({ ...coForm, description: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" rows={3} />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Amount</label>
                <input type="number" required value={coForm.amount} onChange={(e) => setCoForm({ ...coForm, amount: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-omega-stone uppercase">Reason</label>
                <input value={coForm.reason} onChange={(e) => setCoForm({ ...coForm, reason: e.target.value })} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCO(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
