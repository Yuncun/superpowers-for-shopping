# Plan 9 — Ranking Heuristics + `/cart-rule` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make `/cart` actually use the profile data the user has been entering. Ranking heuristics filter and reorder candidates per `brands_avoid`, `brands_love`, and `budget_caps`. `/cart-rule` lets the user say things like "stop suggesting cropped fits" and have the LLM translate that into a structured profile update. This closes out the original v1 roadmap.

**Architecture:** New pure module `lib/ranking.js` exports `applyRanking(candidates, profile)`. `runCartFlow` calls it after dedup, before slicing to 8. `/cart-rule` is an LLM wizard that reads profile, parses NL, proposes a structured diff via `bin/cart.js set`, asks user to confirm before writing.

**Tech Stack:** Node 20+ ESM. No new deps.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — profile schema.
2. `lib/flow.js` and `test/flow.test.js` — orchestration extension point.
3. `commands/cart-setup.md` — LLM-wizard pattern.
4. `bin/cart.js`'s `set` subcommand — used by /cart-rule.

Process rules:
- DI for testability.
- Adversarial-input tests upfront.
- Validate at boundaries.

## What's NOT in this plan

- No aesthetic-variance ranking. The spec mentions this as a future feature; for v0.9.0 we just apply hard filters and brand preferences in listing order.
- No category inference. `budget_caps.clothes` is the only budget applied; the others are ignored.
- No `sizes` filter at thumb-pick time. Plan 5's variant picker is unchanged — still `variants[0]`.
- No clarifying questions before search. We just apply profile defaults silently.
- No automatic learning. /cart-rule is the ONLY way new structured profile data gets created post-setup.

## Ranking heuristics

`applyRanking(candidates, profile)`:

1. **Drop candidates where brand matches `brands_avoid`** (case-insensitive, substring match — "Shein" matches "Shein, Inc.").
2. **Drop candidates where `parseFloat(price) > profile.budget_caps.clothes`** (skipped if `budget_caps.clothes` is absent or `price` is unparseable).
3. **Reorder:** candidates with `brand` matching `brands_love` (case-insensitive substring) come first. Preserve original order within each group.
4. Return the reordered, filtered array.

Profile shape (relevant fields):
```yaml
brands_love: [Marine Layer, Uniqlo]
brands_avoid: [Shein, Temu]
budget_caps:
  clothes: 200
```

Edge cases:
- Empty `brands_love` / `brands_avoid` arrays → no filtering/reordering on that axis.
- Empty `budget_caps` object → no budget filter.
- All candidates filtered out → return empty array. Flow then returns `{outcome: 'no_results'}`.
- `price === null` (no variants) → KEEP the candidate (we don't filter on missing data).

## `/cart-rule` flow (LLM-driven)

User: `/cart-rule "stop suggesting cropped fits"`

LLM does:
1. Reads current profile via `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js show`.
2. Parses the user's rule. Maps to a structured update — one of:
   - `brands_avoid` += new brand
   - `brands_love` += new brand
   - `fit_notes.<category>` = string (replace or append)
   - `sizes.<axis>` = value
   - `palette` += color (or -= for removal)
   - `budget_caps.<category>` = number
3. Shows the user: "Proposed change: <diff>. Confirm? [y/n]"
4. On `y`: runs `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js set <key>=<json-value>`.
5. On `n`: discards.

The slash command is mostly LLM prompting. The actual storage write reuses the Plan 1 `set` subcommand.

## File structure

| File | Change | LOC |
|---|---|---|
| `lib/ranking.js` | new pure module | ~80 |
| `test/ranking.test.js` | new unit tests | ~200 |
| `lib/flow.js` | call applyRanking | +~5 |
| `test/flow.test.js` | + 2 tests for ranking integration | +60 |
| `commands/cart-rule.md` | LLM wizard | ~70 lines |

---

## Tasks

### Task 1: `lib/ranking.js` + tests

**Files:**
- Create: `lib/ranking.js`
- Create: `test/ranking.test.js`

```js
export function applyRanking(candidates, profile);
// Pure. Synchronous. Throws on programmer error (non-array candidates or
// non-object profile). Tolerant of missing profile fields.
```

**Tests (~14 cases):**

1. Empty candidates → empty array.
2. Empty profile (`{}`) → returns candidates unchanged (no filtering).
3. brands_avoid drops matching brand (exact case-insensitive match).
4. brands_avoid uses substring match: `'shein'` in profile drops `'Shein, Inc.'` brand.
5. brands_avoid empty array → no drops.
6. brands_love reorders matching brands to the front. Preserves order within each group.
7. brands_love empty → no reorder.
8. brands_love + brands_avoid combined: avoid drops apply BEFORE love reorders.
9. budget_caps.clothes drops candidates with `parseFloat(price) > limit`.
10. budget_caps.clothes absent → no budget filter.
11. budget_caps.clothes present but price is `null` → KEEP the candidate.
12. budget_caps.clothes present but price is `'$98.50'` (with $) → parseFloat handles it correctly.
13. All candidates filtered out → empty array.
14. Adversarial: profile with `brands_avoid: null` → no crash, no filtering (treat as empty array).

**Implementation hints:**
- Use `String.prototype.toLowerCase()` and `.includes()` for brand matching.
- `parseFloat(String(price).replace(/[^\d.]/g, ''))` to handle prices with currency prefixes.
- Coerce profile.brands_avoid to `[]` if not an array.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 233 (Plan 8 baseline) + 14 = 247 passing.

- [ ] **Step 6: Commit:** `"Add lib/ranking.js with brand and budget heuristics"`

---

### Task 2: Wire ranking into `runCartFlow`

**Files:**
- Modify: `lib/flow.js`
- Modify: `test/flow.test.js`

Currently `runCartFlow` reads profile but doesn't use it. Wire it through ranking:

```js
const profile = await readProfile();
// ... search ...
// after dedup, before slice(0, 8):
const ranked = applyRanking(candidates, profile);
const top8 = ranked.slice(0, 8);
// then push thumbs with top8
```

Import `applyRanking` from `lib/ranking.js`. No new dep needed.

If `ranked.length === 0` → return `{outcome: 'no_results'}` (same as if search returned nothing).

**Tests (~2 new):**

1. `runCartFlow` calls `applyRanking(candidates, profile)` where `candidates` is the deduped list. Use a spy injected via deps. Optional: replace the import with an injected `applyRanking` to make this testable. EITHER approach works — pick whichever is cleaner.
2. If `applyRanking` returns empty array, flow returns `{outcome: 'no_results'}` (even if raw search returned 8 candidates).

**Recommendation:** add `applyRanking` to deps. Default to the real impl. Tests inject a spy/stub. This is consistent with how every other external function is wired.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 247 + 2 = 249 passing.

- [ ] **Step 6: Commit:** `"Apply ranking heuristics in runCartFlow"`

---

### Task 3: `commands/cart-rule.md` LLM wizard

**Files:**
- Create: `commands/cart-rule.md`

```markdown
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
```

No tests for this — it's LLM-driven prompting that calls existing Plan 1 storage.

- [ ] **Step 1: Write `commands/cart-rule.md`**
- [ ] **Step 2: Run full suite (sanity)**

Expected: 249 passing.

- [ ] **Step 3: Commit:** `"Add /cart-rule LLM wizard"`

---

### Task 4: Ship v0.9.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status**

`**Status:** v0.9.0 — profile data now shapes search results. `brands_avoid` drops banned stores, `brands_love` reorders favorites to the front, `budget_caps.clothes` filters by price. `/cart-rule "<natural language>"` promotes a preference to a hard rule. v0.9.0 closes out the v1 roadmap.`

- [ ] **Step 2: Bump versions to 0.9.0**

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.9.0 — 2026-05-11

Ranking heuristics + the `/cart-rule` wizard. The profile data the user
has been entering since v0.1.0 finally gets used.

- New `lib/ranking.js`: `applyRanking(candidates, profile)` drops banned
  brands and over-budget items, reorders loved brands to the front.
- `runCartFlow` wires ranking into the pipeline after dedup, before
  taking the top 8.
- New `commands/cart-rule.md` LLM wizard. Translates "stop suggesting
  cropped fits" or "never show me Shein" into a structured profile
  update, shows the diff, writes via the existing `cart set` subcommand.

This closes the v1 roadmap. The plugin now does what the original spec
described: profile setup, multi-retailer Shopify search, browser session,
visual narrowing UI, in-flow login retry, purchase feedback loop, and
profile-driven ranking.

Open spec items deferred to a v2 roadmap:
- Tier-1 custom handlers (Amazon, IKEA, Uniqlo, West Elm).
- Aesthetic variance ranking (Plan 9 has hard filters but no spread).
- Pinterest moodboard ingestion.
- Virtual try-on.
- Cross-retailer dedup beyond identical-URL.
- Affiliate links.
- Gift mode.
```

- [ ] **Step 4: Run full suite**

Expected: 249 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.9.0 — ranking heuristics and /cart-rule"
git push origin main
```

---

## Self-review checklist

- [ ] All 4 tasks committed.
- [ ] `npm test` shows 249 passing.
- [ ] `applyRanking` is pure (no I/O).
- [ ] `runCartFlow` calls ranking AFTER dedup, BEFORE slicing to 8.
- [ ] `brands_avoid` works case-insensitively and via substring.
- [ ] Empty `applyRanking` result returns no_results outcome.
- [ ] No new runtime deps.
- [ ] v1 roadmap is complete.
