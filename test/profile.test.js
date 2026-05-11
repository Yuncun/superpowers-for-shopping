import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultProfile } from '../lib/profile.js';
import { readProfile, writeProfile } from '../lib/profile.js';
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
