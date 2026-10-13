import { useCallback, useEffect, useState } from 'react';
import {
  ShoppingCart, AlertTriangle, CheckCircle2, X, Send, Eye, Copy, Check, Plus, Trash2,
  Loader2, Settings2, ChevronUp, ChevronDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiFetch';
import { logAudit } from '../../lib/audit';
import { clientEmails } from '../../lib/clientEmails';
import {
  STATUSES, CAN_EDIT_PURCHASE, isPurchaseEligible, listProgress, loadPurchaseList,
  createDraftList, setItemStatus, purchaseLink, syncListStatus,
} from '../../lib/purchaseLists';
import PurchaseTemplateEditor from './PurchaseTemplateEditor';

// Top of the Phases tab: the client's purchase list (migration 088).
// Only a heads-up — it never blocks the work (Ramon, 13/10/26).
//   no list   → editors get "Create list" (normally the contract signature
//               drafts it automatically)
//   draft     → "ready to review" → Attila reviews, writes notes, sends
//   sent      → "not complete — 12 of 17 at the house · 3 ordered…"
//   complete  → green line
// Editors (sales / owner / operations / admin) manage items, notes, statuses
// on the client's behalf, send / resend and edit the default lists. Everyone
// else (the field) sees the list read-only.

const fmtDay = (key) => {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function PurchaseListPanel({ job, user }) {
  const [data, setData] = useState({ list: null, items: [] });
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const canEdit = CAN_EDIT_PURCHASE.has(user?.role);

  const reload = useCallback(async () => {
    try {
      setData(await loadPurchaseList(job.id));
      setMissingTable(false);
    } catch (e) {
      // Migration 088 not run yet → stay quiet instead of breaking Phases.
      if (/purchase_lists|relation|schema cache/i.test(e?.message || '')) setMissingTable(true);
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => { reload(); }, [reload]);

  // Live: the client marks something while the tab is open.
  useEffect(() => {
    if (!data.list?.id) return undefined;
    const ch = supabase.channel(`pl-panel-${data.list.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_list_items', filter: `list_id=eq.${data.list.id}` }, () => reload())
      .subscribe();
    // Safety net if realtime drops: re-read every 60s while the tab is open.
    const poll = setInterval(reload, 60_000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [data.list?.id, reload]);

  if (loading || missingTable) return null;
  const { list, items } = data;

  if (!list) {
    if (!canEdit || !isPurchaseEligible(job)) return null;
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-3 flex flex-wrap items-center gap-3">
        <ShoppingCart className="w-5 h-5 text-omega-stone" />
        <p className="flex-1 min-w-0 text-sm text-omega-stone">
          <strong className="text-omega-charcoal">Client purchase list</strong> — not created yet. It's drafted automatically when the contract is signed.
        </p>
        <button
          onClick={async () => {
            setCreating(true);
            try { await createDraftList(job); await reload(); setOpen(true); }
            catch (e) { alert(e?.message || 'Could not create the list'); }
            finally { setCreating(false); }
          }}
          disabled={creating}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-omega-orange text-white text-sm font-bold hover:bg-omega-dark disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create list
        </button>
      </div>
    );
  }

  const p = listProgress(items);
  let tone = 'amber';
  let title;
  let detail;
  if (list.status === 'draft') {
    title = 'Client purchase list ready to review';
    detail = `${items.length} items · not sent to the client yet`;
  } else if (p.complete) {
    tone = 'green';
    title = 'All client materials are at the house';
    detail = `${p.total} of ${p.total} items`;
  } else {
    tone = p.overdue ? 'red' : 'amber';
    title = 'Client purchase list not complete';
    detail = [
      `${p.atHouse} of ${p.total} at the house`,
      p.ordered ? `${p.ordered} ordered${p.lastArrival ? ` (last one arrives ${fmtDay(p.lastArrival)})` : ''}` : null,
      p.notPurchased ? `${p.notPurchased} not purchased yet` : null,
      p.overdue ? `${p.overdue} past the delivery date` : null,
    ].filter(Boolean).join(' · ');
  }
  const toneCls = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    red:   'bg-red-50 border-red-200 text-red-800',
    green: 'bg-green-50 border-green-200 text-green-800',
  }[tone];
  const Icon = tone === 'green' ? CheckCircle2 : AlertTriangle;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded-2xl border px-4 py-3 flex items-center gap-3 hover:shadow-sm transition ${toneCls}`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-[15px]">{title}</span>
          <span className="block text-[13px] opacity-80">{detail}</span>
        </span>
        <span className="text-[13px] font-semibold underline underline-offset-2 flex-shrink-0">
          {list.status === 'draft' && canEdit ? 'Review & send' : 'View list'}
        </span>
      </button>
      {open && (
        <ManageModal job={job} user={user} list={list} items={items} canEdit={canEdit} onClose={() => setOpen(false)} onChanged={reload} />
      )}
    </>
  );
}

function ManageModal({ job, user, list, items, canEdit, onClose, onChanged }) {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(null);
  const link = purchaseLink(list.id);
  const emails = clientEmails(job);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !templatesOpen) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, templatesOpen]);

  async function patchItem(item, patch) {
    setBusy(item.id);
    await supabase.from('purchase_list_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', item.id);
    setBusy(null);
    onChanged();
  }

  async function teamStatus(item, patch) {
    setBusy(item.id);
    try { await setItemStatus(item, patch, { name: user?.name || 'Team', kind: 'team' }, list); }
    catch (e) { alert(e?.message || 'Could not save'); }
    setBusy(null);
    onChanged();
  }

  async function removeItem(item) {
    if (!window.confirm(`Remove "${item.label}" from this list?`)) return;
    await supabase.from('purchase_list_items').delete().eq('id', item.id);
    await syncListStatus(list.id);
    logAudit({ user, action: 'purchase_list.item_remove', entityType: 'job', entityId: job.id, details: { item: item.label } });
    onChanged();
  }

  async function move(item, dir) {
    const idx = items.findIndex((i) => i.id === item.id);
    const other = items[idx + dir];
    if (!other) return;
    await Promise.all([
      supabase.from('purchase_list_items').update({ position: other.position }).eq('id', item.id),
      supabase.from('purchase_list_items').update({ position: item.position }).eq('id', other.id),
    ]);
    onChanged();
  }

  async function addItem() {
    const label = newItem.trim();
    if (!label) return;
    const position = (items[items.length - 1]?.position || 0) + 1;
    await supabase.from('purchase_list_items').insert([{ list_id: list.id, label, position }]);
    setNewItem('');
    await syncListStatus(list.id);
    onChanged();
  }

  async function saveNotices(next) {
    await supabase.from('purchase_lists').update({ notices: next, updated_at: new Date().toISOString() }).eq('id', list.id);
    onChanged();
  }

  async function send() {
    const to = [job.client_phone && `SMS to ${job.client_phone}`, emails.length && `email to ${emails.join(' and ')}`].filter(Boolean).join(' + ');
    if (!to) { setMsg({ ok: false, text: 'This client has no phone or email on file — add them on the Details tab.' }); return; }
    const again = list.status !== 'draft';
    if (!window.confirm(`${again ? 'Resend' : 'Send'} the purchase list to the client?\n\n${to}`)) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await apiFetch('/api/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-omega-user': user?.name || '' },
        body: JSON.stringify({ action: 'purchase-list', listId: list.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const parts = [data.sms?.ok && 'SMS', data.email?.ok && 'email'].filter(Boolean).join(' + ');
      const fails = [data.sms && !data.sms.ok && `SMS failed: ${data.sms.error}`, data.email && !data.email.ok && `email failed: ${data.email.error}`].filter(Boolean).join(' · ');
      setMsg({ ok: true, text: `Sent (${parts}).${fails ? ` ${fails}` : ''}` });
      logAudit({ user, action: again ? 'purchase_list.resend' : 'purchase_list.send', entityType: 'job', entityId: job.id, details: { items: items.length } });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Could not send' });
    } finally {
      setSending(false);
    }
  }

  const p = listProgress(items);

  return (
    <div className="fixed inset-0 z-[55] bg-black/60 flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
          <ShoppingCart className="w-6 h-6 text-omega-orange mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-omega-stone font-semibold">Client purchase list</p>
            <p className="font-bold text-omega-charcoal text-lg truncate">{job.client_name}</p>
            <p className="text-xs text-omega-stone">
              {list.status === 'draft' ? 'Draft — not sent yet' : `Sent ${list.sent_at ? new Date(list.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}${list.sent_by ? ` by ${list.sent_by}` : ''}`}
              {' · '}{p.atHouse} of {p.total} at the house
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100 text-omega-stone hover:bg-gray-200" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-2.5 border-b border-gray-200 flex flex-wrap items-center gap-2 bg-omega-cloud/50">
          <a href={`${link}?preview=1`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-omega-slate hover:border-omega-orange hover:text-omega-orange">
            <Eye className="w-4 h-4" /> Preview client page
          </a>
          <button
            onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-omega-slate hover:border-omega-orange hover:text-omega-orange"
          >
            {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy link</>}
          </button>
          {canEdit && (
            <button onClick={() => setTemplatesOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-omega-slate hover:border-omega-orange hover:text-omega-orange">
              <Settings2 className="w-4 h-4" /> Edit default lists
            </button>
          )}
          <span className="flex-1" />
          {canEdit && (
            <button onClick={send} disabled={sending || !items.length}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-bold">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {list.status === 'draft' ? 'Send to client' : 'Resend'}
            </button>
          )}
        </div>
        {msg && (
          <div className={`px-5 py-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {list.status === 'draft' && canEdit && (
            <p className="text-sm text-omega-stone">
              Remove what doesn't apply to this job, add anything missing and write a note where it helps (quantity, model, color, store link). The client sees the notes.
            </p>
          )}
          {items.map((it, i) => (
            <div key={it.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start gap-2">
                {canEdit && (
                  <div className="flex flex-col -my-1">
                    <button onClick={() => move(it, -1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-omega-charcoal disabled:opacity-30" aria-label="Move up"><ChevronUp className="w-4 h-4" /></button>
                    <button onClick={() => move(it, 1)} disabled={i === items.length - 1} className="p-0.5 text-gray-400 hover:text-omega-charcoal disabled:opacity-30" aria-label="Move down"><ChevronDown className="w-4 h-4" /></button>
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1.5">
                  {canEdit ? (
                    <>
                      <input defaultValue={it.label} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.label) patchItem(it, { label: v }); }}
                        className="w-full px-2.5 h-9 rounded-lg border border-gray-200 text-[15px] font-semibold text-omega-charcoal focus:border-omega-orange focus:outline-none" />
                      <textarea defaultValue={it.note || ''} rows={1} placeholder="Note for the client (optional) — quantity, model, color, store link…"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (it.note || '')) patchItem(it, { note: v || null }); }}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm text-omega-charcoal focus:border-omega-orange focus:outline-none resize-y" />
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-omega-charcoal">{it.label}</p>
                      {it.note && <p className="text-sm text-omega-stone whitespace-pre-line">{it.note}</p>}
                    </>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={it.status}
                      disabled={!canEdit || busy === it.id}
                      onChange={(e) => teamStatus(it, { status: e.target.value, arrives_on: e.target.value === 'ordered' ? it.arrives_on : null })}
                      className="h-9 px-2 rounded-lg border border-gray-200 text-sm bg-white disabled:bg-gray-50"
                    >
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    {it.status === 'ordered' && (
                      <label className="text-sm text-omega-stone flex items-center gap-1.5">
                        arrives
                        <input type="date" value={it.arrives_on || ''} disabled={!canEdit || busy === it.id}
                          onChange={(e) => teamStatus(it, { status: 'ordered', arrives_on: e.target.value || null })}
                          className="h-9 px-2 rounded-lg border border-gray-200 text-sm" />
                        {!it.arrives_on && <span className="text-xs">{it.arrival_unknown ? '(client doesn\'t know yet)' : ''}</span>}
                      </label>
                    )}
                    {busy === it.id && <Loader2 className="w-4 h-4 animate-spin text-omega-stone" />}
                    {it.updated_by_kind && (
                      <span className="text-xs text-omega-fog">
                        {it.updated_by_kind === 'client' ? 'Client' : `Team${it.updated_by ? `: ${it.updated_by}` : ''}`} · {new Date(it.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <button onClick={() => removeItem(it)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${it.label}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {canEdit && (
            <div className="flex gap-2 pt-1">
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
                placeholder="Add an item…" className="flex-1 px-3 h-10 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none" />
              <button onClick={addItem} disabled={!newItem.trim()} className="inline-flex items-center gap-1 h-10 px-3 rounded-lg bg-omega-charcoal text-white text-sm font-semibold disabled:opacity-40">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          )}

          <NoticesEditor notices={list.notices || []} canEdit={canEdit} onSave={saveNotices} />
        </div>
      </div>
      {templatesOpen && <PurchaseTemplateEditor user={user} onClose={() => setTemplatesOpen(false)} />}
    </div>
  );
}

// "Please note" lines shown under the list (e.g. who buys / installs the
// kitchen appliances).
function NoticesEditor({ notices, canEdit, onSave }) {
  const [draft, setDraft] = useState('');
  if (!canEdit && !notices.length) return null;
  return (
    <div className="mt-3 rounded-xl bg-[#FFF5EC] border border-[#F7D3B5] p-3">
      <p className="text-sm font-bold text-[#5a4a3c]">Please note (shown to the client)</p>
      <ul className="mt-1 space-y-1">
        {notices.map((n, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[#5a4a3c]">
            <span className="flex-1">• {n}</span>
            {canEdit && (
              <button onClick={() => onSave(notices.filter((_, j) => j !== i))} className="text-[#a08060] hover:text-red-600" aria-label="Remove note">
                <X className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note for the client…"
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onSave([...notices, draft.trim()]); setDraft(''); } }}
            className="flex-1 px-2.5 h-9 rounded-lg border border-[#F7D3B5] bg-white text-sm focus:outline-none" />
          <button onClick={() => { if (draft.trim()) { onSave([...notices, draft.trim()]); setDraft(''); } }}
            className="h-9 px-3 rounded-lg bg-white border border-[#F7D3B5] text-sm font-semibold text-[#5a4a3c]">Add</button>
        </div>
      )}
    </div>
  );
}
