// test/ranking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRanking } from '../lib/ranking.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const c = (brand, price, title = 'x', url = `https://${brand.toLowerCase().replace(/\s+/g, '')}.com/products/x`) =>
  ({ brand, price, title, url, image: null, variants: [] });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('1: empty candidates → empty array', () => {
  const result = applyRanking([], {});
  assert.deepEqual(result, []);
});

test('2: empty profile → returns candidates unchanged', () => {
  const candidates = [c('Marine Layer', '49.00'), c('Uniqlo', '29.00')];
  const result = applyRanking(candidates, {});
  assert.deepEqual(result, candidates);
});

test('3: brands_avoid drops matching brand (exact case-insensitive match)', () => {
  const kept = c('Marine Layer', '49.00');
  const dropped = c('Shein', '9.00');
  const result = applyRanking([kept, dropped], { brands_avoid: ['shein'] });
  assert.deepEqual(result, [kept]);
});

test('4: brands_avoid uses substring match — "shein" drops "Shein, Inc."', () => {
  const kept = c('Marine Layer', '49.00');
  const dropped = c('Shein, Inc.', '9.00');
  const result = applyRanking([kept, dropped], { brands_avoid: ['shein'] });
  assert.deepEqual(result, [kept]);
});

test('5: brands_avoid empty array → no drops', () => {
  const candidates = [c('Shein', '9.00'), c('Temu', '5.00')];
  const result = applyRanking(candidates, { brands_avoid: [] });
  assert.deepEqual(result, candidates);
});

test('6: brands_love reorders matching brands to front, preserves order within each group', () => {
  const a = c('Other Brand', '50.00', 'a');
  const b = c('Marine Layer', '50.00', 'b');
  const cc2 = c('Another Brand', '50.00', 'c');
  const result = applyRanking([a, b, cc2], { brands_love: ['marine layer'] });
  assert.deepEqual(result, [b, a, cc2]);
});

test('7: brands_love empty → no reorder', () => {
  const candidates = [c('Marine Layer', '50.00', 'a'), c('Uniqlo', '30.00', 'b')];
  const result = applyRanking(candidates, { brands_love: [] });
  assert.deepEqual(result, candidates);
});

test('8: brands_love + brands_avoid combined — avoid applies before love reorders', () => {
  // brands_avoid drops 'Shein', brands_love puts 'Marine Layer' first.
  const ml = c('Marine Layer', '50.00', 'ml');
  const sh = c('Shein', '5.00', 'sh');
  const oth = c('Other Brand', '40.00', 'oth');
  const result = applyRanking([oth, ml, sh], {
    brands_avoid: ['shein'],
    brands_love: ['marine layer'],
  });
  // sh dropped first, then ml floated to front.
  assert.deepEqual(result, [ml, oth]);
});

test('9: budget_caps.clothes drops candidates over the limit', () => {
  const cheap = c('Brand A', '49.00');
  const expensive = c('Brand B', '201.00');
  const result = applyRanking([cheap, expensive], { budget_caps: { clothes: 200 } });
  assert.deepEqual(result, [cheap]);
});

test('10: budget_caps.clothes absent → no budget filter', () => {
  const candidates = [c('Brand A', '500.00'), c('Brand B', '1000.00')];
  const result = applyRanking(candidates, { budget_caps: {} });
  assert.deepEqual(result, candidates);
});

test('11: budget_caps.clothes present but price is null → KEEP candidate', () => {
  const nullPrice = c('Brand A', null);
  const result = applyRanking([nullPrice], { budget_caps: { clothes: 50 } });
  assert.deepEqual(result, [nullPrice]);
});

test('12: budget_caps.clothes present and price has "$" prefix → parsePrice handles it', () => {
  const kept = c('Brand A', '$98.50');
  const dropped = c('Brand B', '$201.00');
  const result = applyRanking([kept, dropped], { budget_caps: { clothes: 200 } });
  assert.deepEqual(result, [kept]);
});

test('13: all candidates filtered out → empty array', () => {
  const candidates = [c('Shein', '9.00'), c('Temu', '4.00')];
  const result = applyRanking(candidates, { brands_avoid: ['shein', 'temu'] });
  assert.deepEqual(result, []);
});

test('14: adversarial — profile.brands_avoid: null → no crash, no filtering', () => {
  const candidates = [c('Shein', '9.00'), c('Temu', '4.00')];
  // Must not throw; must return both candidates (no filtering because null coerces to []).
  let result;
  assert.doesNotThrow(() => {
    result = applyRanking(candidates, { brands_avoid: null });
  });
  assert.deepEqual(result, candidates);
});
