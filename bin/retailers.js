#!/usr/bin/env node
// bin/retailers.js
// Subcommands: list | add <host> | remove <host> | init

import { existsSync } from 'node:fs';
import { retailersPath } from '../lib/paths.js';
import {
  readRetailers,
  addRetailer,
  removeRetailer,
} from '../lib/retailers-store.js';
import { detect } from '../lib/retailers/shopify.js';
import { openLoginPage } from '../lib/browser.js';
import { normalizeHost } from '../lib/host.js';

const [, , cmd, ...args] = process.argv;

async function cmdList() {
  const { retailers } = await readRetailers();
  for (const r of retailers) {
    process.stdout.write(`${r.host}\t${r.tier}\t${r.handler}\t${r.last_used || '-'}\n`);
  }
  process.exit(0);
}

async function cmdAdd(host) {
  if (!host) {
    process.stderr.write('Usage: retailers add <host>\n');
    process.exit(2);
  }

  let result;
  try {
    result = await addRetailer({ host, detectImpl: detect });
  } catch (err) {
    process.stdout.write(`error=invalid_host\n`);
    process.stderr.write(`Invalid host: ${err.message}\n`);
    process.exit(1);
  }

  if (result.added) {
    process.stdout.write(`added=${host}\n`);
    process.exit(0);
  } else {
    process.stdout.write(`error=${result.reason}\n`);
    process.stderr.write(`Could not add retailer: ${result.reason}\n`);
    process.exit(1);
  }
}

async function cmdRemove(host) {
  if (!host) {
    process.stderr.write('Usage: retailers remove <host>\n');
    process.exit(2);
  }

  let result;
  try {
    result = await removeRetailer(host);
  } catch (err) {
    process.stdout.write(`error=invalid_host\n`);
    process.stderr.write(`Invalid host: ${err.message}\n`);
    process.exit(1);
  }

  if (result.removed) {
    process.stdout.write(`removed=${host}\n`);
    process.exit(0);
  } else {
    process.stdout.write(`error=${result.reason}\n`);
    process.stderr.write(`Could not remove retailer: ${result.reason}\n`);
    process.exit(1);
  }
}

async function cmdLogin(host) {
  if (!host) {
    process.stderr.write('Usage: retailers login <host>\n');
    process.exit(2);
  }
  const normalized = normalizeHost(host);
  try {
    await openLoginPage(normalized);
    process.stdout.write(`opened=${normalized}\n`);
    process.exit(0);
  } catch (err) {
    process.stdout.write(`error=${err.code || 'failed'}\n`);
    process.exit(1);
  }
}

async function cmdInit() {
  const alreadyExists = existsSync(retailersPath());
  await readRetailers(); // auto-creates if missing
  if (alreadyExists) {
    process.stdout.write('already_exists\n');
  } else {
    process.stdout.write('initialized\n');
  }
  process.exit(0);
}

async function main() {
  switch (cmd) {
    case 'list':   await cmdList(); break;
    case 'add':    await cmdAdd(args[0]); break;
    case 'remove': await cmdRemove(args[0]); break;
    case 'login':  await cmdLogin(args[0]); break;
    case 'init':   await cmdInit(); break;
    default:
      process.stderr.write('Usage: retailers <list|add <host>|remove <host>|login <host>|init>\n');
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${err.message}\n`);
  process.exit(1);
});
