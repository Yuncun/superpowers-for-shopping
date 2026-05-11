// test/flow.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCartFlow } from '../lib/flow.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidates(n) {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://marinelayer.com/products/product-${i}`,
    title: `Product ${i}`,
    brand: 'Marine Layer',
    price: '49.00',
    image: null,
    variants: [{ size: 'M', color: 'Blue', in_stock: true, variant_id: 1000 + i }],
  }));
}

function mockSession({ actions = [] } = {}) {
  const pushed = [];
  let i = 0;
  let closed = false;
  return {
    pushed,
    url: 'http://127.0.0.1:9999/r/abc?token=def',
    pushState: (s) => pushed.push(s),
    nextAction: async ({ types } = {}) => {
      while (i < actions.length) {
        const a = actions[i++];
        if (!types || types.includes(a.type)) return a;
      }
      return new Promise(() => {}); // hang — test will time out if this fires
    },
    close: () => { closed = true; },
    isClosed: () => closed,
  };
}

function mockServer(session) {
  let shutdownCount = 0;
  return {
    baseUrl: 'http://127.0.0.1:9999',
    createSession: () => session,
    shutdown: async () => { shutdownCount++; },
    shutdownCount: () => shutdownCount,
  };
}

function baseDeps({ session, server, candidates = makeCandidates(3) } = {}) {
  return {
    readProfile: async () => ({}),
    search: async (_host) => candidates,
    getCookieHeader: async () => 'sess=abc',
    addToCart: async () => ({ ok: true }),
    startServer: async () => server,
    openUrl: () => {},
    log: () => {},
    sleep: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Task 1: happy path + no-results + cancellation
// ---------------------------------------------------------------------------

test('no_results: returns no_results when all searches return empty', async () => {
  let startServerCalled = false;
  const deps = {
    ...baseDeps(),
    search: async () => [],
    startServer: async () => { startServerCalled = true; return mockServer(mockSession()); },
  };
  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'no_results');
  assert.equal(startServerCalled, false, 'startServer must NOT be called on no_results');
});

test('no_results: server is not started even with multiple retailers that all return empty', async () => {
  let startServerCalled = false;
  const deps = {
    ...baseDeps(),
    search: async () => [],
    startServer: async () => { startServerCalled = true; return mockServer(mockSession()); },
  };
  const result = await runCartFlow({
    query: 'sweater',
    retailers: ['marinelayer.com', 'example.com'],
    deps,
  });
  assert.equal(result.outcome, 'no_results');
  assert.equal(startServerCalled, false);
});

test('uses all candidates when fewer than 8 results', async () => {
  const candidates = makeCandidates(5);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  const thumbsState = session.pushed.find(s => s.stage === 'thumbs');
  assert.equal(thumbsState.candidates.length, 5);
});

test('truncates to 8 candidates when more than 8 results', async () => {
  const candidates = makeCandidates(12);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  const thumbsState = session.pushed.find(s => s.stage === 'thumbs');
  assert.equal(thumbsState.candidates.length, 8);
});

test('happy path: tiebreaker by listing order — index 2 beats index 5 with equal ups', async () => {
  // Both index 2 and 5 get one up each — listing order wins → index 2
  const candidates = makeCandidates(8);
  const session = mockSession({ actions: [
    { type: 'thumb', direction: 'up', index: 2 },
    { type: 'thumb', direction: 'up', index: 5 },
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(result.product.title, 'Product 2');
});

test('happy path: most ups wins — index 2 has 2 ups, index 5 has 1', async () => {
  const candidates = makeCandidates(8);
  const session = mockSession({ actions: [
    { type: 'thumb', direction: 'up', index: 2 },
    { type: 'thumb', direction: 'up', index: 2 },
    { type: 'thumb', direction: 'up', index: 5 },
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(result.product.title, 'Product 2');
});

test('happy path with zero ups: falls back to candidates[0]', async () => {
  const candidates = makeCandidates(5);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(result.product.title, 'Product 0');
});

test('happy path pushState sequence: loading, thumbs, final, redirect', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(session.pushed.length, 4);
  assert.equal(session.pushed[0].stage, 'loading');
  assert.equal(session.pushed[1].stage, 'thumbs');
  assert.equal(session.pushed[2].stage, 'final');
  assert.equal(session.pushed[3].stage, 'redirect');
});

test('happy path: openUrl called exactly once with session URL', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const openUrlCalls = [];
  const deps = {
    ...baseDeps({ session, server, candidates }),
    openUrl: (url) => openUrlCalls.push(url),
  };

  await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(openUrlCalls.length, 1);
  assert.equal(openUrlCalls[0], session.url);
});

test('dismissed at thumbs stage: returns dismissed, no final card pushed', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'dismissed' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'dismissed');
  assert.ok(!session.pushed.some(s => s.stage === 'final'), 'final stage must not be pushed');
});

test('canceled at final stage: returns canceled', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_cancel' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'canceled');
});

test('shutdown is called on every exit path', async () => {
  // happy path
  {
    const candidates = makeCandidates(2);
    const session = mockSession({ actions: [{ type: 'thumbs_complete' }, { type: 'final_accept' }] });
    const server = mockServer(session);
    await runCartFlow({ query: 'q', retailers: ['marinelayer.com'], deps: baseDeps({ session, server, candidates }) });
    assert.equal(server.shutdownCount(), 1, 'happy path must shutdown');
  }
  // no_results — server not started, no shutdown call expected
  {
    const deps = { ...baseDeps(), search: async () => [], startServer: async () => { throw new Error('must not start'); } };
    await runCartFlow({ query: 'q', retailers: ['marinelayer.com'], deps });
  }
  // canceled
  {
    const candidates = makeCandidates(2);
    const session = mockSession({ actions: [{ type: 'thumbs_complete' }, { type: 'final_cancel' }] });
    const server = mockServer(session);
    await runCartFlow({ query: 'q', retailers: ['marinelayer.com'], deps: baseDeps({ session, server, candidates }) });
    assert.equal(server.shutdownCount(), 1, 'canceled must shutdown');
  }
  // dismissed
  {
    const candidates = makeCandidates(2);
    const session = mockSession({ actions: [{ type: 'dismissed' }] });
    const server = mockServer(session);
    await runCartFlow({ query: 'q', retailers: ['marinelayer.com'], deps: baseDeps({ session, server, candidates }) });
    assert.equal(server.shutdownCount(), 1, 'dismissed must shutdown');
  }
});
