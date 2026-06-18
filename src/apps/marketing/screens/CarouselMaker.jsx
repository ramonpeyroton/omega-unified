// CarouselMaker — turns a project's real jobsite photos into a branded
// Instagram carousel (cover + photo slides + CTA), rendered entirely in
// the browser with Canvas (no external API, no cost). Captions can be
// AI-suggested via the shared Claude proxy. A custom cover image can be
// uploaded — that's the hook where AI-generated covers (Higgsfield) drop
// in until the in-app generation is wired.
//
// Cross-origin Supabase photos are fetched as blobs first so the canvas
// never taints and PNG export always works.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Images, Download, Loader2, Wand2, Upload, X, Layout, Sparkles } from 'lucide-react';
import { supabase } from '../../../shared/lib/supabase';
import { callAnthropicShared } from '../../../shared/lib/anthropic';
import { apiFetch } from '../../../shared/lib/apiFetch';
import { serviceBadgeLabel } from '../../../shared/data/services';

const FORMATS = [
  { id: 'square',   label: 'Square 1080', w: 1080, h: 1080 },
  { id: 'portrait', label: 'Portrait 4:5', w: 1080, h: 1350 },
];
const MAX_PHOTOS = 8;
const ORANGE = '#E8500A';
const CHARCOAL = '#1f2421';

function isPdf(u) { return /\.pdf(\?|$)/i.test(u || ''); }
function isVideo(u) { return /\.(mp4|mov|webm|m4v|avi|mkv|3gp|hevc)(\?|$)/i.test(u || ''); }
function isUsablePhoto(u) { return !!u && !isPdf(u) && !isVideo(u); }

export default function CarouselMaker({ jobs = [], user }) {
  const [jobId, setJobId] = useState('');
  const [photos, setPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [selected, setSelected] = useState([]); // ordered array of urls
  const [format, setFormat] = useState('square');
  const [headline, setHeadline] = useState('');
  const [cta, setCta] = useState('Book your free estimate');
  const [captions, setCaptions] = useState({}); // url -> caption
  const [customCover, setCustomCover] = useState(null); // { url }
  const [slides, setSlides] = useState([]); // [{ kind, dataUrl }]
  const [building, setBuilding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const job = useMemo(() => jobs.find((j) => j.id === jobId) || null, [jobs, jobId]);
  const fmt = FORMATS.find((f) => f.id === format) || FORMATS[0];

  useEffect(() => {
    if (!jobId) { setPhotos([]); setSelected([]); return; }
    let active = true;
    (async () => {
      setLoadingPhotos(true);
      try {
        const { data } = await supabase
          .from('job_documents')
          .select('photo_url, created_at')
          .eq('job_id', jobId).eq('folder', 'daily_logs')
          .order('created_at', { ascending: false }).limit(200);
        const urls = [];
        if (isUsablePhoto(job?.cover_photo_url)) urls.push(job.cover_photo_url);
        for (const d of data || []) if (isUsablePhoto(d.photo_url)) urls.push(d.photo_url);
        if (active) { setPhotos([...new Set(urls)]); setSelected([]); setSlides([]); }
      } finally {
        if (active) setLoadingPhotos(false);
      }
    })();
    return () => { active = false; };
  }, [jobId, job?.cover_photo_url]);

  // Default headline from the job once it's picked.
  useEffect(() => {
    if (job && !headline) {
      const svc = serviceBadgeLabel(job.service) || 'Renovation';
      setHeadline(`${svc}${job.city ? ` in ${job.city}` : ''}`);
    }
  }, [job]); // eslint-disable-line

  function toggle(url) {
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= MAX_PHOTOS) return prev;
      return [...prev, url];
    });
  }

  async function suggestCaptions() {
    if (!selected.length) { setError('Pick some photos first.'); return; }
    setSuggesting(true);
    setError('');
    try {
      const svc = job ? serviceBadgeLabel(job.service) : 'a renovation';
      const town = job?.city ? ` in ${job.city}, Connecticut` : ' in Fairfield County, Connecticut';
      const prompt = [
        `You are the marketing voice of Omega Development LLC, a premium construction & remodeling company in Connecticut.`,
        `Write an Instagram carousel for a ${svc} project${town}.`,
        `Return STRICT JSON only, no markdown, shaped exactly: {"headline": string, "captions": string[${selected.length}]}.`,
        `headline: max 5 words, punchy, for the cover slide.`,
        `captions: one SHORT line (max 8 words) per photo slide, ${selected.length} of them, describing progress/craft. No hashtags, no client names.`,
      ].join('\n');
      const raw = await callAnthropicShared(prompt, 500);
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (json.headline) setHeadline(String(json.headline));
      const next = {};
      selected.forEach((u, i) => { next[u] = String(json.captions?.[i] || ''); });
      setCaptions((c) => ({ ...c, ...next }));
    } catch (err) {
      setError('Could not get AI captions (' + (err.message || 'error') + '). You can type them manually.');
    } finally {
      setSuggesting(false);
    }
  }

  async function build() {
    if (!selected.length) { setError('Pick at least one photo.'); return; }
    setBuilding(true);
    setError('');
    try {
      const out = [];
      out.push({ kind: 'Cover', dataUrl: await renderCover(fmt, headline, job, customCover) });
      for (let i = 0; i < selected.length; i++) {
        out.push({ kind: `Slide ${i + 1}`, dataUrl: await renderPhoto(fmt, selected[i], captions[selected[i]] || '', i + 2, selected.length + 2) });
      }
      out.push({ kind: 'CTA', dataUrl: await renderCta(fmt, cta) });
      setSlides(out);
    } catch (err) {
      setError(err.message || 'Failed to render slides');
    } finally {
      setBuilding(false);
    }
  }

  function onCustomCover(e) {
    const f = e.target.files?.[0];
    if (f) setCustomCover({ url: URL.createObjectURL(f) });
    e.target.value = '';
  }

  // Generate the cover background with Higgsfield (async: submit → poll).
  async function generateAiCover() {
    if (!aiPrompt.trim()) { setAiError('Describe the image first.'); return; }
    setAiBusy(true);
    setAiError('');
    try {
      const dims = fmt.id === 'portrait' ? { width: 1024, height: 1280 } : { width: 1024, height: 1024 };
      const post = (payload) => apiFetch('/api/ai-proxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'higgsfield', ...payload }),
      }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Higgsfield error'); return d; });

      const gen = await post({ action: 'generate', prompt: aiPrompt.trim(), ...dims });
      let url = gen.url;
      const id = gen.id;
      if (!url && id) {
        for (let i = 0; i < 20 && !url; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const st = await post({ action: 'status', id });
          if (st.failed) throw new Error('Generation failed on Higgsfield');
          if (st.url) url = st.url;
        }
      }
      if (!url) throw new Error('Timed out waiting for the image.');
      setCustomCover({ url });
    } catch (err) {
      setAiError(err.message || 'AI generation failed');
    } finally {
      setAiBusy(false);
    }
  }

  function downloadAll() {
    slides.forEach((s, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = s.dataUrl;
        a.download = `omega-carousel-${String(i + 1).padStart(2, '0')}.png`;
        document.body.appendChild(a); a.click(); a.remove();
      }, i * 350);
    });
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        {/* Project + format */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Project</Label>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base bg-white">
              <option value="">— Pick a project —</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{serviceBadgeLabel(j.service)}{j.city ? ` · ${j.city}` : ''}{j.client_name ? ` · ${j.client_name}` : ''}</option>)}
            </select>
          </div>
          <div>
            <Label>Format</Label>
            <div className="flex gap-2">
              {FORMATS.map((f) => <Chip key={f.id} active={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</Chip>)}
            </div>
          </div>
        </div>

        {/* Photo picker */}
        <div>
          <Label>Photos {selected.length > 0 ? `(${selected.length}/${MAX_PHOTOS} selected)` : ''}</Label>
          {!jobId ? (
            <p className="text-sm text-omega-stone">Pick a project to load its photos.</p>
          ) : loadingPhotos ? (
            <div className="flex items-center gap-2 text-omega-stone text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading photos…</div>
          ) : photos.length === 0 ? (
            <p className="text-sm text-omega-stone">No photos in this project's Daily Logs.</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-72 overflow-y-auto p-1">
              {photos.map((u) => {
                const idx = selected.indexOf(u);
                return (
                  <button key={u} onClick={() => toggle(u)} className={`relative aspect-square rounded-lg overflow-hidden border-2 ${idx >= 0 ? 'border-omega-orange' : 'border-transparent'}`}>
                    <img src={u} loading="lazy" onError={(e) => { e.currentTarget.style.opacity = '0'; }} className="w-full h-full object-cover" />
                    {idx >= 0 && <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-omega-orange text-white text-[11px] font-bold flex items-center justify-center">{idx + 1}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Headline + CTA */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Cover headline</Label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base" placeholder="Deck Transformation in Weston" />
          </div>
          <div>
            <Label>Final slide (CTA)</Label>
            <input value={cta} onChange={(e) => setCta(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-gray-200 focus:border-omega-orange outline-none text-base" />
          </div>
        </div>

        {/* Per-photo captions */}
        {selected.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Slide captions</Label>
              <button onClick={suggestCaptions} disabled={suggesting} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-omega-orange text-xs font-semibold disabled:opacity-50">
                {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Suggest with AI
              </button>
            </div>
            <div className="space-y-2">
              {selected.map((u, i) => (
                <div key={u} className="flex items-center gap-2">
                  <img src={u} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                  <input value={captions[u] || ''} onChange={(e) => setCaptions((c) => ({ ...c, [u]: e.target.value }))}
                    placeholder={`Caption for slide ${i + 1}`} className="flex-1 px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange outline-none text-sm" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cover background — upload or generate with AI */}
        <div className="rounded-xl border border-gray-200 p-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            {customCover && <img src={customCover.url} alt="cover" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />}
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-gray-300 hover:border-omega-orange text-sm text-omega-stone cursor-pointer">
              <Upload className="w-4 h-4" /> {customCover ? 'Replace cover image' : 'Upload custom cover (optional)'}
              <input type="file" accept="image/*" className="hidden" onChange={onCustomCover} />
            </label>
            {customCover && <button onClick={() => setCustomCover(null)} className="text-xs text-red-600 inline-flex items-center gap-1"><X className="w-3.5 h-3.5" /> Remove</button>}
          </div>
          <div>
            <Label>Or generate a cover with AI (Higgsfield)</Label>
            <div className="flex gap-2">
              <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. modern pressure-treated backyard deck at golden hour, photorealistic"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 focus:border-omega-orange outline-none text-sm" />
              <button onClick={generateAiCover} disabled={aiBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-omega-charcoal text-white text-xs font-semibold disabled:opacity-60 whitespace-nowrap">
                {aiBusy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Sparkles className="w-3.5 h-3.5" /> Generate</>}
              </button>
            </div>
            {aiError && <p className="text-[11px] text-red-600 mt-1">{aiError}</p>}
            <p className="text-[11px] text-omega-stone mt-1">Needs <code>HIGGSFIELD_API_KEY</code> set in Vercel. The image becomes the cover background (with a dark overlay for the headline).</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button onClick={build} disabled={building || !selected.length} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-omega-orange hover:bg-omega-dark text-white text-sm font-bold disabled:opacity-60">
          {building ? <><Loader2 className="w-4 h-4 animate-spin" /> Building slides…</> : <><Layout className="w-4 h-4" /> Generate carousel</>}
        </button>
      </div>

      {/* Preview */}
      {slides.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-omega-charcoal text-sm">{slides.length} slides</h3>
            <button onClick={downloadAll} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-omega-charcoal text-white text-xs font-semibold">
              <Download className="w-3.5 h-3.5" /> Download all
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {slides.map((s, i) => (
              <div key={i} className="flex-shrink-0 w-40">
                <img src={s.dataUrl} className="w-40 rounded-xl border border-gray-200" />
                <a href={s.dataUrl} download={`omega-carousel-${String(i + 1).padStart(2, '0')}.png`}
                  className="mt-1.5 flex items-center justify-center gap-1 text-[11px] font-semibold text-omega-stone hover:text-omega-orange">
                  <Download className="w-3 h-3" /> {s.kind}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Canvas rendering ────────────────────────────────────────────────

function loadImage(url) {
  return new Promise((resolve, reject) => {
    fetch(url).then((r) => r.blob()).then((blob) => {
      const obj = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { resolve(img); };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = obj;
    }).catch(reject);
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function wordmark(ctx, cx, y, size) {
  ctx.textAlign = 'center';
  ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
  const a = 'OMEGA ', b = 'DEVELOPMENT';
  const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
  const start = cx - (wa + wb) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff'; ctx.fillText(a, start, y);
  ctx.fillStyle = ORANGE; ctx.fillText(b, start + wa, y);
  ctx.textAlign = 'center';
}

function baseCanvas(fmt) {
  const c = document.createElement('canvas');
  c.width = fmt.w; c.height = fmt.h;
  return c;
}

async function renderCover(fmt, headline, job, customCover) {
  const c = baseCanvas(fmt);
  const ctx = c.getContext('2d');
  ctx.fillStyle = CHARCOAL; ctx.fillRect(0, 0, fmt.w, fmt.h);
  if (customCover) {
    try { const img = await loadImage(customCover.url); drawCover(ctx, img, 0, 0, fmt.w, fmt.h); } catch { /* keep charcoal */ }
    ctx.fillStyle = 'rgba(20,24,21,0.55)'; ctx.fillRect(0, 0, fmt.w, fmt.h);
  }
  // orange accent bar
  ctx.fillStyle = ORANGE; ctx.fillRect(fmt.w / 2 - 60, fmt.h * 0.30, 120, 8);
  // headline
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
  ctx.font = `700 84px Inter, Arial, sans-serif`;
  const lines = wrapText(ctx, headline || 'Our Latest Project', fmt.w - 200).slice(0, 4);
  let y = fmt.h * 0.42;
  for (const ln of lines) { ctx.fillText(ln, fmt.w / 2, y); y += 100; }
  // wordmark + swipe
  wordmark(ctx, fmt.w / 2, fmt.h * 0.80, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `500 26px Inter, Arial, sans-serif`;
  ctx.fillText('Fairfield County, CT', fmt.w / 2, fmt.h * 0.80 + 42);
  ctx.fillStyle = ORANGE; ctx.font = `700 28px Inter, Arial, sans-serif`;
  ctx.fillText('swipe →', fmt.w / 2, fmt.h * 0.91);
  return c.toDataURL('image/png');
}

async function renderPhoto(fmt, url, caption, num, total) {
  const c = baseCanvas(fmt);
  const ctx = c.getContext('2d');
  ctx.fillStyle = CHARCOAL; ctx.fillRect(0, 0, fmt.w, fmt.h);
  try { const img = await loadImage(url); drawCover(ctx, img, 0, 0, fmt.w, fmt.h); }
  catch { ctx.fillStyle = '#333'; ctx.fillRect(0, 0, fmt.w, fmt.h); }
  // bottom gradient-ish bar (solid translucent — gradients flash, keep flat)
  const barH = caption ? 200 : 120;
  ctx.fillStyle = 'rgba(20,24,21,0.72)'; ctx.fillRect(0, fmt.h - barH, fmt.w, barH);
  ctx.fillStyle = ORANGE; ctx.fillRect(0, fmt.h - barH, 10, barH);
  if (caption) {
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
    ctx.font = `700 46px Inter, Arial, sans-serif`;
    const lines = wrapText(ctx, caption, fmt.w - 160).slice(0, 2);
    let y = fmt.h - barH + 70;
    for (const ln of lines) { ctx.fillText(ln, 50, y); y += 56; }
  }
  // wordmark left + slide counter right
  ctx.textAlign = 'left'; ctx.font = `700 24px Inter, Arial, sans-serif`;
  ctx.fillStyle = '#ffffff'; ctx.fillText('OMEGA ', 50, fmt.h - 36);
  const ow = ctx.measureText('OMEGA ').width;
  ctx.fillStyle = ORANGE; ctx.fillText('DEVELOPMENT', 50 + ow, fmt.h - 36);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 24px Inter, Arial, sans-serif`;
  ctx.fillText(`${num}/${total}`, fmt.w - 50, fmt.h - 36);
  return c.toDataURL('image/png');
}

async function renderCta(fmt, cta) {
  const c = baseCanvas(fmt);
  const ctx = c.getContext('2d');
  ctx.fillStyle = CHARCOAL; ctx.fillRect(0, 0, fmt.w, fmt.h);
  ctx.fillStyle = ORANGE; ctx.fillRect(fmt.w / 2 - 60, fmt.h * 0.34, 120, 8);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
  ctx.font = `700 76px Inter, Arial, sans-serif`;
  const lines = wrapText(ctx, cta || 'Book your free estimate', fmt.w - 220).slice(0, 3);
  let y = fmt.h * 0.46;
  for (const ln of lines) { ctx.fillText(ln, fmt.w / 2, y); y += 92; }
  wordmark(ctx, fmt.w / 2, fmt.h * 0.74, 34);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `500 26px Inter, Arial, sans-serif`;
  ctx.fillText('Licensed & insured · HIC.0670573', fmt.w / 2, fmt.h * 0.74 + 46);
  return c.toDataURL('image/png');
}

function Label({ children }) {
  return <label className="block text-[11px] font-bold uppercase tracking-wider text-omega-stone mb-1.5">{children}</label>;
}
function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors border ${active ? 'bg-omega-orange text-white border-omega-orange' : 'bg-white text-omega-stone border-gray-200 hover:border-omega-orange'}`}>{children}</button>
  );
}
