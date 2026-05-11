#!/usr/bin/env node
// bin/cart.js
import {
  readProfile, writeProfile, getDefaultProfile,
  appendPurchase, appendThumbSignal, validateProfile,
  mergeFrontmatter, listPendingPurchases, updatePurchase,
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
  await writeProfile(getDefaultProfile());
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
  const current = await readProfile();
  const merged = mergeFrontmatter(current, updates);
  const v = validateProfile(merged);
  if (!v.valid) {
    console.error('Profile would be invalid:');
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(2);
  }
  await writeProfile(merged);
}

async function cmdAppendThumb(json) {
  await appendThumbSignal(JSON.parse(json));
}

async function cmdAppendPurchase(json) {
  await appendPurchase(JSON.parse(json));
}

async function cmdListPending() {
  const rows = await listPendingPurchases();
  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
}

async function cmdFeedback([date, item, brand, kept, notes]) {
  let result;
  try {
    result = await updatePurchase({ date, item, brand }, { kept, notes });
  } catch (err) {
    console.error(`error=${err.code ?? err.message}`);
    process.exit(1);
  }
  if (result.updated) {
    console.log(`updated=yes`);
  } else {
    console.error(`error=${result.reason}`);
    process.exit(1);
  }
}

async function main() {
  switch (cmd) {
    case 'init':            await cmdInit(); break;
    case 'show':            await cmdShow(); break;
    case 'set':             await cmdSet(args); break;
    case 'append-thumb':    await cmdAppendThumb(args[0]); break;
    case 'append-purchase': await cmdAppendPurchase(args[0]); break;
    case 'list-pending':    await cmdListPending(); break;
    case 'feedback':        await cmdFeedback(args); break;
    default:
      console.error(`Usage: cart <init|show|set|append-thumb|append-purchase|list-pending|feedback> [...]`);
      process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
