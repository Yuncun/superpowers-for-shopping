// End-to-end test for bin/cart-feedback-flow.js — spawns the real binary
// with a temp HOME, drives the SSE/POST protocol from this process, and
// asserts that profile.md gets updated correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'cart-feedback-flow.js');

const SENTINEL_RE = /^__CART_FEEDBACK_URL__\s+(\S+)$/m;
const OUTCOME_RE = /^outcome=(\w+)(.*)$/m;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function writeProfileWithPending(home, rows) {
  const dir = path.join(home, '.claude/cart');
  await fs.mkdir(dir, { recursive: true });
  const header =
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
    '| date | item | brand | $ | kept | notes |\n' +
    '|---|---|---|---|---|---|\n' +
    rows.map((r) => `| ${r.date} | ${r.item} | ${r.brand} | ${r['$']} | ${r.kept ?? '?'} | ${r.notes ?? ''} |`).join('\n') +
    (rows.length ? '\n' : '') +
    '\n# Thumb signals\n' +
    '| date | category | up | down |\n' +
    '|---|---|---|---|\n\n';
  await fs.writeFile(path.join(dir, 'profile.md'), header);
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
      if (m) {
        done = true;
        proc.stdout.off('data', onData);
        resolve(m[1]);
      }
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
  if (!m) throw new Error(`malformed session URL: ${url}`);
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

  const exitPromise = new Promise((r) => {
    const onExit = (code) => r(code ?? 0);
    proc.once('exit', onExit);
  });

  let url, parsed;
  try {
    url = await waitForSentinel(proc);
    parsed = parseSessionUrl(url);
  } catch (err) {
    // Subprocess exited before sentinel (empty pending). That's a legitimate
    // outcome — let exitPromise + parseOutcome decide.
    const exitCode = await exitPromise;
    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');
    return { outcome: parseOutcome(stdout), exitCode, stdout, stderr };
  }

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
  return { outcome: parseOutcome(stdout), exitCode, stdout, stderr };
}

function parseOutcome(stdout) {
  const m = stdout.match(OUTCOME_RE);
  if (!m) return null;
  const fields = { name: m[1] };
  const rest = m[2] ?? '';
  for (const kv of rest.matchAll(/(\w+)=(\d+)/g)) {
    fields[kv[1]] = Number(kv[2]);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('e2e: empty pending exits cleanly with outcome=empty', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-e2e-'));
  await writeProfileWithPending(home, []);

  const result = await runFlow({ home, choose: () => null });

  assert.deepEqual(result.outcome, { name: 'empty' });
  assert.equal(result.exitCode, 0);
});

test('e2e: submit yes/no/skip writes only kept/returned to profile.md', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-e2e-'));
  await writeProfileWithPending(home, [
    { date: '2026-05-12', item: 'Swim Trunk',  brand: 'Marine Layer', '$': '94.00' },
    { date: '2026-05-10', item: 'Linen Shirt', brand: 'Uniqlo',       '$': '49.99' },
    { date: '2026-05-09', item: 'Crewneck',    brand: 'Aritzia',      '$': '78.00' },
  ]);

  let submitted = false;
  const result = await runFlow({
    home,
    choose: (state) => {
      if (state.stage !== 'form' || submitted) return null;
      submitted = true;
      return {
        type: 'submit',
        items: [
          { date: '2026-05-12', item: 'Swim Trunk',  brand: 'Marine Layer', decision: 'yes',  notes: 'love them' },
          { date: '2026-05-10', item: 'Linen Shirt', brand: 'Uniqlo',       decision: 'no',   notes: '' },
          { date: '2026-05-09', item: 'Crewneck',    brand: 'Aritzia',      decision: 'skip', notes: '' },
        ],
      };
    },
  });

  assert.equal(result.outcome.name, 'success');
  assert.equal(result.outcome.kept, 1);
  assert.equal(result.outcome.returned, 1);
  assert.equal(result.outcome.skipped, 1);
  assert.equal(result.outcome.errors, 0);
  assert.equal(result.exitCode, 0);

  const profile = await readProfileRaw(home);
  // The two non-skip rows should have their kept column updated.
  assert.match(profile, /Swim Trunk \| Marine Layer \| 94\.00 \| yes \| love them/);
  assert.match(profile, /Linen Shirt \| Uniqlo \| 49\.99 \| no /);
  // The skip row stays as '?'.
  assert.match(profile, /Crewneck \| Aritzia \| 78\.00 \| \?/);
});

test('e2e: dismissed action returns outcome=dismissed and leaves profile unchanged', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-e2e-'));
  await writeProfileWithPending(home, [
    { date: '2026-05-12', item: 'Swim Trunk', brand: 'Marine Layer', '$': '94.00' },
  ]);

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
  assert.equal(before, after, 'profile.md must be unchanged on dismiss');
});
