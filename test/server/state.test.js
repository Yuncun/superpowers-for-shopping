import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../server/state.js';

// --- session creation ---

test('createSession returns session with 16-char hex id and 32-char hex token', () => {
  const store = createStore();
  const s = store.createSession();
  assert.match(s.id, /^[0-9a-f]{16}$/);
  assert.match(s.token, /^[0-9a-f]{32}$/);
});

test('getSession returns the same session object', () => {
  const store = createStore();
  const s = store.createSession();
  assert.strictEqual(store.getSession(s.id), s);
});

test('getSession returns null for unknown id', () => {
  const store = createStore();
  assert.strictEqual(store.getSession('deadbeef00000000'), null);
});

test('two sequential createSession calls produce different ids', () => {
  const store = createStore();
  const a = store.createSession();
  const b = store.createSession();
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.token, b.token);
});

// --- pushState ---

test('pushState appends to stateLog and updates lastActivity', () => {
  let now = 1000;
  const store = createStore({ now: () => now });
  const s = store.createSession();
  const before = s.lastActivity;

  now = 2000;
  s.pushState({ stage: 'loading', message: 'go' });

  assert.equal(s.stateLog.length, 1);
  assert.deepEqual(s.stateLog[0], { stage: 'loading', message: 'go' });
  assert.equal(s.lastActivity, 2000);
  assert.ok(s.lastActivity > before);
});

// --- subscribe / unsubscribe ---

test('subscribe fn is called on pushState', () => {
  const store = createStore();
  const s = store.createSession();
  const received = [];
  s.subscribe(state => received.push(state));
  s.pushState({ stage: 'thumbs' });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { stage: 'thumbs' });
});

test('unsubscribe stops future notifications', () => {
  const store = createStore();
  const s = store.createSession();
  const received = [];
  const unsub = s.subscribe(state => received.push(state));
  s.pushState({ stage: 'loading', message: 'a' });
  unsub();
  s.pushState({ stage: 'loading', message: 'b' });
  assert.equal(received.length, 1);
});

// --- replayLog ---

test('replayLog calls fn with every past state in order', () => {
  const store = createStore();
  const s = store.createSession();
  s.pushState({ stage: 'loading', message: 'start' });
  s.pushState({ stage: 'thumbs', candidates: [] });
  const replayed = [];
  s.replayLog(state => replayed.push(state));
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0].stage, 'loading');
  assert.equal(replayed[1].stage, 'thumbs');
});

// --- recordAction / nextAction ---

test('recordAction then nextAction resolves immediately', async () => {
  const store = createStore();
  const s = store.createSession();
  s.recordAction({ type: 'thumb', index: 0, direction: 'up' });
  const action = await s.nextAction();
  assert.equal(action.type, 'thumb');
  assert.equal(action.index, 0);
});

test('nextAction then recordAction resolves the waiter', async () => {
  const store = createStore();
  const s = store.createSession();
  const p = s.nextAction();
  s.recordAction({ type: 'final_accept' });
  const action = await p;
  assert.equal(action.type, 'final_accept');
});

test('nextAction with types filter ignores non-matching actions', async () => {
  const store = createStore();
  const s = store.createSession();
  // post a non-matching action first
  s.recordAction({ type: 'final_accept' });
  // nextAction for 'thumb' only should NOT resolve immediately
  let resolved = false;
  const p = s.nextAction({ types: ['thumb'] }).then(a => { resolved = true; return a; });
  // give the microtask queue a tick
  await new Promise(r => setImmediate(r));
  assert.equal(resolved, false, 'waiter should not resolve on non-matching type');
  // now send the right type
  s.recordAction({ type: 'thumb', index: 1, direction: 'down' });
  const action = await p;
  assert.equal(resolved, true);
  assert.equal(action.type, 'thumb');
});

test('nextAction with timeoutMs rejects with Error("timeout")', async () => {
  const store = createStore();
  const s = store.createSession();
  await assert.rejects(
    () => s.nextAction({ timeoutMs: 50 }),
    err => err.message === 'timeout'
  );
});

test('close rejects all pending waiters with session_closed', async () => {
  const store = createStore();
  const s = store.createSession();
  const p1 = s.nextAction();
  const p2 = s.nextAction({ types: ['thumb'] });
  s.close();
  await assert.rejects(() => p1, err => err.message === 'session_closed');
  await assert.rejects(() => p2, err => err.message === 'session_closed');
});

// --- expireIdle ---

test('expireIdle closes old sessions and leaves recent ones open', () => {
  let now = 1_000_000;
  const store = createStore({ now: () => now });

  const old = store.createSession();
  // fast-forward 6 minutes
  now += 6 * 60 * 1000;
  const fresh = store.createSession();

  const count = store.expireIdle({ thresholdMs: 5 * 60 * 1000 });

  assert.equal(count, 1);
  assert.equal(old.closed, true);
  assert.equal(fresh.closed, false);
  // old session should be removed from store
  assert.strictEqual(store.getSession(old.id), null);
  // fresh session still accessible
  assert.strictEqual(store.getSession(fresh.id), fresh);
});
