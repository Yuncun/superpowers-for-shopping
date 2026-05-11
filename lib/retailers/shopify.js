// Plan 2 entry point. Functions added in subsequent tasks.
import { httpGetJson } from '../http.js';

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeHost(input) {
  if (input == null || typeof input !== 'string' || input.trim() === '') {
    throw makeError('invalid_host', `Invalid host: ${JSON.stringify(input)}`);
  }

  // Strip protocol
  let host = input.replace(/^https?:\/\//i, '');
  // Strip path (everything from first slash)
  host = host.split('/')[0];
  // Lowercase and trim
  host = host.toLowerCase().trim();

  if (host === '') {
    throw makeError('invalid_host', `Invalid host: ${JSON.stringify(input)}`);
  }
  if (/\s/.test(host)) {
    throw makeError('invalid_host', `Host contains whitespace: ${JSON.stringify(input)}`);
  }
  if (!host.includes('.')) {
    throw makeError('invalid_host', `Host has no dot: ${JSON.stringify(input)}`);
  }
  if (host.startsWith('.')) {
    throw makeError('invalid_host', `Host starts with dot: ${JSON.stringify(input)}`);
  }

  return host;
}

export async function detect(input, { fetchImpl = fetch } = {}) {
  const host = normalizeHost(input);

  // Step 1: check HTML for Shopify markers using bare fetchImpl (homepage is HTML)
  try {
    const res = await fetchImpl(`https://${host}/`);
    const body = await res.text();
    if (!body.includes('cdn.shopify.com') && !body.includes('cdn/shop/')) {
      return false;
    }
  } catch {
    return false;
  }

  // Step 2: confirm products.json shape
  try {
    const data = await httpGetJson(`https://${host}/products.json?limit=1`, { fetchImpl });
    return Array.isArray(data?.products);
  } catch {
    return false;
  }
}
