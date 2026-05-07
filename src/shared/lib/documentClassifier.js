// Document classifier for the bulk legacy upload feature.
//
// Strategy: cheap-first, fall back to expensive only when needed.
//
//   1. Video extension              → daily_logs (no AI)
//   2. Ask Haiku from filename only  → if confidence high, accept
//   3. Extract text from file (PDF / txt / html) → ask Haiku again
//   4. Image with no answer          → daily_logs (best guess)
//   5. Anything still unanswered     → 'other' (review pile)
//
// Cumulative cost is tracked in localStorage with a hard $10 cap as
// an airbag against runaway loops or retries.

import { callAnthropicShared } from './anthropic';

export const FOLDER_LABELS = {
  invoices:       'Invoices',
  receipts:       'Receipts',
  permits:        'Permits',
  building_plans: 'Building Plans',
  checks:         'Checks',
  contracts:      'Contracts',
  change_orders:  'Change Orders',
  daily_logs:     'Daily Logs Media',
  other:          'Other',
};

const CATEGORY_DESCRIPTIONS = {
  invoices:       'Bills FROM suppliers/vendors charging the company. Header usually says "Invoice".',
  receipts:       'Proof-of-purchase receipts (Home Depot, Lowes, gas, materials). Usually has store header + items.',
  permits:        'Building/zoning permits, applications, town approvals, inspection certificates.',
  building_plans: 'Architectural drawings, blueprints, floor plans, site plans, elevations.',
  checks:         'Photos or scans of paper checks (signed paper checks, voided checks).',
  contracts:      'Signed construction contracts, master agreements, proposals turned binding.',
  change_orders:  'Documents recording mid-project scope or cost changes (CO numbered).',
  daily_logs:     'Photos / videos of the jobsite, work in progress, before/after, punch list.',
  other:          'Anything that does not clearly fit any category above (warranties, letters, misc).',
};

const VIDEO_EXT = /\.(mov|mp4|avi|webm|mkv|m4v)$/i;
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i;
const PDF_EXT   = /\.pdf$/i;
const TEXT_EXT  = /\.(txt|md|html?|csv|json|log)$/i;

// Haiku 4.5 pricing (USD per 1M tokens). Update if Anthropic changes pricing.
const PRICE_INPUT_PER_MTOK  = 1.0;
const PRICE_OUTPUT_PER_MTOK = 5.0;
export const COST_CAP_USD   = 10.0;
const COST_KEY = 'omega_bulk_upload_cost_total';

export function getCumulativeCost() {
  const raw = Number(localStorage.getItem(COST_KEY));
  return Number.isFinite(raw) ? raw : 0;
}

export function resetCumulativeCost() {
  localStorage.setItem(COST_KEY, '0');
}

function addCost(usd) {
  const next = getCumulativeCost() + usd;
  localStorage.setItem(COST_KEY, String(next));
  return next;
}

export function isOverCap() {
  return getCumulativeCost() >= COST_CAP_USD;
}

// Token estimate from string length. ~4 chars/token is the rule of
// thumb for English; close enough for cost tracking purposes.
function estimateTokens(str) {
  return Math.ceil((str?.length || 0) / 4);
}

function buildSystemPrompt() {
  const lines = Object.entries(CATEGORY_DESCRIPTIONS)
    .map(([id, desc]) => `- ${id}: ${desc}`)
    .join('\n');
  return `You are classifying construction project documents into folders. Categories:\n${lines}`;
}

function buildPrompt({ filename, contentSnippet }) {
  const parts = [
    buildSystemPrompt(),
    '',
    `Filename: ${filename}`,
  ];
  if (contentSnippet) {
    parts.push('', `First chars of content:\n"""\n${contentSnippet}\n"""`);
  }
  parts.push(
    '',
    'Respond with ONLY this JSON, no preamble, no code fences:',
    '{"category":"<one of the ids above>","confidence":"high"|"medium"|"low"}',
    '',
    'Use "high" only when the filename or content makes the answer obvious.',
    'Use "low" when you are essentially guessing — that signals we should read the file content.',
    'The "category" field MUST be one of the exact ids listed.',
  );
  return parts.join('\n');
}

function parseAnswer(raw) {
  try {
    // Strip anything before the first { and after the last }.
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    const obj = JSON.parse(raw.slice(s, e + 1));
    if (!FOLDER_LABELS[obj.category]) return null;
    if (!['high', 'medium', 'low'].includes(obj.confidence)) {
      obj.confidence = 'low';
    }
    return obj;
  } catch {
    return null;
  }
}

async function askClaude(prompt) {
  if (isOverCap()) {
    const err = new Error(`Cost cap of $${COST_CAP_USD} reached. Bulk upload paused.`);
    err.code = 'COST_CAP';
    throw err;
  }
  // Prefill with `{` so Claude can't preface with prose.
  const raw = await callAnthropicShared(prompt, 80, { prefill: '{' });
  // Estimate cost: input ~ prompt size, output ~ 30 tokens.
  const inTok  = estimateTokens(prompt);
  const outTok = 30;
  const cost = (inTok / 1_000_000) * PRICE_INPUT_PER_MTOK
             + (outTok / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  addCost(cost);
  return parseAnswer(raw);
}

// Lazy-loaded pdfjs to keep it out of the main bundle. Worker URL
// hint via Vite's `?url` import.
let _pdfjsPromise = null;
function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return _pdfjsPromise;
}

async function extractPdfText(file, maxChars = 800) {
  try {
    const pdfjs = await loadPdfjs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    let text = '';
    // Read up to first 2 pages — enough to identify a header/title.
    const pages = Math.min(pdf.numPages, 2);
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += ' ' + content.items.map((it) => it.str).join(' ');
      if (text.length >= maxChars) break;
    }
    return text.trim().slice(0, maxChars);
  } catch {
    return null;
  }
}

async function extractTextFile(file, maxChars = 800) {
  try {
    const text = await file.text();
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

// Pull a usable snippet from the file when we need extra signal.
// Returns null when extraction is not supported (images, videos, docx).
export async function extractContentSnippet(file) {
  if (PDF_EXT.test(file.name))  return await extractPdfText(file);
  if (TEXT_EXT.test(file.name)) return await extractTextFile(file);
  return null;
}

// Run the full classification pipeline for a single file.
// Returns: { folder, confidence, source }
//   source ∈ 'extension' | 'filename-ai' | 'content-ai' | 'image-fallback' | 'unclassified'
export async function classifyFile(file) {
  // 1. Videos are always Daily Logs Media. No AI needed.
  if (VIDEO_EXT.test(file.name)) {
    return { folder: 'daily_logs', confidence: 'high', source: 'extension' };
  }

  // 2. First pass: filename only.
  const byName = await askClaude(buildPrompt({ filename: file.name }));
  if (byName && byName.confidence === 'high') {
    return { folder: byName.category, confidence: 'high', source: 'filename-ai' };
  }

  // 3. Try reading content for ambiguous cases.
  const snippet = await extractContentSnippet(file);
  if (snippet && snippet.length > 20) {
    const byContent = await askClaude(buildPrompt({ filename: file.name, contentSnippet: snippet }));
    if (byContent && byContent.confidence !== 'low') {
      return { folder: byContent.category, confidence: byContent.confidence, source: 'content-ai' };
    }
    // Even low-confidence content read is better than image fallback or "other".
    if (byContent) {
      return { folder: byContent.category, confidence: 'low', source: 'content-ai' };
    }
  }

  // 4. Image with no answer → daily_logs (most likely jobsite photo).
  if (IMAGE_EXT.test(file.name)) {
    return { folder: 'daily_logs', confidence: 'low', source: 'image-fallback' };
  }

  // 5. Filename pass had a guess but we couldn't confirm — accept low-conf.
  if (byName && byName.category) {
    return { folder: byName.category, confidence: 'low', source: 'filename-ai' };
  }

  // 6. Total miss → "other" so the file still lands somewhere reviewable.
  return { folder: 'other', confidence: 'low', source: 'unclassified' };
}
