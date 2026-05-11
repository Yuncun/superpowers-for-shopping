# Plan 4 — Local Web UI Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship `server/ui.js`, a small localhost-only HTTP server that drives the user's browser through the shopping flow stages (thumbs grid → final card → cart redirect). Single-page UI; server pushes state via Server-Sent Events; client posts user actions back. No external runtime deps.

**Architecture:** Plain Node `http` server bound to `127.0.0.1`, ephemeral port assignment. Sessions are in-memory; each session has a random id + random token; URLs include both. Server-to-client updates use SSE; client-to-server actions use plain POST. The single HTML page is a state machine that renders whichever stage the server most recently pushed.

**Tech Stack:** Node 20+ ESM. Standard library only — `node:http`, `node:crypto` (for random tokens), `node:events`. No new runtime deps.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — process notes.
2. `docs/plans/2026-05-10-plan-2-shopify-handler.md` — for the data shape of `candidates` (the `{url, image, brand, title, price, variants}` objects from `search`).
3. `docs/specs/2026-05-10-superpowers-for-shopping-design.md` Section 7 (the spec for this server).

Process rules from Plans 1–3:
- DI for testability. Inject `now`, `randomBytes`, `httpServer` where it sharpens tests.
- Adversarial-input tests upfront. Bad tokens, malformed POST bodies, oversized payloads, concurrent sessions all get coverage in the same task as the feature.
- Validate at the boundary. Reject bad input at the route handler; trust internals.
- Native HTTP. Don't add `express`, `koa`, `fastify`, `ws`. The whole server is ~250 LOC.

## What's not in this plan

- No browser-opening logic. The server returns a URL string; Plan 5's slash command decides how to surface it (print to stdout, `open <url>`, etc.).
- No real candidate data. The smoke script uses hardcoded mock candidates.
- No `addToCart` integration. That's Plan 5 composing `addToCart` (Plan 2) + this server + browser session (Plan 3).
- No authentication beyond the per-session token. Server only binds `127.0.0.1`; token defeats a curious sibling process. We are not defending against root.

## File structure

| File | Responsibility | LOC |
|---|---|---|
| `server/state.js` | Pure session store: createSession, push, record action, await next action, idle expiry | ~120 |
| `server/render.js` | Pure: returns the page HTML+CSS+JS as a string for a given session id+token+baseUrl | ~250 |
| `server/ui.js` | Public API: `startServer`. HTTP routing. SSE writer. POST parser. Wires render+state. | ~200 |
| `test/server/state.test.js` | Unit tests for `state.js` | ~200 |
| `test/server/render.test.js` | Snapshot-like tests for `render.js` (substring assertions, not full HTML diff) | ~80 |
| `test/server/ui.test.js` | Integration: real server on `port: 0`, real HTTP/SSE/POST | ~280 |
| `test/live-ui.js` | Manual smoke — spin up server, push mock candidates, print URL, log actions | ~100 |

Existing files touched:
- `package.json` — add `"smoke:ui"` script and bump version at the end.

## API surface (final)

```js
// server/ui.js
export async function startServer({ port = 0, now = Date.now, randomBytes = crypto.randomBytes } = {});
// → {
//     baseUrl: 'http://127.0.0.1:<port>',
//     createSession: () => Session,
//     getSession: (id: string) => Session | null,
//     shutdown: () => Promise<void>,
//   }

// Session (returned by createSession, also retrievable via getSession):
// {
//   id: string,                                  // 16-char hex
//   token: string,                               // 32-char hex
//   url: string,                                 // baseUrl + '/r/' + id + '?token=' + token
//   pushState: (state: object) => void,          // pushes to client over SSE; queues if no client yet
//   nextAction: (opts?: { types?: string[], timeoutMs?: number }) => Promise<Action>,
//                                                // resolves with next matching action; rejects 'timeout'
//                                                // or 'session_closed'
//   close: () => void,                           // releases SSE connection, removes from store
// }

// State shapes (open-ended, but the client recognizes these `stage` values):
//   { stage: 'loading', message }
//   { stage: 'thumbs', candidates: [{image, brand, title, price, url}, ...] }
//   { stage: 'final', product: {...}, alternativesCount: number }
//   { stage: 'redirect', url }
//   { stage: 'done', message }

// Action shapes (client posts these via POST /r/<id>/action):
//   { type: 'thumb', index: number, direction: 'up' | 'down' }
//   { type: 'thumbs_complete' }
//   { type: 'final_accept' }
//   { type: 'final_cancel' }
//   { type: 'see_alternatives' }
//   { type: 'dismissed' }                        // browser tab closed (best-effort via beforeunload)
```

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/r/<id>?token=<t>` | Single-page HTML for this session |
| GET | `/r/<id>/events?token=<t>` | SSE stream: server pushes state events |
| POST | `/r/<id>/action?token=<t>` | Client submits action; body is JSON |
| GET | `/r/<id>/redirect?token=<t>&url=<encoded>` | 302 to the encoded URL (used for retailer cart handoff) |
| any | other | 404 |

Validation rules for all routes:
- Missing or mismatched token → 401.
- Unknown id → 404.
- POST body larger than 16KB → 413.
- Non-JSON POST body → 400.
- All responses include `Cache-Control: no-store`.

## Session state machine and store

A session is a plain object held in a `Map<id, Session>` inside the server.

- `pushState(state)` appends to the session's `stateLog` (so a late-connecting SSE client gets caught up by replaying the log) and writes to the active SSE response if one is connected.
- `nextAction({types, timeoutMs})` returns a promise that resolves with the next action whose `type` is in `types` (or any action if `types` omitted). Actions arrive via the POST handler, which enqueues them and resolves the oldest matching waiter. Multiple concurrent waiters share the queue.
- Idle expiry: every minute, the server scans for sessions with `lastActivity > 5min ago` and closes them. Reasonable test path: inject `now` so tests can fast-forward.

## Single-page UI behavior (client JS contract)

The page served at `/r/<id>?token=<t>` runs JS that:
1. Opens `EventSource('/r/<id>/events?token=<t>')`.
2. Replays past states from the SSE stream (server replays log on connect).
3. On each new state, calls `render(state)` which swaps the DOM.
4. On user interaction (thumb click, accept button), POSTs `{type, ...}` to `/r/<id>/action?token=<t>`.
5. On `state.stage === 'redirect'`, navigates `window.location = state.url`.
6. On `beforeunload`, fires a synchronous beacon `POST` with `{type: 'dismissed'}`.

Layout sketch (no need for pixel-perfect — the implementer is allowed to refine):
- Body has a single `<main>` element.
- `thumbs` stage: 4-column CSS grid of cards. Each card: image (square aspect), brand, title, price, thumbs-up/thumbs-down icons (Unicode 👍/👎 fine — no SVG library needed). Clicking either marks the card and grays it out. A "Show me the best one" button appears once any thumb is registered.
- `final` stage: large card centered. Image, brand, title, price, primary button "Looks good — send to cart", secondary link "see alternatives", small "cancel" link.
- `redirect` stage: tiny "Sending you to the retailer…" while JS redirects.
- All transitions are simple opacity fades (CSS, no library).

Aesthetic targets: light theme, system font stack, generous whitespace, image-forward, very few words. Inspired by Anthropic's native UI tool work.

---

## Tasks

### Task 1: `server/state.js` — pure session store

**Files:**
- Create: `server/state.js`
- Create: `test/server/state.test.js`

**Exports:**
```js
export function createStore({ now = Date.now, randomBytes = crypto.randomBytes } = {});
// → { createSession, getSession, allSessions, expireIdle }
```

A `Session` has:
- `id` (16 hex chars), `token` (32 hex chars)
- `stateLog: Array<state>` — append-only
- `lastActivity: number` — updated on every push/action/SSE connection
- `actionQueue: Array<action>` — pending actions awaiting a `nextAction` waiter
- `waiters: Array<{ types, resolve, reject, timer }>` — pending `nextAction` calls
- `subscribers: Set<(state) => void>` — SSE callbacks; called on every push
- `closed: boolean`

Methods on a session (closed-over functions, not class methods — keeps things plain):
- `pushState(state)` → appends to stateLog, updates lastActivity, calls each subscriber with the new state.
- `recordAction(action)` → updates lastActivity, then EITHER resolves the oldest matching waiter OR enqueues the action.
- `nextAction({ types, timeoutMs })` → returns Promise. If `actionQueue` has a matching entry, resolve immediately and dequeue. Otherwise push a waiter. If `timeoutMs` provided, reject after timeout. Reject with `Error('session_closed')` if `close()` is called while waiting.
- `subscribe(fn)` → adds fn to subscribers; returns unsubscribe.
- `replayLog(fn)` → calls fn with every past state, in order.
- `close()` → sets closed; rejects all waiters with `Error('session_closed')`; clears subscribers.

`expireIdle({ thresholdMs = 5 * 60 * 1000 })` → closes sessions where `now() - lastActivity > thresholdMs`. Returns count of closed sessions.

**Tests (all in one file, ~14 cases):**

1. `createSession` returns a session with 16-char hex id, 32-char hex token, both random.
2. `getSession(id)` returns the same object created.
3. `getSession('unknown')` returns null.
4. Two sequential `createSession` calls produce different ids.
5. `pushState` appends to stateLog and updates lastActivity.
6. `subscribe(fn)` then `pushState` invokes fn with the pushed state.
7. `unsubscribe()` stops invoking fn.
8. `replayLog` calls fn with every past state in order.
9. `recordAction` then `nextAction` resolves immediately with that action.
10. `nextAction` then `recordAction` resolves the waiter.
11. `nextAction({ types: ['thumb'] })` ignores a `final_accept` action (still pending).
12. `nextAction({ timeoutMs: 50 })` rejects with `timeout` after the timeout (use a fake `now` if you want determinism, or just `await new Promise(r => setTimeout(r, 100))` — tolerate ±50ms).
13. `close()` rejects all pending waiters with `session_closed`.
14. `expireIdle` closes sessions whose lastActivity is older than threshold; younger sessions survive. Inject `now` to fast-forward.

- [ ] **Step 1: Write failing tests** (use the test code shape from earlier plans: import, mockable now/randomBytes when needed)
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement `server/state.js`**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 120 (Plan 3 baseline) + 14 = 134 passing.

- [ ] **Step 6: Commit:** `"Add session store for UI server"`

---

### Task 2: `server/render.js` — pure HTML generation

**Files:**
- Create: `server/render.js`
- Create: `test/server/render.test.js`

**Exports:**
```js
export function renderPage({ id, token, baseUrl });
// → string. The full HTML document for a session page (HTML + inline CSS + inline JS).
```

The returned HTML is one self-contained document. It includes:
- A `<style>` block (~80 lines of CSS).
- A `<main id="root">` empty container.
- A `<script>` block that:
  - Reads `id`, `token`, `baseUrl` from `window.__SESSION__` (injected as a JSON-encoded object).
  - Opens an EventSource to `${baseUrl}/r/${id}/events?token=${token}`.
  - Maintains a `currentState` variable.
  - Defines `render(state)` that swaps `#root`'s contents based on `state.stage`.
  - Defines `sendAction(action)` that POSTs to `${baseUrl}/r/${id}/action?token=${token}` with `{type, ...}`.
  - Fires `sendAction({type: 'dismissed'})` on `beforeunload` (using `navigator.sendBeacon` if available, else fetch with keepalive).

**Tests (~7 substring/structural assertions):**

1. Output starts with `<!doctype html>`.
2. Output contains `window.__SESSION__ = ` followed by a JSON-encoded object with `id`, `token`, `baseUrl`.
3. The session JSON is properly escaped — special chars in id/token/baseUrl don't escape the script context. Pass an adversarial baseUrl like `</script><script>alert(1)</script>` and verify the output does NOT contain a literal `</script>` close inside the data block. (The implementer can use `JSON.stringify(...).replace(/</g, '\\u003c')` to neutralize this.)
4. The CSS contains a `.grid` or equivalent class for the thumbs layout.
5. The JS body includes a switch or branches on `state.stage` for `thumbs`, `final`, `redirect`.
6. The JS body includes an `EventSource(` call.
7. The JS body includes a `fetch(` or `navigator.sendBeacon(` POST to `/action`.

These are not pixel-snapshot tests — they pin contract, not exact layout. The implementer has latitude on visual design.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement `server/render.js`**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 134 + 7 = 141 passing.

- [ ] **Step 6: Commit:** `"Add HTML/CSS/JS render for UI session page"`

---

### Task 3: `server/ui.js` skeleton — startServer, GET /r/<id>, token gating, shutdown

**Files:**
- Create: `server/ui.js`
- Create: `test/server/ui.test.js`

The skeleton handles ONE route — `GET /r/<id>?token=<t>` — returning the rendered page. Other routes are 404. This task establishes the server lifecycle (start, shutdown) and the token-gating pattern.

Internals:
- Uses `node:http`'s `createServer`.
- Binds to `127.0.0.1` (NOT all interfaces).
- `port: 0` lets the OS pick.
- `server.address().port` after `listen` gives the actual bound port.
- Holds a `createStore`-backed store internally.
- `shutdown()` closes the HTTP server (`server.close()`) and closes all sessions. Returns a promise that resolves when the server is fully stopped (`close` callback).

**Tests (real server on port 0, ~12 cases):**

1. `startServer()` resolves with `{ baseUrl, createSession, getSession, shutdown }`.
2. `baseUrl` starts with `http://127.0.0.1:` and contains a numeric port.
3. `createSession()` returns a session with `url` matching `${baseUrl}/r/${id}?token=${token}`.
4. `GET <session.url>` returns 200 with `text/html; charset=utf-8` and body length > 1000.
5. `GET <session.url>` with WRONG token returns 401.
6. `GET /r/unknown-id?token=x` returns 404.
7. `GET /unknown/path` returns 404.
8. All responses include `Cache-Control: no-store`.
9. `shutdown()` causes subsequent `GET <session.url>` to fail with a connection error.
10. `shutdown()` is idempotent (calling twice doesn't throw).
11. Sessions created before shutdown are closed after shutdown (their `nextAction` rejects with `session_closed`).
12. Test uses Node's `fetch` (built-in) to hit the real port — no mocks here.

**Helper to add at top of test file:**
```js
import { startServer } from '../../server/ui.js';

async function withServer(fn) {
  const server = await startServer();
  try { await fn(server); } finally { await server.shutdown(); }
}
```

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement `server/ui.js`**

Internals:
- Parse incoming request URL with `new URL(req.url, baseUrl)`.
- Match path against `^/r/([0-9a-f]+)(/.+)?$` (id capture).
- Validate token (query param) against session token via constant-time comparison if you want, or plain `===` (this isn't a high-stakes secret).
- Route to handler or 404.

- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 141 + 12 = 153 passing.

- [ ] **Step 6: Commit:** `"Add UI HTTP server skeleton with token-gated GET /r/<id>"`

---

### Task 4: SSE endpoint `GET /r/<id>/events` + log replay

**Files:**
- Modify: `server/ui.js`
- Modify: `test/server/ui.test.js`

**Behavior:**
- Same token-gating as page route.
- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-store`, `Connection: keep-alive`.
- On connect, replay every past state via `session.replayLog`, writing each as an SSE event.
- Then subscribe to future pushes; for each, write an SSE event.
- SSE event format: `event: state\ndata: ${JSON.stringify(state)}\n\n`.
- On client disconnect (`req.on('close')`), unsubscribe.
- On `session.close()`, write `event: closed\ndata: {}\n\n` and `res.end()`.

**Tests (~8 cases, using real server + Node's `fetch` for SSE):**

1. SSE response has `Content-Type: text/event-stream`.
2. Wrong token → 401.
3. Unknown session id → 404.
4. After `pushState({stage: 'loading', message: 'x'})`, an SSE client receives an event whose data parses to that state.
5. A client connecting AFTER two pushes receives both events on initial connection (log replay).
6. Multiple concurrent clients on the same session both receive subsequent pushes.
7. Closing the session writes `event: closed` then ends the response.
8. Aborting the client request triggers unsubscribe (verify by pushing afterwards and confirming no leak — could be a soft test: after abort + push, the session's subscribers count is 0).

**SSE consumption in tests:** Use `fetch` with `signal` for cancellation, read the body as a stream, split on `\n\n` for events.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement the route**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 153 + 8 = 161 passing.

- [ ] **Step 6: Commit:** `"Add SSE event stream with log replay"`

---

### Task 5: POST `/r/<id>/action` + redirect helper + page-side JS sanity

**Files:**
- Modify: `server/ui.js`
- Modify: `test/server/ui.test.js`

Two endpoints in one task because they're both short and orthogonal.

**POST `/r/<id>/action?token=<t>`:**
- Token-gate, 401/404 as before.
- Read full body up to 16KB. Reject larger with 413.
- Parse JSON. Reject malformed with 400.
- Require `body.type` to be a non-empty string. Reject otherwise with 400.
- Call `session.recordAction(body)`.
- Respond `204 No Content`.

**GET `/r/<id>/redirect?token=<t>&url=<encoded>`:**
- Token-gate.
- `url` query param must be present and start with `http://` or `https://`. Otherwise 400.
- Respond `302` with `Location: <url>`.
- This is a thin helper so the client doesn't have to set `window.location` directly (some browsers block JS-set navigations in certain contexts). Plan 5 will use this.

**Tests (~10 cases):**

1. POST with valid body → 204.
2. POST with valid body → next `nextAction()` resolves with the body.
3. POST with wrong token → 401.
4. POST to unknown id → 404.
5. POST with body > 16KB → 413.
6. POST with non-JSON body → 400.
7. POST with missing `type` → 400.
8. POST with `type` not a string → 400.
9. GET redirect with `https://...` → 302 with Location.
10. GET redirect with `javascript:alert(1)` → 400 (XSS guard).

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement both endpoints**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 161 + 10 = 171 passing.

- [ ] **Step 6: Commit:** `"Add POST /action and GET /redirect endpoints"`

---

### Task 6: Idle timeout + cleanup loop

**Files:**
- Modify: `server/ui.js`
- Modify: `test/server/ui.test.js`

**Behavior:**
- On `startServer`, set a recurring timer (every 60 seconds) that calls `store.expireIdle()`.
- On `shutdown`, clear the timer.
- The timer must use `unref()` so it doesn't keep Node alive (important for tests).
- Accept `{ idleThresholdMs }` option to override (default `5 * 60 * 1000`).

**Tests (~3 cases):**

1. With `idleThresholdMs: 50` and an injected `now` (or just sleep), a session created and untouched closes within ~150ms.
2. A session with recent activity does NOT close.
3. After `shutdown()`, the timer no longer fires (no error if 200ms passes with the server stopped).

Pragmatic note: the tests can use a tiny `idleThresholdMs` AND a tiny internal sweep interval. Allow the implementer to expose `{ idleSweepMs }` as an option (default 60_000) so tests don't take minutes.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 171 + 3 = 174 passing.

- [ ] **Step 6: Commit:** `"Add idle-session cleanup loop"`

---

### Task 7: Live smoke `test/live-ui.js` + `npm run smoke:ui`

**Files:**
- Create: `test/live-ui.js`
- Modify: `package.json`

**Script behavior:**
- Start the server.
- Create a session.
- Print the URL to stdout (clearly).
- Push `{ stage: 'loading', message: 'demo: pretending to search...' }` immediately.
- After 1 second, push `{ stage: 'thumbs', candidates: <8 hardcoded products> }`.
- `await session.nextAction({ types: ['thumbs_complete'] })` (no timeout).
- Push `{ stage: 'final', product: candidates[0], alternativesCount: 7 }`.
- `await session.nextAction({ types: ['final_accept', 'final_cancel'] })`.
- Push `{ stage: 'redirect', url: 'https://marinelayer.com/cart' }`.
- Wait 2 seconds (so the browser can navigate), then `shutdown()`.

The 8 hardcoded products use real Marine Layer image URLs (you can use the live smoke output from Plan 2's `smoke:live` as a source — or just place placeholder image URLs that resolve, like `https://placehold.co/600x600/png?text=Product+1`).

Add `"smoke:ui": "node test/live-ui.js"` to `package.json`.

- [ ] **Step 1: Write the script**
- [ ] **Step 2: Add npm script**
- [ ] **Step 3: Run it and confirm the URL prints**

Don't manually walk through the flow in this step — the human reviewer does that. Just `node --check` the file and run it long enough to confirm the URL prints, then ^C.

- [ ] **Step 4: Confirm full suite still passes**

Expected: 174 passing.

- [ ] **Step 5: Commit:** `"Add live UI smoke script"`

---

### Task 8: Ship v0.4.0

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README status line**

`**Status:** v0.4.0 — profile, Shopify handler, browser-session library, and local UI server. Slash command (Plan 5) is the next milestone.`

- [ ] **Step 2: Bump version in package.json and plugin.json to 0.4.0**

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.4.0 — 2026-05-10

Adds the local web UI server. Pure-Node HTTP + Server-Sent Events, no
external runtime deps. Drives the user's browser through loading → thumbs
grid → final card → cart redirect stages.

- New `server/state.js`: session store with action queue and idle expiry.
- New `server/render.js`: self-contained HTML/CSS/JS for the session page.
- New `server/ui.js`: HTTP server, SSE stream, POST action endpoint, redirect
  helper. Bound to `127.0.0.1` only; per-session random token gates all routes.
- New `npm run smoke:ui` — spins up a real server with mock candidates for
  manual UX review.

Not yet wired up: the `/cart` slash command (Plan 5) is what composes this with
Plan 2's search/addToCart and Plan 3's browser cookie flow.
```

- [ ] **Step 4: Run full suite**

Expected: 174 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.4.0 — local UI server"
git push origin main
```

---

## Self-review checklist

- [ ] All 8 tasks committed.
- [ ] `npm test` shows 174 passing.
- [ ] `npm run smoke:ui` was run by a human and the UI looked acceptable in a browser. Thumbs grid interactions, final card transition, and redirect all worked.
- [ ] Server binds `127.0.0.1` only — not `0.0.0.0`.
- [ ] No new runtime deps (`package.json` `dependencies` still just `js-yaml`).
- [ ] Per-session token included in every URL, validated on every route.
- [ ] No persistent state — server is memory-only; shutdown wipes everything.

## Final review

Dispatch a code-quality reviewer over `server/state.js`, `server/render.js`, `server/ui.js`. Specifically check:
- The SSE replay-then-subscribe sequence is race-free (a state pushed between replay and subscribe must not be lost or duplicated).
- Token comparison doesn't leak via timing (or document why we don't care).
- Body size limit (16KB) is actually enforced — not just checked after reading the whole body.
- `beforeunload` beacon failure doesn't break the server (best-effort on the client; server must tolerate missing dismissals).
- Render HTML is XSS-safe for adversarial baseUrl/id/token (the script-context-escape check in Task 2 is the canary).
