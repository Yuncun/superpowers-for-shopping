#!/usr/bin/env node
// bin/cart-flow.js
// CLI shim: parse argv, wire real deps, run runCartFlow, print outcome, exit.

import { execFile } from 'node:child_process';
import { readProfile, appendPurchase, updateFrontmatter } from '../lib/profile.js';
import { readRetailers } from '../lib/retailers-store.js';
import { search, buildCartPermalink } from '../lib/retailers/shopify.js';
import { startServer } from '../server/ui.js';
import { renderPage } from '../server/render.js';
import { runCartFlow } from '../lib/flow.js';
import { extractColorsFromProduct, mergePaletteCandidates } from '../lib/palette-extractor.js';

const rawArgs = process.argv.slice(2);
const noOpen = rawArgs.includes('--no-open');
const positional = rawArgs.filter((a) => a !== '--no-open');
const query = positional[0];

if (!query || !query.trim()) {
  process.stderr.write('Usage: cart-flow [--no-open] "<query>"\n');
  process.exit(2);
}

function openInBrowser(url) {
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('open', [url], (err) => (err ? reject(err) : resolve()));
    });
  }
  process.stderr.write(`Open this URL: ${url}\n`);
  return Promise.resolve();
}

function log(msg) {
  process.stderr.write(msg + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // openUrl is called once for the local UI server (emitted as sentinel for
  // the e2e harness) and N times for retailer cart permalinks. --no-open
  // suppresses all browser launches; useful for tests.
  let serverUrlEmitted = false;
  const openUrl = (url) => {
    if (!serverUrlEmitted && url.startsWith('http://127.0.0.1')) {
      process.stdout.write(`__CART_FLOW_URL__ ${url}\n`);
      serverUrlEmitted = true;
    }
    if (noOpen) return Promise.resolve();
    return openInBrowser(url);
  };

  const result = await runCartFlow({
    query,
    deps: {
      readProfile,
      readRetailers,
      search,
      startServer: () => startServer({ render: renderPage }),
      openUrl,
      log,
      sleep,
      appendPurchase,
      updateProfile: updateFrontmatter,
      extractColors: extractColorsFromProduct,
      mergePalette: mergePaletteCandidates,
      buildPermalink: buildCartPermalink,
      now: () => new Date().toISOString().slice(0, 10),
    },
  });

  switch (result.outcome) {
    case 'reviewed': {
      const hostsList = result.carts.map((c) => `${c.host}(${c.count})`).join(',');
      process.stdout.write(`outcome=reviewed carts="${hostsList}"\n`);
      process.exit(0);
      break;
    }
    case 'no_results':
      process.stdout.write(`outcome=no_results query="${query}"\n`);
      process.exit(1);
      break;
    case 'no_retailers':
      process.stdout.write('outcome=no_retailers\n');
      process.exit(1);
      break;
    case 'dismissed':
      process.stdout.write('outcome=dismissed\n');
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
