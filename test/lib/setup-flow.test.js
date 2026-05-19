import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSetupFlow, mergeSubmittedProfile, diffProfiles } from '../../lib/setup-flow.js';

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

function defaultProfile() {
  return {
    sizes: {},
    budget_default: 'mid',
    budget_caps: {},
    palette: [],
    brands_love: [],
    brands_avoid: [],
    fit_notes: {},
    moodboard_url: '',
    last_setup: null,
    purchase_history: [],
    thumb_signals: [],
  };
}

// ---------- mergeSubmittedProfile ----------

test('merge: submitted scalars replace existing', () => {
  const before = { ...defaultProfile(), budget_default: 'mid', moodboard_url: 'a.com' };
  const after = mergeSubmittedProfile(before, { budget_default: 'high', moodboard_url: 'b.com' });
  assert.equal(after.budget_default, 'high');
  assert.equal(after.moodboard_url, 'b.com');
});

test('merge: missing submitted scalar leaves existing untouched', () => {
  const before = { ...defaultProfile(), budget_default: 'mid', moodboard_url: 'a.com' };
  const after = mergeSubmittedProfile(before, {});
  assert.equal(after.budget_default, 'mid');
  assert.equal(after.moodboard_url, 'a.com');
});

test('merge: submitted array replaces existing array', () => {
  const before = { ...defaultProfile(), brands_love: ['Uniqlo'] };
  const after = mergeSubmittedProfile(before, { brands_love: ['Aritzia', 'Patagonia'] });
  assert.deepEqual(after.brands_love, ['Aritzia', 'Patagonia']);
});

test('merge: submitted empty array clears existing', () => {
  const before = { ...defaultProfile(), brands_avoid: ['Shein'] };
  const after = mergeSubmittedProfile(before, { brands_avoid: [] });
  assert.deepEqual(after.brands_avoid, []);
});

test('merge: object field merges per-key, empty string clears the key', () => {
  const before = { ...defaultProfile(), sizes: { top: 'M', bottom: '32x32', shoes: 11 } };
  const after = mergeSubmittedProfile(before, { sizes: { top: 'L', bottom: '' } });
  assert.deepEqual(after.sizes, { top: 'L', shoes: 11 }, 'bottom cleared, top updated, shoes preserved');
});

test('merge: preserves untouched fields (palette, purchase_history)', () => {
  const before = { ...defaultProfile(), palette: ['navy'], purchase_history: [{ item: 'x' }] };
  const after = mergeSubmittedProfile(before, { budget_default: 'high' });
  assert.deepEqual(after.palette, ['navy']);
  assert.deepEqual(after.purchase_history, [{ item: 'x' }]);
});

// ---------- diffProfiles ----------

test('diff: surfaces budget_default change', () => {
  const lines = diffProfiles(
    { ...defaultProfile(), budget_default: 'mid' },
    { ...defaultProfile(), budget_default: 'high' },
  );
  assert.ok(lines.some((l) => l.startsWith('budget_default:')));
});

test('diff: surfaces array changes as bracketed list', () => {
  const lines = diffProfiles(
    { ...defaultProfile(), brands_love: [] },
    { ...defaultProfile(), brands_love: ['Uniqlo', 'Aritzia'] },
  );
  assert.ok(lines.some((l) => l.includes('brands_love: [Uniqlo, Aritzia]')));
});

test('diff: surfaces object key-level changes', () => {
  const lines = diffProfiles(
    { ...defaultProfile(), sizes: {} },
    { ...defaultProfile(), sizes: { top: 'M' } },
  );
  assert.ok(lines.some((l) => l.includes('sizes:') && l.includes('top=M')));
});

test('diff: identical profiles yield no lines', () => {
  const p = { ...defaultProfile(), sizes: { top: 'M' }, brands_love: ['Uniqlo'] };
  assert.deepEqual(diffProfiles(p, p), []);
});

// ---------- runSetupFlow ----------

test('flow: dismissed action returns outcome=dismissed and never writes', async () => {
  const { session } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  let writeCalled = false;
  const result = await runSetupFlow({
    deps: {
      readProfile: async () => defaultProfile(),
      writeProfile: async () => { writeCalled = true; },
      validateProfile: () => ({ valid: true, errors: [] }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => { session._emit({ type: 'dismissed' }); },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'dismissed');
  assert.equal(writeCalled, false);
  assert.ok(didShutdown(), 'server must shutdown on dismiss');
});

test('flow: submit writes merged profile and reports changes', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let written = null;
  const result = await runSetupFlow({
    deps: {
      readProfile: async () => defaultProfile(),
      writeProfile: async (p) => { written = p; },
      validateProfile: () => ({ valid: true, errors: [] }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({
          type: 'submit',
          profile: {
            sizes: { top: 'M', shoes: 11 },
            budget_default: 'high',
            brands_love: ['Uniqlo'],
            fit_notes: { tops: 'relaxed' },
          },
        });
      },
      now: () => '2026-05-19',
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'success');
  assert.ok(written, 'writeProfile must be called');
  assert.equal(written.budget_default, 'high');
  assert.equal(written.sizes.top, 'M');
  assert.equal(written.sizes.shoes, 11);
  assert.deepEqual(written.brands_love, ['Uniqlo']);
  assert.deepEqual(written.fit_notes, { tops: 'relaxed' });
  assert.equal(written.last_setup, '2026-05-19');

  // State machine: form → saving → done
  const stages = states.map((s) => s.stage);
  assert.deepEqual(stages, ['form', 'saving', 'done']);
});

test('flow: validation failure re-renders the form with errors and re-prompts', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let submitsSeen = 0;

  const result = await runSetupFlow({
    deps: {
      readProfile: async () => defaultProfile(),
      writeProfile: async () => {},
      validateProfile: (p) => {
        if (p.budget_default === 'extravagant') {
          return { valid: false, errors: ['budget_default must be one of low, mid, high'] };
        }
        return { valid: true, errors: [] };
      },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        // First submit is invalid; second is valid.
        session._emit({ type: 'submit', profile: { budget_default: 'extravagant' } });
        // The flow will push a form/errors state, then await another action.
        // Schedule the corrective submit shortly after.
        queueMicrotask(() => {
          submitsSeen++;
          session._emit({ type: 'submit', profile: { budget_default: 'high' } });
        });
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'success');
  assert.equal(result.profile.budget_default, 'high');

  // Expected states: form (initial), form+errors (after invalid submit), saving, done
  const formWithErrors = states.find((s) => s.stage === 'form' && s.errors && s.errors.length > 0);
  assert.ok(formWithErrors, 'must re-render form with errors after invalid submit');
  assert.match(formWithErrors.errors[0], /budget_default/);
});

test('flow: writeProfile failure re-renders form with error and allows retry', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let attempts = 0;
  const result = await runSetupFlow({
    deps: {
      readProfile: async () => defaultProfile(),
      writeProfile: async () => {
        attempts++;
        if (attempts === 1) throw new Error('disk full');
      },
      validateProfile: () => ({ valid: true, errors: [] }),
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({ type: 'submit', profile: { budget_default: 'high' } });
        queueMicrotask(() => {
          session._emit({ type: 'submit', profile: { budget_default: 'high' } });
        });
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'success');
  assert.equal(attempts, 2, 'second submit retries the write');
  const failureState = states.find((s) => s.stage === 'form' && s.errors && s.errors[0].includes('disk full'));
  assert.ok(failureState, 'must surface write error in form re-render');
});

test('flow: readProfile failure returns flow_error', async () => {
  let startCalled = false;
  const result = await runSetupFlow({
    deps: {
      readProfile: async () => { throw new Error('bad yaml'); },
      writeProfile: async () => {},
      validateProfile: () => ({ valid: true, errors: [] }),
      startServer: async () => { startCalled = true; return null; },
      render: () => '',
      openUrl: async () => {},
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'flow_error');
  assert.match(result.error, /bad yaml/);
  // readProfile throws BEFORE startServer is called, so the server is never started.
  assert.equal(startCalled, false);
});
