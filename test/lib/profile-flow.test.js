import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProfileFlow } from '../../lib/profile-flow.js';

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

function emptyProfile() {
  return {
    sizes: {}, budget_default: 'mid', budget_caps: {}, palette: [],
    brands_love: [], brands_avoid: [], fit_notes: {}, moodboard_url: '',
    last_setup: null, purchase_history: [], thumb_signals: [],
  };
}

function emptyRetailers() {
  return { last_updated: '2026-05-23', retailers: [] };
}

// ---------- tests ----------

test('flow: pushes initial snapshot then awaits action', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {},
      log: () => {},
      sleep: async () => {},
    },
  });

  // Let initial pushSnapshot run.
  await new Promise((r) => setImmediate(r));
  assert.equal(states.length, 1);
  assert.equal(states[0].stage, 'main');
  assert.ok('profile' in states[0]);
  assert.ok('retailers' in states[0]);
  assert.ok('pending' in states[0]);

  session._emit({ type: 'dismissed' });
  const result = await flowP;
  assert.equal(result.outcome, 'success');
  assert.equal(result.actionsApplied, 0);
});

test('flow: submit-profile writes merged profile and emits success banner', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let written = null;
  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => written || emptyProfile(),
      writeProfile: async (p) => { written = p; },
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit-profile', profile: { budget_default: 'high' } });
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      now: () => '2026-05-23',
      log: () => {},
      sleep: async () => {},
    },
  });

  const result = await flowP;
  assert.equal(result.outcome, 'success');
  assert.equal(result.actionsApplied, 1);
  assert.equal(written.budget_default, 'high');
  assert.equal(written.last_setup, '2026-05-23');

  const successBanner = states.find((s) => s.banner && s.banner.tab === 'profile' && s.banner.kind === 'success');
  assert.ok(successBanner, 'expected success banner on profile tab');
});

test('flow: submit-profile validation failure emits error banner, no write', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let writeCalled = false;
  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => { writeCalled = true; },
      validateProfile: () => ({ valid: false, errors: ['budget_default must be one of low, mid, high'] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit-profile', profile: { budget_default: 'extravagant' } });
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  await flowP;
  assert.equal(writeCalled, false);
  const errBanner = states.find((s) => s.banner && s.banner.kind === 'error');
  assert.ok(errBanner, 'expected error banner');
  assert.match(errBanner.banner.text, /budget_default/);
});

test('flow: submit-retailer-add calls addRetailer and refreshes the snapshot', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let addCalled = null;
  let retailerList = [];

  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => ({ last_updated: '2026-05-23', retailers: retailerList.slice() }),
      addRetailer: async ({ host }) => {
        addCalled = host;
        retailerList = [{ host, tier: 2, handler: 'shopify', last_used: '' }];
        return { added: true };
      },
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit-retailer-add', host: 'newstore.com' });
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  await flowP;
  assert.equal(addCalled, 'newstore.com');
  const lastSnapshot = states[states.length - 1];
  assert.deepEqual(lastSnapshot.retailers, [{ host: 'newstore.com', tier: 2, handler: 'shopify', last_used: '' }]);
  const ok = states.find((s) => s.banner && s.banner.tab === 'retailers' && s.banner.kind === 'success');
  assert.ok(ok, 'expected retailers success banner');
});

test('flow: submit-retailer-add failure (not_shopify) emits friendly error', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: false, reason: 'not_shopify' }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit-retailer-add', host: 'wordpress-site.com' });
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  await flowP;
  const err = states.find((s) => s.banner && s.banner.kind === 'error' && /Shopify/.test(s.banner.text));
  assert.ok(err, 'expected not_shopify error banner');
});

test('flow: submit-retailer-remove calls removeRetailer and refreshes snapshot', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let removeCalled = null;
  let retailerList = [{ host: 'a.com', tier: 2, handler: 'shopify', last_used: '' }];

  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => ({ last_updated: '2026-05-23', retailers: retailerList.slice() }),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async (host) => {
        removeCalled = host;
        retailerList = [];
        return { removed: true };
      },
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit-retailer-remove', host: 'a.com' });
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  await flowP;
  assert.equal(removeCalled, 'a.com');
  const lastSnapshot = states[states.length - 1];
  assert.deepEqual(lastSnapshot.retailers, []);
});

test('flow: submit-feedback updates non-skip items and refreshes pending', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let pending = [
    { date: '2026-05-12', item: 'X', brand: 'A', $: '10' },
    { date: '2026-05-12', item: 'Y', brand: 'B', $: '20' },
  ];
  const updateCalls = [];

  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => pending,
      updatePurchase: async (key, upd) => {
        updateCalls.push({ key, upd });
        pending = pending.filter((p) => !(p.date === key.date && p.item === key.item && p.brand === key.brand));
        return { updated: true };
      },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({
          type: 'submit-feedback',
          items: [
            { date: '2026-05-12', item: 'X', brand: 'A', decision: 'yes', notes: '' },
            { date: '2026-05-12', item: 'Y', brand: 'B', decision: 'skip', notes: '' },
          ],
        });
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  await flowP;
  assert.equal(updateCalls.length, 1, 'only non-skip items get written');
  assert.equal(updateCalls[0].upd.kept, 'yes');
  const lastSnapshot = states[states.length - 1];
  assert.equal(lastSnapshot.pending.length, 1, 'remaining (skipped) item still pending');
  assert.equal(lastSnapshot.pending[0].item, 'Y');
});

test('flow: handler exception emits error banner and keeps session open', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let secondCall = false;
  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {
        if (!secondCall) { secondCall = true; throw new Error('disk full'); }
      },
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit-profile', profile: { budget_default: 'high' } });
        // After error banner, dismiss.
        queueMicrotask(() => session._emit({ type: 'dismissed' }));
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  const result = await flowP;
  assert.equal(result.outcome, 'success'); // dismissed
  const err = states.find((s) => s.banner && s.banner.kind === 'error' && /disk full/.test(s.banner.text));
  assert.ok(err, 'expected error banner mentioning disk full');
});

test('flow: initialTab is propagated into the snapshot', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => { session._emit({ type: 'dismissed' }); },
      initialTab: 'feedback',
      log: () => {},
      sleep: async () => {},
    },
  });

  await flowP;
  assert.equal(states[0].initialTab, 'feedback');
});

test('flow: load failure returns flow_error and never starts the server', async () => {
  let startCalled = false;
  const result = await runProfileFlow({
    deps: {
      readProfile: async () => { throw new Error('bad yaml'); },
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => { startCalled = true; return null; },
      render: () => '',
      openUrl: async () => {},
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'flow_error');
  assert.match(result.error, /load_failed/);
  assert.equal(startCalled, false);
});

test('flow: shutdown runs even when openUrl throws', async () => {
  const { session } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  await runProfileFlow({
    deps: {
      readProfile: async () => emptyProfile(),
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      readRetailers: async () => emptyRetailers(),
      addRetailer: async () => ({ added: true }),
      removeRetailer: async () => ({ removed: true }),
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => { throw new Error('open broken'); },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.ok(didShutdown(), 'shutdown must run after openUrl failure');
});
