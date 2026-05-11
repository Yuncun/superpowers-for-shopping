// Plan 2 entry point. Functions added in subsequent tasks.
import { httpGetJson, httpPostJson } from '../http.js';

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

// Determine which optionN slot corresponds to size vs color using product.options metadata.
// Default: option1=size, option2=color when metadata is absent or neither axis found.
function resolveAxes(options) {
  if (!Array.isArray(options)) return { sizeKey: 'option1', colorKey: 'option2' };

  let sizePos = null;
  let colorPos = null;
  for (const opt of options) {
    const name = (opt.name ?? '').toLowerCase();
    if (name === 'size') sizePos = opt.position;
    else if (name === 'color' || name === 'colour') colorPos = opt.position;
  }

  // position 1 → option1, position 2 → option2, etc.
  const sizeKey = sizePos != null ? `option${sizePos}` : 'option1';
  const colorKey = colorPos != null ? `option${colorPos}` : 'option2';
  return { sizeKey, colorKey };
}

// Pure helper: maps raw Shopify variant array to [{size, color, in_stock, variant_id}].
// product.options is used to determine axis assignment.
function normalizeVariants(product) {
  const { sizeKey, colorKey } = resolveAxes(product.options);
  return (product.variants ?? []).map((v) => ({
    size: v[sizeKey] ?? null,
    color: v[colorKey] ?? null,
    in_stock: v.available === true,
    variant_id: v.id,
  }));
}

function normalizeProduct(host, product) {
  const variants = normalizeVariants(product);
  const rawPrice = product.variants?.[0]?.price;
  const price = rawPrice != null ? String(rawPrice) : null;

  return {
    url: `https://${host}/products/${product.handle}`,
    image: product.images?.[0]?.src ?? null,
    brand: product.vendor ?? null,
    title: product.title ?? null,
    price,
    variants,
  };
}

export async function search(input, query, { fetchImpl = fetch, limit = 50 } = {}) {
  const host = normalizeHost(input);

  if (typeof query !== 'string' || query.trim() === '') {
    throw makeError('invalid_query', `Query must be a non-empty string`);
  }

  const encoded = encodeURIComponent(query);
  const url = `https://${host}/products.json?q=${encoded}&limit=${limit}`;
  const data = await httpGetJson(url, { fetchImpl });

  return (data.products ?? [])
    .filter((p) => p.handle)
    .map((p) => normalizeProduct(host, p));
}

export function cartUrl(input) {
  const host = normalizeHost(input);
  return `https://${host}/cart`;
}

// Parse productUrl and return the handle, or throw invalid_product_url.
// Accepts optional trailing slash, query, and fragment.
// Requires path segments: /products/<non-empty-handle>
function parseProductHandle(productUrl) {
  let parsed;
  try {
    parsed = new URL(productUrl);
  } catch {
    throw makeError('invalid_product_url', `Unparseable product URL: ${JSON.stringify(productUrl)}`);
  }

  // Split pathname on '/' and filter out empty segments (handles trailing slash)
  const segments = parsed.pathname.split('/').filter(Boolean);
  // segments[0] must be 'products', segments[1] must be a non-empty handle
  if (segments[0] !== 'products' || !segments[1]) {
    throw makeError('invalid_product_url', `URL path does not match /products/<handle>: ${productUrl}`);
  }

  return { host: parsed.hostname, handle: segments[1] };
}

export async function fetchVariants(productUrl, { fetchImpl = fetch } = {}) {
  const { host, handle } = parseProductHandle(productUrl);
  const url = `https://${host}/products/${handle}.json`;
  const data = await httpGetJson(url, { fetchImpl });
  return normalizeVariants(data.product);
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

// addToCart returns {ok: true} on success, {ok: false, error} for runtime failures.
// Throws only for programmer errors: invalid_host, invalid_variant_id, invalid_cookie.
export async function addToCart({ host, variantId, cookie, fetchImpl = fetch }) {
  // Programmer-error validation (throws)
  const normalizedHost = normalizeHost(host);

  const numericId = Number(variantId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw makeError('invalid_variant_id', `variantId must be a positive integer: ${JSON.stringify(variantId)}`);
  }

  if (cookie == null || typeof cookie !== 'string' || cookie.trim() === '') {
    throw makeError('invalid_cookie', `cookie must be a non-empty string`);
  }

  // Runtime call — translate typed errors to {ok: false, error}
  try {
    await httpPostJson(
      `https://${normalizedHost}/cart/add.js`,
      { id: numericId, quantity: 1 },
      { fetchImpl, headers: { Cookie: cookie } }
    );
    return { ok: true };
  } catch (err) {
    if (err.code === 'network_error') {
      return { ok: false, error: 'network' };
    }
    if (err.code === 'not_json') {
      return { ok: false, error: 'authentication_required' };
    }
    if (err.code === 'http_error') {
      if (err.status === 422) return { ok: false, error: 'out_of_stock' };
      if (err.status === 401 || err.status === 403) return { ok: false, error: 'authentication_required' };
      return { ok: false, error: `http_${err.status}` };
    }
    // Unexpected error — re-throw
    throw err;
  }
}
