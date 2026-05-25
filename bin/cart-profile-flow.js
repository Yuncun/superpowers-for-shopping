#!/usr/bin/env node
// bin/cart-profile-flow.js
// CLI shim: wire real deps, run runProfileFlow, print outcome, exit.

import { execFile } from 'node:child_process';
import { readProfile, writeProfile, validateProfile } from '../lib/profile.js';
import { readRetailers, addRetailer, removeRetailer } from '../lib/retailers-store.js';
import { detect } from '../lib/retailers/shopify.js';
import { startServer } from '../server/ui.js';
import { renderPage } from '../server/render-profile.js';
import { runProfileFlow } from '../lib/profile-flow.js';

const rawArgs = process.argv.slice(2);
const noOpen = rawArgs.includes('--no-open');
const tabArg = rawArgs.find((a) => a.startsWith('--tab='));
const initialTab = tabArg ? tabArg.slice('--tab='.length) : undefined;

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
    process.stdout.write(`__CART_PROFILE_URL__ ${url}\n`);
    if (noOpen) return Promise.resolve();
    return openUrl(url);
  };

  const result = await runProfileFlow({
    deps: {
      readProfile,
      writeProfile,
      validateProfile,
      readRetailers,
      addRetailer: ({ host }) => addRetailer({ host, detectImpl: detect }),
      removeRetailer,
      startServer,
      render: renderPage,
      openUrl: wrappedOpenUrl,
      initialTab,
      log,
    },
  });

  switch (result.outcome) {
    case 'success':
      process.stdout.write(`outcome=success actions=${result.actionsApplied}\n`);
      process.exit(0);
      break;
    case 'dismissed':
      process.stdout.write(`outcome=dismissed actions=${result.actionsApplied}\n`);
      process.exit(0);
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
