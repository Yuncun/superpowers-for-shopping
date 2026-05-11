# Plan 8 — Purchase Feedback + SessionStart Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Close the feedback loop. Successful `/cart` flows write purchase rows to the profile with `kept: ?`. `/cart-feedback` walks pending purchases and asks the user whether they kept each one. A SessionStart hook nudges the user when purchases are 7+ days old and still pending.

**Architecture:** Extends `lib/profile.js` with two new operations: `listPendingPurchases` and `updatePurchase`. `runCartFlow` calls `appendPurchase` on success. `commands/cart-feedback.md` is an LLM wizard; `hooks/session-start.sh` runs a tiny Node helper that prints a nudge.

**Tech Stack:** Node 20+ ESM. Bash for the hook (consistent with ai-social-credit pattern). `jq` for the hook's JSON output.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — process notes, profile schema.
2. `lib/profile.js` and `test/profile.test.js` — the file you're extending.
3. `bin/cart.js` and the `cart-setup` slash command — the wizard pattern.
4. `/Users/ericshen/Studio/ai-social-credit/plugins/social-credit/hooks-handlers/session-start.sh` — bash hook reference.
5. `lib/flow.js` and `test/flow.test.js` — the orchestrator change.

Process rules from prior plans:
- Spec behavior, not implementation.
- Adversarial input upfront.
- Validate at boundaries.
- Bundle related TDD.

## What's NOT in this plan

- No `/cart-rule` (Plan 9).
- No ranking heuristics (Plan 9).
- No clarifying questions (Plan 9).
- No purchase removal/undo.
- No multi-row update — one (date, item, brand) tuple updates one row.

## Profile extensions

`purchase_history` rows already have a `kept` column from Plan 1. Currently the only writer is `appendPurchase`. Plan 8 adds:

- `kept: '?'` is the pending state. Rows get this on a successful `/cart` flow.
- `kept: 'yes'` and `kept: 'no'` are the resolved states. `/cart-feedback` writes these.
- `notes` column may contain `''` initially and a short string after feedback.

New profile.js exports:

```js
export async function listPendingPurchases();
// → array of {date, item, brand, '$': price, kept, notes} where kept === '?'

export async function updatePurchase({ date, item, brand }, { kept, notes });
// → { updated: true } | { updated: false, reason: 'not_found' }
// Matches the row by exact (date, item, brand) tuple. The first match wins
// if multiples exist (shouldn't happen, but document the tiebreaker).
// `kept` must be 'yes' or 'no'. Programmer error to pass '?'.
// `notes` is optional; if omitted, leaves existing notes untouched.
```

## Hook + helper

`hooks/hooks.json`:
```json
{
  "description": "superpowers-for-shopping",
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }] }]
  }
}
```

`hooks/session-start.sh`:
- Calls `node ${CLAUDE_PLUGIN_ROOT}/bin/cart-pending-check.js` and captures stdout.
- If stdout is non-empty, wraps it in `{systemMessage: $msg}` via `jq` and prints.
- If stdout is empty (no pending), silent exit 0.

`bin/cart-pending-check.js`:
- Imports `listPendingPurchases` from `lib/profile.js`.
- Filters to rows where `date <= today - 7 days`.
- If none → exits 0 with no output.
- If 1 → prints `Quick: did you keep the <item> from <date>? Run /cart-feedback to log it.` to stdout.
- If 2+ → prints `Quick: you have N pending purchases to confirm. Run /cart-feedback to log them.` to stdout.

## File structure

| File | Change | LOC |
|---|---|---|
| `lib/profile.js` | + listPendingPurchases, updatePurchase | +60 |
| `test/profile.test.js` | + ~8 tests | +120 |
| `bin/cart.js` | + list-pending, feedback subcommands | +35 |
| `lib/flow.js` | + appendPurchase call on success | +10 |
| `test/flow.test.js` | + 2 tests (success writes pending row; failure doesn't write) | +60 |
| `commands/cart-feedback.md` | LLM wizard | ~50 lines |
| `hooks/session-start.sh` | + nudge logic | ~25 lines |
| `bin/cart-pending-check.js` | Helper | ~40 LOC |
| `hooks/hooks.json` | + SessionStart entry | small |

---

## Tasks

### Task 1: `lib/profile.js` extensions + tests

**Files:**
- Modify: `lib/profile.js`
- Modify: `test/profile.test.js`

Add `listPendingPurchases` and `updatePurchase` per the spec above.

**`listPendingPurchases` behavior:**
- Read profile.
- Filter `purchase_history` rows where `kept === '?'`.
- Return array of row objects.

**`updatePurchase` behavior:**
- Read profile.
- Find first row matching `(date, item, brand)`.
- Not found → `{updated: false, reason: 'not_found'}`.
- Validate `kept ∈ ['yes', 'no']`. Otherwise throw `Error('invalid_kept')` with `.code = 'invalid_kept'`.
- Update `kept` (and optionally `notes`) on that row.
- Write profile.
- Return `{updated: true}`.

**Tests (~8 cases):**

1. `listPendingPurchases` on an empty profile → `[]`.
2. After appending one purchase with `kept: '?'`, `listPendingPurchases` returns one row.
3. After appending a `kept: 'yes'` row, `listPendingPurchases` ignores it.
4. `updatePurchase` matches by exact (date, item, brand) tuple → `{updated: true}` and the row's `kept` is now 'yes'.
5. `updatePurchase` updates `notes` when provided.
6. `updatePurchase` preserves existing `notes` when not provided.
7. `updatePurchase` with no matching row → `{updated: false, reason: 'not_found'}`. Profile unchanged.
8. `updatePurchase` with invalid `kept` value → throws `invalid_kept`. Profile unchanged.

Use the existing `mkdtemp`-and-restore-HOME test pattern from `test/retailers-store.test.js`.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 223 (Plan 7 baseline) + 8 = 231 passing.

- [ ] **Step 6: Commit:** `"Add listPendingPurchases and updatePurchase to profile"`

---

### Task 2: `bin/cart.js` new subcommands

**Files:**
- Modify: `bin/cart.js`

Add:
- `cart list-pending` → prints one JSON object per line (jsonlines): `{"date":"2026-05-11","item":"5\" Tailored Swim Trunk","brand":"Marine Layer","$":"94.00","kept":"?","notes":""}`. If none, prints nothing.
- `cart feedback <date> <item> <brand> <yes|no> [notes]` → calls `updatePurchase`. Prints `updated=yes/no` on success, `error=<reason>` otherwise. Exit 0 / 1.

No new tests in this task — `bin/cart.js` shim is already exercised by Plan 1's tests, and the underlying functions are tested in Task 1.

- [ ] **Step 1: Add the subcommands**
- [ ] **Step 2: `node --check bin/cart.js`**
- [ ] **Step 3: Run full suite (sanity)**

Expected: 231 passing.

- [ ] **Step 4: Commit:** `"Add list-pending and feedback subcommands to cart CLI"`

---

### Task 3: `runCartFlow` writes pending purchase on success

**Files:**
- Modify: `lib/flow.js`
- Modify: `test/flow.test.js`

On the success path (right before pushing the redirect state), call `appendPurchase({date: today, item: top.title, brand: top.brand, '$': top.price, kept: '?', notes: ''})`.

Add `appendPurchase` to deps. Default to `null` for tests; production wires `lib/profile.js`'s impl. Also add `now: () => '2026-05-11'` (today as YYYY-MM-DD string) to deps for testability.

Update `bin/cart-flow.js`: import `appendPurchase` from `lib/profile.js` and add to deps. Add a `now` impl too.

**Tests (~2 new):**

1. **Happy path writes a pending purchase:** `runCartFlow` reaching the success path calls `appendPurchase` exactly once with `{date: <now>, item, brand, $: price, kept: '?', notes: ''}`. Verify via spy.
2. **Non-success outcomes do NOT write:** `runCartFlow` exiting with `canceled` or `dismissed` does NOT call `appendPurchase`. (Two assertions in one test or two short tests — either is fine.)

Update the existing success-path tests: they need an `appendPurchase` spy in deps (just a no-op `async () => {}`), and a `now` impl (default `() => '2026-05-11'`). These additions are minor; should be a 5-line diff per affected test.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Update existing success-path tests with new deps**
- [ ] **Step 3: Run — verify failures**
- [ ] **Step 4: Implement the appendPurchase call**
- [ ] **Step 5: Run — verify pass**
- [ ] **Step 6: Run full suite**

Expected: 231 + 2 = 233 passing.

- [ ] **Step 7: Commit:** `"Write pending purchase row on successful /cart flow"`

---

### Task 4: `commands/cart-feedback.md` slash command

**Files:**
- Create: `commands/cart-feedback.md`

LLM-driven wizard. Pattern after `commands/cart-setup.md`.

```markdown
---
description: Mark recent /cart purchases as kept or returned.
argument-hint: (no arguments)
---

The user just ran `/cart-feedback`. Walk them through marking their pending purchases.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js list-pending` to get the pending purchases (jsonlines format).

2. If empty: tell the user "No pending purchases to review" and stop.

3. Otherwise, for each pending purchase (process in order, one at a time):

   - Ask: "Did you keep the {item} from {brand} (purchased {date} for ${price})? [yes / no / skip]"
   - Allow optional notes after the yes/no.
   - On `yes` or `no`: run `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js feedback "<date>" "<item>" "<brand>" "<yes|no>" "<notes>"`. Surface success.
   - On `skip`: don't call the script; move to the next pending purchase.

4. When done with all pending: thank the user briefly.

Keep the tone brisk and warm. Don't lecture. Aim for under 30s total time.
```

No tests. Wizard is LLM-driven.

- [ ] **Step 1: Write `commands/cart-feedback.md`**
- [ ] **Step 2: Run full suite (sanity)**

Expected: 233 passing.

- [ ] **Step 3: Commit:** `"Add /cart-feedback wizard slash command"`

---

### Task 5: SessionStart hook + Node helper

**Files:**
- Create: `bin/cart-pending-check.js`
- Create: `hooks/session-start.sh`
- Modify: `hooks/hooks.json`

**`bin/cart-pending-check.js`:**
- Import `listPendingPurchases` from `lib/profile.js`.
- Compute `cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000)`.
- Filter pending rows where `date <= cutoff` (string comparison on `YYYY-MM-DD` works fine).
- If 0 → exit 0 silently.
- If 1 → print `Quick: did you keep the <item> from <date>? Run /cart-feedback to log it.`
- If 2+ → print `Quick: you have N pending purchases to confirm. Run /cart-feedback to log them.`
- Exit 0 in all cases.
- On any error (profile read fails) → exit 0 silently (NEVER block session start with an error).

**`hooks/session-start.sh`:**

```bash
#!/bin/bash
# Surface a feedback nudge for old pending purchases.
MSG=$(node "${CLAUDE_PLUGIN_ROOT}/bin/cart-pending-check.js" 2>/dev/null)
if [ -n "$MSG" ]; then
  jq -nc --arg msg "$MSG" '{systemMessage: $msg}'
fi
exit 0
```

Make executable.

**`hooks/hooks.json`:**

```json
{
  "description": "superpowers-for-shopping",
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }] }]
  }
}
```

No new tests for the hook (it's a thin shell wrapper). The helper can have a tiny test:

- [ ] **Step 1: Write `bin/cart-pending-check.js`** (no tests for the helper — it's a thin CLI shim, exercised manually).
- [ ] **Step 2: Write `hooks/session-start.sh`** and `chmod +x`.
- [ ] **Step 3: Update `hooks/hooks.json`**.
- [ ] **Step 4: Manual sanity:** with a synthetic profile containing a kept='?' purchase dated 2026-05-01 (10 days old), run `node bin/cart-pending-check.js` and confirm it prints a nudge.
- [ ] **Step 5: Run full suite**.

Expected: 233 passing (no new tests in this task).

- [ ] **Step 6: Commit:** `"Add SessionStart hook for pending purchase nudges"`

---

### Task 6: Ship v0.8.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status**

`**Status:** v0.8.0 — purchases now feed back into your profile. Successful `/cart` flows record a pending purchase; `/cart-feedback` walks you through marking them kept or returned. A SessionStart hook nudges you when items are 7+ days old and still pending. Plan 9 adds ranking heuristics and `/cart-rule`.`

- [ ] **Step 2: Bump versions to 0.8.0**

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.8.0 — 2026-05-11

Purchase feedback loop. Successful `/cart` flows record a pending row in
`profile.purchase_history`; `/cart-feedback` walks the user through marking
each kept or returned.

- `lib/profile.js`: + `listPendingPurchases`, `updatePurchase`.
- `bin/cart.js`: + `list-pending`, `feedback` subcommands.
- `runCartFlow` writes `{kept: '?'}` row on success.
- New `commands/cart-feedback.md` LLM wizard.
- New `hooks/session-start.sh` + `bin/cart-pending-check.js` nudge the
  user when items have been pending 7+ days.

v0.8.0 deferrals (Plan 9):
- No `/cart-rule` for promoting learned signals to hard rules.
- No ranking heuristics — still naive top-N by thumb count and listing order.
- No clarifying questions before search.
```

- [ ] **Step 4: Run full suite**.

Expected: 233 passing.

- [ ] **Step 5: Commit and push**:

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.8.0 — purchase feedback loop"
git push origin main
```

---

## Self-review checklist

- [ ] All 6 tasks committed.
- [ ] `npm test` shows 233 passing.
- [ ] `hooks/session-start.sh` is executable and produces a nudge for a 10-day-old pending purchase.
- [ ] `appendPurchase` is wired in `bin/cart-flow.js` AND mocked correctly in `test/flow.test.js`.
- [ ] No new runtime deps.
