# Changelog

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
