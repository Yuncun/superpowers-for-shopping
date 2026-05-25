import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCartFlow, diversify, simplifyQuery } from '../lib/flow.js';

// ---------- helpers ----------

function makeFakeSession() {
  const states = [];
  const queue = [];
  const waiters = [];
  return {
    states,
    session: {
      url: 'http://127.0.0.1:1/r/x?token=y',
      pushState(state) { states.push(state); },
      nextAction({ types } = {}) {
        const i = queue.findIndex((a) => !types || types.includes(a.type));
        if (i !== -1) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((resolve) => waiters.push({ types, resolve }));
      },
      _emit(action) {
        const i = waiters.findIndex((w) => !w.types || w.types.includes(action.type));
        if (i !== -1) {
          const [w] = waiters.splice(i, 1);
          w.resolve(action);
        } else {
          queue.push(action);
        }
      },
    },
  };
}

function makeFakeServer(session) {
  let shutdownCalled = false;
  return {
    server: {
      createSession() { return session; },
      shutdown() { shutdownCalled = true; return Promise.resolve(); },
    },
    didShutdown: () => shutdownCalled,
  };
}

function emptyProfile(overrides = {}) {
  return {
    sizes: {}, budget_default: 'mid', budget_caps: {}, palette: [],
    brands_love: [], brands_avoid: [], fit_notes: {}, moodboard_url: '',
    last_setup: null, purchase_history: [],
    ...overrides,
  };
}

function product(host, i, overrides = {}) {
  return {
    title: `Item ${i}`,
    brand: `Brand ${host}`,
    price: '100.00',
    url: `https://${host}/products/item-${i}`,
    image: `https://${host}/images/${i}.jpg`,
    variants: [{ size: 'M', color: 'navy', in_stock: true, variant_id: 1000 + i }],
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    readProfile: async () => emptyProfile(),
    readRetailers: async () => ({ last_updated: '', retailers: [] }),
    search: async () => [],
    openUrl: async () => {},
    log: () => {},
    sleep: async () => {},
    buildPermalink: (host, variants) => `https://${host}/cart/${variants.map(v => v.variant_id + ':1').join(',')}`,
    ...overrides,
  };
}

// ---------- simplifyQuery ----------

test('simplifyQuery: passes simple noun phrase through unchanged', () => {
  assert.equal(simplifyQuery('sweater'), 'sweater');
  assert.equal(simplifyQuery('wool sweater'), 'wool sweater');
  assert.equal(simplifyQuery('merino crewneck pullover'), 'merino crewneck pullover');
});

test('simplifyQuery: cuts at dash-separated descriptive clause', () => {
  assert.equal(simplifyQuery('A sweater - light, kind of baggy, modern'), 'sweater');
  assert.equal(simplifyQuery('linen pants — slim, cropped'), 'linen pants');
});

test('simplifyQuery: cuts at first comma', () => {
  assert.equal(simplifyQuery('linen pants, baggy'), 'linen pants');
});

test('simplifyQuery: cuts at parenthetical', () => {
  assert.equal(simplifyQuery('white tee (relaxed fit)'), 'white tee');
});

test('simplifyQuery: strips leading articles', () => {
  assert.equal(simplifyQuery('A sweater'), 'sweater');
  assert.equal(simplifyQuery('an oxford shirt'), 'oxford shirt');
  assert.equal(simplifyQuery('The boxy crew'), 'boxy crew');
  assert.equal(simplifyQuery('some chinos'), 'chinos');
  assert.equal(simplifyQuery('any blazer'), 'blazer');
});

test('simplifyQuery: empty / whitespace returns empty string', () => {
  assert.equal(simplifyQuery(''), '');
  assert.equal(simplifyQuery('   '), '');
  assert.equal(simplifyQuery(null), '');
  assert.equal(simplifyQuery(undefined), '');
});

test('simplifyQuery: does not eat words mid-noun-phrase', () => {
  // "Andre Agassi tee" must not lose the "A" — the article regex requires a
  // word boundary that's a standalone article, not a prefix.
  assert.equal(simplifyQuery('Andre Agassi tee'), 'Andre Agassi tee');
});

test('flow: uses simplified query for search calls but echoes original in UI', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);
  const seenQueries = [];

  const flowP = runCartFlow({
    query: 'A sweater - light, kind of baggy, modern',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host, q) => { seenQueries.push(q); return [product(host, 1)]; },
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  // Retailer received the simplified query.
  assert.equal(seenQueries[0], 'sweater');
  // UI still sees the original query string.
  assert.equal(states[0].query, 'A sweater - light, kind of baggy, modern');
});

// ---------- diversify ----------

test('diversify: round-robins across hosts with per-host cap', () => {
  const byHost = new Map([
    ['a.com', [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]],
    ['b.com', [{ id: 'b1' }, { id: 'b2' }]],
    ['c.com', [{ id: 'c1' }]],
  ]);
  const out = diversify(byHost, 2, 5);
  // first round: a1, b1, c1; second round: a2, b2 — c is exhausted.
  assert.deepEqual(out.map(x => x.id), ['a1', 'b1', 'c1', 'a2', 'b2']);
});

test('diversify: with abundant supply from one host, fills past cap (phase-2 refill)', () => {
  const byHost = new Map([
    ['a.com', Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i }))],
  ]);
  const out = diversify(byHost, 2, 5);
  // Phase 1 takes 2 from a.com (the cap); phase 2 keeps going to reach n=5.
  assert.equal(out.length, 5);
  assert.deepEqual(out.map(x => x.id), ['a0', 'a1', 'a2', 'a3', 'a4']);
});

test('diversify: respects cap when multiple hosts can satisfy n', () => {
  const byHost = new Map([
    ['a.com', Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i }))],
    ['b.com', Array.from({ length: 10 }, (_, i) => ({ id: 'b' + i }))],
    ['c.com', Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i }))],
  ]);
  const out = diversify(byHost, 2, 5);
  // Phase 1 fills exactly 5 (2+2+1) before phase 2 ever runs.
  assert.equal(out.length, 5);
  assert.deepEqual(out.map(x => x.id), ['a0', 'b0', 'c0', 'a1', 'b1']);
});

test('diversify: stops at n', () => {
  const byHost = new Map([
    ['a.com', [{ id: 'a1' }, { id: 'a2' }]],
    ['b.com', [{ id: 'b1' }, { id: 'b2' }]],
    ['c.com', [{ id: 'c1' }, { id: 'c2' }]],
    ['d.com', [{ id: 'd1' }, { id: 'd2' }]],
  ]);
  const out = diversify(byHost, 2, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(x => x.id), ['a1', 'b1', 'c1']);
});

// ---------- runCartFlow ----------

test('flow: no retailers → no_retailers outcome, no server started', async () => {
  let serverStarted = false;
  const result = await runCartFlow({
    query: 'sweater',
    deps: baseDeps({
      startServer: async () => { serverStarted = true; return null; },
    }),
  });
  assert.equal(result.outcome, 'no_retailers');
  assert.equal(serverStarted, false);
});

test('flow: empty search results → empty stage → no_results on dismiss', async () => {
  const { session, states } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async () => [],
    }),
  });

  // Drive: dismiss after the 'empty' state arrives.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });

  const result = await flowP;
  assert.equal(result.outcome, 'no_results');
  assert.equal(didShutdown(), true);
  assert.ok(states.some(s => s.stage === 'empty'));
});

test('flow: pushes initial searching state with all retailers pending', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);
  // search never resolves so we can inspect early state.
  const result = await Promise.race([
    runCartFlow({
      query: 'sweater',
      retailers: ['a.com', 'b.com'],
      deps: baseDeps({
        startServer: async () => server,
        search: () => new Promise(() => {}),
      }),
    }),
    new Promise((r) => setTimeout(() => r({ outcome: 'timeout' }), 50)),
  ]);
  assert.equal(result.outcome, 'timeout');
  const initial = states[0];
  assert.equal(initial.stage, 'searching');
  assert.equal(initial.query, 'sweater');
  assert.equal(initial.retailers.length, 2);
  assert.equal(initial.retailers[0].status, 'pending');
  assert.equal(initial.retailers[1].status, 'pending');
});

test('flow: search errors mark that retailer status=error, continue with others', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['good.com', 'bad.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => {
        if (host === 'bad.com') throw new Error('boom');
        return [product(host, 1)];
      },
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  const result = await flowP;

  assert.equal(result.outcome, 'dismissed');
  const last = states[states.length - 2]; // 'done' stage before dismiss snapshot
  const lastSearching = states.filter(s => s.stage === 'searching').pop();
  const bad = lastSearching.retailers.find(r => r.host === 'bad.com');
  const good = lastSearching.retailers.find(r => r.host === 'good.com');
  assert.equal(bad.status, 'error');
  assert.equal(good.status, 'done');
});

test('flow: picks top-N diversified across retailers', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let permalinkArgs = [];

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com', 'b.com', 'c.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [
        product(host, 1),
        product(host, 2),
        product(host, 3),
        product(host, 4),
      ],
      buildPermalink: (host, variants) => {
        permalinkArgs.push({ host, variants });
        return `https://${host}/cart/permalink`;
      },
    }),
  });

  // Wait for done state, then dismiss
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  const done = states.find(s => s.stage === 'done');
  assert.ok(done, 'expected a done state');
  assert.equal(done.picks.length, 5);
  // 2 hosts get 2 picks, 1 host gets 1 (round-robin caps at 2/host)
  const counts = {};
  for (const p of done.picks) counts[p.host] = (counts[p.host] || 0) + 1;
  const sortedCounts = Object.values(counts).sort();
  assert.deepEqual(sortedCounts, [1, 2, 2]);
  // Carts have one permalink per host involved.
  assert.equal(done.carts.length, 3);
});

test('flow: review action opens each cart permalink and appends purchases', async () => {
  const { session } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const openedUrls = [];
  const appendedRows = [];

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [product(host, 1), product(host, 2)],
      openUrl: async (url) => { openedUrls.push(url); },
      appendPurchase: async (row) => { appendedRows.push(row); },
      now: () => '2026-05-24',
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'review' });
  const result = await flowP;

  assert.equal(result.outcome, 'reviewed');
  // Local UI server opens first, then cart permalinks.
  assert.equal(openedUrls[0], session.url || 'http://127.0.0.1:1/r/x?token=y');
  assert.ok(openedUrls.some(u => u.includes('a.com/cart/')));
  // 2 picks → 2 history rows.
  assert.equal(appendedRows.length, 2);
  assert.equal(appendedRows[0].date, '2026-05-24');
  assert.ok(appendedRows[0].url.startsWith('https://a.com/'));
});

test('flow: review updates profile palette when new color tokens appear', async () => {
  const { session } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let updatedPalette = null;

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [product(host, 1, { title: 'Navy crew' })],
      readProfile: async () => emptyProfile({ palette: [] }),
      extractColors: (p) => p.title.toLowerCase().includes('navy') ? ['navy'] : [],
      mergePalette: (existing, additions) => Array.from(new Set([...existing, ...additions])),
      updateProfile: async (updates) => { updatedPalette = updates.palette; },
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'review' });
  await flowP;

  assert.deepEqual(updatedPalette, ['navy']);
});

test('flow: drops products with empty variants array', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [
        { ...product(host, 1), variants: [] }, // dropped
        product(host, 2),
      ],
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  const done = states.find(s => s.stage === 'done');
  assert.equal(done.picks.length, 1);
  assert.ok(done.picks[0].url.includes('item-2'));
});

test('flow: dedupes by URL within one retailer', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [
        product(host, 1),
        product(host, 1), // duplicate URL
        product(host, 2),
      ],
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  const done = states.find(s => s.stage === 'done');
  assert.equal(done.picks.length, 2);
});

test('flow: shutdown always runs even when search throws', async () => {
  const { session } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async () => { throw new Error('boom'); },
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;
  assert.equal(didShutdown(), true);
});

test('flow: session_closed error is treated as dismissal', async () => {
  const { session } = makeFakeSession();
  const { server } = makeFakeServer(session);
  // Override nextAction to throw session_closed.
  session.nextAction = () => Promise.reject(Object.assign(new Error('session_closed'), {}));

  const result = await runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [product(host, 1)],
    }),
  });
  assert.equal(result.outcome, 'dismissed');
});

test('flow: serialized picks expose only display fields (no variants/internal data)', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runCartFlow({
    query: 'sweater',
    retailers: ['a.com'],
    deps: baseDeps({
      startServer: async () => server,
      search: async (host) => [product(host, 1)],
    }),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  const done = states.find(s => s.stage === 'done');
  const pick = done.picks[0];
  // Display fields present:
  for (const k of ['title', 'brand', 'price', 'image', 'url', 'host']) {
    assert.ok(k in pick, `serialized pick missing ${k}`);
  }
  // Internal fields stripped:
  assert.ok(!('variants' in pick), 'variants must be stripped from serialized pick');
});
