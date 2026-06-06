// pdfPages — render each page of a PDF to a JPEG in the browser.
//
// Reuses the same pdf.js CDN technique as ProjectAnalyzer, but returns
// BOTH a base64 string (to hand to Claude for OCR) and a Blob (to
// upload straight to Supabase Storage). Used by the admin Bulk Receipt
// Import tool, where one PDF page == one receipt.
//
// We render a bit larger / higher quality than the report analyzer
// (faint thermal receipts need every pixel to stay legible for the AI
// and for the human reviewer).

const PDFJS_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF renderer'));
    document.head.appendChild(script);
  });
}

/**
 * Render a PDF File into one image per page.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {number} [opts.maxWidth=1600]  target render width in px
 * @param {number} [opts.quality=0.85]   JPEG quality 0..1
 * @param {number} [opts.maxPages=60]    safety cap on pages processed
 * @param {(page:number,total:number)=>void} [opts.onProgress]
 * @returns {Promise<{ pages: Array<{pageNumber:number, base64:string, dataUrl:string, blob:Blob}>, totalPages:number }>}
 */
export async function pdfToPageImages(file, opts = {}) {
  const {
    maxWidth = 1600,
    quality = 0.85,
    maxPages = 60,
    onProgress,
  } = opts;

  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const pages = [];

  for (let i = 1; i <= pageCount; i++) {
    onProgress?.(i, pageCount);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    // Scale up narrow/small pages (receipts) for more legible pixels,
    // but never beyond 2x so we don't blow up the canvas needlessly.
    const scale = Math.min(2, Math.max(1, maxWidth / viewport.width));
    const scaled = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    const ctx = canvas.getContext('2d');
    // White matte — scanned receipts otherwise render on transparent.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64  = dataUrl.split(',')[1];
    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );

    pages.push({ pageNumber: i, base64, dataUrl, blob });
  }

  return { pages, totalPages: pdf.numPages };
}
