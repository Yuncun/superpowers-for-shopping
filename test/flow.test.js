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
    readRetailers: async () => ({ retailers: [{ host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '' }] }),
    search: async (_host) => candidates,
    getCookieHeader: async () => 'sess=abc',
    addToCart: async () => ({ ok: true }),
    startServer: async () => server,
    openUrl: () => {},
    log: () => {},
    sleep: async () => {},
    appendPurchase: async () => {},
    now: () => '2026-05-11',
    applyRanking: (c) => c,
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

// ---------------------------------------------------------------------------
// Task 2: auth + cart error paths
// ---------------------------------------------------------------------------

test('dismissed when getCookieHeader returns null and user dismisses login prompt', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'dismissed' },
  ]});
  const server = mockServer(session);
  let addToCartCalled = false;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => null,
    addToCart: async () => { addToCartCalled = true; return { ok: true }; },
    openLoginPage: async () => {},
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(addToCartCalled, false, 'addToCart must NOT be called when cookie is null');
  assert.equal(server.shutdownCount(), 1);
});

test('dismissed when addToCart returns authentication_required and user dismisses login prompt', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'dismissed' },
  ]});
  const server = mockServer(session);
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => 'sess=abc',
    addToCart: async () => ({ ok: false, error: 'authentication_required' }),
    openLoginPage: async () => {},
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(server.shutdownCount(), 1);
});

test('cart_error when addToCart returns non-auth error', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => 'sess=abc',
    addToCart: async () => ({ ok: false, error: 'out_of_stock' }),
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'cart_error');
  assert.equal(result.host, 'marinelayer.com');
  assert.equal(result.error, 'out_of_stock');
  const doneState = session.pushed.find(s => s.stage === 'done');
  assert.ok(doneState, 'done stage must be pushed');
  assert.ok(doneState.message.includes('out_of_stock'), 'message includes the error');
  assert.equal(server.shutdownCount(), 1);
});

test('cart_error when top.variants is empty — addToCart not called', async () => {
  const candidates = [
    {
      url: 'https://marinelayer.com/products/empty-variants',
      title: 'Empty Variants Product',
      brand: 'Marine Layer',
      price: '59.00',
      image: null,
      variants: [],
    },
  ];
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  let addToCartCalled = false;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    addToCart: async () => { addToCartCalled = true; return { ok: true }; },
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'cart_error');
  assert.equal(result.error, 'no_variants');
  assert.equal(addToCartCalled, false, 'addToCart must NOT be called when variants is empty');
  assert.equal(server.shutdownCount(), 1);
});

test('regression: success still works after Task 2 changes', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const deps = { ...baseDeps({ session, server, candidates }) };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.ok(result.product);
  assert.ok(result.cartUrl.startsWith('https://'));
  assert.equal(server.shutdownCount(), 1);
});

// ---------------------------------------------------------------------------
// Task 3: no-retailers form — reads from store
// ---------------------------------------------------------------------------

test('no retailers arg: reads from store and searches that host', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  let readRetailersCalled = 0;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    readRetailers: async () => {
      readRetailersCalled++;
      return { retailers: [{ host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '' }] };
    },
    search: async (host, _query) => {
      assert.equal(host, 'marinelayer.com');
      return candidates;
    },
  };

  const result = await runCartFlow({ query: 'sweater', deps });
  assert.equal(result.outcome, 'success');
  assert.equal(readRetailersCalled, 1, 'readRetailers must be called once');
});

test('explicit retailers arg: readRetailers is NOT called', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  let readRetailersCalled = 0;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    readRetailers: async () => {
      readRetailersCalled++;
      return { retailers: [] };
    },
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['x.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(readRetailersCalled, 0, 'readRetailers must NOT be called when retailers is explicit');
});

test('empty retailers from store: returns no_results without starting server', async () => {
  let startServerCalled = false;
  const deps = {
    ...baseDeps(),
    readRetailers: async () => ({ retailers: [] }),
    startServer: async () => { startServerCalled = true; return mockServer(mockSession()); },
  };

  const result = await runCartFlow({ query: 'sweater', deps });
  assert.equal(result.outcome, 'no_results');
  assert.equal(startServerCalled, false, 'startServer must NOT be called on no_results');
});

// ---------------------------------------------------------------------------
// Task 2 (Plan 7): login retry loop
// ---------------------------------------------------------------------------

test('login retry happy path: null cookie first, cookie on retry, success', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'login_complete' },
  ]});
  const server = mockServer(session);
  let cookieCallCount = 0;
  let openLoginPageCalls = [];
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async (host) => {
      cookieCallCount++;
      return cookieCallCount === 1 ? null : 'sess=abc';
    },
    addToCart: async () => ({ ok: true }),
    openLoginPage: async (host) => { openLoginPageCalls.push(host); },
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(openLoginPageCalls.length, 1, 'openLoginPage called once');
  assert.equal(openLoginPageCalls[0], 'marinelayer.com');
  const loginState = session.pushed.find(s => s.stage === 'login_required');
  assert.ok(loginState, 'login_required stage must be pushed');
  assert.equal(server.shutdownCount(), 1);
});

test('login retry: null cookie both attempts → auth_required', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'login_complete' },
  ]});
  const server = mockServer(session);
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => null,
    addToCart: async () => ({ ok: true }),
    openLoginPage: async () => {},
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'auth_required');
  assert.equal(result.host, 'marinelayer.com');
  assert.equal(server.shutdownCount(), 1);
});

test('login retry: dismissed during login_required → dismissed', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'dismissed' },
  ]});
  const server = mockServer(session);
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => null,
    addToCart: async () => ({ ok: true }),
    openLoginPage: async () => {},
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(server.shutdownCount(), 1);
});

test('login retry: addToCart auth_required first, ok on retry → success', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'login_complete' },
  ]});
  const server = mockServer(session);
  let addToCartCallCount = 0;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => 'sess=abc',
    addToCart: async () => {
      addToCartCallCount++;
      return addToCartCallCount === 1
        ? { ok: false, error: 'authentication_required' }
        : { ok: true };
    },
    openLoginPage: async () => {},
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(addToCartCallCount, 2, 'addToCart called twice (once per attempt)');
  const loginState = session.pushed.find(s => s.stage === 'login_required');
  assert.ok(loginState, 'login_required stage must be pushed');
  assert.equal(server.shutdownCount(), 1);
});

test('login retry: non-auth cart error does not trigger retry', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  let openLoginPageCalled = false;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => 'sess=abc',
    addToCart: async () => ({ ok: false, error: 'out_of_stock' }),
    openLoginPage: async () => { openLoginPageCalled = true; },
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'cart_error');
  assert.equal(result.error, 'out_of_stock');
  assert.equal(openLoginPageCalled, false, 'openLoginPage must NOT be called for non-auth errors');
  assert.equal(server.shutdownCount(), 1);
});

test('login retry: openLoginPage is fire-and-forget — slow promise does not block flow', async () => {
  const candidates = makeCandidates(2);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
    { type: 'dismissed' },
  ]});
  const server = mockServer(session);
  // openLoginPage returns a promise that never resolves — flow must still proceed
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => null,
    addToCart: async () => ({ ok: true }),
    openLoginPage: (_host) => new Promise(() => {}), // never resolves
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  // Flow reached login prompt, user dismissed — must not hang
  assert.equal(result.outcome, 'dismissed');
  assert.equal(server.shutdownCount(), 1);
});

test('addToCart is called with correct host, variantId, and cookie', async () => {
  const candidates = [
    {
      url: 'https://marinelayer.com/products/some-sweater',
      title: 'Some Sweater',
      brand: 'Marine Layer',
      price: '75.00',
      image: null,
      variants: [{ size: 'M', color: 'Navy', in_stock: true, variant_id: 9876 }],
    },
  ];
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  let capturedArgs;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    getCookieHeader: async () => 'mysess=xyz',
    addToCart: async (args) => { capturedArgs = args; return { ok: true }; },
  };

  await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.ok(capturedArgs, 'addToCart was called');
  assert.equal(capturedArgs.host, 'marinelayer.com');
  assert.equal(capturedArgs.variantId, 9876);
  assert.equal(capturedArgs.cookie, 'mysess=xyz');
});

// ---------------------------------------------------------------------------
// Task 3 (Plan 8): appendPurchase called on success, not on other outcomes
// ---------------------------------------------------------------------------

test('success path calls appendPurchase once with correct fields', async () => {
  const candidates = [
    {
      url: 'https://marinelayer.com/products/swim-trunk',
      title: '5" Tailored Swim Trunk',
      brand: 'Marine Layer',
      price: '94.00',
      image: null,
      variants: [{ size: 'M', color: 'Navy', in_stock: true, variant_id: 1001 }],
    },
  ];
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const appendCalls = [];
  const deps = {
    ...baseDeps({ session, server, candidates }),
    appendPurchase: async (row) => { appendCalls.push(row); },
    now: () => '2026-05-11',
  };

  const result = await runCartFlow({ query: 'swim trunk', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.equal(appendCalls.length, 1, 'appendPurchase must be called exactly once');
  assert.deepEqual(appendCalls[0], {
    date: '2026-05-11',
    item: '5" Tailored Swim Trunk',
    brand: 'Marine Layer',
    '$': '94.00',
    kept: '?',
    notes: '',
  });
});

test('non-success outcomes do NOT call appendPurchase', async () => {
  const candidates = makeCandidates(2);
  const appendCalls = [];
  const appendSpy = async (row) => { appendCalls.push(row); };

  // canceled
  {
    const session = mockSession({ actions: [{ type: 'thumbs_complete' }, { type: 'final_cancel' }] });
    const server = mockServer(session);
    const result = await runCartFlow({
      query: 'q', retailers: ['marinelayer.com'],
      deps: { ...baseDeps({ session, server, candidates }), appendPurchase: appendSpy },
    });
    assert.equal(result.outcome, 'canceled');
  }

  // dismissed
  {
    const session = mockSession({ actions: [{ type: 'dismissed' }] });
    const server = mockServer(session);
    const result = await runCartFlow({
      query: 'q', retailers: ['marinelayer.com'],
      deps: { ...baseDeps({ session, server, candidates }), appendPurchase: appendSpy },
    });
    assert.equal(result.outcome, 'dismissed');
  }

  assert.equal(appendCalls.length, 0, 'appendPurchase must NOT be called on canceled or dismissed');
});

// ---------------------------------------------------------------------------
// Plan 9: ranking integration
// ---------------------------------------------------------------------------

test('ranking: applyRanking is called with deduped candidates and the profile', async () => {
  const candidates = makeCandidates(3);
  const session = mockSession({ actions: [
    { type: 'thumbs_complete' },
    { type: 'final_accept' },
  ]});
  const server = mockServer(session);
  const mockProfile = { brands_avoid: [], brands_love: [], budget_caps: {} };

  let capturedCandidates;
  let capturedProfile;
  const deps = {
    ...baseDeps({ session, server, candidates }),
    readProfile: async () => mockProfile,
    applyRanking: (c, p) => {
      capturedCandidates = c;
      capturedProfile = p;
      return c; // identity — don't filter anything
    },
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'success');
  assert.ok(capturedCandidates, 'applyRanking must have been called');
  assert.equal(capturedCandidates.length, candidates.length, 'deduped candidates passed to applyRanking');
  assert.equal(capturedProfile, mockProfile, 'profile passed to applyRanking');
});

test('ranking: empty applyRanking output returns no_results without starting server', async () => {
  let startServerCalled = false;
  const candidates = makeCandidates(8);
  const deps = {
    ...baseDeps({ candidates }),
    applyRanking: () => [], // filter everything out
    startServer: async () => { startServerCalled = true; return mockServer(mockSession()); },
  };

  const result = await runCartFlow({ query: 'sweater', retailers: ['marinelayer.com'], deps });
  assert.equal(result.outcome, 'no_results');
  assert.equal(startServerCalled, false, 'startServer must NOT be called when ranked result is empty');
});
