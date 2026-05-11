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
});
