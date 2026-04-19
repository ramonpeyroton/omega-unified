import { useEffect, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Small button + count badge used inline within a PhaseBreakdown sub-item.
// Clicking the camera icon opens a picker (native camera on mobile via
// `capture` attribute). Clicking the count opens a gallery viewer.
export default function PhasePhotos({ jobId, phaseId, itemId, user }) {
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState(null);

  useEffect(() => {
    if (!jobId || !phaseId || !itemId) return;
    load();
    // eslint-disable-next-line
  }, [jobId, phaseId, itemId]);

  async function load() {
    try {
      const { data } = await supabase
        .from('phase_photos')
        .select('*')
        .eq('job_id', jobId)
        .eq('phase_id', phaseId)
        .eq('item_id', itemId)
        .order('taken_at', { ascending: false });
      setPhotos(data || []);
    } catch {
      setPhotos([]);
    }
  }

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const path = `phase-photos/${jobId}/${phaseId}/${itemId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from('phase-photos').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('phase-photos').getPublicUrl(path);
      const url = pub?.publicUrl;
      const { data, error } = await supabase.from('phase_photos').insert([{
        job_id: jobId,
        phase_id: phaseId,
        item_id: itemId,
        type: 'progress',
        photo_url: url,
        taken_by: user?.name || null,
      }]).select().single();
      if (error) throw error;
      setPhotos((prev) => [data, ...prev]);
    } catch {
      /* silently ignore — bucket may need creation */
    } finally {
      setUploading(false);
    }
  }

  const count = photos.length;

  return (
    <>
      <div className="inline-flex items-center gap-1">
        <label className="cursor-pointer inline-flex items-center justify-center w-6 h-6 rounded-md text-omega-stone hover:bg-omega-pale hover:text-omega-orange transition-colors" title="Add photo">
          <Camera className={`w-3.5 h-3.5 ${uploading ? 'animate-pulse' : ''}`} />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0])}
            disabled={uploading}
          />
        </label>
        {count > 0 && (
          <button
            onClick={() => setViewer(0)}
            className="text-[10px] font-semibold text-omega-orange hover:text-omega-dark"
            title="View photos"
          >
            {count}
          </button>
        )}
      </div>

      {viewer !== null && photos[viewer] && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setViewer(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setViewer(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={photos[viewer].photo_url} alt="" className="max-h-full max-w-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {photos.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); setViewer((v) => (v - 1 + photos.length) % photos.length); }} className="px-3 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold">‹</button>
              <span className="text-white text-xs font-semibold">{viewer + 1} / {photos.length}</span>
              <button onClick={(e) => { e.stopPropagation(); setViewer((v) => (v + 1) % photos.length); }} className="px-3 py-2 bg-white/10 text-white rounded-lg text-sm font-semibold">›</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
