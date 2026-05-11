# Plan 5 — `/cart` Slash Command + Flow Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Ship the end-to-end `/cart "<query>"` user flow. This is the integration plan — no new library primitives, just orchestration that composes Plans 1-4 into a real working experience: search Marine Layer → show 8-card thumbs grid → narrow to 1 → call addToCart → redirect to retailer cart.

**Architecture:** `lib/flow.js` is a pure orchestration function with every external dependency injected. `bin/cart-flow.js` is the CLI shim that wires real deps and prints status. `commands/cart.md` is the slash-command LLM prompt that invokes the shim. Single retailer (`marinelayer.com`) hardcoded for v0.5.0; Plan 6 will pull from `retailers.md`.

**Tech Stack:** Node 20+ ESM. No new deps. Composes `lib/profile.js`, `lib/retailers/shopify.js`, `lib/browser.js`, `server/ui.js`.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — process notes carry through.
2. The four shipped plans (1-4 as-shipped or the original docs) — you'll be calling into them. Skim the public API surfaces.
3. `docs/specs/2026-05-10-superpowers-for-shopping-design.md` Sections 2 and 5 (user flow + search surface).

Process rules:
- DI for every external call. No globals.
- Adversarial input coverage upfront.
- The orchestrator returns a structured result object, never `process.exit`s from `lib/flow.js`. The shim handles exit codes.
- The shim prints structured status to stderr; stdout is for the final outcome line that the LLM-side slash command surfaces.

## Scope cuts for v0.5.0

These are deliberate v0.5.0 deferrals — Plan 6+ adds them:
- **Single retailer:** hardcoded `['marinelayer.com']`. No `retailers.md` reading. No multi-retailer aggregation. No Amazon/IKEA/Uniqlo Tier-1 handlers.
- **Naive ranking:** top-N candidates returned by `search`, in order. No aesthetic variance, no profile-based pre-filter, no per-thumb learning.
- **No "see alternatives" in final card.** Plan 4's UI supports the action; the orchestrator doesn't handle it. Final card has accept and cancel only.
- **No login retry loop.** If `addToCart` returns `authentication_required`, the flow surfaces that and exits. User must run `npm run smoke:browser` first to establish a Shopify session. Plan 6 adds in-flow login.
- **No clarifying questions.** If profile has `budget_default`, use it. If not, no budget filter is applied. Plan 6 adds the 1-2 question prompt.
- **No post-purchase feedback loop.** Plan 6 adds the SessionStart nudge.

## What's not in this plan

- No retailer-management commands (Plan 6).
- No real ranking heuristics (Plan 7).
- No `addToCart` happy-path in the live smoke (we don't want to litter a real Shopify cart during testing). The smoke uses a mocked `addToCart` that returns success.

## File structure

| File | Responsibility | LOC |
|---|---|---|
| `lib/flow.js` | `runCartFlow({query, retailers, deps})` — pure orchestrator | ~180 |
| `bin/cart-flow.js` | CLI: parse argv, wire deps, run flow, print status, exit | ~100 |
| `commands/cart.md` | LLM prompt invoking `bin/cart-flow.js` | ~20 |
| `test/flow.test.js` | Unit tests for `runCartFlow` with all deps mocked | ~280 |
| `test/live-flow.js` | Manual smoke: real search + real browser cookies, MOCKED addToCart | ~110 |

Modified: `package.json` (add `smoke:flow` script + bin entry; bump version at end).
Modified: `README.md` and `CHANGELOG.md` at the end.

## API surface (final)

```js
// lib/flow.js
export async function runCartFlow({
  query,                                   // string, e.g. "sweater"
  retailers,                               // array of host strings, e.g. ['marinelayer.com']
  deps: {
    readProfile,                           // () => Promise<profile>           (from lib/profile.js)
    search,                                // (host, query, opts?) => Promise<results>  (Plan 2)
    getCookieHeader,                       // (host, opts?) => Promise<string|null>      (Plan 3)
    addToCart,                             // ({host, variantId, cookie}) => Promise<{ok, error?}>  (Plan 2)
    startServer,                           // (opts?) => Promise<{baseUrl, createSession, shutdown}>  (Plan 4)
    openUrl,                               // (url) => void  — opens URL in user's default browser
    log,                                   // (msg) => void  — status messages (stderr in real impl)
  },
});
// Returns one of:
//   { outcome: 'success', product, cartUrl }
//   { outcome: 'no_results' }
//   { outcome: 'canceled' }                          // user clicked cancel
//   { outcome: 'dismissed' }                         // user closed tab
//   { outcome: 'auth_required', host }
//   { outcome: 'cart_error', host, error }
//   { outcome: 'flow_error', error }                 // unexpected
```

The function NEVER throws on runtime conditions — it returns an outcome. It WILL throw on programmer errors (missing required deps, malformed inputs).

## Flow state machine (in detail)

```
start
  ↓
[read profile]
  ↓
[search each retailer in parallel, aggregate first 8 by listing order]
  ↓
results empty? → return { outcome: 'no_results' }
  ↓
[start UI server, create session]
  ↓
[openUrl(session.url)]
  ↓
[pushState loading "Searching..."]
  ↓ (already searched, this is just a stage marker for the UI's first paint)
[pushState thumbs with candidates]
  ↓
[await nextAction({types: ['thumbs_complete', 'dismissed']})]
  ↓ dismissed? → shutdown, return { outcome: 'dismissed' }
  ↓ thumbs_complete:
[pick top candidate]
  ↓
[pushState final with product]
  ↓
[await nextAction({types: ['final_accept', 'final_cancel', 'dismissed']})]
  ↓ cancel/dismiss? → shutdown, return { outcome: 'canceled' | 'dismissed' }
  ↓ accept:
[getCookieHeader(host)]
  ↓ null? → pushState done "auth required", shutdown, return { outcome: 'auth_required', host }
  ↓
[addToCart({host, variantId: top.variants[0].variant_id, cookie})]
  ↓ ok: false, error: 'authentication_required'? → return { outcome: 'auth_required', host }
  ↓ ok: false, other? → pushState done "cart failed", shutdown, return { outcome: 'cart_error', host, error }
  ↓ ok: true:
[pushState redirect <cartUrl>]
  ↓ (give browser 2s to navigate)
[shutdown]
  ↓
return { outcome: 'success', product, cartUrl }
```

**Pick top candidate** (v0.5.0): count thumbs-up actions in the action log, pick the candidate with the most ups; ties broken by listing order. If zero ups received, pick the first candidate (the user dismissed thumbs by clicking "show me the best one" without thumbing — fall back to listing).

To collect thumbs from the action queue: orchestrator records all thumb actions as they come in by calling `nextAction({types: ['thumb', 'thumbs_complete', 'dismissed']})` in a loop, accumulating thumbs into a tally, and breaking on `thumbs_complete` or `dismissed`.

## Variant selection

For v0.5.0, `addToCart` is called with `top.variants[0].variant_id`. This assumes the first variant is acceptable. Real life: user wants size M not S. Plan 6 introduces a size-from-profile filter before picking. Document this limitation in the cart_error message if the first variant is out of stock.

If `top.variants` is empty (no variants on the product), the flow returns `{ outcome: 'cart_error', host, error: 'no_variants' }` without calling `addToCart`.

## Test strategy

`test/flow.test.js` mocks every dep. Each test:
1. Constructs a `deps` object with stub functions.
2. Calls `runCartFlow(...)`.
3. Asserts the returned outcome AND the sequence of pushState calls AND the deps that got called.

A small `mockSession` helper queues canned actions for `nextAction` to return in order:

```js
function mockSession({ actions = [] }) {
  const pushed = [];
  let i = 0;
  return {
    pushed,
    pushState: (s) => pushed.push(s),
    nextAction: async ({ types } = {}) => {
      while (i < actions.length) {
        const a = actions[i++];
        if (!types || types.includes(a.type)) return a;
      }
      // No more queued actions — block forever (test will time out if this fires)
      return new Promise(() => {});
    },
    close: () => {},
  };
}
```

---

## Tasks

### Task 1: `lib/flow.js` — happy path + no-results + cancellation

**Files:**
- Create: `lib/flow.js`
- Create: `test/flow.test.js`

This task ships the orchestrator with the three simplest outcomes: `success`, `no_results`, `canceled`. Auth and error paths come in Task 2 — splitting keeps each round smaller than 200 LOC of new code.

**Behavior:**
- Read profile (call `readProfile()`). The result is unused in v0.5.0 — read it anyway to confirm the wiring works. (Plan 6 will use it.)
- Search every retailer in parallel via `Promise.all(retailers.map(h => search(h, query)))`. Concatenate results. Take first 8.
- If 0 candidates → return `{outcome: 'no_results'}`. Don't even start the UI server.
- Otherwise, start the UI server, create a session, call `openUrl(session.url)`.
- Push `{stage: 'loading', message: 'Loading candidates...'}` then `{stage: 'thumbs', candidates}`.
- Collect thumbs: loop calling `nextAction({types: ['thumb', 'thumbs_complete', 'dismissed']})`. Accumulate thumb-ups by candidate index. Break on `thumbs_complete` or `dismissed`.
- On `dismissed` → shutdown, return `{outcome: 'dismissed'}`.
- Pick top candidate: index with the most ups; ties go to listing order; zero ups → index 0.
- Push `{stage: 'final', product, alternativesCount}`.
- Await `nextAction({types: ['final_accept', 'final_cancel', 'dismissed']})`.
- On `final_cancel` → shutdown, return `{outcome: 'canceled'}`.
- On `dismissed` → shutdown, return `{outcome: 'dismissed'}`.
- On `final_accept`:
  - Push `{stage: 'redirect', url: cartUrl}` where cartUrl is built as `https://${host}/cart`.
  - Wait 2 seconds (let browser navigate).
  - Shutdown.
  - Return `{outcome: 'success', product, cartUrl}`.

**Critical: `runCartFlow` must call `server.shutdown()` on EVERY exit path.** Wrap in try/finally or be very careful about the unhappy paths.

**Tests (~10 cases for Task 1):**

1. With zero search results across all retailers → returns `{outcome: 'no_results'}`. Server is NOT started (verify `startServer` mock not called).
2. With 5 search results across retailers → calls UI with 5 candidates (uses all of them — fewer than 8 is fine). No truncation oddities.
3. With 12 search results → uses only first 8 candidates in the pushState.
4. Happy path: `thumb up index 2`, `thumb up index 5`, `thumbs_complete`, `final_accept` → returns success with `product` = `candidates[5]` (index 5 had ups, but wait — both 2 and 5 each have 1 up; tie broken by listing order → index 2 wins). Re-read: actually 2 came first AND 5 came second; both have 1 up. Listing-order tiebreaker means index 2 wins. Got it. Adjust test: `thumb up index 2`, `thumb up index 2`, `thumb up index 5`, `thumbs_complete` → index 2 has 2 ups, wins.
5. Happy path with zero ups: `thumbs_complete` immediately → product = candidates[0].
6. Happy path's pushState sequence: `loading`, `thumbs`, `final`, `redirect`. Assert pushed.length === 4 and pushed[i].stage values are correct.
7. Happy path calls `openUrl` exactly once with the session URL.
8. Cancel at thumbs stage: `dismissed` action → returns `{outcome: 'dismissed'}`. No final card pushed.
9. Cancel at final stage: `thumbs_complete`, `final_cancel` → `{outcome: 'canceled'}`.
10. `runCartFlow` calls `server.shutdown` on every exit path (happy, no_results, canceled, dismissed). Verify via spy.

For tests that wait 2 seconds (the post-redirect pause), inject a `sleep` function in deps too:
```js
deps.sleep = (ms) => Promise.resolve();  // no-op in tests
```

Adjust the runCartFlow signature: `deps.sleep` defaults to real `(ms) => new Promise(r => setTimeout(r, ms))`. Document this clearly.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement `lib/flow.js`**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 174 (Plan 4 baseline) + 10 = 184 passing.

- [ ] **Step 6: Commit:** `"Add lib/flow.js orchestrator with success/cancel/no-results paths"`

---

### Task 2: Auth + cart error paths

**Files:**
- Modify: `lib/flow.js`
- Modify: `test/flow.test.js`

Extend `runCartFlow` to handle:
- `getCookieHeader` returns `null` → `{outcome: 'auth_required', host}`. Push `{stage: 'done', message: 'You need to log in to {host} first. Run `npm run smoke:browser` to start a session.'}` before shutdown. (Plan 6 will replace this with in-flow login.)
- `addToCart` returns `{ok: false, error: 'authentication_required'}` → same as above: `{outcome: 'auth_required', host}`. (Cookie was present but server rejected it — likely expired.)
- `addToCart` returns `{ok: false, error}` for any other error → push `{stage: 'done', message: 'Couldn't add to cart: {error}'}`, then `{outcome: 'cart_error', host, error}`.
- `top.variants` is empty → don't call addToCart. Push `{stage: 'done', message: 'This product has no variants.'}`. Return `{outcome: 'cart_error', host, error: 'no_variants'}`.

**Tests (~6 cases):**

1. Final accept, getCookieHeader returns null → `{outcome: 'auth_required', host}`. addToCart NOT called.
2. Final accept, cookie present, addToCart returns `{ok: false, error: 'authentication_required'}` → `{outcome: 'auth_required', host}`.
3. Final accept, cookie present, addToCart returns `{ok: false, error: 'out_of_stock'}` → `{outcome: 'cart_error', host, error: 'out_of_stock'}`. The "done" stage was pushed with a message that includes 'out_of_stock'.
4. Final accept, top.variants empty → `{outcome: 'cart_error', host, error: 'no_variants'}`. addToCart NOT called.
5. Final accept, addToCart returns ok: true → `{outcome: 'success', ...}` (regression check for Task 1's happy path).
6. addToCart is called with `{host, variantId: variants[0].variant_id, cookie}` — assert the args.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Extend `lib/flow.js`**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 184 + 6 = 190 passing.

- [ ] **Step 6: Commit:** `"Add auth and cart-error outcome handling to runCartFlow"`

---

### Task 3: `bin/cart-flow.js` CLI shim + `commands/cart.md`

**Files:**
- Create: `bin/cart-flow.js`
- Create: `commands/cart.md`
- Modify: `package.json` (add `cart-flow` bin entry)

**`bin/cart-flow.js`:**
- Make it executable (`chmod +x` equivalent — set permissions in the file or rely on the npm bin install; for now just `#!/usr/bin/env node` shebang).
- Parse argv: `node bin/cart-flow.js "<query>"`. The query is `process.argv[2]`. If missing, print usage to stderr and exit 2.
- Wire real deps:
  - `readProfile` from `../lib/profile.js`
  - `search` from `../lib/retailers/shopify.js`
  - `getCookieHeader`, `addToCart` from their respective modules
  - `startServer` from `../server/ui.js`
  - `openUrl(url)`: `await new Promise((r, rj) => { execFile('open', [url], (err) => err ? rj(err) : r()); })` on macOS. On non-darwin platforms, just print "Open this URL: <url>" to stderr instead.
  - `log(msg)`: `process.stderr.write(msg + '\n')`
  - `sleep`: real timer
- Hardcoded retailer list: `['marinelayer.com']`. Add a TODO comment: `// TODO Plan 6: read from ~/.claude/cart/retailers.md`.
- Call `runCartFlow(...)`. Map outcomes to:
  - stdout one line: machine-readable status `outcome=<value>` plus details
  - exit code: 0 for success, 1 for any non-success outcome (no_results, canceled, dismissed, auth_required, cart_error, flow_error)

Output format (stdout, one per outcome):
```
outcome=success product="<title>" brand="<brand>" cart_url="<url>"
outcome=no_results query="<query>"
outcome=canceled
outcome=dismissed
outcome=auth_required host="<host>"
outcome=cart_error host="<host>" reason="<error>"
```

Quote values containing spaces. No JSON — keep it shell-grep-friendly.

**`commands/cart.md`:**

```markdown
---
description: Start a one-click shopping flow for a clothing/lifestyle item.
argument-hint: <what you need>
---

The user just ran `/cart $ARGUMENTS`.

Run this Bash command:
```bash
node ${CLAUDE_PLUGIN_ROOT}/bin/cart-flow.js "$ARGUMENTS"
```

This is an interactive flow. The script will:
1. Search retailers for the query.
2. Open a browser tab showing 8 candidates with thumbs up/down buttons.
3. Wait for the user to thumb and click "Show me the best one."
4. Show a final card with accept/cancel.
5. On accept, add to cart and redirect the browser to the retailer's cart.

While the script is running, the user is interacting with their browser. Don't interrupt. Surface the final outcome (last line of stdout) when the script exits.

If the outcome is `auth_required`, tell the user to run `npm run smoke:browser` in the plugin directory to establish a session, then retry.
```

**Add to package.json:**
```json
"bin": {
  "cart": "./bin/cart.js",
  "cart-flow": "./bin/cart-flow.js"
}
```

No new tests in this task — the orchestrator is unit-tested in Tasks 1+2. The shim is exercised by the live smoke in Task 4.

- [ ] **Step 1: Write `bin/cart-flow.js`**
- [ ] **Step 2: Write `commands/cart.md`**
- [ ] **Step 3: Update `package.json` bin entry**
- [ ] **Step 4: `node --check` the bin file**
- [ ] **Step 5: Run full suite (sanity)**

Expected: 190 passing (unchanged).

- [ ] **Step 6: Commit:** `"Add cart-flow CLI shim and /cart slash command"`

---

### Task 4: Live smoke `test/live-flow.js`

**Files:**
- Create: `test/live-flow.js`
- Modify: `package.json` (add `smoke:flow` script)

The smoke runs the full orchestrator against the real network and a real browser, BUT mocks `addToCart` so we don't actually load a Marine Layer cart during testing.

**Script behavior:**
- Use real `search`, `startServer`, `openUrl`, `getCookieHeader`.
- Mock `addToCart` to print a fake-success message and return `{ok: true}`.
- Use a fixed query, e.g. `"sweater"`.
- Pass through `readProfile` (which reads ~/.claude/cart/profile.md).
- Print structured status to stderr.
- Exit with the orchestrator's outcome.

Add `"smoke:flow": "node test/live-flow.js"` to `package.json`.

- [ ] **Step 1: Write `test/live-flow.js`**
- [ ] **Step 2: Add npm script**
- [ ] **Step 3: `node --check` the file**
- [ ] **Step 4: Run full suite (still 190)**

- [ ] **Step 5: Commit:** `"Add live /cart flow smoke script"`

---

### Task 5: Ship v0.5.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status**

`**Status:** v0.5.0 — the `/cart` flow ships end-to-end against marinelayer.com. Type `/cart "I need a sweater"` to try it. Plan 6 adds multi-retailer + in-flow login.`

- [ ] **Step 2: Bump versions to 0.5.0**

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.5.0 — 2026-05-11

The first user-facing release. Composes Plans 1-4 into the end-to-end
`/cart "<query>"` flow.

- New `lib/flow.js`: pure orchestrator with structured-outcome return.
  Handles success / no_results / canceled / dismissed / auth_required /
  cart_error paths. Every dependency injected for testability.
- New `bin/cart-flow.js`: CLI wiring real `search`, browser cookies,
  `addToCart`, UI server.
- New `commands/cart.md`: the slash command itself.
- New `npm run smoke:flow` exercises the full path with `addToCart` mocked.

v0.5.0 scope cuts (Plan 6 picks these up):
- Single retailer hardcoded (marinelayer.com). No `retailers.md` reading.
- Naive top-1 ranking by thumbs-up count, no profile filter.
- No "see alternatives" handling.
- No in-flow login retry — auth_required exits the flow with guidance.
- No clarifying questions (budget/occasion).
```

- [ ] **Step 4: Run full suite**

Expected: 190 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.5.0 — /cart flow integration"
git push origin main
```

---

## Self-review checklist

- [ ] All 5 tasks committed.
- [ ] `npm test` shows 190 passing.
- [ ] Live smoke (`npm run smoke:flow`) was run end-to-end and the flow reaches at least the `final_accept` stage with a real Marine Layer product before the mocked addToCart fires.
- [ ] `bin/cart-flow.js` has the `#!/usr/bin/env node` shebang.
- [ ] `runCartFlow` calls `shutdown()` on every exit path.
- [ ] `runCartFlow` never throws on runtime conditions (only programmer errors).
- [ ] No new runtime deps.

## Final review

Dispatch a code-quality reviewer over `lib/flow.js`. Specifically check:
- Every exit path closes the server.
- The thumbs-collection loop doesn't drop the `dismissed` action (must break out, not keep waiting).
- The variant_id pick is `top.variants[0]?.variant_id` with the empty-variants guard.
- No `process.exit` calls in `lib/flow.js`.
