---
description: Tabbed UI for your shopping profile and retailer list.
argument-hint: (no arguments)
---

The user just ran `/cart-profile`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js"
```

The script opens a browser tab with two tabs:
- **Profile** — sizes, budget, brands_love, brands_avoid, fit notes, moodboard URL.
- **Retailers** — the stores `/cart` searches; add or remove.

The page stays open until the user closes the tab. Each tab has its own Save
button — saves are independent.

While the script is running, the user is interacting with their browser. Don't
interrupt. Surface the final outcome (last line of stdout) when the script exits.

Map the outcome to a one-line message:
- `outcome=success actions=N` (N>0) → "Closed — N change(s) saved."
- `outcome=success actions=0`     → "Closed — no changes."
- `outcome=dismissed actions=N`   → same as success (page closed).
- `outcome=flow_error reason="..."` → "Couldn't open the profile window: <reason>."

Tone: brisk and warm.

## Permission allowlist (optional)

If the user hits a permission prompt for `node`, suggest adding this to their `~/.claude/settings.json` `permissions.allow` list:

```
"Bash(node \"${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js\":*)"
```
