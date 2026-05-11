# Plan 2 — Shopify Handler Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a generic Shopify Tier-2 handler (`lib/retailers/shopify.js`) that implements `search`, `fetchVariants`, `addToCart`, `cartUrl`, and `detect` against documented Shopify endpoints, plus a shared HTTP utility (`lib/http.js`). Pure Node, dependency-injected fetch, fully mock-tested, plus a live smoke script validated against marinelayer.com.

**Architecture:** Stateless pure functions, no classes or factories. Each function takes `host` (or full `productUrl`) as input — the same module handles any Shopify retailer. Native `fetch` (Node 20+) with `{fetchImpl}` injection so unit tests pass a fake. No browser, no slash command, no profile integration in this plan — Plan 5 wires those.

**Tech Stack:** Node 20+ ESM, native `fetch`, `node:test`. No new dependencies.

---

## Context for the implementer

This plan extends `superpowers-for-shopping`, currently at v0.1.0 (Plan 1 shipped — profile data layer + `/cart-setup`). Read first:

1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — canonical record of what's already in the repo, plus process notes at the bottom that apply to this plan.
2. `docs/specs/2026-05-10-superpowers-for-shopping-design.md` Sections 4–5 (retailer tiering and search surface).

Process rules carried over from Plan 1 (all enforced by review):

- **Spec behavior, not implementation, for parsers.** Don't paste regex into code blocks here. The plan describes what each function must accept; tests pin the behavior.
- **Adversarial-input tests live in the original task, not a hardening patch.** Every function that takes user/network input gets "what if input contains separator/missing field/wrong type/HTML-where-JSON-expected" coverage in the same task that implements it.
- **Validate at the boundary.** Public functions reject bad input with clear errors; internal helpers trust their callers.
- **Bundle related mechanical TDD work.** Each task ships one function plus its full happy-path + adversarial test coverage in a single subagent dispatch.
- **Imports resolve at parse time.** Don't import a symbol from a module that doesn't export it yet — ESM resolves at parse time, not lazily.

## What's not in this plan

- No `/cart-add-retailer` or any slash command (Plan 5).
- No agent-browser integration — `addToCart` accepts an opaque `cookie` string that Plan 3 will obtain from the persistent browser session.
- No `retailers.md` storage layer (Plan 6).
- No `schema_version` field on profile (deferred until profile shape actually changes).
- No `_raw` debug field on results (YAGNI — add when a debugger actually needs it).

## File structure

| File | Responsibility | LOC budget |
|---|---|---|
| `lib/http.js` | JSON GET/POST helpers with consistent error wrapping. Detects HTML-where-JSON-expected (Shopify login redirect). Accepts injected `fetchImpl`. | ~60 |
| `lib/retailers/shopify.js` | The five public functions plus internal `normalizeHost`. Imports from `lib/http.js`. | ~180 |
| `test/http.test.js` | Unit tests for `lib/http.js`. | ~120 |
| `test/retailers/shopify.test.js` | Unit tests for the handler. | ~350 |
| `test/live-marinelayer.js` | Manual smoke script, not run by `npm test`. | ~80 |

Existing files that get touched:
- `package.json` — add `"smoke:live"` script; bump version at the end of the plan.
- `README.md` — flip status from "v0.1.0 — profile setup only" to "v0.2.0 — Shopify handler library available".

## API surface (final)

```js
// lib/http.js
export async function httpGetJson(url, { fetchImpl = fetch, headers } = {});
export async function httpPostJson(url, body, { fetchImpl = fetch, headers } = {});

// lib/retailers/shopify.js
export async function detect(host, { fetchImpl = fetch } = {});      // → boolean
export async function search(host, query, { fetchImpl = fetch, limit = 50 } = {});
                                                                      // → [{url, image, brand, price, title, variants}]
export async function fetchVariants(productUrl, { fetchImpl = fetch } = {});
                                                                      // → [{size, color, in_stock, variant_id}]
export async function addToCart({ host, variantId, cookie, fetchImpl = fetch });
                                                                      // → {ok: true} | {ok: false, error: string}
export function cartUrl(host);                                        // → string
```

Internal (not exported): `normalizeHost(input)` — accepts `marinelayer.com`, `https://marinelayer.com`, `https://marinelayer.com/`, `marinelayer.com/some/path` and returns just `marinelayer.com`.

## Test strategy

All unit tests pass a fake `fetchImpl` — a function `(url, init) → Promise<Response-like>` returning `{ok, status, headers: { get(name) }, text(), json() }`. No `nock`, no global patching. Each test constructs exactly the response shape it needs.

A small helper in `test/retailers/shopify.test.js`:

```js
function mockFetch(routes) {
  return async (url, init) => {
    const route = routes[url] || routes[new URL(url).pathname + new URL(url).search];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    if (typeof route === 'function') return route(url, init);
    return makeResponse(route);
  };
}
function makeResponse({ status = 200, body = '', contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}
```

These helpers live at the top of `test/retailers/shopify.test.js` and are duplicated minimally in `test/http.test.js` (do not over-share — these are test fixtures, not production code).

---

## Tasks

### Task 1: Scaffold `lib/retailers/` and the smoke import test

**Files:**
- Create: `lib/retailers/shopify.js` (skeleton with no real exports yet)
- Create: `test/retailers/shopify.test.js`

This task exists to confirm the directory + ESM imports work in isolation before piling features on. Plan 1 lost a day to ESM ordering bugs because we skipped this step.

- [ ] **Step 1: Write the failing test**

```js
// test/retailers/shopify.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as shopify from '../../lib/retailers/shopify.js';

test('shopify module loads', () => {
  assert.equal(typeof shopify, 'object');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern='shopify module loads'`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` (the file doesn't exist yet).

- [ ] **Step 3: Create the skeleton module**

```js
// lib/retailers/shopify.js
// Plan 2 entry point. Functions added in subsequent tasks.
export {};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern='shopify module loads'`
Expected: PASS.

- [ ] **Step 5: Run the whole suite to confirm no regression**

Run: `npm test`
Expected: 30 (Plan 1) + 1 (this) = 31 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/retailers/shopify.js test/retailers/shopify.test.js
git commit -m "Scaffold Shopify retailer module"
```

---

### Task 2: `lib/http.js` — JSON GET/POST helpers with HTML-as-JSON detection

**Files:**
- Create: `lib/http.js`
- Create: `test/http.test.js`

Why a dedicated helper: every Shopify call goes through it, the error-wrapping logic is non-trivial (status, URL, response excerpt), and Shopify *specifically* returns an HTML login page when you hit a JSON endpoint without auth — we want one place that detects that and throws a typed error rather than a confusing `JSON.parse` failure.

**API:**
- `httpGetJson(url, { fetchImpl, headers })` — returns parsed JSON on 2xx with JSON content-type. Throws otherwise.
- `httpPostJson(url, body, { fetchImpl, headers })` — POSTs `JSON.stringify(body)` with `Content-Type: application/json`. Same response handling as GET.

**Errors thrown:** plain `Error` objects with `.code` and `.status` and `.url` properties:
- `code: 'http_error'` — non-2xx response. `.status` set.
- `code: 'not_json'` — 2xx but content-type isn't JSON (Shopify auth-redirect case).
- `code: 'invalid_json'` — content-type claimed JSON but body didn't parse.
- `code: 'network_error'` — `fetchImpl` itself threw.

Every error message includes the URL (sanitized — strip query params) and, for `http_error` and `not_json`, the first 200 chars of the response body for debuggability.

- [ ] **Step 1: Write the failing tests (all at once — TDD applied per file, not per assertion)**

```js
// test/http.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { httpGetJson, httpPostJson } from '../lib/http.js';

function makeResponse({ status = 200, body = '', contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

test('httpGetJson returns parsed body on 200 + application/json', async () => {
  const fetchImpl = async () => makeResponse({ body: { hello: 'world' } });
  const result = await httpGetJson('https://example.com/x', { fetchImpl });
  assert.deepEqual(result, { hello: 'world' });
});

test('httpGetJson throws http_error on 404', async () => {
  const fetchImpl = async () => makeResponse({ status: 404, body: 'Not Found', contentType: 'text/plain' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'http_error' && err.status === 404 && err.url.includes('example.com')
  );
});

test('httpGetJson throws not_json on 200 + text/html (Shopify auth redirect)', async () => {
  const fetchImpl = async () => makeResponse({ body: '<html>login</html>', contentType: 'text/html' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'not_json'
  );
});

test('httpGetJson throws invalid_json when content-type lies', async () => {
  const fetchImpl = async () => makeResponse({ body: 'not json{{{', contentType: 'application/json' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'invalid_json'
  );
});

test('httpGetJson wraps network errors as network_error', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'network_error' && err.message.includes('ECONNREFUSED')
  );
});

test('httpGetJson strips query params from error URL', async () => {
  const fetchImpl = async () => makeResponse({ status: 500, body: 'oops' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x?q=secret-token', { fetchImpl }),
    (err) => !err.url.includes('secret-token') && err.url.includes('/x')
  );
});

test('httpGetJson includes 200-char body excerpt in http_error', async () => {
  const longBody = 'A'.repeat(500);
  const fetchImpl = async () => makeResponse({ status: 500, body: longBody });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.message.length < 500 && err.message.includes('AAA')
  );
});

test('httpGetJson passes custom headers through', async () => {
  let seenInit;
  const fetchImpl = async (url, init) => { seenInit = init; return makeResponse({ body: {} }); };
  await httpGetJson('https://example.com/x', { fetchImpl, headers: { Cookie: 'sess=abc' } });
  assert.equal(seenInit.headers.Cookie, 'sess=abc');
});

test('httpPostJson sends JSON.stringify(body) with content-type', async () => {
  let seenInit;
  const fetchImpl = async (url, init) => { seenInit = init; return makeResponse({ body: { ok: true } }); };
  const result = await httpPostJson('https://example.com/cart/add.js', { id: 42, quantity: 1 }, { fetchImpl });
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers['Content-Type'], 'application/json');
  assert.equal(seenInit.body, JSON.stringify({ id: 42, quantity: 1 }));
  assert.deepEqual(result, { ok: true });
});

test('httpPostJson surfaces 422 with parsed body in error', async () => {
  const fetchImpl = async () => makeResponse({ status: 422, body: { description: 'Out of stock' } });
  await assert.rejects(
    () => httpPostJson('https://example.com/cart/add.js', {}, { fetchImpl }),
    (err) => err.code === 'http_error' && err.status === 422 && err.message.includes('Out of stock')
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/http.test.js`
Expected: 10 failing tests (the module doesn't exist).

- [ ] **Step 3: Implement `lib/http.js`**

Behavior:
- Wrap `fetchImpl(url, init)` in try/catch. On thrown error, raise `{ code: 'network_error' }` preserving the original message.
- After fetch resolves: if not `ok`, raise `http_error` with `.status`, `.url`, and a message including the response body excerpt (first 200 chars).
- Check `Content-Type` header. If `ok` but content-type doesn't start with `application/json`, raise `not_json` with body excerpt.
- Otherwise call `.json()`; if it throws, raise `invalid_json`.
- Error URL field strips query string: parse the URL, return `${origin}${pathname}`.
- `httpPostJson` is `httpGetJson` plus `method: 'POST'`, `body: JSON.stringify(body)`, and the JSON content-type header merged into the caller's headers.

Implementation details are NOT pinned in this plan — pick whatever satisfies the tests. Keep it small.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/http.test.js`
Expected: 10 passing.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 31 + 10 = 41 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/http.js test/http.test.js
git commit -m "Add lib/http.js with JSON helpers and typed error codes"
```

---

### Task 3: `normalizeHost` + `detect(host)`

**Files:**
- Modify: `lib/retailers/shopify.js`
- Modify: `test/retailers/shopify.test.js`

`normalizeHost` is the boundary input sanitizer for every public function. `detect` is the first real piece of behavior. Bundled because they share input-handling tests.

**`normalizeHost(input)` behavior:**
- Returns just the host (no protocol, no port, no path, no trailing slash, lowercased).
- Accepts: `marinelayer.com`, `https://marinelayer.com`, `http://marinelayer.com/`, `MarineLayer.com`, `https://marinelayer.com/products`, `marinelayer.com/products/abc`.
- Rejects (throws `Error` with `code: 'invalid_host'`): empty string, `null`, `undefined`, strings with no dots (`localhost` is intentionally rejected — we are not testing Shopify on localhost), strings with whitespace, strings starting with `.`.

**`detect(host, { fetchImpl })` behavior:**
- Step 1: `httpGetJson` is wrong here (homepage is HTML). Use the bare `fetchImpl` to GET `https://${normalized}/` and read `.text()`. If the body contains `cdn.shopify.com` OR `cdn/shop/`, continue. Otherwise return `false`.
- Step 2: `httpGetJson` to `https://${normalized}/products.json?limit=1`. If it returns an object with a `products` array, return `true`. Otherwise return `false`.
- Any thrown error from either step (network, http_error, not_json) → return `false`. `detect` never throws on network/protocol failures; it only throws when called with invalid input (via `normalizeHost`).
- `invalid_host` from `normalizeHost` is allowed to propagate.

- [ ] **Step 1: Write the failing tests**

Append to `test/retailers/shopify.test.js`:

```js
import { detect } from '../../lib/retailers/shopify.js';

// --- normalizeHost behavior (tested via detect, since normalizeHost isn't exported) ---

test('detect: accepts bare hostname', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: '<html>cdn.shopify.com</html>', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('marinelayer.com', { fetchImpl }), true);
});

test('detect: strips protocol', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('https://marinelayer.com', { fetchImpl }), true);
});

test('detect: strips trailing slash and path', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: 'cdn/shop/', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('https://marinelayer.com/products/abc', { fetchImpl }), true);
});

test('detect: lowercases', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('MarineLayer.com', { fetchImpl }), true);
});

test('detect: throws invalid_host on empty / null / no dot / whitespace', async () => {
  for (const bad of ['', '   ', null, undefined, 'localhost', '.com', 'mar ine.com']) {
    await assert.rejects(
      () => detect(bad, { fetchImpl: async () => { throw new Error('should not fetch'); } }),
      (err) => err.code === 'invalid_host',
      `expected invalid_host for ${JSON.stringify(bad)}`
    );
  }
});

// --- detect behavior ---

test('detect: returns true when markers present and products.json works', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: '<html>cdn.shopify.com</html>', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [{ id: 1 }] } },
  });
  assert.equal(await detect('marinelayer.com', { fetchImpl }), true);
});

test('detect: returns false when no Shopify markers in HTML', async () => {
  const fetchImpl = mockFetch({
    'https://example.com/': { body: '<html>nothing here</html>', contentType: 'text/html' },
  });
  assert.equal(await detect('example.com', { fetchImpl }), false);
});

test('detect: returns false when markers present but products.json 404s', async () => {
  const fetchImpl = mockFetch({
    'https://example.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://example.com/products.json?limit=1': { status: 404, body: 'Not Found', contentType: 'text/plain' },
  });
  assert.equal(await detect('example.com', { fetchImpl }), false);
});

test('detect: returns false when products.json returns wrong shape', async () => {
  const fetchImpl = mockFetch({
    'https://example.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://example.com/products.json?limit=1': { body: { not_products: [] } },
  });
  assert.equal(await detect('example.com', { fetchImpl }), false);
});

test('detect: returns false on network error', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await detect('marinelayer.com', { fetchImpl }), false);
});

test('detect: accepts cdn/shop/ marker as alternative to cdn.shopify.com', async () => {
  const fetchImpl = mockFetch({
    'https://newstore.com/': { body: '<link href="/cdn/shop/files/logo.png">', contentType: 'text/html' },
    'https://newstore.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('newstore.com', { fetchImpl }), true);
});
```

Also append the `mockFetch` / `makeResponse` helpers at the top of the file (just below the existing import — these will be reused by every later test in this file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/retailers/shopify.test.js`
Expected: 11 failing (`detect` not exported).

- [ ] **Step 3: Implement `normalizeHost` and `detect`**

`normalizeHost`:
- If not a non-empty string → throw `invalid_host`.
- Strip `^https?://` and any path/query (split on `/`, take first segment).
- Trim. Lowercase. Reject whitespace inside. Reject no-dot. Reject leading dot.

`detect`:
- `normalizeHost` first.
- Step 1: `await fetchImpl(\`https://${host}/\`)`, read `.text()`, check for either marker substring. Wrap in try/catch — on any error, return `false`.
- Step 2: `httpGetJson(\`https://${host}/products.json?limit=1\`, { fetchImpl })`, check `result?.products` is `Array.isArray`. Wrap in try/catch — on any error, return `false`.
- Return `true` only if both pass.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/retailers/shopify.test.js`
Expected: 1 (scaffold) + 11 (this task) = 12 passing.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 42 + 11 = 52 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/retailers/shopify.js test/retailers/shopify.test.js
git commit -m "Add normalizeHost + detect for Shopify retailers"
```

---

### Task 4: `search(host, query, opts)` with normalization and adversarial coverage

**Files:**
- Modify: `lib/retailers/shopify.js`
- Modify: `test/retailers/shopify.test.js`

**`search(host, query, { fetchImpl, limit = 50 })` behavior:**
- `host` goes through `normalizeHost`.
- Empty/whitespace `query` → throw `Error` with `code: 'invalid_query'`. (No silent "search everything" fallback.)
- URL-encode the query (`encodeURIComponent`).
- GET `https://${host}/products.json?q=${encoded}&limit=${limit}`.
- For each product in response, return:
  ```
  {
    url:    `https://${host}/products/${product.handle}`,
    image:  product.images?.[0]?.src ?? null,
    brand:  product.vendor ?? null,
    title:  product.title ?? null,
    price:  product.variants?.[0]?.price ?? null,   // string, e.g. "98.00", or null
    variants: [{ size, color, in_stock, variant_id }, ...],
  }
  ```
- `size` and `color` come from `option1` / `option2` — but Shopify doesn't tell us which axis is which. **Heuristic:** if the product has `options: [{name: 'Size', position: 1}, ...]`, use that to assign. If no `options` metadata, default to `option1 → size, option2 → color` and document this.
- A variant's `in_stock` is `variant.available === true`.
- `variant_id` is `variant.id`.
- A product with no variants → empty `variants: []`. Still included in the result.
- A product with missing `handle` → drop the product (we can't build a URL). Log nothing — silent drop is fine, this is rare.
- Returns empty array if Shopify returns `{ products: [] }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/retailers/shopify.test.js`:

```js
import { search } from '../../lib/retailers/shopify.js';

const SAMPLE_PRODUCT = {
  id: 100,
  handle: 'crew-sweater',
  title: 'Crew Neck Sweater',
  vendor: 'Marine Layer',
  images: [{ src: 'https://cdn.shopify.com/.../crew.jpg' }],
  options: [
    { name: 'Size', position: 1 },
    { name: 'Color', position: 2 },
  ],
  variants: [
    { id: 1001, option1: 'M', option2: 'Navy', price: '98.00', available: true },
    { id: 1002, option1: 'L', option2: 'Navy', price: '98.00', available: false },
  ],
};

test('search: normalizes product into spec shape', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=sweater&limit=50': { body: { products: [SAMPLE_PRODUCT] } },
  });
  const results = await search('marinelayer.com', 'sweater', { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://marinelayer.com/products/crew-sweater');
  assert.equal(results[0].brand, 'Marine Layer');
  assert.equal(results[0].title, 'Crew Neck Sweater');
  assert.equal(results[0].price, '98.00');
  assert.equal(results[0].image, 'https://cdn.shopify.com/.../crew.jpg');
  assert.equal(results[0].variants.length, 2);
  assert.deepEqual(results[0].variants[0], { size: 'M', color: 'Navy', in_stock: true, variant_id: 1001 });
  assert.deepEqual(results[0].variants[1], { size: 'L', color: 'Navy', in_stock: false, variant_id: 1002 });
});

test('search: URL-encodes query with spaces and special chars', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return makeResponse({ body: { products: [] } }); };
  await search('marinelayer.com', 'navy & cream', { fetchImpl });
  assert.match(seenUrl, /q=navy%20%26%20cream/);
});

test('search: respects custom limit', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return makeResponse({ body: { products: [] } }); };
  await search('marinelayer.com', 'x', { fetchImpl, limit: 10 });
  assert.match(seenUrl, /limit=10/);
});

test('search: returns empty array on no results', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=xyz&limit=50': { body: { products: [] } },
  });
  assert.deepEqual(await search('marinelayer.com', 'xyz', { fetchImpl }), []);
});

test('search: throws invalid_query on empty / whitespace', async () => {
  const fetchImpl = async () => { throw new Error('should not fetch'); };
  for (const bad of ['', '   ', '\t']) {
    await assert.rejects(
      () => search('marinelayer.com', bad, { fetchImpl }),
      (err) => err.code === 'invalid_query'
    );
  }
});

test('search: throws invalid_host on bad host', async () => {
  await assert.rejects(
    () => search('', 'sweater', { fetchImpl: async () => ({}) }),
    (err) => err.code === 'invalid_host'
  );
});

test('search: drops products with missing handle', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': {
      body: { products: [SAMPLE_PRODUCT, { id: 999, title: 'No Handle' }] },
    },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results.length, 1);
});

test('search: handles product with no images (image: null)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': {
      body: { products: [{ ...SAMPLE_PRODUCT, images: [] }] },
    },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].image, null);
});

test('search: handles product with no variants (variants: [], price: null)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': {
      body: { products: [{ ...SAMPLE_PRODUCT, variants: [] }] },
    },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.deepEqual(results[0].variants, []);
  assert.equal(results[0].price, null);
});

test('search: when options metadata says color-first, swaps axis assignment', async () => {
  const colorFirstProduct = {
    ...SAMPLE_PRODUCT,
    options: [{ name: 'Color', position: 1 }, { name: 'Size', position: 2 }],
    variants: [{ id: 1, option1: 'Navy', option2: 'M', price: '98.00', available: true }],
  };
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { body: { products: [colorFirstProduct] } },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].variants[0].size, 'M');
  assert.equal(results[0].variants[0].color, 'Navy');
});

test('search: when options metadata absent, defaults to option1=size option2=color', async () => {
  const noMetaProduct = { ...SAMPLE_PRODUCT, options: undefined };
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { body: { products: [noMetaProduct] } },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].variants[0].size, 'M');
  assert.equal(results[0].variants[0].color, 'Navy');
});

test('search: propagates http_error on 5xx (does not swallow like detect)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { status: 500, body: 'server error', contentType: 'text/plain' },
  });
  await assert.rejects(
    () => search('marinelayer.com', 'x', { fetchImpl }),
    (err) => err.code === 'http_error'
  );
});

test('search: handles price as numeric (not string) by stringifying', async () => {
  const numericPriceProduct = {
    ...SAMPLE_PRODUCT,
    variants: [{ id: 1, option1: 'M', option2: 'Navy', price: 98, available: true }],
  };
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { body: { products: [numericPriceProduct] } },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].price, '98');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/retailers/shopify.test.js`
Expected: 13 failing (`search` not exported).

- [ ] **Step 3: Implement `search`**

Sketch (do not paste verbatim — pick implementation that passes the tests):
- Validate inputs (host via `normalizeHost`, query non-empty).
- Build URL.
- Call `httpGetJson`.
- Map products → normalized shape, dropping handle-less ones.
- For each variant, look up the `options` metadata to determine which `optionN` is `size` vs `color`. Default mapping if metadata missing.

Internal helper `normalizeProduct(host, product)` is fine; keep it private to the module.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/retailers/shopify.test.js`
Expected: 12 + 13 = 25 passing.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 52 + 13 = 65 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/retailers/shopify.js test/retailers/shopify.test.js
git commit -m "Add Shopify product search with axis-aware variant normalization"
```

---

### Task 5: `fetchVariants(productUrl)` + `cartUrl(host)`

**Files:**
- Modify: `lib/retailers/shopify.js`
- Modify: `test/retailers/shopify.test.js`

Bundled because both are small. `cartUrl` is a one-liner; `fetchVariants` reuses the variant-normalization helper from Task 4.

**`fetchVariants(productUrl, { fetchImpl })` behavior:**
- Parse `productUrl` with `new URL()`. Throw `invalid_product_url` on parse failure, missing hostname, or path that doesn't match `/products/<handle>` (with optional trailing slash or query).
- GET `https://${host}/products/${handle}.json`.
- Returns the normalized `variants` array from the single product.

**`cartUrl(host)` behavior:**
- Normalize host. Return `https://${host}/cart`.

- [ ] **Step 1: Write the failing tests**

Append:

```js
import { fetchVariants, cartUrl } from '../../lib/retailers/shopify.js';

test('cartUrl: builds cart URL from bare host', () => {
  assert.equal(cartUrl('marinelayer.com'), 'https://marinelayer.com/cart');
});

test('cartUrl: normalizes input (protocol, path, case)', () => {
  assert.equal(cartUrl('HTTPS://MarineLayer.com/products/x'), 'https://marinelayer.com/cart');
});

test('cartUrl: throws invalid_host on bad input', () => {
  assert.throws(() => cartUrl(''), (err) => err.code === 'invalid_host');
});

test('fetchVariants: returns variants from product JSON', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products/crew-sweater.json': {
      body: {
        product: {
          ...SAMPLE_PRODUCT,
          handle: 'crew-sweater',
        },
      },
    },
  });
  const variants = await fetchVariants('https://marinelayer.com/products/crew-sweater', { fetchImpl });
  assert.equal(variants.length, 2);
  assert.deepEqual(variants[0], { size: 'M', color: 'Navy', in_stock: true, variant_id: 1001 });
});

test('fetchVariants: handles trailing slash on URL', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products/crew-sweater.json': {
      body: { product: { ...SAMPLE_PRODUCT, handle: 'crew-sweater' } },
    },
  });
  const variants = await fetchVariants('https://marinelayer.com/products/crew-sweater/', { fetchImpl });
  assert.equal(variants.length, 2);
});

test('fetchVariants: throws invalid_product_url on missing /products/ segment', async () => {
  await assert.rejects(
    () => fetchVariants('https://marinelayer.com/collections/all', { fetchImpl: async () => ({}) }),
    (err) => err.code === 'invalid_product_url'
  );
});

test('fetchVariants: throws invalid_product_url on unparseable input', async () => {
  for (const bad of ['', 'not a url', 'http://', 'https://marinelayer.com/products/']) {
    await assert.rejects(
      () => fetchVariants(bad, { fetchImpl: async () => ({}) }),
      (err) => err.code === 'invalid_product_url',
      `expected invalid_product_url for ${JSON.stringify(bad)}`
    );
  }
});

test('fetchVariants: throws http_error on 404 (handle not found)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products/no-such.json': { status: 404, body: 'Not Found', contentType: 'text/plain' },
  });
  await assert.rejects(
    () => fetchVariants('https://marinelayer.com/products/no-such', { fetchImpl }),
    (err) => err.code === 'http_error' && err.status === 404
  );
});

test('fetchVariants: handles product with no variants (returns [])', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products/empty.json': {
      body: { product: { ...SAMPLE_PRODUCT, handle: 'empty', variants: [] } },
    },
  });
  assert.deepEqual(await fetchVariants('https://marinelayer.com/products/empty', { fetchImpl }), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/retailers/shopify.test.js`
Expected: 9 failing.

- [ ] **Step 3: Implement both functions**

- [ ] **Step 4: Run tests to verify they pass**

Expected: 25 + 9 = 34 passing in shopify.test.js.

- [ ] **Step 5: Run full suite**

Expected: 65 + 9 = 74 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/retailers/shopify.js test/retailers/shopify.test.js
git commit -m "Add fetchVariants and cartUrl"
```

---

### Task 6: `addToCart({host, variantId, cookie})` with 422/auth/network coverage

**Files:**
- Modify: `lib/retailers/shopify.js`
- Modify: `test/retailers/shopify.test.js`

**`addToCart({ host, variantId, cookie, fetchImpl })` behavior:**
- Normalize host. Validate `variantId` is an integer or integer-string (Shopify variant IDs are 64-bit integers, sometimes received as strings — coerce safely). Reject non-numeric.
- Require non-empty `cookie` string.
- POST `https://${host}/cart/add.js` with body `{ id: Number(variantId), quantity: 1 }`, headers `Cookie: <cookie>` (Content-Type is added by `httpPostJson`).
- On 2xx: return `{ ok: true }`.
- On 422 (out of stock): return `{ ok: false, error: 'out_of_stock' }` — recoverable.
- On 401/403, OR on `not_json` (Shopify returns the login HTML page when session expired): return `{ ok: false, error: 'authentication_required' }`.
- On other `http_error`: return `{ ok: false, error: 'http_<status>' }`.
- On `network_error`: return `{ ok: false, error: 'network' }`.
- `invalid_host` / `invalid_variant_id` / `invalid_cookie` throw (caller bug, not runtime condition).

Return-object-vs-throw policy: callable from a UI context where every failure has a user-visible recovery path; we don't want to teach every caller to catch. So we throw only on programmer errors and return `{ok: false, error}` on runtime conditions.

- [ ] **Step 1: Write the failing tests**

Append:

```js
import { addToCart } from '../../lib/retailers/shopify.js';

test('addToCart: returns ok on 200', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/cart/add.js': { body: { id: 1001, quantity: 1 } },
  });
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'sess=abc', fetchImpl });
  assert.deepEqual(result, { ok: true });
});

test('addToCart: sends id + quantity in body and Cookie header', async () => {
  let seenInit;
  const fetchImpl = async (url, init) => { seenInit = init; return makeResponse({ body: {} }); };
  await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'sess=abc', fetchImpl });
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers.Cookie, 'sess=abc');
  assert.deepEqual(JSON.parse(seenInit.body), { id: 1001, quantity: 1 });
});

test('addToCart: coerces string variantId to integer', async () => {
  let seenInit;
  const fetchImpl = async (url, init) => { seenInit = init; return makeResponse({ body: {} }); };
  await addToCart({ host: 'marinelayer.com', variantId: '1001', cookie: 'sess=abc', fetchImpl });
  assert.equal(JSON.parse(seenInit.body).id, 1001);
});

test('addToCart: maps 422 to out_of_stock', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/cart/add.js': { status: 422, body: { description: 'Out of stock' } },
  });
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'sess=abc', fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'out_of_stock' });
});

test('addToCart: maps HTML response (login page) to authentication_required', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/cart/add.js': { body: '<html>login</html>', contentType: 'text/html' },
  });
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'expired', fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'authentication_required' });
});

test('addToCart: maps 401 to authentication_required', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/cart/add.js': { status: 401, body: 'Unauthorized', contentType: 'text/plain' },
  });
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'expired', fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'authentication_required' });
});

test('addToCart: maps 403 to authentication_required', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/cart/add.js': { status: 403, body: 'Forbidden', contentType: 'text/plain' },
  });
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'expired', fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'authentication_required' });
});

test('addToCart: maps other 5xx to http_<status>', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/cart/add.js': { status: 500, body: 'oops', contentType: 'text/plain' },
  });
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'sess=abc', fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'http_500' });
});

test('addToCart: maps network failure to network', async () => {
  const fetchImpl = async () => { throw new Error('ECONNRESET'); };
  const result = await addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: 'sess=abc', fetchImpl });
  assert.deepEqual(result, { ok: false, error: 'network' });
});

test('addToCart: throws invalid_variant_id on non-numeric', async () => {
  for (const bad of [null, undefined, '', 'abc', NaN, {}, []]) {
    await assert.rejects(
      () => addToCart({ host: 'marinelayer.com', variantId: bad, cookie: 'sess=abc', fetchImpl: async () => ({}) }),
      (err) => err.code === 'invalid_variant_id',
      `expected invalid_variant_id for ${JSON.stringify(bad)}`
    );
  }
});

test('addToCart: throws invalid_cookie on empty cookie', async () => {
  for (const bad of [null, undefined, '', '   ']) {
    await assert.rejects(
      () => addToCart({ host: 'marinelayer.com', variantId: 1001, cookie: bad, fetchImpl: async () => ({}) }),
      (err) => err.code === 'invalid_cookie'
    );
  }
});

test('addToCart: throws invalid_host on bad host', async () => {
  await assert.rejects(
    () => addToCart({ host: '', variantId: 1001, cookie: 'sess=abc', fetchImpl: async () => ({}) }),
    (err) => err.code === 'invalid_host'
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: 12 failing.

- [ ] **Step 3: Implement `addToCart`**

- [ ] **Step 4: Run tests to verify they pass**

Expected: 34 + 12 = 46 passing in shopify.test.js.

- [ ] **Step 5: Run full suite**

Expected: 74 + 12 = 86 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/retailers/shopify.js test/retailers/shopify.test.js
git commit -m "Add addToCart with typed error returns for runtime failures"
```

---

### Task 7: Live smoke script + `npm run smoke:live`

**Files:**
- Create: `test/live-marinelayer.js`
- Modify: `package.json`

This task is the answer to "are our mocks accurate?" It is *not* run by `npm test` — it requires network and is too flaky for CI. It runs once, by a human, and the output is hand-eyeballed against the test fixtures.

**Script behavior:**
- Hits the real marinelayer.com.
- Runs `detect`, `search('sweater', { limit: 5 })`, `fetchVariants` on the first result.
- Prints each step's outcome with a clear header.
- Asserts structural invariants only: results is an array, first product has all expected fields with sensible types, variants array is non-empty for the first product.
- Does NOT call `addToCart` (no real session, and we don't want to litter a real store with cart additions).
- Exits 0 on success, 1 on assertion failure, with a clear message.

- [ ] **Step 1: Write `test/live-marinelayer.js`**

```js
#!/usr/bin/env node
// Live smoke test against marinelayer.com. Run manually:
//   npm run smoke:live
// Not part of `npm test`. Network-dependent; flaky by design.

import assert from 'node:assert/strict';
import { detect, search, fetchVariants } from '../lib/retailers/shopify.js';

const HOST = 'marinelayer.com';

async function main() {
  console.log(`\n=== detect(${HOST}) ===`);
  const isShopify = await detect(HOST);
  console.log('  result:', isShopify);
  assert.equal(isShopify, true, 'expected marinelayer.com to be detected as Shopify');

  console.log(`\n=== search(${HOST}, 'sweater', limit=5) ===`);
  const results = await search(HOST, 'sweater', { limit: 5 });
  console.log(`  ${results.length} products returned`);
  if (results.length > 0) {
    const first = results[0];
    console.log('  first product:', {
      url: first.url,
      brand: first.brand,
      title: first.title,
      price: first.price,
      image: first.image ? `${first.image.slice(0, 60)}…` : null,
      variant_count: first.variants.length,
    });
    assert.ok(Array.isArray(results), 'results must be array');
    assert.ok(first.url.startsWith('https://marinelayer.com/products/'), `bad url: ${first.url}`);
    assert.ok(first.brand, 'expected brand');
    assert.ok(first.title, 'expected title');
    assert.ok(Array.isArray(first.variants), 'expected variants array');
  } else {
    console.log('  WARNING: no results for "sweater" — Shopify ?q= may not work on this store.');
    console.log('  Check whether /products.json?q= is a real search endpoint here.');
  }

  if (results.length > 0) {
    console.log(`\n=== fetchVariants(${results[0].url}) ===`);
    const variants = await fetchVariants(results[0].url);
    console.log(`  ${variants.length} variants returned`);
    if (variants[0]) console.log('  first variant:', variants[0]);
    assert.ok(Array.isArray(variants), 'variants must be array');
  }

  console.log('\nLive smoke OK.');
}

main().catch((err) => {
  console.error('Live smoke FAILED:', err.message);
  if (err.code) console.error('  code:', err.code);
  if (err.status) console.error('  status:', err.status);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `package.json`**

In the `scripts` block, add: `"smoke:live": "node test/live-marinelayer.js"`.

- [ ] **Step 3: Run it (the implementer can run network calls)**

Run: `npm run smoke:live`
Expected: prints detect/search/fetchVariants outputs, exits 0.

**If `search()` returns 0 results:** Shopify's `?q=` is not universally supported. Mark this finding in the commit message and DO NOT modify `lib/retailers/shopify.js` to add a fallback in this task. The implementer should report this back so we can decide between (a) accepting `?q=` as best-effort, (b) adding a Plan 2.5 task that uses the predictive-search endpoint, or (c) deferring search-fallback to a later plan. Empty results is not a test failure — it's a finding.

- [ ] **Step 4: Confirm full suite still passes (the live test is not in the default suite)**

Run: `npm test`
Expected: still 86 passing.

- [ ] **Step 5: Commit**

```bash
git add test/live-marinelayer.js package.json
git commit -m "Add live smoke script for Marine Layer validation"
```

---

### Task 8: README status + version bump + CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Create: `CHANGELOG.md` (new file — Plan 1 did not create one; now we have enough history to start)

- [ ] **Step 1: Update README.md status section**

Change the "Status: v0.1.0 — profile setup only" line to reflect what v0.2.0 ships: profile data layer plus the Shopify handler library (read-only API; cart add ready but pending browser integration in Plan 3).

- [ ] **Step 2: Bump version in both files**

In `package.json`: `"version": "0.2.0"`.
In `.claude-plugin/plugin.json`: `"version": "0.2.0"`.

- [ ] **Step 3: Create `CHANGELOG.md`**

```markdown
# Changelog

## 0.2.0 — 2026-05-10

Adds the Shopify Tier-2 retailer handler library. Pure-Node, dependency-injected
fetch, mock-tested unit suite plus a live smoke script validated against
marinelayer.com.

- New `lib/http.js`: typed JSON GET/POST helpers.
- New `lib/retailers/shopify.js`: `detect`, `search`, `fetchVariants`,
  `addToCart`, `cartUrl`.
- New `npm run smoke:live` against marinelayer.com.

Not yet wired up: cart integration requires browser cookie (Plan 3) and slash
commands (Plan 5).

## 0.1.0 — 2026-05-10

Initial release. Profile data layer (`lib/profile.js`, `bin/cart.js`) and the
`/cart-setup` wizard.
```

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: still 86 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.2.0 — Shopify handler library"
git push origin main
```

---

## Self-review checklist (controller, not subagent)

Before declaring this plan done:

- [ ] All 8 tasks completed and committed.
- [ ] `npm test` shows 86 passing.
- [ ] `npm run smoke:live` ran and was eyeballed — paste output into the final commit message or task notes.
- [ ] If live smoke revealed `?q=` doesn't work, flag back to Eric before pushing.
- [ ] Version is 0.2.0 in both `package.json` and `.claude-plugin/plugin.json`.
- [ ] CHANGELOG entry is concise and accurate.
- [ ] README's status section matches reality.
- [ ] No `_raw` field snuck into the result objects (deliberately deferred).
- [ ] No `schema_version` field on profile (deliberately deferred).
- [ ] No slash commands added (deliberately deferred to Plan 5).

## Final review

After all tasks, dispatch a code-quality reviewer over the whole `lib/http.js` + `lib/retailers/shopify.js` surface (final SHA range). The reviewer's job: hunt for dead code, redundant validation, inconsistent error handling between `addToCart` (returns on failure) and the others (throw), and any boundaries where a programmer error and a runtime condition got conflated.
