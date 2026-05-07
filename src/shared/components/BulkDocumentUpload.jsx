// Bulk legacy document import. Renders at the bottom of DocumentsSection
// for operations + receptionist only. Designed for one-week migration of
// ~250 old client folders, not day-to-day use.
//
// Flow per file:
//   1. Upload to Supabase Storage (job-documents bucket).
//   2. Run AI classifier (filename → content fallback) to pick a folder.
//   3. Insert job_documents row with chosen folder.
//   4. Update progress bar; render report at the end.
//
// Files that bounce off the AI land in the 'other' folder so nothing is
// lost. The report flags them so Brenda can move them by hand if needed.

import { useEffect, useRef, useState } from 'react';
import {
  UploadCloud, X, Loader2, CheckCircle2, AlertTriangle, FolderInput, FileText,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import {
  classifyFile, FOLDER_LABELS, getCumulativeCost, COST_CAP_USD, isOverCap,
} from '../lib/documentClassifier';

const BUCKET = 'job-documents';

// Keep the storage filename safe across OSes / URLs.
function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Strip extension for the human-facing title.
function titleFromFilename(name) {
  return String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || name;
}

// If a doc already exists with the same title in the same folder, suffix
// "(1)", "(2)"... so we never overwrite. Set is built from the current
// docs list passed in.
function uniqueTitle(base, existingSet) {
  if (!existingSet.has(base.toLowerCase())) return base;
  let i = 1;
  while (existingSet.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}

export default function BulkDocumentUpload({ job, user, existingDocs, onUploaded }) {
  const [files, setFiles]       = useState([]);
  const [statuses, setStatuses] = useState([]); // parallel array w/ {state, folder, source, error}
  const [running, setRunning]   = useState(false);
  const [done, setDone]         = useState(false);
  const [costAtStart, setCostAtStart] = useState(0);
  const [costNow, setCostNow]   = useState(getCumulativeCost());
  const inputRef = useRef(null);

  // Refresh cost ticker once a second while running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setCostNow(getCumulativeCost()), 1000);
    return () => clearInterval(t);
  }, [running]);

  function pickFiles(e) {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setFiles(list);
    setStatuses(list.map(() => ({ state: 'pending' })));
    setDone(false);
  }

  function clearAll() {
    setFiles([]);
    setStatuses([]);
    setDone(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function processAll() {
    if (!files.length || running) return;
    setRunning(true);
    setDone(false);
    setCostAtStart(getCumulativeCost());

    // Build title-collision set from already-saved docs so we don't
    // overwrite existing files. Updated as we add new ones.
    const usedTitles = new Set(
      (existingDocs || []).map((d) => String(d.title || '').toLowerCase())
    );

    const newDocs = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Cost airbag.
      if (isOverCap()) {
        setStatuses((prev) => {
          const next = [...prev];
          for (let k = i; k < next.length; k++) {
            next[k] = { state: 'error', error: 'Cost cap reached — stopped' };
          }
          return next;
        });
        break;
      }

      setStatuses((prev) => {
        const next = [...prev];
        next[i] = { state: 'classifying' };
        return next;
      });

      let classification;
      try {
        classification = await classifyFile(file);
      } catch (err) {
        setStatuses((prev) => {
          const next = [...prev];
          next[i] = { state: 'error', error: err?.message || 'Classification failed' };
          return next;
        });
        if (err?.code === 'COST_CAP') break;
        continue;
      }

      const folder = classification.folder;
      setStatuses((prev) => {
        const next = [...prev];
        next[i] = { state: 'uploading', folder, source: classification.source, confidence: classification.confidence };
        return next;
      });

      try {
        const safe = sanitizeName(file.name);
        const path = `${job.id}/${folder}/${Date.now()}-${i}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            upsert: false,
            contentType: file.type || 'application/octet-stream',
          });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

        const baseTitle = titleFromFilename(file.name);
        const title = uniqueTitle(baseTitle, usedTitles);
        usedTitles.add(title.toLowerCase());

        const { data: row, error: insErr } = await supabase
          .from('job_documents')
          .insert([{
            job_id: job.id,
            folder,
            title,
            photo_url: pub?.publicUrl || null,
            uploaded_by: user?.name || null,
          }])
          .select()
          .single();
        if (insErr) throw insErr;

        newDocs.push(row);

        setStatuses((prev) => {
          const next = [...prev];
          next[i] = {
            state: 'done',
            folder,
            source: classification.source,
            confidence: classification.confidence,
          };
          return next;
        });
      } catch (err) {
        setStatuses((prev) => {
          const next = [...prev];
          next[i] = {
            state: 'error',
            folder,
            source: classification.source,
            error: err?.message || 'Upload failed',
          };
          return next;
        });
      }
    }

    setRunning(false);
    setDone(true);
    setCostNow(getCumulativeCost());

    if (newDocs.length) {
      logAudit({
        user,
        action: 'document.bulk_upload',
        entityType: 'job',
        entityId: job.id,
        details: {
          job_id: job.id,
          uploaded: newDocs.length,
          attempted: files.length,
        },
      });
      onUploaded?.(newDocs);
    }
  }

  // Counters for the progress bar + final report.
  const total = files.length;
  const uploaded = statuses.filter((s) => s?.state === 'done').length;
  const errored  = statuses.filter((s) => s?.state === 'error').length;
  const inFlight = statuses.filter((s) => s?.state === 'uploading' || s?.state === 'classifying').length;
  const processed = uploaded + errored;

  // Files routed to "other" or marked unclassified at AI layer.
  const reviewItems = statuses
    .map((s, i) => ({ s, file: files[i] }))
    .filter(({ s }) => s?.state === 'done' && (s.folder === 'other' || s.source === 'unclassified' || s.confidence === 'low'));

  const errorItems = statuses
    .map((s, i) => ({ s, file: files[i] }))
    .filter(({ s }) => s?.state === 'error');

  const sessionCost = Math.max(0, costNow - costAtStart);

  return (
    <div className="bg-white rounded-xl border border-dashed border-omega-orange/40 p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-omega-pale flex items-center justify-center flex-shrink-0">
          <FolderInput className="w-5 h-5 text-omega-orange" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-omega-charcoal">
            Bulk Upload <span className="text-[10px] font-bold text-omega-orange uppercase tracking-wider ml-1">Legacy migration</span>
          </h3>
          <p className="text-xs text-omega-stone mt-0.5">
            Pick a whole folder (or multiple files) and the AI will sort them into the
            categories above. Anything it cannot place lands in <strong>Other</strong> for review.
          </p>
        </div>
      </div>

      {/* File picker */}
      {!files.length && (
        <label className="flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed border-gray-300 hover:border-omega-orange hover:bg-omega-pale/30 cursor-pointer transition-colors">
          <UploadCloud className="w-8 h-8 text-omega-stone" />
          <span className="text-sm font-bold text-omega-charcoal">
            Choose folder or files
          </span>
          <span className="text-[11px] text-omega-stone">
            PDFs, images, videos, text — drop the whole client folder if you want
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            // webkitdirectory lets the user pick a folder; not all browsers
            // support it, but they fall back gracefully to multi-select.
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={pickFiles}
          />
        </label>
      )}

      {/* Plain multi-file alternative when picking individual files */}
      {!files.length && (
        <div className="mt-2 text-center">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-omega-orange font-semibold hover:underline cursor-pointer">
            …or pick individual files instead
            <input
              type="file"
              multiple
              className="hidden"
              onChange={pickFiles}
            />
          </label>
        </div>
      )}

      {/* Preview list + progress + report */}
      {files.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-omega-charcoal">
              {total} file{total === 1 ? '' : 's'} selected
              {running && <span className="text-omega-stone font-semibold ml-2">— processing {processed} of {total}…</span>}
              {done && (
                <span className="text-omega-stone font-semibold ml-2">
                  — done · ~${sessionCost.toFixed(3)} this run · ${costNow.toFixed(2)} total
                </span>
              )}
            </p>
            {!running && (
              <button
                onClick={clearAll}
                className="text-[11px] font-semibold text-omega-stone hover:text-red-600"
              >
                Clear
              </button>
            )}
          </div>

          {/* Progress bar */}
          {(running || done) && (
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
              <div
                className="h-full bg-omega-orange transition-all"
                style={{ width: total > 0 ? `${(processed / total) * 100}%` : '0%' }}
              />
            </div>
          )}

          {/* File status list */}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100 mb-3">
            {files.map((f, i) => {
              const s = statuses[i] || { state: 'pending' };
              return (
                <div key={i} className="px-3 py-2 flex items-center gap-2 text-xs">
                  <FileText className="w-3.5 h-3.5 text-omega-stone flex-shrink-0" />
                  <span className="flex-1 truncate font-mono text-[11px]" title={f.name}>{f.name}</span>
                  <StatusPill status={s} />
                </div>
              );
            })}
          </div>

          {/* Cost & cap warning */}
          {isOverCap() && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700">
              Cost cap of ${COST_CAP_USD} reached. Bulk upload paused. Reset from the dev console (<code>localStorage.setItem('omega_bulk_upload_cost_total','0')</code>) only if you understand the risk.
            </div>
          )}

          {/* Final report */}
          {done && (
            <div className="rounded-lg bg-omega-pale/40 border border-omega-orange/30 p-3 mb-3">
              <p className="text-sm font-bold text-omega-charcoal mb-1">
                You uploaded {total} file{total === 1 ? '' : 's'}.
              </p>
              <p className="text-xs text-omega-stone">
                <strong className="text-green-700">{uploaded - reviewItems.length}</strong> redistributed correctly.
                {reviewItems.length > 0 && (
                  <> <strong className="text-amber-700">{reviewItems.length}</strong> needed review (placed in Other or low confidence).</>
                )}
                {errored > 0 && <> <strong className="text-red-700">{errored}</strong> failed.</>}
              </p>

              {reviewItems.length > 0 && (
                <div className="mt-2 pt-2 border-t border-omega-orange/20">
                  <p className="text-[11px] font-bold text-omega-charcoal mb-1">Could not confidently classify:</p>
                  <ul className="text-[11px] text-omega-stone space-y-0.5">
                    {reviewItems.map(({ file, s }, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="font-mono truncate flex-1" title={file.name}>{file.name}</span>
                        <span className="text-omega-orange font-semibold">→ {FOLDER_LABELS[s.folder]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {errorItems.length > 0 && (
                <div className="mt-2 pt-2 border-t border-omega-orange/20">
                  <p className="text-[11px] font-bold text-red-700 mb-1">Failed:</p>
                  <ul className="text-[11px] text-red-700 space-y-0.5">
                    {errorItems.map(({ file, s }, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="font-mono truncate flex-1" title={file.name}>{file.name}</span>
                        <span className="font-semibold">— {s.error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {!done && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={clearAll}
                disabled={running}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={processAll}
                disabled={running || isOverCap()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-semibold"
              >
                {running ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                ) : (
                  <><UploadCloud className="w-4 h-4" /> Process &amp; classify</>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  if (!status || status.state === 'pending') {
    return <span className="text-[10px] text-omega-stone">queued</span>;
  }
  if (status.state === 'classifying') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700">
        <Loader2 className="w-3 h-3 animate-spin" /> classifying
      </span>
    );
  }
  if (status.state === 'uploading') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-omega-orange">
        <Loader2 className="w-3 h-3 animate-spin" /> uploading
      </span>
    );
  }
  if (status.state === 'done') {
    const isReview = status.folder === 'other' || status.confidence === 'low';
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${isReview ? 'text-amber-700' : 'text-green-700'}`}>
        {isReview ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
        → {FOLDER_LABELS[status.folder]}
      </span>
    );
  }
  if (status.state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700" title={status.error}>
        <X className="w-3 h-3" /> error
      </span>
    );
  }
  return null;
}
