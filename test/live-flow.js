#!/usr/bin/env node
// Live smoke for the full /cart flow. Run manually:
//   npm run smoke:flow
// Uses real search, real browser cookies, real UI server, and a mocked addToCart
// so we don't litter a real Shopify cart during testing.

import { execFile } from 'node:child_process';
import { readProfile } from '../lib/profile.js';
import { search } from '../lib/retailers/shopify.js';
import { getCookieHeader } from '../lib/browser.js';
import { startServer } from '../server/ui.js';
import { runCartFlow } from '../lib/flow.js';

const query = process.argv[2] ?? 'sweater';

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

async function addToCart({ host, variantId }) {
  process.stderr.write(`MOCKED addToCart called with host=${host} variantId=${variantId}\n`);
  return { ok: true };
}

async function main() {
  process.stderr.write(`\n=== live-flow smoke: query="${query}" ===\n`);

  const result = await runCartFlow({
    query,
    retailers: ['marinelayer.com'],
    deps: { readProfile, search, getCookieHeader, addToCart, startServer, openUrl, log, sleep },
  });

  process.stderr.write(`\noutcome: ${JSON.stringify(result)}\n`);
}

main().catch((err) => {
  process.stderr.write(`Live flow smoke FAILED: ${err.message}\n`);
  if (err.code) process.stderr.write(`  code: ${err.code}\n`);
  process.exit(0); // smoke always exits 0
});
