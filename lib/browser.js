import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { browserProfilePath } from './paths.js';
import { normalizeHost } from './host.js';

const defaultExec = promisify(execFile);

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function runAgentBrowser(args, { execImpl = defaultExec } = {}) {
  const fullArgs = args.includes('--profile')
    ? args
    : ['--profile', browserProfilePath(), ...args];

  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execImpl('agent-browser', fullArgs));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw makeError('browser_unavailable', 'agent-browser not found on PATH');
    }
    throw makeError('browser_failed', `agent-browser exited with error: ${err.stderr ?? err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const excerpt = stdout.length <= 200 ? stdout : stdout.slice(0, 200) + '…';
    throw makeError('browser_failed', `Malformed JSON from agent-browser: ${excerpt}`);
  }

  if (parsed.success === false) {
    const msg = parsed.error ?? '';
    if (msg.toLowerCase().includes('no active session')) {
      return null;
    }
    throw makeError('browser_failed', msg);
  }

  return parsed.data ?? null;
}

export async function closeBrowser({ execImpl } = {}) {
  await runAgentBrowser(['close'], { execImpl });
}

export async function openLoginPage(host, { execImpl } = {}) {
  const normalizedHost = normalizeHost(host);
  const url = `https://${normalizedHost}/`;
  await runAgentBrowser(['open', url], { execImpl });
}
