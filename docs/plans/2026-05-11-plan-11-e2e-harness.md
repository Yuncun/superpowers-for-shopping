# Plan 11 — Programmatic E2E Test Harness for `/cart`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make the `/cart` flow testable without a human-in-the-loop. Build a protocol-level harness that spawns the cart-flow subprocess, drives it via SSE + POST actions, asserts the final outcome, and opens any resulting real cart URL in the user's browser for verification. Execute 2-3 dry runs against Marine Layer (the retailer with active session cookies) and prove a sweater lands in a real Marine Layer cart.

**Architecture:** No browser automation. The cart-flow's UI server already exposes the only API surface we need: an SSE stream (`GET /r/<id>/events?token=<t>`) for state and a POST endpoint (`POST /r/<id>/action?token=<t>`) for actions. A harness in Node can subscribe to SSE, drive the state machine programmatically, and assert outcomes — significantly more reliable than browser drivers for headless verification. Side benefit: the harness exercises the exact same server-side code path a real browser does, so we're not testing a different abstraction.

**Tech Stack:** Node 20+ ESM, native `EventSource` (Node 22+) or polyfill via raw `fetch` streaming. No new runtime deps for the plugin itself; harness can use `undici` for `EventSource` if needed (already a Node built-in via `node:undici`).

---

## Context for the implementer

Read first:
1. `bin/cart-flow.js` — process entry. Already wires real deps; needs minor surgery to log the session URL and accept `--no-open`.
2. `server/ui.js` — confirms the `/events` SSE format (`event: state\ndata: <json>\n\n`) and `/action` POST contract.
3. `server/render.js` lines 281-313 — shows the client-side contract: `EventSource` to `/r/<id>/events?token=<t>`, POST `{type, ...}` to `/r/<id>/action?token=<t>`. The harness implements the same client.
4. `lib/flow.js` — state transitions: `loading` → `thumbs` → (`final` | `login_required`) → `redirect` | `done`. Actions: `thumb {direction, index}`, `thumbs_complete`, `final_accept`, `final_cancel`, `login_complete`, `dismissed`.
5. `test/live-flow.js` — existing smoke script. Mocks `addToCart` but exercises real wiring. Pattern to imitate.

Process rules:
- DI for testability in any reusable harness module.
- The harness IS a test — has its own assertions; the unit suite is unaffected.
- Real subprocess spawns. No mocks at the orchestrator level — the whole point is verifying the real binary works end-to-end.
- `addToCart` can be either real or mocked, controlled by env var. Real for live dry runs; mocked for repeatable CI.

## What's NOT in this plan

- No Amazon support. Plan 12 if needed.
- No browser automation. Protocol-level only. (A browser-based smoke layer could land later if we ever ship a UI redesign; not now.)
- No retailer expansion. All three dry runs against Marine Layer because it's the retailer with active cookies. Different queries vary the input space (`sweater`, `t-shirt`, `jacket`).
- No CI integration. The harness is runnable locally; making it CI-friendly is a v0.11.1+ concern.
- No fix to the "agent-browser can't see SSE state" issue — that's an artifact of agent-browser, not our code. We sidestep it by not using agent-browser.

## Auth requirement upfront

Real-cart verification requires a valid Marine Layer cookie. Eric ran `npm run smoke:browser` recently against marinelayer.com; the cookie is in `~/.claude/cart/browser-profile/`. If that session is stale (>30 days, or Marine Layer rotated tokens), the flow will hit `auth_required` and the dry run logs that outcome instead of `success`. The harness MUST handle this gracefully — log clearly that auth is the blocker, suggest re-running `smoke:browser`, then exit cleanly rather than hanging.

## Dry-run success criteria

A "successful dry run" produces:
1. Outcome `success` on stdout.
2. A real cart URL of the form `https://marinelayer.com/cart`.
3. The harness opens that URL in the user's default browser via `open`.
4. The user (or controller) can visit the URL and verify the sweater is in cart.

Failure modes that count as "harness worked but flow couldn't complete" (acceptable; report and stop):
- `auth_required` — cookie expired. Recoverable by re-login.
- `no_results` — none of the retailers returned matching products. Try a different query.

Failure modes that count as "harness broken" (NOT acceptable; surface immediately):
- Harness hangs >60s on any state.
- SSE never connects.
- Action POST returns non-2xx.
- Subprocess exits with code != 0 before producing an outcome.

## File structure

| File | Change | LOC |
|---|---|---|
| `bin/cart-flow.js` | Log session URL; add `--no-open` flag | +~10 |
| `test/e2e-cart-flow.js` | New live harness | ~250 |
| `test/lib/cart-harness.js` | Reusable harness module (spawn + drive) | ~180 |
| `test/lib/cart-harness.test.js` | Unit tests for harness module (DI'd, no subprocess) | ~150 |
| `package.json` | `scripts.e2e:cart` | +1 line |

---

## Tasks

### Task 1: Cart-flow CLI: log session URL + `--no-open` flag

**Files:**
- Modify: `bin/cart-flow.js`

**Changes:**

1. Parse `--no-open` from process.argv. If present, the `openUrl` dep becomes a no-op (just logs `Open this URL: <url>` to stdout instead of invoking macOS `open`).
2. Add explicit URL logging: BEFORE the openUrl call inside the deps chain, write the session URL to stdout in a parseable line. Format must be machine-readable for the harness:
   ```
   __CART_FLOW_URL__ http://127.0.0.1:55916/r/<id>?token=<t>
   ```
   The `__CART_FLOW_URL__` prefix is the sentinel the harness greps for. Use the existing `log` helper writes to stderr — this NEW line goes to stdout via `process.stdout.write`, so it's separated from log noise.

   Implementation hint: wrap the existing `openUrl` dep:
   ```js
   const wrappedOpenUrl = (url) => {
     process.stdout.write(`__CART_FLOW_URL__ ${url}\n`);
     if (noOpen) return Promise.resolve();
     return openUrl(url);
   };
   // pass wrappedOpenUrl in deps
   ```

3. Final outcome line stays on stdout as currently (whatever `cart-flow` already does — verify by reading current code).

**Tests:** None for this file directly (it's CLI plumbing); the harness in Task 3 exercises this. Existing tests must still pass.

- [ ] **Step 1: Read current `bin/cart-flow.js` to confirm what's there.**
- [ ] **Step 2: Implement the two changes.**
- [ ] **Step 3: Run full suite — confirm 272 passing.**
- [ ] **Step 4: Manual sanity check: `node bin/cart-flow.js --no-open "test"` should print `__CART_FLOW_URL__ ...` to stdout immediately after server start. Kill with Ctrl-C (idle cleanup will eventually close it anyway).**
- [ ] **Step 5: Commit:** `Log session URL and add --no-open flag to cart-flow CLI`

---

### Task 2: Reusable harness module — `test/lib/cart-harness.js`

**Files:**
- Create: `test/lib/cart-harness.js`
- Create: `test/lib/cart-harness.test.js`

**Public surface:**

```js
// driveFlow({ subprocess, baseUrl, sessionId, token, choose, onState, deps })
// Reads SSE events. For each state push, calls `choose(state)` which returns
// an action (or null to wait). POSTs the returned action to the server.
// Resolves with the final outcome string when the subprocess exits.
//
// Pure logic — every external dep (fetch, EventSource, spawn) injected.
//
// choose(state) → { type, ... } | null | 'wait'
//   - return an action object → harness POSTs it immediately
//   - return null → harness waits for the next state (no-op)
//   - return 'wait' → same as null but explicit; used after thumbs_complete
//                     when waiting for the final stage.
//
// onState(state) → optional callback for logging/recording every state.
//
// Returns: Promise<{ outcome, finalState, allStates, exitCode, stdout, stderr }>
export async function driveFlow(opts);

// spawnCartFlow({ query, env, args = [], spawnImpl = childProcess.spawn })
// Spawns `node bin/cart-flow.js [args] "<query>"`, captures stdout/stderr, parses
// the __CART_FLOW_URL__ sentinel, returns:
//   { proc, baseUrl, sessionId, token, stdoutChunks, stderrChunks, exitCode }
// `baseUrl/sessionId/token` available as Promises that resolve when the
// sentinel line appears on stdout. Rejected if the subprocess exits before
// emitting the sentinel.
export async function spawnCartFlow(opts);

// Convenience choosers for common scenarios:
export function thumbAllUpThenComplete();   // chooses thumb up for indices 0..7
export function thumbFirstThenComplete();   // up on 0 only
export function acceptFirstFinal();         // accepts final_accept
export function dismissImmediately();
```

**Test cases for `cart-harness.test.js`** (~10 cases, all using mock fetch/EventSource/spawn):

1. `spawnCartFlow` resolves baseUrl/sessionId/token when sentinel appears on stdout.
2. `spawnCartFlow` rejects if subprocess exits before sentinel.
3. `driveFlow` with a chooser that returns `thumbs_complete` on `thumbs` state posts the action and waits for next state.
4. `driveFlow` posts actions only when chooser returns non-null/non-'wait'.
5. `driveFlow` resolves with `{outcome: 'success', cartUrl}` when subprocess prints the final outcome and exits 0.
6. `driveFlow` rejects on POST 4xx/5xx response.
7. `driveFlow` rejects on SSE connection error.
8. `thumbAllUpThenComplete` produces correct sequence of actions for an 8-candidate thumbs state.
9. `acceptFirstFinal` produces `final_accept` on `final` state, ignores other states.
10. State-tracking: `allStates` in the resolved result contains every state in order.

**Implementation hints:**
- For SSE, use `node:undici` `EventSource` (Node 22+) OR write a minimal reader that does `fetch(url, { headers: { Accept: 'text/event-stream' } })` and parses `event:`/`data:` lines from the streaming response. The minimal reader is ~30 LOC and avoids a Node-version dependency.
- The subprocess interleaves stdout (URL sentinel + final outcome) and stderr (log noise). Don't mix them; parse stdout-only for harness signals.
- For graceful shutdown, the harness should `proc.kill()` if its own internal state-machine decides to bail. Be sure no orphaned subprocesses.

- [ ] **Step 1: Write all 10 failing tests for `cart-harness.test.js`.**
- [ ] **Step 2: Run — verify they fail.**
- [ ] **Step 3: Implement `cart-harness.js`.**
- [ ] **Step 4: Run — verify pass. Full suite: 272 + 10 = 282 passing.**
- [ ] **Step 5: Commit:** `Add reusable cart-flow E2E harness module`

---

### Task 3: Live harness — `test/e2e-cart-flow.js`

**Files:**
- Create: `test/e2e-cart-flow.js`
- Modify: `package.json` (add `e2e:cart` script)

**Behavior:** This is a runnable script (`npm run e2e:cart`), not a `node --test` test. It uses `cart-harness.js` (real deps, no mocks) to drive an actual cart-flow subprocess against real retailers.

**Usage:**

```bash
# Default: 3 runs, queries from a built-in list, against the user's retailers.md
npm run e2e:cart

# Single run with custom query
npm run e2e:cart -- "wool sweater"

# Override retailers (debugging)
RETAILERS=marinelayer.com npm run e2e:cart

# Mock add-to-cart (repeatable testing, doesn't add to real cart)
MOCK_ADD_TO_CART=1 npm run e2e:cart
```

**Default behavior** (3 runs):

Queries: `'wool sweater'`, `'cotton sweater'`, `'cardigan'`. Run each one through the full flow. Between runs, sleep 2s.

**For each run:**

1. Spawn `node bin/cart-flow.js --no-open "<query>"` with stdio piped.
2. Wait for `__CART_FLOW_URL__` sentinel — extract baseUrl/sessionId/token.
3. Subscribe to SSE.
4. Use a chooser that:
   - On `loading` → wait.
   - On `thumbs` → thumb up indices 0, 1, 2 (post 3 separate `thumb` actions with `direction: 'up'`), then post `thumbs_complete`.
   - On `final` → post `final_accept`.
   - On `login_required` → log `auth_required`, post `dismissed`, bail with status `AUTH_REQUIRED`.
   - On `redirect` → record cartUrl, wait for subprocess exit.
   - On `done` → wait for exit.
5. Parse the subprocess's final stdout outcome.
6. Append run record to results array: `{ query, outcome, cartUrl?, durationMs }`.
7. On success: `open <cartUrl>` so the user can verify in their browser.

**After all runs:**

Print a summary:

```
E2E dry-run summary:
  Run 1 ('wool sweater'): success → https://marinelayer.com/cart  (8.2s)
  Run 2 ('cotton sweater'): no_results  (3.1s)
  Run 3 ('cardigan'): success → https://marinelayer.com/cart  (7.6s)

2/3 runs succeeded. Cart URLs opened in browser.
```

Exit code:
- 0 if at least 1 success.
- 1 if all runs were `auth_required` OR `harness_error`.
- 2 if all runs were `no_results` (queries probably bad; not a harness failure).

**Tests:** None (this IS a runnable test). The harness module's unit tests cover the logic; this script is the integration runner.

- [ ] **Step 1: Write `test/e2e-cart-flow.js`.**
- [ ] **Step 2: Add `"e2e:cart": "node test/e2e-cart-flow.js"` to `package.json` scripts.**
- [ ] **Step 3: Run `npm test` — confirm 282 passing (no regression from package.json edit).**
- [ ] **Step 4: Commit:** `Add live E2E dry-run script against real retailers`

DO NOT run the live harness yourself — controller will execute the dry runs after Task 5.

---

### Task 4: SessionStart hook awareness (defer to controller)

Skipped intentionally — no infra changes. The existing `hooks/session-start.sh` nudges about pending purchases; if the dry runs land sweaters in the cart, the hook may fire next session. That's expected behavior, not a bug.

---

### Task 5: Ship v0.11.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

ALSO in this task: complete the queued copy change Eric requested in the conversation — replace "ADHD-helper" with "Low-friction helper" everywhere in customer-facing copy. Specifically:

- `package.json` description
- `.claude-plugin/plugin.json` description
- `README.md` description/status line
- (Note: the yuncun-marketplace's marketplace.json lives in a separate repo. Leave it alone here; it'll be updated separately.)

CHANGELOG entries are historical; don't rewrite them.

- [ ] **Step 1: README status update.**

Replace the v0.10.0 status line with:

```
**Status:** v0.11.0 — `/cart` is now testable end-to-end without a human in the loop. Protocol-level harness drives the flow via SSE + POST; live dry-run script (`npm run e2e:cart`) runs real flows against real retailers and opens any resulting cart URL in the browser.
```

- [ ] **Step 2: Description swap from "ADHD-helper" to "Low-friction helper" in `package.json` and `.claude-plugin/plugin.json`.**

- [ ] **Step 3: Version bump to 0.11.0 in both manifests.**

- [ ] **Step 4: Prepend CHANGELOG entry:**

```markdown
## 0.11.0 — 2026-05-11

Programmatic end-to-end test harness for `/cart`. Drives the flow at the
protocol level (SSE + POST), no browser required.

- `bin/cart-flow.js` now prints the session URL to stdout on a parseable
  sentinel line (`__CART_FLOW_URL__ <url>`) and accepts `--no-open` to
  suppress the macOS `open` call.
- New `test/lib/cart-harness.js`: reusable module that spawns the
  cart-flow subprocess, subscribes to SSE, and drives the state machine
  with an injected chooser. All deps (fetch, EventSource, spawn) DI'd
  for unit testing.
- New `npm run e2e:cart`: runs 3 default queries against real retailers,
  reports outcomes, opens any successful cart URL in the user's browser.
- Renamed "ADHD-helper" to "Low-friction helper" across customer-facing
  descriptions. Behavior signal (terse, time-boxed) stays encoded in
  individual skill prompts; the package description no longer pigeonholes.

Open spec items still deferred: Tier-1 handlers (Amazon, IKEA, Uniqlo,
West Elm), aesthetic variance ranking, Pinterest moodboard ingestion,
virtual try-on, cross-retailer dedup beyond URL, affiliate links, gift mode.
```

- [ ] **Step 5: Run full suite — confirm 282 passing.**

- [ ] **Step 6: Commit and push.**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.11.0 — E2E harness, --no-open flag, copy refresh"
git push origin main
```

---

## Self-review checklist

- [ ] All tasks committed.
- [ ] `npm test` shows 282 passing.
- [ ] `__CART_FLOW_URL__` sentinel is on stdout (NOT stderr), parseable by harness.
- [ ] `--no-open` actually suppresses the `open` call.
- [ ] Harness module is pure (all I/O DI'd); subprocess spawn is in a separate function.
- [ ] Harness handles `auth_required` and `no_results` gracefully (no hang, clear log).
- [ ] No new runtime deps for the plugin itself (test/devDeps OK).
- [ ] "ADHD-helper" removed from `package.json` description, `.claude-plugin/plugin.json` description, README.

---

## Post-plan live verification (controller responsibility)

After Task 5 commits, the controller runs:

1. `cd /Users/ericshen/Studio/superpowers-for-shopping && npm run e2e:cart`
2. Observes the summary output.
3. If any run succeeded, the user's browser opens to the cart URL — controller asks the user to confirm a sweater is visible in the cart.
4. If all runs were `auth_required`, controller tells the user to run `npm run smoke:browser` (Marine Layer login) and re-runs the harness.
5. If runs hang or error, controller debugs.

Acceptance: at least one run produces a real cart URL the user can verify.
