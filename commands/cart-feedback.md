---
description: Mark recent /cart purchases as kept or returned.
argument-hint: (no arguments)
---

The user just ran `/cart-feedback`. Walk them through marking their pending purchases.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js list-pending` to get the pending purchases (jsonlines format).

2. If the output is empty: tell the user "No pending purchases to review" and stop.

3. Otherwise, for each pending purchase (process in order, one at a time):

   - Ask: "Did you keep the {item} from {brand} (purchased {date} for ${price})? [yes / no / skip]"
   - Allow optional notes after the yes/no answer.
   - On `yes` or `no`: run `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js feedback "<date>" "<item>" "<brand>" "<yes|no>" "<notes>"`. Surface the result.
   - On `skip`: don't call the script; move to the next pending purchase.

4. When done with all pending purchases: thank the user briefly.

Keep the tone brisk and warm. Don't lecture. Aim for under 30s total time.
