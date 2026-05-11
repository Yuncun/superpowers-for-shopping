# superpowers-for-shopping

An ADHD-helper Claude Code plugin that takes "I need a new sweater" to a populated shopping cart with one click. Handles the rote work of searching, narrowing, and cart-loading; leaves you only the high-bandwidth aesthetic call and final approval.

**Status:** v0.5.0 — the `/cart` flow ships end-to-end against marinelayer.com. Type `/cart "I need a sweater"` to try it. Plan 6 adds multi-retailer + in-flow login. Design spec at [`docs/specs/2026-05-10-superpowers-for-shopping-design.md`](docs/specs/2026-05-10-superpowers-for-shopping-design.md).

## Scope

In — discretionary, considered, non-recurring purchases: clothes, furniture, lifestyle goods, gifts.
Out — replenishables (toothpaste, coffee), high-stakes (cars, real estate), and full auto-checkout (we stop at cart).

## How it works (one-paragraph)

You say `"I need a sweater"`. The plugin loads your persistent profile (sizes, palette, brand affinities), asks 1–2 clarifying questions, searches a curated set of retailers, and opens a browser tab with 8 candidates. You thumbs-up/down them in ~10 seconds. The plugin picks the best one, you click "Looks good," and it's in your real logged-in cart on the retailer. You finish checkout yourself.

## Part of

The [`yuncun`](https://github.com/Yuncun/ai-social-credit) plugin marketplace.

## License

MIT
