#!/usr/bin/env node
// bin/cart-setup-flow.js
// CLI shim: wire real deps, run runSetupFlow, print structured outcome, exit.

import { execFile } from 'node:child_process';
import { readProfile, writeProfile, validateProfile } from '../lib/profile.js';
import { startServer } from '../server/ui.js';
import { renderPage } from '../server/render-setup.js';
import { runSetupFlow } from '../lib/setup-flow.js';

const rawArgs = process.argv.slice(2);
const noOpen = rawArgs.includes('--no-open');

function openUrl(url) {
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

async function main() {
  const wrappedOpenUrl = (url) => {
    process.stdout.write(`__CART_SETUP_URL__ ${url}\n`);
    if (noOpen) return Promise.resolve();
    return openUrl(url);
  };

  const result = await runSetupFlow({
    deps: {
      readProfile,
      writeProfile,
      validateProfile,
      startServer,
      render: renderPage,
      openUrl: wrappedOpenUrl,
      log,
    },
  });

  switch (result.outcome) {
    case 'success':
      process.stdout.write(`outcome=success changes=${result.changes.length}\n`);
      // Print one change per line on stderr for human eyeballing.
      for (const c of result.changes) process.stderr.write(`  ${c}\n`);
      process.exit(0);
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
