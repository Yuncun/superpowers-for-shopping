# superpowers-for-shopping

A Low-friction helper Claude Code plugin that takes "I need a new sweater" to a populated shopping cart with one click. Handles the rote work of searching, narrowing, and cart-loading; leaves you only the high-bandwidth aesthetic call and final approval.

**Status:** v0.11.0 — `/cart` is now testable end-to-end without a human in the loop. Protocol-level harness drives the flow via SSE + POST; live dry-run script (`npm run e2e:cart`) runs real flows against real retailers and opens any resulting cart URL in the browser.

## Scope

In — discretionary, considered, non-recurring purchases: clothes, furniture, lifestyle goods, gifts.
Out — replenishables (toothpaste, coffee), high-stakes (cars, real estate), and full auto-checkout (we stop at cart).

## How it works (one-paragraph)

You say `"I need a sweater"`. The plugin loads your persistent profile (sizes, palette, brand affinities), asks 1–2 clarifying questions, searches a curated set of retailers, and opens a browser tab with 8 candidates. You thumbs-up/down them in ~10 seconds. The plugin picks the best one, you click "Looks good," and it's in your real logged-in cart on the retailer. You finish checkout yourself.

## Part of

The [`yuncun`](https://github.com/Yuncun/ai-social-credit) plugin marketplace.

## License

MIT
