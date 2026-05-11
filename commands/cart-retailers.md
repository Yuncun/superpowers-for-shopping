---
description: List or manage the retailers your /cart flow searches.
argument-hint: list | add <host> | remove <host> | login <host>
---

The user just ran `/cart-retailers $ARGUMENTS`.

Parse `$ARGUMENTS`:
- If empty or `list` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js list` and surface output.
- If starts with `add ` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js add <host>` and surface output.
- If starts with `remove ` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js remove <host>` and surface output.
- If starts with `login ` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js login <host>` and surface output.

For `add`: surface a friendly message based on outcome.
  - `added=<host>`: "Added <host> to your retailers list."
  - `error=duplicate`: "<host> is already in your list."
  - `error=not_shopify`: "<host> isn't a Shopify-detected store. v0.6.0 only supports Shopify retailers."
  - `error=invalid_host`: "That host doesn't look right. Pass a bare domain like `marinelayer.com`."

For `remove`: surface a friendly message based on outcome.
  - `removed=<host>`: "Removed <host> from your retailers list."
  - `error=not_found`: "<host> isn't in your list."

For `login`: surface a friendly message based on outcome.
  - `opened=<host>`: "Opening the login page for <host> in your browser. Come back and run `/cart` once you're logged in."
  - `error=<code>`: "Couldn't open the login page for <host>: <code>."

For `list`: display the retailers as a table showing host, tier, handler, and last used date.
