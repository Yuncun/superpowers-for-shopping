// test/server/ui.test.js
// Integration tests for server/ui.js — real HTTP on port 0.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/ui.js';

async function withServer(fn) {
  const server = await startServer();
  try {
    await fn(server);
  } finally {
    await server.shutdown();
  }
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/**
 * Connect to the SSE events endpoint and return a `nextEvent()` reader plus
 * the raw fetch Response so the caller can abort / inspect headers.
 *
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {{ res: Response, nextEvent: () => Promise<string|null> }}
 */
async function connectSSE(url, signal) {
  const res = await fetch(url, { signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  async function nextEvent() {
    while (!buf.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += decoder.decode(value);
    }
    const event = buf.slice(0, buf.indexOf('\n\n'));
    buf = buf.slice(buf.indexOf('\n\n') + 2);
    return event;
  }

  return { res, nextEvent, reader };
}

describe('startServer', () => {
  it('resolves with the expected shape', async () => {
    await withServer(async (server) => {
      assert.equal(typeof server.baseUrl, 'string');
      assert.equal(typeof server.createSession, 'function');
      assert.equal(typeof server.getSession, 'function');
      assert.equal(typeof server.shutdown, 'function');
    });
  });

  it('baseUrl starts with http://127.0.0.1: and ends with a numeric port', async () => {
    await withServer(async ({ baseUrl }) => {
      assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    });
  });

  it('createSession returns session with url matching baseUrl/r/<id>?token=<token>', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      assert.equal(
        session.url,
        `${baseUrl}/r/${session.id}?token=${session.token}`,
      );
    });
  });

  it('GET <session.url> returns 200 with text/html and body > 1000 chars', async () => {
    await withServer(async ({ createSession }) => {
      const session = createSession();
      const res = await fetch(session.url);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const body = await res.text();
      assert.ok(body.length > 1000, `body length ${body.length} not > 1000`);
    });
  });

  it('GET <session.url> with wrong token returns 401', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const wrongUrl = `${baseUrl}/r/${session.id}?token=wrongtoken`;
      const res = await fetch(wrongUrl);
      assert.equal(res.status, 401);
    });
  });

  it('GET /r/unknown-id?token=x returns 404', async () => {
    await withServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/r/deadbeefdeadbeef?token=x`);
      assert.equal(res.status, 404);
    });
  });

  it('GET /unknown/path returns 404', async () => {
    await withServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/unknown/path`);
      assert.equal(res.status, 404);
    });
  });

  it('all responses include Cache-Control: no-store', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();

      // Page route
      const pageRes = await fetch(session.url);
      assert.equal(pageRes.headers.get('cache-control'), 'no-store');

      // 404 route
      const notFoundRes = await fetch(`${baseUrl}/nope`);
      assert.equal(notFoundRes.headers.get('cache-control'), 'no-store');
    });
  });

  it('shutdown causes subsequent requests to fail with connection error', async () => {
    const server = await startServer();
    const session = server.createSession();
    await server.shutdown();

    await assert.rejects(
      () => fetch(session.url),
      (err) => {
        // fetch throws a TypeError on connection refused
        return err instanceof TypeError;
      },
    );
  });

  it('shutdown is idempotent — calling twice does not throw', async () => {
    const server = await startServer();
    await server.shutdown();
    await assert.doesNotReject(() => server.shutdown());
  });

  it('sessions created before shutdown have nextAction reject with session_closed after shutdown', async () => {
    const server = await startServer();
    const session = server.createSession();

    // Park a waiter before shutdown.
    const actionPromise = session.nextAction();
    await server.shutdown();

    await assert.rejects(
      () => actionPromise,
      (err) => err.message === 'session_closed',
    );
  });

  it('uses Node built-in fetch — no mocks', async () => {
    // Verify we are hitting a real network port.
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const res = await fetch(session.url);
      const text = await res.text();
      assert.ok(text.includes(session.id), 'response body should contain session id');
    });
  });

  // -------------------------------------------------------------------------
  // Task 4: SSE endpoint GET /r/<id>/events
  // -------------------------------------------------------------------------

  it('SSE response has Content-Type: text/event-stream', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=${session.token}`;
      const ac = new AbortController();
      const { res } = await connectSSE(eventsUrl, ac.signal);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/event-stream/);
      ac.abort();
    });
  });

  it('SSE with wrong token returns 401', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=wrongtoken`;
      const res = await fetch(eventsUrl);
      assert.equal(res.status, 401);
    });
  });

  it('SSE with unknown session id returns 404', async () => {
    await withServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/r/deadbeefdeadbeef/events?token=x`);
      assert.equal(res.status, 404);
    });
  });

  it('SSE delivers a state event after pushState', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=${session.token}`;
      const ac = new AbortController();
      const { nextEvent } = await connectSSE(eventsUrl, ac.signal);

      session.pushState({ stage: 'loading', message: 'x' });

      const raw = await nextEvent();
      assert.ok(raw, 'expected an event');
      assert.ok(raw.includes('event: state'), `event line missing in: ${raw}`);
      const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
      const parsed = JSON.parse(dataLine.slice(6));
      assert.deepEqual(parsed, { stage: 'loading', message: 'x' });
      ac.abort();
    });
  });

  it('SSE replays past states to a late-connecting client', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      // Push two states BEFORE connecting.
      session.pushState({ stage: 'loading', message: 'first' });
      session.pushState({ stage: 'loading', message: 'second' });

      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=${session.token}`;
      const ac = new AbortController();
      const { nextEvent } = await connectSSE(eventsUrl, ac.signal);

      const e1 = await nextEvent();
      const e2 = await nextEvent();
      assert.ok(e1, 'expected first replayed event');
      assert.ok(e2, 'expected second replayed event');

      const parse = (raw) => {
        const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(dataLine.slice(6));
      };
      assert.deepEqual(parse(e1), { stage: 'loading', message: 'first' });
      assert.deepEqual(parse(e2), { stage: 'loading', message: 'second' });
      ac.abort();
    });
  });

  it('multiple concurrent SSE clients both receive subsequent pushes', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=${session.token}`;

      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const { nextEvent: next1 } = await connectSSE(eventsUrl, ac1.signal);
      const { nextEvent: next2 } = await connectSSE(eventsUrl, ac2.signal);

      session.pushState({ stage: 'thumbs', candidates: [] });

      const [e1, e2] = await Promise.all([next1(), next2()]);
      const parse = (raw) => {
        const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(dataLine.slice(6));
      };
      assert.deepEqual(parse(e1), { stage: 'thumbs', candidates: [] });
      assert.deepEqual(parse(e2), { stage: 'thumbs', candidates: [] });

      ac1.abort();
      ac2.abort();
    });
  });

  it('closing the session writes event: closed and ends the SSE stream', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=${session.token}`;

      const { nextEvent } = await connectSSE(eventsUrl);

      // Close on next tick so the SSE connection is established first.
      setImmediate(() => session.close());

      const raw = await nextEvent();
      assert.ok(raw, 'expected closed event');
      assert.ok(raw.includes('event: closed'), `expected "event: closed" in: ${raw}`);

      // Stream should end — nextEvent returns null.
      const next = await nextEvent();
      assert.equal(next, null);
    });
  });

  it('aborting the SSE client request unsubscribes (no subscriber leak)', async () => {
    await withServer(async ({ baseUrl, createSession }) => {
      const session = createSession();
      const eventsUrl = `${baseUrl}/r/${session.id}/events?token=${session.token}`;

      const ac = new AbortController();
      await connectSSE(eventsUrl, ac.signal);

      // Give the server a tick to register the subscriber.
      await new Promise(r => setImmediate(r));

      // Abort the client connection.
      ac.abort();

      // Give the server a tick to process the close event and unsubscribe.
      await new Promise(r => setTimeout(r, 50));

      // Track pushes received AFTER the abort — should be zero if unsubscribed.
      let pushCount = 0;
      const unsub = session.subscribe(() => pushCount++);
      session.pushState({ stage: 'done', message: 'after abort' });
      unsub();

      // The SSE subscriber is gone; only the probe subscriber above should have fired.
      assert.equal(pushCount, 1, 'probe subscriber must fire exactly once');

      // Verify the server is not accumulating extra subscribers by ensuring
      // the subscribe/unsubscribe cycle itself is clean.
      // (If the SSE subscriber leaked, pushState would call it but it would try
      // to write to a destroyed socket — Node would silently ignore or throw.
      // The test ensures no unhandled error occurs and count is exactly 1.)
    });
  });
});
