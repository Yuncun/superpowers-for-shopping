---
description: [deprecated] Use /cart-profile instead. Opens the Retailers tab.
argument-hint: (arguments ignored)
---

The user just ran `/cart-retailers`. As of v0.14.0 this command is a deprecated alias for `/cart-profile`. The previous `list | add | remove | login` subcommands are now handled directly in the UI's Retailers tab. Any arguments are ignored.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-profile-flow.js" --tab=retailers
```

When the script exits, surface the outcome (last line of stdout), then add a one-liner:

> Heads up: `/cart-retailers` is now part of `/cart-profile` (Retailers tab). Add/remove from the UI directly. The `login <host>` subcommand has been removed for now — open a /cart and use the agent-browser session if you need to authenticate.

Outcome mapping is identical to `/cart-profile` — see `commands/cart-profile.md`.
