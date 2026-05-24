---
description: [deprecated] Use /cart-profile instead. Opens the Feedback tab.
argument-hint: (no arguments)
---

The user just ran `/cart-feedback`. As of v0.14.0 this command is a deprecated alias for `/cart-profile`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js" --tab=feedback
```

When the script exits, surface the outcome (last line of stdout), then add a one-liner:

> Heads up: `/cart-feedback` is now part of `/cart-profile` (Feedback tab). Same UI either way.

Outcome mapping is identical to `/cart-profile` — see `commands/cart-profile.md`.
