import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Plus, Trash2, ChevronUp, ChevronDown, Save, Mail, Loader2,
  AlertCircle, CheckCircle2, Download, Copy, Layers, X, Shield, RotateCcw, Wand2,
  GripVertical, MoreVertical, Eye, Package, ChevronRight, ArrowLeft, Lock, History,
} from 'lucide-react';
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { apiFetch } from '../lib/apiFetch.js';
import { DEFAULT_ESTIMATE_DISCLAIMERS } from '../data/estimateDisclaimers';
import { autofillSectionsFromAnswers, canAutofill } from '../data/estimateAutofill';
import { sectionsTotal, itemsTotal } from '../lib/estimatePricing';
import EstimateChooser, { isEstimateLocked } from './EstimateChooser';
import { StepBadge } from './JobFullView';

// Stable IDs make sections + items addressable by @dnd-kit. Older
// estimate rows in the DB lack them — `ensureIds` lazily backfills
// on load so existing data keeps working without a migration.
function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function ensureIds(sections) {
  return (sections || []).map((s) => ({
    id: s.id || newId(),
    title: s.title || '',
    // Section price — only used in "Price by Section" mode.
    ...(s.price !== undefined ? { price: s.price } : {}),
    items: (s.items || []).map((it) => ({ id: it.id || newId(), ...it })),
  }));
}

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

// ─── Structured payment plan ──────────────────────────────────────────
// The plan is now the SOURCE OF TRUTH, saved to estimates.payment_plan so
// the contract reads it directly instead of re-parsing the free-text
// customer message (which was fragile: dollar amounts, a stray %, or a
// non-100% sum made the contract silently fall back to a default plan).
// The customer-facing text is generated FROM these rows so the client
// still sees the schedule.
const DEFAULT_PLAN_ROWS = [
  { label: 'Deposit', percent: '30' },
  { label: 'Upon Start', percent: '30' },
  { label: 'After Painting Completion', percent: '30' },
  { label: 'Upon Completion', percent: '10' },
];

const PLAN_PRESETS = [
  { label: '30/30/30/10%', rows: [{ label: 'Deposit', percent: '30' }, { label: 'Upon Start', percent: '30' }, { label: 'After Painting Completion', percent: '30' }, { label: 'Upon Completion', percent: '10' }] },
  { label: '50/50%',       rows: [{ label: 'Deposit', percent: '50' }, { label: 'Upon Completion', percent: '50' }] },
  { label: '33/33/34%',    rows: [{ label: 'Deposit', percent: '33' }, { label: 'Midway', percent: '33' }, { label: 'Upon Completion', percent: '34' }] },
  { label: '25/50/25%',    rows: [{ label: 'Deposit', percent: '25' }, { label: 'Upon Start', percent: '50' }, { label: 'Upon Completion', percent: '25' }] },
];

// Structured rows → customer-facing schedule text.
function planRowsToText(rows) {
  const lines = (rows || [])
    .filter((r) => (r.label || '').trim() || r.percent)
    .map((r) => `${(r.label || '').trim()} ${Number(r.percent) || 0}%`.trim());
  return lines.length ? `Payment Schedule:\n${lines.join('\n')}` : '';
}

// Backward-compat: turn an old free-text schedule into structured rows so
// existing estimates keep their plan when reopened. Same permissive
// "label N%" parse the contract used to rely on — but here it only seeds
// the editable table; the operator can fix it, and it saves structured.
function parsePlanRows(message) {
  if (!message || typeof message !== 'string') return [];
  const cleaned = message.replace(/payment\s*schedule\s*:?/i, '');
  const pct = /([\d]+(?:\.\d+)?)\s*%/;
  const out = [];
  for (const chunk of cleaned.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const m = chunk.match(pct);
    if (!m) continue;
    const percent = Number(m[1]);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) continue;
    const label = chunk.replace(pct, '').replace(/^\s*[-–:•]+\s*/, '').replace(/\s*[-–:•]+\s*$/, '').trim() || `Installment ${out.length + 1}`;
    out.push({ label, percent: String(percent) });
  }
  const totalPct = out.reduce((s, r) => s + Number(r.percent), 0);
  if (out.length === 0 || Math.abs(totalPct - 100) > 5) return [];
  return out;
}

// The three price formats the seller picks before filling the estimate.
const PRICE_MODE_CARDS = [
  { key: 'breakdown', icon: '📋', title: 'Breakdown Price', hint: 'Client sees each line item with its price' },
  { key: 'section',   icon: '📑', title: 'Price by Section', hint: 'Client sees one price per section — items listed without prices' },
  { key: 'single',    icon: '💰', title: 'Single Price', hint: 'Client sees only the grand total — no item or section prices' },
];

// The editable content of an estimate row, as kept in estimate_versions.
function versionData(row) {
  return {
    header_description: row.header_description ?? '',
    sections: row.sections ?? [],
    customer_message: row.customer_message ?? null,
    payment_plan: row.payment_plan ?? null,
    total_amount: row.total_amount ?? 0,
    option_label: row.option_label ?? null,
    bundle_label: row.bundle_label ?? null,
    display_mode: row.display_mode ?? 'breakdown',
    disclaimers: row.disclaimers ?? null,
    show_financing: row.show_financing !== false,
  };
}

function emptyItem()    { return { id: newId(), description: '', scope: '', price: 0 }; }
function emptySection() { return { id: newId(), title: 'Section 1', items: [emptyItem()] }; }

export default function EstimateBuilder({ job, user, onJobUpdated, editEstimateId }) {
  const [estimate, setEstimate] = useState(null); // currently edited row
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [sending, setSending]   = useState(false);
  const [toast, setToast]       = useState(null);

  // Form state (for the row currently being edited).
  const [headerDescription, setHeaderDescription] = useState('');
  const [sections, setSections] = useState([emptySection()]);
  const [customerMessage, setCustomerMessage] = useState(DEFAULT_PAYMENT);
  // Structured payment plan (source of truth for the contract).
  const [paymentPlan, setPaymentPlan] = useState(() => DEFAULT_PLAN_ROWS.map((r) => ({ ...r })));
  const [optionLabel, setOptionLabel] = useState('');
  // Disclaimers shown to the customer right above the signature flow.
  // Defaults to the global template; the seller can edit them per-estimate.
  const [disclaimers, setDisclaimers] = useState(DEFAULT_ESTIMATE_DISCLAIMERS);

  // Multi-option state. `options` is the whole group, ordered by
  // option_order. When there's 0 or 1 rows, the switcher hides.
  const [options, setOptions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // Inline delete confirmation — tracks which option/bundle id is pending
  // a second-click confirm. Resets on any other interaction.
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  // Bundle state — different service estimates sent together.
  const [bundleLabel, setBundleLabel] = useState('');
  const [bundleMembers, setBundleMembers] = useState([]);

  // Price display mode — must be chosen before the form unlocks for new estimates.
  // 'breakdown': client sees each line item with price (default)
  // 'section':   one price per section (typed on the section), items without prices
  // 'single':    client sees only the grand total, no per-item prices
  // See shared/lib/estimatePricing.js — every client document follows it.
  const [displayMode, setDisplayMode] = useState(null); // null = not yet chosen

  // Show the Acorn Finance "Need Flexible Payments?" card on the customer's
  // estimate view. Defaults to ON — the seller flips it OFF only when
  // financing doesn't apply (commercial work, cash client, sub-only scope).
  const [showFinancing, setShowFinancing] = useState(true);

  // The tab opens on a choice — "New Estimate" or one of the job's
  // estimates — instead of dropping the seller into the latest one
  // (EstimateChooser). 'choose' = that step, 'edit' = the builder.
  const [view, setView] = useState('edit');
  const [jobEstimates, setJobEstimates] = useState([]);

  // Approved / signed: the client signed this version — shown read-only,
  // never saved over (no Save/Send, no alternatives or bundling).
  const locked = isEstimateLocked(estimate);

  // Someone else saved this estimate after it was opened here — the save
  // is held back and EstimateConflictModal asks what to do (caso #2104).
  const [conflict, setConflict] = useState(null); // { row, by, versioned }
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => { init(); /* eslint-disable-next-line */ }, [job?.id, editEstimateId]);

  async function fetchJobEstimates() {
    const { data } = await supabase
      .from('estimates')
      .select('id, estimate_number, status, display_mode, total_amount, bundle_id, bundle_label, group_id, option_label, option_order, header_description, sections, created_at, updated_at, sent_at, signed_at, signed_by, approved_at')
      .eq('job_id', job.id)
      .order('created_at', { ascending: false });
    setJobEstimates(data || []);
    return data || [];
  }

  async function init() {
    setLoading(true);
    let list = [];
    try { list = await fetchJobEstimates(); } catch { /* list stays empty */ }
    // "Edit" from the Documents tab already picked one — open it directly.
    if (editEstimateId) { setView('edit'); await load(editEstimateId); return; }
    resetToBlank();
    // No estimates yet: the only option is a new one, so skip the choice.
    setView(list.length ? 'choose' : 'edit');
    setLoading(false);
  }

  function resetToBlank() {
    setEstimate(null); setOptions([]); setActiveId(null);
    setBundleMembers([]); setBundleLabel(''); setPendingDeleteId(null);
    setHeaderDescription(''); setSections([emptySection()]);
    setCustomerMessage(DEFAULT_PAYMENT); setPaymentPlan(DEFAULT_PLAN_ROWS.map((r) => ({ ...r }))); setOptionLabel('');
    setDisclaimers(DEFAULT_ESTIMATE_DISCLAIMERS);
    setDisplayMode(null); setShowFinancing(true);
  }

  function startNewEstimate() {
    resetToBlank();
    setToast(null);
    setView('edit');
  }

  function openEstimate(id) {
    setToast(null);
    setView('edit');
    load(id);
  }

  // A brand-new estimate that was never saved but already has typing in it.
  function hasUnsavedNewWork() {
    if (estimate?.id) return false;
    return !!headerDescription.trim() ||
      sections.length > 1 ||
      (sections[0]?.title && sections[0].title !== 'Section 1') ||
      sections.some((s) => Number(s.price) > 0 ||
        (s.items || []).some((it) => it.description?.trim() || it.scope?.trim() || Number(it.price) > 0));
  }

  // What the form held when it was last loaded or saved — "All estimates"
  // only saves when something actually changed.
  const savedSnapshotRef = useRef(null);
  function formSnapshot() {
    return JSON.stringify([headerDescription, sections, customerMessage, paymentPlan, optionLabel, disclaimers, bundleLabel, displayMode, showFinancing]);
  }
  // loadIntoForm sets the estimate and every form field in one render.
  useEffect(() => { savedSnapshotRef.current = formSnapshot(); /* eslint-disable-next-line */ }, [estimate?.id]);

  async function backToAllEstimates() {
    if (saving || sending) return;
    if (hasUnsavedNewWork() && !confirm('This new estimate was never saved. Discard it and go back to all estimates?')) return;
    setSaving(true);
    // Same as switching options: keep the seller's edits.
    try {
      if (estimate?.id && !locked && formSnapshot() !== savedSnapshotRef.current) await persist();
    } catch (err) {
      // Stay here so the conflict modal decides what happens to the edits.
      if (err?.code === 'ESTIMATE_CONFLICT') { setSaving(false); return; }
    }
    setSaving(false);
    setToast(null);
    resetToBlank();
    let list = [];
    try { list = await fetchJobEstimates(); } catch { /* ignore */ }
    setView(list.length ? 'choose' : 'edit');
  }

  async function load(preferredActiveId) {
    setLoading(true);
    try {
      // If a specific estimate was requested (Edit button), start from that
      // one so we load its group. Otherwise fall back to most recent.
      let rootEstimate = null;
      if (preferredActiveId) {
        const { data: pref } = await supabase
          .from('estimates').select('*')
          .eq('id', preferredActiveId)
          .maybeSingle();
        rootEstimate = pref;
      }
      if (!rootEstimate) {
        const { data: latest } = await supabase
          .from('estimates').select('*')
          .eq('job_id', job.id)
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        rootEstimate = latest;
      }
      if (!rootEstimate) {
        // No estimate yet — start a blank single-option draft.
        setOptions([]); setActiveId(null); setEstimate(null);
        setLoading(false);
        return;
      }
      const groupId = rootEstimate.group_id || rootEstimate.id;
      const { data: group } = await supabase
        .from('estimates').select('*')
        .eq('group_id', groupId)
        .order('option_order', { ascending: true });
      const siblings = (group && group.length) ? group : [rootEstimate];
      setOptions(siblings);

      // Load bundle members if this estimate belongs to a bundle.
      if (rootEstimate.bundle_id) {
        const { data: bm } = await supabase
          .from('estimates')
          .select('id, bundle_label, total_amount, status, estimate_number, job_id')
          .eq('bundle_id', rootEstimate.bundle_id)
          .order('created_at', { ascending: true });
        setBundleMembers(bm || []);
      } else {
        setBundleMembers([]);
      }

      // Figure out which option to land on:
      //   1) the caller's preferred id (just created / switched)
      //   2) whichever we were already editing
      //   3) the root estimate we loaded
      const picked =
        siblings.find((s) => s.id === preferredActiveId) ||
        siblings.find((s) => s.id === activeId) ||
        siblings.find((s) => s.id === rootEstimate.id) ||
        siblings[0];
      loadIntoForm(picked);
    } catch { /* ignore */ }
    setLoading(false);
  }

  function loadIntoForm(row) {
    setEstimate(row);
    setActiveId(row?.id || null);
    setHeaderDescription(row?.header_description || '');
    setSections(Array.isArray(row?.sections) && row.sections.length ? ensureIds(row.sections) : [emptySection()]);
    setCustomerMessage(row?.customer_message || DEFAULT_PAYMENT);
    // Seed the structured plan from the saved column when present; else
    // parse the old text (backward compat); else the 30/30/30/10 default.
    const seededPlan = Array.isArray(row?.payment_plan) && row.payment_plan.length
      ? row.payment_plan.map((p) => ({ label: p.label || '', percent: String(p.percent ?? '') }))
      : parsePlanRows(row?.customer_message || DEFAULT_PAYMENT);
    setPaymentPlan(seededPlan.length ? seededPlan : DEFAULT_PLAN_ROWS.map((r) => ({ ...r })));
    setOptionLabel(row?.option_label || '');
    // Use the persisted disclaimers if the seller already customized
    // them on this estimate; otherwise fall back to the default. A row
    // saved before migration 019 will have `disclaimers === undefined`.
    setDisclaimers(row?.disclaimers || DEFAULT_ESTIMATE_DISCLAIMERS);
    setBundleLabel(row?.bundle_label || '');
    setDisplayMode(row?.display_mode || 'breakdown');
    // Default to TRUE when the column is absent (pre-migration rows) or
    // explicitly true. Only honor an explicit `false`.
    setShowFinancing(row?.show_financing !== false);
  }

  // Switching INTO "Price by Section" seeds each section that has no
  // price yet with the sum of its item prices, so the total doesn't
  // change under the seller's feet. Prices are never deleted when the
  // mode changes — item prices and section prices are kept side by
  // side, and the mode only decides which ones count.
  function changeDisplayMode(next) {
    if (next === 'section' && displayMode !== 'section') {
      setSections((prev) => prev.map((s) => (
        Number(s.price) > 0 ? s : { ...s, price: itemsTotal(s) }
      )));
    }
    setDisplayMode(next);
  }

  // ─── Section / item helpers ───────────────────────────────────────
  function updateSection(idx, patch) {
    setSections((prev) => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function addSection() {
    setSections((prev) => [...prev, { id: newId(), title: `Section ${prev.length + 1}`, items: [emptyItem()] }]);
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

  // ─── Drag-and-drop reorder (sections + items, including
  //     cross-section item moves) ─────────────────────────────────────
  // Section IDs are used directly; item IDs are namespaced with `i:`
  // so a section UUID can never collide with an item UUID in the same
  // DndContext. Rendering uses the same prefix so dnd-kit's lookup
  // matches the IDs we hand it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Lookup helper: locate which section currently owns an item ID.
  function findItemLocation(state, itemId) {
    for (let s = 0; s < state.length; s++) {
      const i = state[s].items.findIndex((it) => it.id === itemId);
      if (i >= 0) return { sectionIndex: s, itemIndex: i };
    }
    return null;
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const isSection = (id) => sections.some((s) => s.id === id);

    setSections((prev) => {
      // Section ↔ Section: simple reorder.
      if (isSection(active.id) && isSection(over.id)) {
        const from = prev.findIndex((s) => s.id === active.id);
        const to   = prev.findIndex((s) => s.id === over.id);
        if (from < 0 || to < 0 || from === to) return prev;
        return arrayMove(prev, from, to);
      }

      // Item drag — strip the `i:` prefix to recover the real item id.
      if (!String(active.id).startsWith('i:')) return prev;
      const activeItemId = String(active.id).slice(2);

      const src = findItemLocation(prev, activeItemId);
      if (!src) return prev;

      // Drop target is another item ("i:<id>") OR a whole section.
      let destSection;
      let destIndex;
      if (String(over.id).startsWith('i:')) {
        const overItemId = String(over.id).slice(2);
        const dst = findItemLocation(prev, overItemId);
        if (!dst) return prev;
        destSection = dst.sectionIndex;
        destIndex   = dst.itemIndex;
      } else if (prev.some((s) => s.id === over.id)) {
        // Dropped on a section header / empty area — append to that section.
        destSection = prev.findIndex((s) => s.id === over.id);
        destIndex   = prev[destSection].items.length;
      } else {
        return prev;
      }

      // Same section reorder — use arrayMove on the items array.
      if (src.sectionIndex === destSection) {
        if (src.itemIndex === destIndex) return prev;
        return prev.map((s, i) => i === destSection
          ? { ...s, items: arrayMove(s.items, src.itemIndex, destIndex) }
          : s);
      }

      // Cross-section move — pop from source, splice into target.
      const next = prev.map((s) => ({ ...s, items: [...s.items] }));
      const [moved] = next[src.sectionIndex].items.splice(src.itemIndex, 1);
      // Clamp dest index in case the splice shifted indexes elsewhere.
      const clamped = Math.min(destIndex, next[destSection].items.length);
      next[destSection].items.splice(clamped, 0, moved);
      // Sections cannot be empty — drop in a placeholder if we just
      // emptied the source.
      if (next[src.sectionIndex].items.length === 0) {
        next[src.sectionIndex].items.push(emptyItem());
      }
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
  // Section prices in "Price by Section" mode, item prices otherwise.
  const priceBySection = displayMode === 'section';
  const total = sectionsTotal(sections, displayMode);

  // ─── Payment plan editor handlers ─────────────────────────────────
  // Editing the rows keeps the customer-facing message text in sync so
  // the client always sees the schedule that the contract will use.
  const planSumPct = paymentPlan.reduce((s, r) => s + (Number(r.percent) || 0), 0);
  function applyPlanPreset(rows) {
    const next = rows.map((r) => ({ ...r }));
    setPaymentPlan(next);
    setCustomerMessage(planRowsToText(next));
  }
  function setPlanRow(i, key, val) {
    const next = paymentPlan.map((r, idx) => (idx === i ? { ...r, [key]: val } : r));
    setPaymentPlan(next);
    setCustomerMessage(planRowsToText(next));
  }
  function addPlanRow() {
    setPaymentPlan((prev) => [...prev, { label: '', percent: '' }]);
  }
  function removePlanRow(i) {
    const next = paymentPlan.filter((_, idx) => idx !== i);
    setPaymentPlan(next);
    setCustomerMessage(planRowsToText(next));
  }

  // ─── Persistence ──────────────────────────────────────────────────
  // force = save over a newer version someone else saved (conflict modal).
  async function persist(extra = {}, { force = false } = {}) {
    const base = {
      job_id: job.id,
      header_description: headerDescription,
      sections,
      customer_message: customerMessage,
      // Structured plan — the contract reads this directly (no more
      // parsing the message text). Amounts derived from the live total.
      payment_plan: paymentPlan
        .filter((r) => (r.label || '').trim() || r.percent)
        .map((r) => {
          const pct = Number(r.percent) || 0;
          return { label: (r.label || '').trim(), percent: pct, amount: Math.round((pct / 100) * total * 100) / 100, due_date: '' };
        }),
      total_amount: total,
      option_label: optionLabel || null,
      bundle_label: bundleLabel || null,
      display_mode: displayMode || 'breakdown',
      // Persist whatever disclaimer text the seller has on screen, so
      // the customer always sees the latest version when they open the
      // signing page. Migration 019 adds the column; row-level fallback
      // happens in the API if it's pending.
      disclaimers: disclaimers || null,
      // Acorn financing toggle (migration 065). Defaults to true; sellers
      // flip off per-estimate when financing doesn't apply.
      show_financing: showFinancing,
      ...extra,
    };
    // Preserve an existing row's status on save (was dropping 'sent'
    // back to 'draft' every time before — that was wrong).
    if (!('status' in base)) base.status = estimate?.status || 'draft';

    if (estimate?.id) {
      // No DB trigger keeps updated_at — stamp it so "Last saved" is true.
      let query = supabase
        .from('estimates').update({ ...base, updated_at: new Date().toISOString() }).eq('id', estimate.id);
      // Only overwrite the version this form was loaded from. If someone
      // saved in between, nothing matches and we ask instead.
      if (!force && estimate.updated_at) query = query.eq('updated_at', estimate.updated_at);
      const { data: rows, error } = await query.select();
      if (error) throw error;
      if (!rows?.length) {
        const theirs = await loadLatestSave(estimate.id);
        setConflict(theirs);
        const err = new Error(`${theirs.by || 'Someone else'} saved this estimate after you opened it — nothing was overwritten.`);
        err.code = 'ESTIMATE_CONFLICT';
        throw err;
      }
      const data = rows[0];
      savedSnapshotRef.current = formSnapshot();
      recordVersion(data, estimate);
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
      savedSnapshotRef.current = formSnapshot();
      recordVersion(data, null);
      return data;
    }
  }

  // ─── Version history (estimate_versions, migration 084) ───────────
  // Every save keeps a copy so an overwritten estimate can be brought
  // back. The first save after this feature also stores the version that
  // was on screen before it. Best effort: never blocks or fails a save.
  async function recordVersion(saved, previous) {
    try {
      if (previous?.id) {
        const { data: any } = await supabase
          .from('estimate_versions').select('id').eq('estimate_id', saved.id).limit(1);
        if (any && any.length === 0) {
          await supabase.from('estimate_versions').insert([{
            estimate_id: saved.id, saved_by: null,
            saved_at: previous.updated_at || previous.created_at || null,
            data: versionData(previous),
          }]);
        }
      }
      await supabase.from('estimate_versions').insert([{
        estimate_id: saved.id, saved_by: user?.name || null,
        saved_at: saved.updated_at || new Date().toISOString(),
        data: versionData(saved),
      }]);
    } catch { /* history is optional */ }
  }

  // Who saved the newer version, and the row itself (for the conflict modal).
  async function loadLatestSave(id) {
    const { data: row } = await supabase.from('estimates').select('*').eq('id', id).maybeSingle();
    let by = null;
    let versioned = false;
    try {
      const { data: v } = await supabase
        .from('estimate_versions').select('saved_by, saved_at')
        .eq('estimate_id', id).order('saved_at', { ascending: false }).limit(1);
      if (v?.[0]) { by = v[0].saved_by; versioned = v[0].saved_at === row?.updated_at; }
    } catch { /* table may not exist yet */ }
    if (!by) {
      const { data: a } = await supabase
        .from('audit_log').select('user_name')
        .eq('entity_id', id).in('action', ['estimate.save', 'estimate.send'])
        .order('timestamp', { ascending: false }).limit(1);
      by = a?.[0]?.user_name || null;
    }
    return { row, by, versioned };
  }

  function loadTheirVersion() {
    if (!conflict?.row) return;
    loadIntoForm(conflict.row);
    setConflict(null);
    setToast({ type: 'success', message: `Loaded the version saved by ${conflict.by || 'the other user'}. Your unsaved changes were dropped.` });
  }

  async function saveMineAnyway() {
    const theirs = conflict;
    setConflict(null);
    setSaving(true);
    setToast(null);
    try {
      // Their version stays recoverable in History.
      if (theirs?.row && !theirs.versioned) {
        try {
          await supabase.from('estimate_versions').insert([{
            estimate_id: theirs.row.id, saved_by: theirs.by || null,
            saved_at: theirs.row.updated_at || null, data: versionData(theirs.row),
          }]);
        } catch { /* history is optional */ }
      }
      const saved = await persist({}, { force: true });
      setEstimate(saved);
      logAudit({ user, action: 'estimate.save', entityType: 'estimate', entityId: saved.id, details: { total, overwrote: theirs?.by || null } });
      setToast({ type: 'success', message: `Saved. The version by ${theirs?.by || 'the other user'} is kept in History.` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to save' });
    }
    setSaving(false);
  }

  // Put an older version back in the editor. Nothing is saved until the
  // seller hits Save Draft.
  function restoreVersion(v) {
    loadIntoForm({ ...estimate, ...v.data });
    setHistoryOpen(false);
    const when = new Date(v.saved_at).toLocaleString();
    setToast({ type: 'success', message: `Version from ${when} loaded — click Save Draft to keep it.` });
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
      Number(sections[0]?.price) > 0 ||
      (sections[0]?.items || []).some((it) => it.description?.trim() || it.scope?.trim() || Number(it.price) > 0) ||
      (sections[0]?.title && sections[0].title !== 'Section 1');
    if (hasUserContent) {
      const ok = confirm('Replace the current sections with the auto-filled draft from the questionnaire? The current items will be discarded.');
      if (!ok) return;
    }
    // Each generated section keeps the seller's defaults (one blank
    // line at the bottom is convenient for adding extras inline).
    const seeded = autofillPreview.map((s) => ({
      id: newId(),
      title: s.title,
      items: (s.items.length ? s.items : [emptyItem()]).map((it) => ({ id: newId(), ...it })),
    }));
    setSections(seeded);
    setToast({ type: 'success', message: `Drafted ${seeded.length} section${seeded.length === 1 ? '' : 's'} from the questionnaire. Review and add prices.` });
  }

  // ─── Multi-option helpers ──────────────────────────────────────────
  async function addAlternative() {
    if (saving || sending || locked) return;
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
        payment_plan: current.payment_plan,
        total_amount: current.total_amount,
        // Same price format as the option it copies — without it a
        // "Price by Section" copy would reopen as Breakdown at $0.
        display_mode: current.display_mode,
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
    setPendingDeleteId(null);
    setSaving(true);
    try {
      // Save current first so edits don't get lost (never over a locked one).
      if (activeId && !locked && formSnapshot() !== savedSnapshotRef.current) {
        try { await persist(); } catch (err) { if (err?.code === 'ESTIMATE_CONFLICT') return; }
      }
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
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return; }
    setPendingDeleteId(null);
    try {
      await supabase.from('estimates').delete().eq('id', id);
      logAudit({ user, action: 'estimate.remove_alternative', entityType: 'estimate', entityId: id });
      // If we just deleted the active one, open one of the options left.
      await load(id === activeId ? (options.find((o) => o.id !== id)?.id || null) : activeId);
      setToast({ type: 'success', message: 'Alternative removed.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to remove alternative' });
    }
  }

  const isMultiOption = options.length > 1;
  const isInBundle = bundleMembers.length > 1;

  // ─── Bundle helpers ───────────────────────────────────────────────
  async function addServiceToBundle() {
    if (saving || sending || locked) return;
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
        payment_plan: current.payment_plan,
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
      if (estimate?.id && !locked && formSnapshot() !== savedSnapshotRef.current) {
        try { await persist(); } catch (err) { if (err?.code === 'ESTIMATE_CONFLICT') return; }
      }
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
    if (pendingDeleteId !== id) { setPendingDeleteId(id); return; }
    setPendingDeleteId(null);
    try {
      await supabase.from('estimates').update({ bundle_id: null, bundle_label: null }).eq('id', id);
      logAudit({ user, action: 'estimate.bundle_remove_service', entityType: 'estimate', entityId: id });
      if (id === estimate?.id) {
        // Same estimate, now on its own — keep editing it.
        await load(id);
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
      // Back to the list of what's left (or a blank one if nothing is).
      resetToBlank();
      const list = await fetchJobEstimates();
      setView(list.length ? 'choose' : 'edit');
      setToast({ type: 'success', message: `${label} deleted.` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Failed to delete estimate' });
    }
  }

  async function handleSave() {
    if (locked) return;
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
    if (locked) return;
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

      const res = await apiFetch('/api/send-estimate', {
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

      {/* Step zero: New Estimate or pick one of the job's estimates. The
          builder below stays dimmed and locked until a choice is made. */}
      {view === 'choose' && (
        <EstimateChooser estimates={jobEstimates} onNew={startNewEstimate} onOpen={openEstimate} />
      )}

      {view === 'edit' && (jobEstimates.length > 0 || estimate?.id) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={backToAllEstimates}
            disabled={saving || sending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-bold text-omega-charcoal hover:border-omega-orange hover:text-omega-orange disabled:opacity-60"
          >
            <ArrowLeft className="w-4 h-4" /> All estimates
          </button>
          <span className="text-xs text-omega-stone">
            {estimate?.estimate_number ? `Estimate #${estimate.estimate_number}` : 'New estimate — not saved yet'}
          </span>
        </div>
      )}

      {/* Approved / signed — read-only. */}
      {view === 'edit' && locked && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3 flex-wrap sm:flex-nowrap">
          <Lock className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-green-900">
              {estimate?.estimate_number ? `#${estimate.estimate_number} ` : 'This estimate '}
              is {estimate?.status === 'superseded' ? 'superseded' : 'approved'} — view only
            </p>
            <p className="text-xs text-green-800 mt-0.5">
              {estimate?.status === 'superseded'
                ? 'It was replaced by a newer estimate, so it can no longer be changed.'
                : 'The client signed this version, so it can\'t be changed. For extra work, go back to All estimates and start a New Estimate (or a Change Order if the contract is signed).'}
            </p>
          </div>
          <a
            href={`/estimate-view/${estimate.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-green-300 bg-white text-xs font-bold text-green-800 hover:border-green-500 flex-shrink-0"
          >
            <Eye className="w-3.5 h-3.5" /> View client version
          </a>
        </div>
      )}

      <div className={view === 'choose' ? 'opacity-40 pointer-events-none select-none space-y-5' : 'space-y-5'} aria-hidden={view === 'choose' || undefined}>

      {/* Bundle panel — shows when 2+ estimates are grouped together for
          different services that all need independent client approval. */}
      {isInBundle && (
        <div className="bg-white rounded-xl border-2 border-omega-orange/30 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-omega-orange uppercase tracking-wider">
              <Package className="w-3.5 h-3.5" /> Multi-Service Bundle
              <span className="text-omega-stone font-semibold normal-case tracking-normal">— client approves each one independently</span>
            </div>
            {!locked && (
              <button
                onClick={addServiceToBundle}
                disabled={saving || sending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-omega-orange border border-dashed border-omega-orange/50 hover:bg-omega-pale disabled:opacity-60"
              >
                <Plus className="w-3 h-3" /> Add Service
              </button>
            )}
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
                      className={`px-2 py-1.5 rounded-r-lg text-xs font-bold transition-colors ${
                        pendingDeleteId === m.id
                          ? 'bg-red-500 text-white'
                          : isActive
                            ? 'bg-omega-orange/90 text-white hover:bg-red-500'
                            : 'bg-white border border-l-0 border-gray-200 text-omega-stone hover:text-red-600'
                      }`}
                      title={pendingDeleteId === m.id ? 'Click again to confirm removal' : 'Remove from bundle'}
                    >
                      {pendingDeleteId === m.id ? '?' : <X className="w-3 h-3" />}
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
                    className={`px-2 py-1.5 rounded-r-lg text-xs font-bold transition-colors ${
                      pendingDeleteId === opt.id
                        ? 'bg-red-500 text-white'
                        : isActive
                          ? 'bg-omega-orange/90 text-white hover:bg-red-500'
                          : 'bg-white border border-l-0 border-gray-200 text-omega-stone hover:text-red-600'
                    }`}
                    title={pendingDeleteId === opt.id ? 'Click again to confirm removal' : 'Remove this alternative'}
                  >
                    {pendingDeleteId === opt.id ? '?' : <X className="w-3 h-3" />}
                  </button>
                )}
              </div>
            );
          })}
          {!locked && (
            <button
              onClick={addAlternative}
              disabled={saving || sending}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-omega-orange border border-dashed border-omega-orange/50 hover:bg-omega-pale disabled:opacity-60"
            >
              <Copy className="w-3 h-3" /> Add Alternative
            </button>
          )}
        </div>
      )}

      {/* ── Configure Estimate ─────────────────────────────────────────
          Shown at the top so Attila picks the estimate type BEFORE he
          starts filling in sections. The form below is locked until a
          price display mode is chosen. */}
      <div className={`bg-white rounded-xl border-2 p-4 sm:p-5 ${displayMode ? 'border-omega-orange/20' : 'border-omega-orange'}`}>
        <p className="text-[11px] font-bold text-omega-charcoal uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-omega-orange text-white text-[10px] font-black inline-flex items-center justify-center">✦</span>
          Configure Estimate
          {!displayMode && <span className="text-omega-orange font-semibold normal-case tracking-normal text-[11px]">— pick a format to unlock the form</span>}
        </p>

        {/* Price display mode */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          {PRICE_MODE_CARDS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => changeDisplayMode(m.key)}
              disabled={locked}
              className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all disabled:cursor-not-allowed ${
                displayMode === m.key
                  ? 'border-omega-orange bg-omega-pale'
                  : 'border-gray-200 hover:border-omega-orange/50 bg-white'
              }`}
            >
              <span className={`mt-0.5 text-lg leading-none ${displayMode === m.key ? 'opacity-100' : 'opacity-40'}`}>{m.icon}</span>
              <span>
                <span className="block text-sm font-bold text-omega-charcoal">{m.title}</span>
                <span className="block text-[11px] text-omega-stone mt-0.5">{m.hint}</span>
              </span>
              {displayMode === m.key && (
                <span className="ml-auto mt-0.5 w-4 h-4 rounded-full bg-omega-orange flex-shrink-0 inline-flex items-center justify-center text-white text-[10px] font-black">✓</span>
              )}
            </button>
          ))}
        </div>

        {/* Other quick actions — shown once form is usable. Never on an
            approved estimate: new work there gets its own New Estimate. */}
        {displayMode && !locked && (
          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
            {!isInBundle && (
              <button
                onClick={addAlternative}
                disabled={saving || sending || !estimate?.id}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-xs font-semibold text-omega-charcoal disabled:opacity-50"
                title="Create a 2nd or 3rd price option — client picks one"
              >
                <Copy className="w-3.5 h-3.5" /> Add Price Alternative
                <span className="text-[10px] text-omega-stone font-normal">client picks one</span>
              </button>
            )}
            {!isMultiOption && (
              <button
                onClick={addServiceToBundle}
                disabled={saving || sending || !estimate?.id}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange hover:text-omega-orange text-xs font-semibold text-omega-charcoal disabled:opacity-50"
              >
                <Package className="w-3.5 h-3.5" />
                {isInBundle ? `Add Service to Bundle (${bundleMembers.length} now)` : 'Bundle with Another Service'}
                <span className="text-[10px] text-omega-stone font-normal">client approves each</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Already sent, not approved yet: editing is fine, the client just
          sees the new version on the same link once it's saved. */}
      {estimate?.status === 'sent' && !locked && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Already sent to the client.</strong> When you save, they see the updated version on the same link.
          </span>
        </div>
      )}

      {/* Lock overlay wrapper — dims everything below until format is
          chosen; read-only (no clicks) on an approved estimate. */}
      <div className={!displayMode ? 'opacity-40 pointer-events-none select-none' : locked ? 'opacity-75 pointer-events-none' : ''}>
      <div className="space-y-5">

      {/* Step (1): Estimate Details. Two-column layout — description
          textarea on the left, a small "Estimate status" card on the
          right that shows draft/sent/signed plus the estimate number. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start gap-3 mb-4 flex-wrap">
          <StepBadge n={1} />
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
            {!isInBundle && !isMultiOption && !locked && (
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

      {/* Step (2): Sections + line items. Wrapper card matches the
          redesign — header on top with the running Estimated Total
          to the right, then the section cards stacked, then the
          two-button row (Add Section / Generate). */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div className="inline-flex items-start gap-3">
            <StepBadge n={2} />
            <div>
              <h2 className="text-lg font-bold text-omega-charcoal">Estimate Sections &amp; Line Items</h2>
              <p className="text-xs text-omega-stone mt-0.5">
                {priceBySection
                  ? 'Organize the work into sections. Give each section one price — the items describe the scope.'
                  : 'Organize the work into sections. Add items, scope and pricing.'}
              </p>
            </div>
          </div>
          <div className="text-right self-start">
            <p className="text-[10px] font-bold text-omega-stone uppercase tracking-wider">Estimated Total</p>
            <p className="text-2xl font-black text-omega-charcoal tabular-nums leading-none mt-0.5">
              ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {sections.map((sec, sIdx) => (
                <SectionCard
                  key={sec.id}
                  section={sec}
                  sectionIndex={sIdx + 1}
                  priceBySection={priceBySection}
                  onTitle={(v) => updateSection(sIdx, { title: v })}
                  onPrice={(v) => updateSection(sIdx, { price: v })}
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
            </div>
          </SortableContext>
        </DndContext>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
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

      {/* Step (4): Project Disclaimers. Same content as before, now
          fronted with the (4) badge so it reads as the last item on
          the redesign's checklist. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <div className="inline-flex items-start gap-3">
            <StepBadge n={3} />
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

      {/* Payment schedule — STRUCTURED. This table is the source of truth
          saved to estimates.payment_plan, so the contract reads it directly
          (no more guessing from text). The customer message below is
          generated from these rows. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Payment Schedule</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {PLAN_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPlanPreset(p.rows)}
                className="px-2 py-1 rounded-md bg-omega-cloud border border-gray-200 text-[10px] font-bold text-omega-stone hover:border-omega-orange hover:text-omega-orange"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {paymentPlan.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.label}
                onChange={(e) => setPlanRow(i, 'label', e.target.value)}
                placeholder={`Installment ${i + 1}`}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-gray-200 focus:border-omega-orange outline-none text-sm"
              />
              <div className="relative w-24 flex-shrink-0">
                <input
                  value={r.percent}
                  onChange={(e) => setPlanRow(i, 'percent', e.target.value.replace(/[^0-9.]/g, ''))}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full pr-6 pl-2.5 py-2 rounded-lg border border-gray-200 focus:border-omega-orange outline-none text-sm text-right font-semibold"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-omega-stone text-sm">%</span>
              </div>
              <div className="w-24 flex-shrink-0 text-right text-xs text-omega-stone tabular-nums">
                {total ? `$${Math.round((Number(r.percent) || 0) / 100 * total).toLocaleString()}` : ''}
              </div>
              <button
                type="button"
                onClick={() => removePlanRow(i)}
                className="text-omega-stone hover:text-red-600 p-1 flex-shrink-0"
                title="Remove installment"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={addPlanRow}
            className="inline-flex items-center gap-1 text-xs font-semibold text-omega-orange hover:text-omega-dark"
          >
            <Plus className="w-3.5 h-3.5" /> Add installment
          </button>
          <span className={`text-xs font-bold ${Math.abs(planSumPct - 100) < 0.5 ? 'text-omega-success' : 'text-red-600'}`}>
            Total: {Math.round(planSumPct * 100) / 100}%{Math.abs(planSumPct - 100) < 0.5 ? ' ✓' : ' — must be 100%'}
          </span>
        </div>

        {/* Client-facing text — generated from the plan above, still editable. */}
        <div className="mt-4">
          <span className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">Customer Message (what the client sees)</span>
          <textarea
            rows={5}
            value={customerMessage}
            onChange={(e) => setCustomerMessage(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none font-mono"
          />
        </div>
      </div>

      {/* Customer-facing options — Acorn financing toggle.
          Default ON. Seller flips OFF when financing doesn't apply
          (commercial, cash client, sub-only scope). */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showFinancing}
            onChange={(e) => setShowFinancing(e.target.checked)}
            className="mt-1 w-4 h-4 accent-omega-orange cursor-pointer flex-shrink-0"
          />
          <div className="flex-1">
            <span className="text-sm font-bold text-omega-charcoal">
              Show financing option to customer
            </span>
            <p className="text-xs text-omega-stone mt-1 leading-relaxed">
              Adds a discreet "Need Flexible Payments?" card on the customer's
              estimate page, linking to Acorn Finance pre-qualification with
              the estimate total pre-filled. Recommended ON for most jobs —
              turn OFF for commercial work, cash clients, or sub-contracted scopes.
            </p>
          </div>
        </label>
      </div>

      </div>{/* end inner space-y-5 */}
      </div>{/* end lock overlay wrapper */}

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
            {estimate?.id && (
              <button
                onClick={() => setHistoryOpen(true)}
                disabled={saving || sending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-omega-charcoal hover:border-omega-orange text-xs font-bold disabled:opacity-50"
                title="Earlier saved versions of this estimate"
              >
                <History className="w-3.5 h-3.5" /> History
              </button>
            )}
            {estimate?.id && !locked && ['owner', 'operations', 'admin'].includes(user?.role) && (
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
              // Real <a target="_blank"> so it opens a proper NEW TAB on every
              // browser (incl. Safari iOS) and leaves the app's own tab intact —
              // returning from Print no longer breaks the SPA view.
              <a
                href={`/estimate-view/${estimate.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-bold text-omega-charcoal"
                title="Open the customer-facing version of this estimate in a new tab"
              >
                <Eye className="w-4 h-4" /> Preview Estimate
              </a>
            )}
            {!locked && (<>
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
                total <= 0 ? (priceBySection ? 'Add a price to at least one section before sending' : 'Add at least one priced item before sending')
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
            </>)}
          </div>
        </div>
      </div>
      </div>{/* end chooser dim wrapper */}

      {conflict && (
        <EstimateConflictModal
          conflict={conflict}
          busy={saving || sending}
          onUseTheirs={loadTheirVersion}
          onSaveMine={saveMineAnyway}
          onCancel={() => setConflict(null)}
        />
      )}
      {historyOpen && estimate?.id && (
        <EstimateHistoryModal
          estimateId={estimate.id}
          locked={locked}
          onRestore={restoreVersion}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

// Shown when a save finds a newer version saved by someone else.
function EstimateConflictModal({ conflict, busy, onUseTheirs, onSaveMine, onCancel }) {
  const by = conflict.by || 'Someone else';
  const at = conflict.row?.updated_at ? new Date(conflict.row.updated_at).toLocaleString() : null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-omega-orange flex-shrink-0" />
          <div>
            <p className="text-base font-bold text-omega-charcoal">{by} also edited this estimate</p>
            <p className="text-sm text-omega-stone mt-1">
              {by} saved it{at ? ` at ${at}` : ''}, after you opened it. Your changes were not saved yet, and nothing was overwritten.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onUseTheirs} disabled={busy}
            className="w-full px-4 py-3 rounded-xl border-2 border-omega-orange text-omega-orange hover:bg-omega-pale text-sm font-bold disabled:opacity-60"
          >
            Open {by === 'Someone else' ? 'their' : `${by}'s`} version (drop my changes)
          </button>
          <button
            onClick={onSaveMine} disabled={busy}
            className="w-full px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60"
          >
            Save mine over it (theirs stays in History)
          </button>
          <button onClick={onCancel} disabled={busy} className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-omega-stone hover:text-omega-charcoal">
            Cancel — keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

// Every saved version of the estimate (estimate_versions, migration 084).
function EstimateHistoryModal({ estimateId, locked, onRestore, onClose }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    supabase
      .from('estimate_versions').select('id, saved_at, saved_by, data')
      .eq('estimate_id', estimateId).order('saved_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setFailed(true);
        setRows(data || []);
      });
    return () => { alive = false; };
  }, [estimateId]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="text-base font-bold text-omega-charcoal inline-flex items-center gap-2">
            <History className="w-4 h-4 text-omega-orange" /> Version history
          </p>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">
          {rows === null && <p className="text-sm text-omega-stone text-center py-6">Loading…</p>}
          {rows !== null && failed && (
            <p className="text-sm text-omega-stone text-center py-6">History isn't available yet (migration 084 pending).</p>
          )}
          {rows !== null && !failed && rows.length === 0 && (
            <p className="text-sm text-omega-stone text-center py-6">No saved versions yet — they start with the next save.</p>
          )}
          {(rows || []).map((v, i) => (
            <div key={v.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-omega-charcoal">
                  {new Date(v.saved_at).toLocaleString()}
                  {i === 0 && <span className="ml-2 text-[10px] font-bold uppercase text-emerald-700">Latest</span>}
                </p>
                <p className="text-xs text-omega-stone">
                  {v.saved_by || 'Before history started'} · {money(v.data?.total_amount)}
                </p>
              </div>
              {!locked && i > 0 && (
                <button
                  onClick={() => onRestore(v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-xs font-bold text-omega-charcoal"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore
                </button>
              )}
            </div>
          ))}
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

function SectionCard({ section, sectionIndex = 1, priceBySection, onTitle, onPrice, onMoveUp, onMoveDown, onRemove, onUpdateItem, onAddItem, onRemoveItem, disableUp, disableDown }) {
  // Whole-section sortable: the section card itself reorders within
  // the parent SortableContext when its grip is dragged.
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: section.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the row visually while it's being dragged so the user sees
    // a clean "picked up" state instead of fighting with sibling cards.
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden"
    >
      <div className="px-3 py-2.5 bg-omega-pale/40 border-b border-omega-orange/20 flex items-center gap-2 flex-wrap sm:flex-nowrap">
        {/* Section grip — the only spot wired to dnd-kit's listeners.
            Inputs and other buttons are NOT activators so typing in
            the title doesn't accidentally start a drag. */}
        <button
          ref={setActivatorNodeRef}
          {...listeners}
          type="button"
          className="text-omega-fog hover:text-omega-stone cursor-grab active:cursor-grabbing touch-none"
          title="Drag to reorder section"
          aria-label="Drag section"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <input
          value={section.title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="Section title"
          className="flex-1 min-w-0 bg-transparent text-sm font-bold text-omega-charcoal focus:outline-none"
        />
        {/* "Price by Section" — the one price the client sees for this
            section. Items below are listed without prices. On a phone it
            drops to its own line so the title stays readable. */}
        {priceBySection && (
          <div className="relative w-full order-last sm:order-none sm:w-40 flex-shrink-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-omega-stone font-bold text-sm">$</span>
            <input
              type="number"
              inputMode="decimal"
              value={Number(section.price) ? section.price : ''}
              onChange={(e) => onPrice(Number(e.target.value) || 0)}
              placeholder="Section price"
              aria-label="Section price"
              className="w-full pl-6 pr-2.5 py-1.5 rounded-lg border border-omega-orange/40 bg-white text-sm tabular-nums text-right font-semibold focus:border-omega-orange focus:outline-none"
            />
          </div>
        )}
        <button onClick={onMoveUp} disabled={disableUp}   className="p-1 rounded text-omega-stone hover:text-omega-charcoal disabled:opacity-30" title="Move up"><ChevronUp className="w-4 h-4" /></button>
        <button onClick={onMoveDown} disabled={disableDown} className="p-1 rounded text-omega-stone hover:text-omega-charcoal disabled:opacity-30" title="Move down"><ChevronDown className="w-4 h-4" /></button>
        <button onClick={onRemove} className="p-1 rounded text-red-500 hover:bg-red-50" title="Remove section"><Trash2 className="w-4 h-4" /></button>
      </div>

      {/* Items get their own SortableContext keyed by `i:<itemId>` so
          they share the same DndContext as the sections (which lets a
          row be dropped into a different section). */}
      <SortableContext
        items={section.items.map((it) => `i:${it.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y divide-gray-100">
          {section.items.map((it, iIdx) => (
            <ItemRow
              key={it.id}
              item={it}
              // "1.1", "1.2", "2.1" — matches the redesign mockup so the
              // seller can refer to a specific line by section + position.
              label={`${sectionIndex}.${iIdx + 1}`}
              showPrice={!priceBySection}
              onChange={(patch) => onUpdateItem(iIdx, patch)}
              onRemove={() => onRemoveItem(iIdx)}
            />
          ))}
        </div>
      </SortableContext>

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

function ItemRow({ item, label, showPrice = true, onChange, onRemove }) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: `i:${item.id}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 25 : undefined,
    opacity: isDragging ? 0.85 : 1,
    background: isDragging ? '#fff' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`px-4 py-3 grid grid-cols-1 gap-3 items-start ${
        showPrice
          ? 'md:grid-cols-[20px_44px_1fr_1.5fr_140px_auto]'
          : 'md:grid-cols-[20px_44px_1fr_1.5fr_auto]'
      }`}
    >
      {/* Drag grip — left of the section.position label. Same pattern
          as the section header: only this button activates dnd. */}
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        type="button"
        className="md:mt-7 self-start text-omega-fog hover:text-omega-stone cursor-grab active:cursor-grabbing touch-none"
        title="Drag to reorder item"
        aria-label="Drag item"
      >
        <GripVertical className="w-4 h-4" />
      </button>
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
      {/* Hidden in "Price by Section" mode — the price lives on the
          section header there. */}
      {showPrice && (
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
      )}
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
