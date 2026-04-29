// JobCoverPhotoUpload — square/landscape image upload for the cover
// photo shown on the redesigned PipelineKanban card. Stored in the
// `job-covers` Supabase Storage bucket; URL written to
// `jobs.cover_photo_url` (migration 021).
//
// The bucket MUST be public so the kanban's <img> tags load without
// auth headers. If the bucket isn't public, fall back URL will 404 —
// see migration 021 for setup notes.
//
// Display contract: the kanban renders this image at aspect 2:1 with
// object-cover, so a square or portrait photo gets centered-cropped
// horizontally without making cards taller.

import { useState } from 'react';
import { Upload, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

const BUCKET = 'job-covers';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB ceiling — cover photos shouldn't be huge.
const ACCEPT = 'image/jpeg,image/png,image/webp';

export default function JobCoverPhotoUpload({ job, onUpdated, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const url = job?.cover_photo_url || null;

  async function handleFile(file) {
    if (!file) return;
    setError('');
    if (file.size > MAX_BYTES) {
      setError('Image is too large. Keep it under 8 MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Only image files are accepted.');
      return;
    }

    setBusy(true);
    try {
      // Path layout: <jobId>/<timestamp>-<sanitized-name>. Keeps each
      // job's photos grouped and ensures a unique name per upload so
      // CDN caches don't serve a stale image.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
      const path = `${job.id}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Could not resolve public URL.');

      const { data: updated, error: dbErr } = await supabase
        .from('jobs')
        .update({ cover_photo_url: publicUrl })
        .eq('id', job.id)
        .select()
        .single();
      if (dbErr) throw dbErr;

      onUpdated?.(updated);
    } catch (err) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (disabled || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data: updated, error: dbErr } = await supabase
        .from('jobs')
        .update({ cover_photo_url: null })
        .eq('id', job.id)
        .select()
        .single();
      if (dbErr) throw dbErr;
      // Note: we don't delete the file from Storage here — keeping it
      // means we can audit history if we ever add a "previous covers"
      // gallery. Storage cleanup can be a separate scheduled job.
      onUpdated?.(updated);
    } catch (err) {
      setError(err?.message || 'Could not remove photo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold text-omega-stone uppercase tracking-wider">
          Cover Photo
        </label>
        {url && !disabled && (
          <button
            onClick={handleRemove}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] text-omega-stone hover:text-red-600 disabled:opacity-40 transition"
          >
            <X className="w-3 h-3" /> Remove
          </button>
        )}
      </div>

      {url ? (
        <div className="relative rounded-xl overflow-hidden border border-gray-200">
          <div className="aspect-[2/1] bg-omega-cloud">
            <img
              src={url}
              alt="Job cover"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          {!disabled && (
            <label
              className={`absolute bottom-2 right-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs font-semibold cursor-pointer hover:bg-black/85 transition ${
                busy ? 'opacity-60 pointer-events-none' : ''
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  Replace
                </>
              )}
              <input
                type="file"
                accept={ACCEPT}
                className="hidden"
                disabled={busy}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
      ) : (
        <label
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed transition cursor-pointer ${
            disabled
              ? 'border-gray-200 text-omega-fog cursor-not-allowed'
              : busy
                ? 'border-omega-orange/40 bg-omega-pale/40 text-omega-orange cursor-wait'
                : 'border-gray-300 hover:border-omega-orange hover:bg-omega-pale/40 text-omega-stone'
          }`}
        >
          {busy ? (
            <Loader2 className="w-5 h-5 text-omega-orange animate-spin flex-shrink-0" />
          ) : (
            <ImageIcon className="w-5 h-5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-omega-charcoal">
              {busy ? 'Uploading…' : 'Upload cover photo'}
            </p>
            <p className="text-[11px] text-omega-stone">
              Square or landscape works — we'll crop to fit the kanban card.
            </p>
          </div>
          <input
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={busy || disabled}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      )}

      {error && (
        <p className="text-[11px] text-red-600 px-1">{error}</p>
      )}
    </div>
  );
}
