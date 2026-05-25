# Changelog

## 1.0.1 — 2026-05-24

`/cart "A sweater - light, kind of baggy, modern"` was returning zero results
because Shopify's `/search/suggest.json` does substring matching on product
titles — no real product title contains "A sweater - light, kind of baggy,
modern" all at once.

Added `simplifyQuery` that runs before searches fan out:

- cuts at the first descriptive separator (`-`, `—`, `,`, `(`),
- strips a leading article (a / an / the / some / any),
- leaves the head noun phrase to send to retailers.

The UI still shows the user's original query string; only the wire query
shrinks. `"A sweater - light, kind of baggy, modern"` → `"sweater"` for
Shopify; same flow as if the user had typed "sweater" directly.

8 new unit tests; suite at 236 passing.

## 1.0.0 — 2026-05-24

"Threat Mode." `/cart` no longer asks for input mid-flow. Query → spinner →
five picks already in real carts at the retailers → one **Review** button that
opens those carts in new tabs.

### Why

The thumbs-up/down step was the bug. The whole point of the plugin is to skip
the "decide to shop" moment; asking for aesthetic input on 8 cards just moves
that decision earlier in the flow. For a user who hates shopping, being
*confronted* with a populated cart is easier than being *asked* to pick.

The post-purchase "did you keep it?" loop had the same shape — it asked the
user to recall, days later, what they bought. Stale duplicates piled up. Cut.

### What

- **`/cart` rewrite.** Query → parallel search across retailers → profile
  filter (`brands_avoid`, `budget_caps`) → diversified picks (5 items, ~2 per
  store) → grid of cards in browser → one "Review your N carts" button.
- **Shopify cart permalinks.** Clicking Review opens
  `https://<host>/cart/<v1>:1,<v2>:1,...` for each retailer involved. The
  retailer adds the variants to the user's *real* logged-in cart and redirects
  to `/cart`. We never touch cookies from Node.
- **Same-product dedup.** Pipe-separated color suffixes (`"Boxy Sweater | Navy"`
  vs `"... | Skywriting"`) and same-handle relistings collapse to one pick.
- **Dynamic per-retailer cap.** With one retailer returning results we fill
  the grid from it; with many, we cap at 2 each. Two-phase round-robin with
  refill always tries to reach 5.

### Cuts (~2,400 LOC)

- Deprecated commands: `/cart-feedback`, `/cart-setup`, `/cart-retailers`,
  `/cart-rule` (all wrappers around `/cart-profile`).
- Feedback tab in `/cart-profile`. Purchase-history `kept` / `notes` columns
  gone — history is now a log, not a to-do list.
- `SessionStart` hook + `cart-pending-check.js` ("Quick: you have 3 pending
  purchases…" nudge).
- `lib/browser.js` (agent-browser cookie scraping) — cart permalinks made it
  unnecessary.
- `shopify.js: addToCart` / `fetchVariants` — leftover from the Node-side
  cart-add path that the permalink approach superseded.
- `profile.js: listPendingPurchases`, `updatePurchase`, `appendThumbSignal`.
- Bin scripts: `cart.js`, `retailers.js`, `cart-pending-check.js`,
  `cart-feedback-flow.js`, `cart-setup-flow.js`.
- `lib/feedback-flow.js`, `lib/setup-flow.js` (merged what was reachable
  into `lib/profile-flow.js`).
- `server/render-feedback.js`, `server/render-setup.js`, the old thumbs-and-
  cards `render.js`.
- All e2e/smoke harnesses tied to the old flow (`live-marinelayer.js`,
  `live-flow.js`, `live-browser.js`, `e2e-cart-ui.mjs`, `cart-harness.js`).

### Tests

228 passing. New: 14 unit tests for the new orchestration (`flow.test.js`,
`diversify`, `makeTitleKey`), 9 render-page assertions for the new stages, 4
e2e tests driving the real subprocess via SSE/POST. `npm run smoke:browser`
and friends are gone with their scripts.

### Permission allowlist

The single allowlist entry now is:

```
"Bash(node \"${CLAUDE_PLUGIN_ROOT}/bin/cart-flow.js\":*)"
```

(plus `cart-profile-flow.js` for the settings UI).

### Migration notes

- The four deprecated alias commands are *gone*, not deprecated. If you had
  muscle memory for `/cart-feedback`, the equivalent doesn't exist anymore
  by design — the feedback loop is gone.
- `purchase_history` schema changed: `kept` and `notes` columns removed, `url`
  column added. Old rows still parse; new ones write the new shape.
- Default per-retailer set unchanged.

## 0.14.0 — 2026-05-23

Five commands → two. `/cart` (shop) and `/cart-profile` (one tabbed UI
covering everything else). The four other commands stay alive as
deprecated aliases that just open the new UI on the right tab.

### Why

The plugin had grown to five slash commands: `/cart`, `/cart-setup`,
`/cart-feedback`, `/cart-retailers`, `/cart-rule`. Each was sensible in
isolation, but together they were more than anyone needed to remember,
and the "which command edits what" cognitive load only got worse as new
fields landed.

### What

- **New `/cart-profile`** — one browser page with three tabs:
  - **Profile** — sizes, budget, brands, fit notes, optional moodboard.
    Same form as the old `/cart-setup`.
  - **Retailers** — list of stores `/cart` searches, with add/remove
    buttons. Replaces the `/cart-retailers list|add|remove` CLI subcommands.
    (The `login` subcommand has been dropped for now — open a /cart and
    use the agent-browser session if you need to authenticate.)
  - **Feedback** — pending purchases checklist, same as the old
    `/cart-feedback`.

  Page stays open until the user closes the tab. Each tab has its own
  Save button; saves are independent so the user can edit a few things
  on one tab and ignore the others. After each save the server pushes
  a fresh full snapshot and a success/error banner on the relevant tab.

- **Deprecated commands** — `/cart-setup`, `/cart-feedback`,
  `/cart-retailers`, `/cart-rule` now all just open `/cart-profile`
  pre-selected to the relevant tab, and emit a one-liner noting the
  migration. Marked `[deprecated]` in their descriptions.

- **`/cart-rule` removed-as-feature**: the natural-language
  "promote a rule" shortcut is gone. The Profile tab exposes every
  field explicitly, so adding "Shein" to `brands_avoid` is one click —
  no NL parser worth its weight.

### Implementation

- `server/render-profile.js` — tabbed page; tab content composes the
  same renderer patterns used by the now-superseded `render-feedback.js`
  and `render-setup.js`.
- `lib/profile-flow.js` — long-lived orchestrator dispatching on
  `submit-profile / submit-retailer-add / submit-retailer-remove /
  submit-feedback / dismissed`. Re-pushes a full snapshot after every
  action.
- `bin/cart-profile-flow.js` — CLI shim. Accepts `--tab=<name>` so the
  deprecated aliases can deep-link.

### Tests

8 render assertions (parse-guard, tab presence, action coverage,
palette-absence). 11 flow unit tests covering every action type,
validation failure, retailer error mapping, snapshot refresh after each
write, and shutdown-on-exception. 4 e2e tests that drive the real
subprocess via SSE + POST and assert profile.md / retailers.md get
written and the `--tab=` deep-link arrives in the snapshot.

330 → 353 tests, all green.

### What might come back

If two or three users tell us the muscle memory of `/cart-feedback`
mattered more than the consolidation, we can promote it back to a
first-class command — it's already wired and tested. Same for
`/cart-rule` if the NL shortcut turns out to be load-bearing.

## 0.13.0 — 2026-05-19

`/cart-setup` now uses the same single-page UI pattern as `/cart-feedback`.
The 6-section chat wizard (sizes → budget → brands → fit notes → diff →
confirm → optional moodboard) becomes one form: every field visible at
once, pre-populated from the existing profile, one Save button.

- New `server/render-setup.js`: form page with sections for Sizes, Budget,
  Brands, Fit notes, and Optional (moodboard). Palette is intentionally
  excluded — it's filled by /cart thumb signals, not setup
  (anti-pattern per the prior `commands/cart-setup.md`).
- New `lib/setup-flow.js`: pure orchestrator with `mergeSubmittedProfile`
  + `diffProfiles` helpers. Object fields (sizes / budget_caps /
  fit_notes) merge per-key; empty string clears a key, missing key
  preserves it. Arrays (brands_love / brands_avoid) replace wholesale.
  Untouched fields (palette, purchase_history, thumb_signals) survive.
- New `bin/cart-setup-flow.js`: CLI shim, same sentinel + outcome pattern
  as the other flows.
- `commands/cart-setup.md` rewritten to invoke the flow script. No more
  one-question-per-turn gap-fill.
- On validation failure or write failure, the form re-renders with the
  errors inline rather than aborting.

Tests: 9 render assertions (including palette-absence and the
inline-script-parses guard), 15 flow unit tests covering merge / diff /
validation-retry / write-failure-retry, 3 e2e tests that drive the real
subprocess and verify profile.md gets written with submitted values plus
preserved untouched fields.

`/cart-rule` still uses a chat walkthrough — it's a one-shot
single-input confirmation, not a multi-step wizard, so the UI win is
smaller. Tracked but not addressed here.

## 0.12.1 — 2026-05-19

`/cart-feedback` now opens a one-page browser UI instead of walking through
prompts in chat. Marking 3 pending purchases dropped from 6+ Q&A turns to a
single checklist with a Save button.

- New `server/render-feedback.js`: self-contained HTML page that lists every
  pending purchase as a Kept / Returned / Skip checklist with an optional
  notes field per item. Matches the visual language of the existing /cart
  page.
- New `lib/feedback-flow.js`: pure orchestrator. Same dep-injection shape as
  `lib/flow.js`. Tallies kept/returned/skipped/errors and pushes a `done`
  state with the summary before shutdown.
- New `bin/cart-feedback-flow.js`: CLI shim wiring real deps. Emits the
  same `__CART_FEEDBACK_URL__` sentinel + final `outcome=…` line pattern as
  `cart-flow.js`, so existing harness conventions still apply.
- `server/ui.js` now accepts an injected `render` opt (default unchanged) so
  one HTTP/SSE plumbing layer can serve different page types.
- `commands/cart-feedback.md` rewritten to invoke the new flow script — no
  more sequential "did you keep X?" prompting.

Skip rows stay pending (`kept='?'`), so they show up again on the next run.

The chat-walkthrough complaint also applies to `/cart-setup` (6-section
wizard) and to a lesser extent `/cart-rule`. Those are larger refactors
and tracked separately; this release fixes only the most painful one.

## 0.12.0 — 2026-05-11

Real Shopify search. The previous `search()` was hitting `/products.json?q=…`,
which is Shopify's product LISTING endpoint — it ignores the `q` parameter
and just returns the first N products by store-sort. Every query returned
essentially the same set, no relevance, no filtering. This explained why
"sweater" returned swim trunks and "shirt" returned the same swim trunks.

- New two-phase search in `lib/retailers/shopify.js`:
  1. `GET /search/suggest.json?q=<query>&resources[type]=product&resources[limit]=50`
     for relevance-ranked product summaries (handles only, no variants).
  2. For each unique handle, parallel `GET /products/<handle>.json`
     fetches for variant data. Concurrency capped at 8.
- Graceful degradation: any failure in either phase returns `[]` rather
  than crashing the flow; the orchestrator already handles no_results.
- New test fixtures: real captured responses from marinelayer.com for
  `?q=sweater` (suggest) and `icon-sweater-6` (detail). Used to assert the
  full pipeline returns at least one sweater for the sweater query.
- New URL-encoding regression test for the `resources[type]` query param —
  raw `[`/`]` brackets cause Shopify to return 400, so the test pins the
  `%5B`/`%5D` encoding.

Caught by live verification of the v0.11.3 UI fix — the page rendered fine
but the products on it weren't sweaters. Latent since v0.2.0; never caught
by unit tests because they mocked the response shape, never caught by the
protocol harness because it doesn't assert relevance.

Open spec items still deferred: Tier-1 handlers, aesthetic variance ranking,
Pinterest moodboard ingestion, virtual try-on, cross-retailer dedup, affiliate
links, gift mode. Also still considering dropping agent-browser entirely
(per v0.11.2 conversation — guest carts work, auth isn't load-bearing).

## 0.11.3 — 2026-05-11

UI rendering hotfix + observability layer the protocol harness was missing.

- Fix: `server/render.js` had two unescaped apostrophes (lines 377 and 378,
  in the `login_required` render branch) inside single-quoted JS strings
  that were nested inside the outer template literal. The template literal
  consumed the escape backslash, so the browser received `'We've opened…'`
  and `'I'm logged in…'` — both of which close the JS string prematurely.
  The browser failed to parse the entire inline `<script>` block, so
  `EventSource` never opened and the page rendered blank. Same symptom in
  every browser; not user-environmental.
- New regression test in `test/server/render.test.js`: compiles the inline
  `<script>` body with `node:vm` and fails on any SyntaxError. This catches
  the bug class at unit-test time, no browser needed.
- New `npm run e2e:ui`: full Playwright-driven UI regression. Spawns a real
  cart-flow subprocess, opens the page in headless Chromium, asserts at
  least one product card renders within 8 seconds, fails on any console
  error or pageerror event. `playwright` added as a devDependency.

This bug was silent and unobservable for the entire life of the project
because the existing test layer is protocol-level (orchestrator state
machine) and never exercised the rendered page. The Playwright layer
closes that gap.

## 0.11.2 — 2026-05-11

Live-verification fix on top of the v0.11.1 dry-run runs. The harness was
reporting "success → /cart" but the user's browser saw an empty cart.

- Fix: `lib/flow.js` now redirects to a Shopify cart permalink
  (`/cart/<variant_id>:1`) instead of `/cart`. The Node-side `addToCart`
  was adding to a discarded fetch cookie jar, so the user's browser — which
  is what actually opens the cart URL — saw its own empty cart. The
  permalink hands cart-add responsibility to whichever browser opens it,
  using that browser's own cookies. Confirmed against marinelayer.com:
  Shop Pay express checkout opens with the item, address, and card
  pre-filled. One tap from purchase.
- Removed the `"adhd"` discoverability keyword from
  `.claude-plugin/plugin.json`. The customer-facing copy was already
  swapped in v0.11.0; this completes the rename.

## 0.11.1 — 2026-05-11

Caught by the Plan 11 E2E harness on its first live run against marinelayer.com.

- Fix: `lib/http.js` was rejecting `text/javascript` content-type as `not_json`.
  Shopify's `/cart/add.js` returns JSON-bodied responses with content-type
  `text/javascript; charset=utf-8` — the legacy Shopify-AJAX convention. The
  rejection cascaded through `lib/retailers/shopify.js:addToCart` which
  classifies `not_json` as `authentication_required`, so successful adds were
  surfacing as auth failures. Cart was actually getting populated server-side;
  the orchestrator just didn't know.
- Now accepts a small whitelist: `application/json`, `text/javascript`,
  `application/javascript`. The `not_json` classifier still fires for genuine
  HTML responses (e.g. login redirects), preserving the auth-detection path.
- Live verification: `npm run e2e:cart` now produces 3/3 successful runs
  against marinelayer.com with real items added to a real cart.

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

## 0.10.0 — 2026-05-11

`/cart-setup` UX overhaul. The wizard now opens with one free-form prompt,
extracts what it can parse, then targets gap-fill questions only at the
fields that didn't come out of extraction. Final diff + confirm before any
write — no more eight-message linear survey.

- Rewrote `commands/cart-setup.md` as a six-section hybrid flow.
- Dropped the palette question. It was a poor proxy for taste (asking
  someone's favorite single color doesn't predict what they actually buy).
- New `lib/palette-extractor.js`: extracts color tokens from a product's
  variant color field or title, falling back to a curated 40-item color
  vocabulary.
- `runCartFlow` now learns the palette passively. On final accept, the
  picked product's colors are merged into `profile.palette` (case-insensitive
  dedup, capped at 8 entries).

Open spec items still deferred (no change from v0.9.0): Tier-1 handlers,
aesthetic variance ranking, Pinterest moodboard ingestion, virtual try-on,
cross-retailer dedup, affiliate links, gift mode.

## 0.9.2 — 2026-05-11

Map `session_closed` errors (from idle cleanup or external close) to a
graceful `{outcome: 'dismissed'}` instead of surfacing as a flow_error.
This was masking the real "user walked away" case as a crash.

## 0.9.1 — 2026-05-11

Hotfix from the first real `/cart` run.

- `runCartFlow` now uses `Promise.allSettled` for the retailer search
  fan-out. A single failing retailer is logged and skipped instead of
  taking down the whole flow.
- Removed `mejuri.com` from `getDefaultRetailers()` — it sets Shopify
  markers on its homepage but blocks `/products.json` behind a redirect.
  Users with the old default in their `retailers.md` can clean up via
  `/cart-retailers remove mejuri.com`; the resilience fix keeps it
  harmless if they don't.

## 0.9.0 — 2026-05-11

Ranking heuristics + the `/cart-rule` wizard. The profile data the user
has been entering since v0.1.0 finally gets used.

- New `lib/ranking.js`: `applyRanking(candidates, profile)` drops banned
  brands and over-budget items, reorders loved brands to the front.
- `runCartFlow` wires ranking into the pipeline after dedup, before
  taking the top 8.
- New `commands/cart-rule.md` LLM wizard. Translates "stop suggesting
  cropped fits" or "never show me Shein" into a structured profile
  update, shows the diff, writes via the existing `cart set` subcommand.

This closes the v1 roadmap. The plugin now does what the original spec
described: profile setup, multi-retailer Shopify search, browser session,
visual narrowing UI, in-flow login retry, purchase feedback loop, and
profile-driven ranking.

Open spec items deferred to a v2 roadmap:
- Tier-1 custom handlers (Amazon, IKEA, Uniqlo, West Elm).
- Aesthetic variance ranking (Plan 9 has hard filters but no spread).
- Pinterest moodboard ingestion.
- Virtual try-on.
- Cross-retailer dedup beyond identical-URL.
- Affiliate links.
- Gift mode.

## 0.8.0 — 2026-05-11

Purchase feedback loop. Successful `/cart` flows record a pending row in
`profile.purchase_history`; `/cart-feedback` walks the user through marking
each kept or returned.

- `lib/profile.js`: + `listPendingPurchases`, `updatePurchase`.
- `bin/cart.js`: + `list-pending`, `feedback` subcommands.
- `runCartFlow` writes `{kept: '?'}` row on success.
- New `commands/cart-feedback.md` LLM wizard.
- New `hooks/session-start.sh` + `bin/cart-pending-check.js` nudge the
  user when items have been pending 7+ days.

v0.8.0 deferrals (Plan 9):
- No `/cart-rule` for promoting learned signals to hard rules.
- No ranking heuristics — still naive top-N by thumb count and listing order.
- No clarifying questions before search.

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

## 0.6.0 — 2026-05-11

Adds retailer management. `/cart` no longer hardcoded to one store —
searches every retailer in your list in parallel.

- New `lib/retailers-store.js`: read/write `~/.claude/cart/retailers.md`.
  Auto-creates with 4 default Shopify stores (marinelayer, allbirds,
  everlane, mejuri) if missing.
- New `bin/retailers.js` + `/cart-retailers list|add|remove` slash command.
- `runCartFlow` reads retailers from the store when no explicit list is
  passed. `bin/cart-flow.js` drops its hardcoded array.
- `add` validates a host is Shopify-detected before adding. Tier-1
  retailers and non-Shopify sites are rejected with a clear error.

v0.6.0 deferrals (Plan 7):
- No `/cart-retailers login` — login is still handled out-of-band via
  `npm run smoke:browser`.
- No in-flow login retry — `auth_required` still exits the flow.

## 0.5.0 — 2026-05-11

The first user-facing release. Composes Plans 1-4 into the end-to-end
`/cart "<query>"` flow.

- New `lib/flow.js`: pure orchestrator with structured-outcome return.
  Handles success / no_results / canceled / dismissed / auth_required /
  cart_error paths. Every dependency injected for testability. Dedupes
  candidates by URL.
- New `bin/cart-flow.js`: CLI wiring real `search`, browser cookies,
  `addToCart`, UI server. Auto-opens the UI in the user's default browser
  on macOS.
- New `commands/cart.md`: the slash command itself.
- New `npm run smoke:flow` exercises the full path with `addToCart` mocked
  (so we don't litter a real Shopify cart). Live-validated against
  marinelayer.com — flow correctly transitioned loading → thumbs → final →
  auth_required when no logged-in session was present.

v0.5.0 scope cuts (Plan 6 picks these up):
- Single retailer hardcoded (marinelayer.com). No `retailers.md` reading.
- Naive top-1 ranking by thumbs-up count, no profile filter.
- No "see alternatives" handling in the orchestrator (UI button exists but
  action is unhandled — clicking it leaves the user on the final card).
- No in-flow login retry — `auth_required` exits with guidance to run
  `npm run smoke:browser` first.
- No clarifying questions (budget/occasion).

## 0.4.0 — 2026-05-10

Adds the local web UI server. Pure-Node HTTP + Server-Sent Events, no external
runtime deps. Drives the user's browser through loading → thumbs grid → final
card → cart redirect stages.

- New `server/state.js`: session store with action queue and idle expiry.
- New `server/render.js`: self-contained HTML/CSS/JS for the session page.
- New `server/ui.js`: HTTP server, SSE stream, POST action endpoint, redirect
  helper. Bound to `127.0.0.1` only; per-session random token gates all routes.
- New `npm run smoke:ui` — spins up a real server with mock candidates for
  manual UX review. Visual eyeball confirmed against agent-browser.

Not yet wired up: the `/cart` slash command (Plan 5) is what composes this
with Plan 2's search/addToCart and Plan 3's browser cookie flow.

## 0.3.0 — 2026-05-10

Adds the browser-session library. Pure Node wrapping the `agent-browser` CLI
with dependency-injected exec for mock-tested unit coverage plus a manual
smoke script that drives a real browser.

- New `lib/browser.js`: `openLoginPage`, `getCookieHeader`, `isLoggedIn`,
  `closeBrowser`. Persistent profile at `~/.claude/cart/browser-profile/`.
- New `lib/host.js`: shared `normalizeHost` extracted from `lib/retailers/shopify.js`.
- New `npm run smoke:browser` for manual end-to-end login verification, validated
  live against marinelayer.com.

Live-smoke findings folded in:
- `runAgentBrowser` always passes `--json` (agent-browser defaults to
  human-readable output).
- `isLoggedIn` is a best-effort heuristic — Plan 5's `addToCart` is the
  authoritative auth check.

Not yet wired up: the `/cart` flow (Plan 5) is what calls these.

## 0.2.0 — 2026-05-10

Adds the generic Shopify Tier-2 retailer handler library. Pure-Node, dependency-injected
fetch, mock-tested unit suite plus a live smoke script validated against marinelayer.com.

- New `lib/http.js`: typed JSON GET/POST helpers (`http_error`, `not_json`,
  `invalid_json`, `network_error`, `invalid_url`).
- New `lib/retailers/shopify.js`: `detect`, `search`, `fetchVariants`,
  `addToCart`, `cartUrl`. Search returns normalized products with axis-aware
  variant assignment (size/color mapped per Shopify's `options` metadata).
- New `npm run smoke:live` against marinelayer.com.
- Tightened `npm test` glob to `*.test.js` so smoke script stays out of CI.

Not yet wired up: cart integration requires a real browser cookie (Plan 3) and
slash commands (Plan 5).

## 0.1.0 — 2026-05-10

Initial release. Profile data layer (`lib/profile.js`, `bin/cart.js`) and the
`/cart-setup` wizard.
