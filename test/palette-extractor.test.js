// test/palette-extractor.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractColorsFromProduct,
  mergePaletteCandidates,
} from '../lib/palette-extractor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeProduct = (overrides = {}) => ({
  title: 'Some Sweater',
  brand: 'Marine Layer',
  price: '$98.50',
  url: 'https://example.com/products/some-sweater',
  variants: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// extractColorsFromProduct
// ---------------------------------------------------------------------------

test('1: variants[0].color = "Navy Heather" → ["navy"] (heather is IGNORED)', () => {
  const product = makeProduct({
    variants: [{ variant_id: 1, size: 'M', color: 'Navy Heather', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['navy']);
});

test('2: variants[0].color = "Olive" → ["olive"]', () => {
  const product = makeProduct({
    variants: [{ variant_id: 1, size: 'M', color: 'Olive', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['olive']);
});

test('3: variants[0].color = "Navy / Cream" → ["navy", "cream"] (split on /)', () => {
  const product = makeProduct({
    variants: [{ variant_id: 1, size: 'M', color: 'Navy / Cream', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['navy', 'cream']);
});

test('4: variants[0].color = "Forest Green" → ["forest", "green"] (both kept)', () => {
  const product = makeProduct({
    variants: [{ variant_id: 1, size: 'M', color: 'Forest Green', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['forest', 'green']);
});

test('5: variants[0].color empty AND title has "Charcoal Wool Crewneck" → ["charcoal"]', () => {
  const product = makeProduct({
    title: 'Charcoal Wool Crewneck',
    variants: [{ variant_id: 1, size: 'M', color: '', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['charcoal']);
});

test('6: variants[0].color empty AND title has no known color → []', () => {
  const product = makeProduct({
    title: 'Marine Wool Crewneck',
    variants: [{ variant_id: 1, size: 'M', color: '', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), []);
});

test('7: no variants array → falls through to title scan', () => {
  const product = makeProduct({
    title: 'Navy Wool Crewneck',
    variants: undefined,
  });
  assert.deepEqual(extractColorsFromProduct(product), ['navy']);
});

test('8: product = {} → []', () => {
  assert.deepEqual(extractColorsFromProduct({}), []);
});

test('9: product = null or undefined → []', () => {
  assert.deepEqual(extractColorsFromProduct(null), []);
  assert.deepEqual(extractColorsFromProduct(undefined), []);
});

test('10: variants[0].color = "Heather Grey" → ["grey"] (heather filtered, grey kept)', () => {
  const product = makeProduct({
    variants: [{ variant_id: 1, size: 'M', color: 'Heather Grey', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['grey']);
});

test('11: variants[0].color = "Space-Dyed Charcoal" → ["charcoal"] (space filtered)', () => {
  const product = makeProduct({
    variants: [{ variant_id: 1, size: 'M', color: 'Space-Dyed Charcoal', price: '$98.50' }],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['charcoal']);
});

test('12: title scan is case-insensitive: "NAVY Crew" → ["navy"]', () => {
  const product = makeProduct({
    title: 'NAVY Crew',
    variants: [],
  });
  assert.deepEqual(extractColorsFromProduct(product), ['navy']);
});

// ---------------------------------------------------------------------------
// mergePaletteCandidates
// ---------------------------------------------------------------------------

test('13: empty palette + ["navy"] → ["navy"]', () => {
  assert.deepEqual(mergePaletteCandidates([], ['navy']), ['navy']);
});

test('14: palette ["Navy"] + new ["navy"] → ["Navy"] (case-insensitive dedup, existing kept)', () => {
  assert.deepEqual(mergePaletteCandidates(['Navy'], ['navy']), ['Navy']);
});

test('15: palette ["navy", "olive"] + new ["cream"] → ["navy", "olive", "cream"]', () => {
  assert.deepEqual(
    mergePaletteCandidates(['navy', 'olive'], ['cream']),
    ['navy', 'olive', 'cream']
  );
});

test('16: palette at max (8) + new ["cream"] → existing 8 unchanged (no append)', () => {
  const palette = ['navy', 'olive', 'cream', 'charcoal', 'black', 'white', 'tan', 'beige'];
  assert.deepEqual(mergePaletteCandidates(palette, ['rust']), palette);
});

test('17: palette ["navy"] + new ["navy", "cream"] → ["navy", "cream"] (dedup, then append)', () => {
  assert.deepEqual(
    mergePaletteCandidates(['navy'], ['navy', 'cream']),
    ['navy', 'cream']
  );
});

test('18: palette ["navy"] + new [] → ["navy"] (no-op)', () => {
  assert.deepEqual(mergePaletteCandidates(['navy'], []), ['navy']);
});
