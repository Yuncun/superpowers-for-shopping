// server/ui.js
// Public API: startServer. HTTP routing. Token-gated GET /r/<id>.
// Wires render + state. Bound to 127.0.0.1 only; ephemeral port.

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { createStore } from './state.js';
import { renderPage } from './render.js';

/**
 * Start the local UI server.
 *
 * @param {object} [opts]
 * @param {number}   [opts.port=0]                 - 0 lets the OS pick.
 * @param {function} [opts.now=Date.now]            - injectable for tests.
 * @param {function} [opts.randomBytes]             - injectable for tests.
 * @returns {Promise<{baseUrl, createSession, getSession, shutdown}>}
 */
export async function startServer({
  port = 0,
  now = Date.now,
  randomBytes = crypto.randomBytes,
} = {}) {
  const store = createStore({ now, randomBytes });

  // Regex for the page route: /r/<hex-id>
  const PAGE_RE = /^\/r\/([0-9a-f]+)$/;

  let shuttingDown = false;

  const server = http.createServer((req, res) => {
    // All responses must never cache.
    res.setHeader('Cache-Control', 'no-store');

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, baseUrl);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }

    const pathname = parsedUrl.pathname;
    const pageMatch = PAGE_RE.exec(pathname);

    if (!pageMatch) {
      res.writeHead(404).end('Not Found');
      return;
    }

    const id = pageMatch[1];
    const token = parsedUrl.searchParams.get('token');

    // Look up session — unknown id → 404 (don't reveal existence).
    const session = store.getSession(id);
    if (!session) {
      res.writeHead(404).end('Not Found');
      return;
    }

    // Token validation — wrong token → 401.
    if (token !== session.token) {
      res.writeHead(401).end('Unauthorized');
      return;
    }

    // GET /r/<id>?token=<t> — serve the page.
    if (req.method === 'GET') {
      const body = renderPage({ id, token, baseUrl });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    res.writeHead(405).end('Method Not Allowed');
  });

  // Bind to loopback only — never 0.0.0.0.
  const actualPort = await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(server.address().port);
    });
    server.once('error', reject);
  });

  const baseUrl = `http://127.0.0.1:${actualPort}`;

  function createSession() {
    const session = store.createSession();
    return {
      ...session,
      url: `${baseUrl}/r/${session.id}?token=${session.token}`,
    };
  }

  function getSession(id) {
    return store.getSession(id);
  }

  function shutdown() {
    if (shuttingDown) return Promise.resolve();
    shuttingDown = true;

    // Close all sessions first so nextAction waiters reject with session_closed.
    for (const session of store.allSessions()) {
      session.close();
    }

    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { baseUrl, createSession, getSession, shutdown };
}
