# Plan 7 — In-Flow Login Retry + `/cart-retailers login` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Stop bouncing the user out of the flow when they're not logged in. When `/cart` hits an `authentication_required` state, the UI prompts the user to log in, opens the retailer's login page in another tab, and resumes the flow after the user comes back. Adds `/cart-retailers login <host>` so the user can pre-authenticate outside the flow.

**Architecture:** New UI state `login_required` rendered by `server/render.js`. `runCartFlow` detects auth gaps (null cookie OR addToCart returning auth_required), pushes the new state, opens the login page in the background, awaits a `login_complete` action from the user, and retries once. `bin/retailers.js` gains a `login <host>` subcommand that just opens the page (the persistent agent-browser profile captures cookies for free).

**Tech Stack:** Node 20+ ESM. No new deps.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-11-plan-5-cart-flow.md` and Plan 6 — for the existing flow + retailer-store conventions.
2. `lib/flow.js` and `test/flow.test.js` — what you're extending.
3. `server/render.js` and `test/server/render.test.js` — where the new state stage gets rendered.
4. `lib/browser.js` — `openLoginPage`, `getCookieHeader`, `isLoggedIn` already exist.

Process rules from prior plans:
- DI for every external call.
- Adversarial tests upfront.
- Validate at boundaries.
- Bundle related tasks.

## What's NOT in this plan

- No auto-detection of "logged in" by sniffing specific cookies. The heuristic stays "any cookie present for host = maybe logged in." The authoritative answer remains `addToCart`'s response.
- No more than one retry per `final_accept`. Second auth failure exits the flow with `auth_required`.
- No `/cart-retailers verify <host>` separate command — the user just retries `/cart` to know.

## Flow change

Replace the current `final_accept` handler with a small loop:

```
on final_accept:
  for attempt in [1, 2]:
    cookie = await getCookieHeader(host)
    if cookie is null:
      if attempt === 2: return auth_required
      pushState({stage: 'login_required', host, message: <reason>})
      openLoginPage(host)  // fire-and-forget; orchestrator does not await
      action = await nextAction({types: ['login_complete', 'dismissed']})
      if action.type === 'dismissed': return dismissed
      continue (retry)
    
    result = await addToCart({host, variantId, cookie})
    if result.ok: 
      // push redirect, return success
      break
    if result.error === 'authentication_required':
      if attempt === 2: return auth_required
      pushState({stage: 'login_required', host, message: 'session expired'})
      openLoginPage(host)
      action = await nextAction({types: ['login_complete', 'dismissed']})
      if action.type === 'dismissed': return dismissed
      continue (retry)
    // other cart_error
    return cart_error
```

Note: openLoginPage must be added to deps. It defaults to `null` in tests if not provided; production wires `lib/browser.js`'s impl.

## New UI state

`{ stage: 'login_required', host: string, message?: string }`

The render shows:
- Heading: "Almost there"
- Body: "We need you logged in to {host}. {message}. We've opened the page in another tab."
- Single primary button: "I'm logged in, retry"

Button click → `sendAction({type: 'login_complete'})`.

## API surface changes

```js
// lib/flow.js — runCartFlow signature
//   deps now includes optional `openLoginPage` (required in production, optional in tests via mock)

// bin/retailers.js — new subcommand
//   login <host> → opens login page via openLoginPage. Prints `opened=<host>` on success.
```

## File structure

| File | Change | LOC delta |
|---|---|---|
| `lib/flow.js` | Login retry loop | +30 |
| `test/flow.test.js` | + 6 retry tests | +180 |
| `server/render.js` | + login_required rendering | +30 |
| `test/server/render.test.js` | + 2 render assertions | +15 |
| `bin/retailers.js` | + `login` subcommand | +15 |

---

## Tasks

### Task 1: `login_required` rendering

**Files:**
- Modify: `server/render.js`
- Modify: `test/server/render.test.js`

In `server/render.js`'s `render(state)` switch (or branches), add a case for `state.stage === 'login_required'`. It renders:

```html
<div class="final-wrap">
  <div class="final-card login-card">
    <div class="final-body">
      <div class="final-brand">Almost there</div>
      <div class="final-title">Log in to ${host}</div>
      <p class="login-msg">${message}. We've opened the page in another tab — log in, then click below.</p>
      <button class="btn-primary" id="btn-login-complete">I'm logged in, retry</button>
    </div>
  </div>
</div>
```

Wire `btn-login-complete` click → `sendAction({type: 'login_complete'})`.

Escape host and message via `escHtml`. The host should always be present; message may be undefined → render empty.

**Tests (~2 new):**

1. Output contains a case branching on `state.stage === 'login_required'` (substring assertion: `'login_required'` appears in the JS body).
2. Output contains a button click handler that sends `{type: 'login_complete'}` (substring assertion: `'login_complete'`).

These are weak but sufficient — Task 2's flow tests will exercise the actual rendering path indirectly via the state machine.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement the render branch**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 215 (Plan 6 baseline) + 2 = 217 passing.

- [ ] **Step 6: Commit:** `"Add login_required render branch"`

---

### Task 2: `runCartFlow` login retry loop

**Files:**
- Modify: `lib/flow.js`
- Modify: `test/flow.test.js`

Refactor the `final_accept` branch to the loop described above. Add `openLoginPage` to the deps destructure (no default — production passes it, tests pass a spy).

**Behavior contract:**
- First null-cookie OR auth_required addToCart → push login_required, fire openLoginPage, await user, retry once.
- Second null-cookie OR auth_required → return `{outcome: 'auth_required', host}`.
- `dismissed` during login_required → return `{outcome: 'dismissed'}`.
- Other `cart_error` from addToCart → return `{outcome: 'cart_error', host, error}` (no retry; retry is only for auth issues).

**Tests (~6 new in `test/flow.test.js`):**

1. **Login retry happy path:** Mock `getCookieHeader` returns null first call, 'sess=abc' second call. Mock `addToCart` returns ok. Actions queue: [thumbs_complete, final_accept, login_complete]. Result: `{outcome: 'success', ...}`. `openLoginPage` was called once with `host`. `pushState` sequence includes a `login_required` stage.
2. **Auth, retry, auth-again, exit:** Mock `getCookieHeader` returns null both times. Actions: [thumbs_complete, final_accept, login_complete]. Result: `{outcome: 'auth_required', host}`.
3. **Dismissed during login_required:** Mock returns null cookie. Actions: [thumbs_complete, final_accept, dismissed]. Result: `{outcome: 'dismissed'}`.
4. **Auth via addToCart auth_required, then retry success:** Mock `getCookieHeader` returns 'sess=abc' both times. Mock `addToCart` returns auth_required first call, ok second call. Actions: [thumbs_complete, final_accept, login_complete]. Result: success.
5. **Cart error other than auth doesn't trigger retry:** Mock `addToCart` returns `{ok: false, error: 'out_of_stock'}`. Result: `{outcome: 'cart_error', host, error: 'out_of_stock'}`. `openLoginPage` NOT called.
6. **openLoginPage is called once, not awaited (fire-and-forget):** Verify by giving `openLoginPage` a slow promise (never resolves in test). The flow MUST still proceed to await `nextAction`. Implementation hint: `openLoginPage(host).catch(() => {})` — fire and forget, swallow errors.

Update existing tests as needed: the Task 1 (Plan 5) tests that expected `{outcome: 'auth_required', host}` immediately after a null cookie now need an `openLoginPage` dep and need to pass the dismissed action so the flow exits via dismissal. Adjust the action queues in those tests.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Update existing tests that hit the auth path** (no longer immediate-return)
- [ ] **Step 3: Run — verify they fail**
- [ ] **Step 4: Implement the loop**
- [ ] **Step 5: Run — verify pass**
- [ ] **Step 6: Run full suite**

Expected: 217 + 6 = 223 passing. **However, the existing test adjustments may not add net new tests if you re-use existing test names. Aim for 223; if 222 or 224, document why.**

- [ ] **Step 7: Commit:** `"Add login retry loop to runCartFlow"`

---

### Task 3: `/cart-retailers login <host>` subcommand

**Files:**
- Modify: `bin/retailers.js`
- Modify: `commands/cart-retailers.md`

Add a `login <host>` subcommand:
- `normalizeHost(host)`.
- Call `openLoginPage(host)` from `lib/browser.js`.
- On success: print `opened=<host>` to stdout, exit 0.
- On any thrown error: print `error=<err.code || 'failed'>` to stdout, exit 1.

Update `commands/cart-retailers.md` to also handle `login <host>` per the same pattern as add/remove.

No new tests for this — `openLoginPage` is already unit-tested in Plan 3.

- [ ] **Step 1: Add the `login` subcommand to `bin/retailers.js`**
- [ ] **Step 2: Update `commands/cart-retailers.md`**
- [ ] **Step 3: `node --check bin/retailers.js`**
- [ ] **Step 4: Run full suite**

Expected: 223 passing.

- [ ] **Step 5: Commit:** `"Add /cart-retailers login subcommand"`

---

### Task 4: Wire `openLoginPage` into `bin/cart-flow.js`

**Files:**
- Modify: `bin/cart-flow.js`

Just one tweak: import `openLoginPage` from `../lib/browser.js` and add it to the deps. Without this, the production flow will be `undefined` and the login retry path will fail at the call site.

- [ ] **Step 1: Update `bin/cart-flow.js`**
- [ ] **Step 2: `node --check`**
- [ ] **Step 3: Run full suite**

Expected: 223 passing.

- [ ] **Step 4: Commit:** `"Wire openLoginPage into cart-flow CLI"`

---

### Task 5: Ship v0.7.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status**

`**Status:** v0.7.0 — login is now handled in-flow. When `/cart` hits an unauthenticated retailer, the UI prompts you to log in and resumes after you click "I'm logged in, retry." Plan 8 adds feedback loops and ranking heuristics.`

- [ ] **Step 2: Bump versions to 0.7.0**

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.7.0 — 2026-05-11

In-flow login retry. No more bouncing out of `/cart` when a retailer
session is missing or expired.

- New UI stage `login_required` rendered as a single-button "Almost
  there" card with the host name.
- `runCartFlow` retries `addToCart` once after the user signals
  `login_complete`. Second failure exits with `auth_required`.
- `openLoginPage` fires in the background (not awaited) so the user
  sees the UI prompt instantly.
- New `/cart-retailers login <host>` subcommand opens the retailer's
  login page for pre-authentication.

v0.7.0 deferrals (Plan 8):
- No `/cart-feedback` for marking purchases kept/returned.
- No SessionStart hook nudging about old purchases.
- No `/cart-rule` for promoting learned signals to hard rules.
- No ranking heuristics (still naive top-N by listing order).
```

- [ ] **Step 4: Run full suite**

Expected: 223 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.7.0 — in-flow login retry"
git push origin main
```

---

## Self-review checklist

- [ ] All 5 tasks committed.
- [ ] `npm test` shows 223 passing (or document the actual count).
- [ ] `openLoginPage` is wired in `bin/cart-flow.js` AND `bin/retailers.js`.
- [ ] The retry loop fires AT MOST one retry per `final_accept`.
- [ ] `openLoginPage` is fire-and-forget — the flow doesn't await it.
- [ ] No regressions in the existing 215 tests.
