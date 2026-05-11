// server/state.js
// Pure session store: createSession, pushState, recordAction, nextAction, expireIdle.
// No I/O, no HTTP. All side-effecting deps are injected for testability.

import * as crypto from 'node:crypto';

export function createStore({ now = Date.now, randomBytes = crypto.randomBytes } = {}) {
  const sessions = new Map();

  function createSession() {
    const id = randomBytes(8).toString('hex');
    const token = randomBytes(16).toString('hex');

    const stateLog = [];
    let lastActivity = now();
    const actionQueue = [];
    const waiters = [];
    const subscribers = new Set();
    let closed = false;

    function pushState(state) {
      stateLog.push(state);
      lastActivity = now();
      for (const fn of subscribers) fn(state);
    }

    function recordAction(action) {
      lastActivity = now();
      // Find the oldest matching waiter (FIFO).
      const idx = waiters.findIndex(w => !w.types || w.types.includes(action.type));
      if (idx !== -1) {
        const [waiter] = waiters.splice(idx, 1);
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve(action);
      } else {
        actionQueue.push(action);
      }
    }

    function nextAction({ types, timeoutMs } = {}) {
      if (closed) return Promise.reject(new Error('session_closed'));

      // Check actionQueue for an immediate match.
      const idx = actionQueue.findIndex(a => !types || types.includes(a.type));
      if (idx !== -1) {
        const [action] = actionQueue.splice(idx, 1);
        return Promise.resolve(action);
      }

      // No match — park a waiter.
      return new Promise((resolve, reject) => {
        const waiter = { types, resolve, reject, timer: null };
        waiters.push(waiter);

        if (timeoutMs !== undefined) {
          waiter.timer = setTimeout(() => {
            const i = waiters.indexOf(waiter);
            if (i !== -1) waiters.splice(i, 1);
            reject(new Error('timeout'));
          }, timeoutMs).unref();
        }
      });
    }

    function subscribe(fn) {
      subscribers.add(fn);
      return function unsubscribe() {
        subscribers.delete(fn);
      };
    }

    function replayLog(fn) {
      for (const state of stateLog) fn(state);
    }

    function close() {
      if (closed) return;
      closed = true;
      // Reject all pending waiters.
      for (const waiter of waiters.splice(0)) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(new Error('session_closed'));
      }
      subscribers.clear();
      sessions.delete(id);
    }

    const session = {
      id,
      token,
      stateLog,
      get lastActivity() { return lastActivity; },
      get closed() { return closed; },
      pushState,
      recordAction,
      nextAction,
      subscribe,
      replayLog,
      close,
    };

    sessions.set(id, session);
    return session;
  }

  function getSession(id) {
    return sessions.get(id) ?? null;
  }

  function allSessions() {
    return [...sessions.values()];
  }

  function expireIdle({ thresholdMs = 5 * 60 * 1000 } = {}) {
    const cutoff = now() - thresholdMs;
    let count = 0;
    for (const session of sessions.values()) {
      if (session.lastActivity < cutoff) {
        session.close();
        count++;
      }
    }
    return count;
  }

  return { createSession, getSession, allSessions, expireIdle };
}
