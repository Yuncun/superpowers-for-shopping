# superpowers-for-shopping

An ADHD-helper Claude Code plugin that takes "I need a new sweater" to a populated shopping cart with one click. Handles the rote work of searching, narrowing, and cart-loading; leaves you only the high-bandwidth aesthetic call and final approval.

**Status:** v0.10.0 — `/cart-setup` is now a brief brainstorm rather than an 8-question survey. Opens with one free-form prompt, extracts what it can, fills only the gaps with preset-backed questions. Drops the palette question; palette is learned passively from thumb-accept signals in `/cart`.

## Scope

In — discretionary, considered, non-recurring purchases: clothes, furniture, lifestyle goods, gifts.
Out — replenishables (toothpaste, coffee), high-stakes (cars, real estate), and full auto-checkout (we stop at cart).

## How it works (one-paragraph)

You say `"I need a sweater"`. The plugin loads your persistent profile (sizes, palette, brand affinities), asks 1–2 clarifying questions, searches a curated set of retailers, and opens a browser tab with 8 candidates. You thumbs-up/down them in ~10 seconds. The plugin picks the best one, you click "Looks good," and it's in your real logged-in cart on the retailer. You finish checkout yourself.

## Part of

The [`yuncun`](https://github.com/Yuncun/ai-social-credit) plugin marketplace.

## License

MIT
