#!/usr/bin/env node
// test/e2e-cart-flow.js
//
// Live end-to-end dry-run script for the /cart flow. Drives real cart-flow
// subprocesses against the user's configured retailers and reports outcomes.
//
// Usage:
//   npm run e2e:cart                          # 3 default sweater-adjacent queries
//   npm run e2e:cart -- "wool sweater"        # single custom query
//
// Env:
//   MOCK_ADD_TO_CART=1   (DEFERRED to v0.11.1) Would inject a mock addToCart so
//                        runs don't litter real carts. Not currently wired —
//                        bin/cart-flow.js doesn't accept a mock flag. We log a
//                        warning and ignore.
//   RETAILERS=<host>     (DEFERRED to v0.11.1) Would override retailer list.
//                        bin/cart-flow.js reads from ~/.claude/cart/retailers.md
//                        via readRetailers() with no env-var override. We log a
//                        warning and ignore.
//
// This is a runnable integration script, NOT a `node --test` test. It uses
// test/lib/cart-harness.js (with real deps) to spawn the cart-flow CLI,
// subscribe to its SSE stream, drive the state machine with thumb-up choices,
// and verify a real cart URL comes back.
//
// Exit codes (per Plan 11 Task 3):
//   0  at least one run produced outcome=success
//   1  all runs were auth_required (or harness_error / harness_timeout)
//   2  all runs were no_results

import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { spawnCartFlow, driveFlow } from './lib/cart-harness.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_QUERIES = ['wool sweater', 'cotton sweater', 'cardigan'];
const PER_RUN_TIMEOUT_MS = 60_000;
const INTER_RUN_DELAY_MS = 2_000;

// ---------------------------------------------------------------------------
// CLI / env
// ---------------------------------------------------------------------------

const cliArgs = process.argv.slice(2);
const customQuery = cliArgs[0];
const queries = customQuery ? [customQuery] : DEFAULT_QUERIES;

if (process.env.MOCK_ADD_TO_CART) {
  process.stderr.write(
    'warning: MOCK_ADD_TO_CART is not wired in v0.11.0 — bin/cart-flow.js has no mock-injection flag. Ignoring. (Deferred to v0.11.1.)\n',
  );
}

if (process.env.RETAILERS) {
  process.stderr.write(
    'warning: RETAILERS env var is not consumed by bin/cart-flow.js (it reads ~/.claude/cart/retailers.md). Ignoring. (Deferred to v0.11.1.)\n',
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Open a URL in the user's default browser (macOS only via `open`).
 * Non-darwin platforms just log the URL.
 */
function openInBrowser(url) {
  if (process.platform !== 'darwin') {
    process.stderr.write(`(non-darwin) Open this URL manually: ${url}\n`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile('open', [url], (err) => {
      if (err) process.stderr.write(`open failed: ${err.message}\n`);
      resolve();
    });
  });
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

/**
 * Make a chooser that drives one full happy-path run:
 *   loading → thumbs (thumb-up 0,1,2 then thumbs_complete) → final (final_accept)
 *
 * On login_required we dismiss AND set `state.hitAuthRequired = true` so the
 * caller can map the resulting `dismissed` outcome back to `auth_required` in
 * the summary. (driveFlow itself only sees what the subprocess reports, which
 * is `dismissed` once we ack the login-required state with a `dismissed`
 * action.)
 *
 * @param {{hitAuthRequired: boolean, cartUrl: string|null}} record  mutated in-place
 */
function makeChooser(record) {
  let didThumbs = false;
  let didFinal = false;
  let didDismiss = false;
  return (state) => {
    switch (state.stage) {
      case 'loading':
        return null;
      case 'thumbs': {
        if (didThumbs) return null;
        didThumbs = true;
        // Always thumb-up the first 3 indices (or fewer if not enough candidates).
        const n = Math.min(3, (state.candidates ?? []).length);
        const thumbs = [];
        for (let i = 0; i < n; i++) {
          thumbs.push({ type: 'thumb', direction: 'up', index: i });
        }
        thumbs.push({ type: 'thumbs_complete' });
        return thumbs;
      }
      case 'final': {
        if (didFinal) return null;
        didFinal = true;
        return { type: 'final_accept' };
      }
      case 'login_required': {
        if (didDismiss) return null;
        didDismiss = true;
        record.hitAuthRequired = true;
        return { type: 'dismissed' };
      }
      case 'redirect': {
        if (state.url) record.cartUrl = state.url;
        return null;
      }
      case 'done':
        return null;
      default:
        return null;
    }
  };
}

/**
 * Drive a single run with a wall-clock timeout. On timeout, kill the
 * subprocess and return a harness_timeout record.
 */
async function runOne(query) {
  process.stdout.write(`\n=== Run: '${query}' ===\n`);
  const start = performance.now();

  const record = { hitAuthRequired: false, cartUrl: null };

  let spawned;
  try {
    spawned = await spawnCartFlow({ query, args: ['--no-open'] });
  } catch (err) {
    const durationMs = performance.now() - start;
    process.stdout.write(`  -> harness_error (spawn): ${err.message}\n`);
    return {
      query,
      outcome: 'harness_error',
      cartUrl: null,
      durationMs,
      hitAuthRequired: false,
      error: err.message,
    };
  }

  const { proc, baseUrl, sessionId, token } = spawned;

  let timeoutHandle;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`harness_timeout (>${PER_RUN_TIMEOUT_MS}ms)`));
    }, PER_RUN_TIMEOUT_MS);
  });

  let result;
  try {
    result = await Promise.race([
      driveFlow({
        subprocess: proc,
        baseUrl,
        sessionId,
        token,
        choose: makeChooser(record),
        onState: (s) => {
          process.stderr.write(`  [state] stage=${s.stage}\n`);
        },
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    clearTimeout(timeoutHandle);
    // Kill the subprocess so we don't leak it.
    if (proc && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    const durationMs = performance.now() - start;
    const isTimeout = /harness_timeout/.test(err.message);
    const outcome = isTimeout ? 'harness_timeout' : 'harness_error';
    process.stdout.write(`  -> ${outcome}: ${err.message}\n`);
    return {
      query,
      outcome,
      cartUrl: null,
      durationMs,
      hitAuthRequired: record.hitAuthRequired,
      error: err.message,
    };
  }
  clearTimeout(timeoutHandle);

  const durationMs = performance.now() - start;

  // The subprocess emits `outcome=dismissed` when our chooser dismisses a
  // login_required state. Map that back to `auth_required` for the
  // user-facing summary using the recorded flag.
  let outcome = result.outcome ?? 'unknown';
  if (outcome === 'dismissed' && record.hitAuthRequired) {
    outcome = 'auth_required';
  }

  // Prefer the cart URL from the subprocess outcome line (it's the
  // canonical one); fall back to whatever we recorded from the redirect state.
  const cartUrl = result.cartUrl ?? record.cartUrl;

  process.stdout.write(`  -> ${outcome}`);
  if (cartUrl) process.stdout.write(` → ${cartUrl}`);
  process.stdout.write(`  (${formatSeconds(durationMs)})\n`);

  return {
    query,
    outcome,
    cartUrl,
    durationMs,
    hitAuthRequired: record.hitAuthRequired,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  process.stdout.write(`E2E dry-run: ${queries.length} run(s)\n`);

  const results = [];
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(INTER_RUN_DELAY_MS);
    const r = await runOne(queries[i]);
    results.push(r);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  process.stdout.write('\n=== E2E dry-run summary ===\n');
  results.forEach((r, i) => {
    let line = `  Run ${i + 1} ('${r.query}'): ${r.outcome}`;
    if (r.cartUrl) line += ` → ${r.cartUrl}`;
    line += `  (${formatSeconds(r.durationMs)})`;
    process.stdout.write(line + '\n');
  });

  const successes = results.filter((r) => r.outcome === 'success' && r.cartUrl);
  const allNoResults = results.length > 0 && results.every((r) => r.outcome === 'no_results');
  const allAuthOrError = results.length > 0 && results.every((r) =>
    r.outcome === 'auth_required'
    || r.outcome === 'harness_error'
    || r.outcome === 'harness_timeout',
  );

  process.stdout.write('\n');

  if (successes.length > 0) {
    process.stdout.write(
      `${successes.length}/${results.length} runs produced a real cart URL. Opening them in your browser — please verify the sweater landed in cart.\n`,
    );
    for (const r of successes) {
      await openInBrowser(r.cartUrl);
    }
    process.exit(0);
  }

  if (allNoResults) {
    process.stdout.write(
      'All runs returned no_results. Queries probably don\'t match what your configured retailers stock. Not a harness failure.\n',
    );
    process.exit(2);
  }

  if (allAuthOrError) {
    const anyAuth = results.some((r) => r.outcome === 'auth_required');
    if (anyAuth) {
      process.stdout.write(
        'All runs hit auth_required (or harness errors). Cookies are likely stale — re-run `npm run smoke:browser` against your retailer to refresh the session, then retry.\n',
      );
    } else {
      process.stdout.write(
        'All runs failed at the harness level (timeout or error). See per-run logs above.\n',
      );
    }
    process.exit(1);
  }

  // Mixed outcomes with no successes (e.g., some no_results + some auth_required).
  process.stdout.write(
    'No runs produced a cart URL. Mixed outcomes — see per-run lines above.\n',
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`\nUnhandled e2e-cart-flow error: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
