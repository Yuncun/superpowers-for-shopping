# Plan 12 — Real Shopify Search via `/search/suggest.json`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace the broken `search()` in `lib/retailers/shopify.js` with a real query-aware search. The current code hits `/products.json?q=<query>` but `/products.json` ignores the `q=` parameter — it's a product listing endpoint, not a search endpoint. So every query returns the same first-50 products, regardless of what the user asked for. After this plan, querying "sweater" returns sweaters, querying "swim trunk" returns swim trunks, etc.

**Architecture:** Two-phase search. (1) Hit `/search/suggest.json?q=<query>&resources[type]=product&resources[limit]=50` to get relevance-ranked product summaries with handles but no variants. (2) For the top N candidates (post-rank, pre-cart), fan out parallel `/products/<handle>.json` calls to fetch variant data. Combine into the existing normalized product shape so the rest of the orchestrator is unchanged.

**Tech Stack:** Node 20+ ESM. No new deps.

---

## Context for the implementer

Read first:
1. `lib/retailers/shopify.js` (all of it) — current `search()`, `fetchVariants()`, `addToCart()`. The variant-fetching path on lines 80-110ish is reusable: it hits `/products/<handle>.json` and returns variants. We can fan that out from the new search.
2. `lib/flow.js` lines 41-66 — how `search()` is consumed. Resolves to a Promise of arrays; flow does dedup, ranks, slices to 8.
3. `lib/ranking.js` — applies brand/budget filters on the unranked candidates before slice. Operates on title/brand/price fields.
4. `test/retailers/shopify.test.js` — mock-fetch test patterns. Match style.
5. Probe artifact at `/tmp/suggest.json` — captured response from marinelayer.com for `?q=sweater`. Use this as the test fixture base.

Process rules:
- DI for testability (fetchImpl + httpGetJson chain).
- Adversarial-input tests upfront.
- Validate at boundaries.
- New tests use mocked fetch — no live network calls in the unit suite.

## What's NOT in this plan

- No new retailer support. Marine Layer / Allbirds / Everlane all use the standard Shopify suggest endpoint; this fix benefits all of them automatically.
- No fuzzy/synonym handling beyond what Shopify's own suggest provides. We trust the retailer's search index.
- No client-side title-filtering fallback. If suggest returns 0 results, we return 0 results — the orchestrator already handles `no_results` cleanly.
- No caching. Each query hits the network fresh. Sub-second cost; not a problem yet.

## Probe findings (already done)

GET `https://marinelayer.com/search/suggest.json?q=sweater&resources[type]=product&resources[limit]=10`:
- 200 OK, JSON body.
- Shape: `{ resources: { results: { products: [...] } } }`.
- Each product has: `id`, `handle`, `title`, `vendor`, `price` (string, no `$`), `price_min`, `price_max`, `image`, `featured_image.{url,alt}`, `url`, `available`, `tags`, `type` (display category, often "Womens - Outerwear - Dress" type strings), `product_type` (often `None`), `body` (often null), `variants: []` (always empty in suggest response — must fetch separately).
- Query for "sweater" returned 10 real sweaters: Icon Sweater, Liam Sweater Polo, Mina Pointelle Sweater, etc.
- Some duplication of handles (different placements/promos) — we'll dedup by `handle` early in mapping.

## Endpoint contract

```
GET /search/suggest.json?q=<encoded query>&resources[type]=product&resources[limit]=<n>
```

Brackets MUST be URL-encoded (`%5B`/`%5D`) — vanilla curl/fetch don't auto-encode them and the endpoint returns 400 with unencoded brackets.

`/products/<handle>.json` is the existing detail endpoint; current `fetchVariants` already uses it. Response shape includes `product.variants: [{id, title, option1, option2, option3, price, available, ...}]`.

## Normalized product shape (unchanged — must match current contract)

```js
{
  title: string,
  brand: string,           // from vendor
  price: string,           // formatted "$98.50"
  url: string,             // absolute https://...
  image: string | null,
  variants: [
    { variant_id: number, size: string, color: string, price: string }
  ],
}
```

The orchestrator and ranking module already consume this shape. Don't change it.

## File structure

| File | Change | LOC |
|---|---|---|
| `lib/retailers/shopify.js` | Refactor `search()`; reuse `fetchVariants` fan-out | +~80 / -~30 |
| `test/retailers/shopify.test.js` | Replace existing search tests; add fixture-based test | +~150 |
| `test/fixtures/marinelayer-suggest-sweater.json` | New (copy of `/tmp/suggest.json`) | binary |
| `test/fixtures/marinelayer-icon-sweater.json` | New (one captured `/products/<handle>.json`) | binary |

---

## Tasks

### Task 1: Capture live fixtures (controller responsibility)

Already partially done — `/tmp/suggest.json` exists with the suggest response. The implementer needs ALSO a captured `/products/<handle>.json` response for one of the suggest-returned handles (e.g., `icon-sweater-6`). The implementer can fetch this themselves:

```bash
curl -s "https://marinelayer.com/products/icon-sweater-6.json" -o test/fixtures/marinelayer-icon-sweater.json
cp /tmp/suggest.json test/fixtures/marinelayer-suggest-sweater.json
```

Both fixtures go in `test/fixtures/`. Commit them — they're small (~10KB each) and serve as both unit test inputs and regression-pinning artifacts.

- [ ] **Step 1: Create `test/fixtures/` directory.**
- [ ] **Step 2: Copy `/tmp/suggest.json` → `test/fixtures/marinelayer-suggest-sweater.json`.**
- [ ] **Step 3: `curl` the icon-sweater-6 detail page → `test/fixtures/marinelayer-icon-sweater.json`.**
- [ ] **Step 4: Verify both fixtures parse as JSON.**
- [ ] **Step 5: Commit:** `Add live Shopify search fixtures for unit tests`

---

### Task 2: Refactor `search()` in `lib/retailers/shopify.js`

**Files:**
- Modify: `lib/retailers/shopify.js`

New behavior:

```js
export async function search(input, query, { fetchImpl = fetch, limit = 50, detailConcurrency = 8 } = {}) {
  const host = normalizeHost(input);
  if (!host) throw makeError('invalid_host', ...);
  if (!query || typeof query !== 'string') throw makeError('invalid_query', ...);

  // Phase 1: suggest endpoint.
  const encoded = encodeURIComponent(query);
  const suggestUrl = `https://${host}/search/suggest.json?q=${encoded}&resources%5Btype%5D=product&resources%5Blimit%5D=${limit}`;
  let suggestData;
  try {
    suggestData = await httpGetJson(suggestUrl, { fetchImpl });
  } catch (err) {
    if (err.code === 'http_error' || err.code === 'not_json' || err.code === 'network_error') {
      // No results / endpoint not available. Return empty array — orchestrator
      // handles no_results downstream.
      return [];
    }
    throw err;
  }

  const products = suggestData?.resources?.results?.products ?? [];
  if (products.length === 0) return [];

  // Dedup by handle (suggest can return the same handle multiple times due to
  // different placement weights).
  const byHandle = new Map();
  for (const p of products) {
    if (p.handle && !byHandle.has(p.handle)) byHandle.set(p.handle, p);
  }
  const unique = [...byHandle.values()];

  // Phase 2: fetch variants in parallel, capped at detailConcurrency.
  // Order is preserved (suggest's relevance ranking).
  const detailed = await fetchDetailsForHandles(host, unique, detailConcurrency, fetchImpl);
  return detailed;
}
```

`fetchDetailsForHandles` is a new helper that:
1. For each suggest product, GETs `/products/<handle>.json`.
2. Maps the response to our normalized shape, using suggest's `vendor` and `image` as fallbacks for products that hide those server-side.
3. Skips items that fail to fetch (log via console.warn but don't abort the whole search).
4. Caps concurrency at `detailConcurrency` to avoid hammering the store. (Use a simple promise pool — no library.)

```js
async function fetchDetailsForHandles(host, suggestProducts, concurrency, fetchImpl) {
  const results = new Array(suggestProducts.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= suggestProducts.length) return;
      const p = suggestProducts[i];
      try {
        const detail = await httpGetJson(`https://${host}/products/${encodeURIComponent(p.handle)}.json`, { fetchImpl });
        results[i] = mapToNormalized(host, p, detail.product);
      } catch (err) {
        // Skip unfetchable. Log and continue.
        console.warn(`shopify search: failed to fetch /products/${p.handle}.json: ${err.message}`);
        results[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results.filter(Boolean);
}
```

`mapToNormalized(host, suggestProduct, detailProduct)` builds our shape:

```js
function mapToNormalized(host, suggest, detail) {
  // detail.variants[i].option_values is what Shopify ships; previous fetchVariants
  // mapped option1/option2 → size/color per the product.options metadata. Reuse
  // that logic — extract it into a helper if it's not already standalone.
  const variants = mapVariants(detail);  // existing logic in current shopify.js
  return {
    title: detail.title || suggest.title,
    brand: detail.vendor || suggest.vendor || 'Unknown',
    price: formatPrice(detail.variants?.[0]?.price ?? suggest.price),
    url: `https://${host}/products/${suggest.handle}`,
    image: suggest.featured_image?.url || suggest.image || detail.images?.[0]?.src || null,
    variants,
  };
}
```

The exact `mapVariants` and price formatter likely already exist in the current `shopify.js` — reuse them rather than duplicate. Extract into separate exported helpers if needed for testability.

**Tests (replace existing search tests, ~12 cases):**

1. Empty query throws `invalid_query`.
2. Invalid host throws `invalid_host`.
3. Suggest endpoint returns empty `products` → returns `[]`.
4. Suggest endpoint returns 404 → returns `[]` (graceful).
5. Suggest endpoint returns non-JSON → returns `[]` (graceful).
6. Suggest network error → returns `[]` (graceful — but still log it).
7. Happy path: mock suggest returns 3 products, mock each `/products/<handle>.json` returns variants → 3 normalized products in suggest order.
8. Dedup: suggest returns same handle twice → only one product in output.
9. Concurrency: with 10 results and `detailConcurrency=3`, no more than 3 in-flight detail fetches at once (use a barrier counter).
10. One detail fetch fails (404) → other results still returned, failed one dropped.
11. **Fixture test**: load `test/fixtures/marinelayer-suggest-sweater.json`, mock fetch to return suggest response on suggest URL and the icon-sweater fixture on the matching detail URL. Assert the FIRST result's title contains "Sweater" (case-insensitive). This is the relevance regression assertion.
12. Title-relevance assertion: with the fixture, all returned products should have "sweater" in either `title` (case-insensitive) OR a relevant tag. Pick the looser assertion to avoid breaking when Marine Layer reranks.

**Implementation hints:**
- The current `search()` and its helpers are ~70 lines. The replacement is larger (~120 lines). Consider splitting into `lib/retailers/shopify-search.js` if `shopify.js` grows past ~250 lines.
- Don't change `addToCart` or `fetchVariants` or `cartUrl` exports — the orchestrator depends on them. Only `search` changes externally.
- Wrap the suggest URL in a helper (`buildSuggestUrl(host, query, limit)`) so tests can assert on the exact URL built. Same for the detail URL.

- [ ] **Step 1: Write all 12 failing tests in `test/retailers/shopify.test.js`.**
- [ ] **Step 2: Run — verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — verify pass.**
- [ ] **Step 5: Run full suite.**

Expected: 285 (Plan 11.3 baseline) + 12 new − N old (count the existing search tests being replaced; subtract). Final should be in the high 280s / low 290s.

- [ ] **Step 6: Commit:** `Replace stub search() with real Shopify suggest endpoint + variant fan-out`

---

### Task 3: Live verification (controller responsibility, after Task 2 lands)

After Tasks 1-2 commit, controller runs:

```bash
cd /Users/ericshen/Studio/superpowers-for-shopping
npm run e2e:ui   # confirm UI still renders correctly with new search
```

Then a live live `/cart` end-to-end (NOT the e2e:cart harness — the slash command in Claude Code) for queries like "sweater", "swim trunk", "shirt", "dress". Each one should return at least 5/8 candidates whose title obviously matches the query.

If a query consistently mis-ranks, that's a Marine Layer search-relevance issue, not a bug in our code — flag and move on.

Acceptance: querying "sweater" returns a thumbs grid where at least the top 3 cards are recognizable sweaters.

---

### Task 4: Ship v0.12.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status line:**

```
**Status:** v0.12.0 — Real search. `/cart "sweater"` now actually returns sweaters. Replaced the broken `/products.json?q=…` stub (which ignored the query param) with Shopify's `/search/suggest.json` endpoint plus a parallel variant-fetch fan-out for the top 8 candidates.
```

- [ ] **Step 2: Bump versions to 0.12.0** in both manifests.

- [ ] **Step 3: Prepend CHANGELOG entry:**

```markdown
## 0.12.0 — 2026-05-11

Real Shopify search. The previous `search()` was hitting `/products.json?q=…`,
which is Shopify's product LISTING endpoint — it ignores the `q` parameter
and just returns the first N products by store-sort. Every query returned
essentially the same set, no relevance, no filtering. This explained why
"sweater" returned swim trunks and "shirt" returned the same swim trunks.

- New two-phase search in `lib/retailers/shopify.js`:
  1. `GET /search/suggest.json?q=<query>&resources[type]=product&resources[limit]=50`
     for relevance-ranked product summaries (handles only, no variants).
  2. For the top N (post-rank), parallel `GET /products/<handle>.json`
     fetches for variant data. Concurrency capped at 8.
- Graceful degradation: any failure in either phase returns `[]` rather
  than crashing the flow; the orchestrator already handles no_results.
- New test fixtures: real captured responses from marinelayer.com for
  `?q=sweater` (suggest) and `icon-sweater-6` (detail). Used to assert the
  full pipeline returns at least one sweater for the sweater query.

Caught by live verification of the v0.11.3 UI fix — the page rendered fine
but the products on it weren't sweaters. Latent since v0.2.0; never caught
by unit tests because they mocked the response shape, never caught by the
protocol harness because it doesn't assert relevance.

Open spec items still deferred: Tier-1 handlers, aesthetic variance ranking,
Pinterest moodboard ingestion, virtual try-on, cross-retailer dedup, affiliate
links, gift mode. Also still considering dropping agent-browser entirely
(per v0.11.2 conversation — guest carts work, auth isn't load-bearing).
```

- [ ] **Step 4: Run full suite — confirm passing.**

- [ ] **Step 5: Commit and push:**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.12.0 — real Shopify search via /search/suggest.json"
git push origin main
```

---

## Self-review checklist

- [ ] All tasks committed.
- [ ] Test count grew (no net loss).
- [ ] `search()` no longer uses `/products.json` for the query path (only for the variant path, indirectly via `/products/<handle>.json`).
- [ ] The URL bracket encoding is correct (`%5B`/`%5D` — verified by a fixture-pinned test).
- [ ] Fixture-based test asserts at least one returned product has "sweater" in its title for the sweater query.
- [ ] No new runtime deps.
- [ ] Empty / failed suggest gracefully returns `[]` not throws.
