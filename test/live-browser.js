#!/usr/bin/env node
// Live smoke for browser session. Run manually:
//   npm run smoke:browser
// Opens a real browser to marinelayer.com, prompts for login, then dumps cookies.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openLoginPage, getCookieHeader, isLoggedIn, closeBrowser } from '../lib/browser.js';
import { browserProfilePath } from '../lib/paths.js';

const HOST = 'marinelayer.com';

async function main() {
  console.log(`Browser profile: ${browserProfilePath()}`);

  console.log(`\nChecking existing login state...`);
  let logged = await isLoggedIn(HOST);
  console.log(`  isLoggedIn(${HOST}) → ${logged}`);

  if (!logged) {
    console.log(`\nOpening browser to https://${HOST}/`);
    await openLoginPage(HOST);
    const rl = readline.createInterface({ input: stdin, output: stdout });
    await rl.question(`\nLog in to ${HOST} in the browser, then press Enter here... `);
    rl.close();
  }

  console.log(`\nFetching cookies...`);
  const cookie = await getCookieHeader(HOST);
  if (cookie) {
    console.log(`  cookie length: ${cookie.length}`);
    console.log(`  first 100 chars: ${cookie.slice(0, 100)}`);
    console.log(`  cookies: ${cookie.split('; ').length}`);
  } else {
    console.log('  no cookies for host');
  }

  logged = await isLoggedIn(HOST);
  console.log(`\n  isLoggedIn(${HOST}) → ${logged}`);

  console.log('\nClosing browser...');
  await closeBrowser();

  console.log('\nLive browser smoke OK.');
}

main().catch((err) => {
  console.error('Live browser smoke FAILED:', err.message);
  if (err.code) console.error('  code:', err.code);
  process.exit(1);
});
