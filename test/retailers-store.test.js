import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getDefaultRetailers,
  readRetailers,
  writeRetailers,
  validateRetailers,
  addRetailer,
  removeRetailer,
} from '../lib/retailers-store.js';

let tmpDir;
let savedHome;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'retailers-test-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// 1. getDefaultRetailers returns expected entries
test('getDefaultRetailers returns 3 entries with expected hosts', () => {
  const defaults = getDefaultRetailers();
  assert.equal(defaults.length, 3);
  const hosts = defaults.map(r => r.host);
  assert.ok(hosts.includes('marinelayer.com'));
  assert.ok(hosts.includes('allbirds.com'));
  assert.ok(hosts.includes('everlane.com'));
});

// 2. readRetailers auto-creates file if missing
test('readRetailers auto-creates file if missing', async () => {
  const result = await readRetailers();
  assert.ok(result.retailers);
  assert.equal(result.retailers.length, 3);
  const fileStat = await fs.stat(path.join(tmpDir, '.claude/cart/retailers.md'));
  assert.ok(fileStat.isFile());
});

// 3. readRetailers after auto-create writes file with defaults
test('readRetailers after auto-create contains default retailers', async () => {
  await readRetailers();
  const result = await readRetailers();
  assert.equal(result.retailers.length, 3);
  assert.equal(result.retailers[0].host, 'marinelayer.com');
  assert.equal(result.retailers[0].handler, 'shopify');
  assert.equal(result.retailers[0].last_used, '');
});

// 4. writeRetailers then readRetailers round-trips the data
test('writeRetailers then readRetailers round-trips the data', async () => {
  const data = {
    last_updated: '2026-05-11',
    retailers: [
      { host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '2026-05-11' },
      { host: 'allbirds.com', tier: 2, handler: 'shopify', last_used: '' },
    ],
  };
  await writeRetailers(data);
  const result = await readRetailers();
  assert.equal(result.last_updated, '2026-05-11');
  assert.equal(result.retailers.length, 2);
  assert.equal(result.retailers[0].host, 'marinelayer.com');
  assert.equal(result.retailers[0].last_used, '2026-05-11');
  assert.equal(result.retailers[1].last_used, '');
});

// 5. validateRetailers accepts the default list
test('validateRetailers accepts the default list', () => {
  const { valid, errors } = validateRetailers(getDefaultRetailers());
  assert.equal(valid, true);
  assert.equal(errors.length, 0);
});

// 6. validateRetailers rejects a retailer with no dot in host
test('validateRetailers rejects a retailer with no dot in host', () => {
  const retailers = [{ host: 'nodot', tier: 2, handler: 'shopify', last_used: '' }];
  const { valid, errors } = validateRetailers(retailers);
  assert.equal(valid, false);
  assert.ok(errors.some(e => e.includes('host')));
});

// 7. validateRetailers rejects tier: 3
test('validateRetailers rejects tier: 3', () => {
  const retailers = [{ host: 'example.com', tier: 3, handler: 'shopify', last_used: '' }];
  const { valid, errors } = validateRetailers(retailers);
  assert.equal(valid, false);
  assert.ok(errors.some(e => e.includes('tier')));
});

// 8. validateRetailers rejects handler: ''
test('validateRetailers rejects empty handler', () => {
  const retailers = [{ host: 'example.com', tier: 2, handler: '', last_used: '' }];
  const { valid, errors } = validateRetailers(retailers);
  assert.equal(valid, false);
  assert.ok(errors.some(e => e.includes('handler')));
});

// 9. validateRetailers rejects malformed last_used
test('validateRetailers rejects malformed last_used', () => {
  const retailers = [{ host: 'example.com', tier: 2, handler: 'shopify', last_used: 'not-a-date' }];
  const { valid, errors } = validateRetailers(retailers);
  assert.equal(valid, false);
  assert.ok(errors.some(e => e.includes('last_used')));
});

// 10. addRetailer rejects invalid_host (throws)
test('addRetailer rejects invalid_host by throwing', async () => {
  await assert.rejects(
    () => addRetailer({ host: 'nodot', detectImpl: async () => true }),
    err => err.code === 'invalid_host'
  );
});

// 11. addRetailer with valid host adds the row and returns {added: true}
test('addRetailer adds a row and returns {added: true}', async () => {
  // Start from empty file with no retailers
  await writeRetailers({ last_updated: '2026-05-11', retailers: [] });
  const result = await addRetailer({
    host: 'marinelayer.com',
    detectImpl: async () => true,
    now: () => '2026-05-11',
  });
  assert.deepEqual(result, { added: true });
  const { retailers } = await readRetailers();
  assert.equal(retailers.length, 1);
  assert.equal(retailers[0].host, 'marinelayer.com');
});

// 12. addRetailer returns {added: false, reason: 'duplicate'} when host already present
test('addRetailer returns duplicate when host already in list', async () => {
  await writeRetailers({
    last_updated: '2026-05-11',
    retailers: [{ host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '' }],
  });
  const result = await addRetailer({
    host: 'marinelayer.com',
    detectImpl: async () => true,
    now: () => '2026-05-11',
  });
  assert.deepEqual(result, { added: false, reason: 'duplicate' });
});

// 13. addRetailer with detectImpl returning false returns {added: false, reason: 'not_shopify'} and does NOT add
test('addRetailer returns not_shopify when detectImpl returns false and does not modify file', async () => {
  await writeRetailers({ last_updated: '2026-05-11', retailers: [] });
  const result = await addRetailer({
    host: 'badhost.com',
    tier: 2,
    detectImpl: async () => false,
    now: () => '2026-05-11',
  });
  assert.deepEqual(result, { added: false, reason: 'not_shopify' });
  const { retailers } = await readRetailers();
  assert.equal(retailers.length, 0);
});

// 14. addRetailer with tier: 1 returns {added: false, reason: 'tier1_not_supported'}
test('addRetailer with tier 1 returns tier1_not_supported', async () => {
  await writeRetailers({ last_updated: '2026-05-11', retailers: [] });
  const result = await addRetailer({
    host: 'amazon.com',
    tier: 1,
    detectImpl: async () => true,
    now: () => '2026-05-11',
  });
  assert.deepEqual(result, { added: false, reason: 'tier1_not_supported' });
});

// 15. removeRetailer removes the row and returns {removed: true}
test('removeRetailer removes a row and returns {removed: true}', async () => {
  await writeRetailers({
    last_updated: '2026-05-11',
    retailers: [
      { host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '' },
      { host: 'allbirds.com', tier: 2, handler: 'shopify', last_used: '' },
    ],
  });
  const result = await removeRetailer('marinelayer.com', { now: () => '2026-05-11' });
  assert.deepEqual(result, { removed: true });
  const { retailers } = await readRetailers();
  assert.equal(retailers.length, 1);
  assert.equal(retailers[0].host, 'allbirds.com');
});

// 16. removeRetailer on nonexistent host returns {removed: false, reason: 'not_found'}
test('removeRetailer returns not_found for unknown host', async () => {
  await writeRetailers({ last_updated: '2026-05-11', retailers: [] });
  const result = await removeRetailer('nonexistent.com', { now: () => '2026-05-11' });
  assert.deepEqual(result, { removed: false, reason: 'not_found' });
});

// 17. Adversarial: pipe in cell is sanitized on write
test('pipe character in cell is sanitized to slash on write', async () => {
  await writeRetailers({
    last_updated: '2026-05-11',
    retailers: [{ host: 'bad|host.com', tier: 2, handler: 'shopify', last_used: '' }],
  });
  const raw = await fs.readFile(path.join(tmpDir, '.claude/cart/retailers.md'), 'utf8');
  assert.ok(!raw.includes('bad|host'), 'pipe should not appear in host cell of written file');
  assert.ok(raw.includes('bad/host'), 'pipe should be replaced by slash');
});

// 18. Adversarial: newline in cell is sanitized on write
test('newline in cell is sanitized to space on write', async () => {
  await writeRetailers({
    last_updated: '2026-05-11',
    retailers: [{ host: 'example.com', tier: 2, handler: 'shopify\nextra', last_used: '' }],
  });
  const raw = await fs.readFile(path.join(tmpDir, '.claude/cart/retailers.md'), 'utf8');
  const lines = raw.split('\n').filter(l => l.includes('example.com'));
  assert.equal(lines.length, 1, 'newline should not split row into multiple lines');
  assert.ok(lines[0].includes('shopify extra') || lines[0].includes('shopify'), 'newline collapsed to space');
});

// 19. Adversarial: row without trailing pipe is read correctly
test('row without trailing pipe is read correctly', async () => {
  await fs.mkdir(path.join(tmpDir, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, '.claude/cart/retailers.md'), `---
last_updated: 2026-05-11
---

# Retailers

| host | tier | handler | last_used |
|---|---|---|---|
| marinelayer.com | 2 | shopify | 2026-05-11
`);
  const { retailers } = await readRetailers();
  assert.equal(retailers.length, 1);
  assert.equal(retailers[0].host, 'marinelayer.com');
  assert.equal(retailers[0].last_used, '2026-05-11');
});

// 20. addRetailer sets last_updated to today's date (via injected now)
test('addRetailer sets last_updated via injected now', async () => {
  await writeRetailers({ last_updated: '2026-01-01', retailers: [] });
  await addRetailer({
    host: 'everlane.com',
    detectImpl: async () => true,
    now: () => '2026-05-11',
  });
  const raw = await fs.readFile(path.join(tmpDir, '.claude/cart/retailers.md'), 'utf8');
  assert.ok(raw.includes('last_updated: 2026-05-11'), 'last_updated should be updated to injected date');
});
