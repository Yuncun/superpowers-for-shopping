---
status: shipped
date: 2026-05-24
shipped-as: v1.0.0
---

# Plan 13 — Threat Mode

## The brief

> "Easier for me to buy a sweater if I am faced with the THREAT of a
> sweater being bought rather than having to pull myself to buy a
> sweater."

`/cart "a new sweater"` should produce, after some spinning, a grid of
~5 sweaters that **are already in real retailer carts** and a single
button labeled "Review your carts." No thumbs-up/down step, no candidate
selection, no auth retry dance, no post-purchase nudge.

## Design rationale

### What's wrong today (v0.14.0)

- **Thumbs-up/down is anti-pattern.** It demands an aesthetic decision
  on 8 cards before anything is in a cart. The whole point of the
  product is to bypass that "pull yourself to shop" moment.
- **Single retailer winner.** Currently picks ONE item from ONE store.
  The "threat" framing needs scale — multiple carts at multiple stores
  is much more visceral than one item in one cart.
- **Auth retry loop is dead code.** `addToCart` HTTP path posts to a
  cookie jar that doesn't matter; the cart permalink at the end is what
  actually populates the user's cart. Delete the HTTP path and the
  agent-browser cookie scraping that exists only to feed it.
- **Five-command surface is bloat.** `/cart-feedback`, `/cart-setup`,
  `/cart-retailers`, `/cart-rule` are all deprecated wrappers around
  `/cart-profile`. Deleting them removes ~zero functionality.
- **Feedback loop is anti-ADHD.** "Did you keep the swim trunks from
  12 days ago?" The SessionStart nudge demands recall, which is exactly
  the friction we're supposed to be removing.

### The new flow

```
/cart "a new sweater"
       │
       ▼
  Browser tab opens. Spinner.
       │
  Parallel search across all configured retailers.
  Progress streamed: "marinelayer.com: 12 results", etc.
       │
  Profile-based filter (brands_avoid, budget).
  Diversified pick: top 5, max 2 per retailer.
       │
       ▼
  ┌──────────────────────────────────────────┐
  │  5 sweaters added to your carts          │
  │  (across 3 stores)                       │
  │                                          │
  │  [img] EVERLANE  Cashmere Crew    $145   │
  │  [img] EVERLANE  Merino Crew      $98    │
  │  [img] MARINELAY Boyfriend Knit   $98    │
  │  [img] MARINELAY Saddle Sweater   $158   │
  │  [img] ALLBIRDS  Wool Pullover    $128   │
  │                                          │
  │         [ Review your 3 carts → ]        │
  └──────────────────────────────────────────┘
       │
  Click → 3 tabs open, each via Shopify cart permalink
  (https://<host>/cart/<v1>:1,<v2>:1) that adds the variants
  and redirects to the populated cart page.
```

### Why cart permalinks (not HTTP cart-add)

Shopify supports `/cart/<variant_id>:<qty>,<variant_id_2>:<qty>` as a
GET URL that adds variants to the visitor's cart and redirects to
`/cart`. Visiting in the user's logged-in browser means it uses their
real cookies. If the user isn't logged in, the retailer prompts for
login first — fine, that's the retailer's UX, not ours.

This means we **never need to read or post cookies from Node**, which
means we can drop the entire agent-browser cookie-scraping path and the
login-retry orchestration. The only Node-side I/O is the search itself.

### Sizing decisions

- **5 picks.** Enough to feel like a real shopping spree, few enough
  to scan in 3 seconds. (Was 8 before — but those needed a vote each.)
- **Max 2 per retailer.** Prevents one over-stocked store from
  dominating. Forces multi-cart "threat" framing.
- **3 retailers minimum** to land 5 picks. If fewer retailers configured
  or fewer return results, take what we can.

### Cuts

| Delete | Why |
|---|---|
| `commands/cart-feedback.md` | Deprecated alias |
| `commands/cart-setup.md` | Deprecated alias |
| `commands/cart-retailers.md` | Deprecated alias |
| `commands/cart-rule.md` | Deprecated alias |
| `bin/cart-feedback-flow.js` | Wraps `cart-profile-flow --tab=feedback` |
| `bin/cart-setup-flow.js` | Wraps `cart-profile-flow --tab=profile` |
| `bin/cart-pending-check.js` | SessionStart nudge → gone |
| `bin/retailers.js` | CLI for retailer add/remove → UI tab handles it |
| `bin/cart.js` | `list-pending` is the only consumer → gone |
| `hooks/session-start.sh` | Nudge fires from here → gone |
| `hooks/hooks.json` | Nothing left to hook |
| `lib/feedback-flow.js` | Feedback loop deleted |
| `lib/setup-flow.js` | Subsumed by profile-flow |
| `lib/browser.js` | Cookie scraping no longer needed |
| `server/render-feedback.js` | Feedback tab deleted |
| `server/render-setup.js` | Setup is just the Profile tab |
| `shopify.js: addToCart` | Cart permalinks do the work |
| `shopify.js: fetchVariants` | Unused after the above |
| `profile.js: listPendingPurchases, updatePurchase, appendThumbSignal` | Feedback loop deleted |
| `purchase_history: kept, notes` columns | No more tracking |

### Keeps (refactored where noted)

- `lib/flow.js` — heavy rewrite for new orchestration
- `lib/ranking.js` — used for filter+rank, unchanged
- `lib/palette-extractor.js` — keep; passive learning still useful; trigger on each carted product
- `lib/retailers-store.js` — unchanged
- `lib/profile.js` — purchase_history schema simplified; rest unchanged
- `lib/retailers/shopify.js` — keep `search`, `detect`, `cartUrl`; drop `addToCart`, `fetchVariants`
- `server/render.js` — full rewrite for new stages
- `server/render-profile.js` — drop the Feedback tab; keep Profile + Retailers
- `server/state.js`, `server/ui.js` — unchanged
- `bin/cart-flow.js` — refactor for new outcomes
- `bin/cart-profile-flow.js` — drop the `--tab=feedback` option
- `commands/cart.md`, `cart-profile.md` — copy refresh

## Implementation phases

### Phase A — Rot removal (mechanical)

Delete the files listed in "Cuts." Update `package.json` `bin` map.
Update `.claude-plugin/plugin.json` if it lists commands. Update tests
that import deleted modules. Should result in green `npm test`
(reduced suite) before phase B begins.

### Phase B — Flow rewrite

`lib/flow.js`:
- Drop `getCookieHeader`, `addToCart`, `openLoginPage` deps.
- After ranking, group results by host; round-robin pick to fill 5
  with max 2 per host.
- For each retailer involved, build one cart permalink with all its
  picked variants comma-separated.
- Push one progress state per retailer as searches resolve.
- Push final state with `{stage: 'done', picks, carts}` where
  `carts = [{host, url, count}]`.
- Wait for `{type: 'review'}` action (single button), then return
  `{outcome: 'reviewed', carts}`.
- On dismissed/idle: return `{outcome: 'dismissed'}`.

`bin/cart-flow.js`:
- Drop browser deps.
- On `outcome: 'reviewed'`, open each cart URL via `open` and exit 0.
- On `dismissed`/`no_results`: exit 1 with structured outcome.

### Phase C — UI rewrite

`server/render.js`:
- Stages: `searching` (skeleton cards + per-retailer progress), `done`
  (grid + Review button), nothing else.
- Cards: image, retailer badge, title, price. No vote buttons.
- Review button posts `{type: 'review'}` then shows a soft "Opening
  your carts…" state while the server-side handler dispatches.

### Phase D — Tests

- Delete `test/e2e-cart-feedback.test.js`, `e2e-cart-setup.test.js`.
- Rewrite `flow.test.js` for new orchestration (~15 cases).
- Rewrite render unit assertions for new stages (~5 cases).
- Keep `paths.test.js`, `profile.test.js` (adjusted for schema cut),
  `ranking.test.js`, `palette-extractor.test.js`, `retailers-store.test.js`,
  `http.test.js`, `browser.test.js` → delete (no more browser.js).
- Live smoke: `npm run e2e:cart` — drive real flow end-to-end with a
  real query against real Shopify endpoints. Should land variants
  in real cart permalinks.

### Phase E — Ship

- Bump to **v1.0.0** (major — breaking command surface change).
- CHANGELOG entry naming the cuts.
- Commit with conventional commit summary.
- Push to `origin/main` (yuncun/superpowers-for-shopping).
- Verify the marketplace cache picks up v1.0.0 (the user's
  installed version is 0.14.0; cache refresh on next session-start).

## Non-goals (explicitly out)

- Non-Shopify retailers. (Detection exists but no `tier 1` handler is
  wired; the user's profile only has Shopify stores. Defer until needed.)
- Auto-checkout. The product stops at "review the cart" — checkout is
  the user's decision and not the part we should automate.
- Personalization from purchase history. The palette extractor passively
  learns colors; that's enough for now. No collaborative-filtering rabbit
  hole.
- Asking the user for confirmations or aesthetic input mid-flow. The
  whole point is to remove that step.

## What might come back

If users want to "veto" specific picks before they hit the cart, we
add a × on each card during the `done` stage that removes a pick from
its permalink before the Review button is clicked. Cheap to bolt on; not
worth doing prophylactically.
