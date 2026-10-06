import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download, Play } from 'lucide-react';

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|ogv|3gp)(\?|#|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)(\?|#|$)/i;

/** 'image' | 'video' | null — from the mime type, else the file extension. */
export function mediaKind(mime, url) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (VIDEO_EXT.test(url || '')) return 'video';
  if (IMAGE_EXT.test(url || '')) return 'image';
  return null;
}

/**
 * Full-screen photo + video viewer. Click a photo → it opens big; arrows, the
 * keyboard (← → Esc) or a swipe move through the rest; the strip at the
 * bottom jumps straight to one. Built for Daily Logs, where a sub or Attila
 * posts 30 site photos and nobody wants to open 30 links (Ramon, 06/10).
 *
 * images: [{ url, kind?: 'image' | 'video', caption?, sub? }]
 *   caption = who sent (or the item) · sub = when. Videos play inline with
 *   their controls and pause when you move on. Stops at the last one.
 */
export default function ImageLightbox({ images, index, onIndexChange, onClose }) {
  const total = images.length;
  const img = images[index];
  const touch = useRef(null);
  const stripRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const go = useCallback((delta) => {
    const next = index + delta;
    if (next >= 0 && next < total) onIndexChange(next);
  }, [index, total, onIndexChange]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose]);

  // Fresh spinner per photo; warm up the neighbours so flipping is instant.
  const isVideo = img?.kind === 'video';

  useEffect(() => {
    setLoaded(false);
    [index - 1, index + 1].forEach((i) => {
      if (images[i] && images[i].kind !== 'video') { const p = new Image(); p.src = images[i].url; }
    });
    stripRef.current?.querySelector(`[data-i="${index}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [index, images]);

  if (!img) return null;

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  const arrow = 'absolute top-1/2 -translate-y-1/2 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center transition disabled:opacity-0 disabled:pointer-events-none';

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/95 flex flex-col select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-3 sm:px-5 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-white">
        <span className="text-sm font-bold tabular-nums">{index + 1} / {total}</span>
        <div className="flex-1 min-w-0">
          {img.caption && <p className="text-sm font-semibold truncate">{img.caption}</p>}
          {img.sub && <p className="text-xs text-white/60 truncate">{img.sub}</p>}
        </div>
        <a
          href={img.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center"
          title="Open the original"
          aria-label="Open the original"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Photo — a click on the dark area around it closes */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-20"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {!loaded && !isVideo && (
          <div className="absolute w-8 h-8 rounded-full border-2 border-white/25 border-t-white animate-spin" aria-hidden />
        )}
        {isVideo ? (
          // key = url → a new element per video, so moving on stops the old one.
          <video
            key={img.url}
            src={img.url}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-full bg-black"
          />
        ) : (
          <img
            key={img.url}
            src={img.url}
            alt={img.caption || `Photo ${index + 1}`}
            onLoad={() => setLoaded(true)}
            className={`max-w-full max-h-full object-contain transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            draggable={false}
          />
        )}
        <button onClick={() => go(-1)} disabled={index === 0} className={`${arrow} left-2 sm:left-5`} aria-label="Previous photo">
          <ChevronLeft className="w-7 h-7" />
        </button>
        <button onClick={() => go(1)} disabled={index === total - 1} className={`${arrow} right-2 sm:right-5`} aria-label="Next photo">
          <ChevronRight className="w-7 h-7" />
        </button>
      </div>

      {/* Thumbnail strip */}
      {total > 1 && (
        <div
          ref={stripRef}
          className="flex gap-1.5 overflow-x-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] scrollbar-hide"
        >
          {images.map((im, i) => (
            <button
              key={`${im.url}-${i}`}
              data-i={i}
              onClick={() => onIndexChange(i)}
              className={`flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-md overflow-hidden border-2 transition ${
                i === index ? 'border-omega-orange opacity-100' : 'border-transparent opacity-50 hover:opacity-90'
              }`}
              aria-label={`${im.kind === 'video' ? 'Video' : 'Photo'} ${i + 1}`}
            >
              <MediaThumb item={im} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Square preview for a photo or a video (first frame + ▶). */
export function MediaThumb({ item, className = '' }) {
  if (item.kind === 'video') {
    return (
      <span className={`relative block w-full h-full bg-black ${className}`}>
        <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover pointer-events-none" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-7 h-7 rounded-full bg-black/55 flex items-center justify-center">
            <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
          </span>
        </span>
      </span>
    );
  }
  return <img src={item.url} alt="" loading="lazy" className={`w-full h-full object-cover ${className}`} draggable={false} />;
}
