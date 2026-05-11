import test from 'node:test';
import assert from 'node:assert/strict';
import * as shopify from '../../lib/retailers/shopify.js';
import { detect } from '../../lib/retailers/shopify.js';
import { search } from '../../lib/retailers/shopify.js';

const SAMPLE_PRODUCT = {
  id: 100,
  handle: 'crew-sweater',
  title: 'Crew Neck Sweater',
  vendor: 'Marine Layer',
  images: [{ src: 'https://cdn.shopify.com/.../crew.jpg' }],
  options: [
    { name: 'Size', position: 1 },
    { name: 'Color', position: 2 },
  ],
  variants: [
    { id: 1001, option1: 'M', option2: 'Navy', price: '98.00', available: true },
    { id: 1002, option1: 'L', option2: 'Navy', price: '98.00', available: false },
  ],
};

function makeResponse({ status = 200, body = '', contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

function mockFetch(routes) {
  return async (url, init) => {
    const route = routes[url] || routes[new URL(url).pathname + new URL(url).search];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    if (typeof route === 'function') return route(url, init);
    return makeResponse(route);
  };
}

test('shopify module loads', () => {
  assert.equal(typeof shopify, 'object');
});

// --- normalizeHost behavior (tested via detect, since normalizeHost isn't exported) ---

test('detect: accepts bare hostname', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: '<html>cdn.shopify.com</html>', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('marinelayer.com', { fetchImpl }), true);
});

test('detect: strips protocol', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('https://marinelayer.com', { fetchImpl }), true);
});

test('detect: strips trailing slash and path', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: 'cdn/shop/', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('https://marinelayer.com/products/abc', { fetchImpl }), true);
});

test('detect: lowercases', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('MarineLayer.com', { fetchImpl }), true);
});

test('detect: throws invalid_host on empty / null / no dot / whitespace', async () => {
  for (const bad of ['', '   ', null, undefined, 'localhost', '.com', 'mar ine.com']) {
    await assert.rejects(
      () => detect(bad, { fetchImpl: async () => { throw new Error('should not fetch'); } }),
      (err) => err.code === 'invalid_host',
      `expected invalid_host for ${JSON.stringify(bad)}`
    );
  }
});

// --- detect behavior ---

test('detect: returns true when markers present and products.json works', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/': { body: '<html>cdn.shopify.com</html>', contentType: 'text/html' },
    'https://marinelayer.com/products.json?limit=1': { body: { products: [{ id: 1 }] } },
  });
  assert.equal(await detect('marinelayer.com', { fetchImpl }), true);
});

test('detect: returns false when no Shopify markers in HTML', async () => {
  const fetchImpl = mockFetch({
    'https://example.com/': { body: '<html>nothing here</html>', contentType: 'text/html' },
  });
  assert.equal(await detect('example.com', { fetchImpl }), false);
});

test('detect: returns false when markers present but products.json 404s', async () => {
  const fetchImpl = mockFetch({
    'https://example.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://example.com/products.json?limit=1': { status: 404, body: 'Not Found', contentType: 'text/plain' },
  });
  assert.equal(await detect('example.com', { fetchImpl }), false);
});

test('detect: returns false when products.json returns wrong shape', async () => {
  const fetchImpl = mockFetch({
    'https://example.com/': { body: 'cdn.shopify.com', contentType: 'text/html' },
    'https://example.com/products.json?limit=1': { body: { not_products: [] } },
  });
  assert.equal(await detect('example.com', { fetchImpl }), false);
});

test('detect: returns false on network error', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await detect('marinelayer.com', { fetchImpl }), false);
});

test('detect: accepts cdn/shop/ marker as alternative to cdn.shopify.com', async () => {
  const fetchImpl = mockFetch({
    'https://newstore.com/': { body: '<link href="/cdn/shop/files/logo.png">', contentType: 'text/html' },
    'https://newstore.com/products.json?limit=1': { body: { products: [] } },
  });
  assert.equal(await detect('newstore.com', { fetchImpl }), true);
});

// --- search ---

test('search: normalizes product into spec shape', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=sweater&limit=50': { body: { products: [SAMPLE_PRODUCT] } },
  });
  const results = await search('marinelayer.com', 'sweater', { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://marinelayer.com/products/crew-sweater');
  assert.equal(results[0].brand, 'Marine Layer');
  assert.equal(results[0].title, 'Crew Neck Sweater');
  assert.equal(results[0].price, '98.00');
  assert.equal(results[0].image, 'https://cdn.shopify.com/.../crew.jpg');
  assert.equal(results[0].variants.length, 2);
  assert.deepEqual(results[0].variants[0], { size: 'M', color: 'Navy', in_stock: true, variant_id: 1001 });
  assert.deepEqual(results[0].variants[1], { size: 'L', color: 'Navy', in_stock: false, variant_id: 1002 });
});

test('search: URL-encodes query with spaces and special chars', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return makeResponse({ body: { products: [] } }); };
  await search('marinelayer.com', 'navy & cream', { fetchImpl });
  assert.match(seenUrl, /q=navy%20%26%20cream/);
});

test('search: respects custom limit', async () => {
  let seenUrl;
  const fetchImpl = async (url) => { seenUrl = url; return makeResponse({ body: { products: [] } }); };
  await search('marinelayer.com', 'x', { fetchImpl, limit: 10 });
  assert.match(seenUrl, /limit=10/);
});

test('search: returns empty array on no results', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=xyz&limit=50': { body: { products: [] } },
  });
  assert.deepEqual(await search('marinelayer.com', 'xyz', { fetchImpl }), []);
});

test('search: throws invalid_query on empty / whitespace', async () => {
  const fetchImpl = async () => { throw new Error('should not fetch'); };
  for (const bad of ['', '   ', '\t']) {
    await assert.rejects(
      () => search('marinelayer.com', bad, { fetchImpl }),
      (err) => err.code === 'invalid_query'
    );
  }
});

test('search: throws invalid_host on bad host', async () => {
  await assert.rejects(
    () => search('', 'sweater', { fetchImpl: async () => ({}) }),
    (err) => err.code === 'invalid_host'
  );
});

test('search: drops products with missing handle', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': {
      body: { products: [SAMPLE_PRODUCT, { id: 999, title: 'No Handle' }] },
    },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results.length, 1);
});

test('search: handles product with no images (image: null)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': {
      body: { products: [{ ...SAMPLE_PRODUCT, images: [] }] },
    },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].image, null);
});

test('search: handles product with no variants (variants: [], price: null)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': {
      body: { products: [{ ...SAMPLE_PRODUCT, variants: [] }] },
    },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.deepEqual(results[0].variants, []);
  assert.equal(results[0].price, null);
});

test('search: when options metadata says color-first, swaps axis assignment', async () => {
  const colorFirstProduct = {
    ...SAMPLE_PRODUCT,
    options: [{ name: 'Color', position: 1 }, { name: 'Size', position: 2 }],
    variants: [{ id: 1, option1: 'Navy', option2: 'M', price: '98.00', available: true }],
  };
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { body: { products: [colorFirstProduct] } },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].variants[0].size, 'M');
  assert.equal(results[0].variants[0].color, 'Navy');
});

test('search: when options metadata absent, defaults to option1=size option2=color', async () => {
  const noMetaProduct = { ...SAMPLE_PRODUCT, options: undefined };
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { body: { products: [noMetaProduct] } },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].variants[0].size, 'M');
  assert.equal(results[0].variants[0].color, 'Navy');
});

test('search: propagates http_error on 5xx (does not swallow like detect)', async () => {
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { status: 500, body: 'server error', contentType: 'text/plain' },
  });
  await assert.rejects(
    () => search('marinelayer.com', 'x', { fetchImpl }),
    (err) => err.code === 'http_error'
  );
});

test('search: handles price as numeric (not string) by stringifying', async () => {
  const numericPriceProduct = {
    ...SAMPLE_PRODUCT,
    variants: [{ id: 1, option1: 'M', option2: 'Navy', price: 98, available: true }],
  };
  const fetchImpl = mockFetch({
    'https://marinelayer.com/products.json?q=x&limit=50': { body: { products: [numericPriceProduct] } },
  });
  const results = await search('marinelayer.com', 'x', { fetchImpl });
  assert.equal(results[0].price, '98');
});
