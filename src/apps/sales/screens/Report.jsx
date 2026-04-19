import { useState, useEffect } from 'react';
import {
  ArrowLeft, Save, ChevronDown, FileText, AlertTriangle, CheckCircle,
  Info, RefreshCw, Printer, MessageCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generateReport, parseReport } from '../lib/anthropic';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

// ── Phase lists by service ID ────────────────────────────────────────────────
const SERVICE_PHASES = {
  bath:     ['Site prep & protection', 'Demolition', 'Framing', 'Plumbing (pre-work)', 'Electrical (pre-work)', 'Waterproofing', 'Tile work', 'Fixtures & finish', 'Painting & touch-up'],
  kitchen:  ['Site prep & protection', 'Demolition', 'Framing', 'Plumbing (pre-work)', 'Electrical (pre-work)', 'Drywall', 'Cabinet installation', 'Countertop & backsplash', 'Appliances & fixtures', 'Painting'],
  addition: ['Site prep', 'Foundation', 'Framing', 'Rough plumbing', 'Rough electrical', 'Roofing', 'Insulation', 'Drywall', 'Flooring', 'Fixtures', 'Painting'],
  deck:     ['Site prep', 'Post & footing', 'Frame', 'Decking', 'Railings', 'Stairs', 'Finishing'],
  roofing:  ['Site prep & protection', 'Tear-off', 'Sheathing repair', 'Underlayment', 'Roofing install', 'Flashing & gutters', 'Cleanup'],
  driveway: ['Site prep', 'Excavation', 'Base layer', 'Surface install', 'Edging & finishing'],
  fullreno: ['Site prep & protection', 'Demolition', 'Rough plumbing', 'Rough electrical', 'Framing', 'Insulation', 'Drywall', 'Flooring', 'Cabinets & fixtures', 'Painting', 'Final trim'],
  nc:       ['Site prep', 'Foundation', 'Framing', 'Rough plumbing', 'Rough electrical', 'Roofing', 'Insulation', 'Drywall', 'Flooring', 'Cabinets & fixtures', 'Painting', 'Final inspections'],
  basement: ['Site prep & protection', 'Waterproofing & foundation', 'Framing & walls', 'Rough electrical', 'Rough plumbing (if needed)', 'Insulation', 'Drywall', 'Flooring', 'Ceiling', 'Paint & finish', 'Final fixtures'],
  upsell:   ['Site walkthrough', 'Documentation', 'Recommendations'],
};

async function createPhasesForJob(jobId, serviceString) {
  try {
    const { data: existing } = await supabase.from('job_phases').select('id').eq('job_id', jobId).limit(1);
    if (existing && existing.length > 0) return;
    const serviceIds = (serviceString || '').split(',').map((s) => s.trim().toLowerCase());
    const allPhases = [];
    let globalIndex = 0;
    for (const svcId of serviceIds) {
      const phases = SERVICE_PHASES[svcId];
      if (!phases) continue;
      for (const phaseName of phases) {
        allPhases.push({ job_id: jobId, phase: phaseName, phase_index: globalIndex++, tasks: [], extra_tasks: [], completed_tasks: [], started: false });
      }
    }
    if (allPhases.length === 0) {
      ['Site prep & protection', 'Demolition', 'Installation', 'Finishing', 'Cleanup']
        .forEach((p, i) => allPhases.push({ job_id: jobId, phase: p, phase_index: i, tasks: [], extra_tasks: [], completed_tasks: [], started: false }));
    }
    await supabase.from('job_phases').insert(allPhases);
  } catch (err) {
    console.error('Failed to create phases:', err);
  }
}

// ── Inline markdown renderer ──────────────────────────────────────────────────
function renderInline(text) {
  if (!text) return text;
  // Split on bold+italic, bold, italic
  const parts = String(text).split(/(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('***') && part.endsWith('***'))
      return <strong key={i}><em>{part.slice(3, -3)}</em></strong>;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-omega-charcoal">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

// ── Full markdown block renderer ──────────────────────────────────────────────
function renderMarkdownBlocks(content) {
  if (!content) return null;
  const lines = content.split('\n');
  const elements = [];
  let i = 0;
  let ulItems = [];
  let olItems = [];

  function flushLists() {
    if (ulItems.length) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-1.5 space-y-1 ml-1">
          {ulItems.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-omega-slate leading-relaxed">
              <span className="text-omega-orange mt-0.5 flex-shrink-0 select-none">•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      ulItems = [];
    }
    if (olItems.length) {
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-1.5 space-y-1 ml-1 list-none">
          {olItems.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-omega-slate leading-relaxed">
              <span className="text-omega-orange font-semibold flex-shrink-0 select-none w-5 text-right">{j + 1}.</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      olItems = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushLists();
      i++;
      continue;
    }

    // Markdown table — consume all consecutive pipe lines
    if (trimmed.startsWith('|')) {
      flushLists();
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // Filter separator rows (e.g. | --- | --- |)
      const dataRows = tableLines.filter((l) => !/^\|[\s\-:|]+\|$/.test(l));
      const rows = dataRows.map((l) =>
        l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      );
      if (rows.length > 0) {
        elements.push(
          <div key={`tbl-${elements.length}`} className="overflow-x-auto my-3 rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200">
                  {rows[0].map((cell, ci) => (
                    <th key={ci} className="px-3 py-2.5 text-left text-xs font-semibold text-omega-stone uppercase tracking-wider whitespace-nowrap">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((row, ri) => (
                  <tr key={ri} className={`border-b border-gray-100 last:border-0 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-sm text-omega-slate">{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // ### Header
    if (trimmed.startsWith('### ')) {
      flushLists();
      elements.push(
        <h3 key={`h3-${i}`} className="font-bold text-omega-charcoal text-sm mt-4 mb-1.5 pb-1 border-b border-gray-200">
          {renderInline(trimmed.replace(/^###\s+/, ''))}
        </h3>
      );
      i++; continue;
    }
    // ## Header
    if (trimmed.startsWith('## ')) {
      flushLists();
      elements.push(
        <h2 key={`h2-${i}`} className="font-bold text-omega-charcoal text-base mt-4 mb-1.5">
          {renderInline(trimmed.replace(/^##\s+/, ''))}
        </h2>
      );
      i++; continue;
    }
    // # Header
    if (trimmed.startsWith('# ')) {
      flushLists();
      elements.push(
        <h1 key={`h1-${i}`} className="font-bold text-omega-charcoal text-lg mt-4 mb-1.5">
          {renderInline(trimmed.replace(/^#\s+/, ''))}
        </h1>
      );
      i++; continue;
    }

    // Bullet list item
    if (/^[-*•]\s/.test(trimmed)) {
      if (olItems.length) flushLists();
      ulItems.push(trimmed.replace(/^[-*•]\s/, ''));
      i++; continue;
    }

    // Numbered list item
    if (/^\d+[.)]\s/.test(trimmed)) {
      if (ulItems.length) flushLists();
      olItems.push(trimmed.replace(/^\d+[.)]\s/, ''));
      i++; continue;
    }

    // Standalone bold line (acts as a mini-heading)
    if (/^\*\*[^*]+\*\*[:\s]*$/.test(trimmed)) {
      flushLists();
      elements.push(
        <p key={`bh-${i}`} className="font-bold text-omega-charcoal mt-3 mb-1 text-sm">
          {trimmed.replace(/\*\*/g, '')}
        </p>
      );
      i++; continue;
    }

    // Plain paragraph
    flushLists();
    elements.push(
      <p key={`p-${i}`} className="text-sm text-omega-slate leading-relaxed">
        {renderInline(trimmed)}
      </p>
    );
    i++;
  }

  flushLists();
  return <div className="space-y-1">{elements}</div>;
}

// ── Section styles ────────────────────────────────────────────────────────────
const SECTION_STYLES = {
  info:     { bg: 'bg-blue-50',   border: 'border-blue-200',   header: 'bg-blue-100',   icon: Info,           text: 'text-blue-800' },
  success:  { bg: 'bg-green-50',  border: 'border-green-200',  header: 'bg-green-100',  icon: CheckCircle,    text: 'text-green-800' },
  warning:  { bg: 'bg-amber-50',  border: 'border-amber-200',  header: 'bg-amber-100',  icon: AlertTriangle,  text: 'text-amber-800' },
  danger:   { bg: 'bg-red-50',    border: 'border-red-200',    header: 'bg-red-100',    icon: AlertTriangle,  text: 'text-red-800' },
  charcoal: { bg: 'bg-gray-50',   border: 'border-gray-200',   header: 'bg-gray-100',   icon: FileText,       text: 'text-gray-800' },
  slate:    { bg: 'bg-slate-50',  border: 'border-slate-200',  header: 'bg-slate-100',  icon: FileText,       text: 'text-slate-800' },
};

function SkeletonSection() {
  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="px-5 py-4 bg-gray-100"><div className="h-4 bg-gray-300 rounded w-1/3" /></div>
      <div className="px-5 py-4 space-y-2">
        {[100, 83, 67, 90].map((w, i) => (
          <div key={i} className="h-3 bg-gray-200 rounded" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

function ReportSection({ section }) {
  const [open, setOpen] = useState(true);
  const style = SECTION_STYLES[section.color] || SECTION_STYLES.charcoal;
  const Icon = style.icon;

  return (
    <div className={`rounded-2xl border ${style.border} overflow-hidden shadow-sm`}>
      <button type="button" onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-5 py-4 ${style.header}`}>
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${style.text}`} />
          <span className={`font-semibold text-sm ${style.text}`}>{section.title}</span>
        </div>
        <ChevronDown className={`w-5 h-5 ${style.text} opacity-60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`px-5 py-4 ${style.bg} ${open ? '' : 'hidden'}`}>
        {renderMarkdownBlocks(section.content)}
      </div>
    </div>
  );
}

// ── Confirm Regenerate Dialog ─────────────────────────────────────────────────
function ConfirmRegenDialog({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-center font-bold text-omega-charcoal mb-2">Regenerate Report?</p>
        <p className="text-center text-sm text-omega-stone mb-6">This will replace the current report. The existing report is kept as a backup.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-omega-orange text-white font-semibold text-sm hover:bg-omega-dark">Regenerate</button>
        </div>
      </div>
    </div>
  );
}

// ── WhatsApp Client Message ───────────────────────────────────────────────────
function buildClientWhatsApp(job) {
  const phone = (job.client_phone || '').replace(/\D/g, '');
  if (!phone) return null;
  const msg = `Hi ${job.client_name}! 🏠

Thank you so much for the opportunity to visit your home today and learn about your project. We truly appreciate your time and trust in Omega Development.

We have already shared all the details with our estimating team, who will put together a fair and detailed proposal tailored specifically to your project.

You can expect to hear from us within the next 24-48 hours. In the meantime, please don't hesitate to reach out if you have any questions.

We look forward to working with you!

— Omega Development Team
📞 203-451-4846
🌐 omeganyct.com`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export default function Report({ job, pdfContext = '', onNavigate }) {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [retryMsg, setRetryMsg] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [rawReport, setRawReport] = useState(job.report_raw || '');
  const [reportTs, setReportTs] = useState(job.answers?._report_ts || null);
  const [showConfirmRegen, setShowConfirmRegen] = useState(false);

  useEffect(() => {
    if (job.report_raw) {
      setSections(parseReport(job.report_raw));
    } else {
      fetchReport();
    }
  }, []);

  async function fetchReport() {
    setLoading(true);
    setError(null);
    setRetryMsg(null);
    setSections([]);
    try {
      const raw = await generateReport(job, job.answers || {}, pdfContext, setRetryMsg);
      const ts = Date.now();
      const nowIso = new Date().toISOString();
      setRawReport(raw);
      setReportTs(ts);
      setSections(parseReport(raw));
      const mergedAnswers = { ...(job.answers || {}), _report_ts: ts };
      const patch = {
        report_raw: raw,
        report: raw,
        status: 'to_quote',
        answers: mergedAnswers,
        latest_report: raw,
        report_generated_at: nowIso,
        questionnaire_modified: false,
      };
      const { error: saveErr } = await supabase.from('jobs').update(patch).eq('id', job.id);
      if (!saveErr) {
        // Persist report history for versioning (best-effort — table may
        // not exist yet in older envs; failure is non-fatal).
        try {
          const { data: prev } = await supabase
            .from('job_reports')
            .select('version')
            .eq('job_id', job.id)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();
          const nextVersion = (prev?.version || 0) + 1;
          await supabase.from('job_reports').insert([{
            job_id: job.id,
            report_content: raw,
            questionnaire_snapshot: job.answers || {},
            version: nextVersion,
            generated_at: nowIso,
          }]);
        } catch { /* job_reports table missing — skip */ }
        // Keep local state in sync so the banner disappears immediately.
        Object.assign(job, patch);
        await createPhasesForJob(job.id, job.service);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
      setRetryMsg(null);
    }
  }

  const handleRegenerate = () => {
    if (rawReport) setShowConfirmRegen(true);
    else fetchReport();
  };

  const confirmRegenerate = () => {
    setShowConfirmRegen(false);
    fetchReport();
  };

  const saveReport = async () => {
    if (!rawReport) return;
    setSaving(true);
    try {
      const ts = reportTs || Date.now();
      const mergedAnswers = { ...(job.answers || {}), _report_ts: ts };
      await supabase
        .from('jobs')
        .update({ report_raw: rawReport, report: rawReport, status: 'to_quote', answers: mergedAnswers })
        .eq('id', job.id);
      setReportTs(ts);
      setToast({ type: 'success', message: 'Report saved!' });
      await createPhasesForJob(job.id, job.service);
    } catch {
      setToast({ type: 'error', message: 'Failed to save report.' });
    } finally {
      setSaving(false);
    }
  };

  function formatReportTs(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  const canSave = !loading && !error && rawReport;
  const clientWhatsApp = buildClientWhatsApp(job);

  return (
    <div className="min-h-screen bg-omega-cloud pb-10">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showConfirmRegen && <ConfirmRegenDialog onConfirm={confirmRegenerate} onCancel={() => setShowConfirmRegen(false)} />}

      {/* Header */}
      <div className="no-print bg-omega-charcoal px-5 pt-12 pb-4 sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => onNavigate('questionnaire')} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors flex-shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="text-omega-fog text-xs truncate">{job.client_name}</p>
              <h1 className="text-white font-bold text-base leading-tight">Project Report</h1>
            </div>
          </div>

          {/* All action buttons inline in header */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {sections.length > 0 && (
              <button onClick={() => window.print()}
                className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-xs font-medium">
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>
            )}
            {sections.length > 0 && clientWhatsApp && (
              <a href={clientWhatsApp} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white transition-colors text-xs font-medium">
                <MessageCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Client</span>
              </a>
            )}
            <button onClick={handleRegenerate} disabled={loading}
              className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-xs font-medium disabled:opacity-50">
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Regen</span>
            </button>
            {canSave && (
              <button onClick={saveReport} disabled={saving}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-omega-orange text-white hover:bg-omega-dark transition-colors text-xs font-semibold">
                {saving ? <LoadingSpinner size={13} color="text-white" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
            )}
          </div>
        </div>
        {reportTs && <p className="text-omega-fog text-xs mt-1.5 pl-11">Generated {formatReportTs(reportTs)}</p>}
      </div>

      {/* Print header */}
      <div className="hidden print-show px-6 py-4 border-b border-gray-200">
        <p className="font-bold text-lg text-gray-900">Omega Development LLC — Project Report</p>
        <p className="text-sm text-gray-600">{job.client_name} · {job.service} · {job.address}</p>
        <p className="text-xs text-gray-400 mt-0.5">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>

      <div className="px-4 py-5">
        {/* Outdated-report banner */}
        {(() => {
          const modifiedAt = job.questionnaire_modified_at ? new Date(job.questionnaire_modified_at).getTime() : 0;
          const generatedAt = job.report_generated_at ? new Date(job.report_generated_at).getTime() : (reportTs || 0);
          const outdated = !!(job.questionnaire_modified || (modifiedAt && generatedAt && modifiedAt > generatedAt));
          if (!outdated || !rawReport) return null;
          return (
            <div className="mb-5 rounded-2xl border-2 border-red-500 bg-red-50 p-4 flex items-start gap-3 no-print">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-red-900 font-extrabold text-sm uppercase leading-snug">
                  The questionnaire has been updated. You are viewing the report from before those changes.
                </p>
                <button
                  onClick={handleRegenerate}
                  disabled={loading}
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wide disabled:opacity-60"
                >
                  <RefreshCw className="w-4 h-4" /> Regenerate Report
                </button>
              </div>
            </div>
          );
        })()}

        {/* Job info card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-5 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-omega-stone uppercase tracking-wider mb-0.5">Client</p>
              <p className="text-sm font-semibold text-omega-charcoal">{job.client_name}</p>
            </div>
            <div>
              <p className="text-xs text-omega-stone uppercase tracking-wider mb-0.5">Service</p>
              <p className="text-sm font-semibold text-omega-charcoal">{job.service}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-omega-stone uppercase tracking-wider mb-0.5">Address</p>
              <p className="text-sm text-omega-slate">{job.address}</p>
            </div>
            {reportTs && (
              <div className="col-span-2 pt-2 border-t border-gray-100">
                <p className="text-xs text-omega-stone">Report generated on {formatReportTs(reportTs)}</p>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="space-y-3">
            <div className={`flex items-center gap-3 p-4 rounded-2xl border mb-4 ${retryMsg ? 'bg-amber-50 border-amber-200' : 'bg-omega-pale border-omega-orange/20'}`}>
              <LoadingSpinner />
              <div>
                <p className={`text-sm font-semibold ${retryMsg ? 'text-amber-800' : 'text-omega-charcoal'}`}>
                  {retryMsg || 'Generating report with Omega AI...'}
                </p>
                {!retryMsg && <p className="text-xs text-omega-stone mt-0.5">Analyzing project answers — takes about 20–30 seconds.</p>}
              </div>
            </div>
            {[...Array(5)].map((_, i) => <SkeletonSection key={i} />)}
          </div>
        )}

        {!loading && error && (
          <div className="p-5 rounded-2xl bg-red-50 border border-red-200 text-center">
            <AlertTriangle className="w-10 h-10 text-omega-danger mx-auto mb-3" />
            <p className="font-semibold text-omega-danger mb-2">Report generation failed</p>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <button onClick={fetchReport} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-omega-danger text-white text-sm font-semibold mx-auto hover:opacity-90 transition-opacity">
              <RefreshCw className="w-4 h-4" />Try Again
            </button>
          </div>
        )}

        {!loading && !error && sections.length > 0 && (
          <div className="space-y-3">
            {sections.map((section) => (
              <ReportSection key={section.key} section={section} />
            ))}
          </div>
        )}

        {!loading && !error && sections.length === 0 && rawReport === '' && (
          <div className="flex flex-col items-center py-16 text-center">
            <FileText className="w-12 h-12 text-omega-fog mb-3" />
            <p className="font-semibold text-omega-charcoal mb-1">No report yet</p>
            <p className="text-sm text-omega-stone mb-4">Tap Generate to create the project report.</p>
            <button onClick={fetchReport} className="flex items-center gap-2 px-5 py-3 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark transition-colors">
              <FileText className="w-4 h-4" />Generate Report
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
