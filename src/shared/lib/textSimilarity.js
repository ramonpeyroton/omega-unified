// ════════════════════════════════════════════════════════════════════
// Lightweight text similarity for the change-order overlap check.
// No AI, no external service. Pure tokenization + Jaccard index, which
// is more than enough to flag the obvious "we already billed for this"
// cases (think "install bathroom tile" vs "tile installation in
// bathroom"). Per Ramon (2026-04-27): just an in-app conferral, no API.
// ════════════════════════════════════════════════════════════════════

// English stop words plus a few construction-specific connectives that
// would otherwise inflate matches. Keep the list short — false-positive
// matches are way worse than missed ones for this UX.
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'in',
  'is', 'it', 'of', 'on', 'or', 'per', 'the', 'to', 'with', 'will',
  'this', 'that', 'these', 'those', 'all', 'any', 'each',
  'install', 'installs', 'installed', 'installation',
  'replace', 'replaced', 'replacement',
  'new', 'old', 'existing', 'including', 'includes',
]);

// Word-shaped chunks only (no spaces, punctuation, numbers).
// Lower-cased + length filter cuts down on noise like single-letter
// list bullets. Keeps numbers because "30x60" can be a tile dimension
// the seller meant to bill once.
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

// Jaccard index = |A ∩ B| / |A ∪ B|. Symmetric, easy to reason about.
// Returns 0..1. Empty inputs return 0.
function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Quick boolean: are two strings probably about the same thing?
// Threshold defaults to 0.5 (~half the unique words match) which is
// the sweet spot for the change-order use case after testing on the
// real estimate corpus.
export function isSimilar(a, b, threshold = 0.5) {
  return jaccard(tokenize(a), tokenize(b)) >= threshold;
}

// Given a change-order description (free text the operator just typed)
// and a list of items already on the estimate or signed contract,
// return everything that looks similar enough to flag. Each match is
// scored so the UI can rank them — highest-similarity item first.
//
// `items` is shaped like:
//   [{ description, scope, _source: 'Estimate' | 'Contract', _ref: 'OM-2042' }]
// The function does not care where the item came from — that metadata
// is just passed through so the warning UI can say "from the signed
// contract OM-2042".
export function findSimilarItems(coText, items, threshold = 0.5) {
  if (!coText || !Array.isArray(items) || items.length === 0) return [];
  const coTokens = tokenize(coText);
  if (coTokens.length === 0) return [];
  const scored = [];
  for (const it of items) {
    const haystack = `${it.description || ''} ${it.scope || ''}`.trim();
    const score = jaccard(coTokens, tokenize(haystack));
    if (score >= threshold) scored.push({ ...it, _score: score });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored;
}
