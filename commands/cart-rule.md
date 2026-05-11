---
description: Promote a natural-language preference into a hard profile rule.
argument-hint: "<rule in natural language>"
---

The user just ran `/cart-rule $ARGUMENTS`. Their rule is a free-form preference they want enforced going forward.

Walk them through promoting it to a structured profile rule:

1. Run `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js show` and parse the JSON output to understand the current profile.

2. Parse the user's rule. Map it to ONE of these update shapes:
   - **Banned brand:** `brands_avoid` += `[<brand>]`
   - **Loved brand:** `brands_love` += `[<brand>]`
   - **Fit preference:** `fit_notes.<category>` = `<string>` (category is sweater/pants/shoes/etc, inferred from the rule)
   - **Size:** `sizes.<axis>` = `<value>` (axis is top/bottom/shoes)
   - **Palette:** `palette` += `[<color>]` or `palette` -= `[<color>]`
   - **Budget:** `budget_caps.<category>` = `<number>`

   If the rule doesn't fit any of these, tell the user "I can't translate that into a structured rule. Try something more specific like 'never show me Shein' or 'I always wear size M tops'."

3. Show the user the proposed change in a clear diff:

   ```
   Proposed change:
     brands_avoid: [Shein] → [Shein, Temu]
   Confirm? [y/n]
   ```

4. On `y`: run `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js set <key>=<json-value>` to write. The `set` subcommand accepts JSON values, so arrays must be passed as JSON: `brands_avoid='["Shein","Temu"]'`. Print the success and exit.

5. On `n`: discard and tell the user "Got it, no change."

Tone: brisk, no lecturing.
