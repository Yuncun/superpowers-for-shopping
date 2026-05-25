---
description: Shop low-friction. Query → 5 picks already in real carts → one Review button.
argument-hint: <what you need>
---

The user just ran `/cart $ARGUMENTS`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-flow.js" "$ARGUMENTS"
```

This is a browser-driven flow. The script will:
1. Open a browser tab with a live status panel.
2. Search the user's configured retailers in parallel and stream progress.
3. Pick the top 5 candidates that pass profile filters (budget, brand prefs),
   diversified across retailers (max 2 per store).
4. Show those 5 cards in the browser with one "Review your carts" button.
5. When the user clicks Review: open the retailer cart permalinks in new tabs.
   Each tab adds the variants to the user's real logged-in cart and lands on
   the cart page. Checkout is up to the user.

While the script is running, the user is interacting with their browser. Don't
interrupt. Surface the final outcome (last line of stdout) when the script exits.

Outcomes:
- `outcome=reviewed carts="<host(n),...>"` — user clicked Review; carts opened.
- `outcome=no_results query="..."` — searches returned nothing usable.
- `outcome=no_retailers` — empty retailers list. Tell the user to add some via `/cart-profile`.
- `outcome=dismissed` — user closed the tab without reviewing.
