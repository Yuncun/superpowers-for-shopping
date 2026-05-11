import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultProfile,
  readProfile,
  writeProfile,
  validateProfile,
  appendPurchase,
  appendThumbSignal,
  updateFrontmatter,
} from '../lib/profile.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('getDefaultProfile returns expected schema', () => {
  const p = getDefaultProfile();
  assert.equal(typeof p, 'object');
  assert.ok(p.sizes);
  assert.equal(p.budget_default, 'mid');
  assert.ok(Array.isArray(p.palette));
  assert.ok(Array.isArray(p.brands_love));
  assert.ok(Array.isArray(p.brands_avoid));
  assert.equal(p.moodboard_url, '');
  assert.ok(p.purchase_history);
  assert.ok(p.thumb_signals);
  assert.equal(p.purchase_history.length, 0);
  assert.equal(p.thumb_signals.length, 0);
});

test('readProfile returns default when file does not exist', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  const p = await readProfile();
  assert.equal(p.budget_default, 'mid');
  assert.equal(p.purchase_history.length, 0);
});

test('readProfile parses an existing profile.md', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await fs.mkdir(path.join(tmp, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.claude/cart/profile.md'), `---
sizes:
  top: M
budget_default: high
palette: [navy, olive]
brands_love: [Marine Layer]
brands_avoid: []
moodboard_url: ""
last_setup: 2026-05-10
---

# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|

# Thumb signals
| date | category | up | down |
|---|---|---|---|
`);
  const p = await readProfile();
  assert.equal(p.sizes.top, 'M');
  assert.equal(p.budget_default, 'high');
  assert.deepEqual(p.palette, ['navy', 'olive']);
  assert.deepEqual(p.brands_love, ['Marine Layer']);
});

test('writeProfile then readProfile round-trips', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  const original = {
    ...getDefaultProfile(),
    sizes: { top: 'M', bottom: '32x32' },
    budget_default: 'mid',
    palette: ['navy', 'cream'],
    brands_love: ['Marine Layer', 'Uniqlo'],
    brands_avoid: ['Shein'],
    last_setup: '2026-05-10',
  };
  await writeProfile(original);
  const restored = await readProfile();
  assert.deepEqual(restored.sizes, original.sizes);
  assert.deepEqual(restored.palette, original.palette);
  assert.deepEqual(restored.brands_love, original.brands_love);
  assert.equal(restored.last_setup, original.last_setup);
});

test('writeProfile creates the cart dir if missing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  const stat = await fs.stat(path.join(tmp, '.claude/cart/profile.md'));
  assert.ok(stat.isFile());
});

test('validateProfile passes a complete profile', () => {
  const p = {
    ...getDefaultProfile(),
    sizes: { top: 'M' },
    budget_default: 'mid',
  };
  assert.equal(validateProfile(p).valid, true);
});

test('validateProfile flags missing budget_default', () => {
  const p = { ...getDefaultProfile(), budget_default: undefined };
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('budget_default')));
});

test('validateProfile flags invalid budget_default value', () => {
  const p = { ...getDefaultProfile(), budget_default: 'extravagant' };
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('budget_default')));
});

test('validateProfile flags non-array palette', () => {
  const p = { ...getDefaultProfile(), palette: 'navy' };
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('palette')));
});

test('appendPurchase adds a row to purchase_history', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  await appendPurchase({
    date: '2026-05-10',
    item: 'sweater',
    brand: 'Marine Layer',
    $: '98',
    kept: '?',
    notes: 'navy crew',
  });
  const p = await readProfile();
  assert.equal(p.purchase_history.length, 1);
  assert.equal(p.purchase_history[0].brand, 'Marine Layer');
});

test('appendThumbSignal adds a row to thumb_signals', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  await appendThumbSignal({
    date: '2026-05-10',
    category: 'sweater',
    up: 'ribbed crew',
    down: 'oversized',
  });
  const p = await readProfile();
  assert.equal(p.thumb_signals.length, 1);
  assert.equal(p.thumb_signals[0].up, 'ribbed crew');
});

test('updateFrontmatter merges shallow fields', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile({ ...getDefaultProfile(), brands_avoid: ['Shein'] });
  await updateFrontmatter({ brands_avoid: ['Shein', 'Temu'] });
  const p = await readProfile();
  assert.deepEqual(p.brands_avoid, ['Shein', 'Temu']);
});

test('updateFrontmatter deep-merges fit_notes', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile({ ...getDefaultProfile(), fit_notes: { sweater: 'relaxed' } });
  await updateFrontmatter({ fit_notes: { pants: 'tapered' } });
  const p = await readProfile();
  assert.equal(p.fit_notes.sweater, 'relaxed');
  assert.equal(p.fit_notes.pants, 'tapered');
});

// --- Robustness / adversarial-input tests ---

test('writeProfile sanitizes pipe characters in cell values', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  await appendThumbSignal({
    date: '2026-05-10',
    category: 'sweater',
    up: 'sleek | minimal',
    down: 'chunky',
  });
  const p = await readProfile();
  assert.equal(p.thumb_signals.length, 1);
  assert.ok(!p.thumb_signals[0].up.includes('|'), 'pipe should be sanitized in stored value');
  assert.equal(p.thumb_signals[0].down, 'chunky', 'subsequent column must not be corrupted');
});

test('readProfile throws a helpful error when YAML is malformed', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await fs.mkdir(path.join(tmp, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.claude/cart/profile.md'), `---
budget_default: [unterminated
---

# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|

# Thumb signals
| date | category | up | down |
|---|---|---|---|
`);
  await assert.rejects(
    () => readProfile(),
    err => err.message.includes('profile.md') && err.message.toLowerCase().includes('yaml')
  );
});

test('readProfile preserves last_setup as a string', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await fs.mkdir(path.join(tmp, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.claude/cart/profile.md'), `---
sizes: {}
budget_default: mid
budget_caps: {}
palette: []
brands_love: []
brands_avoid: []
fit_notes: {}
moodboard_url: ""
last_setup: 2026-05-10
---

# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|

# Thumb signals
| date | category | up | down |
|---|---|---|---|
`);
  const p = await readProfile();
  assert.equal(typeof p.last_setup, 'string', 'last_setup must stay a string, not a Date');
  assert.equal(p.last_setup, '2026-05-10');
});

test('writeProfile + readProfile preserves last_setup format', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile({ ...getDefaultProfile(), last_setup: '2026-05-10' });
  const raw = await fs.readFile(path.join(tmp, '.claude/cart/profile.md'), 'utf8');
  assert.ok(raw.includes('last_setup: '));
  assert.ok(!raw.includes('T00:00:00'), 'ISO date should not get expanded to full datetime');
});

test('parseTable tolerates rows without trailing pipe', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await fs.mkdir(path.join(tmp, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.claude/cart/profile.md'), `---
sizes: {}
budget_default: mid
budget_caps: {}
palette: []
brands_love: []
brands_avoid: []
fit_notes: {}
moodboard_url: ""
last_setup: 2026-05-10
---

# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|
| 2026-05-10 | sweater | Marine Layer | 98 | yes | navy crew

# Thumb signals
| date | category | up | down |
|---|---|---|---|
`);
  const p = await readProfile();
  assert.equal(p.purchase_history.length, 1);
  assert.equal(p.purchase_history[0].notes, 'navy crew', 'last column should not be dropped when trailing pipe missing');
});

test('writeProfile sanitizes newlines in cell values', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  await appendPurchase({
    date: '2026-05-10',
    item: 'sweater',
    brand: 'Marine Layer',
    $: '98',
    kept: '?',
    notes: 'line1\nline2',
  });
  const p = await readProfile();
  assert.equal(p.purchase_history.length, 1, 'newline must not split the row');
  assert.ok(!p.purchase_history[0].notes.includes('\n'));
  assert.ok(p.purchase_history[0].notes.includes('line1'));
  assert.ok(p.purchase_history[0].notes.includes('line2'));
});
