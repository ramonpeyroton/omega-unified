// Bulk Receipt Import — admin tool to turn a multi-page PDF of scanned
// receipts into one receipt record per page on a single job, the same
// way Gabriel does it one-at-a-time from the field, but in bulk and
// AI-assisted.
//
// Flow:
//   1. Pick the client/job + drop a PDF (one receipt per page).
//   2. We render each page to a JPEG (pdf.js) and ask Claude to read
//      the grand total off each one.
//   3. Review screen: every page shows its image, the AI's total
//      (editable), a description, and an include/exclude checkbox.
//      Faded / low-confidence reads are flagged so they get a look.
//   4. Save: for each included page we mirror the manual ReceiptCapture
//      flow exactly — upload the image to job-documents/receipts/,
//      write a job_documents row (folder='receipts') AND a job_expenses
//      row (category='Material', receipt_url=same) so Financials totals
//      update. One audit row per receipt + a bulk summary.
//
// Lives in Admin (hidden /admin-x9k2) because it touches money.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Receipt as ReceiptIcon, Upload, Loader2, CheckCircle2, AlertTriangle,
  X, FileText, Search, DollarSign, RefreshCw, ImageOff,
} from 'lucide-react';
import { supabase } from '../../../shared/lib/supabase';
import { logAudit } from '../../../shared/lib/audit';
import { pdfToPageImages } from '../../../shared/lib/pdfPages';
import { extractReceiptTotal } from '../lib/receiptScan';

const BUCKET = 'job-documents';

function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}
function fmtMoney(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : '—';
}

export default function BulkReceiptImport({ user }) {
  // 'idle' | 'reading' | 'review' | 'saving' | 'done'
  const [phase, setPhase] = useState('idle');

  // Jobs + selection
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobQuery, setJobQuery] = useState('');
  const [jobId, setJobId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // File + processing
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [rows, setRows] = useState([]); // [{ pageNumber, dataUrl, blob, amount, description, confidence, include, scanError, saveState, saveError }]
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null); // dataUrl
  const fileInputRef = useRef(null);

  // ── load jobs ──────────────────────────────────────────────────
  async function reloadJobs() {
    setLoadingJobs(true);
    try {
      const { data, error: e } = await supabase
        .from('jobs')
        .select('id, client_name, address, city, service, pipeline_status')
        .order('client_name', { ascending: true });
      if (e) throw e;
      setJobs(data || []);
    } catch (e) {
      setError(e.message || 'Failed to load clients.');
    } finally {
      setLoadingJobs(false);
    }
  }
  useEffect(() => { reloadJobs(); }, []);

  const selectedJob = useMemo(() => jobs.find((j) => j.id === jobId) || null, [jobs, jobId]);
  const filteredJobs = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return jobs.slice(0, 50);
    return jobs.filter((j) =>
      `${j.client_name || ''} ${j.address || ''} ${j.city || ''}`.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [jobs, jobQuery]);

  function onPickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf') { setError('Please choose a PDF file.'); return; }
    setError('');
    setFile(f);
  }

  // ── read the PDF: render pages, then OCR each total ─────────────
  async function readReceipts() {
    if (!jobId) { setError('Pick the client this PDF belongs to first.'); return; }
    if (!file)  { setError('Choose a PDF of receipts.'); return; }
    setError('');
    setPhase('reading');

    let pages;
    try {
      setProgress({ done: 0, total: 0, label: 'Rendering pages…' });
      const out = await pdfToPageImages(file, {
        onProgress: (p, t) => setProgress({ done: p, total: t, label: `Rendering page ${p} of ${t}…` }),
      });
      pages = out.pages;
    } catch (e) {
      setError(e.message || 'Could not read that PDF.');
      setPhase('idle');
      return;
    }

    // Seed rows so the user sees the images immediately while the AI runs.
    const seeded = pages.map((p) => ({
      pageNumber: p.pageNumber,
      dataUrl: p.dataUrl,
      blob: p.blob,
      amount: '',
      description: '',
      confidence: null,
      include: true,
      scanState: 'pending', // pending | scanning | done | error
      scanError: '',
      saveState: 'idle',
      saveError: '',
    }));
    setRows(seeded);
    setPhase('review');

    // OCR each page sequentially (keeps us well under rate limits).
    for (let i = 0; i < pages.length; i++) {
      setProgress({ done: i, total: pages.length, label: `Reading receipt ${i + 1} of ${pages.length}…` });
      setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, scanState: 'scanning' } : r));
      try {
        const res = await extractReceiptTotal(pages[i].base64, 'image/jpeg');
        setRows((prev) => prev.map((r, idx) => {
          if (idx !== i) return r;
          return {
            ...r,
            amount: res.total != null ? String(res.total) : '',
            description: res.store ? `Receipt — ${res.store}` : '',
            confidence: res.confidence,
            include: res.total != null,        // auto-exclude unreadable ones until reviewed
            scanState: 'done',
          };
        }));
      } catch (e) {
        setRows((prev) => prev.map((r, idx) =>
          idx === i ? { ...r, scanState: 'error', scanError: e.message || 'Read failed', include: false } : r
        ));
      }
    }
    setProgress({ done: pages.length, total: pages.length, label: 'Done reading.' });
  }

  // ── row editing ─────────────────────────────────────────────────
  function patchRow(idx, patch) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  async function rescanRow(idx) {
    const row = rows[idx];
    if (!row) return;
    patchRow(idx, { scanState: 'scanning', scanError: '' });
    try {
      // Re-derive base64 from the blob we kept.
      const base64 = await blobToBase64(row.blob);
      const res = await extractReceiptTotal(base64, 'image/jpeg');
      patchRow(idx, {
        amount: res.total != null ? String(res.total) : '',
        description: row.description || (res.store ? `Receipt — ${res.store}` : ''),
        confidence: res.confidence,
        scanState: 'done',
      });
    } catch (e) {
      patchRow(idx, { scanState: 'error', scanError: e.message || 'Read failed' });
    }
  }

  // ── save ─────────────────────────────────────────────────────────
  const includedValid = useMemo(
    () => rows.filter((r) => r.include && Number(r.amount) > 0),
    [rows]
  );
  const includedTotal = useMemo(
    () => includedValid.reduce((s, r) => s + Number(r.amount), 0),
    [includedValid]
  );

  async function saveAll() {
    if (phase === 'saving') return;
    if (!jobId) { setError('No client selected.'); return; }
    if (includedValid.length === 0) { setError('Nothing to save — include at least one receipt with an amount.'); return; }
    setError('');
    setPhase('saving');

    const today = new Date().toISOString().slice(0, 10);
    let saved = 0, failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const amt = Number(r.amount);
      if (!r.include || !(amt > 0)) {
        patchRow(i, { saveState: r.include ? 'error' : 'skipped', saveError: r.include ? 'No amount' : '' });
        if (r.include) failed += 1;
        continue;
      }
      patchRow(i, { saveState: 'saving', saveError: '' });
      try {
        // 1. Upload the page image.
        const fname = `receipt-p${r.pageNumber}.jpg`;
        const path = `receipts/${jobId}/${Date.now()}-${i}-${sanitizeName(fname)}`;
        const up = await supabase.storage
          .from(BUCKET)
          .upload(path, r.blob, { upsert: false, contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const photoUrl = pub?.publicUrl;
        if (!photoUrl) throw new Error('Could not resolve receipt URL.');

        const desc = r.description.trim();
        const title = desc || `Receipt · ${fmtMoney(amt)}`;

        // 2. Documents tab row.
        const { error: docErr } = await supabase
          .from('job_documents')
          .insert([{
            job_id: jobId,
            folder: 'receipts',
            title,
            photo_url: photoUrl,
            uploaded_by: user?.name || null,
          }]);
        if (docErr) throw docErr;

        // 3. Financials row (Material, like the manual capture).
        const { error: expErr } = await supabase
          .from('job_expenses')
          .insert([{
            job_id: jobId,
            date: today,
            category: 'Material',
            description: desc || 'Receipt photo',
            amount: amt,
            receipt_url: photoUrl,
            logged_by: user?.name || null,
          }]);
        if (expErr) throw expErr;

        logAudit({
          user,
          action: 'receipt.capture',
          entityType: 'job',
          entityId: jobId,
          details: { amount: amt, has_photo: true, source: 'bulk_pdf', page: r.pageNumber },
        });

        patchRow(i, { saveState: 'done' });
        saved += 1;
      } catch (e) {
        patchRow(i, { saveState: 'error', saveError: e.message || 'Save failed' });
        failed += 1;
      }
    }

    logAudit({
      user,
      action: 'receipt.bulk_import',
      entityType: 'job',
      entityId: jobId,
      details: { saved, failed, totalAmount: includedTotal, fileName: file?.name || null },
    });

    setPhase('done');
  }

  function reset() {
    setPhase('idle');
    setFile(null);
    setRows([]);
    setProgress({ done: 0, total: 0, label: '' });
    setError('');
    setLightbox(null);
    // keep the selected job + jobs cache so a second PDF for the same
    // client is one click away.
  }

  // ── render ───────────────────────────────────────────────────────
  const savedCount  = rows.filter((r) => r.saveState === 'done').length;
  const failedCount = rows.filter((r) => r.saveState === 'error').length;

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      <header className="px-6 md:px-8 py-5 bg-white border-b border-gray-200 sticky top-0 z-10">
        <h1 className="text-xl font-bold text-omega-charcoal flex items-center gap-2">
          <ReceiptIcon className="w-5 h-5 text-omega-orange" /> Bulk Receipt Import
        </h1>
        <p className="text-sm text-omega-stone mt-1">
          Drop a PDF with one receipt per page, pick the client, and the AI reads each total.
          Review the amounts, then save them all to the job at once.
        </p>
      </header>

      <div className="p-6 md:p-8 space-y-6">
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}

        {/* ── Setup: client + file ── */}
        {phase === 'idle' && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 max-w-2xl">
            {/* Client picker */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">
                1. Which client is this PDF for?
              </label>
              {selectedJob ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-omega-orange/40 bg-omega-pale/40">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-omega-charcoal truncate">{selectedJob.client_name || '(no name)'}</p>
                    {(selectedJob.address || selectedJob.city) && (
                      <p className="text-xs text-omega-stone truncate">{[selectedJob.address, selectedJob.city].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                  <button onClick={() => { setJobId(''); setPickerOpen(true); }} className="text-xs font-semibold text-omega-stone hover:text-omega-charcoal px-2 py-1 rounded-lg hover:bg-white">
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 focus-within:border-omega-orange">
                    <Search className="w-4 h-4 text-omega-stone flex-shrink-0" />
                    <input
                      value={jobQuery}
                      onChange={(e) => { setJobQuery(e.target.value); setPickerOpen(true); }}
                      onFocus={() => setPickerOpen(true)}
                      placeholder={loadingJobs ? 'Loading clients…' : 'Search client name or address…'}
                      className="flex-1 min-w-0 text-sm outline-none bg-transparent"
                    />
                    <button onClick={reloadJobs} title="Reload clients" className="text-omega-stone hover:text-omega-charcoal">
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  {pickerOpen && filteredJobs.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 z-20 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg">
                      {filteredJobs.map((j) => (
                        <button
                          key={j.id}
                          onClick={() => { setJobId(j.id); setPickerOpen(false); setJobQuery(''); }}
                          className="w-full text-left px-3 py-2 hover:bg-omega-pale border-b border-gray-50 last:border-0"
                        >
                          <p className="text-sm font-semibold text-omega-charcoal truncate">{j.client_name || '(no name)'}</p>
                          {(j.address || j.city) && (
                            <p className="text-[11px] text-omega-stone truncate">{[j.address, j.city].filter(Boolean).join(', ')}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* File picker */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">
                2. The receipts PDF
              </label>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={onPickFile} className="hidden" />
              {file ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50">
                  <span className="inline-flex items-center gap-2 text-sm text-omega-charcoal min-w-0">
                    <FileText className="w-4 h-4 text-omega-orange flex-shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-omega-stone hover:text-omega-charcoal px-2 py-1 rounded-lg hover:bg-white">
                    Change
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-gray-300 hover:border-omega-orange hover:bg-omega-pale/30 transition-colors"
                >
                  <Upload className="w-7 h-7 text-omega-stone" />
                  <span className="text-sm font-bold text-omega-charcoal">Choose PDF</span>
                  <span className="text-[11px] text-omega-stone">one receipt per page</span>
                </button>
              )}
            </div>

            <button
              onClick={readReceipts}
              disabled={!jobId || !file}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ReceiptIcon className="w-4 h-4" /> Read receipts
            </button>
          </section>
        )}

        {/* ── Reading progress ── */}
        {phase === 'reading' && (
          <section className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-omega-orange mx-auto mb-3" />
            <p className="text-sm font-bold text-omega-charcoal">{progress.label || 'Working…'}</p>
            {progress.total > 0 && (
              <p className="text-xs text-omega-stone mt-1">{progress.done} / {progress.total}</p>
            )}
          </section>
        )}

        {/* ── Review / saving / done ── */}
        {(phase === 'review' || phase === 'saving' || phase === 'done') && (
          <>
            {/* Summary + actions */}
            <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex items-center justify-between gap-3 flex-wrap sticky top-[88px] z-[5]">
              <div>
                <p className="text-xs text-omega-stone uppercase font-semibold tracking-wider">
                  {phase === 'done' ? 'Imported' : 'Review'} · {selectedJob?.client_name}
                </p>
                <p className="text-lg font-bold text-omega-charcoal mt-0.5">
                  {phase === 'done'
                    ? <>{savedCount} saved{failedCount > 0 && <span className="text-red-600"> · {failedCount} failed</span>}</>
                    : <>{includedValid.length} of {rows.length} receipts · {fmtMoney(includedTotal)}</>}
                </p>
                {progress.label && phase === 'review' && progress.done < progress.total && (
                  <p className="text-[11px] text-omega-info mt-0.5 inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> {progress.label}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {phase !== 'done' && (
                  <button onClick={reset} disabled={phase === 'saving'} className="text-xs font-semibold text-omega-stone hover:text-omega-charcoal px-3 py-2 rounded-lg hover:bg-gray-100 disabled:opacity-50">
                    <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Cancel
                  </button>
                )}
                {phase === 'review' && (
                  <button
                    onClick={saveAll}
                    disabled={includedValid.length === 0 || (progress.total > 0 && progress.done < progress.total)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    title={progress.done < progress.total ? 'Wait for the AI to finish reading' : ''}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Save {includedValid.length} receipt{includedValid.length === 1 ? '' : 's'} ({fmtMoney(includedTotal)})
                  </button>
                )}
                {phase === 'saving' && (
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-omega-stone px-4 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving…
                  </span>
                )}
                {phase === 'done' && (
                  <button onClick={reset} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-sm font-semibold text-omega-charcoal">
                    <Upload className="w-4 h-4" /> Import another PDF
                  </button>
                )}
              </div>
            </section>

            {/* Rows */}
            <section className="space-y-3">
              {rows.map((r, idx) => (
                <ReceiptRow
                  key={r.pageNumber}
                  row={r}
                  readonly={phase !== 'review'}
                  onPatch={(patch) => patchRow(idx, patch)}
                  onRescan={() => rescanRow(idx)}
                  onZoom={() => setLightbox(r.dataUrl)}
                />
              ))}
            </section>
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Receipt" className="max-h-full max-w-full object-contain rounded-lg" />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/90 text-omega-charcoal">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────
function ReceiptRow({ row, readonly, onPatch, onRescan, onZoom }) {
  const conf = row.confidence;
  const confBadge =
    conf === 'high'   ? { cls: 'bg-green-50 text-omega-success', label: 'Clear' } :
    conf === 'medium' ? { cls: 'bg-amber-50 text-omega-warning', label: 'Partly faded' } :
    conf === 'low'    ? { cls: 'bg-red-50 text-red-600', label: 'Hard to read — check' } :
    null;

  const saveIcon =
    row.saveState === 'done'  ? <CheckCircle2 className="w-4 h-4 text-omega-success" /> :
    row.saveState === 'error' ? <AlertTriangle className="w-4 h-4 text-red-500" /> :
    row.saveState === 'saving'? <Loader2 className="w-4 h-4 animate-spin text-omega-info" /> :
    null;

  return (
    <div className={`bg-white rounded-2xl border ${row.include ? 'border-gray-200' : 'border-gray-100 opacity-60'} p-3 flex gap-4`}>
      {/* Thumbnail */}
      <button onClick={onZoom} className="flex-shrink-0 w-28 h-36 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 hover:border-omega-orange">
        {row.dataUrl
          ? <img src={row.dataUrl} alt={`Page ${row.pageNumber}`} className="w-full h-full object-cover" />
          : <ImageOff className="w-6 h-6 text-omega-stone m-auto" />}
      </button>

      {/* Fields */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-omega-charcoal">Page {row.pageNumber}</span>
          {row.scanState === 'scanning' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-omega-info"><Loader2 className="w-3 h-3 animate-spin" /> reading…</span>
          )}
          {confBadge && row.scanState === 'done' && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${confBadge.cls}`}>{confBadge.label}</span>
          )}
          {row.scanState === 'error' && (
            <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
              <AlertTriangle className="w-3 h-3" /> {row.scanError || 'read failed'}
              {!readonly && <button onClick={onRescan} className="underline ml-1">retry</button>}
            </span>
          )}
          {saveIcon && <span className="ml-auto inline-flex items-center gap-1 text-[11px]">{saveIcon}{row.saveError}</span>}
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          {/* Amount */}
          <div className="w-36">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-omega-stone mb-1">Amount</label>
            <div className="relative">
              <DollarSign className="w-3.5 h-3.5 text-omega-stone absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="number" inputMode="decimal" step="0.01" min="0"
                value={row.amount}
                disabled={readonly}
                onChange={(e) => onPatch({ amount: e.target.value })}
                placeholder="0.00"
                className="w-full pl-7 pr-2 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-sm font-semibold disabled:bg-gray-50"
              />
            </div>
          </div>

          {/* Description */}
          <div className="flex-1 min-w-[10rem]">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-omega-stone mb-1">Description (optional)</label>
            <input
              type="text"
              value={row.description}
              disabled={readonly}
              onChange={(e) => onPatch({ description: e.target.value })}
              placeholder="e.g. Lumber at Home Depot"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange focus:outline-none text-sm disabled:bg-gray-50"
            />
          </div>

          {/* Include toggle */}
          {!readonly && (
            <label className="inline-flex items-center gap-2 pb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(e) => onPatch({ include: e.target.checked })}
                className="w-4 h-4 accent-omega-orange"
              />
              <span className="text-xs font-semibold text-omega-charcoal">Include</span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-derive base64 from a kept Blob (used by per-row rescan).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
