# Changelog

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
