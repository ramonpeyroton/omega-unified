import { useEffect, useState } from 'react';
import { ImagePlus, X, ChevronLeft, ChevronRight, Loader2, FileText, Upload, Images, Check } from 'lucide-react';
import ImageLightbox from '../ui/ImageLightbox';
import {
  uploadEstimateImage, previewPdfPages, uploadPdfPages, loadJobPhotos, photoId,
} from '../../lib/estimatePhotos';

// Builder side of estimate photos (migration 089): used inside each
// section card and for the "Photos & references" gallery at the end.
// photos = [{ id, url, caption, kind, source, page, pages }]
export default function EstimatePhotosEditor({ jobId, photos = [], onChange, label = 'Photos', readOnly = false }) {
  const [adding, setAdding] = useState(false);
  const [viewer, setViewer] = useState(null);

  const update = (i, patch) => onChange(photos.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i) => onChange(photos.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= photos.length) return;
    const next = photos.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  if (readOnly && !photos.length) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-omega-stone">{label}{photos.length ? ` (${photos.length})` : ''}</p>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-omega-slate hover:border-omega-orange hover:text-omega-orange"
          >
            <ImagePlus className="w-4 h-4" /> Photos / PDF
          </button>
        )}
      </div>

      {photos.length > 0 && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {photos.map((p, i) => (
            <div key={p.id || p.url} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="relative">
                <button type="button" onClick={() => setViewer(i)} className="block w-full aspect-[4/3] bg-gray-100" aria-label="View larger">
                  <img src={p.url} alt="" className={`w-full h-full ${p.kind === 'pdf_page' ? 'object-contain' : 'object-cover'}`} loading="lazy" />
                </button>
                {p.kind === 'pdf_page' && (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/65 text-white text-[10px] font-bold">
                    <FileText className="w-3 h-3" /> PDF{p.pages > 1 ? ` p.${p.page}` : ''}
                  </span>
                )}
                {!readOnly && (
                  <div className="absolute right-1 top-1 flex gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="w-7 h-7 rounded-md bg-white/90 text-gray-700 disabled:opacity-30 flex items-center justify-center" aria-label="Move left"><ChevronLeft className="w-4 h-4" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === photos.length - 1} className="w-7 h-7 rounded-md bg-white/90 text-gray-700 disabled:opacity-30 flex items-center justify-center" aria-label="Move right"><ChevronRight className="w-4 h-4" /></button>
                    <button type="button" onClick={() => remove(i)} className="w-7 h-7 rounded-md bg-white/90 text-red-600 flex items-center justify-center" aria-label="Remove photo"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
              {readOnly ? (
                p.caption ? <p className="px-2 py-1.5 text-xs text-omega-charcoal">{p.caption}</p> : null
              ) : (
                <input
                  defaultValue={p.caption || ''}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.caption || '')) update(i, { caption: v }); }}
                  placeholder="Caption (optional)"
                  className="w-full px-2 h-8 border-t border-gray-100 text-xs focus:outline-none focus:bg-omega-pale/30"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddPhotosModal
          jobId={jobId}
          onAdd={(entries) => onChange([...photos, ...entries])}
          onClose={() => setAdding(false)}
        />
      )}
      {viewer !== null && photos[viewer] && (
        <ImageLightbox
          images={photos.map((p) => ({ url: p.url, kind: 'image', caption: p.caption || p.source || '' }))}
          index={viewer}
          onIndexChange={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

// Upload from the computer / phone (images and PDFs) or pick photos that are
// already on this job. A PDF opens a page picker first (all pages ticked).
function AddPhotosModal({ jobId, onAdd, onClose }) {
  const [tab, setTab] = useState('upload');
  const [busy, setBusy] = useState(null);           // status text while working
  const [error, setError] = useState(null);
  const [pdf, setPdf] = useState(null);             // { file, pages, totalPages, picked:Set }
  const [queue, setQueue] = useState([]);           // PDFs waiting for their page pick
  const [added, setAdded] = useState(0);
  const [jobPhotos, setJobPhotos] = useState(null);
  const [picked, setPicked] = useState(() => new Set());

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, busy]);

  useEffect(() => {
    if (tab !== 'job' || jobPhotos) return;
    loadJobPhotos(jobId).then(setJobPhotos).catch(() => setJobPhotos([]));
  }, [tab, jobId, jobPhotos]);

  async function openNextPdf(rest) {
    const [file, ...others] = rest;
    setQueue(others);
    if (!file) { setPdf(null); return; }
    setBusy(`Reading ${file.name}…`);
    try {
      const { pages, totalPages } = await previewPdfPages(file, (n, t) => setBusy(`Reading ${file.name} — page ${n} of ${t}…`));
      setPdf({ file, pages, totalPages, picked: new Set(pages.map((p) => p.pageNumber)) });
    } catch (e) {
      setError(`Could not read ${file.name}: ${e?.message || e}`);
      setPdf(null);
      if (others.length) openNextPdf(others);
    } finally {
      setBusy(null);
    }
  }

  async function onFiles(fileList) {
    setError(null);
    const files = [...(fileList || [])];
    const images = files.filter((f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const entries = [];
    for (let i = 0; i < images.length; i++) {
      setBusy(`Uploading photo ${i + 1} of ${images.length}…`);
      try { entries.push(await uploadEstimateImage(jobId, images[i])); }
      catch (e) { setError(`Could not upload ${images[i].name}: ${e?.message || e}`); }
    }
    setBusy(null);
    if (entries.length) { onAdd(entries); setAdded((n) => n + entries.length); }
    if (pdfs.length) openNextPdf(pdfs);
  }

  async function addPdfPages() {
    const chosen = pdf.pages.filter((p) => pdf.picked.has(p.pageNumber));
    if (!chosen.length) { openNextPdf(queue); return; }
    setBusy(`Uploading ${chosen.length} page${chosen.length === 1 ? '' : 's'}…`);
    try {
      const entries = await uploadPdfPages(jobId, pdf.file, chosen, pdf.totalPages);
      onAdd(entries);
      setAdded((n) => n + entries.length);
    } catch (e) {
      setError(`Could not upload the pages: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
    openNextPdf(queue);
  }

  function addJobPhotos() {
    const entries = (jobPhotos || []).filter((p) => picked.has(p.url))
      .map((p) => ({ id: photoId(), url: p.url, caption: '', kind: 'photo', source: p.label }));
    if (entries.length) onAdd(entries);
    onClose();
  }

  const togglePage = (n) => setPdf((cur) => {
    const next = new Set(cur.picked);
    if (next.has(n)) next.delete(n); else next.add(n);
    return { ...cur, picked: next };
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-0 sm:p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
          <p className="flex-1 font-bold text-omega-charcoal text-lg">
            {pdf ? `Pick the pages — ${pdf.file.name}` : 'Add photos or a PDF'}
          </p>
          <button onClick={onClose} disabled={!!busy} className="p-2 rounded-xl bg-gray-100 text-omega-stone hover:bg-gray-200 disabled:opacity-50" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {!pdf && (
          <div className="px-5 pt-3 flex gap-2">
            {[{ id: 'upload', label: 'Upload', icon: Upload }, { id: 'job', label: 'From this job', icon: Images }].map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} disabled={!!busy}
                  className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold border ${tab === t.id ? 'bg-omega-charcoal text-white border-omega-charcoal' : 'border-gray-200 text-omega-slate hover:border-omega-orange'}`}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</p>}
          {busy && <p className="mb-3 flex items-center gap-2 text-sm text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> {busy}</p>}
          {added > 0 && !busy && !pdf && <p className="mb-3 text-sm text-green-700">{added} added to the estimate.</p>}

          {pdf ? (
            <>
              <div className="flex items-center gap-3 mb-3 text-sm">
                <span className="text-omega-stone">{pdf.picked.size} of {pdf.pages.length} pages selected{pdf.totalPages > pdf.pages.length ? ` (first ${pdf.pages.length} of ${pdf.totalPages})` : ''}</span>
                <button onClick={() => setPdf((c) => ({ ...c, picked: new Set(c.pages.map((p) => p.pageNumber)) }))} className="text-omega-orange font-semibold">All</button>
                <button onClick={() => setPdf((c) => ({ ...c, picked: new Set() }))} className="text-omega-orange font-semibold">None</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {pdf.pages.map((p) => {
                  const on = pdf.picked.has(p.pageNumber);
                  return (
                    <button key={p.pageNumber} type="button" onClick={() => togglePage(p.pageNumber)}
                      className={`relative rounded-xl border-2 overflow-hidden bg-gray-50 ${on ? 'border-omega-orange' : 'border-gray-200 opacity-60'}`}>
                      <img src={p.dataUrl} alt={`Page ${p.pageNumber}`} className="w-full aspect-[3/4] object-contain" />
                      <span className={`absolute right-1.5 top-1.5 w-6 h-6 rounded-full flex items-center justify-center ${on ? 'bg-omega-orange text-white' : 'bg-white border border-gray-300'}`}>
                        {on && <Check className="w-4 h-4" />}
                      </span>
                      <span className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[11px] font-semibold">Page {p.pageNumber}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : tab === 'upload' ? (
            <label className={`flex flex-col items-center justify-center gap-2 h-48 rounded-2xl border-2 border-dashed border-gray-300 text-omega-stone cursor-pointer hover:border-omega-orange hover:text-omega-orange ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              <ImagePlus className="w-8 h-8" />
              <span className="font-semibold">Choose photos or PDFs</span>
              <span className="text-xs">On a phone or tablet you can also take a photo now</span>
              <input type="file" accept="image/*,application/pdf" multiple className="hidden"
                onChange={(e) => { const f = e.target.files; e.target.value = ''; onFiles(f); }} />
            </label>
          ) : jobPhotos === null ? (
            <p className="flex items-center gap-2 text-sm text-omega-stone"><Loader2 className="w-4 h-4 animate-spin" /> Loading this job's photos…</p>
          ) : jobPhotos.length === 0 ? (
            <p className="text-sm text-omega-stone">No photos on this job yet (Documents, Daily Logs or Phases).</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {jobPhotos.map((p) => {
                const on = picked.has(p.url);
                return (
                  <button key={p.url} type="button"
                    onClick={() => setPicked((cur) => { const n = new Set(cur); if (n.has(p.url)) n.delete(p.url); else n.add(p.url); return n; })}
                    className={`relative rounded-lg overflow-hidden border-2 ${on ? 'border-omega-orange' : 'border-transparent'}`}>
                    <img src={p.url} alt="" loading="lazy" className="w-full aspect-square object-cover" />
                    <span className={`absolute right-1 top-1 w-5 h-5 rounded-full flex items-center justify-center ${on ? 'bg-omega-orange text-white' : 'bg-white/90 border border-gray-300'}`}>
                      {on && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span className="absolute left-1 bottom-1 px-1 rounded bg-black/55 text-white text-[10px]">{p.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          {pdf ? (
            <>
              <button onClick={() => openNextPdf(queue)} disabled={!!busy} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-semibold text-omega-slate">Skip this PDF</button>
              <button onClick={addPdfPages} disabled={!!busy || !pdf.picked.size} className="h-10 px-4 rounded-xl bg-omega-orange text-white text-sm font-bold disabled:opacity-50">
                Add {pdf.picked.size} page{pdf.picked.size === 1 ? '' : 's'}
              </button>
            </>
          ) : tab === 'job' ? (
            <button onClick={addJobPhotos} disabled={!picked.size} className="h-10 px-4 rounded-xl bg-omega-orange text-white text-sm font-bold disabled:opacity-50">
              Add {picked.size} photo{picked.size === 1 ? '' : 's'}
            </button>
          ) : (
            <button onClick={onClose} disabled={!!busy} className="h-10 px-4 rounded-xl bg-omega-charcoal text-white text-sm font-bold disabled:opacity-50">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
