// Legacy Files Importer — admin tool to bulk-organize old client
// folders into the right job cards.
//
// Workflow:
//   1. Admin picks a PARENT folder. Subfolders are expected to be
//      named "First Last" (one per client).
//   2. We read every file using the directory picker
//      (<input webkitdirectory>) and group by first-level subfolder.
//   3. Each subfolder is matched against `jobs.client_name` using a
//      normalized token-overlap score. Auto-match for the unambiguous
//      cases; manual dropdown override for the ambiguous / unmatched.
//   4. On "Run Import" we run the same AI classifier the per-card
//      BulkDocumentUpload uses, dropping each file into its right
//      Documents folder (estimates → Estimates, invoices → Invoices,
//      contracts → Contracts, …). Anything the AI cannot place lands
//      in `other` so nothing is lost.
//   5. Audit row per uploaded file. Permanent tool — not one-shot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderInput, Upload, Loader2, CheckCircle2, AlertTriangle, Folder,
  ChevronRight, RefreshCw, FileText, Users, X, ArrowRight, UserPlus,
} from 'lucide-react';

// Sentinel value used in the per-group dropdown to mean "create a
// brand-new job for this client from the folder name". The actual
// jobs.id is filled in at run time, just before the file uploads.
const CREATE_NEW = '__create_new__';
import { supabase } from '../../../shared/lib/supabase';
import { logAudit } from '../../../shared/lib/audit';
import {
  classifyFile, FOLDER_LABELS, getCumulativeCost, COST_CAP_USD, isOverCap,
} from '../../../shared/lib/documentClassifier';

const BUCKET = 'job-documents';

// ─── Helpers ──────────────────────────────────────────────────────
function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}
function titleFromFilename(name) {
  return String(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || name;
}
function uniqueTitle(base, existingSet) {
  if (!existingSet.has(base.toLowerCase())) return base;
  let i = 1;
  while (existingSet.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}
function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

// Normalize a client/folder name for matching:
//   * lowercase
//   * strip accents (NFD)
//   * comma/semicolon → space (handles "Resmo, Roman")
//   * any non-alphanumeric → space
//   * collapse whitespace
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[,;]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenSet(s) {
  const norm = normalize(s);
  if (!norm) return new Set();
  return new Set(norm.split(' ').filter((t) => t.length >= 2));
}

function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let intersect = 0;
  aSet.forEach((t) => { if (bSet.has(t)) intersect += 1; });
  return intersect / (aSet.size + bSet.size - intersect);
}

// Pick the best matching job for a folder name. Returns:
//   { match: <jobRow|null>, candidates: [{job, score}], ambiguous: bool }
// "Auto-match" is reserved for exact-normalized matches with a single
// hit and for token Jaccard >= 0.75 with a clear lead over runner-up.
function matchJobForFolder(folderName, jobs) {
  const folderNorm   = normalize(folderName);
  const folderTokens = tokenSet(folderName);
  if (!folderNorm) return { match: null, candidates: [], ambiguous: false };

  // Pass 1 — exact normalized client_name match.
  const exact = jobs.filter((j) => normalize(j.client_name || '') === folderNorm);
  if (exact.length === 1) return { match: exact[0], candidates: [{ job: exact[0], score: 1 }], ambiguous: false };
  if (exact.length > 1)   return { match: null, candidates: exact.map((j) => ({ job: j, score: 1 })), ambiguous: true };

  // Pass 2 — token overlap on client_name.
  const scored = jobs
    .map((j) => ({ job: j, score: jaccard(folderTokens, tokenSet(j.client_name || '')) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { match: null, candidates: [], ambiguous: false };

  const top = scored[0];
  const runner = scored[1];

  // Strong lead → auto-match. Otherwise let the admin choose.
  if (top.score >= 0.75 && (!runner || top.score - runner.score >= 0.2)) {
    return { match: top.job, candidates: scored.slice(0, 5), ambiguous: false };
  }
  return { match: null, candidates: scored.slice(0, 5), ambiguous: true };
}

// Convert a flat FileList from `webkitdirectory` into:
//   [ { folder: "Roman Resmo", files: [File, File, …] }, … ]
// Only first-level subfolders count — anything deeper is flattened
// under that subfolder (so a "Roman Resmo/2023/invoice.pdf" still
// lands under "Roman Resmo").
function groupFilesByTopFolder(fileList) {
  const groups = new Map();
  for (const f of fileList) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    // parts[0] is the root pasta name (the one the admin picked).
    // We want parts[1] (the per-client subfolder). If a file is at
    // root level (no subfolder), skip it — the admin expects 1 layer.
    if (parts.length < 3) continue;
    const folder = parts[1];
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(f);
  }
  return Array.from(groups.entries())
    .map(([folder, files]) => ({ folder, files }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

// ─── Screen ───────────────────────────────────────────────────────
export default function LegacyFilesImporter({ user }) {
  const [phase, setPhase] = useState('idle'); // 'idle' | 'review' | 'running' | 'done'
  const [jobs, setJobs]   = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [groups, setGroups] = useState([]); // [{ folder, files, jobId, candidates, status, fileStatuses, ambiguous }]
  const [costAtStart, setCostAtStart] = useState(0);
  const [costNow, setCostNow] = useState(getCumulativeCost());
  const inputRef = useRef(null);

  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => setCostNow(getCumulativeCost()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Load all jobs once. We pull just the fields needed for matching +
  // the dropdown — the full row isn't necessary here.
  async function reloadJobs() {
    setLoadingJobs(true);
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, client_name, address, city, service, pipeline_status')
        .order('client_name', { ascending: true });
      if (error) throw error;
      setJobs(data || []);
    } finally {
      setLoadingJobs(false);
    }
  }
  useEffect(() => { reloadJobs(); }, []);

  // Callback ref — sets `webkitdirectory` + `directory` the moment the
  // <input> mounts. A regular useEffect doesn't work here because the
  // input only renders after the jobs list finishes loading, which
  // happens AFTER the mount effect already ran with a null ref.
  const setInputRef = useCallback((el) => {
    inputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
      el.setAttribute('mozdirectory', '');
    }
  }, []);

  // Directory picker → grouped → matched.
  function onFolderPicked(e) {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;

    const grouped = groupFilesByTopFolder(fileList);
    const enriched = grouped.map((g) => {
      const { match, candidates, ambiguous } = matchJobForFolder(g.folder, jobs);
      // Default behavior:
      //   * Matched          → jobId = matched job's id
      //   * Ambiguous (>1)   → empty (admin must pick from suggestions)
      //   * No candidates    → CREATE_NEW (we'll auto-create the client)
      let defaultJobId = '';
      if (match) defaultJobId = match.id;
      else if (candidates.length === 0) defaultJobId = CREATE_NEW;
      return {
        ...g,
        jobId: defaultJobId,
        candidates,
        ambiguous: ambiguous || (!match && candidates.length > 0),
        fileStatuses: g.files.map(() => ({ state: 'pending' })),
      };
    });
    setGroups(enriched);
    setPhase('review');
  }

  function reset() {
    setGroups([]);
    setPhase('idle');
    if (inputRef.current) inputRef.current.value = '';
  }

  function setGroupJobId(folderName, jobId) {
    setGroups((prev) => prev.map((g) =>
      g.folder === folderName ? { ...g, jobId, ambiguous: false } : g
    ));
  }

  // Uploads + classifies every file across every group, sequentially
  // so the cost cap can short-circuit mid-run without leaving half a
  // group orphaned. Each file gets its own status entry so the UI can
  // show per-file progress.
  async function runImport() {
    if (phase === 'running') return;
    setPhase('running');
    setCostAtStart(getCumulativeCost());

    const updateFile = (folderName, fileIdx, patch) => {
      setGroups((prev) => prev.map((g) => {
        if (g.folder !== folderName) return g;
        const next = [...g.fileStatuses];
        next[fileIdx] = { ...next[fileIdx], ...patch };
        return { ...g, fileStatuses: next };
      }));
    };

    let totalUploaded = 0;
    let totalErrored  = 0;
    let totalCreated  = 0;
    let stopped       = false;

    for (const group of groups) {
      if (stopped) break;
      if (!group.jobId) {
        // Skipped on purpose — no job mapped.
        for (let i = 0; i < group.files.length; i++) {
          updateFile(group.folder, i, { state: 'skipped' });
        }
        continue;
      }

      // Resolve the target job. If the admin asked to create a new
      // client from this folder name, insert the row first and use
      // its id for the upload loop below.
      let resolvedJobId = group.jobId;
      if (resolvedJobId === CREATE_NEW) {
        try {
          const { data: newJob, error: createErr } = await supabase
            .from('jobs')
            .insert([{
              client_name: group.folder.trim(),
              // Legacy archive — hide from the live pipeline and mark
              // as completed so it doesn't pollute Attila's kanban.
              // Brenda can re-classify later by editing the card.
              in_pipeline: false,
              pipeline_status: 'completed',
              status: 'completed',
              created_by: 'legacy_import',
            }])
            .select('id, client_name')
            .single();
          if (createErr) throw createErr;
          resolvedJobId = newJob.id;
          totalCreated += 1;
          logAudit({
            user,
            action: 'job.create',
            entityType: 'job',
            entityId: newJob.id,
            details: { source: 'legacy_import', client_name: newJob.client_name },
          });
          // Persist the new id back into the group so the report
          // renders the right client name afterwards.
          setGroups((prev) => prev.map((gg) =>
            gg.folder === group.folder ? { ...gg, jobId: newJob.id, createdFromImport: true } : gg
          ));
          // Keep the new job in the local jobs cache so the report row
          // (which looks up client_name by id) finds it.
          setJobs((prev) => [...prev, { id: newJob.id, client_name: newJob.client_name, address: null, city: null, service: null, pipeline_status: 'completed' }]);
        } catch (err) {
          // If creation fails, skip the group and mark every file as
          // errored so the admin sees what happened.
          for (let i = 0; i < group.files.length; i++) {
            updateFile(group.folder, i, { state: 'error', error: `Could not create client: ${err.message || err}` });
            totalErrored += 1;
          }
          continue;
        }
      }

      // Title-collision set, scoped per job. We pre-load the existing
      // titles so we don't overwrite older docs.
      const { data: existing } = await supabase
        .from('job_documents')
        .select('title')
        .eq('job_id', resolvedJobId);
      const usedTitles = new Set((existing || []).map((d) => String(d.title || '').toLowerCase()));

      for (let i = 0; i < group.files.length; i++) {
        const file = group.files[i];

        if (isOverCap()) {
          updateFile(group.folder, i, { state: 'error', error: 'Cost cap reached — stopped' });
          for (let k = i + 1; k < group.files.length; k++) {
            updateFile(group.folder, k, { state: 'error', error: 'Cost cap reached — stopped' });
          }
          stopped = true;
          break;
        }

        updateFile(group.folder, i, { state: 'classifying' });

        let classification;
        try {
          classification = await classifyFile(file);
        } catch (err) {
          updateFile(group.folder, i, { state: 'error', error: err?.message || 'Classification failed' });
          totalErrored += 1;
          if (err?.code === 'COST_CAP') { stopped = true; break; }
          continue;
        }

        const folder = classification.folder;
        updateFile(group.folder, i, { state: 'uploading', folder, source: classification.source, confidence: classification.confidence });

        try {
          const safe = sanitizeName(file.name);
          const path = `${resolvedJobId}/${folder}/${Date.now()}-${i}-${safe}`;
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
              job_id: resolvedJobId,
              folder,
              title,
              photo_url: pub?.publicUrl || null,
              uploaded_by: user?.name || null,
            }])
            .select()
            .single();
          if (insErr) throw insErr;

          updateFile(group.folder, i, {
            state: 'done',
            folder,
            source: classification.source,
            confidence: classification.confidence,
            docId: row.id,
          });
          totalUploaded += 1;
        } catch (err) {
          updateFile(group.folder, i, {
            state: 'error',
            folder,
            source: classification.source,
            error: err?.message || 'Upload failed',
          });
          totalErrored += 1;
        }
      }
    }

    logAudit({
      user,
      action: 'document.legacy_bulk_import',
      entityType: 'admin',
      entityId: null,
      details: {
        groupsAttempted: groups.length,
        groupsMatched: groups.filter((g) => g.jobId && g.jobId !== CREATE_NEW).length,
        clientsCreated: totalCreated,
        uploaded: totalUploaded,
        errored: totalErrored,
        stoppedAtCap: stopped,
      },
    });

    setPhase('done');
    setCostNow(getCumulativeCost());
  }

  // ─── Aggregates for the header ──────────────────────────────────
  const totals = useMemo(() => {
    const fileCount = groups.reduce((s, g) => s + g.files.length, 0);
    const matchedGroups   = groups.filter((g) => g.jobId && g.jobId !== CREATE_NEW).length;
    const willCreateGroups = groups.filter((g) => g.jobId === CREATE_NEW).length;
    const skippedGroups   = groups.filter((g) => !g.jobId).length;
    return { fileCount, matchedGroups, willCreateGroups, skippedGroups };
  }, [groups]);

  const allFileStatuses = useMemo(
    () => groups.flatMap((g) => g.fileStatuses),
    [groups]
  );
  const uploaded = allFileStatuses.filter((s) => s?.state === 'done').length;
  const errored  = allFileStatuses.filter((s) => s?.state === 'error').length;
  const inFlight = allFileStatuses.filter((s) => s?.state === 'uploading' || s?.state === 'classifying').length;
  const processed = uploaded + errored;

  const sessionCost = Math.max(0, costNow - costAtStart);

  return (
    <div className="flex-1 overflow-auto bg-omega-cloud">
      {/* Mounted unconditionally so the directory-picker attributes are
          applied long before the user clicks Choose folder. Keeping it
          inside the conditional caused the dialog to open in file-mode
          on first load because the ref wasn't set yet. */}
      <input
        ref={setInputRef}
        type="file"
        // eslint-disable-next-line react/no-unknown-property
        webkitdirectory=""
        // eslint-disable-next-line react/no-unknown-property
        directory=""
        multiple
        hidden
        onChange={onFolderPicked}
      />
      <header className="px-6 md:px-8 py-5 bg-white border-b border-gray-200 sticky top-0 z-10">
        <h1 className="text-xl font-bold text-omega-charcoal flex items-center gap-2">
          <FolderInput className="w-5 h-5 text-omega-orange" /> Legacy Files Importer
        </h1>
        <p className="text-sm text-omega-stone mt-1">
          Drop a parent folder with one subfolder per client (named &quot;First Last&quot;) and the AI
          sorts every file into the right Documents tab.
        </p>
      </header>

      <div className="p-6 md:p-8 space-y-6">
        {/* ─── PHASE: idle ── pick folder ── */}
        {phase === 'idle' && (
          <section className="bg-white rounded-2xl border border-dashed border-omega-orange/40 p-8 text-center">
            {loadingJobs ? (
              <div className="flex items-center justify-center gap-2 text-omega-stone">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading clients…
              </div>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-omega-pale flex items-center justify-center mx-auto mb-4">
                  <FolderInput className="w-7 h-7 text-omega-orange" />
                </div>
                <h2 className="text-lg font-bold text-omega-charcoal mb-1">Pick a folder to import</h2>
                <p className="text-sm text-omega-stone mb-5 max-w-md mx-auto">
                  Expected layout:
                </p>
                <pre className="text-left text-xs bg-omega-cloud rounded-xl p-4 max-w-md mx-auto mb-5 leading-relaxed">
{`OldFiles/
├── Roman Resmo/
│   ├── invoice.pdf
│   └── building-plans.pdf
├── Anthony Wills/
│   └── contract-signed.pdf
└── …`}
                </pre>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold"
                  >
                    <FolderInput className="w-4 h-4" /> Choose folder
                  </button>
                  <button
                    onClick={reloadJobs}
                    className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-omega-stone hover:bg-gray-100 text-xs font-semibold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reload clients ({jobs.length})
                  </button>
                </div>
                <p className="text-[11px] text-omega-stone mt-3">
                  Works in Chrome / Edge — uses the directory picker API.
                </p>
              </>
            )}
          </section>
        )}

        {/* ─── PHASE: review ── match folders → jobs ── */}
        {phase === 'review' && (
          <>
            <SummaryStrip
              totalGroups={groups.length}
              matchedGroups={totals.matchedGroups}
              willCreateGroups={totals.willCreateGroups}
              skippedGroups={totals.skippedGroups}
              fileCount={totals.fileCount}
            />

            <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h2 className="text-base font-bold text-omega-charcoal">Review matches</h2>
                  <p className="text-xs text-omega-stone mt-0.5">
                    Auto-matched rows are green. Pick the right client for any orange row before running.
                    Anything left as &quot;Skip&quot; will be ignored.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={reset} className="text-xs font-semibold text-omega-stone hover:text-omega-charcoal px-3 py-2 rounded-lg hover:bg-gray-100">
                    <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Cancel
                  </button>
                  <button
                    onClick={runImport}
                    disabled={(totals.matchedGroups + totals.willCreateGroups) === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-4 h-4" />
                    Run import ({totals.matchedGroups + totals.willCreateGroups} client{(totals.matchedGroups + totals.willCreateGroups) === 1 ? '' : 's'}
                    {totals.willCreateGroups > 0 ? `, ${totals.willCreateGroups} new` : ''})
                  </button>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {groups.map((g) => (
                  <GroupRow
                    key={g.folder}
                    group={g}
                    jobs={jobs}
                    onSetJob={(jobId) => setGroupJobId(g.folder, jobId)}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {/* ─── PHASE: running / done ── progress + report ── */}
        {(phase === 'running' || phase === 'done') && (
          <>
            <ProgressStrip
              total={totals.fileCount}
              processed={processed}
              uploaded={uploaded}
              errored={errored}
              inFlight={inFlight}
              sessionCost={sessionCost}
              isDone={phase === 'done'}
            />

            <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-base font-bold text-omega-charcoal">
                  {phase === 'done' ? 'Import complete' : 'Importing…'}
                </h2>
                {phase === 'done' && (
                  <button
                    onClick={reset}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 hover:border-omega-orange text-xs font-semibold text-omega-charcoal"
                  >
                    <FolderInput className="w-3.5 h-3.5" /> Import another folder
                  </button>
                )}
              </div>

              <div className="divide-y divide-gray-100">
                {groups.map((g) => (
                  <GroupRunReport key={g.folder} group={g} jobs={jobs} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────
function SummaryStrip({ totalGroups, matchedGroups, willCreateGroups, skippedGroups, fileCount }) {
  return (
    <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Stat label="Subfolders" value={totalGroups} />
      <Stat label="Matched" value={matchedGroups} accent="success" />
      <Stat label="Will create" value={willCreateGroups} accent={willCreateGroups > 0 ? 'info' : null} />
      <Stat label="Skipped" value={skippedGroups} accent={skippedGroups > 0 ? 'warn' : null} />
      <Stat label="Files" value={fileCount} />
    </section>
  );
}

function ProgressStrip({ total, processed, uploaded, errored, inFlight, sessionCost, isDone }) {
  const pct = total ? Math.round((processed / total) * 100) : 0;
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <p className="text-xs text-omega-stone uppercase font-semibold tracking-wider">
            {isDone ? 'Result' : 'Progress'}
          </p>
          <p className="text-lg font-bold text-omega-charcoal mt-0.5">
            {uploaded} uploaded · {errored} errored
            {inFlight > 0 && <> · <span className="text-omega-info">{inFlight} in flight</span></>}
          </p>
        </div>
        <div className="text-xs text-omega-stone">
          AI cost this run: <span className="font-mono">{fmtUsd(sessionCost)}</span>
          <span className="text-gray-400"> · cap {fmtUsd(COST_CAP_USD)}</span>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-omega-cloud overflow-hidden">
        <div className="h-full bg-omega-orange transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-omega-stone mt-2">
        {processed} of {total} files ({pct}%)
      </p>
    </section>
  );
}

function Stat({ label, value, accent }) {
  const color =
    accent === 'success' ? 'text-omega-success' :
    accent === 'warn'    ? 'text-omega-warning' :
    accent === 'info'    ? 'text-omega-info' :
    'text-omega-charcoal';
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[10px] text-omega-stone uppercase font-semibold tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function GroupRow({ group, jobs, onSetJob }) {
  const willCreate = group.jobId === CREATE_NEW;
  const matched = !!group.jobId && !willCreate;
  const matchedJob = matched ? jobs.find((j) => j.id === group.jobId) : null;

  return (
    <div className={`px-5 py-4 ${group.ambiguous && !matched && !willCreate ? 'bg-amber-50/40' : ''}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-omega-charcoal">
            <Folder className="w-4 h-4 text-omega-stone" />
            <span className="truncate">{group.folder}</span>
            <span className="text-xs text-omega-stone font-normal">· {group.files.length} file{group.files.length === 1 ? '' : 's'}</span>
          </div>
          {/* Suggestion preview */}
          {group.candidates.length > 0 && !matched && (
            <p className="text-xs text-omega-stone mt-1 ml-6">
              Suggestions: {group.candidates.slice(0, 3).map((c, i) => (
                <span key={c.job.id}>
                  {i > 0 && ', '}
                  <button
                    onClick={() => onSetJob(c.job.id)}
                    className="text-omega-info hover:underline font-medium"
                  >
                    {c.job.client_name}
                  </button>
                  <span className="text-gray-400"> ({Math.round(c.score * 100)}%)</span>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {matched ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-omega-success px-2 py-1 rounded-full bg-green-50">
              <CheckCircle2 className="w-3.5 h-3.5" /> Matched
            </span>
          ) : willCreate ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-omega-info px-2 py-1 rounded-full bg-blue-50">
              <UserPlus className="w-3.5 h-3.5" /> Will create
            </span>
          ) : group.ambiguous ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-omega-warning px-2 py-1 rounded-full bg-amber-50">
              <AlertTriangle className="w-3.5 h-3.5" /> Needs review
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-omega-stone px-2 py-1 rounded-full bg-gray-100">
              No match
            </span>
          )}

          <select
            value={group.jobId}
            onChange={(e) => onSetJob(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-omega-orange min-w-[14rem]"
          >
            <option value={CREATE_NEW}>+ Create new client &quot;{group.folder}&quot;</option>
            <option value="">Skip — don&apos;t import this folder</option>
            <option disabled>──────────</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.client_name || '(no name)'}
                {j.address ? ` — ${j.address}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mini file list */}
      <ul className="mt-3 ml-6 text-xs text-omega-stone space-y-0.5 max-h-24 overflow-y-auto">
        {group.files.map((f, idx) => (
          <li key={idx} className="flex items-center gap-1.5 truncate">
            <FileText className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{f.name}</span>
          </li>
        ))}
      </ul>

      {matchedJob && (
        <p className="text-[11px] text-omega-stone mt-2 ml-6 flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> Will land in <strong className="text-omega-charcoal mx-1">{matchedJob.client_name}</strong>
          {matchedJob.address && <span className="text-gray-400">— {matchedJob.address}</span>}
        </p>
      )}
      {willCreate && (
        <p className="text-[11px] text-omega-info mt-2 ml-6 flex items-center gap-1">
          <UserPlus className="w-3 h-3" /> A new client card will be created for <strong className="mx-1">{group.folder}</strong>
          <span className="text-gray-400">— marked as Completed, hidden from the pipeline.</span>
        </p>
      )}
    </div>
  );
}

function GroupRunReport({ group, jobs }) {
  const matchedJob = jobs.find((j) => j.id === group.jobId);
  if (!group.jobId) {
    return (
      <div className="px-5 py-3 text-sm text-omega-stone flex items-center gap-2">
        <Folder className="w-4 h-4" /> <strong>{group.folder}</strong> · skipped ({group.files.length} file{group.files.length === 1 ? '' : 's'})
      </div>
    );
  }
  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-omega-charcoal mb-1 flex-wrap">
        <Folder className="w-4 h-4 text-omega-stone" />
        <span>{group.folder}</span>
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="text-omega-info">{matchedJob?.client_name || group.folder}</span>
        {group.createdFromImport && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-omega-info bg-blue-50 px-1.5 py-0.5 rounded">
            <UserPlus className="w-3 h-3" /> New
          </span>
        )}
      </div>
      <ul className="ml-6 text-xs space-y-0.5">
        {group.files.map((f, idx) => {
          const s = group.fileStatuses[idx] || { state: 'pending' };
          return (
            <li key={idx} className="flex items-center gap-2 truncate">
              <FileStatusIcon state={s.state} />
              <span className="truncate flex-1">{f.name}</span>
              {s.folder && (
                <span className="text-[10px] uppercase tracking-wider text-omega-stone whitespace-nowrap">
                  → {FOLDER_LABELS[s.folder] || s.folder}
                </span>
              )}
              {s.error && (
                <span className="text-[10px] text-red-600 truncate max-w-[14rem]" title={s.error}>{s.error}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileStatusIcon({ state }) {
  switch (state) {
    case 'done':        return <CheckCircle2 className="w-3.5 h-3.5 text-omega-success flex-shrink-0" />;
    case 'error':       return <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
    case 'classifying': return <Loader2 className="w-3.5 h-3.5 animate-spin text-omega-stone flex-shrink-0" />;
    case 'uploading':   return <Loader2 className="w-3.5 h-3.5 animate-spin text-omega-info flex-shrink-0" />;
    case 'skipped':     return <X className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />;
    default:            return <div className="w-3.5 h-3.5 rounded-full border border-gray-300 flex-shrink-0" />;
  }
}
