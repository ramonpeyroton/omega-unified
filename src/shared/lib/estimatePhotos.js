// Photos & PDF pages on estimates (migration 089).
//
//   sections[i].photos  photos that belong to one section ("Selected tile")
//   estimates.photos    the "Photos & references" gallery at the end
//
// Every entry is an image: { id, url, caption, kind, source, page, pages }.
// A PDF is turned into one image per page when it's added, so the client
// page and the downloaded PDF show the pages themselves (Inácio, 15/10/26 —
// a "download the attachment" link wasn't enough).

import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';
import { pdfToPageImages } from './pdfPages';

const BUCKET = 'job-documents';
const COMPRESS = { maxSizeMB: 1.2, maxWidthOrHeight: 2200, useWebWorker: true, initialQuality: 0.82 };

export function photoId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `ph-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const safeName = (name) => String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);

async function upload(jobId, blob, name, contentType) {
  const path = `estimates/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName(name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// One image file → compressed → uploaded → photo entry.
export async function uploadEstimateImage(jobId, file) {
  let blob = file;
  try { blob = await imageCompression(file, COMPRESS); } catch { /* keep the original */ }
  const name = /\.(jpe?g|png|webp)$/i.test(file.name) ? file.name : `${file.name || 'photo'}.jpg`;
  const url = await upload(jobId, blob, name, blob.type || 'image/jpeg');
  return { id: photoId(), url, caption: '', kind: 'photo', source: file.name || null };
}

// PDF → page previews (nothing uploaded yet, so the user can pick pages).
// Rendered wide enough that measurements on a plan stay readable.
export async function previewPdfPages(file, onProgress) {
  const { pages, totalPages } = await pdfToPageImages(file, { maxWidth: 2000, quality: 0.82, maxPages: 40, onProgress });
  return { pages, totalPages };
}

// Upload the chosen pages of a previewed PDF → photo entries.
export async function uploadPdfPages(jobId, file, pages, totalPages) {
  const base = String(file.name || 'document.pdf').replace(/\.pdf$/i, '');
  const out = [];
  for (const p of pages) {
    const url = await upload(jobId, p.blob, `${base}-p${p.pageNumber}.jpg`, 'image/jpeg');
    out.push({
      id: photoId(), url, kind: 'pdf_page', source: file.name || null, page: p.pageNumber, pages: totalPages,
      caption: totalPages > 1 ? `${base} — page ${p.pageNumber} of ${totalPages}` : base,
    });
  }
  return out;
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif)(\?|#|$)/i;

// Photos already in the app for this job: Documents (includes Daily Logs
// photos, which are mirrored there) and the phase checklist photos.
export async function loadJobPhotos(jobId) {
  const [docs, phase] = await Promise.all([
    supabase.from('job_documents').select('id, title, photo_url, folder, created_at')
      .eq('job_id', jobId).not('photo_url', 'is', null).order('created_at', { ascending: false }).limit(300),
    supabase.from('phase_photos').select('id, photo_url, taken_at').eq('job_id', jobId)
      .order('taken_at', { ascending: false }).limit(200),
  ]);
  const seen = new Set();
  const out = [];
  for (const d of docs.data || []) {
    if (!d.photo_url || !IMAGE_RE.test(d.photo_url) || seen.has(d.photo_url)) continue;
    seen.add(d.photo_url);
    out.push({ url: d.photo_url, label: d.title || (d.folder === 'daily_logs' ? 'Daily Logs' : 'Documents'), at: d.created_at });
  }
  for (const p of phase.data || []) {
    if (!p.photo_url || seen.has(p.photo_url)) continue;
    seen.add(p.photo_url);
    out.push({ url: p.photo_url, label: 'Phases', at: p.taken_at });
  }
  return out;
}

// Every photo of an estimate in reading order (sections first, then the
// gallery) — one sequence for the full-screen viewer.
export function estimatePhotoList(estimate) {
  const list = [];
  for (const s of estimate?.sections || []) {
    for (const ph of s.photos || []) list.push({ ...ph, where: s.title || '' });
  }
  for (const ph of estimate?.photos || []) list.push({ ...ph, where: 'Photos & references' });
  return list;
}
