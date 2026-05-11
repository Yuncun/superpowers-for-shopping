# Plan 10 — `/cart-setup` UX Overhaul + Palette Auto-Population

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make `/cart-setup` feel like a brainstorm, not a tax form. Replace the linear 8-question survey with a hybrid flow: open prompt → extract what's there → fill only the gaps with targeted, preset-backed questions → final diff. Drop the palette question entirely; the system will learn palette from thumb-up selections during `/cart` flows.

**Architecture:** Two pieces. (1) `commands/cart-setup.md` rewrite to the hybrid LLM flow. (2) `lib/palette-extractor.js` pure module + integration in `runCartFlow`: when a user accepts a final product, extract color tokens from its variants/title and append unique ones to `profile.palette`. Capped at 8 entries.

**Tech Stack:** Node 20+ ESM. No new deps.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — profile schema (especially `palette: []`).
2. `commands/cart-setup.md` — current wizard (to be replaced).
3. `commands/cart-rule.md` — the diff/confirm pattern we're partly mimicking.
4. `lib/flow.js` — orchestrator we're extending.
5. `lib/profile.js` — `mergeFrontmatter` and `updateFrontmatter` already exist; use them rather than touching the file directly.

Process rules:
- DI for all I/O in the new module.
- Pure extractor — no profile reads inside `palette-extractor.js`. Caller reads + merges.
- Validate at boundaries.
- Adversarial-input tests upfront.

## What's NOT in this plan

- No changes to `cart-feedback` or `cart-rule`. They're already conversational; leave alone.
- No NL extraction of palette during cart-setup. The setup wizard never asks about colors; the only path to populating palette is via thumb-accept signal in `/cart`.
- No purchase-history-driven palette inference (only the current accept). We can broaden later.
- No moodboard ingestion. Pinterest URL is still captured if the user volunteers it, but not used.
- No batch-cell editor for `cart-feedback`. Out of scope.

## Why this design

Approach C (hybrid) from the design discussion:
- **Open prompt first** is the brainstorm-feel signature. One question reads more like a conversation than eight.
- **Extract + targeted gap-fill** keeps us honest — we don't ask things we already know, and the user doesn't repeat themselves.
- **Presets** ("Common: 30x30, 32x32, 34x32") give the user a multiple-choice escape hatch when they freeze on an open-ended question.
- **Final diff + confirm** mirrors the `cart-rule` pattern the user already likes.
- **Drop palette field** because the question was bad ("which single color do you like best?" is not how anyone decides clothing style). Thumb-up signals are richer.

## Palette extractor design

`extractColorsFromProduct(product)` returns an array of normalized color tokens (lowercase, deduped, trimmed). Input shape (from candidates):

```js
{
  title: 'Marine Wool Crewneck',
  brand: 'Marine Layer',
  price: '$98.50',
  url: 'https://marinelayer.com/products/marine-wool-crewneck',
  variants: [
    { variant_id: 123, size: 'M', color: 'Navy Heather', price: '$98.50' },
    // ...
  ],
}
```

Extraction rules (in order):
1. If `variants[0].color` is a non-empty string, split on whitespace/commas, lowercase, trim. Drop tokens in `IGNORED_COLOR_TOKENS` (`['heather', 'melange', 'marl', 'wash', 'fade', 'space']`). Keep first 2 tokens.
2. If step 1 yielded nothing, scan `title` for tokens in `KNOWN_COLOR_TOKENS` (curated list: `navy`, `cream`, `olive`, `charcoal`, `black`, `white`, `grey`, `gray`, `tan`, `beige`, `khaki`, `rust`, `forest`, `sand`, `stone`, `oat`, `bone`, `ivory`, `slate`, `indigo`, `denim`, `mustard`, `burgundy`, `wine`, `camel`, `cognac`, `sage`, `mint`, `coral`, `blush`, `rose`, `mauve`, `lavender`, `plum`, `terracotta`, `ochre`, `mocha`, `espresso`, `chocolate`, `pine`, `moss`, `sky`, `ocean`).
3. If both steps yielded nothing → return `[]`.

The caller (flow) then:
- Reads `profile.palette` (current value).
- Filters extracted tokens to those NOT already in palette (case-insensitive).
- Appends up to the cap (palette max = 8). If we'd overflow, append none of them — never silently drop user-set entries.
- If nothing to add → no-op (don't write the profile).
- Otherwise write via `updateFrontmatter({ palette: [...existing, ...new] })`.

This is a "passive learning" feature — silent on the UI, just shows up in the user's profile over time.

## Hybrid wizard contract

The LLM wizard does this in order (one section per turn until done):

1. **Read existing profile.** Run `cart.js show`, parse JSON. Initialize working profile `current`. Initialize `proposed = {}` (the diff to apply).

2. **Open prompt.** Send a single message:
   > "Tell me how you shop — what you wear, sizes, brands you like or hate, fit preferences, budget. No pressure to cover everything; whatever you remember is fine."

3. **Extract into structured diff.** Parse the user's free-form reply into the schema fields. Map natural language:
   - "medium" / "M" → `sizes.top = 'M'`
   - "32 by 32" / "32x32" → `sizes.bottom = '32x32'`
   - "$200 for clothes" → `budget_caps.clothes = 200`
   - "I like Uniqlo" → `brands_love` += `['Uniqlo']`
   - "hate Shein" → `brands_avoid` += `['Shein']`
   - "relaxed sweater fits" / "tapered pants" → `fit_notes.tops = 'relaxed'` / `fit_notes.pants = 'tapered'`
   - Tier words ("budget", "luxury") → `budget_default` ∈ `low/mid/high`
   - Anything ambiguous → don't auto-extract; ask about it later in step 5.

4. **Show extraction diff.** Render a compact diff message:
   ```
   Here's what I picked up:
     sizes.top: → M
     sizes.bottom: → 32x32
     brands_love: → [Uniqlo]
     fit_notes.tops: → relaxed, no v-necks
   
   Still need: shoes size, budget cap for clothes, brands to avoid
   
   Look right so far? Anything to fix?
   ```
   Wait for response. If they correct anything, update `proposed`. If they say "good" / "yes" / similar, proceed.

5. **Gap-fill (only for missing fields).** Ask ONE question per turn for each unset field, in this order, skipping any already populated by extraction or already in `current`:
   - `sizes.top` → "Top size? Common: S / M / L / XL."
   - `sizes.bottom` → "Bottom — waist x inseam? Common: 30x30, 32x32, 34x32."
   - `sizes.shoes` → "Shoe size? Whole or half number."
   - `budget_default` → "Default budget tier — low / mid / high? Sets the spend range when you don't specify a cap."
   - `budget_caps.clothes` → "Max you'd spend on a single clothing item? (number, or 'skip')"
   - `brands_love` → "Brands you reach for? Examples: Marine Layer, Uniqlo, Aritzia, Patagonia. ('skip' if none come to mind.)"
   - `brands_avoid` → "Brands to avoid? Most people start with Shein and Temu. ('none' is fine.)"
   - `fit_notes` → "Any fit preferences worth recording? e.g. 'tapered pants, relaxed tops, no v-necks'. ('skip' if no.)"

   **DO NOT** ask about palette. **DO NOT** ask about Pinterest URL during gap-fill — only mention it as a final aside (step 7).

   Each answer goes into `proposed` immediately; no `cart.js set` calls until step 6.

6. **Final diff + confirm.** Render the consolidated diff:
   ```
   Final profile changes:
     sizes: { top: M, bottom: 32x32, shoes: 11.5 }
     budget_default: high
     budget_caps: { clothes: 200 }
     brands_love: [Uniqlo]
     brands_avoid: [Shein, Temu]
     fit_notes: { tops: "relaxed, no v-necks", pants: "tapered" }
   
   Write? [y/n]
   ```
   On `y`: apply each field via `cart.js set`, then `cart.js set last_setup=<today>`, then `cart.js show` and confirm briefly. On `n`: "No changes saved." and stop.

7. **Optional Pinterest mention.** After write, one final line: "Got a moodboard URL you want stored for later? (We don't use it yet but Plan 12 will.) Otherwise we're done." If they paste one → `cart.js set moodboard_url=<value>`. If they skip → done.

8. **Final summary.** One sentence: "Profile saved. `/cart "<query>"` is ready when you are."

### Anti-patterns

- Asking about palette. The field is no longer populated from setup.
- Asking all gap-fill questions in one message. One at a time, even though you have a checklist.
- Skipping the extraction-diff step. The whole point of this design is that the user sees what we heard.
- Writing fields immediately during extraction. Wait for the final confirm.
- Lecturing or moralizing on brand choices.

## File structure

| File | Change | LOC |
|---|---|---|
| `lib/palette-extractor.js` | new pure module | ~70 |
| `test/palette-extractor.test.js` | new unit tests | ~180 |
| `lib/flow.js` | call palette extractor on accept | +~15 |
| `test/flow.test.js` | + 3 tests for palette integration | +90 |
| `commands/cart-setup.md` | full rewrite | ~120 lines |

---

## Tasks

### Task 1: `lib/palette-extractor.js` + tests

**Files:**
- Create: `lib/palette-extractor.js`
- Create: `test/palette-extractor.test.js`

**Public surface:**

```js
export function extractColorsFromProduct(product);
// Returns Array<string> of lowercased color tokens.
// Pure. Synchronous. Returns [] when no signal can be extracted.
// Never throws on missing/malformed product fields — returns [] instead.

export function mergePaletteCandidates(existingPalette, newTokens, max = 8);
// Returns a new array. Case-insensitive dedup against existing entries.
// Order preserved. If appending new tokens would exceed max, returns existing
// unchanged (do NOT partially append — keep behavior all-or-nothing per call).
```

**Tests (~12 cases for extractColorsFromProduct, ~6 for mergePaletteCandidates):**

extractColorsFromProduct:
1. variants[0].color = 'Navy Heather' → `['navy']` (heather is in IGNORED).
2. variants[0].color = 'Olive' → `['olive']`.
3. variants[0].color = 'Navy / Cream' → `['navy', 'cream']` (split on `/`).
4. variants[0].color = 'Forest Green' → `['forest', 'green']` (both tokens kept; green is in KNOWN).
5. variants[0].color empty AND title contains 'Charcoal Wool Crewneck' → `['charcoal']` (from title).
6. variants[0].color empty AND title contains no known color → `[]`.
7. No variants array → falls through to title scan; returns title-extracted or `[]`.
8. product is `{}` → `[]`.
9. product is `null` or `undefined` → `[]`.
10. variants[0].color = 'Heather Grey' → `['grey']` (heather filtered, grey kept).
11. variants[0].color = 'Space-Dyed Charcoal' → `['charcoal']` (space filtered).
12. Title scan is case-insensitive: 'NAVY Crew' → `['navy']`.

mergePaletteCandidates:
13. Empty palette + `['navy']` → `['navy']`.
14. Palette `['Navy']` + new `['navy']` → `['Navy']` (case-insensitive dedup; existing kept).
15. Palette `['navy', 'olive']` + new `['cream']` → `['navy', 'olive', 'cream']`.
16. Palette at max (8 items) + new `['cream']` → returns existing 8 (no append).
17. Palette `['navy']` + new `['navy', 'cream']` (one dup, one new) → `['navy', 'cream']` (dedup applied, then append).
18. Palette `['navy']` + new `[]` → `['navy']` (no-op).

**Implementation hints:**
- `IGNORED_COLOR_TOKENS` and `KNOWN_COLOR_TOKENS` as module-level `Set`s.
- Color string normalization: `s.toLowerCase().split(/[\s,/]+/).map(t => t.trim()).filter(Boolean)`.
- For the title scan, walk the curated KNOWN list and check `title.toLowerCase().split(/\W+/).includes(token)`. Avoid substring (don't match 'navyish' on 'navy').
- For `mergePaletteCandidates`, build a `lowerSet` of existing palette and filter new tokens through it before checking the cap.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 249 (Plan 9 baseline) + 18 = 267 passing.

- [ ] **Step 6: Commit:** `"Add lib/palette-extractor.js for thumb-signal palette learning"`

---

### Task 2: Wire palette extractor into `runCartFlow`

**Files:**
- Modify: `lib/flow.js`
- Modify: `test/flow.test.js`

After the `if (appendPurchase)` block in the success path (file:`lib/flow.js` around line 153), add a palette-learning step. New deps in the destructure:

```js
deps: {
  ...
  appendPurchase = null,
  extractColors = defaultExtractColors,       // NEW
  mergePalette = defaultMergePalette,         // NEW
  updateProfile = null,                       // NEW (optional, like appendPurchase)
  ...
}
```

Defaults imported from `./palette-extractor.js`.

Insertion point (after appendPurchase, before the redirect push):

```js
if (updateProfile) {
  const newTokens = extractColors(top);
  if (newTokens.length > 0) {
    const merged = mergePalette(profile.palette || [], newTokens);
    if (merged.length > (profile.palette || []).length) {
      await updateProfile({ palette: merged });
    }
  }
}
```

Note: `profile` was already read at the top of `runCartFlow` (line 28). Reuse it; do NOT re-read.

`bin/cart-flow.js` provides `updateProfile: updateFrontmatter` from `lib/profile.js`. Default behavior preserved when `updateProfile` is null (back-compat for any direct callers).

**Tests (~3 new):**

1. Flow with `updateProfile` injected: when extractor returns tokens not in profile.palette, `updateProfile` is called with the merged palette.
2. Flow with extractor returning `[]`: `updateProfile` is NOT called.
3. Flow with all tokens already in palette: `updateProfile` is NOT called (no-op write).

Use a spy for `updateProfile` (it's an injected dep already). Use stub `extractColors` / `mergePalette` deps to make the test deterministic — don't rely on the real color tables.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement (add deps, insert block, wire defaults)**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 267 + 3 = 270 passing.

- [ ] **Step 6: Commit:** `"Wire palette extraction into runCartFlow success path"`

---

### Task 3: Wire `updateFrontmatter` into `bin/cart-flow.js`

**Files:**
- Modify: `bin/cart-flow.js`

Currently `cart-flow.js` constructs the `deps` object passed to `runCartFlow`. Add:

```js
import { updateFrontmatter } from '../lib/profile.js';
// in deps:
updateProfile: updateFrontmatter,
```

Defaults for `extractColors` / `mergePalette` come from `palette-extractor.js` via the flow module itself; no need to inject them here unless you want explicit wiring (recommended explicit for grep-discoverability).

- [ ] **Step 1: Add import + deps line**
- [ ] **Step 2: Run `npm run smoke:flow` locally to confirm no crash on import**

Expected: smoke script exits cleanly (it mocks addToCart but exercises the real wiring path).

- [ ] **Step 3: Run full suite (sanity)**

Expected: 270 passing.

- [ ] **Step 4: Commit:** `"Wire updateFrontmatter into cart-flow CLI deps"`

---

### Task 4: Rewrite `commands/cart-setup.md`

**Files:**
- Modify: `commands/cart-setup.md` (full rewrite)

Replace the entire file content with the spec from the "Hybrid wizard contract" section above. Concrete deliverable:

```markdown
---
description: Set up or update your shopping profile through a brief conversation.
---

You are running the `cart-setup` wizard for the user. The user is initializing or updating their shopping profile, which the `/cart` command uses to make recommendations.

This is a conversational flow, not a form. Walk the user through it in distinct sections; do not collapse multiple sections into one message.

## Section 1 — Read existing profile

Run: `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" show`. If it errors, run `init` first then `show`. Parse the JSON.

Note which fields are already populated. Treat any non-default value as "known"; you'll skip gap-fill for those.

## Section 2 — Open prompt

Send exactly ONE message:

> Tell me how you shop — what you wear, sizes, brands you like or hate, fit preferences, budget. No pressure to cover everything; whatever you remember is fine.

## Section 3 — Extract into a structured diff

Parse the user's reply. Build an internal `proposed` object — DO NOT call `cart.js set` yet. Map natural language:

- "medium" / "M" / "size M" → `sizes.top = "M"` (likewise S/L/XL/XXL)
- "32 by 32" / "32x32" / "32 32" → `sizes.bottom = "32x32"`
- "size 11" / "11.5" / "11 and a half" → `sizes.shoes` (numeric)
- "$200 for clothes" / "200 max" → `budget_caps.clothes = 200`
- "$3000 for furniture" / "3000 lamp" → `budget_caps.furniture = 3000`
- "budget" / "cheap" / "low end" → `budget_default = "low"`; "mid" → `"mid"`; "premium" / "luxury" / "high end" → `"high"`
- "I like X" / "I love X" / "I wear X" → `brands_love += ["X"]`
- "hate X" / "avoid X" / "no X" → `brands_avoid += ["X"]`
- "relaxed tops" / "no v-necks" / "nothing tight" → `fit_notes.tops = "relaxed, no v-necks, nothing tight"`
- "tapered pants" / "slim fit" → `fit_notes.pants = "tapered"`
- Anything you're unsure about: don't auto-extract. Ask in gap-fill.

## Section 4 — Show the extraction diff

Render a compact diff message:

\`\`\`
Here's what I picked up:
  sizes.top: → M
  sizes.bottom: → 32x32
  brands_love: → [Uniqlo]
  fit_notes.tops: → relaxed, no v-necks

Still need: shoes size, budget cap, brands to avoid

Look right so far? Anything to fix?
\`\`\`

Wait for response. If the user corrects something, update `proposed`. If they confirm, proceed.

## Section 5 — Gap-fill

For each of these fields that is NOT in `proposed` AND NOT already populated in the existing profile, ask ONE question per turn. Use this order:

1. **sizes.top** — "Top size? Common: S / M / L / XL."
2. **sizes.bottom** — "Bottom — waist x inseam? Common: 30x30, 32x32, 34x32."
3. **sizes.shoes** — "Shoe size? Whole or half number."
4. **budget_default** — "Default budget tier — low / mid / high?"
5. **budget_caps.clothes** — "Max for a single clothing item? (number, or 'skip')"
6. **brands_love** — "Brands you reach for? Examples: Marine Layer, Uniqlo, Aritzia, Patagonia. ('skip' if none.)"
7. **brands_avoid** — "Brands to avoid? Most people start with Shein and Temu. ('none' is fine.)"
8. **fit_notes** — "Any fit preferences? e.g. 'tapered pants, relaxed tops, no v-necks'. ('skip' if no.)"

**Never ask about palette.** **Never ask about Pinterest URL during gap-fill.**

Each answer goes into `proposed`. No writes yet.

## Section 6 — Final diff and confirm

Render the consolidated diff of everything in `proposed`:

\`\`\`
Final profile changes:
  sizes: { top: M, bottom: 32x32, shoes: 11.5 }
  budget_default: high
  budget_caps: { clothes: 200 }
  brands_love: [Uniqlo]
  brands_avoid: [Shein, Temu]
  fit_notes: { tops: "relaxed, no v-necks", pants: "tapered" }

Write? [y/n]
\`\`\`

On `y`: for each field, run the appropriate `cart.js set` command. Use JSON for arrays and objects:

- `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set sizes.top=M`
- `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set budget_default=high`
- `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set 'brands_love=["Uniqlo"]'`
- `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set 'fit_notes={"tops":"relaxed, no v-necks","pants":"tapered"}'`

Then `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" set last_setup=$(date +%Y-%m-%d)`.

Then `node "${CLAUDE_PLUGIN_ROOT}/bin/cart.js" show` to confirm. Briefly summarize.

On `n`: print "No changes saved." and stop.

## Section 7 — Optional Pinterest

After write, one final line:

> Got a moodboard URL you want stored for later? (We don't use it yet but Plan 12 will.) Otherwise we're done.

If they paste one → `cart.js set moodboard_url=<value>`. If they skip → "Profile saved. `/cart "<query>"` when you're ready."

## Anti-patterns

- Asking about palette. The field is no longer populated from setup; thumb-up signals during /cart fill it instead.
- Asking all gap-fill questions in one message. One at a time.
- Writing fields during extraction or gap-fill. Wait for the final confirm.
- Validating or moralizing on brand choices.
- Asking for things not in the schema (income, address, payment method).
- Lecturing about why a question matters.

## Tone

Brisk, warm, conversational. The user is impatient. Total time target: under 60 seconds for a fresh profile, under 30 for an update.
```

Validate by rendering mentally: the file should be readable as instructions to a future LLM session with no extra context.

- [ ] **Step 1: Replace `commands/cart-setup.md`**
- [ ] **Step 2: Run full suite (sanity — no test depends on this file but confirm nothing broke)**

Expected: 270 passing.

- [ ] **Step 3: Commit:** `"Rewrite /cart-setup as hybrid conversational wizard"`

---

### Task 5: Ship v0.10.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status line**

Replace the current status with:

`**Status:** v0.10.0 — `/cart-setup` is now a brief brainstorm rather than an 8-question survey. Opens with one free-form prompt, extracts what it can, fills only the gaps with preset-backed questions. Drops the palette question; palette is learned passively from thumb-accept signals in `/cart`.`

- [ ] **Step 2: Bump versions to 0.10.0**

In `package.json` and `.claude-plugin/plugin.json`.

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.10.0 — 2026-05-11

`/cart-setup` UX overhaul. The wizard now opens with one free-form prompt,
extracts what it can parse, then targets gap-fill questions only at the
fields that didn't come out of extraction. Final diff + confirm before any
write — no more eight-message linear survey.

- Rewrote `commands/cart-setup.md` as a six-section hybrid flow.
- Dropped the palette question. It was a poor proxy for taste (asking
  someone's favorite single color doesn't predict what they actually buy).
- New `lib/palette-extractor.js`: extracts color tokens from a product's
  variant color field or title, falling back to a curated 40-item color
  vocabulary.
- `runCartFlow` now learns the palette passively. On final accept, the
  picked product's colors are merged into `profile.palette` (case-insensitive
  dedup, capped at 8 entries).

Open spec items still deferred (no change from v0.9.0): Tier-1 handlers,
aesthetic variance ranking, Pinterest moodboard ingestion, virtual try-on,
cross-retailer dedup, affiliate links, gift mode.
```

- [ ] **Step 4: Run full suite**

Expected: 270 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.10.0 — /cart-setup UX overhaul and passive palette learning"
git push origin main
```

---

## Self-review checklist

- [ ] All 5 tasks committed.
- [ ] `npm test` shows 270 passing.
- [ ] `lib/palette-extractor.js` is pure (no I/O, no profile reads).
- [ ] Flow palette write only happens on final-accept success path, not on dismissed/canceled/auth_required.
- [ ] Flow does NOT write when extractor returns `[]` OR when all tokens are already in palette.
- [ ] `commands/cart-setup.md` never mentions palette.
- [ ] `commands/cart-setup.md` never asks all questions in one message.
- [ ] No new runtime deps.
- [ ] Palette cap (8) is respected — never silently overflows or drops user-set entries.
