# Plan 3 — Browser Session Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `lib/browser.js`, a thin wrapper around the `agent-browser` CLI that exposes persistent-profile login, cookie extraction, and login-state detection. Plan 5's `/cart` flow will compose this with Plan 2's `addToCart` to complete the cart handoff.

**Architecture:** Stateless functions that subprocess `agent-browser` with `--profile ~/.claude/cart/browser-profile/` on every invocation. Dependency-injected `execImpl` for testability — unit tests pass a fake exec; live smoke runs the real CLI. No user-interaction code in the library; Plan 5 owns the "press Enter when done" UX.

**Tech Stack:** Node 20+ ESM. New runtime dep: none (uses `node:child_process`). Hard external dependency: `agent-browser` 0.23+ on PATH.

---

## Context for the implementer

This plan extends `superpowers-for-shopping`, currently at v0.2.0. Read first:

1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — process notes at the bottom.
2. `docs/plans/2026-05-10-plan-2-shopify-handler.md` — Plan 2 conventions (DI pattern, typed errors, no `_raw` field, validate-at-boundary).
3. `docs/specs/2026-05-10-superpowers-for-shopping-design.md` Section 6 (browser session and cart handoff).

Process rules from Plans 1+2 (enforced by review):
- Spec behavior, not implementation, for parsers. Tests pin behavior.
- Adversarial-input tests in the original task, not as a hardening patch.
- Validate at the boundary. Throw `invalid_*` typed errors on programmer mistakes; return `{ok: false, error}` on runtime conditions where the caller has a UI recovery path.
- Native fetch / native subprocess. Don't add deps.
- Imports resolve at parse time. Add the export before the test that imports it.

## What's not in this plan

- No slash command (Plan 5/6).
- No `retailers.md` storage (Plan 6).
- No `/cart` flow integration (Plan 5).
- No version bump on profile.md schema (still deferred).
- No `auth save` / stored credentials. Login is always interactive — the user opens the browser, logs in once, agent-browser persists the cookies via `--profile`.

## File structure

| File | Responsibility | LOC budget |
|---|---|---|
| `lib/paths.js` | + `browserProfilePath` (one-line addition) | unchanged |
| `lib/browser.js` | `openLoginPage`, `getCookieHeader`, `isLoggedIn`, `closeBrowser`, plus internal `runAgentBrowser` | ~120 |
| `test/paths.test.js` | + test for `browserProfilePath` | unchanged |
| `test/browser.test.js` | Mock-execImpl unit tests | ~250 |
| `test/live-browser.js` | Manual smoke against marinelayer.com | ~70 |

`package.json` gets `npm run smoke:browser`.
`README.md` and `CHANGELOG.md` get v0.3.0 entries.

## agent-browser surface used

Verified against `agent-browser --help` (v0.23.0):

| CLI command | What we use it for |
|---|---|
| `agent-browser open <url> --profile <path>` | Navigate to the login page; daemon starts if needed |
| `agent-browser cookies get --json --profile <path>` | Retrieve all current cookies as JSON |
| `agent-browser close --profile <path>` | Close the browser context |

Output envelope (verified): `{"success": bool, "data": <payload>, "error": null | string}`. Non-zero exit code on subprocess failure (e.g., browser crash, agent-browser not on PATH).

## API surface (final)

```js
// lib/browser.js
export async function openLoginPage(host, { execImpl } = {});
// → undefined. Opens persistent browser to https://<host>/. Throws invalid_host
//   on bad host, browser_unavailable if agent-browser isn't on PATH,
//   navigation_failed on browser errors.

export async function getCookieHeader(host, { execImpl } = {});
// → string in "name1=value1; name2=value2" format, or null if no cookies for host.
//   Throws invalid_host. Returns null (not throws) on no-cookies-yet.

export async function isLoggedIn(host, { execImpl } = {});
// → boolean. True if at least one cookie present for the host. Throws invalid_host.

export async function closeBrowser({ execImpl } = {});
// → undefined. Idempotent — closing an already-closed browser is a no-op.
```

Internal (not exported): `runAgentBrowser(args, { execImpl })` — shared subprocess wrapper that runs `agent-browser <args>`, parses the JSON envelope, surfaces typed errors.

## Test strategy

Unit tests use an injected `execImpl(file, args)` that returns `{ stdout, stderr }` as a Promise. Every test constructs the exact stdout payload it wants agent-browser to "return."

```js
function mockExec(routes) {
  return async (file, args) => {
    const key = [file, ...args].join(' ');
    const route = routes[key] || routes[args.join(' ')];
    if (!route) throw new Error(`unexpected exec: ${key}`);
    if (typeof route === 'function') return route(file, args);
    if (route.throws) throw route.throws;
    return { stdout: typeof route === 'string' ? route : JSON.stringify(route), stderr: '' };
  };
}
```

Live smoke (`test/live-browser.js`) does NOT use the mock — it runs the real `agent-browser`, opens marinelayer.com, prompts the user (via readline) to log in, then dumps cookies.

---

## Tasks

### Task 1: Add `browserProfilePath` to `lib/paths.js`

**Files:**
- Modify: `lib/paths.js`
- Modify: `test/paths.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/paths.test.js`:

```js
test('browserProfilePath is under cartDir', () => {
  assert.equal(browserProfilePath(), path.join(cartDir(), 'browser-profile'));
});
```

Update the import at the top of the file to include `browserProfilePath`:
```js
import { cartDir, profilePath, retailersPath, requestsDir, browserProfilePath } from '../lib/paths.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/paths.test.js`
Expected: import error or assertion fail (5 tests).

- [ ] **Step 3: Add the export**

In `lib/paths.js`:
```js
export const browserProfilePath = () => path.join(cartDir(), 'browser-profile');
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: 5 paths tests passing.

- [ ] **Step 5: Run full suite**

Expected: 92 passing (91 from v0.2.0 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add lib/paths.js test/paths.test.js
git commit -m "Add browserProfilePath to lib/paths.js"
```

---

### Task 2: `runAgentBrowser` + `closeBrowser` (the simplest subprocess surface)

**Files:**
- Create: `lib/browser.js`
- Create: `test/browser.test.js`

`closeBrowser` is the cleanest entry point to pin `runAgentBrowser`'s contract: one command, simple envelope, idempotent. Bundling them lets the internal helper get its full test surface before any "real" function uses it.

**`runAgentBrowser(args, { execImpl })` behavior:**
- Spawns `agent-browser` with `args`. Always prepends `--profile <browserProfilePath>` to `args` UNLESS args already includes `--profile`.
- Parses stdout as JSON.
- If `agent-browser` isn't on PATH (`ENOENT`), throws `browser_unavailable`.
- On non-zero exit code, throws `browser_failed` with stderr in message.
- On unparseable JSON stdout, throws `browser_failed` with stdout excerpt in message.
- On JSON `{success: false, error: "..."}` envelope, throws `browser_failed` with that error.
- On success, returns the `data` field (or `null` if `data` is absent).

**`closeBrowser({ execImpl })` behavior:**
- Calls `runAgentBrowser(['close'], opts)`.
- Returns `undefined`.
- If `runAgentBrowser` throws `browser_failed` with message containing "no active session" or similar, swallow — closing a non-open browser is a no-op. Other errors propagate.

- [ ] **Step 1: Write the failing tests**

```js
// test/browser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from '../lib/browser.js';
import { browserProfilePath } from '../lib/paths.js';

function mockExec(routes) {
  return async (file, args) => {
    const key = [file, ...args].join(' ');
    const route = routes[key];
    if (!route) throw new Error(`unexpected exec: ${key}`);
    if (typeof route === 'function') return route(file, args);
    if (route.throws) throw route.throws;
    return { stdout: typeof route.stdout === 'string' ? route.stdout : JSON.stringify(route.stdout ?? {}), stderr: route.stderr ?? '' };
  };
}

const PROFILE_ARG = `--profile ${browserProfilePath()}`;

test('closeBrowser succeeds when agent-browser reports success', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close`]: {
      stdout: { success: true, data: null, error: null },
    },
  });
  await closeBrowser({ execImpl });
  // no throw = pass
});

test('closeBrowser is a no-op when no session is open', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close`]: {
      stdout: { success: false, data: null, error: 'no active session' },
    },
  });
  await closeBrowser({ execImpl });
  // no throw = pass
});

test('closeBrowser throws browser_unavailable when agent-browser is not on PATH', async () => {
  const enoent = new Error('spawn agent-browser ENOENT');
  enoent.code = 'ENOENT';
  const execImpl = async () => { throw enoent; };
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_unavailable'
  );
});

test('closeBrowser surfaces unknown failures as browser_failed', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close`]: {
      stdout: { success: false, data: null, error: 'tab crashed' },
    },
  });
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_failed' && err.message.includes('tab crashed')
  );
});

test('closeBrowser surfaces malformed JSON output', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close`]: {
      stdout: 'not json at all',
    },
  });
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_failed'
  );
});

test('closeBrowser surfaces non-zero exit (subprocess threw)', async () => {
  const subErr = new Error('Command failed with exit code 2');
  subErr.code = 2;
  subErr.stderr = 'browser config invalid';
  const execImpl = async () => { throw subErr; };
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_failed' && err.message.includes('browser config invalid')
  );
});

test('runAgentBrowser preserves caller-supplied --profile (does not double-add)', async () => {
  // Indirect test via closeBrowser with a custom args list isn't possible (no exported override).
  // Instead, we verify that closeBrowser's invocation only ever passes --profile once by checking
  // the seen args. This guards against accidental duplication during refactors.
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await closeBrowser({ execImpl });
  const profileFlagCount = seenArgs.filter((a) => a === '--profile').length;
  assert.equal(profileFlagCount, 1, `expected exactly one --profile flag, got ${profileFlagCount}: ${seenArgs.join(' ')}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: 7 failing (file doesn't exist).

- [ ] **Step 3: Implement `lib/browser.js`**

Sketch (pick any implementation that passes the tests):
- Top of file imports `node:child_process` `execFile` and `node:util` `promisify` for the default execImpl. Internal `defaultExec` is `promisify(execFile)`.
- `runAgentBrowser(args, { execImpl = defaultExec })`:
  - Merge `--profile` if absent.
  - try/catch: on ENOENT → throw `browser_unavailable`. On other thrown errors → throw `browser_failed` with stderr in message.
  - Parse stdout JSON; on parse failure → throw `browser_failed` with `Malformed JSON from agent-browser: <excerpt>`.
  - If parsed `{success: false}` and error message contains "no active session" → return null (caller decides what to do).
  - If `{success: false}` for any other reason → throw `browser_failed` with the error message.
  - Otherwise return `data`.
- `closeBrowser({ execImpl })`:
  - Calls `runAgentBrowser(['close'], { execImpl })`.
  - Swallows the "no active session" return (null is fine).

Use `makeError(code, message)` helper consistent with Plan 2.

- [ ] **Step 4: Run tests to verify they pass**

Expected: 92 + 7 = 99 passing total.

- [ ] **Step 5: Commit**

```bash
git add lib/browser.js test/browser.test.js
git commit -m "Add runAgentBrowser wrapper and closeBrowser"
```

---

### Task 3: `openLoginPage(host)` + `invalid_host` propagation

**Files:**
- Modify: `lib/browser.js`
- Modify: `test/browser.test.js`

**`openLoginPage(host, { execImpl })` behavior:**
- Normalize host using the same rules as Plan 2's `normalizeHost`. To avoid duplicating that function across modules, **extract** `normalizeHost` from `lib/retailers/shopify.js` into a new module `lib/host.js` and re-import it from both places. This is the kind of cleanup Plan 1's process notes ("designs that share code should share files") would call for.
- Build `https://<host>/`.
- Call `runAgentBrowser(['open', url], opts)`.
- Throws `invalid_host` via normalizeHost.
- Throws `browser_unavailable` / `browser_failed` via runAgentBrowser.
- Returns undefined on success.

- [ ] **Step 1: Refactor `normalizeHost` into `lib/host.js`**

Create `lib/host.js`:
```js
function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function normalizeHost(input) {
  // ... move from lib/retailers/shopify.js verbatim
}
```

In `lib/retailers/shopify.js`, replace the inline `normalizeHost` with `import { normalizeHost } from '../host.js';`.

- [ ] **Step 2: Run full suite — confirm Plan 2 tests still pass**

Expected: 99 passing (no test count change yet, just relocation).

- [ ] **Step 3: Write the failing tests for `openLoginPage`**

Append to `test/browser.test.js`:
```js
import { openLoginPage } from '../lib/browser.js';

test('openLoginPage navigates to https://<host>/', async () => {
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await openLoginPage('marinelayer.com', { execImpl });
  assert.ok(seenArgs.includes('open'), 'expected "open" in args');
  assert.ok(seenArgs.includes('https://marinelayer.com/'), `expected URL in args, got ${seenArgs.join(' ')}`);
});

test('openLoginPage normalizes host (strips protocol, path, lowercases)', async () => {
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await openLoginPage('HTTPS://MarineLayer.com/products/x', { execImpl });
  assert.ok(seenArgs.includes('https://marinelayer.com/'));
});

test('openLoginPage throws invalid_host on bad input', async () => {
  for (const bad of ['', null, undefined, 'localhost', '   ']) {
    await assert.rejects(
      () => openLoginPage(bad, { execImpl: async () => ({ stdout: '{}', stderr: '' }) }),
      (err) => err.code === 'invalid_host',
      `expected invalid_host for ${JSON.stringify(bad)}`
    );
  }
});

test('openLoginPage propagates browser_unavailable', async () => {
  const enoent = new Error('spawn agent-browser ENOENT');
  enoent.code = 'ENOENT';
  const execImpl = async () => { throw enoent; };
  await assert.rejects(
    () => openLoginPage('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_unavailable'
  );
});

test('openLoginPage propagates browser_failed when agent-browser reports failure', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} open https://marinelayer.com/`]: {
      stdout: { success: false, data: null, error: 'navigation timeout' },
    },
  });
  await assert.rejects(
    () => openLoginPage('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_failed' && err.message.includes('navigation timeout')
  );
});
```

- [ ] **Step 4: Run tests to verify they fail**

Expected: 5 failing (openLoginPage doesn't exist).

- [ ] **Step 5: Implement `openLoginPage`**

- [ ] **Step 6: Run tests to verify they pass**

Expected: 99 + 5 = 104 passing.

- [ ] **Step 7: Commit**

```bash
git add lib/host.js lib/browser.js lib/retailers/shopify.js test/browser.test.js
git commit -m "Extract normalizeHost to lib/host.js; add openLoginPage"
```

---

### Task 4: `getCookieHeader(host)` with host-matching and formatting

**Files:**
- Modify: `lib/browser.js`
- Modify: `test/browser.test.js`

**`getCookieHeader(host, { execImpl })` behavior:**
- Normalize host.
- Call `runAgentBrowser(['cookies', 'get', '--json'], opts)`.
- Filter cookies to those that apply to `https://<host>/`:
  - A cookie's `domain` matches the host if `domain === host` OR `domain === '.' + host` OR `host.endsWith('.' + domain.replace(/^\./, ''))` (host is a subdomain of the cookie's domain).
- Sort by `name` (deterministic output) — important for tests.
- Format as standard Cookie header: `name1=value1; name2=value2`.
- Return the string. If no cookies match, return `null` (not empty string — explicit "no session").
- Cookies must NOT be filtered by expiry — agent-browser only returns active cookies.

- [ ] **Step 1: Write the failing tests**

```js
import { getCookieHeader } from '../lib/browser.js';

function cookiesPayload(...cookies) {
  return { success: true, data: { cookies }, error: null };
}

test('getCookieHeader returns name=value pairs joined by "; "', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(
        { name: 'cart', value: 'abc123', domain: 'marinelayer.com' },
        { name: '_shopify_y', value: 'def456', domain: '.marinelayer.com' }
      ),
    },
  });
  const cookie = await getCookieHeader('marinelayer.com', { execImpl });
  assert.equal(cookie, '_shopify_y=def456; cart=abc123');
});

test('getCookieHeader returns null when no cookies match', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'x', value: 'y', domain: 'other.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), null);
});

test('getCookieHeader returns null when cookies array is empty', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), null);
});

test('getCookieHeader matches leading-dot domain (.marinelayer.com applies to marinelayer.com)', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'session', value: 'xyz', domain: '.marinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), 'session=xyz');
});

test('getCookieHeader matches when host is a subdomain of cookie domain', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'session', value: 'xyz', domain: 'marinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('shop.marinelayer.com', { execImpl }), 'session=xyz');
});

test('getCookieHeader does NOT match unrelated domain', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'session', value: 'xyz', domain: 'evilmarinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), null);
});

test('getCookieHeader is deterministic (sorted by name)', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(
        { name: 'zeta', value: '1', domain: 'marinelayer.com' },
        { name: 'alpha', value: '2', domain: 'marinelayer.com' },
        { name: 'beta', value: '3', domain: 'marinelayer.com' }
      ),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), 'alpha=2; beta=3; zeta=1');
});

test('getCookieHeader throws invalid_host on bad input', async () => {
  await assert.rejects(
    () => getCookieHeader('', { execImpl: async () => ({ stdout: '{}', stderr: '' }) }),
    (err) => err.code === 'invalid_host'
  );
});

test('getCookieHeader propagates browser_failed when cookies get fails', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: { success: false, data: null, error: 'no active page' },
    },
  });
  await assert.rejects(
    () => getCookieHeader('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_failed'
  );
});

test('getCookieHeader handles cookie values that contain special chars (no over-encoding)', async () => {
  // Cookie header spec says values can contain any printable ASCII except control chars,
  // double-quote, comma, semicolon, backslash. We trust agent-browser to return values
  // that are already valid; we do NOT URL-encode them (browsers send raw values).
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'sid', value: 'abc%3D%2F', domain: 'marinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), 'sid=abc%3D%2F');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: 10 failing.

- [ ] **Step 3: Implement `getCookieHeader`**

Implementation hints (not binding):
- Helper `cookieAppliesToHost(cookieDomain, host)`:
  - Normalize cookieDomain: strip leading dot.
  - Return `host === cookieDomain || host.endsWith('.' + cookieDomain)`.
- Sort cookies by `name` before joining.
- Map to `name=value`, join with `; `.

- [ ] **Step 4: Run tests to verify they pass**

Expected: 104 + 10 = 114 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/browser.js test/browser.test.js
git commit -m "Add getCookieHeader with host-matching and deterministic sort"
```

---

### Task 5: `isLoggedIn(host)` — heuristic check

**Files:**
- Modify: `lib/browser.js`
- Modify: `test/browser.test.js`

**`isLoggedIn(host, { execImpl })` behavior:**
- Calls `getCookieHeader(host, opts)`.
- Returns `true` if it returned a non-null, non-empty string.
- Returns `false` otherwise.
- Errors from `getCookieHeader` propagate (don't swallow `invalid_host`, etc.).

This is intentionally a thin wrapper — the real-world definition of "logged in" varies by retailer, and Plan 5's UI can layer richer checks (e.g., "did `addToCart` return auth_required?") on top. For now: cookies present ≈ logged in.

- [ ] **Step 1: Write the failing tests**

```js
import { isLoggedIn } from '../lib/browser.js';

test('isLoggedIn returns true when cookies are present', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 's', value: 'x', domain: 'marinelayer.com' }),
    },
  });
  assert.equal(await isLoggedIn('marinelayer.com', { execImpl }), true);
});

test('isLoggedIn returns false when no cookies', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(),
    },
  });
  assert.equal(await isLoggedIn('marinelayer.com', { execImpl }), false);
});

test('isLoggedIn returns false when only unrelated-domain cookies', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 's', value: 'x', domain: 'other.com' }),
    },
  });
  assert.equal(await isLoggedIn('marinelayer.com', { execImpl }), false);
});

test('isLoggedIn propagates invalid_host', async () => {
  await assert.rejects(
    () => isLoggedIn('', { execImpl: async () => ({ stdout: '{}', stderr: '' }) }),
    (err) => err.code === 'invalid_host'
  );
});

test('isLoggedIn propagates browser_failed', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: { success: false, data: null, error: 'oops' },
    },
  });
  await assert.rejects(
    () => isLoggedIn('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_failed'
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: 5 failing.

- [ ] **Step 3: Implement `isLoggedIn`**

One-liner: `const cookie = await getCookieHeader(host, opts); return cookie != null && cookie.length > 0;`

- [ ] **Step 4: Run tests to verify they pass**

Expected: 114 + 5 = 119 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/browser.js test/browser.test.js
git commit -m "Add isLoggedIn heuristic"
```

---

### Task 6: Live smoke script `test/live-browser.js` + `npm run smoke:browser`

**Files:**
- Create: `test/live-browser.js`
- Modify: `package.json`

This script is run manually. It exercises the full real path: open browser, prompt user to log in, dump cookies. It is NOT part of `npm test` (it requires a real browser and human interaction).

- [ ] **Step 1: Write the smoke script**

```js
#!/usr/bin/env node
// Live smoke for browser session. Run manually:
//   npm run smoke:browser
// Opens a real browser to marinelayer.com, prompts for login, then dumps cookies.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openLoginPage, getCookieHeader, isLoggedIn, closeBrowser } from '../lib/browser.js';
import { browserProfilePath } from '../lib/paths.js';

const HOST = 'marinelayer.com';

async function main() {
  console.log(`Browser profile: ${browserProfilePath()}`);

  console.log(`\nChecking existing login state...`);
  let logged = await isLoggedIn(HOST);
  console.log(`  isLoggedIn(${HOST}) → ${logged}`);

  if (!logged) {
    console.log(`\nOpening browser to https://${HOST}/`);
    await openLoginPage(HOST);
    const rl = readline.createInterface({ input: stdin, output: stdout });
    await rl.question(`\nLog in to ${HOST} in the browser, then press Enter here... `);
    rl.close();
  }

  console.log(`\nFetching cookies...`);
  const cookie = await getCookieHeader(HOST);
  if (cookie) {
    console.log(`  cookie length: ${cookie.length}`);
    console.log(`  first 100 chars: ${cookie.slice(0, 100)}`);
    console.log(`  cookies: ${cookie.split('; ').length}`);
  } else {
    console.log('  no cookies for host');
  }

  logged = await isLoggedIn(HOST);
  console.log(`\n  isLoggedIn(${HOST}) → ${logged}`);

  console.log('\nClosing browser...');
  await closeBrowser();

  console.log('\nLive browser smoke OK.');
}

main().catch((err) => {
  console.error('Live browser smoke FAILED:', err.message);
  if (err.code) console.error('  code:', err.code);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

`package.json`:
```json
"smoke:browser": "node test/live-browser.js"
```

- [ ] **Step 3: Run it to verify wiring (don't expect login completion in automation)**

Run: `npm run smoke:browser` — this will open a browser and wait for Enter. The implementer should run this far enough to confirm the browser actually opens and the script reaches the readline prompt, then ^C. The full manual flow is left to the human reviewer.

- [ ] **Step 4: Confirm full test suite still passes**

Expected: 119 passing.

- [ ] **Step 5: Commit**

```bash
git add test/live-browser.js package.json
git commit -m "Add live browser smoke script"
```

---

### Task 7: README + version bump + CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README status line**

Change to: `**Status:** v0.3.0 — profile, Shopify handler, and browser-session library. The `/cart` slash command (Plan 5) is the next milestone.`

- [ ] **Step 2: Bump versions**

`package.json` and `.claude-plugin/plugin.json` → `"version": "0.3.0"`.

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.3.0 — 2026-05-10

Adds the browser-session library. Pure Node wrapping the `agent-browser` CLI
with dependency-injected exec for mock-tested unit coverage plus a manual
smoke script that drives a real browser.

- New `lib/browser.js`: `openLoginPage`, `getCookieHeader`, `isLoggedIn`,
  `closeBrowser`. Persistent profile at `~/.claude/cart/browser-profile/`.
- New `lib/host.js`: shared `normalizeHost` extracted from `lib/retailers/shopify.js`.
- New `npm run smoke:browser` for manual end-to-end login verification.

Not yet wired up: the `/cart` flow (Plan 5) is what calls these.
```

- [ ] **Step 4: Run full suite**

Expected: 119 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.3.0 — browser session library"
git push origin main
```

---

## Self-review checklist

- [ ] All 7 tasks committed.
- [ ] `npm test` shows 119 passing.
- [ ] `npm run smoke:browser` was actually run by a human against marinelayer.com (or another Shopify site) and `getCookieHeader` returned a non-trivial Cookie string.
- [ ] No `invalid_host` handling lives in two places (Plan 2's shopify.js delegates to lib/host.js).
- [ ] `--profile` flag appears exactly once on every agent-browser invocation.
- [ ] Version is 0.3.0 in package.json AND plugin.json.
- [ ] CHANGELOG entry accurate.

## Final review

After all tasks, dispatch a code-quality reviewer over `lib/browser.js`, `lib/host.js`, and the diff in `lib/retailers/shopify.js`. The reviewer should specifically check:
- The `runAgentBrowser` "swallow no-active-session" branch is exercised by tests.
- No string-matching on stderr for fragile detection (the "no active session" check is the one allowed instance; document it).
- Cookie host-matching handles the leading-dot domain case correctly.
- `closeBrowser` is genuinely idempotent (closing twice doesn't throw).
