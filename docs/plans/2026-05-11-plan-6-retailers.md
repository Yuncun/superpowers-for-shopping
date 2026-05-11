# Plan 6 — Retailer Management + Multi-Retailer Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace v0.5.0's hardcoded single-retailer list with a real configurable store at `~/.claude/cart/retailers.md`. Ship `/cart-retailers` slash command for list/add/remove. Multi-retailer search aggregation in `runCartFlow`. Defaults to 4 popular Shopify stores if the file is missing.

**Architecture:** Mirrors Plan 1's pattern — markdown frontmatter + a table body, read/write via `lib/retailers-store.js`, CLI shim at `bin/retailers.js`, LLM-driven slash command at `commands/cart-retailers.md`. Plan 5's `runCartFlow` gets a small extension to read retailer hosts from the store instead of accepting them as a hardcoded array.

**Tech Stack:** Node 20+ ESM. Reuses `js-yaml` from Plan 1. No new deps.

---

## Context for the implementer

Read first:
1. `docs/plans/2026-05-10-plan-1-profile-as-shipped.md` — process notes, especially the validate-before-write pattern and adversarial-input testing.
2. `lib/profile.js` — your blueprint for `lib/retailers-store.js`. Same shape: parse frontmatter, parse table, validate, write atomically.
3. `bin/cart.js` — your blueprint for `bin/retailers.js`. Subcommand router, exit codes, structured errors.
4. `docs/plans/2026-05-11-plan-5-cart-flow.md` — Plan 5's scope cuts. This plan picks up the "hardcoded retailer list" cut.
5. `lib/retailers/shopify.js` `detect(host)` — used by the add subcommand to verify a host is Shopify.

Process rules (all enforced by review):
- Spec behavior, not implementation. TDD pins behavior.
- Adversarial-input tests in the original task.
- Validate at the boundary. CLI add → store row only if `detect` returns true.
- Bundle related TDD tasks.
- Imports resolve at parse time.

## What's NOT in this plan

- No `/cart-retailers login` subcommand. Plan 7 adds login.
- No in-flow login retry. Plan 7.
- No Tier-1 handlers (Amazon, IKEA, etc.). Tier-2 (Shopify) only.
- No retailer removal of the default file (uninstall behavior is undefined).
- No automatic detection-on-search-failure. If a retailer in the file is broken, search throws and flow surfaces an error.

## Storage layout

`~/.claude/cart/retailers.md`:

```markdown
---
last_updated: 2026-05-11
---

# Retailers

| host | tier | handler | last_used |
|---|---|---|---|
| marinelayer.com | 2 | shopify | 2026-05-11 |
| allbirds.com | 2 | shopify |  |
| everlane.com | 2 | shopify |  |
| mejuri.com | 2 | shopify |  |
```

The columns:
- `host` — bare hostname (normalized per `lib/host.js`)
- `tier` — `1` (Tier-1 custom) or `2` (Tier-2 generic Shopify). Only `2` is supported in v0.6.0.
- `handler` — `shopify` for Tier-2. Future: `amazon`, `ikea`, etc.
- `last_used` — `YYYY-MM-DD` or empty. Updated by `runCartFlow` after a successful search hits the retailer.

Default file (written by `bin/retailers.js init` and auto-created on first read if missing) is the 4-row table above with all `last_used` empty.

**No `logged_in` column in v0.6.0** — that goes in Plan 7 with the login subcommand. v0.6.0 assumes logged-in-or-not is a runtime question handled by the existing `getCookieHeader` check.

## API surface

```js
// lib/retailers-store.js
export function getDefaultRetailers();
// → array of {host, tier, handler, last_used}

export async function readRetailers();
// → { last_updated, retailers: [{host, tier, handler, last_used}, ...] }
//   Auto-creates the file with defaults if missing.

export async function writeRetailers({ last_updated, retailers });
// → void. mkdir-recursive. Sanitizes cell values.

export function validateRetailers(retailers);
// → { valid, errors }. Each retailer has non-empty host with at least one
//   dot, tier ∈ {1, 2}, non-empty handler.

export async function addRetailer({ host, tier, handler, fetchImpl, detectImpl });
// → { added: true } | { added: false, reason }
//   Validates host via normalizeHost. If tier === 2, runs detectImpl(host, {fetchImpl})
//   and refuses if !== true (returns {added: false, reason: 'not_shopify'}).
//   Duplicates → {added: false, reason: 'duplicate'}.

export async function removeRetailer(host);
// → { removed: true } | { removed: false, reason }
```

```js
// bin/retailers.js
// Subcommands: list | add | remove | init
```

```js
// runCartFlow extension
// Accepts retailers in two forms:
//   - { retailers: ['marinelayer.com'] }                                  // v0.5.0 form
//   - { } (no retailers field) → reads from lib/retailers-store.readRetailers()
```

## File structure

| File | Responsibility | LOC |
|---|---|---|
| `lib/retailers-store.js` | read/write/validate retailers.md, default list | ~140 |
| `bin/retailers.js` | CLI: list, add, remove, init | ~90 |
| `commands/cart-retailers.md` | LLM slash command | ~40 |
| `test/retailers-store.test.js` | Unit tests | ~220 |
| `lib/paths.js` | + `retailersPath` (already exists, no change needed) | unchanged |
| `lib/flow.js` | Extend to accept no-retailers form | small diff |
| `bin/cart-flow.js` | Drop hardcoded array, fall through to store | small diff |
| `test/flow.test.js` | + 3 tests for the no-retailers form | small diff |

---

## Tasks

### Task 1: `lib/retailers-store.js` + tests

**Files:**
- Create: `lib/retailers-store.js`
- Create: `test/retailers-store.test.js`

Mirror `lib/profile.js`'s structure. Use `js-yaml` with `{ schema: yaml.JSON_SCHEMA }`. Sanitize cell pipes/newlines on write. Lenient on missing trailing pipe on read.

`getDefaultRetailers()` returns:
```js
[
  { host: 'marinelayer.com', tier: 2, handler: 'shopify', last_used: '' },
  { host: 'allbirds.com',    tier: 2, handler: 'shopify', last_used: '' },
  { host: 'everlane.com',    tier: 2, handler: 'shopify', last_used: '' },
  { host: 'mejuri.com',      tier: 2, handler: 'shopify', last_used: '' },
]
```

`readRetailers()`:
- If file missing: write defaults via `writeRetailers`, then return `{last_updated: <today>, retailers: defaults}`.
- If present: parse frontmatter (must have `last_updated`), parse the markdown table.

`writeRetailers({last_updated, retailers})`:
- mkdir-recursive `~/.claude/cart/`.
- Compose frontmatter + the table with `host | tier | handler | last_used` columns. Sanitize cell values.

`validateRetailers(retailers)`:
- Every retailer: `host` is a non-empty string with at least one `.`. `tier ∈ [1, 2]`. `handler` is a non-empty string. `last_used` is `''` or matches `^\d{4}-\d{2}-\d{2}$`.

`addRetailer({host, tier=2, handler='shopify', fetchImpl, detectImpl})`:
- `normalizeHost(host)` → throw `invalid_host` on bad input.
- If existing retailer has the same host → return `{added: false, reason: 'duplicate'}`.
- If `tier === 2`: `await detectImpl(host, {fetchImpl})`. If false → `{added: false, reason: 'not_shopify'}`.
- If `tier === 1`: not supported in v0.6.0 → `{added: false, reason: 'tier1_not_supported'}`.
- Otherwise append a new row with `last_used: ''`, write, return `{added: true}`.

`removeRetailer(host)`:
- `normalizeHost(host)`.
- If not present → `{removed: false, reason: 'not_found'}`.
- Otherwise filter out the row, write, return `{removed: true}`.

**Tests (~20 cases):**

1. `getDefaultRetailers()` returns 4 entries with the expected hosts.
2. `readRetailers()` auto-creates file if missing (use `HOME=mkdtemp` injection — but `lib/paths.js` reads `process.env.HOME` at call time, so the implementer can `process.env.HOME = tmpDir` for the test).
3. `readRetailers` after auto-create writes a file with the 4 defaults.
4. `writeRetailers` then `readRetailers` round-trips the data.
5. `validateRetailers` accepts the default list.
6. `validateRetailers` rejects a retailer with no dot in host.
7. `validateRetailers` rejects `tier: 3`.
8. `validateRetailers` rejects `handler: ''`.
9. `validateRetailers` rejects `last_used` malformed.
10. `addRetailer` rejects `invalid_host` (throws).
11. `addRetailer({host: 'marinelayer.com', detectImpl: async () => true})` on an empty file adds the row and returns `{added: true}`.
12. `addRetailer` returns `{added: false, reason: 'duplicate'}` when the host is already in the list.
13. `addRetailer({tier: 2, detectImpl: async () => false})` returns `{added: false, reason: 'not_shopify'}` and does NOT add.
14. `addRetailer({tier: 1})` returns `{added: false, reason: 'tier1_not_supported'}`.
15. `removeRetailer('marinelayer.com')` removes a row and returns `{removed: true}`.
16. `removeRetailer('nonexistent.com')` returns `{removed: false, reason: 'not_found'}`.
17. Adversarial: a cell containing `|` is sanitized on write (`|` → `/`).
18. Adversarial: a cell containing `\n` is sanitized on write (newline → space).
19. Adversarial: a row without trailing pipe is read correctly.
20. After `addRetailer`, the new file's `last_updated` is set to today's `YYYY-MM-DD`. Use injected `now` to make this deterministic.

For tests #11-16: the test should reset `process.env.HOME` to a `mkdtemp` directory before each. Restore after.

**`now` injection:** Add an optional `{now}` param to `addRetailer` and `removeRetailer` (and `writeRetailers`). Default is `() => new Date().toISOString().slice(0,10)`. Test passes a stub returning `'2026-05-11'`.

- [ ] **Step 1: Write failing tests** (mirror `test/profile.test.js` shape)
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement `lib/retailers-store.js`**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 192 (Plan 5 baseline) + 20 = 212 passing.

- [ ] **Step 6: Commit:** `"Add retailers.md store with read/write/validate"`

---

### Task 2: `bin/retailers.js` CLI + `commands/cart-retailers.md`

**Files:**
- Create: `bin/retailers.js` (executable, 0o755)
- Create: `commands/cart-retailers.md`
- Modify: `package.json` (add bin entry)

`bin/retailers.js`:
- Shebang.
- Subcommands:
  - `list` → print one line per retailer: `host  tier  handler  last_used`.
  - `add <host>` → wire real `detect` from `lib/retailers/shopify.js`. Print outcome to stdout: `added=<host>` or `error=<reason>`.
  - `remove <host>` → print `removed=<host>` or `error=<reason>`.
  - `init` → forces `readRetailers()` (which creates the file if missing). Prints `initialized` on success or `already_exists` if file was already present.
- Exit 0 on success, 1 on error, 2 on bad usage.
- All status messages to stderr; stdout is the structured outcome line.

`commands/cart-retailers.md`:

```markdown
---
description: List or manage the retailers your /cart flow searches.
argument-hint: list | add <host> | remove <host>
---

The user just ran `/cart-retailers $ARGUMENTS`.

Parse `$ARGUMENTS`:
- If empty or `list` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js list` and surface output.
- If starts with `add ` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js add <host>` and surface output.
- If starts with `remove ` → run `node ${CLAUDE_PLUGIN_ROOT}/bin/retailers.js remove <host>` and surface output.

For `add`: surface a friendly message based on outcome.
  - `added=<host>`: "Added <host> to your retailers list."
  - `error=duplicate`: "<host> is already in your list."
  - `error=not_shopify`: "<host> isn't a Shopify-detected store. v0.6.0 only supports Shopify retailers."
  - `error=invalid_host`: "That host doesn't look right. Pass a bare domain like `marinelayer.com`."
```

`package.json`:
```json
"bin": {
  "cart": "./bin/cart.js",
  "cart-flow": "./bin/cart-flow.js",
  "retailers": "./bin/retailers.js"
}
```

No new tests in this task — the store is unit-tested. The shim is small enough to validate manually.

- [ ] **Step 1: Write `bin/retailers.js`**, set executable bit
- [ ] **Step 2: Write `commands/cart-retailers.md`**
- [ ] **Step 3: Update `package.json`**
- [ ] **Step 4: `node --check bin/retailers.js`**
- [ ] **Step 5: Run full suite (sanity)**

Expected: 212 passing.

- [ ] **Step 6: Commit:** `"Add cart-retailers CLI and slash command"`

---

### Task 3: `runCartFlow` reads from retailers store

**Files:**
- Modify: `lib/flow.js`
- Modify: `test/flow.test.js`
- Modify: `bin/cart-flow.js`

**`lib/flow.js` change:**
- Accept the call shape `runCartFlow({query, deps, retailers?})`.
- If `retailers` is omitted OR null OR undefined, call `deps.readRetailers()` and use `result.retailers.map(r => r.host)`.
- Validate that `retailers` (resolved) is a non-empty array of strings. Otherwise throw a programmer-error.

Add `readRetailers` to the `deps` object. Real-bound impl is from `lib/retailers-store.js`.

**`bin/cart-flow.js` change:**
- Remove the hardcoded `retailers = ['marinelayer.com']`.
- Don't pass `retailers` at all — the flow now defaults to the store.
- Wire `readRetailers` from `lib/retailers-store.js` into the deps.

**Tests (3 new in `test/flow.test.js`):**

1. `runCartFlow({query: 'sweater', deps: {..., readRetailers: async () => ({retailers: [{host: 'marinelayer.com', ...}]})}})` (no `retailers` arg) reads from store and searches that host.
2. `runCartFlow` with explicit `retailers: ['x.com']` does NOT call `readRetailers`.
3. `runCartFlow` with `readRetailers` returning an empty retailers list → returns `{outcome: 'no_results'}`. (This is technically a different reason than "search found nothing" but the outcome is the same.)

Adjust existing tests: every test that passes `retailers: ['marinelayer.com']` keeps doing so. Only the 3 new tests exercise the no-retailers form.

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run — verify they fail**
- [ ] **Step 3: Implement the changes**
- [ ] **Step 4: Run — verify pass**
- [ ] **Step 5: Run full suite**

Expected: 212 + 3 = 215 passing.

- [ ] **Step 6: Commit:** `"Read retailer list from retailers-store in runCartFlow"`

---

### Task 4: Live smoke verifies multi-retailer search

**Files:**
- Modify: `test/live-flow.js`

Update the live smoke to NOT pass a retailers argument — exercise the store-reading path. The actual retailers come from whatever is in `~/.claude/cart/retailers.md`. On a fresh setup, the file gets auto-created with the 4 defaults.

This task has no tests. The implementer just removes the hardcoded `retailers: [...]` line in the smoke and confirms `node --check` passes.

- [ ] **Step 1: Remove the hardcoded retailers from `test/live-flow.js`**
- [ ] **Step 2: `node --check test/live-flow.js`**
- [ ] **Step 3: Run full suite**

Expected: 215 passing.

- [ ] **Step 4: Commit:** `"Live smoke now exercises store-backed retailer list"`

---

### Task 5: Ship v0.6.0

**Files:**
- Modify: `README.md`, `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md`

- [ ] **Step 1: Update README status**

`**Status:** v0.6.0 — retailer management. `/cart` searches multiple Shopify stores from `~/.claude/cart/retailers.md`. `/cart-retailers list|add|remove` manages the list. Plan 7 adds in-flow login retry.`

- [ ] **Step 2: Bump versions to 0.6.0**

- [ ] **Step 3: Prepend CHANGELOG entry**

```markdown
## 0.6.0 — 2026-05-11

Adds retailer management. `/cart` no longer hardcoded to one store —
searches every retailer in your list in parallel.

- New `lib/retailers-store.js`: read/write `~/.claude/cart/retailers.md`.
  Auto-creates with 4 default Shopify stores (marinelayer, allbirds,
  everlane, mejuri) if missing.
- New `bin/retailers.js` + `/cart-retailers list|add|remove` slash command.
- `runCartFlow` reads retailers from the store when no explicit list is
  passed. `bin/cart-flow.js` drops its hardcoded array.
- `add` validates a host is Shopify-detected before adding. Tier-1
  retailers and non-Shopify sites are rejected with a clear error.

v0.6.0 deferrals (Plan 7):
- No `/cart-retailers login` — login is still handled out-of-band via
  `npm run smoke:browser`.
- No in-flow login retry — `auth_required` still exits the flow.
```

- [ ] **Step 4: Run full suite**

Expected: 215 passing.

- [ ] **Step 5: Commit and push**

```bash
git add README.md package.json .claude-plugin/plugin.json CHANGELOG.md
git commit -m "Ship v0.6.0 — retailer management"
git push origin main
```

---

## Self-review checklist

- [ ] All 5 tasks committed.
- [ ] `npm test` shows 215 passing.
- [ ] `bin/retailers.js` is executable.
- [ ] `/cart-retailers list` on a fresh checkout returns the 4 default retailers.
- [ ] `runCartFlow` works with both the explicit-retailers and no-retailers call shapes.
- [ ] No new runtime deps.
