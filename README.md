# superpowers-for-shopping

Low-friction shopping for Claude Code. Type `/cart "a new sweater"`, watch the spinner, and end with a real, populated cart at each of your stores — one click away from reviewing.

Designed for the "I hate shopping" case: the threat of a sweater already being in your cart is easier than the project of deciding to buy a sweater.

## How it works

```
You:  /cart "a new sweater"
       │
       ▼  (browser tab opens, spinner)
       │
  Search your configured retailers in parallel.
  Profile-based filter (brand_avoid, budget caps).
  Diversified pick: 5 items, max ~2 per store.
       │
       ▼
  ┌──────────────────────────────────────────┐
  │  5 picks queued                          │
  │                                          │
  │  [img] Marine Layer  Aria Crewneck $118  │
  │  [img] Everlane      Boxy Sweater  $76   │
  │  [img] Marine Layer  Greyson Polo  $128  │
  │  [img] Everlane      Wide-Neck    $125   │
  │  [img] Marine Layer  Icon Sweater  $128  │
  │                                          │
  │       [ Review your 2 carts → ]          │
  └──────────────────────────────────────────┘
       │
       ▼  (click)
  Two tabs open: marinelayer.com/cart and everlane.com/cart,
  each pre-populated with their picks. Checkout from there.
```

## Commands

- `/cart "<query>"` — the main flow.
- `/cart-profile` — open the profile/retailers settings UI in a browser tab.

## Setup

1. Install via the [`yuncun`](https://github.com/Yuncun/ai-social-credit) plugin marketplace.
2. Run `/cart-profile` once and set sizes, budget cap, brands you love/avoid.
3. Make sure your browser is logged into the retailers you want to use (visit them and sign in once). The plugin doesn't store cookies — your normal browser session is what populates the cart.

## Profile (`~/.claude/cart/profile.md`)

Markdown with YAML frontmatter. Edit by hand or via the Retailers tab. Fields:

- `sizes` — `{top, bottom, shoes, ...}` informs ranking (no hard filter yet)
- `budget_default` — `low | mid | high`
- `budget_caps` — `{clothes: 200}` — hard ceiling per category
- `palette` — color tokens (passively learned from things you cart)
- `brands_love` — promoted in ranking
- `brands_avoid` — filtered out completely
- `fit_notes` — free-text per-category notes

Purchase history is appended to as you cart; no kept/returned tracking, no nudges.

## Retailers

Currently Shopify-only. Default list (configurable via `/cart-profile`):

- marinelayer.com · allbirds.com · everlane.com · mejuri.com

Add any Shopify-detected store via the Retailers tab.

## Scope

In: discretionary, considered, non-recurring purchases (clothes, lifestyle goods, gifts).
Out: replenishables (toothpaste), high-stakes (cars, real estate), and full auto-checkout (we stop at "populated cart, please review").

## License

MIT
