// test/e2e-cart-ui.mjs
//
// End-to-end UI regression test. Spawns a real cart-flow subprocess, opens the
// resulting page in headless Chromium via Playwright, and asserts the browser
// renders the thumbs grid without console errors or pageerror events.
//
// This test catches the class of bug that the protocol-level e2e harness can't
// see: page-side JavaScript failures (parse errors, missed escapes, runtime
// exceptions) that leave the page blank while the orchestrator reports success.
//
// Run: `npm run e2e:ui`
// Exits 0 on success, 1 on any failure.

import { chromium } from 'playwright';
import { spawnCartFlow } from './lib/cart-harness.js';

const QUERY = 'wool sweater';
const NAV_TIMEOUT_MS = 8_000;
const RENDER_WAIT_MS = 8_000;
const MIN_CARDS = 1;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

async function main() {
  console.log('=== e2e:ui — cart UI rendering regression ===');

  const spawned = await spawnCartFlow({
    query: QUERY,
    args: ['--no-open'],
    env: { ...process.env, PATH: process.env.PATH },
  });
  console.log(`spawned cart-flow → ${spawned.baseUrl}/r/${spawned.sessionId}`);

  const pageUrl = `${spawned.baseUrl}/r/${spawned.sessionId}?token=${spawned.token}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push({ name: err.name, message: err.message, stack: err.stack });
  });
  page.on('requestfailed', (req) => {
    // Ignore subresource (image) failures — only fail on app-level requests.
    const url = req.url();
    if (url.startsWith(spawned.baseUrl)) {
      failedRequests.push({ url, method: req.method(), failure: req.failure() });
    }
  });

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  } catch (e) {
    fail(`page.goto failed: ${e.message}`);
    await browser.close();
    spawned.proc.kill('SIGTERM');
    return;
  }

  // Wait for the thumbs grid to render. The server pushes `loading` then
  // `thumbs` shortly after; the page should populate `.grid .card` elements.
  // If the inline <script> fails to parse, this locator never resolves.
  let cardCount = 0;
  try {
    await page.locator('.grid .card').first().waitFor({ state: 'attached', timeout: RENDER_WAIT_MS });
    cardCount = await page.locator('.grid .card').count();
  } catch (e) {
    fail(`waited ${RENDER_WAIT_MS}ms for .grid .card — no cards rendered. Likely a page-side script failure.`);
  }

  console.log(`rendered ${cardCount} card(s)`);

  if (cardCount < MIN_CARDS) {
    fail(`expected at least ${MIN_CARDS} cards in the thumbs grid, found ${cardCount}`);
  }

  if (pageErrors.length > 0) {
    fail(`${pageErrors.length} pageerror event(s):`);
    for (const e of pageErrors) {
      console.error(`  ${e.name}: ${e.message}`);
    }
  }

  if (consoleErrors.length > 0) {
    fail(`${consoleErrors.length} console.error message(s):`);
    for (const m of consoleErrors) {
      console.error(`  ${m.text}`);
    }
  }

  if (failedRequests.length > 0) {
    fail(`${failedRequests.length} failed app-level request(s):`);
    for (const r of failedRequests) {
      console.error(`  ${r.method} ${r.url} → ${JSON.stringify(r.failure)}`);
    }
  }

  // Capture a screenshot regardless of outcome — useful for debugging on CI.
  const shot = `/tmp/e2e-cart-ui-last.png`;
  try {
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`screenshot: ${shot}`);
  } catch {}

  await browser.close();
  spawned.proc.kill('SIGTERM');

  if (process.exitCode) {
    console.error('=== FAIL ===');
  } else {
    console.log('=== PASS ===');
  }
}

main().catch((err) => {
  console.error('e2e:ui crashed:', err);
  process.exit(2);
});
