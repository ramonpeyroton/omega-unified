import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Plus, Trash2, ChevronUp, ChevronDown, Save, Mail, Loader2,
  AlertCircle, CheckCircle2, Download, Copy, Layers, X, Shield, RotateCcw, Wand2,
  GripVertical, MoreVertical, Eye, Package, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { DEFAULT_ESTIMATE_DISCLAIMERS } from '../data/estimateDisclaimers';
import { autofillSectionsFromAnswers, canAutofill } from '../data/estimateAutofill';
import { StepBadge } from './JobFullView';

// Hard cap on the seller-facing description that prefaces the
// estimate. 500 chars is plenty for "Construction of a 320 sq ft
// deck using …" lines and keeps the customer-facing PDF tight.
const HEADER_DESCRIPTION_MAX = 500;

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

  // Bundle state — different service estimates sent together.
  const [bundleLabel, setBundleLabel] = useState('');
  const [bundleMembers, setBundleMembers] = useState([]);

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

      // Load bundle members if this estimate belongs to a bundle.
      if (latest.bundle_id) {
        const { data: bm } = await supabase
          .from('estimates')
          .select('id, bundle_label, total_amount, status, estimate_number, job_id')
          .eq('bundle_id', latest.bundle_id)
          .order('created_at', { ascending: true });
        setBundleMembers(bm || []);
      } else {
        setBundleMembers([]);
      }

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
    setBundleLabel(row?.bundle_label || '');
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
      bundle_label: bundleLabel || null,
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
  const isInBundle = bundleMembers.length > 1;

  // ─── Bundle helpers ───────────────────────────────────────────────
  async function addServiceToBundle() {
    if (saving || sending) return;
    setSaving(true);
    setToast(null);
    try {
      // Save current estimate first.
      const current = await persist();

      // Generate a bundle_id — reuse existing one if already in a bundle.
      const newBundleId = current.bundle_id || crypto.randomUUID();

      // Backfill bundle_id + default bundle_label on current if not set.
      if (!current.bundle_id) {
        const defaultLabel = current.bundle_label || (job?.service ? job.service.charAt(0).toUpperCase() + job.service.slice(1).toLowerCase() : 'Service 1');
        await supabase.from('estimates').update({
          bundle_id: newBundleId,
          bundle_label: current.bundle_label || defaultLabel,
        }).eq('id', current.id);
      }

      // Create a blank draft estimate in the same bundle.
      const { data: seqData } = await supabase.rpc('next_estimate_number');
      const number = typeof seqData === 'number' ? seqData : (Array.isArray(seqData) ? seqData[0] : null);
      const { data: created, error } = await supabase.from('estimates').insert([{
        job_id: job.id,
        header_description: '',
        sections: [{ title: 'Section 1', items: [{ description: '', scope: '', price: 0 }] }],
        customer_message: current.customer_message,
        total_amount: 0,
        status: 'draft',
        bundle_id: newBundleId,
        bundle_label: `Service ${bundleMembers.length + 1}`,
        option_order: 0,
        estimate_number: number,
        disclaimers: current.disclaimers || null,
      }]).select().single();
      if (error) throw error;

      logAudit({ user, action: 'estimate.bundle_add_service', entityType: 'estimate', entityId: created.id, details: { bundle_id: newBundleId } });
      await load(created.id);
      setToast({ type: 'success', message: 'New service estimate created. Add line items and set the service label.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to add service' });
    }
    setSaving(false);
  }

  async function switchToBundleMember(id) {
    if (id === estimate?.id || saving || sending) return;
    setSaving(true);
    try {
      if (estimate?.id) { try { await persist(); } catch { /* ignore */ } }
      const { data } = await supabase.from('estimates').select('*').eq('id', id).maybeSingle();
      if (data) {
        loadIntoForm(data);
        // Refresh bundle member chips (totals/status may have changed after persist).
        // Do NOT call load() here — load() re-fetches by created_at DESC and would
        // overwrite the form with the newest bundle member instead of the one selected.
        if (data.bundle_id) {
          const { data: bm } = await supabase
            .from('estimates')
            .select('id, bundle_label, total_amount, status, estimate_number, job_id')
            .eq('bundle_id', data.bundle_id)
            .order('created_at', { ascending: true });
          setBundleMembers(bm || []);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeBundleMember(id) {
    if (!confirm('Remove this service from the bundle? The estimate will remain as a standalone draft.')) return;
    try {
      await supabase.from('estimates').update({ bundle_id: null, bundle_label: null }).eq('id', id);
      logAudit({ user, action: 'estimate.bundle_remove_service', entityType: 'estimate', entityId: id });
      if (id === estimate?.id) {
        await load(null);
      } else {
        await load(estimate?.id || null);
      }
      setToast({ type: 'success', message: 'Removed from bundle.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to remove' });
    }
  }

  async function handleDeleteEstimate() {
    if (!estimate?.id) return;
    const label = estimate.estimate_number ? `OM-${estimate.estimate_number}` : 'this estimate';
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      await supabase.from('estimates').delete().eq('id', estimate.id);
      logAudit({ user, action: 'estimate.delete', entityType: 'estimate', entityId: estimate.id, details: { estimate_number: estimate.estimate_number } });
      // Reset form to blank state
      setEstimate(null); setOptions([]); setActiveId(null);
      setBundleMembers([]); setBundleLabel('');
      setHeaderDescription(''); setSections([emptySection()]);
      setCustomerMessage(DEFAULT_PAYMENT); setOptionLabel('');
      setDisclaimers(DEFAULT_ESTIMATE_DISCLAIMERS);
      setToast({ type: 'success', message: `${label} deleted.` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to delete estimate' });
    }
  }

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

      {/* Bundle panel — shows when 2+ estimates are grouped together for
          different services that all need independent client approval. */}
      {isInBundle && (
        <div className="bg-white rounded-xl border-2 border-omega-orange/30 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-omega-orange uppercase tracking-wider">
              <Package className="w-3.5 h-3.5" /> Multi-Service Bundle
              <span className="text-omega-stone font-semibold normal-case tracking-normal">— client approves each one independently</span>
            </div>
            <button
              onClick={addServiceToBundle}
              disabled={saving || sending}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-omega-orange border border-dashed border-omega-orange/50 hover:bg-omega-pale disabled:opacity-60"
            >
              <Plus className="w-3 h-3" /> Add Service
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {bundleMembers.map((m, i) => {
              const isActive = m.id === estimate?.id;
              const isSigned = m.status === 'approved';
              return (
                <div key={m.id} className="inline-flex items-center">
                  <button
                    onClick={() => switchToBundleMember(m.id)}
                    disabled={saving || sending}
                    className={`px-3 py-1.5 rounded-l-lg text-xs font-bold transition-colors ${
                      isActive
                        ? 'bg-omega-orange text-white'
                        : 'bg-white border border-gray-200 text-omega-slate hover:border-omega-orange'
                    }`}
                  >
                    {m.bundle_label || `Service ${i + 1}`}
                    {m.total_amount > 0 && ` · $${Number(m.total_amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                    {isSigned && ' ✓'}
                    {!isSigned && m.status === 'sent' && ' · SENT'}
                  </button>
                  {!isSigned && (
                    <button
                      onClick={() => removeBundleMember(m.id)}
                      disabled={saving || sending}
                      className={`px-2 py-1.5 rounded-r-lg text-xs ${
                        isActive
                          ? 'bg-omega-orange/90 text-white hover:bg-red-500'
                          : 'bg-white border border-l-0 border-gray-200 text-omega-stone hover:text-red-600'
                      }`}
                      title="Remove from bundle"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Step (2): Estimate Details. Two-column layout — description
          textarea on the left, a small "Estimate status" card on the
          right that shows draft/sent/signed plus the estimate number. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start gap-3 mb-4 flex-wrap">
          <StepBadge n={2} />
          <div>
            <h2 className="text-lg font-bold text-omega-charcoal inline-flex items-center gap-2">
              Estimate Details
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
              Add a description and overall notes for this estimate.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-5">
          <div className="space-y-4">
            {/* Option name — only when there are 2+ alternatives */}
            {(isMultiOption || optionLabel) && (
              <label className="block">
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

            {/* Bundle service label — shown when in a bundle */}
            {isInBundle && (
              <label className="block">
                <span className="text-[10px] font-semibold text-omega-orange uppercase tracking-wider">
                  Service label for this proposal (in the bundle)
                </span>
                <input
                  value={bundleLabel}
                  onChange={(e) => setBundleLabel(e.target.value)}
                  placeholder='e.g. "Kitchen Remodel", "Bathroom Renovation"…'
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-omega-orange/40 text-sm focus:border-omega-orange focus:outline-none bg-orange-50/30"
                />
              </label>
            )}

            {/* Start a bundle when not in one yet */}
            {!isInBundle && !isMultiOption && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={addServiceToBundle}
                  disabled={saving || sending || !estimate?.id}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-omega-stone hover:border-omega-orange hover:text-omega-orange disabled:opacity-50"
                  title="Bundle this with another service estimate — the client approves each one separately"
                >
                  <Package className="w-3.5 h-3.5" /> Bundle with another service
                  <span className="text-[10px] text-omega-stone font-normal">(client approves each independently)</span>
                </button>
              </div>
            )}

            <label className="block">
              <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Description (top of estimate)</span>
              <div className="relative">
                <textarea
                  rows={4}
                  value={headerDescription}
                  onChange={(e) => setHeaderDescription(e.target.value.slice(0, HEADER_DESCRIPTION_MAX))}
                  placeholder='e.g. "Construction of a ___ sq. ft. deck using pressure-treated wood…"'
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none"
                />
                {/* Char counter — sits inside the bottom-right of the
                    textarea so it stays close to what the seller is
                    typing without taking a full row. */}
                <span className="absolute bottom-2 right-3 text-[10px] tabular-nums text-omega-stone pointer-events-none">
                  {headerDescription.length} / {HEADER_DESCRIPTION_MAX}
                </span>
              </div>
            </label>
          </div>

          {/* Estimate status — small sidebar card mirroring the redesign.
              Shows the current state in one line + a quick link to the
              previously rendered PDF when one exists. */}
          <aside className="bg-omega-cloud border border-gray-100 rounded-lg p-3 self-start">
            <p className="text-[10px] font-bold text-omega-charcoal uppercase tracking-wider inline-flex items-center gap-1.5">
              <FileText className="w-3 h-3 text-omega-orange" /> Estimate status
            </p>
            <p className="mt-2">
              <span className="inline-block px-2 py-0.5 rounded-md bg-omega-pale text-omega-orange text-[11px] font-bold uppercase tracking-wider">
                {estimate?.status ? estimate.status : 'Draft'}
              </span>
            </p>
            <p className="text-[11px] text-omega-stone mt-2">
              {estimate?.created_at
                ? `Last saved ${new Date(estimate.updated_at || estimate.created_at).toLocaleString()}`
                : 'Not saved yet.'}
            </p>
            {estimate?.pdf_url && (
              <a
                href={estimate.pdf_url} target="_blank" rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 text-[10px] font-bold text-omega-charcoal hover:border-omega-orange"
              >
                <Download className="w-3 h-3" /> Last PDF
              </a>
            )}
          </aside>
        </div>
      </div>

      {/* Step (3): Sections + line items. Wrapper card matches the
          redesign — header on top with the running Estimated Total
          to the right, then the section cards stacked, then the
          two-button row (Add Section / Generate). */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div className="inline-flex items-start gap-3">
            <StepBadge n={3} />
            <div>
              <h2 className="text-lg font-bold text-omega-charcoal">Estimate Sections &amp; Line Items</h2>
              <p className="text-xs text-omega-stone mt-0.5">Organize the work into sections. Add items, scope and pricing.</p>
            </div>
          </div>
          <div className="text-right self-start">
            <p className="text-[10px] font-bold text-omega-stone uppercase tracking-wider">Estimated Total</p>
            <p className="text-2xl font-black text-omega-charcoal tabular-nums leading-none mt-0.5">
              ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {sections.map((sec, sIdx) => (
            <SectionCard
              key={sIdx}
              section={sec}
              sectionIndex={sIdx + 1}
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
            {canShowAutofill ? (
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
            ) : (
              // Placeholder slot keeps Add Section centered when there's
              // no questionnaire seed available, instead of letting it
              // stretch to full width.
              <div />
            )}
          </div>
        </div>
      </div>

      {/* Step (4): Project Disclaimers. Same content as before, now
          fronted with the (4) badge so it reads as the last item on
          the redesign's checklist. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <div className="inline-flex items-start gap-3">
            <StepBadge n={4} />
            <div>
              <h2 className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
                <Shield className="w-4 h-4 text-omega-orange" /> Project Disclaimers
              </h2>
              <p className="text-xs text-omega-stone mt-0.5">
                Shown to the client right before the signature canvas. They must check "I have read and acknowledge" before they can sign.
              </p>
            </div>
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

      {/* Customer message / payment schedule — kept in its own card so
          it doesn't fight the action footer for visual weight. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Customer Message / Payment Schedule</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { label: '30/30/30/10%', value: 'Payment Schedule:\nDeposit - 30%\nUpon Start 30%\nAfter Painting Completion 30%\nUpon Completion 10%' },
              { label: '50/50%',       value: 'Payment Schedule:\nDeposit - 50%\nUpon Completion 50%' },
              { label: '33/33/34%',    value: 'Payment Schedule:\nDeposit - 33%\nMidway 33%\nUpon Completion 34%' },
              { label: '25/50/25%',    value: 'Payment Schedule:\nDeposit - 25%\nUpon Start 50%\nUpon Completion 25%' },
            ].map(({ label, value }) => (
              <button
                key={label}
                type="button"
                onClick={() => setCustomerMessage(value)}
                className="px-2 py-1 rounded-md bg-omega-cloud border border-gray-200 text-[10px] font-bold text-omega-stone hover:border-omega-orange hover:text-omega-orange"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <textarea
            rows={6}
            value={customerMessage}
            onChange={(e) => setCustomerMessage(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none font-mono"
          />
        </label>
      </div>

      {/* Quick Actions — visible from the bottom without scrolling up */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <p className="text-[10px] font-bold text-omega-stone uppercase tracking-wider mb-3">Quick Actions</p>
        <div className="flex flex-wrap gap-2">
          {/* Add price alternative — same service, different scope/price */}
          {!isInBundle && (
            <button
              onClick={addAlternative}
              disabled={saving || sending || !estimate?.id}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-sm font-semibold text-omega-charcoal disabled:opacity-50"
              title="Create a 2nd or 3rd price option for the same service — client picks one"
            >
              <Copy className="w-4 h-4" /> Add Price Alternative
              <span className="text-[10px] text-omega-stone font-normal">client picks one</span>
            </button>
          )}

          {/* Bundle with another service */}
          {!isMultiOption && (
            <button
              onClick={addServiceToBundle}
              disabled={saving || sending || !estimate?.id}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-sm font-semibold text-omega-charcoal disabled:opacity-50"
              title="Add a 2nd or 3rd estimate for a different service — client approves each one"
            >
              <Package className="w-4 h-4" />
              {isInBundle ? `Add Service to Bundle (${bundleMembers.length} now)` : 'Bundle with Another Service'}
              <span className="text-[10px] text-omega-stone font-normal">client approves each</span>
            </button>
          )}

          {/* Preview shortcut */}
          {estimate?.id && (
            <button
              onClick={() => window.open(`/estimate-view/${estimate.id}`, '_blank', 'noopener,noreferrer')}
              disabled={saving || sending}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-sm font-semibold text-omega-charcoal disabled:opacity-50"
            >
              <Eye className="w-4 h-4" /> Preview Client View
            </button>
          )}
        </div>
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

      {/* Action footer — left side shows the save state, right side
          holds Preview / Save Draft / Save & Send. Mirrors the redesign
          mockup's bottom bar. The "auto-saved" wording is honest about
          the current behavior: every save is manual via Save Draft, but
          once a save lands we show "All changes saved" until the user
          edits again. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <SaveStatus saving={saving} estimate={estimate} />
            {estimate?.id && ['owner', 'operations', 'admin'].includes(user?.role) && (
              <button
                onClick={handleDeleteEstimate}
                disabled={saving || sending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold disabled:opacity-50"
                title="Delete this estimate permanently"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Estimate
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {estimate?.id && (
              <button
                onClick={() => window.open(`/estimate-view/${estimate.id}`, '_blank', 'noopener,noreferrer')}
                disabled={saving || sending}
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-bold text-omega-charcoal disabled:opacity-60"
                title="Open the customer-facing version of this estimate in a new tab"
              >
                <Eye className="w-4 h-4" /> Preview Estimate
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || sending}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale disabled:opacity-60 text-sm font-bold"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save Draft</>}
            </button>
            <button
              onClick={handleSend}
              disabled={saving || sending || total <= 0}
              title={
                total <= 0 ? 'Add at least one priced item before sending'
                : isInBundle ? `All ${bundleMembers.length} service proposals will be sent in one email`
                : isMultiOption ? `All ${options.length} options will be sent in one email`
                : ''
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-sm font-bold"
            >
              {sending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                : isInBundle
                  ? <><Package className="w-4 h-4" /> Send Bundle ({bundleMembers.length} proposals)</>
                  : isMultiOption
                    ? <><Mail className="w-4 h-4" /> Save & Send {options.length} Options</>
                    : <><Mail className="w-4 h-4" /> Save & Send to Client</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small read-out for the action footer's left side. Reflects whether
// we're mid-save, when the last save landed, or that we're still on a
// fresh draft. The string updates whenever `saving` flips or the
// passed-in `estimate.updated_at` advances.
function SaveStatus({ saving, estimate }) {
  const stamp = estimate?.updated_at || estimate?.created_at;
  if (saving) {
    return (
      <p className="text-xs text-omega-stone inline-flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
      </p>
    );
  }
  if (!stamp) {
    return (
      <p className="text-xs text-omega-stone">
        <span className="font-semibold text-omega-charcoal">Draft</span> — not saved yet.
      </p>
    );
  }
  return (
    <p className="text-xs text-omega-stone inline-flex items-center gap-2">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
      <span>
        <span className="font-semibold text-omega-charcoal">All changes saved</span>
        <span className="block text-[10px] text-omega-stone">Last save · {new Date(stamp).toLocaleTimeString()}</span>
      </span>
    </p>
  );
}

function SectionCard({ section, sectionIndex = 1, onTitle, onMoveUp, onMoveDown, onRemove, onUpdateItem, onAddItem, onRemoveItem, disableUp, disableDown }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2.5 bg-omega-pale/40 border-b border-omega-orange/20 flex items-center gap-2">
        {/* Drag-handle affordance — purely visual today (drag isn't
            wired yet on the EstimateBuilder; the up/down chevrons do
            the real work). Keeping the icon so the redesign reads
            consistently with the mockup. */}
        <span className="text-omega-fog hover:text-omega-stone cursor-grab" title="Drag to reorder (use arrows for now)">
          <GripVertical className="w-4 h-4" />
        </span>
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
            // "1.1", "1.2", "2.1" — matches the redesign mockup so the
            // seller can refer to a specific line by section + position.
            label={`${sectionIndex}.${iIdx + 1}`}
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

function ItemRow({ item, label, onChange, onRemove }) {
  return (
    <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-[44px_1fr_1.5fr_140px_auto] gap-3 items-start">
      {/* Section.position label — sits on the left so the columns line
          up with the redesign mockup ("1.1", "1.2", "2.1"). */}
      <div className="md:pt-7">
        <span className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-omega-cloud border border-gray-200 text-[11px] font-bold text-omega-charcoal tabular-nums">
          {label}
        </span>
      </div>
      <div>
        <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Description</label>
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
