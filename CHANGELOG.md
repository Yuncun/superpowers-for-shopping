# Changelog

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
