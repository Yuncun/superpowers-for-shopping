import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const CLI = path.resolve('bin/cart.js');

test('smoke: full setup flow writes a usable profile', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-smoke-'));
  const env = { ...process.env, HOME: tmp };

  await exec('node', [CLI, 'init'], { env });
  await exec('node', [CLI, 'set', 'sizes.top=M', 'sizes.bottom=32x32'], { env });
  await exec('node', [CLI, 'set', 'budget_default=mid'], { env });
  await exec('node', [CLI, 'set', 'palette=["navy","cream","olive"]'], { env });
  await exec('node', [CLI, 'set', 'brands_love=["Marine Layer","Uniqlo"]'], { env });
  await exec('node', [CLI, 'set', 'brands_avoid=["Shein"]'], { env });
  await exec('node', [CLI, 'set', 'fit_notes={"sweater":"relaxed, not cropped"}'], { env });

  const { stdout } = await exec('node', [CLI, 'show'], { env });
  const p = JSON.parse(stdout);

  assert.equal(p.sizes.top, 'M');
  assert.equal(p.sizes.bottom, '32x32');
  assert.equal(p.budget_default, 'mid');
  assert.deepEqual(p.palette, ['navy', 'cream', 'olive']);
  assert.deepEqual(p.brands_love, ['Marine Layer', 'Uniqlo']);
  assert.deepEqual(p.brands_avoid, ['Shein']);
  assert.equal(p.fit_notes.sweater, 'relaxed, not cropped');

  const raw = await fs.readFile(path.join(tmp, '.claude/cart/profile.md'), 'utf8');
  assert.ok(raw.startsWith('---\n'));
  assert.ok(raw.includes('# Purchase history'));
  assert.ok(raw.includes('# Thumb signals'));
});
