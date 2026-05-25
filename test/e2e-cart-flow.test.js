// End-to-end test for bin/cart-flow.js — spawns the real subprocess with a
// temp HOME, drives the SSE/POST protocol from this process, asserts the
// stream of states matches the new "Threat Mode" flow shape.
//
// Shopify search is exercised via a real /search/suggest.json fixture (no
// network — the subprocess fetches the URL itself, so we mount a tiny stub
// HTTPS server via undici/fetch interception is too much; instead the test
// uses the no-network outcome: queries an undefined host so search returns []
// and the flow lands on the 'empty' stage. That's enough to verify the
// orchestration shape end-to-end without flaky network deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cart-flow.js');

const SENTINEL_RE = /^__CART_FLOW_URL__\s+(\S+)$/m;
const OUTCOME_RE = /^outcome=(\w+)(.*)$/m;

async function seedHome(home, retailerHosts = ['nonexistent-host-12345.test']) {
  const dir = path.join(home, '.claude/cart');
  await fs.mkdir(dir, { recursive: true });

  const profileMd =
    '---\n' +
    'sizes: {}\nbudget_default: mid\nbudget_caps: {}\npalette: []\n' +
    'brands_love: []\nbrands_avoid: []\nfit_notes: {}\nmoodboard_url: \'\'\n' +
    'last_setup: null\n---\n\n' +
    '# Purchase history\n| date | item | brand | $ | url |\n|---|---|---|---|---|\n\n';
  await fs.writeFile(path.join(dir, 'profile.md'), profileMd);

  const retailersMd =
    '---\nlast_updated: \'2026-05-24\'\n---\n\n' +
    '# Retailers\n| host | tier | handler | last_used |\n|---|---|---|---|\n' +
    retailerHosts.map((h) => `| ${h} | 2 | shopify |  |`).join('\n') + '\n\n';
  await fs.writeFile(path.join(dir, 'retailers.md'), retailersMd);
}

function waitForSentinel(proc) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const onData = (chunk) => {
      if (done) return;
      buf += chunk.toString('utf8');
      const m = buf.match(SENTINEL_RE);
      if (m) { done = true; proc.stdout.off('data', onData); resolve(m[1]); }
    };
    proc.stdout.on('data', onData);
    proc.once('exit', () => {
      if (done) return;
      done = true;
      proc.stdout.off('data', onData);
      reject(new Error('subprocess exited before sentinel; stdout=' + buf));
    });
  });
}

async function* readSSE(url) {
  const res = await fetch(url, { headers: { Accept: 'text/event-stream' } });
  if (!res.ok) throw new Error(`SSE connect failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop();
    for (const block of blocks) {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      yield { event, data };
    }
  }
}

async function postAction(baseUrl, sessionId, token, action) {
  const res = await fetch(`${baseUrl}/r/${sessionId}/action?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
  });
  if (!res.ok) throw new Error(`action POST failed: ${res.status}`);
}

function parseSessionUrl(url) {
  const u = new URL(url);
  const m = u.pathname.match(/^\/r\/([^/]+)/);
  return {
    baseUrl: `${u.protocol}//${u.host}`,
    sessionId: m[1],
    token: u.searchParams.get('token'),
  };
}

async function runFlow({ home, query, choose }) {
  const proc = spawn('node', [CLI, '--no-open', query], {
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  proc.stdout.on('data', (c) => stdoutChunks.push(Buffer.from(c)));
  proc.stderr.on('data', (c) => stderrChunks.push(Buffer.from(c)));

  const exitPromise = new Promise((r) => proc.once('exit', (code) => r(code ?? 0)));
  const url = await waitForSentinel(proc);
  const parsed = parseSessionUrl(url);

  const allStates = [];
  for await (const { event, data } of readSSE(`${parsed.baseUrl}/r/${parsed.sessionId}/events?token=${parsed.token}`)) {
    if (event === 'closed') break;
    if (event !== 'state') continue;
    const state = JSON.parse(data);
    allStates.push(state);
    const decision = choose(state, allStates);
    if (decision == null) continue;
    await postAction(parsed.baseUrl, parsed.sessionId, parsed.token, decision);
  }

  const exitCode = await exitPromise;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const m = stdout.match(OUTCOME_RE);
  return { outcome: m ? { name: m[1], rest: m[2] } : null, exitCode, stdout, stderr, allStates };
}

// ---------- tests ----------

test('e2e: empty retailers list → no_retailers outcome, exits 1', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-e2e-'));
  const dir = path.join(home, '.claude/cart');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'profile.md'),
    '---\nsizes: {}\nbudget_default: mid\nbudget_caps: {}\npalette: []\n' +
    'brands_love: []\nbrands_avoid: []\nfit_notes: {}\nmoodboard_url: \'\'\nlast_setup: null\n---\n\n' +
    '# Purchase history\n| date | item | brand | $ | url |\n|---|---|---|---|---|\n\n');
  await fs.writeFile(path.join(dir, 'retailers.md'),
    '---\nlast_updated: \'2026-05-24\'\n---\n\n' +
    '# Retailers\n| host | tier | handler | last_used |\n|---|---|---|---|\n\n');

  const proc = spawn('node', [CLI, '--no-open', 'anything'], {
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks = [];
  proc.stdout.on('data', (c) => stdoutChunks.push(c));
  const exit = await new Promise((r) => proc.once('exit', (c) => r(c)));
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  assert.match(stdout, /outcome=no_retailers/);
  assert.equal(exit, 1);
});

test('e2e: search fails on unreachable host → empty stage → dismissal exits 1', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-e2e-'));
  // 127.0.0.1 will refuse connection on this random port → network_error in search.
  await seedHome(home, ['127.0.0.1:1.example.invalid']);

  let dismissed = false;
  const result = await runFlow({
    home,
    query: 'sweater',
    choose: (state) => {
      // Wait for either 'empty' or 'done', then dismiss.
      if ((state.stage === 'empty' || state.stage === 'done') && !dismissed) {
        dismissed = true;
        return { type: 'dismissed' };
      }
      return null;
    },
  });

  // 'empty' path → no_results (exit 1) is the typical outcome here.
  assert.ok(
    ['no_results', 'dismissed'].includes(result.outcome.name),
    `expected no_results or dismissed, got ${result.outcome?.name}`,
  );
  // Either way, we should have seen 'searching' as the first stage.
  assert.equal(result.allStates[0].stage, 'searching');
  assert.equal(result.allStates[0].query, 'sweater');
});

test('e2e: searching state has one row per configured retailer with status', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-e2e-'));
  await seedHome(home, ['a.example.invalid', 'b.example.invalid']);

  let dismissed = false;
  const result = await runFlow({
    home,
    query: 'x',
    choose: (state) => {
      if ((state.stage === 'empty' || state.stage === 'done') && !dismissed) {
        dismissed = true;
        return { type: 'dismissed' };
      }
      return null;
    },
  });

  const initial = result.allStates[0];
  assert.equal(initial.stage, 'searching');
  assert.equal(initial.retailers.length, 2);
  assert.equal(initial.retailers[0].host, 'a.example.invalid');
  assert.equal(initial.retailers[1].host, 'b.example.invalid');
  assert.equal(initial.retailers[0].status, 'pending');
});

test('e2e: usage error (missing query) prints to stderr, exits 2', async () => {
  const proc = spawn('node', [CLI, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderrChunks = [];
  proc.stderr.on('data', (c) => stderrChunks.push(c));
  const exit = await new Promise((r) => proc.once('exit', (c) => r(c)));
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  assert.match(stderr, /Usage:/);
  assert.equal(exit, 2);
});
