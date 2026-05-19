---
description: Set up or update your shopping profile in a single-page form.
---

The user just ran `/cart-setup`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-setup-flow.js"
```

This is an interactive flow. The script will:
1. Read the user's existing profile (creating defaults if none exists).
2. Open a browser tab showing a single form pre-populated with their current values: sizes, budget, brands, fit notes, optional moodboard URL.
3. Wait for the user to click **Save profile** (or **Cancel**).
4. Validate and write the merged profile to `~/.claude/cart/profile.md`.

While the script is running, the user is interacting with their browser. Don't interrupt. Surface the final outcome (last line of stdout) when the script exits.

Map the outcome to a one-line message:
- `outcome=success changes=N` (N>0) → "Profile saved — N field(s) updated."
- `outcome=success changes=0`     → "Profile saved; no changes."
- `outcome=dismissed`              → "Canceled — nothing saved."
- `outcome=flow_error reason="..."` → "Couldn't open the setup window: <reason>."

The list of changed fields is printed on stderr (one per line, indented). Surface it verbatim if there are any.

## Anti-patterns

- **Don't ask follow-up questions.** The form covers everything — sizes, budget, brands, fit notes, moodboard URL. If the user has more to say, they'll say it.
- **Don't auto-launch /cart afterward.** Saving the profile is the end of the task.

## Tone

Brisk and warm. Don't lecture.
