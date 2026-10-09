// ChangeOrderEditor — full popup to create or edit a change order.
// The seller lists the items (title + details + price) and picks how the
// client sees the price: 'itemized' (each item priced, total = sum) or
// 'single' (items listed, one price for all). Save draft, Preview (opens the
// client page) or Send to client. Signed change orders never open here.

import { useState } from 'react';
import {
  FileText, X, Plus, Trash2, DollarSign, Eye, Send, Save, Loader2, ChevronUp, ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch';
import { logAudit } from '../lib/audit';
import { coItems, coPriceMode, itemsTotal, summarizeCo } from '../lib/changeOrders';

const blankItem = () => ({ title: '', details: '', price: '' });

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const PRICE_MODES = [
  { key: 'itemized', label: 'Price per item', hint: 'Each item shows its own price' },
  { key: 'single',   label: 'Single price',   hint: 'Items listed, one total price' },
];

const labelCls = 'block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5';
const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-base lg:text-sm';

export default function ChangeOrderEditor({ job, user, co = null, nextNumber, onClose, onSaved }) {
  // The row as last saved — after a Preview (or a failed send) of a new
  // change order, the next save must update it, not insert a duplicate.
  const [saved, setSaved] = useState(co);
  const editing = !!saved;
  const number = co?.co_number || nextNumber;

  const [title, setTitle] = useState(co?.title || '');
  const [mode, setMode] = useState(co ? coPriceMode(co) : 'itemized');
  const [items, setItems] = useState(() => {
    const list = co ? coItems(co) : [];
    return list.length
      ? list.map((i) => ({ title: i.title || '', details: i.details || '', price: i.price ?? '' }))
      : [blankItem()];
  });
  const [singlePrice, setSinglePrice] = useState(co && coPriceMode(co) === 'single' ? (Number(co.amount) || '') : '');
  const [busy, setBusy] = useState(null); // 'draft' | 'preview' | 'send'
  const [error, setError] = useState('');

  const total = mode === 'itemized' ? itemsTotal(items) : Number(singlePrice) || 0;

  function patchItem(i, patch) { setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it))); }
  function removeItem(i) { setItems((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [blankItem()])); }
  function moveItem(i, dir) {
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function pickMode(next) {
    // Switching never loses prices: item prices stay stored, and the single
    // price starts as the sum of the items when it's still empty.
    if (next === 'single' && !singlePrice && itemsTotal(items) > 0) setSinglePrice(itemsTotal(items));
    setMode(next);
  }

  function validate(clean) {
    if (!clean.length) return 'Add at least one item.';
    if (clean.some((i) => !i.title)) return 'Every item needs a title.';
    if (mode === 'itemized' && clean.some((i) => !(Number(i.price) > 0))) return 'Enter a price for every item.';
    if (!(total > 0)) return mode === 'single' ? 'Enter the price for this change order.' : 'The total must be more than $0.';
    return null;
  }

  // Saves and returns the row (null on failure — the error is already shown).
  async function save() {
    const clean = items
      .map((i) => ({ title: i.title.trim(), details: i.details.trim(), price: i.price === '' || i.price == null ? null : Number(i.price) }))
      .filter((i) => i.title || i.details);
    const problem = validate(clean);
    if (problem) { setError(problem); return null; }

    const payload = {
      title: title.trim() || null,
      items: clean,
      price_mode: mode,
      amount: total,
      description: summarizeCo(title, clean),
      updated_at: new Date().toISOString(),
    };
    const query = editing
      ? supabase.from('change_orders').update(payload).eq('id', saved.id)
      : supabase.from('change_orders').insert([{
          ...payload, job_id: job.id, co_number: number, status: 'draft', created_by: user?.name || null,
        }]);
    const { data, error: dbErr } = await query.select().single();
    if (dbErr) { setError(dbErr.message || 'Failed to save the change order.'); return null; }
    setSaved(data);
    logAudit({
      user, action: editing ? 'change_order.update' : 'change_order.create', entityType: 'change_order',
      entityId: data.id, details: { job_id: job.id, amount: total, price_mode: mode, items: clean.length },
    });
    return data;
  }

  async function saveDraft() {
    if (busy) return;
    setError(''); setBusy('draft');
    const row = await save();
    setBusy(null);
    if (row) { onSaved?.(row); onClose?.(); }
  }

  async function preview() {
    if (busy) return;
    setError(''); setBusy('preview');
    // Open the tab now (still inside the click) so iOS/Safari doesn't block it.
    const win = window.open('about:blank', '_blank');
    const row = await save();
    setBusy(null);
    if (!row) { win?.close(); return; }
    const url = `${window.location.origin}/change-order-view/${row.id}`;
    if (win) win.location.href = url; else window.open(url, '_blank');
    onSaved?.(row);
  }

  async function sendToClient() {
    if (busy) return;
    setError('');
    if (!job?.client_email) {
      setError('This client has no email on file. Save the draft and use "Link", or add an email on the Details tab.');
      return;
    }
    setBusy('send');
    const row = await save();
    if (!row) { setBusy(null); return; }
    try {
      const r = await apiFetch('/api/send-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-omega-user': user?.name || '', 'x-omega-role': user?.role || '' },
        body: JSON.stringify({ changeOrderId: row.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) throw new Error(data?.error || `Send failed (HTTP ${r.status})`);
      logAudit({ user, action: 'change_order.send', entityType: 'change_order', entityId: row.id, details: { job_id: job.id, to: job.client_email } });
      onSaved?.(row);
      onClose?.();
    } catch (err) {
      // Saved as a draft already — keep the popup open so they can retry.
      onSaved?.(row);
      setError(`Saved, but the email didn't go out: ${err.message || 'send failed'}.`);
    } finally {
      setBusy(null);
    }
  }

  const close = () => { if (!busy) onClose?.(); };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-start sm:items-center justify-center p-2 sm:p-4" onClick={close}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <span className="w-10 h-10 rounded-xl bg-omega-pale inline-flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5 text-omega-orange" />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-omega-charcoal">
              {editing ? 'Edit Change Order' : 'New Change Order'}
              {number ? <span className="text-omega-stone font-semibold"> · #CO-{number}</span> : null}
            </h3>
            <p className="text-xs text-omega-stone truncate">{[job?.client_name, job?.address].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={close} className="p-2 rounded-lg hover:bg-gray-100 text-omega-stone" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          <div>
            <label className={labelCls}>Title (shows on the document)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Shower niche & lighting upgrades"
              className={`${inputCls} font-semibold text-omega-charcoal`}
            />
          </div>

          <div>
            <label className={labelCls}>How should the client see the price?</label>
            <div className="grid grid-cols-2 gap-2">
              {PRICE_MODES.map((o) => {
                const on = mode === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => pickMode(o.key)}
                    className={`text-left px-3 py-2.5 rounded-xl border-2 transition ${on ? 'border-omega-orange bg-omega-pale/60' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${on ? 'border-omega-orange bg-omega-orange shadow-[inset_0_0_0_3px_white]' : 'border-gray-300'}`} />
                      <span className="text-sm font-bold text-omega-charcoal">{o.label}</span>
                    </div>
                    <p className="text-[11px] text-omega-stone mt-0.5 ml-6">{o.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={labelCls}>Items</label>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2 items-start rounded-xl border border-gray-200 p-3">
                  <span className="w-6 h-6 mt-2 rounded-full bg-gray-100 text-[11px] font-bold text-omega-stone inline-flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      value={it.title}
                      onChange={(e) => patchItem(i, { title: e.target.value })}
                      placeholder="Item title — e.g. Recessed lighting"
                      className={`${inputCls} font-semibold text-omega-charcoal`}
                    />
                    <textarea
                      value={it.details}
                      onChange={(e) => patchItem(i, { details: e.target.value })}
                      rows={2}
                      placeholder="What's included (optional)"
                      className={`${inputCls} resize-y text-omega-charcoal`}
                    />
                  </div>
                  {mode === 'itemized' && (
                    <div className="relative w-28 flex-shrink-0">
                      <DollarSign className="w-3.5 h-3.5 text-omega-stone absolute left-2 top-1/2 -translate-y-1/2" />
                      <input
                        type="number" min="0" step="0.01" inputMode="decimal"
                        value={it.price}
                        onChange={(e) => patchItem(i, { price: e.target.value })}
                        placeholder="0"
                        className={`${inputCls} pl-6 pr-2 font-bold text-right tabular-nums`}
                      />
                    </div>
                  )}
                  <div className="flex flex-col items-center flex-shrink-0">
                    <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-omega-charcoal disabled:opacity-25" aria-label="Move up"><ChevronUp className="w-4 h-4" /></button>
                    <button type="button" onClick={() => removeItem(i)} className="p-1 text-gray-400 hover:text-red-500" aria-label="Remove item"><Trash2 className="w-4 h-4" /></button>
                    <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} className="p-1 text-gray-400 hover:text-omega-charcoal disabled:opacity-25" aria-label="Move down"><ChevronDown className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setItems((prev) => [...prev, blankItem()])} className="mt-2 inline-flex items-center gap-1 py-1.5 text-sm font-bold text-omega-orange hover:text-omega-dark">
              <Plus className="w-4 h-4" /> Add item
            </button>
          </div>

          {mode === 'itemized' ? (
            <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
              <p className="text-sm font-bold text-omega-charcoal">Total for this change order</p>
              <p className="text-lg font-black text-omega-charcoal tabular-nums">{money(total)}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-omega-orange/40 bg-omega-pale/40 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-omega-charcoal">Price for this change order</p>
                <p className="text-[11px] text-omega-stone">One price for all items above</p>
              </div>
              <div className="relative w-40 flex-shrink-0">
                <DollarSign className="w-4 h-4 text-omega-stone absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={singlePrice}
                  onChange={(e) => setSinglePrice(e.target.value)}
                  placeholder="0"
                  className={`${inputCls} pl-7 font-black text-right tabular-nums`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Errors sit right above the buttons, where the click happened. */}
        {error && <div className="px-5 py-2.5 border-t border-red-200 bg-red-50 text-xs font-semibold text-red-700 flex-shrink-0">{error}</div>}

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <button onClick={close} disabled={!!busy} className="px-3 py-2.5 rounded-xl text-sm font-bold text-omega-stone hover:text-omega-charcoal disabled:opacity-50">Cancel</button>
          <div className="flex-1" />
          <button onClick={preview} disabled={!!busy} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold text-omega-charcoal hover:border-omega-orange disabled:opacity-50">
            {busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Preview
          </button>
          <button onClick={saveDraft} disabled={!!busy} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-bold text-omega-charcoal hover:border-omega-orange disabled:opacity-50">
            {busy === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saved?.status === 'sent' ? 'Save changes' : 'Save draft'}
          </button>
          <button onClick={sendToClient} disabled={!!busy} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60">
            {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {saved?.status === 'sent' ? 'Save & resend' : 'Send to client'}
          </button>
        </div>
      </div>
    </div>
  );
}
