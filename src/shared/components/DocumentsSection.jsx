import { useEffect, useState } from 'react';
import {
  FileText, FileSignature, FileBadge, Home, CheckSquare, Receipt,
  Plus, X, Save, Loader2, AlertCircle, ImageIcon, ExternalLink, Trash2, Mic,
  DollarSign, Layers,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import VoiceNoteRecorder from './VoiceNoteRecorder';

// Status chip palette shared with the Sales Estimates screen — keeps the
// same verb the customer and sellers see in the lifecycle.
const ESTIMATE_STATUS_META = {
  draft:              { label: 'DRAFT',        cls: 'bg-gray-200 text-gray-700' },
  sent:               { label: 'SENT',         cls: 'bg-blue-100 text-blue-700' },
  negotiating:        { label: 'NEGOTIATING',  cls: 'bg-amber-100 text-amber-800' },
  changes_requested:  { label: 'CHANGES',      cls: 'bg-amber-100 text-amber-800' },
  approved:           { label: 'APPROVED',     cls: 'bg-green-100 text-green-800' },
  rejected:           { label: 'REJECTED',     cls: 'bg-red-100 text-red-700' },
  signed:             { label: 'SIGNED',       cls: 'bg-emerald-600 text-white' },
};

function money(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtEstimateNumber(n) {
  if (n == null || n === '') return 'Estimate';
  return `OM-${n}`;
}

const BUCKET = 'job-documents';

// Six canonical folders (value = column value in the DB; label = UI).
// Icons chosen to hint at the document type at a glance.
const FOLDERS = [
  { id: 'invoices',       label: 'Invoices',       icon: Receipt         },
  { id: 'receipts',       label: 'Receipts',       icon: Receipt         },
  { id: 'permits',        label: 'Permits',        icon: FileBadge       },
  { id: 'building_plans', label: 'Building Plans', icon: Home            },
  { id: 'checks',         label: 'Checks',         icon: CheckSquare     },
  { id: 'contracts',      label: 'Contracts',      icon: FileSignature   },
  { id: 'change_orders',  label: 'Change Orders',  icon: FileText        },
  // Auto-populated from NativeProjectChat uploads (sprint 5). Users
  // typically don't add to this folder manually — they just chat.
  { id: 'daily_logs',     label: 'Daily Logs Media', icon: ImageIcon     },
];

const CAN_DELETE_ESTIMATE = new Set(['owner', 'operations', 'admin']);

export default function DocumentsSection({ job, user, onJobUpdated }) {
  const [docs, setDocs]           = useState([]);
  const [estimates, setEstimates] = useState([]);   // all estimates for this job (any group)
  const [notes, setNotes]         = useState([]);   // growing list (job_notes rows)
  const [loading, setLoading]     = useState(true);
  const [addingTo, setAddingTo]   = useState(null);  // folder id or null
  const [newNote, setNewNote]     = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [viewer, setViewer]       = useState(null);
  const [pendingDeleteEstId, setPendingDeleteEstId] = useState(null);

  useEffect(() => {
    if (!job?.id) return;
    loadDocs();
    loadEstimates();
    loadNotes();
    // eslint-disable-next-line
  }, [job?.id]);

  async function loadEstimates() {
    try {
      // Intentionally select('*') so pending migrations (e.g. signed_date
      // from 018) don't break the whole folder — PostgREST would reject
      // an explicit column list if any referenced column is missing.
      const { data } = await supabase
        .from('estimates')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });
      setEstimates(data || []);
    } catch {
      setEstimates([]);
    }
  }

  async function loadDocs() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('job_documents')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });
      setDocs(data || []);
    } catch { setDocs([]); }
    setLoading(false);
  }

  async function loadNotes() {
    try {
      const { data } = await supabase
        .from('job_notes')
        .select('*')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false });
      setNotes(data || []);
    } catch { setNotes([]); }
  }

  async function addNote(opts = {}) {
    const body = (opts.overrideBody ?? newNote).trim();
    if (!body) return;
    setSavingNote(true);
    setNoteError('');
    try {
      const row = {
        job_id: job.id,
        body,
        author_name: user?.name || null,
        author_role: user?.role || null,
      };
      if (opts.source) row.source = opts.source;  // 'voice' | 'typed'
      const { data, error } = await supabase.from('job_notes').insert([row]).select().single();
      if (error) throw error;
      setNotes((prev) => [data, ...prev]);
      if (!opts.overrideBody) setNewNote('');
      logAudit({
        user, action: 'job.note.create', entityType: 'job_note', entityId: data.id,
        details: { job_id: job.id, source: opts.source || 'typed' },
      });
    } catch (err) {
      setNoteError(err.message || 'Failed to save note');
    }
    setSavingNote(false);
  }

  async function deleteNote(note) {
    if (!confirm('Delete this note?')) return;
    try {
      await supabase.from('job_notes').delete().eq('id', note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      logAudit({ user, action: 'job.note.delete', entityType: 'job_note', entityId: note.id });
    } catch { /* ignore */ }
  }

  async function deleteEstimate(est) {
    if (pendingDeleteEstId !== est.id) { setPendingDeleteEstId(est.id); return; }
    setPendingDeleteEstId(null);
    try {
      await supabase.from('estimates').delete().eq('id', est.id);
      setEstimates((prev) => prev.filter((e) => e.id !== est.id));
      logAudit({ user, action: 'estimate.delete', entityType: 'estimate', entityId: est.id, details: { estimate_number: est.estimate_number } });
    } catch { /* ignore */ }
  }

  async function deleteDoc(doc) {
    if (!confirm(`Delete document "${doc.title}"?`)) return;
    try {
      await supabase.from('job_documents').delete().eq('id', doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      logAudit({ user, action: 'document.delete', entityType: 'job_document', entityId: doc.id, details: { folder: doc.folder, title: doc.title } });
    } catch { /* ignore */ }
  }

  const byFolder = FOLDERS.map((f) => ({
    ...f,
    items: docs.filter((d) => d.folder === f.id),
  }));

  // Group estimates by group_id so alternatives stay together, with
  // groups ordered by most-recent activity (sent_at or created_at).
  const estimateGroups = (() => {
    const byGroup = new Map();
    for (const est of estimates) {
      const gid = est.group_id || est.id;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(est);
    }
    const arr = [...byGroup.entries()].map(([gid, rows]) => {
      const sorted = [...rows].sort((a, b) => (a.option_order || 0) - (b.option_order || 0));
      const anchor = sorted.reduce((acc, r) => {
        const t = new Date(r.sent_at || r.created_at).getTime();
        return t > acc ? t : acc;
      }, 0);
      return { gid, rows: sorted, anchor };
    });
    arr.sort((a, b) => b.anchor - a.anchor);
    return arr;
  })();

  return (
    <div className="space-y-5">
      {/* Estimates — one row per row, grouped by proposal (group_id). A
          lone estimate renders as a single-row group; alternatives sit
          together under an "Option N of M" chip so the audit trail is
          obvious: what was sent, what the customer rejected, what was
          signed. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-omega-pale flex items-center justify-center">
            <DollarSign className="w-4 h-4 text-omega-orange" />
          </div>
          <h3 className="text-sm font-bold text-omega-charcoal flex-1">Estimates</h3>
          <span className="text-[10px] font-bold text-omega-stone bg-gray-100 px-2 py-0.5 rounded-full">
            {estimates.length}
          </span>
        </div>
        {estimates.length === 0 && (
          <p className="px-4 py-5 text-xs text-omega-stone italic text-center">
            No estimates have been created for this job yet.
          </p>
        )}
        {estimateGroups.map(({ gid, rows }) => (
          <div key={gid} className={rows.length > 1 ? 'bg-omega-pale/30 border-l-4 border-omega-orange' : ''}>
            {rows.length > 1 && (
              <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-omega-orange">
                <Layers className="w-3 h-3" /> Proposal with {rows.length} options
              </div>
            )}
            {rows.map((est, i) => {
              const meta = ESTIMATE_STATUS_META[est.status] || { label: (est.status || 'DRAFT').toUpperCase(), cls: 'bg-gray-200 text-gray-700' };
              const isMulti = rows.length > 1;
              const link = est.pdf_url
                || (isMulti
                  ? `/estimate-options/${gid}`
                  : `/estimate-view/${est.id}`);
              return (
                <div
                  key={est.id}
                  className="px-4 py-3 border-t border-gray-100 flex items-center gap-3 hover:bg-white group first:border-t-0"
                >
                  <div className="w-10 h-10 rounded-lg bg-omega-pale flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-omega-orange" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-omega-charcoal">
                        {fmtEstimateNumber(est.estimate_number)}
                      </p>
                      {isMulti && (
                        <span className="text-[10px] font-bold text-white bg-omega-orange px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Option {i + 1} of {rows.length}
                          {est.option_label ? ` · ${est.option_label}` : ''}
                        </span>
                      )}
                      <span className={`flex-shrink-0 inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-omega-stone mt-0.5">
                      {est.signed_at
                        ? <>Signed by <strong>{est.signed_by || 'client'}</strong> · {(() => {
                            if (est.signed_date) {
                              const [y, m, d] = est.signed_date.split('-').map(Number);
                              const local = new Date(y, m - 1, d);
                              if (!isNaN(local.getTime())) return local.toLocaleDateString();
                            }
                            return new Date(est.signed_at).toLocaleDateString();
                          })()}</>
                        : est.sent_at
                          ? <>Sent {new Date(est.sent_at).toLocaleDateString()}</>
                          : <>Created {new Date(est.created_at).toLocaleDateString()}</>
                      }
                    </p>
                  </div>
                  <p className="text-sm font-black text-omega-charcoal tabular-nums flex-shrink-0">
                    {money(est.total_amount)}
                  </p>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-omega-stone hover:text-omega-orange flex-shrink-0"
                    title="Open the estimate the client saw"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  {CAN_DELETE_ESTIMATE.has(user?.role) && !est.signed_at && (
                    <button
                      onClick={() => deleteEstimate(est)}
                      className={`flex-shrink-0 transition-colors ${
                        pendingDeleteEstId === est.id
                          ? 'text-red-600'
                          : 'text-omega-stone hover:text-red-600 opacity-0 group-hover:opacity-100'
                      }`}
                      title={pendingDeleteEstId === est.id ? 'Click again to confirm deletion' : 'Delete estimate'}
                    >
                      {pendingDeleteEstId === est.id
                        ? <span className="text-[11px] font-bold">Sure?</span>
                        : <Trash2 className="w-4 h-4" />
                      }
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Folders grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {byFolder.map((f) => {
          const Icon = f.icon;
          const isAdding = addingTo === f.id;
          return (
            <div key={f.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-omega-pale flex items-center justify-center">
                  <Icon className="w-4 h-4 text-omega-orange" />
                </div>
                <h3 className="text-sm font-bold text-omega-charcoal flex-1">{f.label}</h3>
                <span className="text-[10px] font-bold text-omega-stone bg-gray-100 px-2 py-0.5 rounded-full">{f.items.length}</span>
                {!isAdding && (
                  <button
                    onClick={() => setAddingTo(f.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold text-omega-orange hover:bg-omega-pale"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                )}
              </div>

              {isAdding && (
                <AddDocumentRow
                  folder={f.id}
                  job={job}
                  user={user}
                  onClose={() => setAddingTo(null)}
                  onAdded={(row) => {
                    setDocs((prev) => [row, ...prev]);
                    setAddingTo(null);
                  }}
                />
              )}

              <div className="divide-y divide-gray-100">
                {loading && <p className="px-4 py-3 text-xs text-omega-stone">Loading…</p>}
                {!loading && f.items.length === 0 && !isAdding && (
                  <p className="px-4 py-5 text-xs text-omega-stone italic text-center">No documents in this folder yet.</p>
                )}
                {f.items.map((d) => (
                  <div key={d.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 group">
                    <button
                      onClick={() => d.photo_url && setViewer(d)}
                      disabled={!d.photo_url}
                      className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0 disabled:cursor-default"
                      title={d.photo_url ? 'View' : 'No attachment'}
                    >
                      {d.photo_url
                        ? <img src={d.photo_url} alt="" className="w-full h-full object-cover" />
                        : <ImageIcon className="w-4 h-4 text-gray-400" />
                      }
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-omega-charcoal truncate">{d.title}</p>
                      <p className="text-[10px] text-omega-stone">
                        {d.uploaded_by || '—'} · {new Date(d.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {d.photo_url && (
                      <a
                        href={d.photo_url} target="_blank" rel="noopener noreferrer"
                        className="text-omega-stone hover:text-omega-orange"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button
                      onClick={() => deleteDoc(d)}
                      className="text-omega-stone hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Notes & Alerts — growing log with author + timestamp */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <h3 className="text-base font-bold text-omega-charcoal">Notes &amp; Alerts</h3>
          <span className="text-[10px] font-bold text-omega-stone bg-gray-100 px-2 py-0.5 rounded-full ml-auto">
            {notes.length}
          </span>
        </div>
        <p className="text-xs text-omega-stone mb-3">
          Quick internal notes — each entry is stamped with who wrote it and when.
        </p>

        {/* Add new note */}
        <div className="space-y-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={3}
            placeholder={`e.g. "client was just price-shopping", "zoning won't allow what they want"…`}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none resize-y"
          />
          {noteError && <p className="text-xs text-red-600 font-semibold">{noteError}</p>}
          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* Voice record — transcribed and saved as a note with
                source='voice' so it renders with a mic icon later. */}
            <VoiceNoteRecorder
              compact
              onTranscribed={(text) => addNote({ overrideBody: text, source: 'voice' })}
            />
            <button
              onClick={() => addNote()}
              disabled={savingNote || !newNote.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-omega-orange hover:bg-omega-dark disabled:opacity-50 text-white text-sm font-semibold"
            >
              <Save className="w-4 h-4" /> {savingNote ? 'Saving…' : 'Add Note'}
            </button>
          </div>
        </div>

        {/* Existing notes list */}
        {notes.length > 0 && (
          <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
            {notes.map((n) => (
              <div key={n.id} className="group rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                    {n.source === 'voice' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-omega-pale text-omega-orange text-[9px] font-bold uppercase tracking-wider">
                        <Mic className="w-2.5 h-2.5" /> Voice
                      </span>
                    )}
                    <span className="text-xs font-bold text-omega-charcoal">{n.author_name || 'Unknown'}</span>
                    {n.author_role && (
                      <span className="text-[10px] uppercase tracking-wider text-omega-stone font-semibold">
                        · {n.author_role}
                      </span>
                    )}
                    <span className="text-[11px] text-omega-stone">
                      {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteNote(n)}
                    className="text-omega-stone hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    title="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-omega-charcoal whitespace-pre-wrap leading-relaxed">{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Photo viewer */}
      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setViewer(null)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setViewer(null)}>
            <X className="w-6 h-6" />
          </button>
          <img
            src={viewer.photo_url}
            alt=""
            className="max-h-[90vh] max-w-[95vw] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 left-4 right-4 text-center text-white text-sm font-semibold truncate">
            {viewer.title}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Add row ────────────────────────────────────────────────────────
function AddDocumentRow({ folder, job, user, onClose, onAdded }) {
  const [title, setTitle]   = useState('');
  const [file, setFile]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    setSaving(true);
    try {
      let photoUrl = null;
      if (file) {
        const safe = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${job.id}/${folder}/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        photoUrl = pub?.publicUrl || null;
      }
      const { data, error: insErr } = await supabase.from('job_documents').insert([{
        job_id: job.id, folder, title: title.trim(),
        photo_url: photoUrl, uploaded_by: user?.name || null,
      }]).select().single();
      if (insErr) throw insErr;
      logAudit({ user, action: 'document.create', entityType: 'job_document', entityId: data.id, details: { folder, title: data.title } });
      onAdded?.(data);
    } catch (e) {
      setError(e.message || 'Failed to save document');
    }
    setSaving(false);
  }

  return (
    <div className="px-4 py-3 bg-omega-pale/40 border-b border-omega-orange/20 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Document title"
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:border-omega-orange focus:outline-none bg-white"
      />
      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-omega-charcoal hover:border-omega-orange cursor-pointer bg-white">
        <ImageIcon className="w-3.5 h-3.5" />
        {file ? file.name : 'Attach photo / PDF (optional)'}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-white">Cancel</button>
        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-orange hover:bg-omega-dark disabled:opacity-60 text-white text-xs font-bold"
        >
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save</>}
        </button>
      </div>
    </div>
  );
}
