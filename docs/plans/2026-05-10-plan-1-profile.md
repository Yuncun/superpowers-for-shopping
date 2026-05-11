# Plan 1 — Profile Data Layer + `/cart-setup`

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working profile read/write library plus a `/cart-setup` slash command. After Plan 1, the user can run `/cart-setup` in any Claude Code session, answer a few questions, and have a profile written to `~/.claude/cart/profile.md` that subsequent plans will read.

**Architecture:** A Node library (`lib/profile.js`) handles all profile I/O with TDD-able pure functions. A small Node CLI (`bin/cart.js`) routes shell-invoked commands to the library. The `/cart-setup` slash command (`commands/cart-setup.md`) drives an LLM-led conversational wizard that gathers answers, then writes them via the CLI. Bash is used only as a thin shim where the slash command needs to invoke the CLI.

**Tech Stack:**
- Node.js 20+ (ESM modules; `"type": "module"` in package.json)
- `node:test` (built-in test runner; no extra deps)
- `js-yaml` for frontmatter parsing
- `node:fs/promises` for file I/O

**Scope notes:**
- The repo root IS the plugin; `.claude-plugin/`, `commands/`, `lib/`, etc. live at the top level (no nested `plugins/superpowers-for-shopping/` subdir — that was a marketplace-internal convention from the spec).
- Storage path is `~/.claude/cart/profile.md` per the spec — named after the slash command (`/cart`), not the plugin folder.
- The setup *wizard's conversational UX* is LLM-driven via the slash command prompt. The *data writes* go through the CLI for testability. This separation matters: the LLM stays out of the I/O path.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Node manifest, ESM, test script, deps |
| `lib/profile.js` | Pure functions: read, write, validate, append-purchase, append-thumb-signal, update-frontmatter |
| `lib/paths.js` | Single source of truth for storage paths (`~/.claude/cart/`) |
| `bin/cart.js` | Node CLI entrypoint with subcommands (`init`, `show`, `set`, `append-thumb`, `append-purchase`) |
| `commands/cart-setup.md` | Slash command markdown — LLM-led setup wizard prompt |
| `test/profile.test.js` | Unit tests for `lib/profile.js` |
| `test/paths.test.js` | Tests for `lib/paths.js` (HOME override for test isolation) |
| `test/cli.test.js` | Integration test for `bin/cart.js` against a temp directory |

**File responsibilities are tight on purpose:** `paths.js` is its own file because *every* later plan will import it. Keeping it tiny and dependency-free means it's easy to mock in tests.

---

## Task 1: Set up `package.json` + dev tooling

**Files:**
- Create: `package.json`
- Create: `.node-version` (optional, signals Node 20+)

- [ ] **Step 1.1: Write `package.json`**

```json
{
  "name": "superpowers-for-shopping",
  "version": "0.0.1",
  "description": "ADHD-helper Claude Code plugin for considered purchases",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "bin": {
    "cart": "./bin/cart.js"
  },
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  }
}
```

- [ ] **Step 1.2: Write `.node-version`**

```
20
```

- [ ] **Step 1.3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated; `package-lock.json` created.

- [ ] **Step 1.4: Verify test runner works on an empty test dir**

Run: `mkdir -p test && node --test test/`
Expected: passes (no tests yet, but no syntax error).

**Note:** `bin/cart.js` keeps the `.js` extension so Node treats it as ESM per `package.json`'s `type: module`. The `bin` field maps the user-facing `cart` command to `./bin/cart.js`, so when installed users still type `cart`, not `cart.js`.

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json .node-version
git commit -m "Add package.json, js-yaml dep, test script"
```

---

## Task 2: `lib/paths.js` — storage path resolver

**Files:**
- Create: `lib/paths.js`
- Create: `test/paths.test.js`

- [ ] **Step 2.1: Write the failing test**

```javascript
// test/paths.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartDir, profilePath, retailersPath, requestsDir } from '../lib/paths.js';

test('cartDir respects HOME env', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(cartDir(), '/tmp/fake-home/.claude/cart');
});

test('profilePath returns profile.md inside cartDir', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(profilePath(), '/tmp/fake-home/.claude/cart/profile.md');
});

test('retailersPath returns retailers.md inside cartDir', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(retailersPath(), '/tmp/fake-home/.claude/cart/retailers.md');
});

test('requestsDir returns requests/ inside cartDir', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(requestsDir(), '/tmp/fake-home/.claude/cart/requests');
});
```

- [ ] **Step 2.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `lib/paths.js` does not exist.

- [ ] **Step 2.3: Write minimal `lib/paths.js`**

```javascript
// lib/paths.js
import path from 'node:path';

const home = () => process.env.HOME || process.env.USERPROFILE || '';

export const cartDir = () => path.join(home(), '.claude', 'cart');
export const profilePath = () => path.join(cartDir(), 'profile.md');
export const retailersPath = () => path.join(cartDir(), 'retailers.md');
export const requestsDir = () => path.join(cartDir(), 'requests');
```

- [ ] **Step 2.4: Run tests; expect pass**

Run: `npm test`
Expected: 4 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add lib/paths.js test/paths.test.js
git commit -m "Add lib/paths.js for cart storage path resolution"
```

---

## Task 3: `lib/profile.js` — default profile

**Files:**
- Create: `lib/profile.js`
- Create: `test/profile.test.js`

- [ ] **Step 3.1: Write the failing test**

```javascript
// test/profile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultProfile } from '../lib/profile.js';

test('getDefaultProfile returns expected schema', () => {
  const p = getDefaultProfile();
  assert.equal(typeof p, 'object');
  assert.ok(p.sizes);
  assert.equal(p.budget_default, 'mid');
  assert.ok(Array.isArray(p.palette));
  assert.ok(Array.isArray(p.brands_love));
  assert.ok(Array.isArray(p.brands_avoid));
  assert.equal(p.moodboard_url, '');
  assert.ok(p.purchase_history); // table is empty array
  assert.ok(p.thumb_signals);    // table is empty array
  assert.equal(p.purchase_history.length, 0);
  assert.equal(p.thumb_signals.length, 0);
});
```

- [ ] **Step 3.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `lib/profile.js` does not exist.

- [ ] **Step 3.3: Write minimal `lib/profile.js`**

```javascript
// lib/profile.js

export function getDefaultProfile() {
  return {
    sizes: {},
    budget_default: 'mid',
    budget_caps: {},
    palette: [],
    brands_love: [],
    brands_avoid: [],
    fit_notes: {},
    moodboard_url: '',
    last_setup: null,
    purchase_history: [],
    thumb_signals: [],
  };
}
```

- [ ] **Step 3.4: Run tests; expect pass**

Run: `npm test`
Expected: 5 tests pass total (4 paths + 1 profile).

- [ ] **Step 3.5: Commit**

```bash
git add lib/profile.js test/profile.test.js
git commit -m "Add lib/profile.js with getDefaultProfile"
```

---

## Task 4: `readProfile()` — handles missing file

**Files:**
- Modify: `lib/profile.js`
- Modify: `test/profile.test.js`

- [ ] **Step 4.1: Write the failing tests**

Append to `test/profile.test.js`:

```javascript
import { readProfile, writeProfile } from '../lib/profile.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('readProfile returns default when file does not exist', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  const p = await readProfile();
  assert.equal(p.budget_default, 'mid');
  assert.equal(p.purchase_history.length, 0);
});

test('readProfile parses an existing profile.md', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await fs.mkdir(path.join(tmp, '.claude/cart'), { recursive: true });
  await fs.writeFile(path.join(tmp, '.claude/cart/profile.md'), `---
sizes:
  top: M
budget_default: high
palette: [navy, olive]
brands_love: [Marine Layer]
brands_avoid: []
moodboard_url: ""
last_setup: 2026-05-10
---

# Purchase history
| date | item | brand | $ | kept | notes |
|---|---|---|---|---|---|

# Thumb signals
| date | category | up | down |
|---|---|---|---|
`);
  const p = await readProfile();
  assert.equal(p.sizes.top, 'M');
  assert.equal(p.budget_default, 'high');
  assert.deepEqual(p.palette, ['navy', 'olive']);
  assert.deepEqual(p.brands_love, ['Marine Layer']);
});
```

- [ ] **Step 4.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `readProfile` not exported.

- [ ] **Step 4.3: Implement `readProfile`**

Append to `lib/profile.js`:

```javascript
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { profilePath } from './paths.js';

export async function readProfile() {
  let raw;
  try {
    raw = await fs.readFile(profilePath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return getDefaultProfile();
    throw err;
  }
  return parseProfile(raw);
}

function parseProfile(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('profile.md missing frontmatter');
  const front = yaml.load(m[1]) || {};
  const body = m[2];
  return {
    ...getDefaultProfile(),
    ...front,
    purchase_history: parseTable(body, 'Purchase history'),
    thumb_signals: parseTable(body, 'Thumb signals'),
  };
}

function parseTable(body, heading) {
  const re = new RegExp(`# ${heading}\\n\\| ([^\\n]+)\\n\\|[^\\n]+\\n([\\s\\S]*?)(?=\\n#|$)`);
  const m = body.match(re);
  if (!m) return [];
  const headers = m[1].split('|').map(s => s.trim()).filter(Boolean);
  return m[2].split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .map(line => {
      const cells = line.split('|').slice(1, -1).map(s => s.trim());
      return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    });
}
```

- [ ] **Step 4.4: Run tests; expect pass**

Run: `npm test`
Expected: 7 tests pass total.

- [ ] **Step 4.5: Commit**

```bash
git add lib/profile.js test/profile.test.js
git commit -m "Add readProfile with frontmatter + table parsing"
```

---

## Task 5: `writeProfile()` — round-trips

**Files:**
- Modify: `lib/profile.js`
- Modify: `test/profile.test.js`

- [ ] **Step 5.1: Write the failing test**

Append to `test/profile.test.js`:

```javascript
test('writeProfile then readProfile round-trips', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  const original = {
    ...getDefaultProfile(),
    sizes: { top: 'M', bottom: '32x32' },
    budget_default: 'mid',
    palette: ['navy', 'cream'],
    brands_love: ['Marine Layer', 'Uniqlo'],
    brands_avoid: ['Shein'],
    last_setup: '2026-05-10',
  };
  await writeProfile(original);
  const restored = await readProfile();
  assert.deepEqual(restored.sizes, original.sizes);
  assert.deepEqual(restored.palette, original.palette);
  assert.deepEqual(restored.brands_love, original.brands_love);
  assert.equal(restored.last_setup, original.last_setup);
});

test('writeProfile creates the cart dir if missing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  const stat = await fs.stat(path.join(tmp, '.claude/cart/profile.md'));
  assert.ok(stat.isFile());
});
```

Add to imports: `import { getDefaultProfile } from '../lib/profile.js';` (already imported above; ensure it's reused).

- [ ] **Step 5.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `writeProfile` not exported.

- [ ] **Step 5.3: Implement `writeProfile`**

Append to `lib/profile.js`:

```javascript
import { cartDir } from './paths.js';

export async function writeProfile(profile) {
  await fs.mkdir(cartDir(), { recursive: true });
  const frontKeys = [
    'sizes', 'budget_default', 'budget_caps', 'palette',
    'brands_love', 'brands_avoid', 'fit_notes', 'moodboard_url', 'last_setup',
  ];
  const front = {};
  for (const k of frontKeys) front[k] = profile[k];
  const out = `---\n${yaml.dump(front).trimEnd()}\n---\n\n` +
    formatTable('Purchase history', ['date', 'item', 'brand', '$', 'kept', 'notes'], profile.purchase_history || []) +
    '\n' +
    formatTable('Thumb signals', ['date', 'category', 'up', 'down'], profile.thumb_signals || []) +
    '\n';
  await fs.writeFile(profilePath(), out);
}

function formatTable(heading, headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const dataLines = rows.map(r => `| ${headers.map(h => r[h] ?? '').join(' | ')} |`);
  return `# ${heading}\n${headerLine}\n${sep}\n${dataLines.join('\n')}${dataLines.length ? '\n' : ''}`;
}
```

- [ ] **Step 5.4: Run tests; expect pass**

Run: `npm test`
Expected: 9 tests pass total.

- [ ] **Step 5.5: Commit**

```bash
git add lib/profile.js test/profile.test.js
git commit -m "Add writeProfile with frontmatter and table serialization"
```

---

## Task 6: `validateProfile()` — schema check

**Files:**
- Modify: `lib/profile.js`
- Modify: `test/profile.test.js`

- [ ] **Step 6.1: Write the failing tests**

Append to `test/profile.test.js`:

```javascript
import { validateProfile } from '../lib/profile.js';

test('validateProfile passes a complete profile', () => {
  const p = {
    ...getDefaultProfile(),
    sizes: { top: 'M' },
    budget_default: 'mid',
  };
  assert.equal(validateProfile(p).valid, true);
});

test('validateProfile flags missing budget_default', () => {
  const p = { ...getDefaultProfile(), budget_default: undefined };
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('budget_default')));
});

test('validateProfile flags invalid budget_default value', () => {
  const p = { ...getDefaultProfile(), budget_default: 'extravagant' };
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('budget_default')));
});

test('validateProfile flags non-array palette', () => {
  const p = { ...getDefaultProfile(), palette: 'navy' };
  const r = validateProfile(p);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('palette')));
});
```

- [ ] **Step 6.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `validateProfile` not exported.

- [ ] **Step 6.3: Implement `validateProfile`**

Append to `lib/profile.js`:

```javascript
const BUDGET_TIERS = ['low', 'mid', 'high'];
const ARRAY_FIELDS = ['palette', 'brands_love', 'brands_avoid'];

export function validateProfile(p) {
  const errors = [];
  if (!BUDGET_TIERS.includes(p.budget_default)) {
    errors.push(`budget_default must be one of ${BUDGET_TIERS.join(', ')}`);
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(p[field])) errors.push(`${field} must be an array`);
  }
  if (typeof p.sizes !== 'object' || p.sizes === null) {
    errors.push('sizes must be an object');
  }
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 6.4: Run tests; expect pass**

Run: `npm test`
Expected: 13 tests pass total.

- [ ] **Step 6.5: Commit**

```bash
git add lib/profile.js test/profile.test.js
git commit -m "Add validateProfile with schema checks"
```

---

## Task 7: `appendPurchase()` and `appendThumbSignal()`

**Files:**
- Modify: `lib/profile.js`
- Modify: `test/profile.test.js`

- [ ] **Step 7.1: Write the failing tests**

Append to `test/profile.test.js`:

```javascript
import { appendPurchase, appendThumbSignal } from '../lib/profile.js';

test('appendPurchase adds a row to purchase_history', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  await appendPurchase({
    date: '2026-05-10',
    item: 'sweater',
    brand: 'Marine Layer',
    $: '98',
    kept: '?',
    notes: 'navy crew',
  });
  const p = await readProfile();
  assert.equal(p.purchase_history.length, 1);
  assert.equal(p.purchase_history[0].brand, 'Marine Layer');
});

test('appendThumbSignal adds a row to thumb_signals', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile(getDefaultProfile());
  await appendThumbSignal({
    date: '2026-05-10',
    category: 'sweater',
    up: 'ribbed crew',
    down: 'oversized',
  });
  const p = await readProfile();
  assert.equal(p.thumb_signals.length, 1);
  assert.equal(p.thumb_signals[0].up, 'ribbed crew');
});
```

- [ ] **Step 7.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — functions not exported.

- [ ] **Step 7.3: Implement the appenders**

Append to `lib/profile.js`:

```javascript
export async function appendPurchase(row) {
  const p = await readProfile();
  p.purchase_history.push(row);
  await writeProfile(p);
}

export async function appendThumbSignal(row) {
  const p = await readProfile();
  p.thumb_signals.push(row);
  await writeProfile(p);
}
```

- [ ] **Step 7.4: Run tests; expect pass**

Run: `npm test`
Expected: 15 tests pass total.

- [ ] **Step 7.5: Commit**

```bash
git add lib/profile.js test/profile.test.js
git commit -m "Add appendPurchase and appendThumbSignal"
```

---

## Task 8: `updateFrontmatter()` — for hard rules

**Files:**
- Modify: `lib/profile.js`
- Modify: `test/profile.test.js`

- [ ] **Step 8.1: Write the failing test**

Append to `test/profile.test.js`:

```javascript
import { updateFrontmatter } from '../lib/profile.js';

test('updateFrontmatter merges shallow fields', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile({ ...getDefaultProfile(), brands_avoid: ['Shein'] });
  await updateFrontmatter({ brands_avoid: ['Shein', 'Temu'] });
  const p = await readProfile();
  assert.deepEqual(p.brands_avoid, ['Shein', 'Temu']);
});

test('updateFrontmatter deep-merges fit_notes', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  process.env.HOME = tmp;
  await writeProfile({ ...getDefaultProfile(), fit_notes: { sweater: 'relaxed' } });
  await updateFrontmatter({ fit_notes: { pants: 'tapered' } });
  const p = await readProfile();
  assert.equal(p.fit_notes.sweater, 'relaxed');
  assert.equal(p.fit_notes.pants, 'tapered');
});
```

- [ ] **Step 8.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `updateFrontmatter` not exported.

- [ ] **Step 8.3: Implement `updateFrontmatter`**

Append to `lib/profile.js`:

```javascript
export async function updateFrontmatter(updates) {
  const p = await readProfile();
  for (const [key, value] of Object.entries(updates)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof p[key] === 'object') {
      p[key] = { ...p[key], ...value };
    } else {
      p[key] = value;
    }
  }
  await writeProfile(p);
}
```

- [ ] **Step 8.4: Run tests; expect pass**

Run: `npm test`
Expected: 17 tests pass total.

- [ ] **Step 8.5: Commit**

```bash
git add lib/profile.js test/profile.test.js
git commit -m "Add updateFrontmatter for hard-rule promotion"
```

---

## Task 9: `bin/cart.js` CLI

**Files:**
- Create: `bin/cart.js`
- Create: `test/cli.test.js`

- [ ] **Step 9.1: Write the failing test**

```javascript
// test/cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const CLI = path.resolve('bin/cart.js');

async function runCli(args, env) {
  const { stdout, stderr } = await exec('node', [CLI, ...args], {
    env: { ...process.env, ...env },
  });
  return { stdout, stderr };
}

test('cart init creates a default profile.md', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  const exists = await fs.stat(path.join(tmp, '.claude/cart/profile.md')).then(() => true, () => false);
  assert.ok(exists);
});

test('cart show prints the current profile as JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  const { stdout } = await runCli(['show'], { HOME: tmp });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.budget_default, 'mid');
});

test('cart set writes frontmatter values', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  await runCli(['set', 'sizes.top=M', 'budget_default=high'], { HOME: tmp });
  const { stdout } = await runCli(['show'], { HOME: tmp });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.sizes.top, 'M');
  assert.equal(parsed.budget_default, 'high');
});

test('cart set with array value parses JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-test-'));
  await runCli(['init'], { HOME: tmp });
  await runCli(['set', 'brands_love=["Marine Layer","Uniqlo"]'], { HOME: tmp });
  const { stdout } = await runCli(['show'], { HOME: tmp });
  const parsed = JSON.parse(stdout);
  assert.deepEqual(parsed.brands_love, ['Marine Layer', 'Uniqlo']);
});
```

- [ ] **Step 9.2: Run tests; expect failure**

Run: `npm test`
Expected: FAIL — `bin/cart.js` does not exist.

- [ ] **Step 9.3: Implement `bin/cart.js`**

```javascript
#!/usr/bin/env node
// bin/cart.js
import {
  readProfile, writeProfile, getDefaultProfile,
  appendPurchase, appendThumbSignal, updateFrontmatter, validateProfile,
} from '../lib/profile.js';

const [, , cmd, ...args] = process.argv;

function setNested(obj, dottedKey, value) {
  const parts = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
}

function parseValue(raw) {
  // Try JSON first (arrays, objects, booleans, numbers, strings).
  try { return JSON.parse(raw); } catch { return raw; }
}

async function cmdInit() {
  await writeProfile({ ...getDefaultProfile(), last_setup: new Date().toISOString().slice(0, 10) });
  console.log('Initialized profile at ~/.claude/cart/profile.md');
}

async function cmdShow() {
  const p = await readProfile();
  console.log(JSON.stringify(p, null, 2));
}

async function cmdSet(pairs) {
  const updates = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`bad pair: ${pair}`);
    const key = pair.slice(0, eq);
    const value = parseValue(pair.slice(eq + 1));
    setNested(updates, key, value);
  }
  await updateFrontmatter(updates);
  const p = await readProfile();
  const v = validateProfile(p);
  if (!v.valid) {
    console.error('Profile is now invalid:');
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(2);
  }
}

async function cmdAppendThumb(json) {
  await appendThumbSignal(JSON.parse(json));
}

async function cmdAppendPurchase(json) {
  await appendPurchase(JSON.parse(json));
}

async function main() {
  switch (cmd) {
    case 'init':            await cmdInit(); break;
    case 'show':            await cmdShow(); break;
    case 'set':             await cmdSet(args); break;
    case 'append-thumb':    await cmdAppendThumb(args[0]); break;
    case 'append-purchase': await cmdAppendPurchase(args[0]); break;
    default:
      console.error(`Usage: cart <init|show|set|append-thumb|append-purchase> [...]`);
      process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 9.4: Make it executable**

Run: `chmod +x bin/cart.js`

- [ ] **Step 9.5: Run tests; expect pass**

Run: `npm test`
Expected: 21 tests pass total.

- [ ] **Step 9.6: Commit**

```bash
git add bin/cart.js test/cli.test.js
git commit -m "Add bin/cart.js CLI with init/show/set/append-thumb/append-purchase"
```

---

## Task 10: `/cart-setup` slash command

**Files:**
- Create: `commands/cart-setup.md`

- [ ] **Step 10.1: Write the slash command markdown**

```markdown
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

4. After the last question, run `cart set last_setup=$(date +%Y-%m-%d)` and `cart show`, then summarize the final profile back to the user in a short paragraph.

5. Tone: brisk and warm. Don't lecture. If they skip something, move on without comment. Total time target: under 90 seconds.

## Anti-patterns

- Do not ask all questions in one message. One at a time.
- Do not write the profile.md directly via Read/Edit. Always use `bin/cart.js set` so validation runs.
- Do not validate or moralize their brand choices. If they love Shein, that's not your call.
- Do not ask for things the spec hasn't authorized (income, address, payment method).
```

- [ ] **Step 10.2: Commit**

```bash
git add commands/cart-setup.md
git commit -m "Add /cart-setup slash command for profile wizard"
```

---

## Task 11: Plugin manifest update + hooks.json

**Files:**
- Modify: `.claude-plugin/plugin.json` (bump version, add commands array)
- Create: `hooks/hooks.json` (empty for now, scaffolded for Plan 8)

- [ ] **Step 11.1: Update `plugin.json`**

```json
{
  "name": "superpowers-for-shopping",
  "version": "0.1.0",
  "description": "ADHD-helper for considered purchases. Takes 'I need a sweater' to a populated cart with one click.",
  "author": {
    "name": "Eric Shen"
  },
  "homepage": "https://github.com/Yuncun/superpowers-for-shopping",
  "repository": "https://github.com/Yuncun/superpowers-for-shopping",
  "license": "MIT",
  "keywords": ["shopping", "adhd", "claude-code", "agent-browser", "shopify"]
}
```

(Version bumped from 0.0.1 to 0.1.0 — Plan 1 ships profile management.)

- [ ] **Step 11.2: Create `hooks/hooks.json` placeholder**

```json
{
  "description": "superpowers-for-shopping — hooks (none active in Plan 1)",
  "hooks": {}
}
```

- [ ] **Step 11.3: Commit**

```bash
git add .claude-plugin/plugin.json hooks/hooks.json
git commit -m "Bump plugin version to 0.1.0; scaffold hooks.json"
```

---

## Task 12: End-to-end smoke test

**Files:**
- Create: `test/smoke.test.js`

- [ ] **Step 12.1: Write the smoke test**

```javascript
// test/smoke.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const CLI = path.resolve('bin/cart.js');

test('smoke: full setup flow writes a usable profile', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cart-smoke-'));
  const env = { ...process.env, HOME: tmp };

  await exec('node', [CLI, 'init'], { env });
  await exec('node', [CLI, 'set', 'sizes.top=M', 'sizes.bottom=32x32'], { env });
  await exec('node', [CLI, 'set', 'budget_default=mid'], { env });
  await exec('node', [CLI, 'set', 'palette=["navy","cream","olive"]'], { env });
  await exec('node', [CLI, 'set', 'brands_love=["Marine Layer","Uniqlo"]'], { env });
  await exec('node', [CLI, 'set', 'brands_avoid=["Shein"]'], { env });
  await exec('node', [CLI, 'set', 'fit_notes={"sweater":"relaxed, not cropped"}'], { env });

  const { stdout } = await exec('node', [CLI, 'show'], { env });
  const p = JSON.parse(stdout);

  assert.equal(p.sizes.top, 'M');
  assert.equal(p.sizes.bottom, '32x32');
  assert.equal(p.budget_default, 'mid');
  assert.deepEqual(p.palette, ['navy', 'cream', 'olive']);
  assert.deepEqual(p.brands_love, ['Marine Layer', 'Uniqlo']);
  assert.deepEqual(p.brands_avoid, ['Shein']);
  assert.equal(p.fit_notes.sweater, 'relaxed, not cropped');

  // The on-disk file should be human-readable markdown.
  const raw = await fs.readFile(path.join(tmp, '.claude/cart/profile.md'), 'utf8');
  assert.ok(raw.startsWith('---\n'));
  assert.ok(raw.includes('# Purchase history'));
  assert.ok(raw.includes('# Thumb signals'));
});
```

- [ ] **Step 12.2: Run all tests**

Run: `npm test`
Expected: 22 tests pass total (21 + 1 smoke).

- [ ] **Step 12.3: Commit**

```bash
git add test/smoke.test.js
git commit -m "Add end-to-end smoke test for setup flow"
```

---

## Plan 1 — Done state

After Task 12:
- `lib/paths.js` + `lib/profile.js` cover all profile I/O and schema.
- `bin/cart.js` CLI lets bash/slash commands manipulate the profile without touching markdown directly.
- `commands/cart-setup.md` runs a 60–90 second LLM-driven setup wizard.
- 22 passing tests; everything is round-trip-safe.
- Plugin still has no shopping capability yet — that's Plan 2 (Shopify handler) onward. But the profile that everything downstream depends on is in place.

## Things deliberately NOT in Plan 1

- No retailer code, no browser session, no web UI server.
- No `/cart-feedback`, `/cart-rule`, or `/cart-retailers` commands (Plans 6/8).
- No `lib/ranking.js` (Plan 9).
- No real session-start hook (Plan 8).
- Pinterest ingestion stays unimplemented (deferred per spec Section 11).
