import { useState, useRef, useEffect } from 'react';
import {
  Upload, FileText, Link, Download, Save, X, AlertTriangle,
  ShoppingCart, ClipboardList, Clock, RefreshCw, History,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchBrainEntries } from '../lib/anthropic';
import LoadingSpinner from '../components/LoadingSpinner';
import Toast from '../components/Toast';

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_PAGES = 15;
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 0.6;

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─────────────────────────────────────────────────────────────────────────────
// PDF.js rendering
// ─────────────────────────────────────────────────────────────────────────────
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF renderer'));
    document.head.appendChild(script);
  });
}

async function pdfToJpegs(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const images = [];
  for (let i = 1; i <= pageCount; i++) {
    onProgress(i, pageCount);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1, MAX_WIDTH / viewport.width);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    images.push(canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1]);
  }
  return { images, totalPages: pdf.numPages };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt (#19-D + #19-E)
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_CONTEXT = `You are an experienced Connecticut construction estimator with 20 years in Fairfield County. You know real Home Depot CT pricing (2025). Always use standard contractor units: lumber in "pcs" or "LF", drywall in "sheets", concrete in "bags" (never cubic meters), tile in "sq ft", paint in "gallons", wire in "rolls", pipe in "LF".`;

const PROMPT_BODY = `Analyze this project document and generate a structured report.

Generate EXACTLY these sections using these delimiters:

###ASECTION###OVERVIEW
Write exactly 2 paragraphs of exactly 5 lines each. Use simple, direct language. No jargon. Describe what the project is, the key scope, what was specified, and the overall scope size. Keep it factual and clear.

###ASECTION###MATERIALS
Materials list organized by trade category. Use ONLY these categories (skip if none apply):
Demolition / Framing / Electrical / Plumbing / Waterproofing / Insulation / Drywall / Flooring / Finishes / Fixtures

For each category with items, format EXACTLY as:
CATEGORY NAME
Product Name | Est. Quantity | Unit | Est. Unit Price

Rules:
- Lumber: "2x4x8 Douglas Fir Stud" → unit "pcs"
- Drywall: "4x8 Drywall Sheet 1/2\\"" → unit "sheets"
- Concrete: "80lb Concrete Bag" → unit "bags"
- Tile: unit "sq ft"
- Paint: unit "gallons"
- Wire: "14/2 NM-B Cable 250ft Roll" → unit "rolls"
No bullets. No descriptions. Just table rows. Use real CT market pricing (2025).

###ASECTION###RED_FLAGS
List every concern, inconsistency, missing information, or Connecticut building code issue. Be direct and specific. Number each item. If none, write "No red flags identified."

Be thorough and accurate.`;

function buildAnalysisPrompt(brainEntries) {
  const brainContext = brainEntries.length
    ? `\n\nOMEGA DEVELOPMENT CALIBRATION DATA — Use this to calibrate your analysis:\n${brainEntries.map((e, i) => `${i + 1}. ${e.entry}`).join('\n')}`
    : '';
  return `${SYSTEM_CONTEXT}${brainContext}\n\n${PROMPT_BODY}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic API call
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeProjectFile(file, brainEntries, onProgress) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150000);
  const promptText = buildAnalysisPrompt(brainEntries);

  let contentBlocks;
  if (file.type === 'application/pdf') {
    const { images, totalPages } = await pdfToJpegs(file, onProgress);
    contentBlocks = images.map((b64) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    }));
    const pagesNote = totalPages > MAX_PAGES
      ? `These are pages 1–${MAX_PAGES} of a ${totalPages}-page PDF.`
      : `This is a ${totalPages}-page PDF.`;
    contentBlocks.push({ type: 'text', text: `${pagesNote}\n\n${promptText}` });
  } else {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    contentBlocks = [
      { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
      { type: 'text', text: promptText },
    ];
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${response.status}`);
    }
    const data = await response.json();
    return data.content[0].text;
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section parsers
// ─────────────────────────────────────────────────────────────────────────────
function parseSections(raw) {
  const parts = raw.split('###ASECTION###');
  return parts.slice(1).map((part) => {
    const nl = part.indexOf('\n');
    const key = part.substring(0, nl).trim();
    const content = part.substring(nl + 1).trim();
    return { key, content };
  }).filter((s) => s.content);
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderers
// ─────────────────────────────────────────────────────────────────────────────
function MaterialsTable({ content }) {
  const lines = content.split('\n').filter((l) => l.trim());
  let category = null;
  const rows = [];
  for (const line of lines) {
    if (line.includes('|')) {
      const cols = line.split('|').map((c) => c.trim());
      if (cols.length >= 4) rows.push({ type: 'row', category, cols });
    } else if (line.trim()) {
      category = line.trim().replace(/[*#]/g, '');
      rows.push({ type: 'header', label: category });
    }
  }
  if (rows.length === 0)
    return <p className="text-sm text-omega-stone italic">No materials extracted.</p>;
  return (
    <div className="space-y-3">
      {rows.some((r) => r.type === 'row') && (
        <div className="grid grid-cols-12 gap-1 px-2 pb-1 border-b border-gray-200 text-[10px] font-semibold text-omega-stone uppercase tracking-wider">
          <span className="col-span-5">Product</span>
          <span className="col-span-2 text-center">Qty</span>
          <span className="col-span-2 text-center">Unit</span>
          <span className="col-span-3 text-right">Est. Price</span>
        </div>
      )}
      {rows.map((row, i) => {
        if (row.type === 'header') return (
          <p key={i} className="text-xs font-bold text-omega-charcoal uppercase tracking-wider pt-2 first:pt-0 border-b border-gray-200 pb-1">{row.label}</p>
        );
        const [product, qty, unit, price] = row.cols;
        return (
          <div key={i} className={`grid grid-cols-12 gap-1 text-xs py-1.5 px-2 rounded ${i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}>
            <span className="col-span-5 text-omega-charcoal font-medium">{product}</span>
            <span className="col-span-2 text-omega-stone text-center">{qty}</span>
            <span className="col-span-2 text-omega-stone text-center">{unit}</span>
            <span className="col-span-3 text-right font-semibold text-omega-orange">{price}</span>
          </div>
        );
      })}
    </div>
  );
}

function GenericContent({ content }) {
  const lines = content.split('\n').filter((l) => l.trim());
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (/^\d+\./.test(line.trim())) return (
          <div key={i} className="flex gap-2 text-sm">
            <span className="text-omega-orange font-bold flex-shrink-0">{line.match(/^\d+/)[0]}.</span>
            <span className="text-omega-slate leading-relaxed">{line.replace(/^\d+\.\s*/, '')}</span>
          </div>
        );
        if (line.startsWith('- ') || line.startsWith('• ')) return (
          <div key={i} className="flex gap-2 text-sm">
            <span className="text-omega-orange flex-shrink-0 mt-0.5">•</span>
            <span className="text-omega-slate leading-relaxed">{line.replace(/^[-•]\s/, '')}</span>
          </div>
        );
        return <p key={i} className="text-sm text-omega-slate leading-relaxed">{line.replace(/\*\*/g, '')}</p>;
      })}
    </div>
  );
}

const SECTION_CONFIG = {
  OVERVIEW:  { title: 'Project Overview',       icon: ClipboardList, color: 'bg-blue-50 border-blue-200',  headerColor: 'bg-blue-100',  textColor: 'text-blue-800' },
  MATERIALS: { title: 'Materials by Trade',     icon: ShoppingCart,  color: 'bg-gray-50 border-gray-200',  headerColor: 'bg-gray-100',  textColor: 'text-gray-800' },
  RED_FLAGS: { title: 'Red Flags & Missing Info',icon: AlertTriangle, color: 'bg-red-50 border-red-200',   headerColor: 'bg-red-100',   textColor: 'text-red-800' },
};

function formatTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectAnalyzer() {
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [sections, setSections] = useState([]);
  const [rawResult, setRawResult] = useState('');
  const [analysisTs, setAnalysisTs] = useState(null);
  const [currentAnalysisId, setCurrentAnalysisId] = useState(null);
  const [error, setError] = useState(null);

  // Recent analyses (#19-C)
  const [recentAnalyses, setRecentAnalyses] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Link to job
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Regenerate confirm
  const [showConfirmRegen, setShowConfirmRegen] = useState(false);

  const fileRef = useRef();

  useEffect(() => {
    loadJobs();
    loadRecentAnalyses();
  }, []);

  async function loadJobs() {
    const { data } = await supabase.from('jobs').select('id, client_name, address, service').order('created_at', { ascending: false }).limit(50);
    setJobs(data || []);
  }

  async function loadRecentAnalyses() {
    setLoadingRecent(true);
    try {
      const { data } = await supabase
        .from('project_analyses')
        .select('id, filename, file_type, overview, job_id, created_at, raw_response')
        .order('created_at', { ascending: false })
        .limit(10);
      setRecentAnalyses(data || []);
    } catch {
      // table may not exist yet
    } finally {
      setLoadingRecent(false);
    }
  }

  function loadAnalysisFromDb(analysis) {
    const parsed = parseSections(analysis.raw_response || '');
    setSections(parsed);
    setRawResult(analysis.raw_response || '');
    setAnalysisTs(new Date(analysis.created_at).getTime());
    setCurrentAnalysisId(analysis.id);
    setFile(null);
    setError(null);
    setProgress(null);
    if (analysis.job_id) setSelectedJobId(analysis.job_id);
  }

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Please select a PDF, JPG, PNG, or WEBP file');
      return;
    }
    setFile(f);
    setError(null);
    setSections([]);
    setRawResult('');
    setProgress(null);
    setAnalysisTs(null);
    setCurrentAnalysisId(null);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    setSections([]);
    setProgress(null);
    try {
      const brainEntries = await fetchBrainEntries();
      const raw = await analyzeProjectFile(file, brainEntries, (current, total) => setProgress({ current, total }));
      const parsed = parseSections(raw);
      setRawResult(raw);
      setSections(parsed);
      const ts = Date.now();
      setAnalysisTs(ts);

      // #23 — save immediately to Supabase
      const overviewSection = parsed.find((s) => s.key === 'OVERVIEW');
      const { data: saved, error: saveErr } = await supabase.from('project_analyses').insert([{
        filename: file.name,
        file_type: file.type,
        overview: overviewSection?.content?.substring(0, 500) || null,
        raw_response: raw,
        job_id: selectedJobId || null,
      }]).select().single();

      if (!saveErr && saved) {
        setCurrentAnalysisId(saved.id);
        setRecentAnalyses((prev) => [saved, ...prev.slice(0, 9)]);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Analysis timed out. Try a smaller file.');
      } else {
        setError(err.message || 'Failed to analyze file. Please try again.');
      }
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  };

  const handleSaveToJob = async () => {
    if (!selectedJobId || !rawResult) return;
    setSaving(true);
    try {
      const { data: jobData } = await supabase.from('jobs').select('answers').eq('id', selectedJobId).single();
      const mergedAnswers = { ...(jobData?.answers || {}), _analyzer_result: rawResult, _analyzer_ts: Date.now() };
      const { error } = await supabase.from('jobs').update({ answers: mergedAnswers }).eq('id', selectedJobId);
      if (error) throw error;
      // Also update the analysis record with the job_id
      if (currentAnalysisId) {
        await supabase.from('project_analyses').update({ job_id: selectedJobId }).eq('id', currentAnalysisId);
        setRecentAnalyses((prev) => prev.map((a) => a.id === currentAnalysisId ? { ...a, job_id: selectedJobId } : a));
      }
      setToast({ type: 'success', message: 'Analysis linked to job successfully!' });
    } catch {
      setToast({ type: 'error', message: 'Failed to save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const blob = new Blob([rawResult], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-analysis-${file?.name?.replace(/\.[^.]+$/, '') || currentAnalysisId || 'document'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    setFile(null);
    setSections([]);
    setRawResult('');
    setError(null);
    setProgress(null);
    setAnalysisTs(null);
    setCurrentAnalysisId(null);
  };

  const fileLabel = file
    ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB${file.type === 'application/pdf' ? ` · up to ${MAX_PAGES} pages` : ''}`
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {showConfirmRegen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
            <p className="text-center font-bold text-omega-charcoal mb-2">Analyze new file?</p>
            <p className="text-center text-sm text-omega-stone mb-6">This will run a new analysis. Previous result is saved in Recent Analyses.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirmRegen(false)} className="flex-1 py-3 rounded-xl border border-gray-200 text-omega-slate font-semibold text-sm">Cancel</button>
              <button onClick={() => { setShowConfirmRegen(false); handleAnalyze(); }} className="flex-1 py-3 rounded-xl bg-omega-orange text-white font-semibold text-sm">Analyze</button>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-omega-charcoal">Project Analyzer</h1>
        <p className="text-xs text-omega-stone mt-0.5">Upload architectural plans, scope of work, or any project document — Omega AI extracts structured insights</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* ── Recent Analyses (#19-C) ──────────────────────────────────────── */}
          {(recentAnalyses.length > 0 || loadingRecent) && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b border-gray-200">
                <History className="w-4 h-4 text-omega-stone" />
                <p className="text-sm font-semibold text-omega-charcoal">Recent Analyses</p>
                <span className="text-xs text-omega-stone ml-auto">{recentAnalyses.length} saved</span>
              </div>
              {loadingRecent ? (
                <div className="flex justify-center py-4"><LoadingSpinner size={20} /></div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentAnalyses.map((analysis) => {
                    const isActive = analysis.id === currentAnalysisId;
                    const linkedJob = jobs.find((j) => j.id === analysis.job_id);
                    return (
                      <button
                        key={analysis.id}
                        onClick={() => loadAnalysisFromDb(analysis)}
                        className={`w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-gray-50 transition-colors ${isActive ? 'bg-omega-pale border-l-2 border-omega-orange' : ''}`}
                      >
                        <FileText className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isActive ? 'text-omega-orange' : 'text-omega-fog'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${isActive ? 'text-omega-orange' : 'text-omega-charcoal'}`}>
                            {analysis.filename || 'Untitled'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-omega-stone">{formatTs(analysis.created_at)}</span>
                            {linkedJob && (
                              <span className="text-xs text-omega-orange font-medium truncate">· {linkedJob.client_name}</span>
                            )}
                          </div>
                          {analysis.overview && (
                            <p className="text-xs text-omega-fog mt-0.5 line-clamp-1">{analysis.overview}</p>
                          )}
                        </div>
                        {isActive && <span className="text-[10px] font-bold text-omega-orange bg-omega-pale px-1.5 py-0.5 rounded flex-shrink-0">ACTIVE</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Upload area ──────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-omega-charcoal mb-3">Upload Project Document</p>

            <button
              onClick={() => fileRef.current?.click()}
              className={`w-full flex flex-col items-center gap-3 py-8 rounded-xl border-2 border-dashed transition-colors ${
                file ? 'border-omega-orange bg-omega-pale' : 'border-gray-200 hover:border-omega-orange/40'
              }`}
            >
              {file ? <FileText className="w-8 h-8 text-omega-orange" /> : <Upload className="w-8 h-8 text-omega-fog" />}
              <div className="text-center">
                <p className={`font-semibold text-sm ${file ? 'text-omega-charcoal' : 'text-omega-stone'}`}>
                  {file ? file.name : 'Click to select file'}
                </p>
                {fileLabel
                  ? <p className="text-xs text-omega-stone mt-0.5">{fileLabel}</p>
                  : <p className="text-xs text-omega-fog mt-1">PDF (up to 60 MB, first 15 pages), JPG, PNG, or WEBP</p>}
              </div>
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={handleFileSelect} className="hidden" />

            {error && (
              <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200">
                <p className="text-sm text-omega-danger">{error}</p>
              </div>
            )}

            {file && !analyzing && (
              <button
                onClick={sections.length > 0 ? () => setShowConfirmRegen(true) : handleAnalyze}
                className="w-full flex items-center justify-center gap-2 mt-4 py-3.5 rounded-xl bg-omega-orange text-white font-semibold hover:bg-omega-dark transition-colors"
              >
                <Upload className="w-4 h-4" />
                {sections.length > 0 ? 'Analyze New File' : 'Analyze with Omega AI'}
              </button>
            )}

            {analyzing && (
              <div className="mt-4 p-4 rounded-xl bg-omega-pale border border-omega-orange/20 space-y-2">
                <div className="flex items-center gap-3">
                  <LoadingSpinner />
                  <div>
                    {progress ? (
                      <>
                        <p className="text-sm font-semibold text-omega-charcoal">Processing page {progress.current} of {progress.total}...</p>
                        <p className="text-xs text-omega-stone mt-0.5">Rendering for analysis</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-omega-charcoal">Analyzing with Omega AI...</p>
                        <p className="text-xs text-omega-stone mt-0.5">This may take 20–60 seconds</p>
                      </>
                    )}
                  </div>
                </div>
                {progress && (
                  <div className="h-1.5 bg-omega-orange/20 rounded-full overflow-hidden">
                    <div className="h-full bg-omega-orange rounded-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Active result header (#23) ────────────────────────────────────── */}
          {sections.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              {/* Timestamp */}
              {analysisTs && (
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-3.5 h-3.5 text-omega-stone" />
                  <p className="text-xs text-omega-stone">Generated on {formatTs(analysisTs)}</p>
                </div>
              )}

              {/* Link to job */}
              <div className="flex items-center gap-2 mb-3">
                <Link className="w-4 h-4 text-omega-stone" />
                <p className="text-sm font-semibold text-omega-charcoal">Link to Job (optional)</p>
              </div>
              <select
                value={selectedJobId}
                onChange={(e) => setSelectedJobId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-omega-charcoal text-sm focus:outline-none focus:border-omega-orange bg-white mb-3"
              >
                <option value="">— Select a job —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.client_name} · {j.service}</option>
                ))}
              </select>
              <div className="flex gap-2 flex-wrap">
                {selectedJobId && (
                  <button onClick={handleSaveToJob} disabled={saving}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-omega-orange text-white text-sm font-semibold hover:bg-omega-dark disabled:opacity-60 transition-colors">
                    {saving ? <LoadingSpinner size={14} color="text-white" /> : <Save className="w-4 h-4" />}
                    Link to Job
                  </button>
                )}
                <button onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-omega-charcoal text-sm font-medium hover:bg-gray-50 transition-colors">
                  <Download className="w-4 h-4" />Export
                </button>
                <button onClick={handleClear}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-omega-stone text-sm font-medium hover:bg-gray-50 transition-colors">
                  <X className="w-4 h-4" />Clear
                </button>
              </div>
            </div>
          )}

          {/* ── Results ───────────────────────────────────────────────────────── */}
          {sections.map((section) => {
            const config = SECTION_CONFIG[section.key] || { title: section.key, icon: FileText, color: 'bg-gray-50 border-gray-200', headerColor: 'bg-gray-100', textColor: 'text-gray-800' };
            const Icon = config.icon;
            return (
              <div key={section.key} className={`rounded-xl border ${config.color} overflow-hidden`}>
                <div className={`flex items-center gap-2.5 px-5 py-3.5 ${config.headerColor}`}>
                  <Icon className={`w-4 h-4 ${config.textColor}`} />
                  <span className={`font-semibold text-sm ${config.textColor}`}>{config.title}</span>
                </div>
                <div className="px-5 py-4">
                  {section.key === 'MATERIALS'
                    ? <MaterialsTable content={section.content} />
                    : <GenericContent content={section.content} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
