#!/usr/bin/env node
// bin/cart-flow.js
// CLI shim: parse argv, wire real deps, run runCartFlow, print structured outcome, exit.

import { execFile } from 'node:child_process';
import { readProfile } from '../lib/profile.js';
import { readRetailers } from '../lib/retailers-store.js';
import { search, addToCart } from '../lib/retailers/shopify.js';
import { getCookieHeader, openLoginPage } from '../lib/browser.js';
import { startServer } from '../server/ui.js';
import { runCartFlow } from '../lib/flow.js';

const query = process.argv[2];

if (!query) {
  process.stderr.write('Usage: cart-flow "<query>"\n');
  process.exit(2);
}

function openUrl(url) {
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('open', [url], (err) => (err ? reject(err) : resolve()));
    });
  }
  process.stderr.write(`Open this URL: ${url}\n`);
}

function log(msg) {
  process.stderr.write(msg + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const result = await runCartFlow({
    query,
    deps: { readProfile, readRetailers, search, getCookieHeader, addToCart, startServer, openUrl, openLoginPage, log, sleep },
  });

  switch (result.outcome) {
    case 'success': {
      const title = result.product?.title ?? '';
      const brand = result.product?.brand ?? '';
      process.stdout.write(
        `outcome=success product="${title}" brand="${brand}" cart_url="${result.cartUrl}"\n`,
      );
      process.exit(0);
      break;
    }
    case 'no_results':
      process.stdout.write(`outcome=no_results query="${query}"\n`);
      process.exit(1);
      break;
    case 'canceled':
      process.stdout.write('outcome=canceled\n');
      process.exit(1);
      break;
    case 'dismissed':
      process.stdout.write('outcome=dismissed\n');
      process.exit(1);
      break;
    case 'auth_required':
      process.stdout.write(`outcome=auth_required host="${result.host}"\n`);
      process.exit(1);
      break;
    case 'cart_error':
      process.stdout.write(`outcome=cart_error host="${result.host}" reason="${result.error}"\n`);
      process.exit(1);
      break;
    default:
      process.stdout.write(`outcome=flow_error reason="${result.error ?? 'unknown'}"\n`);
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${err.message}\n`);
  process.stdout.write(`outcome=flow_error reason="${err.message}"\n`);
  process.exit(1);
});
