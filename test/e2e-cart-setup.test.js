// End-to-end test for bin/cart-setup-flow.js — spawns the real binary
// with a temp HOME, drives the SSE/POST protocol from this process, and
// asserts that profile.md gets written and preserves untouched fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cart-setup-flow.js');

const SENTINEL_RE = /^__CART_SETUP_URL__\s+(\S+)$/m;
const OUTCOME_RE = /^outcome=(\w+)(.*)$/m;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function readProfileRaw(home) {
  return fs.readFile(path.join(home, '.claude/cart/profile.md'), 'utf8');
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

async function runFlow({ home, choose }) {
  const proc = spawn('node', [CLI, '--no-open'], {
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

  for await (const { event, data } of readSSE(`${parsed.baseUrl}/r/${parsed.sessionId}/events?token=${parsed.token}`)) {
    if (event === 'closed') break;
    if (event !== 'state') continue;
    const state = JSON.parse(data);
    const decision = choose(state);
    if (decision == null) continue;
    const actions = Array.isArray(decision) ? decision : [decision];
    for (const a of actions) await postAction(parsed.baseUrl, parsed.sessionId, parsed.token, a);
  }

  const exitCode = await exitPromise;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const m = stdout.match(OUTCOME_RE);
  const outcome = m ? { name: m[1], rest: m[2] } : null;
  return { outcome, exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('e2e: submit fresh profile creates profile.md with submitted fields', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-e2e-'));

  let acted = false;
  const result = await runFlow({
    home,
    choose: (state) => {
      if (state.stage !== 'form' || acted) return null;
      acted = true;
      return {
        type: 'submit',
        profile: {
          sizes: { top: 'M', bottom: '32x32', shoes: 11.5 },
          budget_default: 'high',
          budget_caps: { clothes: 200 },
          brands_love: ['Uniqlo', 'Aritzia'],
          brands_avoid: ['Shein'],
          fit_notes: { tops: 'relaxed', pants: 'tapered' },
          moodboard_url: 'https://example.com/board',
        },
      };
    },
  });

  assert.equal(result.outcome.name, 'success');
  assert.match(result.outcome.rest, /changes=\d+/);
  assert.equal(result.exitCode, 0);

  const profile = await readProfileRaw(home);
  // Frontmatter contents — match field-by-field.
  assert.match(profile, /budget_default: high/);
  assert.match(profile, /top: M/);
  assert.match(profile, /bottom: '?32x32'?/);
  assert.match(profile, /shoes: 11\.5/);
  assert.match(profile, /clothes: 200/);
  assert.match(profile, /- Uniqlo/);
  assert.match(profile, /- Aritzia/);
  assert.match(profile, /- Shein/);
  assert.match(profile, /tops: relaxed/);
  assert.match(profile, /pants: tapered/);
  assert.match(profile, /moodboard_url: https:\/\/example\.com\/board/);
});

test('e2e: dismiss leaves profile.md unchanged', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-e2e-'));

  // Pre-create a profile we expect to be preserved verbatim.
  await fs.mkdir(path.join(home, '.claude/cart'), { recursive: true });
  const pre =
    '---\n' +
    'sizes: {top: M}\n' +
    'budget_default: mid\n' +
    'budget_caps: {}\n' +
    'palette: [navy]\n' +
    'brands_love: [Uniqlo]\n' +
    'brands_avoid: []\n' +
    'fit_notes: {}\n' +
    'moodboard_url: \'\'\n' +
    'last_setup: null\n' +
    '---\n\n' +
    '# Purchase history\n| date | item | brand | $ | kept | notes |\n|---|---|---|---|---|---|\n\n' +
    '# Thumb signals\n| date | category | up | down |\n|---|---|---|---|\n\n';
  await fs.writeFile(path.join(home, '.claude/cart/profile.md'), pre);

  const before = await readProfileRaw(home);

  let acted = false;
  const result = await runFlow({
    home,
    choose: (state) => {
      if (state.stage !== 'form' || acted) return null;
      acted = true;
      return { type: 'dismissed' };
    },
  });

  assert.equal(result.outcome.name, 'dismissed');
  assert.equal(result.exitCode, 1);

  const after = await readProfileRaw(home);
  assert.equal(before, after, 'profile.md must not change on dismiss');
});

test('e2e: submit preserves palette and purchase_history from existing profile', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-e2e-'));

  await fs.mkdir(path.join(home, '.claude/cart'), { recursive: true });
  const pre =
    '---\n' +
    'sizes: {}\n' +
    'budget_default: mid\n' +
    'budget_caps: {}\n' +
    'palette: [navy, cream]\n' +
    'brands_love: []\n' +
    'brands_avoid: []\n' +
    'fit_notes: {}\n' +
    'moodboard_url: \'\'\n' +
    'last_setup: null\n' +
    '---\n\n' +
    '# Purchase history\n| date | item | brand | $ | kept | notes |\n|---|---|---|---|---|---|\n' +
    '| 2026-05-10 | Linen Shirt | Uniqlo | 49.99 | yes |  |\n\n' +
    '# Thumb signals\n| date | category | up | down |\n|---|---|---|---|\n\n';
  await fs.writeFile(path.join(home, '.claude/cart/profile.md'), pre);

  let acted = false;
  const result = await runFlow({
    home,
    choose: (state) => {
      if (state.stage !== 'form' || acted) return null;
      acted = true;
      return {
        type: 'submit',
        profile: { budget_default: 'high', brands_love: ['Patagonia'] },
      };
    },
  });

  assert.equal(result.outcome.name, 'success');

  const profile = await readProfileRaw(home);
  // The new values landed.
  assert.match(profile, /budget_default: high/);
  assert.match(profile, /- Patagonia/);
  // Palette preserved.
  assert.match(profile, /- navy/);
  assert.match(profile, /- cream/);
  // Purchase history preserved.
  assert.match(profile, /Linen Shirt \| Uniqlo \| 49\.99 \| yes/);
});
