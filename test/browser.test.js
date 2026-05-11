// test/browser.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser } from '../lib/browser.js';
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
    [`agent-browser --profile ${browserProfilePath()} close`]: {
      stdout: { success: true, data: null, error: null },
    },
  });
  await closeBrowser({ execImpl });
  // no throw = pass
});

test('closeBrowser is a no-op when no session is open', async () => {
  const execImpl = mockExec({
    [`agent-browser --profile ${browserProfilePath()} close`]: {
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
    [`agent-browser --profile ${browserProfilePath()} close`]: {
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
    [`agent-browser --profile ${browserProfilePath()} close`]: {
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
  // Indirect test via closeBrowser with a custom args list isn't possible (no exported override).
  // Instead, we verify that closeBrowser's invocation only ever passes --profile once by checking
  // the seen args. This guards against accidental duplication during refactors.
  let seenArgs;
  const execImpl = async (file, args) => {
    seenArgs = args;
    return { stdout: JSON.stringify({ success: true, data: null, error: null }), stderr: '' };
  };
  await closeBrowser({ execImpl });
  const profileFlagCount = seenArgs.filter((a) => a === '--profile').length;
  assert.equal(profileFlagCount, 1, `expected exactly one --profile flag, got ${profileFlagCount}: ${seenArgs.join(' ')}`);
});
