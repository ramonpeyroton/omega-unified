// In-browser video compression via ffmpeg.wasm.
//
// iPhone clips are huge (4K HEVC, often 100-300 MB) and HEVC .mov
// doesn't even play in every browser. We transcode to H.264 1080p mp4
// right on the device before upload — typically an 80-90% size cut AND
// universal playback. Used by the Daily Logs chat composer.
//
// Loaded entirely from CDN at runtime (same pattern as html2pdf) so the
// ~30 MB wasm core never touches our bundle. We use the SINGLE-THREAD
// core on purpose: the multi-thread core needs SharedArrayBuffer, which
// requires COOP/COEP cross-origin isolation — and that would break the
// app's cross-origin Supabase images. Single-thread is slower but safe.
//
// Honest caveats (this is why we test on a real iPhone first):
//  • CPU-heavy and slow on phones — can be 1-3 min for a long clip.
//  • Very large 4K inputs can exhaust the wasm heap and throw; callers
//    must treat a throw as "use the original file" and fall back.

const VER = { ffmpeg: '0.12.10', util: '0.12.1', core: '0.12.6' };
const CDN = {
  ffmpeg:   `https://unpkg.com/@ffmpeg/ffmpeg@${VER.ffmpeg}/dist/umd/ffmpeg.js`,
  util:     `https://unpkg.com/@ffmpeg/util@${VER.util}/dist/umd/index.js`,
  coreJs:   `https://unpkg.com/@ffmpeg/core@${VER.core}/dist/umd/ffmpeg-core.js`,
  coreWasm: `https://unpkg.com/@ffmpeg/core@${VER.core}/dist/umd/ffmpeg-core.wasm`,
};

// Encoder knobs — kept here so we can tune them after the iPhone test.
// CRF 27 + 1080p is a good "proof of work" balance (clearly readable,
// big size cut). Lower CRF = better quality + bigger file.
const SCALE = "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease";
const CRF   = '27';
const PRESET = 'veryfast';

let _ffmpeg = null;
let _loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function getFfmpeg() {
  if (_ffmpeg) return _ffmpeg;
  if (_loading) return _loading;
  _loading = (async () => {
    await loadScript(CDN.ffmpeg);
    await loadScript(CDN.util);
    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;
    const ff = new FFmpeg();
    await ff.load({
      coreURL: await toBlobURL(CDN.coreJs, 'text/javascript'),
      wasmURL: await toBlobURL(CDN.coreWasm, 'application/wasm'),
    });
    _ffmpeg = ff;
    return ff;
  })();
  return _loading;
}

/**
 * Whether ffmpeg.wasm is even available (CDN reachable). Lets the caller
 * decide before showing a "compressing…" UI.
 */
export async function videoCompressorReady() {
  try { await getFfmpeg(); return true; } catch { return false; }
}

/**
 * Compress a video File to H.264 1080p mp4.
 * @param {File} file
 * @param {(progress:number)=>void} [onProgress] 0..1
 * @returns {Promise<File>} the compressed file, or the ORIGINAL if
 *          compression failed or didn't actually shrink it.
 */
export async function compressVideo(file, onProgress) {
  let ff;
  try {
    ff = await getFfmpeg();
  } catch {
    return file; // CDN/core unavailable — caller uploads the original
  }
  const { fetchFile } = window.FFmpegUtil;
  const inName = `in-${Date.now()}`;
  const outName = `out-${Date.now()}.mp4`;
  const onProg = (e) => {
    const p = typeof e?.progress === 'number' ? e.progress : 0;
    if (onProgress && p >= 0 && p <= 1) onProgress(p);
  };
  ff.on('progress', onProg);
  try {
    await ff.writeFile(inName, await fetchFile(file));
    await ff.exec([
      '-i', inName,
      '-vf', SCALE,
      '-c:v', 'libx264', '-crf', CRF, '-preset', PRESET, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outName,
    ]);
    const data = await ff.readFile(outName);
    ff.deleteFile(inName).catch(() => {});
    ff.deleteFile(outName).catch(() => {});
    const blob = new Blob([data], { type: 'video/mp4' });
    // If it didn't actually get smaller, keep the original.
    if (!blob.size || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'video';
    return new File([blob], `${base}.mp4`, { type: 'video/mp4' });
  } catch {
    return file; // transcode failed (e.g. out of memory) — use original
  } finally {
    try { ff.off('progress', onProg); } catch { /* noop */ }
  }
}
