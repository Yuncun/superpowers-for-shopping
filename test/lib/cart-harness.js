// test/lib/cart-harness.js
// Reusable protocol-level harness for the /cart flow.
//
// Implements the same client contract the in-browser UI uses (see
// server/render.js lines 281-313):
//   1. Subscribe to `GET /r/<id>/events?token=<t>` (SSE).
//   2. For each pushed `state` event, decide an action.
//   3. POST it to `/r/<id>/action?token=<t>`.
//
// Designed for two callers:
//   - The unit test (`cart-harness.test.js`) injects mock fetch /
//     EventSource / spawn implementations.
//   - The live runner (`test/e2e-cart-flow.js`, Task 3) uses real deps.

import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENTINEL_RE = /^__CART_FLOW_URL__\s+(\S+)$/m;
// Lines like `outcome=success product="P" brand="B" cart_url="https://x/cart"`.
const OUTCOME_RE = /^outcome=(\w+)(.*)$/m;

// Delay between successive POSTs when a chooser returns an array of actions.
// Keeps the server-side state machine ordering predictable without
// hammering the loop.
const MULTI_ACTION_DELAY_MS = 50;

// ---------------------------------------------------------------------------
// Default SSE implementation: streams `fetch`, splits on `\n\n`, parses
// `event:` / `data:` lines. Yields `{event, data}` where `data` is the
// raw JSON string (caller does the parse).
// ---------------------------------------------------------------------------

async function* defaultEventSourceImpl(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { Accept: 'text/event-stream' } });
  if (!res.ok) {
    throw new Error(`SSE connect failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop();
    for (const block of blocks) {
      let eventName = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      yield { event: eventName, data };
    }
  }
}

// ---------------------------------------------------------------------------
// Subprocess spawn helper
// ---------------------------------------------------------------------------

/**
 * Spawn `node bin/cart-flow.js [args] "<query>"` and resolve once the
 * `__CART_FLOW_URL__ <url>` sentinel appears on stdout.
 *
 * @param {object} opts
 * @param {string} opts.query
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string[]} [opts.args]              additional CLI args (e.g. ['--no-open'])
 * @param {Function} [opts.spawnImpl]         injectable spawn for tests
 * @returns {Promise<{proc, baseUrl, sessionId, token}>}
 */
export async function spawnCartFlow({
  query,
  env = process.env,
  args = [],
  spawnImpl = nodeSpawn,
} = {}) {
  // Resolve `bin/cart-flow.js` relative to THIS file so tests/live-runs
  // work regardless of cwd. test/lib/ -> ../../bin/cart-flow.js
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.resolve(here, '..', '..', 'bin', 'cart-flow.js');

  const proc = spawnImpl('node', [cliPath, ...args, query], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = await waitForSentinel(proc);
  const parsed = new URL(url);
  const sessionMatch = parsed.pathname.match(/^\/r\/([^/]+)/);
  if (!sessionMatch) {
    throw new Error(`malformed session URL on sentinel: ${url}`);
  }

  return {
    proc,
    baseUrl: `${parsed.protocol}//${parsed.host}`,
    sessionId: sessionMatch[1],
    token: parsed.searchParams.get('token'),
  };
}

/**
 * Watch stdout for the sentinel line. Resolves with the URL or rejects if
 * the subprocess exits / stdout closes first.
 */
function waitForSentinel(proc) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const onData = (chunk) => {
      if (settled) return;
      buffer += chunk.toString();
      const m = buffer.match(SENTINEL_RE);
      if (m) {
        settled = true;
        cleanup();
        resolve(m[1]);
      }
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('subprocess exited before sentinel'));
    };

    const onExit = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('subprocess exited before sentinel'));
    };

    function cleanup() {
      proc.stdout.off('data', onData);
      proc.stdout.off('end', onEnd);
      proc.off('exit', onExit);
      proc.off('close', onExit);
    }

    proc.stdout.on('data', onData);
    proc.stdout.on('end', onEnd);
    proc.on('exit', onExit);
    proc.on('close', onExit);
  });
}

// ---------------------------------------------------------------------------
// Drive loop
// ---------------------------------------------------------------------------

/**
 * Drive the cart-flow subprocess via SSE + POST.
 *
 * @param {object}  opts
 * @param {object}  opts.subprocess     child_process result (must expose stdout/stderr + EE)
 * @param {string}  opts.baseUrl        'http://127.0.0.1:PORT'
 * @param {string}  opts.sessionId
 * @param {string}  opts.token
 * @param {Function} opts.choose         (state) -> action | action[] | null | 'wait'
 * @param {Function} [opts.onState]      (state) -> void
 * @param {object}  [opts.deps]
 * @param {Function} [opts.deps.fetchImpl=fetch]
 * @param {Function} [opts.deps.EventSourceImpl]    async-iterable factory
 * @returns {Promise<{outcome, cartUrl?, finalState, allStates, exitCode, stdout, stderr}>}
 */
export async function driveFlow({
  subprocess,
  baseUrl,
  sessionId,
  token,
  choose,
  onState,
  deps: { fetchImpl = fetch, EventSourceImpl = defaultEventSourceImpl } = {},
}) {
  // -------------------------------------------------------------------------
  // Collect stdout/stderr while we drive. The final outcome line lives on
  // stdout (see bin/cart-flow.js).
  // -------------------------------------------------------------------------
  const stdoutChunks = [];
  const stderrChunks = [];
  subprocess.stdout.on('data', (c) => stdoutChunks.push(Buffer.from(c)));
  subprocess.stderr.on('data', (c) => stderrChunks.push(Buffer.from(c)));

  // -------------------------------------------------------------------------
  // Track lifecycle: exit promise + state log.
  // -------------------------------------------------------------------------
  const allStates = [];
  let finalState = null;

  const exitPromise = new Promise((resolve) => {
    const onExit = (code) => resolve(code ?? 0);
    subprocess.once('exit', onExit);
    subprocess.once('close', onExit);
  });

  // -------------------------------------------------------------------------
  // POST helper. Throws on non-2xx so the drive loop can bail.
  // -------------------------------------------------------------------------
  const actionUrl = `${baseUrl}/r/${sessionId}/action?token=${token}`;
  async function postAction(action) {
    const res = await fetchImpl(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) {
      const text = res.text ? await res.text().catch(() => '') : '';
      throw new Error(`action POST failed: ${res.status}${text ? ` — ${text}` : ''}`);
    }
  }

  // -------------------------------------------------------------------------
  // The drive loop: read SSE, hand each state to chooser, POST result.
  // -------------------------------------------------------------------------
  const sseUrl = `${baseUrl}/r/${sessionId}/events?token=${token}`;

  async function driveLoop() {
    const iter = EventSourceImpl(sseUrl, { fetchImpl });
    for await (const { event, data } of iter) {
      if (event === 'closed') break;
      if (event !== 'state') continue;

      let state;
      try {
        state = JSON.parse(data);
      } catch {
        continue;
      }

      allStates.push(state);
      finalState = state;
      if (onState) onState(state);

      const decision = choose(state);
      if (decision == null || decision === 'wait') continue;

      const actions = Array.isArray(decision) ? decision : [decision];
      for (let i = 0; i < actions.length; i++) {
        await postAction(actions[i]);
        if (i < actions.length - 1 && MULTI_ACTION_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, MULTI_ACTION_DELAY_MS));
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Run the drive loop to completion. The SSE iterator returns when the
  // server closes the stream (which happens on session.close() → subprocess
  // exit). If the loop fails, kill the subprocess so we don't leak it.
  // We also watch exitPromise as a backstop: if the subprocess dies without
  // closing the stream, surface that instead of hanging.
  // -------------------------------------------------------------------------
  try {
    await driveLoop();
  } catch (err) {
    if (subprocess && typeof subprocess.kill === 'function' && !subprocess.killed) {
      try { subprocess.kill(); } catch { /* ignore */ }
    }
    throw err;
  }

  const exitCode = await exitPromise;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  const { outcome, cartUrl } = parseOutcome(stdout);

  return { outcome, cartUrl, finalState, allStates, exitCode, stdout, stderr };
}

/**
 * Parse the outcome line emitted by bin/cart-flow.js.
 * Examples:
 *   outcome=success product="P" brand="B" cart_url="https://x/cart"
 *   outcome=no_results query="sweater"
 *   outcome=auth_required host="example.com"
 *   outcome=dismissed
 */
function parseOutcome(stdout) {
  const m = stdout.match(OUTCOME_RE);
  if (!m) return { outcome: null, cartUrl: null };
  const outcome = m[1];
  const rest = m[2] ?? '';
  let cartUrl = null;
  const cartMatch = rest.match(/cart_url="([^"]+)"/);
  if (cartMatch) cartUrl = cartMatch[1];
  return { outcome, cartUrl };
}

// ---------------------------------------------------------------------------
// Convenience choosers
// ---------------------------------------------------------------------------

/**
 * Thumb-up every candidate on the first `thumbs` state, then submit
 * `thumbs_complete`. On `final` state, accept. Subsequent identical states
 * return null so we don't double-fire.
 */
export function thumbAllUpThenComplete() {
  let didThumbs = false;
  let didFinal = false;
  return (state) => {
    if (state.stage === 'thumbs' && !didThumbs) {
      didThumbs = true;
      const thumbs = (state.candidates ?? []).map((_, i) => ({
        type: 'thumb', direction: 'up', index: i,
      }));
      return [...thumbs, { type: 'thumbs_complete' }];
    }
    if (state.stage === 'final' && !didFinal) {
      didFinal = true;
      return { type: 'final_accept' };
    }
    return null;
  };
}

/**
 * Thumb-up only the first candidate, then submit `thumbs_complete`.
 * Accepts `final`.
 */
export function thumbFirstThenComplete() {
  let didThumbs = false;
  let didFinal = false;
  return (state) => {
    if (state.stage === 'thumbs' && !didThumbs) {
      didThumbs = true;
      return [
        { type: 'thumb', direction: 'up', index: 0 },
        { type: 'thumbs_complete' },
      ];
    }
    if (state.stage === 'final' && !didFinal) {
      didFinal = true;
      return { type: 'final_accept' };
    }
    return null;
  };
}

/**
 * Single-shot: accept the first `final` state we see, no-op on everything else.
 */
export function acceptFirstFinal() {
  let didFinal = false;
  return (state) => {
    if (state.stage === 'final' && !didFinal) {
      didFinal = true;
      return { type: 'final_accept' };
    }
    return null;
  };
}

/**
 * Dismiss the moment any actionable state appears. Useful for verifying
 * the dismissed → outcome=dismissed path.
 */
export function dismissImmediately() {
  let dismissed = false;
  return (state) => {
    if (dismissed) return null;
    if (state.stage === 'thumbs' || state.stage === 'final' || state.stage === 'login_required') {
      dismissed = true;
      return { type: 'dismissed' };
    }
    return null;
  };
}
