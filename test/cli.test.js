import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const CLI = path.resolve('bin/cart.js');

async function runCli(args, env) {
  const { stdout, stderr } = await exec('node', [CLI, ...args], {
    env: { ...process.env, ...env },
  });
  return { stdout, stderr };
}

test('cart init creates a default profile.md', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  const exists = await fs.stat(path.join(tmp, '.claude/cart/profile.md')).then(() => true, () => false);
  assert.ok(exists);
});

test('cart show prints the current profile as JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  const { stdout } = await runCli(['show'], { HOME: tmp });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.budget_default, 'mid');
});

test('cart set writes frontmatter values', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  await runCli(['set', 'sizes.top=M', 'budget_default=high'], { HOME: tmp });
  const { stdout } = await runCli(['show'], { HOME: tmp });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.sizes.top, 'M');
  assert.equal(parsed.budget_default, 'high');
});

test('cart set with array value parses JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  await runCli(['set', 'brands_love=["Marine Layer","Uniqlo"]'], { HOME: tmp });
  const { stdout } = await runCli(['show'], { HOME: tmp });
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed.brands_love, ['Marine Layer', 'Uniqlo']);
});

test('cart set rejects invalid values without writing to disk', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  // Snapshot the file before the bad set.
  const before = await fs.readFile(path.join(tmp, '.claude/cart/profile.md'), 'utf8');

  // Try to set an invalid budget_default. Should exit non-zero AND not change the file.
  let exitCode = 0;
  try {
    await runCli(['set', 'budget_default=extravagant'], { HOME: tmp });
  } catch (err) {
    exitCode = err.code ?? 1;
  }
  assert.notEqual(exitCode, 0, 'invalid set should exit non-zero');

  const after = await fs.readFile(path.join(tmp, '.claude/cart/profile.md'), 'utf8');
  assert.equal(before, after, 'invalid set must not modify profile.md on disk');
});
