import test from 'node:test';
import assert from 'node:assert/strict';
import * as shopify from '../../lib/retailers/shopify.js';
import { detect } from '../../lib/retailers/shopify.js';

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
