// test/lib/cart-harness.test.js
// Unit tests for the reusable cart-flow E2E harness. All external I/O
// (fetch, EventSource, child_process spawn) is injected so these tests
// stay deterministic and never touch the network or spawn a real subprocess.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  driveFlow,
  spawnCartFlow,
  thumbAllUpThenComplete,
  acceptFirstFinal,
} from './cart-harness.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake child_process-like object with controllable stdout/stderr/exit.
 *
 * Returns { proc, emitStdout, emitStderr, exit }. The proc has the shape
 * `spawn()` returns: { stdout, stderr, on, kill }.
 */
function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdout.off = proc.stdout.removeListener.bind(proc.stdout);
  proc.stderr.off = proc.stderr.removeListener.bind(proc.stderr);
  proc.killed = false;
  proc.kill = () => { proc.killed = true; };
  return {
    proc,
    emitStdout: (chunk) => proc.stdout.emit('data', Buffer.from(chunk)),
    emitStderr: (chunk) => proc.stderr.emit('data', Buffer.from(chunk)),
    endStdout: () => proc.stdout.emit('end'),
    endStderr: () => proc.stderr.emit('end'),
    exit: (code = 0) => {
      proc.stdout.emit('end');
      proc.stderr.emit('end');
      proc.emit('exit', code);
      proc.emit('close', code);
    },
  };
}

/**
 * Build a fake EventSource-like async-iterable factory.
 *
 * Usage: `const es = makeFakeEventSource([{event:'state', data:{...}}, ...]);`
 * Each yielded item has `{event, data}` — `data` is auto-JSON-stringified by
 * the caller-side fake; the harness's parser does the JSON.parse.
 */
function makeFakeEventSource(events, { delayMs = 0 } = {}) {
  return async function* fakeEventSourceImpl(_url) {
    for (const ev of events) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { event: ev.event, data: JSON.stringify(ev.data) };
    }
  };
}

/**
 * Build a fake fetch that records every call and returns a configurable
 * response. By default: 204 No Content (action POST happy path).
 */
function makeFakeFetch({ status = 204, body = '' } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => (body ? JSON.parse(body) : null),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// ---------------------------------------------------------------------------
// spawnCartFlow tests
// ---------------------------------------------------------------------------

describe('spawnCartFlow', () => {
  it('resolves baseUrl/sessionId/token when sentinel appears on stdout', async () => {
    const fake = makeFakeProc();
    const spawnImpl = () => fake.proc;
    const promise = spawnCartFlow({ query: 'sweater', spawnImpl });

    // Emit some log noise, then the sentinel.
    fake.emitStderr('starting up\n');
    fake.emitStdout('__CART_FLOW_URL__ http://127.0.0.1:55916/r/abc123?token=def456\n');

    const handle = await promise;
    assert.equal(handle.baseUrl, 'http://127.0.0.1:55916');
    assert.equal(handle.sessionId, 'abc123');
    assert.equal(handle.token, 'def456');
    assert.equal(handle.proc, fake.proc);

    // Clean up the subprocess so the test doesn't hang.
    fake.exit(0);
  });

  it('rejects if subprocess exits before sentinel', async () => {
    const fake = makeFakeProc();
    const spawnImpl = () => fake.proc;
    const promise = spawnCartFlow({ query: 'sweater', spawnImpl });

    // Exit immediately with no sentinel.
    fake.emitStderr('boom\n');
    fake.exit(1);

    await assert.rejects(promise, /exited before sentinel/);
  });
});

// ---------------------------------------------------------------------------
// driveFlow tests
// ---------------------------------------------------------------------------

describe('driveFlow', () => {
  it('posts thumbs_complete on thumbs state and waits for next state', async () => {
    const fake = makeFakeProc();
    const fetchImpl = makeFakeFetch();
    const candidates = Array.from({ length: 3 }, (_, i) => ({
      url: `https://example.com/p/${i}`, title: `Product ${i}`,
    }));
    const eventSourceImpl = makeFakeEventSource([
      { event: 'state', data: { stage: 'loading' } },
      { event: 'state', data: { stage: 'thumbs', candidates } },
      { event: 'state', data: { stage: 'final', product: candidates[0] } },
      { event: 'state', data: { stage: 'done' } },
    ]);

    const drivePromise = driveFlow({
      subprocess: fake.proc,
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'abc',
      token: 'xyz',
      choose: (state) => {
        if (state.stage === 'thumbs') return { type: 'thumbs_complete' };
        if (state.stage === 'final') return { type: 'final_accept' };
        return null;
      },
      deps: { fetchImpl, EventSourceImpl: eventSourceImpl },
    });

    // Subprocess exits with a final outcome line.
    fake.emitStdout('outcome=success product="P" brand="B" cart_url="https://example.com/cart"\n');
    fake.exit(0);

    const result = await drivePromise;
    // Two POSTs: thumbs_complete + final_accept.
    assert.equal(fetchImpl.calls.length, 2);
    const urls = fetchImpl.calls.map((c) => c.url);
    assert.ok(urls.every((u) => u === 'http://127.0.0.1:9999/r/abc/action?token=xyz'));
    const bodies = fetchImpl.calls.map((c) => JSON.parse(c.opts.body));
    assert.equal(bodies[0].type, 'thumbs_complete');
    assert.equal(bodies[1].type, 'final_accept');
    assert.equal(result.exitCode, 0);
  });

  it('does not POST when chooser returns null or "wait"', async () => {
    const fake = makeFakeProc();
    const fetchImpl = makeFakeFetch();
    const eventSourceImpl = makeFakeEventSource([
      { event: 'state', data: { stage: 'loading' } },
      { event: 'state', data: { stage: 'thumbs', candidates: [] } },
      { event: 'state', data: { stage: 'done' } },
    ]);

    const drivePromise = driveFlow({
      subprocess: fake.proc,
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'abc',
      token: 'xyz',
      choose: (state) => {
        if (state.stage === 'loading') return null;
        if (state.stage === 'thumbs') return 'wait';
        return null;
      },
      deps: { fetchImpl, EventSourceImpl: eventSourceImpl },
    });

    fake.emitStdout('outcome=dismissed\n');
    fake.exit(0);

    await drivePromise;
    assert.equal(fetchImpl.calls.length, 0, 'no actions should be POSTed');
  });

  it('resolves with success outcome + cartUrl when subprocess exits 0', async () => {
    const fake = makeFakeProc();
    const fetchImpl = makeFakeFetch();
    const eventSourceImpl = makeFakeEventSource([
      { event: 'state', data: { stage: 'redirect', url: 'https://marinelayer.com/cart' } },
    ]);

    const drivePromise = driveFlow({
      subprocess: fake.proc,
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'abc',
      token: 'xyz',
      choose: () => null,
      deps: { fetchImpl, EventSourceImpl: eventSourceImpl },
    });

    fake.emitStdout('outcome=success product="Wool Sweater" brand="ML" cart_url="https://marinelayer.com/cart"\n');
    fake.exit(0);

    const result = await drivePromise;
    assert.equal(result.outcome, 'success');
    assert.equal(result.cartUrl, 'https://marinelayer.com/cart');
    assert.equal(result.exitCode, 0);
  });

  it('rejects on POST 4xx/5xx response', async () => {
    const fake = makeFakeProc();
    const fetchImpl = makeFakeFetch({ status: 500, body: 'Internal Server Error' });
    const eventSourceImpl = makeFakeEventSource([
      { event: 'state', data: { stage: 'thumbs', candidates: [] } },
    ]);

    const drivePromise = driveFlow({
      subprocess: fake.proc,
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'abc',
      token: 'xyz',
      choose: () => ({ type: 'thumbs_complete' }),
      deps: { fetchImpl, EventSourceImpl: eventSourceImpl },
    });

    await assert.rejects(drivePromise, /action POST failed/i);
    // Subprocess must have been killed by the harness to avoid orphans.
    assert.equal(fake.proc.killed, true);
    // Clean up so listeners can settle.
    fake.exit(1);
  });

  it('rejects on SSE connection error', async () => {
    const fake = makeFakeProc();
    const fetchImpl = makeFakeFetch();
    // EventSourceImpl throws on connect.
    const eventSourceImpl = async function* () {
      throw new Error('SSE connect failed: 401');
    };

    const drivePromise = driveFlow({
      subprocess: fake.proc,
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'abc',
      token: 'xyz',
      choose: () => null,
      deps: { fetchImpl, EventSourceImpl: eventSourceImpl },
    });

    await assert.rejects(drivePromise, /SSE connect failed/);
    assert.equal(fake.proc.killed, true);
    fake.exit(1);
  });

  it('tracks all states in order via allStates and calls onState', async () => {
    const fake = makeFakeProc();
    const fetchImpl = makeFakeFetch();
    const states = [
      { stage: 'loading' },
      { stage: 'thumbs', candidates: [{ url: 'a' }] },
      { stage: 'final', product: { url: 'a' } },
      { stage: 'redirect', url: 'https://x/cart' },
    ];
    const eventSourceImpl = makeFakeEventSource(states.map((s) => ({ event: 'state', data: s })));

    const seen = [];
    const drivePromise = driveFlow({
      subprocess: fake.proc,
      baseUrl: 'http://127.0.0.1:9999',
      sessionId: 'abc',
      token: 'xyz',
      choose: (s) => (s.stage === 'thumbs' ? { type: 'thumbs_complete' }
                    : s.stage === 'final' ? { type: 'final_accept' }
                    : null),
      onState: (s) => seen.push(s),
      deps: { fetchImpl, EventSourceImpl: eventSourceImpl },
    });

    fake.emitStdout('outcome=success product="P" brand="B" cart_url="https://x/cart"\n');
    fake.exit(0);

    const result = await drivePromise;
    assert.equal(result.allStates.length, states.length);
    assert.deepEqual(result.allStates.map((s) => s.stage),
                     ['loading', 'thumbs', 'final', 'redirect']);
    assert.equal(seen.length, states.length);
    assert.equal(result.finalState.stage, 'redirect');
  });
});

// ---------------------------------------------------------------------------
// Convenience chooser tests
// ---------------------------------------------------------------------------

describe('convenience choosers', () => {
  it('thumbAllUpThenComplete produces 8 thumb-ups + thumbs_complete for 8 candidates', () => {
    const chooser = thumbAllUpThenComplete();
    const candidates = Array.from({ length: 8 }, (_, i) => ({ url: `u${i}` }));
    const actions = chooser({ stage: 'thumbs', candidates });
    assert.ok(Array.isArray(actions));
    assert.equal(actions.length, 9);
    for (let i = 0; i < 8; i++) {
      assert.deepEqual(actions[i], { type: 'thumb', direction: 'up', index: i });
    }
    assert.deepEqual(actions[8], { type: 'thumbs_complete' });

    // After firing for a `thumbs` state once, subsequent thumbs calls return null
    // (state-machine guard — chooser shouldn't keep re-firing).
    assert.equal(chooser({ stage: 'thumbs', candidates }), null);

    // On a final state, returns final_accept.
    assert.deepEqual(chooser({ stage: 'final', product: {} }), { type: 'final_accept' });

    // Other states return null.
    assert.equal(chooser({ stage: 'loading' }), null);
    assert.equal(chooser({ stage: 'done' }), null);
  });

  it('acceptFirstFinal returns final_accept on final, null elsewhere', () => {
    const chooser = acceptFirstFinal();
    assert.deepEqual(chooser({ stage: 'final', product: {} }), { type: 'final_accept' });
    assert.equal(chooser({ stage: 'loading' }), null);
    assert.equal(chooser({ stage: 'thumbs', candidates: [] }), null);
    assert.equal(chooser({ stage: 'done' }), null);
    // Second final invocation returns null (single-shot).
    assert.equal(chooser({ stage: 'final', product: {} }), null);
  });
});
