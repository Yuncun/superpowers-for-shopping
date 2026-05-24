---
description: [deprecated] Use /cart-profile instead. Edit brands/fit/sizes directly on the Profile tab.
argument-hint: (arguments ignored)
---

The user just ran `/cart-rule`. As of v0.14.0 this command is a deprecated alias for `/cart-profile`. The natural-language "promote a rule" shortcut has been removed — the Profile tab now exposes every field explicitly, so adding "Shein" to `brands_avoid` is one click.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js" --tab=profile
```

When the script exits, surface the outcome (last line of stdout), then add a one-liner:

> Heads up: `/cart-rule` has been folded into `/cart-profile`. Edit `brands_love` / `brands_avoid` / `fit_notes` / `sizes` directly on the Profile tab. Any arguments you passed were ignored.

Outcome mapping is identical to `/cart-profile` — see `commands/cart-profile.md`.
