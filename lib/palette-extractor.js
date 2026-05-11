// lib/palette-extractor.js
// Pure palette-extraction module. No I/O. Synchronous.
// The caller (flow) is responsible for reading profile.palette and writing
// the merged result back; this module never touches the profile.

const IGNORED_COLOR_TOKENS = new Set([
  'heather',
  'melange',
  'marl',
  'wash',
  'fade',
  'space',
]);

const KNOWN_COLOR_TOKENS = new Set([
  'navy',
  'cream',
  'olive',
  'charcoal',
  'black',
  'white',
  'grey',
  'gray',
  'tan',
  'beige',
  'khaki',
  'rust',
  'forest',
  'sand',
  'stone',
  'oat',
  'bone',
  'ivory',
  'slate',
  'indigo',
  'denim',
  'mustard',
  'burgundy',
  'wine',
  'camel',
  'cognac',
  'sage',
  'mint',
  'coral',
  'blush',
  'rose',
  'mauve',
  'lavender',
  'plum',
  'terracotta',
  'ochre',
  'mocha',
  'espresso',
  'chocolate',
  'pine',
  'moss',
  'sky',
  'ocean',
  // 'green' is intentionally outside the curated single-color list but accepted
  // as a variant-color token below (e.g. "Forest Green" → ['forest', 'green']).
  'green',
]);

const MAX_VARIANT_TOKENS = 2;

/**
 * Normalize a free-form color string into an array of lowercased tokens.
 * Splits on whitespace, commas, slashes, and hyphens; drops empties.
 * @param {string} s
 * @returns {string[]}
 */
function normalizeColorString(s) {
  return String(s)
    .toLowerCase()
    .split(/[\s,/\-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Extract color tokens from a candidate product.
 *
 * Order of operations:
 * 1. If variants[0].color is a non-empty string, normalize it, drop tokens in
 *    IGNORED_COLOR_TOKENS, restrict to KNOWN_COLOR_TOKENS, and keep the first
 *    MAX_VARIANT_TOKENS survivors. Filtering against KNOWN avoids garbage
 *    tokens like "dyed" in "Space-Dyed Charcoal" leaking into the palette.
 * 2. Otherwise scan the title for whole-word matches against KNOWN_COLOR_TOKENS.
 * 3. If both steps yielded nothing, return [].
 *
 * Pure, synchronous. Never throws on missing/malformed input.
 *
 * @param {object|null|undefined} product
 * @returns {string[]} lowercased color tokens
 */
export function extractColorsFromProduct(product) {
  if (product == null || typeof product !== 'object') return [];

  // Step 1: variant color.
  const variants = Array.isArray(product.variants) ? product.variants : null;
  if (variants && variants.length > 0) {
    const first = variants[0];
    const raw = first && typeof first.color === 'string' ? first.color : '';
    if (raw.trim() !== '') {
      const tokens = normalizeColorString(raw)
        .filter((t) => !IGNORED_COLOR_TOKENS.has(t) && KNOWN_COLOR_TOKENS.has(t))
        .slice(0, MAX_VARIANT_TOKENS);
      if (tokens.length > 0) return tokens;
    }
  }

  // Step 2: title scan.
  const title = typeof product.title === 'string' ? product.title : '';
  if (title.trim() === '') return [];

  const titleTokens = title.toLowerCase().split(/\W+/).filter(Boolean);
  const titleSet = new Set(titleTokens);
  const found = [];
  for (const token of KNOWN_COLOR_TOKENS) {
    if (titleSet.has(token)) found.push(token);
  }
  return found;
}

/**
 * Merge new color tokens into an existing palette.
 *
 * - Case-insensitive dedup against existing entries (existing form is kept).
 * - Order preserved (existing first, then new tokens in given order).
 * - All-or-nothing on cap overflow: if appending the deduped new tokens would
 *   push the result past `max`, return the existing palette unchanged.
 *
 * Never mutates inputs.
 *
 * @param {string[]} existingPalette
 * @param {string[]} newTokens
 * @param {number} [max=8]
 * @returns {string[]}
 */
export function mergePaletteCandidates(existingPalette, newTokens, max = 8) {
  const existing = Array.isArray(existingPalette) ? existingPalette : [];
  const incoming = Array.isArray(newTokens) ? newTokens : [];

  const lowerSet = new Set(existing.map((t) => String(t).toLowerCase()));
  const additions = [];
  for (const raw of incoming) {
    const lower = String(raw).toLowerCase();
    if (lowerSet.has(lower)) continue;
    lowerSet.add(lower);
    additions.push(lower);
  }

  if (additions.length === 0) return [...existing];
  if (existing.length + additions.length > max) return [...existing];

  return [...existing, ...additions];
}
