---
description: Set up or update your shopping profile (sizes, palette, brand affinities, budget).
---

You are running the `cart-setup` wizard for the user. The user is initializing or updating their shopping profile, which will be used by the `/cart` command to make purchase recommendations.

## Instructions

1. Read the current profile by running: `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" show`. If this fails, run `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" init` first, then `show`. Parse the JSON output.

2. Walk the user through these questions, ONE AT A TIME. If the current profile already has a value, surface it as the default and let them keep, edit, or skip. Be concise — this is an ADHD-helper, not a survey.

   1. **Sizes** — top (S/M/L/XL), bottom (waist x inseam), shoes. Ask in one message, accept one-line answers.
   2. **Default budget tier** — low / mid / high. One question.
   3. **Per-category budget caps (optional)** — clothes $cap, furniture $cap. If they say "skip," leave empty.
   4. **Color palette** — favorite colors, comma-separated. Three-to-six items typical.
   5. **Brands you love** — comma-separated. Examples to prompt them if they freeze: Marine Layer, Uniqlo, Aritzia, IKEA, West Elm, Patagonia, J.Crew. If they only know a couple, that's fine.
   6. **Brands you avoid** — comma-separated. Common picks: Shein, Temu. If none, "none" is a valid answer.
   7. **Fit notes (optional, free text)** — any fit preferences they want recorded, e.g. "prefer relaxed sweater fits, tapered pants."
   8. **Pinterest URL (optional)** — leave blank to skip; we won't consume it yet.

3. After each answer, write the value via `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set <key>=<value>`. Use JSON syntax for arrays and objects, plain string otherwise. Examples:
   - `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set sizes.top=M`
   - `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set budget_default=mid`
   - `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set 'brands_love=["Marine Layer","Uniqlo"]'`
   - `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set 'palette=["navy","cream","olive"]'`

4. After the last question, run `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set last_setup=$(date +%Y-%m-%d)` then `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" show`, then summarize the final profile back to the user in a short paragraph.

5. Tone: brisk and warm. Don't lecture. If they skip something, move on without comment. Total time target: under 90 seconds.

## Anti-patterns

- Do not ask all questions in one message. One at a time.
- Do not write the profile.md directly via Read/Edit. Always use `bin/cart.js set` so validation runs.
- Do not validate or moralize their brand choices. If they love Shein, that's not your call.
- Do not ask for things the spec hasn't authorized (income, address, payment method).
