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

  let host = input.replace(/^https?:\/\//i, '');
  host = host.split('/')[0];
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

// Shopify products carry option1/option2/option3 but don't say which axis is which.
// We read product.options metadata to map size/color to the right slot; default to
// size=option1, color=option2 when metadata is missing.
function resolveAxes(options) {
  if (!Array.isArray(options)) return { sizeKey: 'option1', colorKey: 'option2' };

  let sizePos = null;
  let colorPos = null;
  for (const opt of options) {
    const name = (opt.name ?? '').toLowerCase();
    if (name === 'size') sizePos = opt.position;
    else if (name === 'color' || name === 'colour') colorPos = opt.position;
  }

  const sizeKey = sizePos != null ? `option${sizePos}` : 'option1';
  const colorKey = colorPos != null ? `option${colorPos}` : 'option2';
  return { sizeKey, colorKey };
}

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

function parseProductHandle(productUrl) {
  let parsed;
  try {
    parsed = new URL(productUrl);
  } catch {
    throw makeError('invalid_product_url', `Unparseable product URL: ${JSON.stringify(productUrl)}`);
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
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

  try {
    const res = await fetchImpl(`https://${host}/`);
    const body = await res.text();
    if (!body.includes('cdn.shopify.com') && !body.includes('cdn/shop/')) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const data = await httpGetJson(`https://${host}/products.json?limit=1`, { fetchImpl });
    return Array.isArray(data?.products);
  } catch {
    return false;
  }
}

// Returns {ok: true} on success or {ok: false, error} for runtime failures
// (out_of_stock, authentication_required, http_<status>, network). Throws only
// for programmer errors (invalid_host / invalid_variant_id / invalid_cookie) —
// every runtime failure has a UI recovery path, so callers shouldn't need try/catch.
export async function addToCart({ host, variantId, cookie, fetchImpl = fetch }) {
  const normalizedHost = normalizeHost(host);

  const numericId = Number(variantId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw makeError('invalid_variant_id', `variantId must be a positive integer: ${JSON.stringify(variantId)}`);
  }

  if (cookie == null || typeof cookie !== 'string' || cookie.trim() === '') {
    throw makeError('invalid_cookie', `cookie must be a non-empty string`);
  }

  try {
    await httpPostJson(
      `https://${normalizedHost}/cart/add.js`,
      { id: numericId, quantity: 1 },
      { fetchImpl, headers: { Cookie: cookie } }
    );
    return { ok: true };
  } catch (err) {
    if (err.code === 'network_error') return { ok: false, error: 'network' };
    if (err.code === 'not_json') return { ok: false, error: 'authentication_required' };
    if (err.code === 'http_error') {
      if (err.status === 422) return { ok: false, error: 'out_of_stock' };
      if (err.status === 401 || err.status === 403) return { ok: false, error: 'authentication_required' };
      return { ok: false, error: `http_${err.status}` };
    }
    throw err;
  }
}
