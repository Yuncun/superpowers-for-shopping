// server/ui.js
// Public API: startServer. HTTP routing. Token-gated GET /r/<id>.
// Wires render + state. Bound to 127.0.0.1 only; ephemeral port.

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { createStore } from './state.js';
import { renderPage as defaultRenderPage } from './render.js';

// Maximum POST body size (bytes).
const MAX_BODY = 16384;

/**
 * Write one SSE event to the response.
 * Format: "event: <name>\ndata: <JSON>\n\n"
 *
 * @param {http.ServerResponse} res
 * @param {string} eventName
 * @param {unknown} data
 */
function writeEvent(res, eventName, data) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Start the local UI server.
 *
 * @param {object} [opts]
 * @param {number}   [opts.port=0]                       - 0 lets the OS pick.
 * @param {function} [opts.now=Date.now]                  - injectable for tests.
 * @param {function} [opts.randomBytes]                   - injectable for tests.
 * @param {number}   [opts.idleThresholdMs=5*60*1000]    - sessions idle longer than this are closed.
 * @param {number}   [opts.idleSweepMs=60*1000]          - how often the sweep runs.
 * @param {function} [opts.render]                       - per-session page renderer; defaults to the /cart-flow page.
 * @returns {Promise<{baseUrl, createSession, getSession, shutdown}>}
 */
export async function startServer({
  port = 0,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  idleThresholdMs = 5 * 60 * 1000,
  idleSweepMs = 60 * 1000,
  render = defaultRenderPage,
} = {}) {
  const store = createStore({ now, randomBytes });

  // Regex: /r/<hex-id>  optionally followed by a sub-path.
  // Groups: [1] = id, [2] = sub-path (e.g. "/events", "/action", "/redirect") or undefined.
  const ROUTE_RE = /^\/r\/([0-9a-f]+)(\/[a-z]+)?$/;

  // Idle-session cleanup loop. .unref() ensures the timer doesn't prevent Node
  // from exiting naturally when the process is otherwise done.
  const idleTimer = setInterval(
    () => store.expireIdle({ thresholdMs: idleThresholdMs }),
    idleSweepMs,
  ).unref();

  let shuttingDown = false;
  // baseUrl is set after the server binds; referenced inside the request handler via closure.
  let baseUrl;

  /**
   * Look up session and validate token. Returns the session or writes the
   * appropriate error response and returns null.
   *
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} id
   * @param {string|null} token
   * @returns {object|null} session
   */
  function resolveSession(res, id, token) {
    const session = store.getSession(id);
    if (!session) {
      res.writeHead(404).end('Not Found');
      return null;
    }
    if (token !== session.token) {
      res.writeHead(401).end('Unauthorized');
      return null;
    }
    return session;
  }

  // ---------------------------------------------------------------------------
  // Route handlers
  // ---------------------------------------------------------------------------

  /** GET /r/<id>/events?token=<t> — SSE stream */
  function handleEvents(req, res, session) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    // Flush headers immediately so the client receives the 200 + Content-Type
    // before any events are written. Without this, Node buffers until the first write.
    res.flushHeaders();

    // Race-free replay-then-subscribe:
    //   1. Snapshot the existing log synchronously.
    //   2. Subscribe to future pushes.
    //   3. Replay the snapshot.
    // Because JS is single-threaded and there are no awaits between steps 1–3,
    // no state push can slip between snapshot and subscribe. Any push that
    // arrives after subscribe() is queued through the subscriber normally.
    const snapshot = session.stateLog.slice();

    const unsubscribe = session.subscribe((state) => {
      if (!res.writableEnded) writeEvent(res, 'state', state);
    });

    // Replay past states.
    for (const state of snapshot) {
      if (!res.writableEnded) writeEvent(res, 'state', state);
    }

    // Handle session close: wrap the session's close method to notify this SSE
    // connection before the subscribers set is cleared.
    const origClose = session.close.bind(session);
    session.close = function wrappedClose() {
      if (!res.writableEnded) {
        writeEvent(res, 'closed', {});
        res.end();
      }
      origClose();
      // Restore so subsequent calls (e.g. shutdown iterating allSessions) work normally.
      session.close = origClose;
    };

    // On client disconnect, unsubscribe and restore the close wrapper if needed.
    req.on('close', () => {
      unsubscribe();
      // If the session's close was still our wrapper, restore the original so
      // shutdown can still close the session cleanly.
      if (session.close.name === 'wrappedClose') {
        session.close = origClose;
      }
    });
  }

  /** POST /r/<id>/action?token=<t> — record a user action */
  function handleAction(req, res, session) {
    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_BODY) {
        aborted = true;
        res.writeHead(413).end('Payload Too Large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;

      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end('Bad Request');
        return;
      }

      if (!body || typeof body.type !== 'string' || body.type.length === 0) {
        res.writeHead(400).end('Bad Request');
        return;
      }

      session.recordAction(body);
      res.writeHead(204).end();
    });

    req.on('error', () => {
      // Connection torn down (e.g. after req.destroy() on 413).
    });
  }

  /** GET /r/<id>/redirect?token=<t>&url=<encoded> — 302 to decoded url */
  function handleRedirect(req, res, parsedUrl) {
    const url = parsedUrl.searchParams.get('url') ?? '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad url');
      return;
    }
    res.writeHead(302, { 'Location': url }).end();
  }

  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------

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
    const routeMatch = ROUTE_RE.exec(pathname);

    if (!routeMatch) {
      res.writeHead(404).end('Not Found');
      return;
    }

    const id = routeMatch[1];
    const subPath = routeMatch[2] ?? '';
    const token = parsedUrl.searchParams.get('token');

    if (subPath === '' || subPath === '/') {
      // GET /r/<id>?token=<t> — serve the page.
      if (req.method !== 'GET') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      const session = resolveSession(res, id, token);
      if (!session) return;

      const body = render({ id, token, baseUrl });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    if (subPath === '/events') {
      if (req.method !== 'GET') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      const session = resolveSession(res, id, token);
      if (!session) return;
      handleEvents(req, res, session);
      return;
    }

    if (subPath === '/action') {
      if (req.method !== 'POST') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      const session = resolveSession(res, id, token);
      if (!session) return;
      handleAction(req, res, session);
      return;
    }

    if (subPath === '/redirect') {
      if (req.method !== 'GET') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      const session = resolveSession(res, id, token);
      if (!session) return;
      handleRedirect(req, res, parsedUrl);
      return;
    }

    res.writeHead(404).end('Not Found');
  });

  // Bind to loopback only — never 0.0.0.0.
  const actualPort = await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(server.address().port);
    });
    server.once('error', reject);
  });

  baseUrl = `http://127.0.0.1:${actualPort}`;

  function createSession() {
    const session = store.createSession();
    // Add url directly to the session object (not a spread copy) so the test
    // and the SSE handler share the same object reference. The SSE handler wraps
    // session.close() in place; if we returned a spread, the test's session.close
    // would bypass the wrapper.
    session.url = `${baseUrl}/r/${session.id}?token=${session.token}`;
    return session;
  }

  function getSession(id) {
    return store.getSession(id);
  }

  function shutdown() {
    if (shuttingDown) return Promise.resolve();
    shuttingDown = true;

    // Stop the idle-sweep timer so it can't fire against a closed store.
    clearInterval(idleTimer);

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
