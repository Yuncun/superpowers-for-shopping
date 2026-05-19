import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFeedbackFlow } from '../../lib/feedback-flow.js';

// ----- helpers --------------------------------------------------------------

function makeFakeSession() {
  // Mirror real server/state.js: queue actions when no waiter is parked,
  // resolve waiters when actions arrive. Without this, emitting an action
  // before nextAction() is called would leak past the (now-replaced) promise
  // and the flow would hang.
  const states = [];
  const queue = [];
  const waiters = [];

  const session = {
    url: 'http://127.0.0.1:1/r/x?token=y',
    pushState(state) { states.push(state); },
    nextAction({ types } = {}) {
      const i = queue.findIndex((a) => !types || types.includes(a.type));
      if (i !== -1) {
        const [a] = queue.splice(i, 1);
        return Promise.resolve(a);
      }
      return new Promise((resolve) => {
        waiters.push({ types, resolve });
      });
    },
    // test-only: simulate the browser POSTing an action
    _emit(action) {
      const i = waiters.findIndex((w) => !w.types || w.types.includes(action.type));
      if (i !== -1) {
        const [w] = waiters.splice(i, 1);
        w.resolve(action);
      } else {
        queue.push(action);
      }
    },
  };
  return { session, states };
}

function makeFakeServer(session) {
  let shutdownCalled = false;
  return {
    server: {
      createSession() { return session; },
      shutdown() { shutdownCalled = true; return Promise.resolve(); },
    },
    didShutdown() { return shutdownCalled; },
  };
}

const PENDING = [
  { date: '2026-05-12', item: 'Swim Trunk', brand: 'Marine Layer', $: '94.00', kept: '?', notes: '' },
  { date: '2026-05-10', item: 'Linen Shirt', brand: 'Uniqlo',       $: '49.99', kept: '?', notes: '' },
  { date: '2026-05-09', item: 'Crewneck',    brand: 'Aritzia',      $: '78.00', kept: '?', notes: '' },
];

// ----- tests ----------------------------------------------------------------

test('empty pending returns outcome=empty and does not start the server', async () => {
  let startCalled = false;
  const result = await runFeedbackFlow({
    deps: {
      listPending: async () => [],
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => { startCalled = true; return null; },
      render: () => '',
      openUrl: async () => {},
      log: () => {},
      sleep: async () => {},
    },
  });
  assert.deepEqual(result, { outcome: 'empty' });
  assert.equal(startCalled, false, 'startServer must not be called when pending is empty');
});

test('dismissed action returns outcome=dismissed and does not write', async () => {
  const { session } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let updateCalls = 0;
  const flow = runFeedbackFlow({
    deps: {
      listPending: async () => PENDING,
      updatePurchase: async () => { updateCalls++; return { updated: true }; },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => { session._emit({ type: 'dismissed' }); },
      log: () => {},
      sleep: async () => {},
    },
  });

  const result = await flow;
  assert.equal(result.outcome, 'dismissed');
  assert.equal(updateCalls, 0, 'no updates on dismiss');
});

test('submit with mixed decisions tallies kept/returned/skipped and writes only non-skip', async () => {
  const { session, states } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  const updateCalls = [];
  const flow = runFeedbackFlow({
    deps: {
      listPending: async () => PENDING,
      updatePurchase: async (key, upd) => { updateCalls.push({ key, upd }); return { updated: true }; },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({
          type: 'submit',
          items: [
            { date: '2026-05-12', item: 'Swim Trunk',  brand: 'Marine Layer', decision: 'yes',  notes: 'love them' },
            { date: '2026-05-10', item: 'Linen Shirt', brand: 'Uniqlo',       decision: 'no',   notes: 'wrong fit' },
            { date: '2026-05-09', item: 'Crewneck',    brand: 'Aritzia',      decision: 'skip', notes: '' },
          ],
        });
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  const result = await flow;
  assert.equal(result.outcome, 'success');
  assert.equal(result.kept, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);

  assert.equal(updateCalls.length, 2, 'only Kept and Returned items get written');
  assert.deepEqual(updateCalls[0], {
    key:  { date: '2026-05-12', item: 'Swim Trunk',  brand: 'Marine Layer' },
    upd:  { kept: 'yes', notes: 'love them' },
  });
  assert.deepEqual(updateCalls[1], {
    key:  { date: '2026-05-10', item: 'Linen Shirt', brand: 'Uniqlo' },
    upd:  { kept: 'no', notes: 'wrong fit' },
  });

  // State machine: form → saving → done
  const stages = states.map((s) => s.stage);
  assert.deepEqual(stages, ['form', 'saving', 'done']);
  assert.equal(states[2].kept, 1);
  assert.equal(states[2].returned, 1);
  assert.equal(states[2].skipped, 1);
  assert.equal(states[2].errors, 0);

  assert.ok(didShutdown(), 'server must be shut down after success');
});

test('updatePurchase failure increments errors and surfaces detail', async () => {
  const { session, states } = makeFakeSession();
  const { server } = makeFakeServer(session);

  let calls = 0;
  const result = await runFeedbackFlow({
    deps: {
      listPending: async () => PENDING.slice(0, 2),
      updatePurchase: async () => {
        calls++;
        if (calls === 1) return { updated: false, reason: 'not_found' };
        const err = new Error('write_failed');
        err.code = 'invalid_kept';
        throw err;
      },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({
          type: 'submit',
          items: [
            { date: '2026-05-12', item: 'Swim Trunk',  brand: 'Marine Layer', decision: 'yes', notes: '' },
            { date: '2026-05-10', item: 'Linen Shirt', brand: 'Uniqlo',       decision: 'no',  notes: '' },
          ],
        });
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'success');
  assert.equal(result.errors, 2);
  assert.equal(result.kept, 0);
  assert.equal(result.returned, 0);
  assert.deepEqual(result.errorDetails.map((e) => e.reason), ['not_found', 'invalid_kept']);

  const done = states.find((s) => s.stage === 'done');
  assert.ok(done, 'expected a done state');
  assert.match(done.message, /issues/i);
});

test('unknown decision values are treated as skip', async () => {
  const { session } = makeFakeSession();
  const { server } = makeFakeServer(session);

  const updateCalls = [];
  const result = await runFeedbackFlow({
    deps: {
      listPending: async () => PENDING.slice(0, 1),
      updatePurchase: async (key, upd) => { updateCalls.push({ key, upd }); return { updated: true }; },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({
          type: 'submit',
          items: [
            { date: '2026-05-12', item: 'Swim Trunk', brand: 'Marine Layer', decision: 'maybe', notes: '' },
          ],
        });
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.equal(result.outcome, 'success');
  assert.equal(result.skipped, 1);
  assert.equal(updateCalls.length, 0);
});

test('listPending throwing is reported as flow_error and server is never started', async () => {
  let startCalled = false;
  const result = await runFeedbackFlow({
    deps: {
      listPending: async () => { throw new Error('disk gone'); },
      updatePurchase: async () => ({ updated: true }),
      startServer: async () => { startCalled = true; return null; },
      render: () => '',
      openUrl: async () => {},
      log: () => {},
      sleep: async () => {},
    },
  });
  assert.equal(result.outcome, 'flow_error');
  assert.match(result.error, /list_pending_failed/);
  assert.equal(startCalled, false);
});

test('shutdown runs even when updatePurchase throws synchronously', async () => {
  const { session } = makeFakeSession();
  const { server, didShutdown } = makeFakeServer(session);

  await runFeedbackFlow({
    deps: {
      listPending: async () => PENDING.slice(0, 1),
      updatePurchase: async () => { throw new Error('boom'); },
      startServer: async () => server,
      render: () => '',
      openUrl: async () => {
        session._emit({
          type: 'submit',
          items: [{ date: '2026-05-12', item: 'Swim Trunk', brand: 'Marine Layer', decision: 'yes', notes: '' }],
        });
      },
      log: () => {},
      sleep: async () => {},
    },
  });

  assert.ok(didShutdown(), 'server must be shut down even after errors');
});
