// test/browser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openLoginPage, getCookieHeader, isLoggedIn } from '../lib/browser.js';
import { browserProfilePath } from '../lib/paths.js';

function mockExec(routes) {
  return async (file, args) => {
    const key = [file, ...args].join(' ');
    const route = routes[key];
    if (!route) throw new Error(`unexpected exec: ${key}`);
    if (typeof route === 'function') return route(file, args);
    if (route.throws) throw route.throws;
    return { stdout: typeof route.stdout === 'string' ? route.stdout : JSON.stringify(route.stdout ?? {}), stderr: route.stderr ?? '' };
  };
}

const PROFILE_ARG = `--profile ${browserProfilePath()}`;

test('closeBrowser succeeds when agent-browser reports success', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close --json`]: {
      stdout: { success: true, data: null, error: null },
    },
  });
  await closeBrowser({ execImpl });
  // no throw = pass
});

test('closeBrowser is a no-op when no session is open', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close --json`]: {
      stdout: { success: false, data: null, error: 'no active session' },
    },
  });
  await closeBrowser({ execImpl });
  // no throw = pass
});

test('closeBrowser throws browser_unavailable when agent-browser is not on PATH', async () => {
  const enoent = new Error('spawn agent-browser ENOENT');
  enoent.code = 'ENOENT';
  const execImpl = async () => { throw enoent; };
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_unavailable'
  );
});

test('closeBrowser surfaces unknown failures as browser_failed', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close --json`]: {
      stdout: { success: false, data: null, error: 'tab crashed' },
    },
  });
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_failed' && err.message.includes('tab crashed')
  );
});

test('closeBrowser surfaces malformed JSON output', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close --json`]: {
      stdout: 'not json at all',
    },
  });
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_failed'
  );
});

test('closeBrowser surfaces non-zero exit (subprocess threw)', async () => {
  const subErr = new Error('Command failed with exit code 2');
  subErr.code = 2;
  subErr.stderr = 'browser config invalid';
  const execImpl = async () => { throw subErr; };
  await assert.rejects(
    () => closeBrowser({ execImpl }),
    (err) => err.code === 'browser_failed' && err.message.includes('browser config invalid')
  );
});

test('runAgentBrowser preserves caller-supplied --profile (does not double-add)', async () => {
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await closeBrowser({ execImpl });
  const profileFlagCount = seenArgs.filter((a) => a === '--profile').length;
  assert.equal(profileFlagCount, 1, `expected exactly one --profile flag, got ${profileFlagCount}: ${seenArgs.join(' ')}`);
});

test('runAgentBrowser always passes --json (agent-browser defaults to human-readable output)', async () => {
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await closeBrowser({ execImpl });
  assert.ok(seenArgs.includes('--json'), `expected --json in args, got: ${seenArgs.join(' ')}`);
  const jsonFlagCount = seenArgs.filter((a) => a === '--json').length;
  assert.equal(jsonFlagCount, 1, `expected exactly one --json flag, got ${jsonFlagCount}`);
});

test('openLoginPage navigates to https://<host>/', async () => {
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await openLoginPage('marinelayer.com', { execImpl });
  assert.ok(seenArgs.includes('open'), 'expected "open" in args');
  assert.ok(seenArgs.includes('https://marinelayer.com/'), `expected URL in args, got ${seenArgs.join(' ')}`);
});

test('openLoginPage normalizes host (strips protocol, path, lowercases)', async () => {
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await openLoginPage('HTTPS://MarineLayer.com/products/x', { execImpl });
  assert.ok(seenArgs.includes('https://marinelayer.com/'));
});

test('openLoginPage throws invalid_host on bad input', async () => {
  for (const bad of ['', null, undefined, 'localhost', '   ']) {
    await assert.rejects(
      () => openLoginPage(bad, { execImpl: async () => ({ stdout: '{}', stderr: '' }) }),
      (err) => err.code === 'invalid_host',
      `expected invalid_host for ${JSON.stringify(bad)}`
    );
  }
});

test('openLoginPage propagates browser_unavailable', async () => {
  const enoent = new Error('spawn agent-browser ENOENT');
  enoent.code = 'ENOENT';
  const execImpl = async () => { throw enoent; };
  await assert.rejects(
    () => openLoginPage('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_unavailable'
  );
});

test('openLoginPage propagates browser_failed when agent-browser reports failure', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} open https://marinelayer.com/ --json`]: {
      stdout: { success: false, data: null, error: 'navigation timeout' },
    },
  });
  await assert.rejects(
    () => openLoginPage('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_failed' && err.message.includes('navigation timeout')
  );
});

function cookiesPayload(...cookies) {
  return { success: true, data: { cookies }, error: null };
}

test('getCookieHeader returns name=value pairs joined by "; "', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(
        { name: 'cart', value: 'abc123', domain: 'marinelayer.com' },
        { name: '_shopify_y', value: 'def456', domain: '.marinelayer.com' }
      ),
    },
  });
  const cookie = await getCookieHeader('marinelayer.com', { execImpl });
  assert.equal(cookie, '_shopify_y=def456; cart=abc123');
});

test('getCookieHeader returns null when no cookies match', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'x', value: 'y', domain: 'other.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), null);
});

test('getCookieHeader returns null when cookies array is empty', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), null);
});

test('getCookieHeader matches leading-dot domain (.marinelayer.com applies to marinelayer.com)', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'session', value: 'xyz', domain: '.marinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), 'session=xyz');
});

test('getCookieHeader matches when host is a subdomain of cookie domain', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'session', value: 'xyz', domain: 'marinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('shop.marinelayer.com', { execImpl }), 'session=xyz');
});

test('getCookieHeader does NOT match unrelated domain', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'session', value: 'xyz', domain: 'evilmarinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), null);
});

test('getCookieHeader is deterministic (sorted by name)', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(
        { name: 'zeta', value: '1', domain: 'marinelayer.com' },
        { name: 'alpha', value: '2', domain: 'marinelayer.com' },
        { name: 'beta', value: '3', domain: 'marinelayer.com' }
      ),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), 'alpha=2; beta=3; zeta=1');
});

test('getCookieHeader throws invalid_host on bad input', async () => {
  await assert.rejects(
    () => getCookieHeader('', { execImpl: async () => ({ stdout: '{}', stderr: '' }) }),
    (err) => err.code === 'invalid_host'
  );
});

test('getCookieHeader propagates browser_failed when cookies get fails', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: { success: false, data: null, error: 'no active page' },
    },
  });
  await assert.rejects(
    () => getCookieHeader('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_failed'
  );
});

test('getCookieHeader handles cookie values that contain special chars (no over-encoding)', async () => {
  // Cookie header spec says values can contain any printable ASCII except control chars,
  // double-quote, comma, semicolon, backslash. We trust agent-browser to return values
  // that are already valid; we do NOT URL-encode them (browsers send raw values).
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 'sid', value: 'abc%3D%2F', domain: 'marinelayer.com' }),
    },
  });
  assert.equal(await getCookieHeader('marinelayer.com', { execImpl }), 'sid=abc%3D%2F');
});

test('isLoggedIn returns true when cookies are present', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 's', value: 'x', domain: 'marinelayer.com' }),
    },
  });
  assert.equal(await isLoggedIn('marinelayer.com', { execImpl }), true);
});

test('isLoggedIn returns false when no cookies', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload(),
    },
  });
  assert.equal(await isLoggedIn('marinelayer.com', { execImpl }), false);
});

test('isLoggedIn returns false when only unrelated-domain cookies', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: cookiesPayload({ name: 's', value: 'x', domain: 'other.com' }),
    },
  });
  assert.equal(await isLoggedIn('marinelayer.com', { execImpl }), false);
});

test('isLoggedIn propagates invalid_host', async () => {
  await assert.rejects(
    () => isLoggedIn('', { execImpl: async () => ({ stdout: '{}', stderr: '' }) }),
    (err) => err.code === 'invalid_host'
  );
});

test('isLoggedIn propagates browser_failed', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} cookies get --json`]: {
      stdout: { success: false, data: null, error: 'oops' },
    },
  });
  await assert.rejects(
    () => isLoggedIn('marinelayer.com', { execImpl }),
    (err) => err.code === 'browser_failed'
  );
});
