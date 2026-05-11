---
description: Start a one-click shopping flow for a clothing/lifestyle item.
argument-hint: <what you need>
---

The user just ran `/cart $ARGUMENTS`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-flow.js" "$ARGUMENTS"
```

This is an interactive flow. The script will:
1. Search retailers for the query.
2. Open a browser tab showing 8 candidates with thumbs up/down buttons.
3. Wait for the user to thumb and click "Show me the best one."
4. Show a final card with accept/cancel.
5. On accept, add to cart and redirect the browser to the retailer's cart.

While the script is running, the user is interacting with their browser. Don't interrupt. Surface the final outcome (last line of stdout) when the script exits.

If the outcome is `auth_required`, tell the user to run `npm run smoke:browser` in the plugin directory to establish a session, then retry.
