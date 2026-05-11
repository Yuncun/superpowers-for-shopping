# superpowers-for-shopping — Design

**Status:** Draft for review
**Date:** 2026-05-10
**Author:** Eric Shen + Claude

## 1. Purpose

A Claude Code plugin that takes a user from "I need a new sweater" to a populated shopping cart with a single click — handling the rote work of searching, narrowing, and cart-loading, leaving the user only the high-bandwidth aesthetic call and final approval.

### Framing

This is an **ADHD-helper**, not a deal-finder. The friction it removes is **task initiation + aesthetic narrowing**, not specs research. Optimized for "in cart in 60 seconds, low regret" rather than "best product on the internet."

### Scope

**In scope (v1):** Discretionary, considered, non-recurring purchases — clothes, furniture, lamps, bags, lifestyle goods, gifts.

**Out of scope (v1):**
- Replenishables (toothpaste, coffee, household consumables — different decision shape)
- High-stakes purchases (cars, real estate, expensive electronics — different decision shape, more research warranted)
- Full auto-checkout (tool stops at cart; user does final checkout)
- Virtual try-on with user photo (future feature)
- Pinterest moodboard ingestion (future feature)

## 2. User flow

```
User: "I need a sweater"  (in Claude Code session, via /cart or skill)
  ↓
Tool loads ~/.claude/cart/profile.md
  ↓
Terminal Q&A: 1-2 hard-criteria questions (skipped if profile defaults suffice)
  • "Budget?" (or skips if profile says default tier)
  • "Casual / going-out / work?" (only if needed)
  ↓
Tool searches retailers per Section 5 (Tier 1 + Tier 2)
  ↓
Browser opens: 8-card grid of candidates, max aesthetic variance
  • Image, brand, price, one-line tag
  • User thumbs-up / thumbs-down each (~10 seconds total)
  ↓
Tool narrows to top 1 based on thumbs + profile log
  ↓
Browser updates in place: final 1-card page
  • Big photo, price, fit/material, brand
  • 1-2 sentence "why this one" rationale
  • "Looks good — add to cart" button
  • "see 2 alternatives" small link
  ↓
User clicks "Looks good"
  ↓
Tool drives logged-in browser session to add item to user's cart on the retailer
  ↓
Tab redirects to retailer's cart page; user completes checkout themselves
```

**Cold-start flow (first ever use):** 60-second profile setup — sizes (top/bottom/foot), default budget tier, brand list (love / avoid), color palette. The `moodboard_url` profile field exists but is not consumed by v1 (Pinterest ingestion is deferred to v2; see Section 11).

**Post-purchase feedback:** On a session-start hook, when a purchase is 7+ days old and uncategorized, the tool surfaces "did you keep the [item] from [date]?" — yes/no plus optional note. Feeds back into the profile log.

## 3. Profile and persistence

### Three tiers of persistence

| Tier | What | Storage | Semantics |
|---|---|---|---|
| **Hard facts** | Sizes, allergies, banned brands, budget caps | Frontmatter | Constraints — filtered, never offered |
| **Learned signals** | Thumb decisions, purchase outcomes, fit preferences | Append-only log tables in profile.md | Read by the model at decision time, interpreted not enforced |
| **In-session context** | "Today I want something dressier" | Prompt only, not stored | Influences this request only |

### Key principle: log, don't compile

Learned preferences are stored as an append-only event log, not as compiled rules. The model reads the log at decision time and interprets patterns. This gives:

- **Learning without locking** — preferences are observed, not asserted
- **Drift detection** — recent signals can override old ones
- **Transparency** — log is human-readable markdown
- **Reversibility** — user can delete a row
- **Hard override path** — `/cart rule "stop suggesting cropped fits"` promotes a soft pattern to a hard frontmatter rule when the user decides it's a real rule

### Profile file shape

```markdown
---
sizes:
  top: M
  bottom: 32x32
  shoes: 10.5
budget_default: mid       # low / mid / high
budget_caps:
  clothes: 200
  furniture: 1500
palette: [navy, charcoal, cream, olive, rust]
brands_love: [Marine Layer, Uniqlo, Aritzia]
brands_avoid: [Shein, Temu]
fit_notes:
  sweater: "prefer relaxed, not cropped"
  pants: "tapered"
moodboard_url: ""
last_setup: 2026-05-10
---

# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|
| 2026-04-22 | sweater | Marine Layer | $98 | yes | "navy crew, slightly cropped" |

# Thumb signals
| date | category | up | down |
|---|---|---|---|
| 2026-04-22 | sweater | "ribbed crew, relaxed fit" | "cardigan, oversized" |
```

## 4. Retailer tiering

### Tier 1 — Custom handlers (day-1)

Bespoke per-retailer handlers for non-Shopify retailers:

- **Amazon** — covers misc / variable quality
- **IKEA** — furniture
- **Uniqlo** — basics
- **West Elm** — furniture

Add 1-2 per month based on actual usage.

### Tier 2 — Generic Shopify handler

A single handler that covers any Shopify-backed retailer. Detection: HTML includes `cdn.shopify.com` or `/cdn/shop/`. Validated against Marine Layer.

Shopify exposes documented endpoints used by the handler:
- `GET /products.json?q=<query>` — paginated product search
- `GET /products/<handle>.json` — variant data (sizes, colors, in-stock, variant_id)
- `POST /cart/add.js` body `{id: variant_id, quantity: 1}` — cart insert (requires session cookie)

Covers Marine Layer, Everlane, Allbirds, Mejuri, Aritzia (mostly), and ~50–80% of mid-tier DTC clothing/furniture brands.

### Tier 3 — Fallback

For retailers not on Shopify and without a Tier-1 handler: deep link to product page, no cart automation. Tool tells the user "this retailer doesn't auto-cart, here's the page."

### Handler interface

Each handler (Tier 1 and Tier 2) implements:

```
search(query, filters)       → list of {url, image, brand, price, variants}
fetch_variants(product_url)  → list of {size, color, in_stock, variant_id}
add_to_cart(variant_id)      → success or error
cart_url                     → URL for post-handoff redirect
```

Tier 2 is one handler implementing this interface against Shopify endpoints; auto-applies to any detected Shopify retailer without per-store configuration.

## 5. Search surface

V1 uses **per-retailer search only.** Tool queries `/products.json` on each Tier-2 Shopify retailer plus Tier-1 search endpoints. Aggregates results, filters by hard criteria from profile, ranks by profile match, then picks 8 candidates for the thumbs grid optimized for **aesthetic variance** — meaning the 8 are spread across the candidate pool so they collectively cover the plausible aesthetic range, rather than 8 near-identical items. Variance is computed against simple features (brand, color, fit, silhouette) extracted from product metadata; the goal is that thumbs decisions disambiguate quickly.

Day-1 search universe = the ~20 retailers configured in `retailers.md`.

**Rejected for v1:** Google Shopping integration. Adds noise, needs API key, blocks shipping. Revisit in v2 once the per-retailer loop is proven.

**User-extensible:** `/cart add-retailer marinelayer.com` introspects the site; if Shopify, auto-configures via the generic handler. If not Shopify, prompts the user to file a request or write a Tier-1 handler.

## 6. Browser session and cart handoff

### Session model

Tool maintains a **dedicated persistent browser profile** at `~/.claude/cart/browser-profile/` via `agent-browser`. First-time use of a retailer: tool opens browser, user logs in once, cookies persist. Subsequent visits reuse the session.

Rationale: isolated from user's real Chrome profile (security), persistent across sessions (UX), uses tooling already in user's workflow (agent-browser).

### Handoff sequence

1. User clicks "Looks good" on the final card.
2. Tool POSTs to the retailer's add-to-cart endpoint (Shopify: `/cart/add.js`; Tier-1: handler-specific).
3. On success, tool redirects the browser tab to the retailer's `cart_url`.
4. User reviews cart, applies discount codes, completes checkout themselves.

### Why we stop at cart, not checkout

- Avoids storing or accessing payment methods
- User reviews the order before paying (last-mile safety)
- Sidesteps "the AI bought me $400 of stuff" failure mode
- Discount codes, gift cards, address selection happen in the retailer's flow where they're already optimized

## 7. Local web UI server

Tool spins up a local server on a random localhost port when a request starts. Serves:

- `/thumbs/<request-id>` — 8-card grid with up/down buttons; decisions sent back to the tool over WebSocket
- `/final/<request-id>` — single big card with "Looks good — add to cart" button and "see 2 alternatives" link
- `/cart-redirect/<request-id>` — transitions tab to retailer cart URL after handoff

Server lifecycle: started on request, shut down after handoff or on user dismiss. Random port + request-id token prevent cross-request leakage.

Server runs in the same Node process as the retailer handlers.

## 8. Storage layout

```
~/.claude/cart/
├── profile.md           # hard facts + thumb log + purchase log (Section 3)
├── retailers.md         # supported retailers + per-retailer login state
├── requests/
│   └── 2026-05-10-sweater-abc123.md   # one file per request: criteria, candidates shown, thumbs, pick, outcome
├── browser-profile/     # agent-browser session data (cookies, etc.)
└── log                  # rotating debug log (rotates at 500 lines, like social-credit)
```

Everything user-facing is human-readable markdown. Only the browser profile is binary (managed by agent-browser).

`retailers.md` example:

```markdown
---
last_updated: 2026-05-10
---

| host | tier | handler | logged_in | last_used |
|---|---|---|---|---|
| amazon.com | 1 | amazon | yes | 2026-05-08 |
| ikea.com | 1 | ikea | no | — |
| marinelayer.com | 2 | shopify | yes | 2026-04-22 |
```

## 9. Plugin structure

Mirrors `social-credit`'s layout. Lives in the `yuncun` marketplace as a third plugin.

```
plugins/superpowers-for-shopping/
├── .claude-plugin/plugin.json
├── commands/
│   ├── cart.md             # /cart "I need a sweater"
│   ├── cart-setup.md       # one-time profile setup
│   ├── cart-feedback.md    # "did you keep the X?"
│   ├── cart-rule.md        # promote learned signal to hard rule
│   └── cart-retailers.md   # list / add / login to retailers
├── hooks/
│   └── hooks.json
├── hooks-handlers/
│   ├── session-start.sh    # surface pending feedback prompts
│   └── feedback.sh
├── retailers/
│   ├── shopify.js          # generic Tier 2
│   ├── amazon.js           # Tier 1
│   ├── ikea.js
│   ├── uniqlo.js
│   └── west-elm.js
├── server/
│   └── ui.js               # local web UI server (Node)
├── lib/
│   ├── profile.js          # profile read/write
│   ├── ranking.js          # candidate ranking from profile signals
│   └── browser.js          # agent-browser wrapper
└── rubric.md               # ranking signals + decision principles for the LLM
```

### Runtime

Handlers, server, and ranking are **Node.js**. Bash is used only for hooks and slash-command shims that invoke the Node entrypoints.

Rationale: per-retailer HTML parsing is required for some Tier-1 sites; bash + grep is not the right tool. Node also gives proper async, jsdom/cheerio for parsing, and clean WebSocket support for the UI server.

### Slash commands

| Command | Purpose |
|---|---|
| `/cart "<need>"` | Main entry — search, narrow, cart-load |
| `/cart-setup` | Run the 60s profile setup wizard |
| `/cart-feedback` | Mark a past purchase kept / returned |
| `/cart-rule "<rule in natural language>"` | Promote a learned signal to a hard frontmatter rule. The model translates the natural-language rule into a structured frontmatter update (e.g., `"stop suggesting cropped fits"` → `fit_notes.sweater += "never cropped"`) and shows the diff for user confirmation before writing |
| `/cart-retailers` | List supported retailers; sub-actions: add, login, remove |

### Hooks

`SessionStart` runs `session-start.sh`, which:
- Checks if any purchase in profile.md is 7+ days old with `kept: ?`
- If yes, emits a one-line nudge: `"Quick: did you keep the sweater from 2026-05-03? Run /cart-feedback to log it."`
- No hook on `SessionEnd` in v1.

## 10. Failure modes and handling

| Failure | Behavior |
|---|---|
| No candidates after search | Tool says so, suggests broadening criteria or adding a retailer; does NOT silently degrade |
| Item out of stock at handoff | Tool re-runs add_to_cart with next-best variant; if still none, returns to thumb grid with the others |
| Retailer login expired | Tool opens login page, prompts user, retries handoff |
| Retailer handler fails (selectors broken) | Tool degrades to Tier-3 deep link, logs the failure |
| User dismisses the browser tab | Tool waits 5 minutes, logs as "abandoned," cleans up server |
| Multiple concurrent requests | Each request gets its own port and request-id; no cross-talk |

## 11. Open questions / deferred decisions

- **Ranking heuristic specifics** — exact weights for "profile match" vs "aesthetic variance" in candidate selection. Defer until we have real thumb data.
- **Pinterest ingestion** — out of v1, viable for v2 if Pinterest's API or scraping holds up.
- **Virtual try-on** — v3+ feature. Upload a baseline photo; image-edit model renders garments on it before the thumbs step.
- **Cross-retailer dedup** — when the same product (e.g., a Nike sneaker) shows up on Amazon and Nike.com, do we show both or dedupe?
- **Affiliate links** — should the tool support affiliate tagging for self-funding? Privacy + transparency considerations.
- **Gift mode** — different sizes, different addresses, different recipient. Probably a `/cart gift "<recipient>"` variant in v2.

## 12. Non-goals (explicit)

- Solving the "best deal on the internet" problem.
- Comparing prices across retailers (the recommendation is the recommendation).
- Tracking package deliveries.
- Returns processing.
- Storing payment methods.
- Auto-purchasing without user click.
