import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProfileFlow, mergeSubmittedProfile } from '../../lib/profile-flow.js';

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
    last_setup: null, purchase_history: [],
  };
}

function emptyRetailers() {
  return { last_updated: '2026-05-23', retailers: [] };
}

function baseDeps(overrides = {}) {
  return {
    readProfile: async () => emptyProfile(),
    writeProfile: async () => {},
    validateProfile: () => ({ valid: true, errors: [] }),
    readRetailers: async () => emptyRetailers(),
    addRetailer: async () => ({ added: true }),
    removeRetailer: async () => ({ removed: true }),
    render: () => '',
    openUrl: async () => {},
    log: () => {},
    sleep: async () => {},
    ...overrides,
  };
}

// ---------- mergeSubmittedProfile ----------

test('mergeSubmittedProfile: scalar fields are replaced', () => {
  const merged = mergeSubmittedProfile(
    { budget_default: 'mid', moodboard_url: '' },
    { budget_default: 'high', moodboard_url: 'https://x.com' },
  );
  assert.equal(merged.budget_default, 'high');
  assert.equal(merged.moodboard_url, 'https://x.com');
});

test('mergeSubmittedProfile: array fields are replaced (not concatenated)', () => {
  const merged = mergeSubmittedProfile(
    { brands_love: ['A', 'B'], brands_avoid: [] },
    { brands_love: ['C'] },
  );
  assert.deepEqual(merged.brands_love, ['C']);
  assert.deepEqual(merged.brands_avoid, []);
});

test('mergeSubmittedProfile: object field empty value clears the key', () => {
  const merged = mergeSubmittedProfile(
    { sizes: { top: 'M', bottom: '32x32' } },
    { sizes: { top: '' } },
  );
  assert.deepEqual(merged.sizes, { bottom: '32x32' });
});

test('mergeSubmittedProfile: object field new key is added', () => {
  const merged = mergeSubmittedProfile(
    { sizes: { top: 'M' } },
    { sizes: { shoes: '11.5' } },
  );
  assert.deepEqual(merged.sizes, { top: 'M', shoes: '11.5' });
});

// ---------- flow ----------

test('flow: pushes initial snapshot then awaits action', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runProfileFlow({
    deps: baseDeps({ startServer: async () => server }),
  });

  await new Promise((r) => setImmediate(r));
  assert.equal(states.length, 1);
  assert.equal(states[0].stage, 'main');
  assert.ok('profile' in states[0]);
  assert.ok('retailers' in states[0]);
  assert.ok(!('pending' in states[0]));

  session._emit({ type: 'dismissed' });
  const result = await flowP;
  assert.equal(result.outcome, 'success');
});

test('flow: submit-profile writes merged profile and emits success banner', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);
  let written;

  const flowP = runProfileFlow({
    deps: baseDeps({
      startServer: async () => server,
      writeProfile: async (p) => { written = p; },
      readProfile: async () => written || emptyProfile(),
    }),
  });

  await new Promise((r) => setImmediate(r));
  session._emit({
    type: 'submit-profile',
    profile: { budget_default: 'high', brands_love: ['Uniqlo'] },
  });
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  assert.equal(written.budget_default, 'high');
  assert.deepEqual(written.brands_love, ['Uniqlo']);
  const banner = states[states.length - 1].banner;
  assert.equal(banner.kind, 'success');
});

test('flow: submit-profile validation failure emits error banner, no write', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);
  let wrote = false;

  const flowP = runProfileFlow({
    deps: baseDeps({
      startServer: async () => server,
      validateProfile: () => ({ valid: false, errors: ['bad budget'] }),
      writeProfile: async () => { wrote = true; },
    }),
  });

  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'submit-profile', profile: {} });
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  assert.equal(wrote, false);
  const banner = states[states.length - 1].banner;
  assert.equal(banner.kind, 'error');
  assert.ok(banner.text.includes('bad budget'));
});

test('flow: submit-retailer-add success refreshes snapshot', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let addedHost;
  let retailers = [];
  const flowP = runProfileFlow({
    deps: baseDeps({
      startServer: async () => server,
      addRetailer: async ({ host }) => { addedHost = host; retailers = [{ host, tier: 2, handler: 'shopify' }]; return { added: true }; },
      readRetailers: async () => ({ last_updated: '2026-05-24', retailers }),
    }),
  });

  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'submit-retailer-add', host: 'marinelayer.com' });
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  assert.equal(addedHost, 'marinelayer.com');
  const final = states[states.length - 1];
  assert.equal(final.retailers.length, 1);
  assert.equal(final.banner.kind, 'success');
});

test('flow: submit-retailer-add failure (not_shopify) emits friendly error', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runProfileFlow({
    deps: baseDeps({
      startServer: async () => server,
      addRetailer: async () => ({ added: false, reason: 'not_shopify' }),
    }),
  });

  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'submit-retailer-add', host: 'amazon.com' });
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  const banner = states[states.length - 1].banner;
  assert.equal(banner.kind, 'error');
  assert.ok(banner.text.includes('Shopify'));
});

test('flow: submit-retailer-remove refreshes snapshot', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let removedHost;
  let retailers = [{ host: 'marinelayer.com', tier: 2, handler: 'shopify' }];
  const flowP = runProfileFlow({
    deps: baseDeps({
      startServer: async () => server,
      removeRetailer: async (host) => { removedHost = host; retailers = []; return { removed: true }; },
      readRetailers: async () => ({ last_updated: '2026-05-24', retailers }),
    }),
  });

  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'submit-retailer-remove', host: 'marinelayer.com' });
  await new Promise((r) => setImmediate(r));
  session._emit({ type: 'dismissed' });
  await flowP;

  assert.equal(removedHost, 'marinelayer.com');
  const final = states[states.length - 1];
  assert.equal(final.retailers.length, 0);
  assert.equal(final.banner.kind, 'success');
});

test('flow: initialTab is propagated into the snapshot', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const flowP = runProfileFlow({
    deps: baseDeps({ startServer: async () => server, initialTab: 'retailers' }),
  });

  await new Promise((r) => setImmediate(r));
  assert.equal(states[0].initialTab, 'retailers');

  session._emit({ type: 'dismissed' });
  await flowP;
});

test('flow: load failure returns flow_error and never starts the server', async () => {
  let serverStarted = false;
  const result = await runProfileFlow({
    deps: baseDeps({
      readProfile: async () => { throw new Error('disk gone'); },
      startServer: async () => { serverStarted = true; return null; },
    }),
  });
  assert.equal(result.outcome, 'flow_error');
  assert.ok(/disk gone/.test(result.error));
  assert.equal(serverStarted, false);
});

test('flow: shutdown runs even when openUrl throws', async () => {
  const { session } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  const result = await runProfileFlow({
    deps: baseDeps({
      startServer: async () => server,
      openUrl: async () => { throw new Error('open fail'); },
    }),
  });
  assert.equal(result.outcome, 'flow_error');
  assert.equal(didShutdown(), true);
});
