---
description: Mark recent /cart purchases as kept or returned.
argument-hint: (no arguments)
---

The user just ran `/cart-feedback`.

Run this Bash command:
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/cart-feedback-flow.js"
```

This is an interactive flow. The script will:
1. Read pending purchases from the user's profile.
2. If there are none, exit immediately with `outcome=empty`.
3. Otherwise, open a browser tab showing every pending purchase as a Kept / Returned / Skip checklist with an optional notes field per item.
4. Wait for the user to click **Save feedback** (or **Cancel**).
5. Persist each Kept/Returned decision to `profile.md` (Skip rows stay pending).

While the script is running, the user is interacting with their browser. Don't interrupt. Surface the final outcome (last line of stdout) when the script exits.

Map the outcome to a one-line message:
- `outcome=empty` → "No pending purchases to review."
- `outcome=success kept=K returned=R skipped=S errors=0` → "Saved — K kept, R returned, S skipped."
- `outcome=success ... errors=N` (N>0) → "Saved with N issue(s); see stderr above."
- `outcome=dismissed` → "Canceled — nothing saved."
- `outcome=flow_error reason="..."` → "Couldn't open the feedback window: <reason>."

Tone: brisk and warm. Don't lecture.

## Add a permission allowlist hint (optional)

If the user hits a permission prompt for the `node` invocation, suggest adding this to their `~/.claude/settings.json` `permissions.allow` list:

```
"Bash(node \"${CLAUDE_PLUGIN_ROOT}/bin/cart-feedback-flow.js\":*)"
```
