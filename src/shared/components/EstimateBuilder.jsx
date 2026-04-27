import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, Trash2, ChevronUp, ChevronDown, Save, Mail, Loader2,
  AlertCircle, CheckCircle2, Download, Copy, Layers, X, Shield, RotateCcw, Wand2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { DEFAULT_ESTIMATE_DISCLAIMERS } from '../data/estimateDisclaimers';
import { autofillSectionsFromAnswers, canAutofill } from '../data/estimateAutofill';

// Defaults reused whenever a brand-new estimate is opened. Mirrors the
// structure of the ServiceFusion template the owner provided.
const DEFAULT_PAYMENT = `Payment Schedule:
Deposit - 30%
Upon Start 30%
After Painting Completion 30%
Upon Completion 10%`;

function emptyItem()    { return { description: '', scope: '', price: 0 }; }
function emptySection() { return { title: 'Section 1', items: [emptyItem()] }; }

export default function EstimateBuilder({ job, user, onJobUpdated }) {
  const [estimate, setEstimate] = useState(null); // currently edited row
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [sending, setSending]   = useState(false);
  const [toast, setToast]       = useState(null);

  // Form state (for the row currently being edited).
  const [headerDescription, setHeaderDescription] = useState('');
  const [sections, setSections] = useState([emptySection()]);
  const [customerMessage, setCustomerMessage] = useState(DEFAULT_PAYMENT);
  const [optionLabel, setOptionLabel] = useState('');
  // Disclaimers shown to the customer right above the signature flow.
  // Defaults to the global template; the seller can edit them per-estimate.
  const [disclaimers, setDisclaimers] = useState(DEFAULT_ESTIMATE_DISCLAIMERS);

  // Multi-option state. `options` is the whole group, ordered by
  // option_order. When there's 0 or 1 rows, the switcher hides.
  const [options, setOptions] = useState([]);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [job?.id]);

  async function load(preferredActiveId) {
    setLoading(true);
    try {
      // Grab the most recent estimate to find the group, then pull every
      // sibling so the switcher reflects all alternatives.
      const { data: latest } = await supabase
        .from('estimates').select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      if (!latest) {
        // No estimate yet — start a blank single-option draft.
        setOptions([]); setActiveId(null); setEstimate(null);
        setLoading(false);
        return;
      }
      const groupId = latest.group_id || latest.id;
      const { data: group } = await supabase
        .from('estimates').select('*')
        .eq('group_id', groupId)
        .order('option_order', { ascending: true });
      const siblings = (group && group.length) ? group : [latest];
      setOptions(siblings);

      // Figure out which option to land on:
      //   1) the caller's preferred id (just created / switched)
      //   2) whichever we were already editing
      //   3) the latest one by created_at
      const picked =
        siblings.find((s) => s.id === preferredActiveId) ||
        siblings.find((s) => s.id === activeId) ||
        siblings.find((s) => s.id === latest.id) ||
        siblings[0];
      loadIntoForm(picked);
    } catch { /* ignore */ }
    setLoading(false);
  }

  function loadIntoForm(row) {
    setEstimate(row);
    setActiveId(row?.id || null);
    setHeaderDescription(row?.header_description || '');
    setSections(Array.isArray(row?.sections) && row.sections.length ? row.sections : [emptySection()]);
    setCustomerMessage(row?.customer_message || DEFAULT_PAYMENT);
    setOptionLabel(row?.option_label || '');
    // Use the persisted disclaimers if the seller already customized
    // them on this estimate; otherwise fall back to the default. A row
    // saved before migration 019 will have `disclaimers === undefined`.
    setDisclaimers(row?.disclaimers || DEFAULT_ESTIMATE_DISCLAIMERS);
  }

  // ─── Section / item helpers ───────────────────────────────────────
  function updateSection(idx, patch) {
    setSections((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function addSection() {
    setSections((prev) => [...prev, { title: `Section ${prev.length + 1}`, items: [emptyItem()] }]);
  }
  function removeSection(idx) {
    if (sections.length === 1) { setSections([emptySection()]); return; }
    setSections((prev) => prev.filter((_, i) => i !== idx));
  }
  function moveSection(idx, dir) {
    setSections((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }
  function updateItem(sIdx, iIdx, patch) {
    setSections((prev) => prev.map((s, i) => {
      if (i !== sIdx) return s;
      return { ...s, items: s.items.map((it, j) => j === iIdx ? { ...it, ...patch } : it) };
    }));
  }
  function addItem(sIdx) {
    setSections((prev) => prev.map((s, i) => i === sIdx ? { ...s, items: [...s.items, emptyItem()] } : s));
  }
  function removeItem(sIdx, iIdx) {
    setSections((prev) => prev.map((s, i) => {
      if (i !== sIdx) return s;
      const items = s.items.filter((_, j) => j !== iIdx);
      return { ...s, items: items.length ? items : [emptyItem()] };
    }));
  }

  // ─── Totals ───────────────────────────────────────────────────────
  const total = sections.reduce((acc, sec) =>
    acc + (sec.items || []).reduce((a, it) => a + (Number(it.price) || 0), 0), 0);

  // ─── Persistence ──────────────────────────────────────────────────
  async function persist(extra = {}) {
    const base = {
      job_id: job.id,
      header_description: headerDescription,
      sections,
      customer_message: customerMessage,
      total_amount: total,
      option_label: optionLabel || null,
      // Persist whatever disclaimer text the seller has on screen, so
      // the customer always sees the latest version when they open the
      // signing page. Migration 019 adds the column; row-level fallback
      // happens in the API if it's pending.
      disclaimers: disclaimers || null,
      ...extra,
    };
    // Preserve an existing row's status on save (was dropping 'sent'
    // back to 'draft' every time before — that was wrong).
    if (!('status' in base)) base.status = estimate?.status || 'draft';

    if (estimate?.id) {
      const { data, error } = await supabase
        .from('estimates').update(base).eq('id', estimate.id)
        .select().single();
      if (error) throw error;
      return data;
    } else {
      // First-save gets a human-readable estimate number from the sequence.
      // The RPC returns a scalar integer — NOT an array — so read it
      // directly. Previous version used Array.isArray()+[0] which always
      // fell through to null, leaving estimates with no number.
      const { data: seqData } = await supabase.rpc('next_estimate_number');
      const number = typeof seqData === 'number'
        ? seqData
        : (Array.isArray(seqData) ? seqData[0] : null);   // accept row-shaped fallback too
      const { data, error } = await supabase
        .from('estimates')
        .insert([{ ...base, estimate_number: number, status: 'draft', option_order: 0 }])
        .select().single();
      if (error) throw error;
      return data;
    }
  }

  // ─── Auto-fill from questionnaire ──────────────────────────────────
  // Looks at the job's answers + service list and produces a draft set
  // of sections (with prices = 0). Replaces whatever the seller has on
  // screen — if they already typed line items, we ask first so we do
  // not blow away their work.
  const autofillPreview = useMemo(
    () => autofillSectionsFromAnswers(job?.service, job?.answers),
    [job?.service, job?.answers]
  );
  // Only show the button if (a) we know how to map this service AND
  // (b) the answers actually produced at least one section. If the
  // client kept everything as-is, there is nothing to seed.
  const canShowAutofill = canAutofill((job?.service || '').split(',')[0]?.trim()) && autofillPreview.length > 0;

  function autofillFromQuestionnaire() {
    if (!autofillPreview.length) {
      setToast({ type: 'error', message: 'No questionnaire answers to seed from.' });
      return;
    }
    // Detect non-empty user input. The default state is one section
    // titled "Section 1" with one fully-empty item — anything beyond
    // that means the seller has typed something we should not lose.
    const hasUserContent =
      sections.length > 1 ||
      (sections[0]?.items || []).some((it) => it.description?.trim() || it.scope?.trim() || Number(it.price) > 0) ||
      (sections[0]?.title && sections[0].title !== 'Section 1');
    if (hasUserContent) {
      const ok = confirm('Replace the current sections with the auto-filled draft from the questionnaire? The current items will be discarded.');
      if (!ok) return;
    }
    // Each generated section keeps the seller's defaults (one blank
    // line at the bottom is convenient for adding extras inline).
    const seeded = autofillPreview.map((s) => ({
      title: s.title,
      items: s.items.length ? s.items : [emptyItem()],
    }));
    setSections(seeded);
    setToast({ type: 'success', message: `Drafted ${seeded.length} section${seeded.length === 1 ? '' : 's'} from the questionnaire. Review and add prices.` });
  }

  // ─── Multi-option helpers ──────────────────────────────────────────
  async function addAlternative() {
    if (saving || sending) return;
    setSaving(true);
    setToast(null);
    try {
      // Save current so the duplicate copies the latest content.
      const current = await persist();

      const groupId = current.group_id || current.id;
      const existingOrders = options.map((o) => o.option_order ?? 0);
      const nextOrder = (existingOrders.length ? Math.max(...existingOrders) : 0) + 1;
      const nextLabel = `Option ${options.length + 1 || nextOrder + 1}`;

      // Backfill the first option with a group_id / label so the UI
      // stays consistent (it's the same uuid as `current.id` by default
      // because of the migration 017 self-reference, but make it
      // explicit for clarity).
      if (!current.group_id || !current.option_label) {
        await supabase.from('estimates').update({
          group_id: groupId,
          option_label: current.option_label || 'Option 1',
        }).eq('id', current.id);
      }

      // Duplicate the current row — same content, new uuid, same group_id.
      const { data: seqData } = await supabase.rpc('next_estimate_number');
      const number = typeof seqData === 'number'
        ? seqData
        : (Array.isArray(seqData) ? seqData[0] : null);
      const { data: created, error } = await supabase.from('estimates').insert([{
        job_id: job.id,
        header_description: current.header_description,
        sections: current.sections,
        customer_message: current.customer_message,
        total_amount: current.total_amount,
        status: 'draft',
        group_id: groupId,
        option_label: nextLabel,
        option_order: nextOrder,
        estimate_number: number,
      }]).select().single();
      if (error) throw error;

      logAudit({ user, action: 'estimate.add_alternative', entityType: 'estimate', entityId: created.id, details: { group_id: groupId, option_order: nextOrder } });
      await load(created.id);
      setToast({ type: 'success', message: `${nextLabel} created — edit and send when ready.` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to add alternative' });
    }
    setSaving(false);
  }

  async function switchToOption(id) {
    if (id === activeId || saving || sending) return;
    setSaving(true);
    try {
      // Save current first so edits don't get lost.
      if (activeId) { try { await persist(); } catch { /* ignore */ } }
      const { data } = await supabase.from('estimates').select('*').eq('id', id).maybeSingle();
      if (data) loadIntoForm(data);
      // Refresh the switcher chips (totals / status may have changed).
      await load(id);
    } finally {
      setSaving(false);
    }
  }

  async function removeAlternative(id) {
    if (options.length <= 1) return;
    if (!confirm('Remove this alternative? The other options stay.')) return;
    try {
      await supabase.from('estimates').delete().eq('id', id);
      logAudit({ user, action: 'estimate.remove_alternative', entityType: 'estimate', entityId: id });
      // If we just deleted the active one, load() will pick whichever's left.
      await load(id === activeId ? null : activeId);
      setToast({ type: 'success', message: 'Alternative removed.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to remove alternative' });
    }
  }

  const isMultiOption = options.length > 1;

  async function handleSave() {
    setSaving(true);
    setToast(null);
    try {
      const saved = await persist();
      setEstimate(saved);
      // Promote the job to estimate_draft on first save (if still new_lead).
      if (!job.pipeline_status || job.pipeline_status === 'new_lead') {
        const { data: j } = await supabase
          .from('jobs').update({ pipeline_status: 'estimate_draft' })
          .eq('id', job.id).select().single();
        if (j) onJobUpdated?.(j);
      }
      logAudit({ user, action: 'estimate.save', entityType: 'estimate', entityId: saved.id, details: { total } });
      setToast({ type: 'success', message: 'Estimate saved' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    }
    setSaving(false);
  }

  async function handleSend() {
    if (!job.client_email) {
      setToast({ type: 'error', message: "Client has no email on file. Add it under Details first." });
      return;
    }
    setSending(true);
    setToast(null);
    try {
      // Always save first so the email sends the latest data.
      const saved = await persist();
      setEstimate(saved);

      const res = await fetch('/api/send-estimate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-omega-role': user?.role || '',
          'x-omega-user': user?.name || '',
        },
        body: JSON.stringify({ estimateId: saved.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`);

      // Promote to estimate_sent on successful send.
      const { data: j } = await supabase
        .from('jobs').update({ pipeline_status: 'estimate_sent' })
        .eq('id', job.id).select().single();
      if (j) onJobUpdated?.(j);

      // Refresh the estimate so status + pdf_url reflect server updates.
      const { data: updated } = await supabase
        .from('estimates').select('*').eq('id', saved.id).maybeSingle();
      if (updated) setEstimate(updated);

      logAudit({ user, action: 'estimate.send', entityType: 'estimate', entityId: saved.id, details: { to: job.client_email, total } });
      setToast({ type: 'success', message: `Sent to ${job.client_email}` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to send' });
    }
    setSending(false);
  }

  if (loading) {
    return <p className="text-sm text-omega-stone py-10 text-center">Loading estimate…</p>;
  }

  return (
    <div className="space-y-5">

      {/* Options switcher — only shows once there are 2+ options. Single
          estimates stay invisible so the UX matches the original behavior. */}
      {isMultiOption && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-omega-stone uppercase tracking-wider mr-1">
            <Layers className="w-3.5 h-3.5" /> Options
          </div>
          {options.map((opt, i) => {
            const isActive = opt.id === activeId;
            const isLocked = !!opt.signed_at;
            return (
              <div key={opt.id} className="inline-flex items-center">
                <button
                  onClick={() => switchToOption(opt.id)}
                  disabled={saving || sending}
                  className={`px-3 py-1.5 rounded-l-lg text-xs font-bold transition-colors ${
                    isActive
                      ? 'bg-omega-orange text-white'
                      : 'bg-white border border-gray-200 text-omega-slate hover:border-omega-orange'
                  }`}
                  title={isLocked ? 'This option has been signed by the client' : `Switch to Option ${i + 1}`}
                >
                  Option {i + 1}
                  {opt.option_label ? ` — ${opt.option_label}` : ''}
                  {opt.status && ` · ${String(opt.status).toUpperCase()}`}
                </button>
                {options.length > 1 && !isLocked && (
                  <button
                    onClick={() => removeAlternative(opt.id)}
                    disabled={saving || sending}
                    className={`px-2 py-1.5 rounded-r-lg text-xs font-bold ${
                      isActive
                        ? 'bg-omega-orange/90 text-white hover:bg-red-500'
                        : 'bg-white border border-l-0 border-gray-200 text-omega-stone hover:text-red-600'
                    }`}
                    title="Remove this alternative"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={addAlternative}
            disabled={saving || sending}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-omega-orange border border-dashed border-omega-orange/50 hover:bg-omega-pale disabled:opacity-60"
          >
            <Copy className="w-3 h-3" /> Add Alternative
          </button>
        </div>
      )}

      {/* Header block */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
              <FileText className="w-4 h-4 text-omega-orange" /> Estimate
              {estimate?.estimate_number && (
                <span className="text-omega-stone text-sm font-bold tabular-nums">#{estimate.estimate_number}</span>
              )}
              {isMultiOption && (
                <span className="text-[10px] font-bold text-white bg-omega-orange px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Option {Math.max(1, options.findIndex((o) => o.id === activeId) + 1)} of {options.length}
                </span>
              )}
            </h2>
            <p className="text-xs text-omega-stone mt-0.5">
              {estimate?.created_at
                ? `Last saved ${new Date(estimate.updated_at || estimate.created_at).toLocaleString()}`
                : 'Draft — not saved yet.'}
            </p>
          </div>
          {estimate?.pdf_url && (
            <a
              href={estimate.pdf_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-omega-charcoal hover:border-omega-orange"
            >
              <Download className="w-3.5 h-3.5" /> Last PDF
            </a>
          )}
        </div>

        {/* Option name — shown once the group has 2+ alternatives, so the
            client sees "Basic / Standard / Premium" instead of generic
            "Option 1 / 2 / 3". Also show when user is about to add the
            first alternative (encourage naming Option 1). */}
        {(isMultiOption || optionLabel) && (
          <label className="block mt-4">
            <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">
              Option name (what the client sees)
            </span>
            <input
              value={optionLabel}
              onChange={(e) => setOptionLabel(e.target.value)}
              placeholder='e.g. "Basic", "Standard", "With Hardwood Floor"…'
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
            />
          </label>
        )}

        <label className="block mt-4">
          <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Description (top of estimate)</span>
          <textarea
            rows={3}
            value={headerDescription}
            onChange={(e) => setHeaderDescription(e.target.value)}
            placeholder='e.g. "Construction of a ___ sq. ft. deck using pressure-treated wood…"'
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
          />
        </label>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((sec, sIdx) => (
          <SectionCard
            key={sIdx}
            section={sec}
            onTitle={(v) => updateSection(sIdx, { title: v })}
            onMoveUp={() => moveSection(sIdx, -1)}
            onMoveDown={() => moveSection(sIdx, +1)}
            onRemove={() => removeSection(sIdx)}
            onUpdateItem={(iIdx, patch) => updateItem(sIdx, iIdx, patch)}
            onAddItem={() => addItem(sIdx)}
            onRemoveItem={(iIdx) => removeItem(sIdx, iIdx)}
            disableUp={sIdx === 0}
            disableDown={sIdx === sections.length - 1}
          />
        ))}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={addSection}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-300 text-omega-stone hover:border-omega-orange hover:text-omega-orange text-sm font-bold"
          >
            <Plus className="w-4 h-4" /> Add Section
          </button>
          {canShowAutofill && (
            <button
              onClick={autofillFromQuestionnaire}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-bold"
              title={`Seed ${autofillPreview.length} section${autofillPreview.length === 1 ? '' : 's'} from the questionnaire`}
            >
              <Wand2 className="w-4 h-4" /> Generate from questionnaire
              <span className="text-[10px] font-bold bg-omega-orange/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
                {autofillPreview.length} sec · {autofillPreview.reduce((n, s) => n + s.items.length, 0)} items
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Disclaimers — shown on the customer's signing page right above
          the signature canvas. Markdown-ish formatting (**bold**, ---).
          Pre-populated from the global default; the seller can edit
          anything for a one-off estimate (e.g. extra restriction for a
          specific project) without affecting other estimates. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div>
            <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
              <Shield className="w-4 h-4 text-omega-orange" /> Project Disclaimers
            </h2>
            <p className="text-xs text-omega-stone mt-0.5">
              Shown to the client right before the signature canvas. They must check "I have read and acknowledge" before they can sign.
            </p>
          </div>
          {disclaimers !== DEFAULT_ESTIMATE_DISCLAIMERS && (
            <button
              type="button"
              onClick={() => setDisclaimers(DEFAULT_ESTIMATE_DISCLAIMERS)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-bold text-omega-stone hover:border-omega-orange hover:text-omega-orange flex-shrink-0"
              title="Restore the default disclaimer text"
            >
              <RotateCcw className="w-3 h-3" /> Reset to default
            </button>
          )}
        </div>
        <textarea
          rows={10}
          value={disclaimers}
          onChange={(e) => setDisclaimers(e.target.value)}
          placeholder={DEFAULT_ESTIMATE_DISCLAIMERS}
          className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 text-xs focus:border-omega-orange focus:outline-none font-mono leading-relaxed"
        />
        <p className="mt-1 text-[10px] text-omega-stone">
          Tip: <code className="bg-gray-100 px-1 rounded">**bold**</code>, blank lines for paragraphs, <code className="bg-gray-100 px-1 rounded">---</code> for a divider.
        </p>
      </div>

      {/* Footer */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
        <label className="block">
          <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Customer Message / Payment Schedule</span>
          <textarea
            rows={6}
            value={customerMessage}
            onChange={(e) => setCustomerMessage(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none font-mono"
          />
        </label>

        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm font-semibold text-omega-charcoal uppercase tracking-wider">Estimate Total</span>
          <span className="text-3xl font-black text-omega-orange tabular-nums">
            ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {toast && (
          <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm ${
            toast.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {toast.type === 'success'
              ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            }
            <p className="font-semibold">{toast.message}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving || sending}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale disabled:opacity-60 text-sm font-bold"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Draft</>}
          </button>
          <button
            onClick={handleSend}
            disabled={saving || sending || total <= 0}
            title={total <= 0 ? 'Add at least one priced item before sending' : isMultiOption ? `All ${options.length} options will be sent in one email` : ''}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
          >
            {sending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              : <><Mail className="w-4 h-4" /> {isMultiOption ? `Save & Send ${options.length} Options` : 'Save & Send to Client'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ section, onTitle, onMoveUp, onMoveDown, onRemove, onUpdateItem, onAddItem, onRemoveItem, disableUp, disableDown }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-omega-pale/40 border-b border-omega-orange/20 flex items-center gap-2">
        <input
          value={section.title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Section title"
          className="flex-1 bg-transparent text-sm font-bold text-omega-charcoal focus:outline-none"
        />
        <button onClick={onMoveUp} disabled={disableUp}   className="p-1 rounded text-omega-stone hover:text-omega-charcoal disabled:opacity-30" title="Move up"><ChevronUp className="w-4 h-4" /></button>
        <button onClick={onMoveDown} disabled={disableDown} className="p-1 rounded text-omega-stone hover:text-omega-charcoal disabled:opacity-30" title="Move down"><ChevronDown className="w-4 h-4" /></button>
        <button onClick={onRemove} className="p-1 rounded text-red-500 hover:bg-red-50" title="Remove section"><Trash2 className="w-4 h-4" /></button>
      </div>

      <div className="divide-y divide-gray-100">
        {section.items.map((it, iIdx) => (
          <ItemRow
            key={iIdx}
            item={it}
            index={iIdx + 1}
            onChange={(patch) => onUpdateItem(iIdx, patch)}
            onRemove={() => onRemoveItem(iIdx)}
          />
        ))}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 bg-white">
        <button
          onClick={onAddItem}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-omega-orange hover:bg-omega-pale"
        >
          <Plus className="w-3 h-3" /> Add Item
        </button>
      </div>
    </div>
  );
}

function ItemRow({ item, index, onChange, onRemove }) {
  return (
    <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-[1fr_1.5fr_140px_auto] gap-3">
      <div>
        <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">#{index} — Description</label>
        <input
          value={item.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="e.g. Gutter & Downspout Installation"
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Scope of Work</label>
        <textarea
          rows={3}
          value={item.scope}
          onChange={(e) => onChange({ scope: e.target.value })}
          placeholder={"- Remove existing gutters from home.\n- Reconfigure one gutter downspout.\n- Install leaf guards…"}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none font-mono leading-relaxed"
        />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Price</label>
        <div className="relative mt-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-omega-stone font-bold">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={item.price === 0 ? '' : item.price}
            onChange={(e) => onChange({ price: Number(e.target.value) || 0 })}
            placeholder="0.00"
            className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 text-sm tabular-nums focus:border-omega-orange focus:outline-none text-right font-semibold"
          />
        </div>
      </div>
      <div className="flex items-end">
        <button
          onClick={onRemove}
          className="p-2 rounded-lg text-red-500 hover:bg-red-50"
          title="Remove item"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
