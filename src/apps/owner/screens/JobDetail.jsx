import { useState, useEffect } from 'react';
import {
  ArrowLeft, ChevronDown, TrendingUp, ShoppingCart, Layers, RefreshCw,
  Info, CheckCircle, AlertTriangle, FileText, Clock, Users, Wrench,
  DollarSign, Package, Printer, Phone, Mail, MapPin, Calendar,
  Hammer, Zap, Droplets, Home, HardHat, Paintbrush, Shield,
  ChevronRight, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generatePricingReference, generateReport } from '../lib/anthropic';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';
import PhaseBreakdown from '../../../shared/components/PhaseBreakdown';

// ─────────────────────────────────────────────────────────────────────────────
// Report section styles
// ─────────────────────────────────────────────────────────────────────────────
const REPORT_STYLES = {
  info:     { bg: 'bg-blue-50',   border: 'border-blue-200',   header: 'bg-blue-100',   icon: Info,          text: 'text-blue-800' },
  success:  { bg: 'bg-green-50',  border: 'border-green-200',  header: 'bg-green-100',  icon: CheckCircle,   text: 'text-green-800' },
  warning:  { bg: 'bg-amber-50',  border: 'border-amber-200',  header: 'bg-amber-100',  icon: AlertTriangle, text: 'text-amber-800' },
  danger:   { bg: 'bg-red-50',    border: 'border-red-200',    header: 'bg-red-100',    icon: AlertTriangle, text: 'text-red-800' },
  charcoal: { bg: 'bg-gray-50',   border: 'border-gray-200',   header: 'bg-gray-100',   icon: FileText,      text: 'text-gray-800' },
  slate:    { bg: 'bg-slate-50',  border: 'border-slate-200',  header: 'bg-slate-100',  icon: FileText,      text: 'text-slate-800' },
};

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') ? <strong key={i} className="font-semibold text-omega-charcoal">{p.replace(/\*\*/g, '')}</strong> : p
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// #14 Phase icon map
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_ICONS = {
  demo: Hammer, demolition: Hammer,
  framing: HardHat, frame: HardHat,
  electrical: Zap, electric: Zap,
  plumbing: Droplets, plumb: Droplets,
  waterproof: Shield, foundation: Shield,
  insulation: Home, drywall: Home,
  flooring: Home, floor: Home,
  tile: Paintbrush, finish: Paintbrush,
  paint: Paintbrush, fixture: Wrench,
  cabinet: Wrench, roof: Home,
  site: HardHat, cleanup: Package,
  total: DollarSign, smart: Wrench,
};

function getPhaseIcon(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, Icon] of Object.entries(PHASE_ICONS)) {
    if (lower.includes(key)) return Icon;
  }
  return Wrench;
}

// ─────────────────────────────────────────────────────────────────────────────
// #20 Warehouse stock check
// ─────────────────────────────────────────────────────────────────────────────
function checkStock(productName, warehouseItems) {
  if (!warehouseItems.length) return null;
  const words = productName.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let best = null;
  let bestScore = 0;
  for (const item of warehouseItems) {
    const itemName = (item.name || '').toLowerCase();
    const score = words.filter((w) => itemName.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  if (bestScore >= 2) return { item: best, type: 'exact' };
  if (bestScore >= 1) return { item: best, type: 'similar' };
  return null;
}

function StockBadge({ match }) {
  if (!match) return <span className="text-[10px] text-omega-fog">—</span>;
  const { item, type } = match;
  if (item.quantity <= 0)
    return <span className="text-[10px] text-red-500 font-medium">Out of stock</span>;
  if (type === 'exact')
    return <span className="text-[10px] text-green-600 font-semibold">✓ {item.quantity} {item.unit}</span>;
  return <span className="text-[10px] text-amber-600 font-medium">~ {item.quantity} {item.unit}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// #20 Pull from Warehouse modal
// ─────────────────────────────────────────────────────────────────────────────
function PullModal({ product, warehouseItem, jobId, onClose, onPulled }) {
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handlePull = async () => {
    if (qty <= 0 || qty > warehouseItem.quantity) return;
    setSaving(true);
    setError(null);
    try {
      const { error: txErr } = await supabase.from('warehouse_transactions').insert([{
        item_id: warehouseItem.id,
        transaction_type: 'remove',
        quantity: qty,
        job_id: jobId || null,
        note: `Pulled for: ${product}`,
      }]);
      if (txErr) throw txErr;
      const { error: updErr } = await supabase.from('warehouse_items').update({
        quantity: Math.max(0, warehouseItem.quantity - qty),
      }).eq('id', warehouseItem.id);
      if (updErr) throw updErr;
      onPulled(warehouseItem.id, qty);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to pull items');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-omega-charcoal">Pull from Warehouse</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-omega-stone hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-omega-stone mb-1">Item: <strong className="text-omega-charcoal">{warehouseItem.name}</strong></p>
        <p className="text-xs text-omega-stone mb-1">For: {product}</p>
        <p className="text-xs text-omega-stone mb-4">Available: <strong className="text-green-600">{warehouseItem.quantity} {warehouseItem.unit}</strong></p>
        <label className="text-xs font-semibold text-omega-stone uppercase tracking-wider mb-1 block">Quantity to pull</label>
        <input
          type="number"
          min={1}
          max={warehouseItem.quantity}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(warehouseItem.quantity, Number(e.target.value))))}
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-omega-charcoal text-sm focus:outline-none focus:border-omega-orange mb-4"
        />
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={handlePull} disabled={saving || qty <= 0}
            className="flex-1 py-3 rounded-xl bg-omega-orange text-white font-semibold text-sm hover:bg-omega-dark disabled:opacity-50">
            {saving ? <LoadingSpinner size={14} color="text-white" /> : `Pull ${qty} ${warehouseItem.unit}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// #14 Pricing — JSON-based renderers
// ─────────────────────────────────────────────────────────────────────────────
function PricingPhaseCard({ phase }) {
  const Icon = getPhaseIcon(phase.name);
  const isTotal = /total/i.test(phase.name);
  const range = phase.max - phase.min;
  const midPct = range > 0 ? Math.round(((phase.mid - phase.min) / range) * 100) : 50;
  const fmt = (n) => `$${Number(n).toLocaleString('en-US')}`;

  if (isTotal) {
    return (
      <div className="bg-omega-charcoal rounded-2xl p-5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-omega-orange flex items-center justify-center flex-shrink-0">
            <DollarSign className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold text-omega-fog uppercase tracking-wider">Total Project Labor</p>
            <p className="text-xs text-omega-stone mt-0.5">{fmt(phase.min)} – {fmt(phase.max)}</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-omega-orange">{fmt(phase.mid)}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4 text-omega-charcoal" />
          </div>
          <div>
            <p className="text-sm font-semibold text-omega-charcoal leading-tight">{phase.name}</p>
            {phase.description && <p className="text-xs text-omega-stone mt-0.5 leading-snug">{phase.description}</p>}
          </div>
        </div>
        <div className="text-right flex-shrink-0 ml-3">
          <p className="text-[10px] font-medium text-omega-stone uppercase tracking-wider">MID ESTIMATE</p>
          <p className="text-xl font-bold text-omega-orange leading-none mt-0.5">{fmt(phase.mid)}</p>
        </div>
      </div>
      <div className="relative mt-3">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
          <div className="absolute top-0 h-full bg-omega-orange/20 rounded-full" style={{ width: '100%' }} />
          <div className="absolute top-0 h-full w-2 bg-omega-orange rounded-full" style={{ left: `calc(${midPct}% - 4px)` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-omega-stone">{fmt(phase.min)}</span>
          <span className="text-[10px] text-omega-stone">{fmt(phase.max)}</span>
        </div>
      </div>
    </div>
  );
}

function PricingMaterialsGrid({ materials, grand_total_materials, warehouseItems, jobId, onWarehouseUpdated }) {
  const [pullModal, setPullModal] = useState(null); // { product, warehouseItem }
  const fmt = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtInt = (n) => `$${Number(n).toLocaleString('en-US')}`;

  const hasWarehouse = warehouseItems.length > 0;

  return (
    <div className="space-y-5">
      {pullModal && (
        <PullModal
          product={pullModal.product}
          warehouseItem={pullModal.warehouseItem}
          jobId={jobId}
          onClose={() => setPullModal(null)}
          onPulled={onWarehouseUpdated}
        />
      )}

      {(materials || []).map((cat, ci) => (
        <div key={ci}>
          <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-gray-200">
            <p className="text-xs font-bold text-omega-charcoal uppercase tracking-wider">{cat.category}</p>
            {cat.subtotal > 0 && <p className="text-xs font-bold text-omega-orange">{fmtInt(cat.subtotal)}</p>}
          </div>
          {/* Table header */}
          <div className={`grid gap-1 px-2 pb-1 text-[10px] font-semibold text-omega-stone uppercase tracking-wider ${hasWarehouse ? 'grid-cols-12' : 'grid-cols-10'}`}>
            <span className="col-span-4">Product</span>
            <span className="col-span-1 text-center">Qty</span>
            <span className="col-span-1 text-center">Unit</span>
            <span className="col-span-2 text-right">Unit $</span>
            <span className="col-span-2 text-right">Total</span>
            {hasWarehouse && <span className="col-span-2 text-center">Stock</span>}
          </div>
          {(cat.items || []).map((item, ii) => {
            const stockMatch = hasWarehouse ? checkStock(item.product, warehouseItems) : null;
            const canPull = stockMatch && stockMatch.item.quantity > 0;
            return (
              <div key={ii} className={`grid gap-1 px-2 py-2 rounded text-xs items-center ${ii % 2 === 0 ? 'bg-gray-50' : 'bg-white'} ${hasWarehouse ? 'grid-cols-12' : 'grid-cols-10'}`}>
                <span className="col-span-4 text-omega-charcoal font-medium leading-tight">{item.product}</span>
                <span className="col-span-1 text-omega-stone text-center">{item.qty}</span>
                <span className="col-span-1 text-omega-stone text-center text-[10px]">{item.unit}</span>
                <span className="col-span-2 text-omega-stone text-right">{fmt(item.unit_price)}</span>
                <span className="col-span-2 text-right font-semibold text-omega-orange">{fmtInt(item.total)}</span>
                {hasWarehouse && (
                  <div className="col-span-2 flex flex-col items-center gap-0.5">
                    <StockBadge match={stockMatch} />
                    {canPull && (
                      <button
                        onClick={() => setPullModal({ product: item.product, warehouseItem: stockMatch.item })}
                        className="text-[9px] text-omega-orange font-semibold hover:underline leading-none"
                      >
                        Pull
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {grand_total_materials > 0 && (
        <div className="mt-4 p-4 rounded-2xl bg-omega-orange flex items-center justify-between shadow-md">
          <div>
            <p className="text-white font-bold text-sm">Total Materials</p>
            <p className="text-white/70 text-xs mt-0.5">Home Depot estimate · CT 2025 pricing</p>
          </div>
          <p className="text-white font-bold text-2xl">{fmtInt(grand_total_materials)}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic report section content
// ─────────────────────────────────────────────────────────────────────────────
function GenericContent({ content }) {
  const lines = content.split('\n').filter((l) => l.trim());
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith('## '))
          return <p key={i} className="font-bold text-omega-charcoal mt-4 mb-2 text-sm border-b border-gray-200 pb-1">{line.replace('## ', '')}</p>;
        if (/^\*\*[^*]+\*\*$/.test(line.trim()))
          return <p key={i} className="font-bold text-omega-charcoal mt-3 mb-1 text-sm">{line.replace(/\*\*/g, '')}</p>;
        if (line.startsWith('- ') || line.startsWith('• '))
          return (
            <div key={i} className="flex gap-2 text-sm text-omega-slate">
              <span className="text-omega-orange mt-1 flex-shrink-0">•</span>
              <span className="leading-relaxed">{renderInline(line.replace(/^[-•]\s/, ''))}</span>
            </div>
          );
        if (/^\d+[.)]\s/.test(line))
          return <p key={i} className="text-sm text-omega-slate ml-3 leading-relaxed">{renderInline(line)}</p>;
        return <p key={i} className="text-sm text-omega-slate leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Report card (collapsible)
// ─────────────────────────────────────────────────────────────────────────────
function ReportCard({ section, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const style = REPORT_STYLES[section.color] || REPORT_STYLES.charcoal;
  const Icon = style.icon;
  return (
    <div className={`rounded-xl border ${style.border} overflow-hidden`}>
      <button type="button" onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-5 py-3.5 ${style.header}`}>
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${style.text}`} />
          <span className={`font-semibold text-sm ${style.text}`}>{section.title}</span>
        </div>
        <ChevronDown className={`w-5 h-5 ${style.text} opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`px-5 py-4 ${style.bg} ${open ? '' : 'hidden'}`}>
        <GenericContent content={section.content} />
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="px-5 py-3.5 bg-gray-100"><div className="h-4 bg-gray-300 rounded w-1/3" /></div>
      <div className="px-5 py-4 space-y-2">
        {[...Array(4)].map((_, i) => <div key={i} className="h-3 bg-gray-200 rounded" style={{ width: `${70 + i * 7}%` }} />)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm dialog
// ─────────────────────────────────────────────────────────────────────────────
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-center font-bold text-omega-charcoal mb-2">{title}</p>
        <p className="text-center text-sm text-omega-stone mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-omega-orange text-white font-semibold text-sm hover:bg-omega-dark">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_BADGES = {
  to_quote:    { label: 'To Quote',    cls: 'bg-blue-100 text-blue-800' },
  negotiating: { label: 'Negotiating', cls: 'bg-amber-100 text-amber-800' },
  in_progress: { label: 'In Progress', cls: 'bg-green-100 text-green-700' },
  completed:   { label: 'Completed',   cls: 'bg-gray-100 text-gray-600' },
  draft:       { label: 'Draft',       cls: 'bg-gray-100 text-gray-500' },
};

function getInitials(name = '') {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function parseReportSections(raw) {
  const sectionMeta = {
    OVERVIEW:         { title: 'Overview',               color: 'info' },
    SCOPE:            { title: 'Scope of Work',          color: 'charcoal' },
    SELECTIONS:       { title: 'Selections',             color: 'success' },
    MISSING_INFO:     { title: 'Missing Information',    color: 'warning' },
    RED_FLAGS:        { title: 'Red Flags',              color: 'danger' },
    CT_CODE:          { title: 'CT Building Code',       color: 'info' },
    PERMITS:          { title: 'Permits',                color: 'warning' },
    TRADES:           { title: 'Trades Required',        color: 'charcoal' },
    UPSELLS:          { title: 'Upsell Opportunities',   color: 'success' },
    ESTIMATING_NOTES: { title: 'Estimating Notes',       color: 'slate' },
    PHASE_BREAKDOWN:  { title: 'Phase Breakdown',        color: 'charcoal' },
  };
  const parts = raw.split('###SECTION###');
  return parts.slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const key = part.substring(0, nl).trim();
    const content = part.substring(nl + 1).trim();
    const meta = sectionMeta[key] || { title: key, color: 'charcoal' };
    return { key, ...meta, content };
  }).filter((s) => s.content);
}

function parsePricingData(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function formatTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function JobDetail({ job: initialJob, onNavigate, onAssignSubs, onJobUpdated }) {
  const [job, setJob] = useState(initialJob);
  const [activeTab, setActiveTab] = useState('report');

  // Report state
  const [reportSections, setReportSections] = useState(() => initialJob.report_raw ? parseReportSections(initialJob.report_raw) : []);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportTs, setReportTs] = useState(initialJob.answers?._report_ts || null);
  const [showConfirmRegen, setShowConfirmRegen] = useState(false);

  // Pricing state — initialize directly from Supabase data, no flash
  const [pricingData, setPricingData] = useState(() => {
    if (initialJob.pricing_reference) {
      return typeof initialJob.pricing_reference === 'object'
        ? initialJob.pricing_reference
        : null;
    }
    // legacy fallback from answers._pricing_raw
    if (initialJob.answers?._pricing_raw) {
      try {
        const m = initialJob.answers._pricing_raw.match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : null;
      } catch { return null; }
    }
    return null;
  });
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState(null);
  const [pricingTimestamp, setPricingTimestamp] = useState(initialJob.answers?._pricing_ts || null);
  const [showConfirmRegenPricing, setShowConfirmRegenPricing] = useState(false);

  // Phases state (read-only — set by manager)
  const [phases, setPhases] = useState([]);

  // Shared retry message shown inside any loading state
  const [retryMsg, setRetryMsg] = useState(null);

  // Warehouse state (#20)
  const [warehouseItems, setWarehouseItems] = useState([]);

  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadPhases();
    loadWarehouseItems();
  }, []);

  async function loadWarehouseItems() {
    try {
      const { data } = await supabase.from('warehouse_items').select('*').gt('quantity', 0);
      setWarehouseItems(data || []);
    } catch {
      // non-critical
    }
  }

  async function loadPhases() {
    const { data } = await supabase.from('job_phases').select('*').eq('job_id', job.id).order('phase_index');
    setPhases(data || []);
  }

// ── Report generation ───────────────────────────────────────────────────────
  async function fetchReport() {
    setReportLoading(true);
    setReportError(null);
    setReportSections([]);
    setRetryMsg(null);
    try {
      const raw = await generateReport(job, job.answers || {}, setRetryMsg);
      const ts = Date.now();
      const sections = parseReportSections(raw);
      setReportSections(sections);
      setReportTs(ts);
      const mergedAnswers = { ...(job.answers || {}), _report_ts: ts };
      const { error } = await supabase.from('jobs').update({
        report_raw: raw, report: raw, status: 'to_quote', answers: mergedAnswers,
      }).eq('id', job.id);
      if (!error) {
        const updatedJob = { ...job, report_raw: raw, report: raw, status: 'to_quote', answers: mergedAnswers };
        setJob(updatedJob);
        onJobUpdated?.(updatedJob);
        setToast({ type: 'success', message: 'Report generated and saved!' });
      }
    } catch (err) {
      setReportError(err.message || 'Failed to generate report');
    } finally {
      setReportLoading(false);
      setRetryMsg(null);
    }
  }

  // ── Pricing generation ──────────────────────────────────────────────────────
  async function fetchPricing() {
    setPricingLoading(true);
    setPricingError(null);
    setRetryMsg(null);
    try {
      const data = await generatePricingReference(job, setRetryMsg);
      const ts = Date.now();
      setPricingData(data);
      setPricingTimestamp(ts);
      // Save to jobs.pricing_reference column
      const mergedAnswers = { ...(job.answers || {}), _pricing_ts: ts };
      await supabase.from('jobs').update({
        pricing_reference: data,
        answers: mergedAnswers,
      }).eq('id', job.id);
      const updatedJob = { ...job, pricing_reference: data, answers: mergedAnswers };
      setJob(updatedJob);
      onJobUpdated?.(updatedJob);
      setToast({ type: 'success', message: 'Pricing saved!' });
    } catch (err) {
      setPricingError(err.message || 'Failed to generate pricing');
    } finally {
      setPricingLoading(false);
      setRetryMsg(null);
    }
  }

  function handleWarehouseUpdated(itemId, pulledQty) {
    setWarehouseItems((prev) =>
      prev.map((item) => item.id === itemId ? { ...item, quantity: Math.max(0, item.quantity - pulledQty) } : item)
    );
    setToast({ type: 'success', message: `Pulled ${pulledQty} from warehouse!` });
  }

  const TABS = [
    { id: 'report',  label: 'Report' },
    { id: 'pricing', label: 'Pricing Ref.' },
    { id: 'phases',  label: 'Phases' },
    { id: 'client',  label: 'Client Info' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {showConfirmRegen && (
        <ConfirmDialog
          title="Regenerate Report?"
          message="This will replace the current report. The previous version is kept in backup."
          confirmLabel="Regenerate"
          onConfirm={() => { setShowConfirmRegen(false); fetchReport(); }}
          onCancel={() => setShowConfirmRegen(false)}
        />
      )}
      {showConfirmRegenPricing && (
        <ConfirmDialog
          title="Regenerate Pricing Reference?"
          message="This will replace the current pricing reference with a fresh estimate."
          confirmLabel="Regenerate"
          onConfirm={() => { setShowConfirmRegenPricing(false); fetchPricing(); }}
          onCancel={() => setShowConfirmRegenPricing(false)}
        />
      )}
      {/* Top bar */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4 flex-shrink-0">
        <button onClick={() => onNavigate('dashboard')} className="p-2 rounded-xl border border-gray-200 text-omega-stone hover:text-omega-charcoal hover:border-gray-300 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-omega-charcoal">{job.client_name}</h1>
          <p className="text-xs text-omega-stone">{job.service} · {job.address}</p>
        </div>
        <button onClick={() => onAssignSubs(job)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
          <Users className="w-4 h-4" />Assign Subs
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white px-6 flex-shrink-0">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-omega-orange text-omega-orange' : 'border-transparent text-omega-stone hover:text-omega-charcoal'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── REPORT TAB ──────────────────────────────────────────────────────── */}
        {activeTab === 'report' && (
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <div>
                {reportTs && <p className="text-xs text-omega-stone">Generated on {formatTs(reportTs)}</p>}
              </div>
              <div className="flex items-center gap-3">
                {reportSections.length > 0 && (
                  <button onClick={() => window.print()} className="no-print flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-omega-charcoal hover:bg-gray-200 text-xs font-medium border border-gray-200">
                    <Printer className="w-3.5 h-3.5" />Print
                  </button>
                )}
                {reportSections.length > 0 && !reportLoading && (
                  <button onClick={() => setShowConfirmRegen(true)} disabled={reportLoading}
                    className="flex items-center gap-1 text-xs text-omega-stone hover:text-omega-orange transition-colors disabled:opacity-40">
                    <RefreshCw className="w-3 h-3" />↺ Regenerate
                  </button>
                )}
                {reportSections.length === 0 && !reportLoading && (
                  <button onClick={fetchReport}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
                    <FileText className="w-4 h-4" />Generate Report
                  </button>
                )}
              </div>
            </div>

            {!reportLoading && !reportError && reportSections.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <FileText className="w-14 h-14 text-omega-fog mx-auto mb-4" />
                <p className="font-bold text-omega-charcoal text-lg mb-2">No report yet</p>
                <p className="text-sm text-omega-stone mb-6 max-w-xs mx-auto">Generate a full project report — includes scope, red flags, CT code requirements, trades, and phase breakdown.</p>
                <button onClick={fetchReport} disabled={reportLoading}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-omega-orange text-white font-bold text-base hover:bg-omega-dark disabled:opacity-60 transition-colors mx-auto shadow-lg shadow-omega-orange/25">
                  <FileText className="w-5 h-5" />Generate Report
                </button>
              </div>
            )}

            {reportLoading && (
              <div className="space-y-3">
                <div className={`flex items-center gap-3 p-4 rounded-xl border ${retryMsg ? 'bg-amber-50 border-amber-200' : 'bg-omega-pale border-omega-orange/20'}`}>
                  <LoadingSpinner />
                  <div>
                    <p className={`text-sm font-semibold ${retryMsg ? 'text-amber-800' : 'text-omega-charcoal'}`}>
                      {retryMsg || 'Generating report with Omega AI...'}
                    </p>
                    {!retryMsg && <p className="text-xs text-omega-stone mt-0.5">Takes about 20–30 seconds</p>}
                  </div>
                </div>
                {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}

            {reportError && (
              <div className="p-5 rounded-xl bg-red-50 border border-red-200 text-center">
                <AlertTriangle className="w-8 h-8 text-omega-danger mx-auto mb-2" />
                <p className="font-semibold text-omega-danger mb-1">Report generation failed</p>
                <p className="text-sm text-red-600 mb-4">{reportError}</p>
                <button onClick={fetchReport} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-danger text-white text-sm font-semibold mx-auto">
                  <RefreshCw className="w-4 h-4" />Try Again
                </button>
              </div>
            )}

            {reportSections.length > 0 && (
              <>
                <div className="hidden print-show px-2 py-4 border-b border-gray-200 mb-4">
                  <p className="font-bold text-lg text-gray-900">Omega Development LLC — Project Report</p>
                  <p className="text-sm text-gray-600">{job.client_name} · {job.service} · {job.address}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                </div>
                {reportSections.map((s) => (
                  <ReportCard key={s.key} section={s} defaultOpen={s.key === 'OVERVIEW'} />
                ))}
                <div className="no-print flex justify-end mt-2 pb-6">
                  <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-gray-200 shadow-lg text-omega-charcoal font-semibold text-sm hover:border-omega-orange hover:text-omega-orange transition-all">
                    <Printer className="w-4 h-4" />Print Report
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PRICING TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'pricing' && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-omega-charcoal">Pricing Reference</h2>
                {pricingTimestamp && (
                  <p className="text-xs text-omega-stone mt-0.5">Generated on {formatTs(pricingTimestamp)}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {pricingData && !pricingLoading && (
                  <button onClick={() => setShowConfirmRegenPricing(true)}
                    className="flex items-center gap-1 text-xs text-omega-stone hover:text-omega-orange transition-colors">
                    <RefreshCw className="w-3 h-3" />↺ Regenerate
                  </button>
                )}
                {!pricingData && !pricingLoading && (
                  <button onClick={fetchPricing}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
                    <DollarSign className="w-4 h-4" />Generate Pricing
                  </button>
                )}
              </div>
            </div>

            {pricingLoading && (
              <div className="space-y-3">
                <div className={`flex items-center gap-3 p-4 rounded-xl border mb-4 ${retryMsg ? 'bg-amber-50 border-amber-200' : 'bg-omega-pale border-omega-orange/20'}`}>
                  <LoadingSpinner />
                  <p className={`text-sm font-semibold ${retryMsg ? 'text-amber-800' : 'text-omega-charcoal'}`}>
                    {retryMsg || 'Generating pricing with Omega AI... (~20 seconds)'}
                  </p>
                </div>
                {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}

            {pricingError && (
              <div className="p-5 rounded-xl bg-red-50 border border-red-200 text-center">
                <AlertTriangle className="w-8 h-8 text-omega-danger mx-auto mb-2" />
                <p className="font-semibold text-omega-danger mb-1">Failed to generate</p>
                <p className="text-sm text-red-600">{pricingError}</p>
              </div>
            )}

            {!pricingLoading && !pricingError && !pricingData && (
              <div className="text-center py-16">
                <DollarSign className="w-12 h-12 text-omega-fog mx-auto mb-3" />
                <p className="font-semibold text-omega-charcoal">No pricing reference yet</p>
                <p className="text-sm text-omega-stone mt-1">Click Generate for CT market pricing + HD materials estimate</p>
              </div>
            )}

            {!pricingLoading && pricingData && (
              <div className="space-y-6">
                {/* CT Market Phase Cards */}
                {pricingData.phases?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="w-4 h-4 text-omega-charcoal" />
                      <h3 className="font-bold text-omega-charcoal text-sm">CT Market Labor Ranges</h3>
                      <span className="text-xs text-omega-stone">(Fairfield County 2025 · Omega -25%)</span>
                    </div>
                    <div className="space-y-3">
                      {pricingData.phases.map((phase, i) => (
                        <PricingPhaseCard key={i} phase={phase} />
                      ))}
                      {/* Grand total labor card */}
                      {pricingData.grand_total_labor_mid > 0 && (
                        <PricingPhaseCard phase={{
                          name: 'Total Project Labor',
                          description: '',
                          mid: pricingData.grand_total_labor_mid,
                          min: pricingData.grand_total_labor_min,
                          max: pricingData.grand_total_labor_max,
                        }} />
                      )}
                    </div>
                  </div>
                )}

                {/* Materials Grid */}
                {pricingData.materials?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <ShoppingCart className="w-4 h-4 text-omega-charcoal" />
                      <h3 className="font-bold text-omega-charcoal text-sm">Home Depot Materials Estimate</h3>
                      <span className="text-xs text-omega-stone">(CT 2025)</span>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <PricingMaterialsGrid
                        materials={pricingData.materials}
                        grand_total_materials={pricingData.grand_total_materials}
                        warehouseItems={warehouseItems}
                        jobId={job.id}
                        onWarehouseUpdated={handleWarehouseUpdated}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── PHASES TAB ──────────────────────────────────────────────────────── */}
        {activeTab === 'phases' && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-4">
              <h2 className="font-bold text-omega-charcoal">Phase Breakdown</h2>
              <p className="text-xs text-omega-stone">Tick sub-items as work progresses — synced with Pipeline & Dashboard</p>
            </div>
            <PhaseBreakdown
              job={job}
              onJobUpdated={(updated) => {
                setJob(updated);
                onJobUpdated?.(updated);
              }}
            />
          </div>
        )}

        {/* ── CLIENT INFO TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'client' && (
          <div className="max-w-xl mx-auto space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <div className="flex flex-col items-center mb-5">
                <div className="w-20 h-20 rounded-full bg-omega-orange flex items-center justify-center mb-4 shadow-lg shadow-omega-orange/25">
                  <span className="text-2xl font-bold text-white">{getInitials(job.client_name)}</span>
                </div>
                <h2 className="text-xl font-bold text-omega-charcoal">{job.client_name}</h2>
                {job.address && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <MapPin className="w-3.5 h-3.5 text-omega-stone flex-shrink-0" />
                    <p className="text-sm text-omega-stone text-center">{job.address}</p>
                  </div>
                )}
                {job.created_at && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Calendar className="w-3.5 h-3.5 text-omega-fog" />
                    <p className="text-xs text-omega-fog">Created {new Date(job.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                )}
              </div>
              <div className="space-y-3 border-t border-gray-100 pt-5">
                {job.client_phone ? (
                  <a href={`tel:${job.client_phone}`} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                    <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold">Phone</p>
                      <p className="text-sm font-semibold text-omega-charcoal group-hover:text-omega-orange transition-colors">{job.client_phone}</p>
                    </div>
                  </a>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-xl">
                    <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-4 h-4 text-omega-fog" />
                    </div>
                    <div>
                      <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold">Phone</p>
                      <p className="text-sm text-omega-fog italic">Not provided</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-omega-stone uppercase tracking-widest mb-4">Job Details</p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Wrench className="w-4 h-4 text-omega-stone mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold mb-1">Service</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(job.service || '').split(',').map((s, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-full bg-omega-pale text-omega-orange text-xs font-semibold capitalize">{s.trim()}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-omega-stone flex-shrink-0" />
                  <div>
                    <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold mb-1">Status</p>
                    {(() => {
                      const badge = STATUS_BADGES[job.status] || { label: job.status, cls: 'bg-gray-100 text-gray-600' };
                      return <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${badge.cls}`}>{badge.label}</span>;
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-omega-stone flex-shrink-0" />
                  <div>
                    <p className="text-xs text-omega-stone uppercase tracking-wider font-semibold mb-1">Salesperson</p>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-omega-charcoal flex items-center justify-center">
                        <span className="text-xs font-bold text-white">{getInitials(job.salesperson_name || '')}</span>
                      </div>
                      <p className="text-sm font-semibold text-omega-charcoal">{job.salesperson_name || '—'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {job.answers?.salesperson_notes && (
              <div className="p-5 rounded-2xl bg-omega-charcoal">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-omega-orange" />
                  <p className="text-xs font-bold tracking-wider text-omega-fog uppercase">Field Notes (Private)</p>
                </div>
                <p className="text-sm text-omega-fog whitespace-pre-wrap leading-relaxed">{job.answers.salesperson_notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
