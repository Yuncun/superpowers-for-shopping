import { httpGetJson } from '../http.js';
import { normalizeHost } from '../host.js';

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
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

// Build the suggest URL. Brackets MUST be percent-encoded (`%5B`/`%5D`); the
// Shopify suggest endpoint 400s on raw `[`/`]`. encodeURIComponent doesn't
// touch brackets, so we hard-code them.
export function buildSuggestUrl(host, query, limit = 50) {
  const encoded = encodeURIComponent(query);
  return `https://${host}/search/suggest.json?q=${encoded}&resources%5Btype%5D=product&resources%5Blimit%5D=${limit}`;
}

export function buildProductDetailUrl(host, handle) {
  return `https://${host}/products/${encodeURIComponent(handle)}.json`;
}

// Map a detail product + its suggest summary to the orchestrator's expected
// shape. Reuses the existing `normalizeVariants` / `normalizeProduct` helpers
// so axis-mapping logic stays in one place.
function mergeSuggestAndDetail(host, suggestProduct, detailProduct) {
  // Build the base off the detail (variants, options, vendor, images) but fall
  // back to suggest's vendor/image/title for products that ship sparse details.
  const base = normalizeProduct(host, {
    ...detailProduct,
    handle: detailProduct?.handle ?? suggestProduct.handle,
  });

  return {
    title: base.title || suggestProduct.title || null,
    brand: base.brand || suggestProduct.vendor || null,
    price: base.price ?? (suggestProduct.price != null ? String(suggestProduct.price) : null),
    url: base.url,
    image: base.image || suggestProduct.featured_image?.url || suggestProduct.image || null,
    variants: base.variants,
  };
}

// Promise-pool that fans out detail fetches with a hard concurrency cap. Order
// is preserved (output[i] corresponds to suggestProducts[i]); failures slot in
// as nulls and are filtered out by the caller.
async function fetchDetailsForHandles(host, suggestProducts, concurrency, fetchImpl) {
  const results = new Array(suggestProducts.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= suggestProducts.length) return;
      const sp = suggestProducts[i];
      try {
        const data = await httpGetJson(buildProductDetailUrl(host, sp.handle), { fetchImpl });
        if (!data?.product) {
          results[i] = null;
          continue;
        }
        results[i] = mergeSuggestAndDetail(host, sp, data.product);
      } catch (err) {
        // Drop unfetchable; log and continue. Other results still ship.
        console.warn(`shopify search: failed to fetch /products/${sp.handle}.json: ${err.message}`);
        results[i] = null;
      }
    }
  }

  const pool = Math.max(1, Math.min(concurrency, suggestProducts.length));
  await Promise.all(Array.from({ length: pool }, worker));
  return results.filter(Boolean);
}

export async function search(input, query, { fetchImpl = fetch, limit = 50, detailConcurrency = 8 } = {}) {
  const host = normalizeHost(input);

  if (typeof query !== 'string' || query.trim() === '') {
    throw makeError('invalid_query', `Query must be a non-empty string`);
  }

  // Phase 1: relevance-ranked suggest. Any failure here returns an empty array —
  // the orchestrator already handles `no_results` cleanly downstream.
  const suggestUrl = buildSuggestUrl(host, query, limit);
  let suggestData;
  try {
    suggestData = await httpGetJson(suggestUrl, { fetchImpl });
  } catch (err) {
    if (err.code === 'http_error' || err.code === 'not_json' || err.code === 'invalid_json' || err.code === 'network_error') {
      console.warn(`shopify search: suggest failed for ${host} "${query}": ${err.code} (${err.message})`);
      return [];
    }
    throw err;
  }

  const products = suggestData?.resources?.results?.products ?? [];
  if (products.length === 0) return [];

  // Dedup by handle. Suggest occasionally returns the same handle multiple
  // times due to overlapping placement weights.
  const byHandle = new Map();
  for (const p of products) {
    if (p?.handle && !byHandle.has(p.handle)) byHandle.set(p.handle, p);
  }
  const unique = [...byHandle.values()];
  if (unique.length === 0) return [];

  // Phase 2: parallel detail fetches, capped at detailConcurrency.
  return fetchDetailsForHandles(host, unique, detailConcurrency, fetchImpl);
}

export function cartUrl(input) {
  const host = normalizeHost(input);
  return `https://${host}/cart`;
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

/**
 * Build a Shopify cart-permalink URL that, when visited in the user's logged-in
 * browser, adds the listed variants to their cart and redirects to /cart.
 *
 * Shape: https://<host>/cart/<variant_id>:<qty>,<variant_id>:<qty>,...
 *
 * Why this instead of POST /cart/add.js from Node: the permalink uses the
 * user's own browser cookies, so the items land in the actual cart they'll
 * see. Posting from Node would only add to a discarded cookie jar.
 */
export function buildCartPermalink(host, variants) {
  const normalizedHost = normalizeHost(host);
  if (!Array.isArray(variants) || variants.length === 0) {
    throw makeError('empty_variants', 'variants must be a non-empty array');
  }
  const segments = variants.map((v) => {
    const numericId = Number(v.variant_id ?? v);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw makeError('invalid_variant_id', `variant_id must be a positive integer: ${JSON.stringify(v)}`);
    }
    const qty = Number.isInteger(v.quantity) && v.quantity > 0 ? v.quantity : 1;
    return `${numericId}:${qty}`;
  });
  return `https://${normalizedHost}/cart/${segments.join(',')}`;
}
