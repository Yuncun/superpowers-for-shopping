---
description: One tabbed UI for your shopping profile, retailers, and pending purchase feedback.
argument-hint: (no arguments)
---

The user just ran `/cart-profile`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js"
```

This is an interactive flow. The script opens a browser tab with three tabs:
- **Profile** — sizes, budget, brands, fit notes, optional moodboard URL.
- **Retailers** — list of stores `/cart` searches; add or remove.
- **Feedback** — pending purchases waiting to be marked Kept / Returned / Skip.

The page stays open until the user closes the tab (or clicks Cancel where present). Each tab has its own Save button — saves are independent, so they can edit a few things on one tab and ignore the others.

While the script is running, the user is interacting with their browser. Don't interrupt. Surface the final outcome (last line of stdout) when the script exits.

Map the outcome to a one-line message:
- `outcome=success actions=N` (N>0) → "Closed — N change(s) saved."
- `outcome=success actions=0`     → "Closed — no changes."
- `outcome=dismissed actions=N`   → same as success (page closed; N may be 0).
- `outcome=flow_error reason="..."` → "Couldn't open the profile window: <reason>."

Tone: brisk and warm. Don't lecture.

## Permission allowlist (optional)

If the user hits a permission prompt for `node`, suggest adding this to their `~/.claude/settings.json` `permissions.allow` list:

```
"Bash(node \"${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js\":*)"
```
