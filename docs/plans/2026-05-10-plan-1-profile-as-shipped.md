# Plan 1 — As Shipped

**Status:** Shipped in `v0.1.0`. This is the canonical record of what's in the repo after `8f28857..507b013` (22 commits, ~780 LOC, 30 passing tests). The original plan (`2026-05-10-plan-1-profile.md`) is the historical record of what we set out to build; this doc is what actually exists. **Use this as the reference when starting Plan 2.**

## Goal (achieved)

Profile read/write library plus the `/cart-setup` slash command. A user can run `/cart-setup` in any Claude Code session, answer 1-8 questions, and a profile is written to `~/.claude/cart/profile.md` that subsequent plans will read.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  commands/cart-setup.md  (LLM-driven wizard)                  │
└──────────────┬───────────────────────────────────────────────┘
               │ shells out via bash
               ▼
┌──────────────────────────────────────────────────────────────┐
│  bin/cart.js (Node CLI)                                       │
│    init | show | set | append-thumb | append-purchase         │
│    validate before writing                                    │
└──────────────┬───────────────────────────────────────────────┘
               │ imports
               ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/profile.js (pure-ish I/O + parse/serialize)              │
│    getDefaultProfile, readProfile, writeProfile,              │
│    validateProfile, appendPurchase, appendThumbSignal,        │
│    updateFrontmatter, mergeFrontmatter                        │
│    + internal: parseProfile, parseTable, formatTable,         │
│                sanitizeCell                                   │
└──────────────┬───────────────────────────────────────────────┘
               │ imports
               ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/paths.js  (HOME-derived, no I/O)                         │
│    cartDir, profilePath, retailersPath, requestsDir           │
└──────────────────────────────────────────────────────────────┘
```

The LLM never touches `profile.md` directly — every write goes through `bin/cart.js`, which validates the merged frontmatter against the schema before writing. This is enforceable because validation is a pure function that takes the merged in-memory profile.

## Tech stack

- Node.js 20+ (ESM via `"type": "module"` in `package.json`)
- `node:test` (built-in test runner) — no Jest/Mocha
- `js-yaml ^4.1.0` (only runtime dep) — used with `{ schema: yaml.JSON_SCHEMA }` so unquoted ISO dates stay strings instead of becoming `Date` objects
- `node:fs/promises`, `node:child_process`, `node:os`, `node:path`

## File layout

```
superpowers-for-shopping/
├── .claude-plugin/plugin.json    v0.1.0
├── .gitignore
├── .node-version                 20
├── LICENSE                       MIT
├── README.md
├── package.json                  v0.1.0
├── package-lock.json
├── bin/
│   └── cart.js                   77 LOC, executable (100755)
├── commands/
│   └── cart-setup.md             37 LOC, LLM wizard prompt
├── docs/
│   ├── specs/
│   │   └── 2026-05-10-superpowers-for-shopping-design.md
│   └── plans/
│       ├── 2026-05-10-plan-1-profile.md             (original, with drift header)
│       └── 2026-05-10-plan-1-profile-as-shipped.md  (this doc)
├── hooks/
│   └── hooks.json                empty placeholder for Plan 8
├── lib/
│   ├── paths.js                  8 LOC, pure path resolvers
│   └── profile.js                150 LOC
└── test/
    ├── paths.test.js             4 tests
    ├── profile.test.js           19 tests (including 6 adversarial-input added in 8.5)
    ├── cli.test.js               5 tests (4 happy + 1 validate-before-write)
    └── smoke.test.js             1 end-to-end test
                                  TOTAL: 30 tests
```

## API surface (`lib/profile.js` exports)

| Export | Signature | Notes |
|---|---|---|
| `getDefaultProfile()` | sync, returns object | 11 fields. `last_setup: null` by default. |
| `readProfile()` | async, returns object | Default if missing. Throws wrapped YAML error with path on malformed. |
| `writeProfile(profile)` | async, void | mkdir-recursive. Sanitizes cell values (`|` → `/`, newlines → space). |
| `validateProfile(profile)` | sync, returns `{valid, errors}` | Checks `budget_default ∈ {low,mid,high}`, `palette`/`brands_love`/`brands_avoid` arrays, `sizes` object. |
| `appendPurchase(row)` | async, void | Read-modify-write; appends to `purchase_history` table. |
| `appendThumbSignal(row)` | async, void | Read-modify-write; appends to `thumb_signals` table. |
| `updateFrontmatter(updates)` | async, void | Composes `mergeFrontmatter` + I/O. |
| `mergeFrontmatter(profile, updates)` | sync, returns object | Pure. Shallow merge with deep-merge for plain-object values (with explicit null guard). |

**Internal helpers (not exported):** `parseProfile`, `parseTable` (lenient on missing trailing pipe, regex-escapes the heading), `formatTable`, `sanitizeCell`.

## Profile schema

Frontmatter (YAML):

```yaml
sizes:               {}            # nested: {top, bottom, shoes, ...}
budget_default:      mid           # low | mid | high
budget_caps:         {}            # nested: {clothes: 200, furniture: 1500, ...}
palette:             []            # color names
brands_love:         []
brands_avoid:        []
fit_notes:           {}            # nested: per-category free text
moodboard_url:       ""            # Pinterest etc. — not consumed in v0.1.0
last_setup:          null          # YYYY-MM-DD; set by /cart-setup at wizard end
```

Body (two append-only markdown tables):

```
# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|

# Thumb signals
| date | category | up | down |
|---|---|---|---|
```

Cells get pipe-and-newline sanitized before being written. Rows without a trailing pipe parse correctly (lenient reader).

## CLI surface (`bin/cart.js`)

| Subcommand | Purpose |
|---|---|
| `cart init` | Write a default profile to `~/.claude/cart/profile.md`. Does NOT set `last_setup` (the wizard does that). |
| `cart show` | Print the merged profile as JSON. |
| `cart set <key>=<val> [...]` | Set one or more frontmatter values. Values are JSON-parsed first (arrays, objects, booleans, numbers), falling back to plain strings. Dotted keys supported (`sizes.top=M`). **Validates the merged result before writing**; on invalid, exits 2 without touching disk. |
| `cart append-thumb <json>` | Append a row to the `thumb_signals` table. |
| `cart append-purchase <json>` | Append a row to the `purchase_history` table. |

All subcommands respect `$HOME`, so tests can run against `mkdtemp`'d directories.

## Slash command

`/cart-setup` — the wizard. Prompt is 37 lines of instructions for the LLM. Walks the user through 8 questions one at a time, writing each answer via `node ${CLAUDE_PLUGIN_ROOT}/bin/cart.js set ...`. At the end runs `set last_setup=$(date +%Y-%m-%d)` and `cart show`. Tone is brisk and warm; total target time under 90s.

## Test coverage by surface

| Surface | Test file | Count | What it covers |
|---|---|---|---|
| Path resolution | `test/paths.test.js` | 4 | HOME-derived paths for cartDir, profilePath, retailersPath, requestsDir |
| Profile library | `test/profile.test.js` | 19 | Defaults, read (missing/present), write+round-trip, mkdir-on-write, validate (4 cases), append-purchase, append-thumb, updateFrontmatter (shallow + deep), **+ 6 adversarial-input tests added in 8.5**: pipe sanitization, newline sanitization, missing trailing pipe, date type preservation, write-format stability, malformed-YAML error wrapping, null-target merge |
| CLI | `test/cli.test.js` | 5 | init creates file, show outputs JSON, set with scalars, set with JSON arrays, **validate-before-write** |
| End-to-end | `test/smoke.test.js` | 1 | Full setup flow: init + 6 sets + show + raw-markdown shape assertion |

`npm test` reports 30 passing, 0 failing, ~600ms.

## Key invariants Plan 2+ can rely on

1. **`profile.md` is always well-formed after a successful CLI call.** Validate-before-write guarantees it.
2. **Cells in markdown tables never contain raw `|` or `\n`.** Sanitization happens at the write boundary in `formatTable`. Plan 2+ can write user-supplied strings to tables without a per-call sanitization step.
3. **YAML round-trip is stable.** `JSON_SCHEMA` keeps ISO dates as strings. A profile read and immediately re-written produces a byte-identical file (modulo `last_setup` updates).
4. **`HOME` is the single point of testability.** Set it via `mkdtemp` for any test that touches profile state.
5. **The LLM never writes `profile.md` directly.** All writes go through `bin/cart.js`. Plan 2+ slash commands should follow the same pattern — never edit the markdown via Read/Edit.

## What's NOT in v0.1.0

- No retailer handlers (Plan 2 — Shopify generic)
- No browser session management (Plan 3)
- No web UI server (Plan 4)
- No `/cart` shopping flow (Plan 5)
- No `/cart-retailers`, `/cart-feedback`, `/cart-rule` commands (Plans 6 + 8)
- No hooks fire (Plan 8 lights up `hooks/hooks.json`)
- No `schema_version` field (deferred — Plan 2 should add it)
- `moodboard_url` field exists but is unused (Pinterest ingestion is post-MVP)

## Drift from the original plan doc

Four code blocks in `2026-05-10-plan-1-profile.md` no longer match what shipped:

- **Task 4 import order** — original plan would have hit ESM `SyntaxError` (importing `writeProfile` before it was exported). Implementer imported `{ readProfile }` only at Task 4, expanded at Task 5.
- **Tasks 4/5 parseTable/formatTable** — original had no cell sanitization and a strict trailing-pipe regex. Task 8.5 rewrote both.
- **Task 8 `updateFrontmatter`** — original was monolithic. Refactored into pure `mergeFrontmatter` + thin I/O wrapper to support the validate-before-write fix.
- **Task 9 `cmdSet`** — original did `updateFrontmatter → validate → exit(2)` (writes bad value to disk, then complains). Refactored to `read → merge → validate → write only if valid`.

The original plan + this as-shipped doc together form the full record: what we intended + what we actually built.

## Process notes for Plan 2

These are the takeaways from Plan 1 worth carrying forward:

1. **Spec behavior, not implementation, for parsers.** Don't paste regex into Plan 2 code blocks. Describe what the parser must handle ("tolerant of trailing whitespace, missing trailing pipe, etc.") and let TDD pin it.
2. **Adversarial-input tests in the original plan, not as a hardening patch.** Any function that touches user-supplied strings (or YAML, or markdown) gets a "what if input contains the separator/escape/null/etc." test in the original task, not a Task N.5 cleanup.
3. **Validate at the boundary, never in the middle.** The validate-before-write pattern in `cmdSet` should be the model for Plan 2's retailer-add command, Plan 6's `/cart-rule` command, etc.
4. **Bundle small mechanical tasks.** Tasks 3-8 of Plan 1 should have been one dispatch (and were, in practice). Plan 2 should pre-bundle related TDD additions.
5. **Plan-as-pseudocode hides loader semantics.** Run any plan's first imports against a fresh repo before declaring the plan done. ESM resolves at parse time and will surface ordering bugs that pseudocode hides.
