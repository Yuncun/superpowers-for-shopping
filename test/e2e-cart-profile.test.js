// End-to-end test for bin/cart-profile-flow.js — spawns the real binary
// with a temp HOME, drives the SSE/POST protocol from this process, and
// asserts that profile.md and retailers.md get updated correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cart-profile-flow.js');

const SENTINEL_RE = /^__CART_PROFILE_URL__\s+(\S+)$/m;
const OUTCOME_RE = /^outcome=(\w+)(.*)$/m;

async function seedHome(home, { retailers } = {}) {
  const dir = path.join(home, '.claude/cart');
  await fs.mkdir(dir, { recursive: true });

  const profileMd =
    '---\n' +
    'sizes: {}\n' +
    'budget_default: mid\n' +
    'budget_caps: {}\n' +
    'palette: []\n' +
    'brands_love: []\n' +
    'brands_avoid: []\n' +
    'fit_notes: {}\n' +
    'moodboard_url: \'\'\n' +
    'last_setup: null\n' +
    '---\n\n' +
    '# Purchase history\n' +
    '| date | item | brand | $ | url |\n' +
    '|---|---|---|---|---|\n\n';
  await fs.writeFile(path.join(dir, 'profile.md'), profileMd);

  if (retailers) {
    const retailersMd =
      '---\nlast_updated: \'2026-05-23\'\n---\n\n' +
      '# Retailers\n' +
      '| host | tier | handler | last_used |\n' +
      '|---|---|---|---|\n' +
      retailers.map((r) => `| ${r.host} | ${r.tier} | ${r.handler} | ${r.last_used || ''} |`).join('\n') +
      (retailers.length ? '\n' : '') + '\n';
    await fs.writeFile(path.join(dir, 'retailers.md'), retailersMd);
  }
}

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

async function runFlow({ home, extraArgs = [], choose }) {
  const proc = spawn('node', [CLI, '--no-open', ...extraArgs], {
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

  let allStates = [];
  for await (const { event, data } of readSSE(`${parsed.baseUrl}/r/${parsed.sessionId}/events?token=${parsed.token}`)) {
    if (event === 'closed') break;
    if (event !== 'state') continue;
    const state = JSON.parse(data);
    allStates.push(state);
    const decision = choose(state, allStates);
    if (decision == null) continue;
    const actions = Array.isArray(decision) ? decision : [decision];
    for (const a of actions) await postAction(parsed.baseUrl, parsed.sessionId, parsed.token, a);
  }

  const exitCode = await exitPromise;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const m = stdout.match(OUTCOME_RE);
  return {
    outcome: m ? { name: m[1], rest: m[2] } : null,
    exitCode, stdout, stderr, allStates,
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('e2e: initial snapshot includes profile and retailers (no pending)', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-e2e-'));
  await seedHome(home);

  let acted = false;
  const result = await runFlow({
    home,
    choose: (state) => {
      if (state.stage !== 'main' || acted) return null;
      acted = true;
      assert.equal(state.stage, 'main');
      assert.ok(state.profile);
      assert.ok(Array.isArray(state.retailers));
      assert.ok(!('pending' in state), 'pending field should be gone');
      return { type: 'dismissed' };
    },
  });

  assert.equal(result.outcome.name, 'success');
  assert.equal(result.exitCode, 0);
});

test('e2e: submit-profile persists merged profile and preserves palette', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-e2e-'));
  await fs.mkdir(path.join(home, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(home, '.claude/cart/profile.md'),
    '---\nsizes: {top: M}\nbudget_default: mid\nbudget_caps: {}\npalette: [navy, cream]\n' +
    'brands_love: [Uniqlo]\nbrands_avoid: []\nfit_notes: {}\nmoodboard_url: \'\'\nlast_setup: null\n---\n\n' +
    '# Purchase history\n| date | item | brand | $ | url |\n|---|---|---|---|---|\n\n');

  let submitted = false;
  await runFlow({
    home,
    choose: (state) => {
      if (state.stage !== 'main') return null;
      if (!submitted) {
        submitted = true;
        return { type: 'submit-profile', profile: { budget_default: 'high', brands_love: ['Patagonia'] } };
      }
      if (state.banner && state.banner.kind === 'success') return { type: 'dismissed' };
      return null;
    },
  });

  const profile = await readProfileRaw(home);
  assert.match(profile, /budget_default: high/);
  assert.match(profile, /- Patagonia/);
  assert.match(profile, /- navy/);
  assert.match(profile, /- cream/);
  assert.match(profile, /top: M/);
});

test('e2e: --tab=retailers opens with initialTab set', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-e2e-'));
  await seedHome(home);

  let seenInitialTab = null;
  let acted = false;
  await runFlow({
    home,
    extraArgs: ['--tab=retailers'],
    choose: (state) => {
      if (state.stage !== 'main' || acted) return null;
      acted = true;
      seenInitialTab = state.initialTab;
      return { type: 'dismissed' };
    },
  });

  assert.equal(seenInitialTab, 'retailers');
});
