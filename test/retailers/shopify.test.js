import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, search, cartUrl, buildCartPermalink } from '../../lib/retailers/shopify.js';

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

test.skip('shopify module loads', () => {
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

// --- search (real /search/suggest.json implementation) ---

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

function buildSuggestUrlFor(host, query, limit = 50) {
  return `https://${host}/search/suggest.json?q=${encodeURIComponent(query)}&resources%5Btype%5D=product&resources%5Blimit%5D=${limit}`;
}

function buildDetailUrlFor(host, handle) {
  return `https://${host}/products/${encodeURIComponent(handle)}.json`;
}

// Minimal suggest-response builder: products in suggest carry handle, title, vendor,
// price (string), featured_image{url}, image. Variants are always [] in suggest.
function suggestProduct({ handle, title = handle, vendor = 'Marine Layer', price = '98.00', featured_image, image }) {
  return {
    handle,
    title,
    vendor,
    price,
    price_min: price,
    price_max: price,
    available: true,
    tags: [],
    type: '',
    product_type: 'None',
    body: null,
    variants: [],
    featured_image: featured_image ?? { url: `https://cdn.shopify.com/${handle}.jpg`, alt: title },
    image: image ?? `https://cdn.shopify.com/${handle}.jpg`,
    url: `/products/${handle}`,
  };
}

function suggestResponse(products) {
  return { resources: { results: { products } } };
}

// Detail-shaped product (what /products/<handle>.json returns inside .product).
function detailProduct(overrides = {}) {
  return {
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
    ...overrides,
  };
}

// 1. Empty query throws invalid_query.
test('search: throws invalid_query on empty / whitespace', async () => {
  const fetchImpl = async () => { throw new Error('should not fetch'); };
  for (const bad of ['', '   ', '\t']) {
    await assert.rejects(
      () => search('marinelayer.com', bad, { fetchImpl }),
      (err) => err.code === 'invalid_query'
    );
  }
});

// 2. Invalid host throws invalid_host.
test('search: throws invalid_host on bad host', async () => {
  await assert.rejects(
    () => search('', 'sweater', { fetchImpl: async () => ({}) }),
    (err) => err.code === 'invalid_host'
  );
});

// 3. Empty products from suggest → [].
test('search: returns [] when suggest endpoint returns empty products', async () => {
  const fetchImpl = mockFetch({
    [buildSuggestUrlFor('marinelayer.com', 'xyzzy')]: { body: suggestResponse([]) },
  });
  assert.deepEqual(await search('marinelayer.com', 'xyzzy', { fetchImpl }), []);
});

// 4. Suggest 404 → [] gracefully.
test('search: returns [] when suggest endpoint 404s', async () => {
  const fetchImpl = mockFetch({
    [buildSuggestUrlFor('marinelayer.com', 'sweater')]: { status: 404, body: 'Not Found', contentType: 'text/plain' },
  });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await search('marinelayer.com', 'sweater', { fetchImpl }), []);
  } finally {
    console.warn = origWarn;
  }
});

// 5. Suggest returns non-JSON → [] gracefully.
test('search: returns [] when suggest endpoint returns non-JSON', async () => {
  const fetchImpl = mockFetch({
    [buildSuggestUrlFor('marinelayer.com', 'sweater')]: { body: '<html>login</html>', contentType: 'text/html' },
  });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await search('marinelayer.com', 'sweater', { fetchImpl }), []);
  } finally {
    console.warn = origWarn;
  }
});

// 6. Suggest network error → [] gracefully.
test('search: returns [] on suggest network error', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await search('marinelayer.com', 'sweater', { fetchImpl }), []);
  } finally {
    console.warn = origWarn;
  }
});

// 7. Happy path: 3 suggest products + 3 detail fetches → 3 normalized in order.
test('search: happy path — fans out detail fetches and preserves suggest order', async () => {
  const handles = ['a-sweater', 'b-sweater', 'c-sweater'];
  const routes = {
    [buildSuggestUrlFor('marinelayer.com', 'sweater')]: {
      body: suggestResponse(handles.map((h) => suggestProduct({ handle: h, title: `${h} Title` }))),
    },
  };
  for (const h of handles) {
    routes[buildDetailUrlFor('marinelayer.com', h)] = {
      body: { product: detailProduct({ handle: h, title: `${h} Title` }) },
    };
  }
  const fetchImpl = mockFetch(routes);
  const results = await search('marinelayer.com', 'sweater', { fetchImpl });
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.url),
    handles.map((h) => `https://marinelayer.com/products/${h}`)
  );
  assert.equal(results[0].brand, 'Marine Layer');
  assert.equal(results[0].title, 'a-sweater Title');
  assert.equal(results[0].variants.length, 2);
  assert.equal(results[0].variants[0].size, 'M');
  assert.equal(results[0].variants[0].color, 'Navy');
  assert.equal(results[0].variants[0].variant_id, 1001);
  assert.equal(results[0].price, '98.00');
});

// 8. Dedup: same handle twice in suggest → one product in output.
test('search: dedups suggest products by handle', async () => {
  const dup = suggestProduct({ handle: 'icon-sweater', title: 'Icon Sweater' });
  const fetchImpl = mockFetch({
    [buildSuggestUrlFor('marinelayer.com', 'sweater')]: {
      body: suggestResponse([dup, dup, dup]),
    },
    [buildDetailUrlFor('marinelayer.com', 'icon-sweater')]: {
      body: { product: detailProduct({ handle: 'icon-sweater', title: 'Icon Sweater' }) },
    },
  });
  const results = await search('marinelayer.com', 'sweater', { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://marinelayer.com/products/icon-sweater');
});

// 9. Concurrency: detailConcurrency cap respected.
test('search: respects detailConcurrency cap on detail fetches', async () => {
  const N = 10;
  const CAP = 3;
  const handles = Array.from({ length: N }, (_, i) => `p-${i}`);
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/search/suggest.json')) {
      return makeResponse({
        body: suggestResponse(handles.map((h) => suggestProduct({ handle: h, title: h }))),
      });
    }
    if (url.includes('/products/') && url.endsWith('.json')) {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      // yield to give other in-flight a chance to launch before we resolve
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      inFlight--;
      const match = url.match(/\/products\/([^.]+)\.json/);
      const handle = decodeURIComponent(match[1]);
      return makeResponse({ body: { product: detailProduct({ handle, title: handle }) } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const results = await search('marinelayer.com', 'x', { fetchImpl, detailConcurrency: CAP });
  assert.equal(results.length, N);
  assert.ok(maxInFlight <= CAP, `maxInFlight ${maxInFlight} exceeded cap ${CAP}`);
  assert.ok(maxInFlight >= 1, 'expected at least one in-flight detail fetch');
});

// 10. One detail 404s → others returned, failed dropped.
test('search: drops products whose detail fetch fails', async () => {
  const handles = ['ok-1', 'broken', 'ok-2'];
  const routes = {
    [buildSuggestUrlFor('marinelayer.com', 'sweater')]: {
      body: suggestResponse(handles.map((h) => suggestProduct({ handle: h, title: h }))),
    },
    [buildDetailUrlFor('marinelayer.com', 'ok-1')]: {
      body: { product: detailProduct({ handle: 'ok-1', title: 'ok-1' }) },
    },
    [buildDetailUrlFor('marinelayer.com', 'broken')]: {
      status: 404, body: 'Not Found', contentType: 'text/plain',
    },
    [buildDetailUrlFor('marinelayer.com', 'ok-2')]: {
      body: { product: detailProduct({ handle: 'ok-2', title: 'ok-2' }) },
    },
  };
  // Suppress warn so the test output isn't noisy.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const results = await search('marinelayer.com', 'sweater', { fetchImpl: mockFetch(routes) });
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.url), [
      'https://marinelayer.com/products/ok-1',
      'https://marinelayer.com/products/ok-2',
    ]);
  } finally {
    console.warn = origWarn;
  }
});

// 11. Fixture test: real captured suggest + detail responses. The first result
//     must be the Icon Sweater (top of suggest), and its title must contain
//     "sweater" case-insensitively.
test('search: fixture — sweater query returns a sweater first', async () => {
  const suggestFixture = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, 'marinelayer-suggest-sweater.json'), 'utf8')
  );
  const detailFixture = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, 'marinelayer-icon-sweater.json'), 'utf8')
  );

  const suggestUrl = buildSuggestUrlFor('marinelayer.com', 'sweater');
  const detailUrlsToFixture = new Map();
  // Map every handle in the suggest response → the same detail fixture
  // (representative for testing the pipeline; the relevance assertion is the
  // important part, not per-product accuracy).
  for (const p of suggestFixture.resources.results.products) {
    detailUrlsToFixture.set(buildDetailUrlFor('marinelayer.com', p.handle), detailFixture);
  }

  const fetchImpl = async (url) => {
    if (url === suggestUrl) return makeResponse({ body: suggestFixture });
    if (detailUrlsToFixture.has(url)) {
      return makeResponse({ body: detailUrlsToFixture.get(url) });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const results = await search('marinelayer.com', 'sweater', { fetchImpl });
  assert.ok(results.length > 0, 'expected at least one result');
  assert.match(results[0].title, /sweater/i, `first title "${results[0].title}" should contain "sweater"`);
});

// 12. Title-relevance: with the fixture, EVERY returned product's title contains
//     "sweater" (case-insensitive). All 10 suggest entries are sweaters.
test('search: fixture — all returned products are sweater-titled', async () => {
  const suggestFixture = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, 'marinelayer-suggest-sweater.json'), 'utf8')
  );
  const detailFixture = JSON.parse(
    readFileSync(path.join(FIXTURE_DIR, 'marinelayer-icon-sweater.json'), 'utf8')
  );

  const suggestUrl = buildSuggestUrlFor('marinelayer.com', 'sweater');
  const fetchImpl = async (url) => {
    if (url === suggestUrl) return makeResponse({ body: suggestFixture });
    // Any /products/<handle>.json → the same detail fixture for shape.
    if (/\/products\/[^/]+\.json$/.test(url)) {
      return makeResponse({ body: detailFixture });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const results = await search('marinelayer.com', 'sweater', { fetchImpl });
  for (const r of results) {
    // Loose: the title field (server-rendered) must mention sweater somewhere.
    assert.match(r.title, /sweater/i, `title "${r.title}" missing "sweater"`);
  }
  // Plus an actual count check so a regression to 0 doesn't silently pass.
  assert.ok(results.length >= 5, `expected ≥5 sweater results, got ${results.length}`);
});

// Bonus: verify the suggest URL contains URL-encoded brackets (regression
// pin — the endpoint 400s on unencoded brackets).
test('search: suggest URL uses %5B/%5D-encoded brackets', async () => {
  let seenUrl;
  const fetchImpl = async (url) => {
    seenUrl = url;
    return makeResponse({ body: suggestResponse([]) });
  };
  await search('marinelayer.com', 'sweater', { fetchImpl });
  assert.match(seenUrl, /resources%5Btype%5D=product/);
  assert.match(seenUrl, /resources%5Blimit%5D=\d+/);
  assert.ok(!seenUrl.includes('['), 'raw [ should not appear in URL');
  assert.ok(!seenUrl.includes(']'), 'raw ] should not appear in URL');
});

// --- cartUrl ---

test('cartUrl: builds cart URL from bare host', () => {
  assert.equal(cartUrl('marinelayer.com'), 'https://marinelayer.com/cart');
});

test('cartUrl: normalizes input (protocol, path, case)', () => {
  assert.equal(cartUrl('HTTPS://MarineLayer.com/products/x'), 'https://marinelayer.com/cart');
});

test('cartUrl: throws invalid_host on bad input', () => {
  assert.throws(() => cartUrl(''), (err) => err.code === 'invalid_host');
});

// --- buildCartPermalink ---

test('buildCartPermalink: single variant', () => {
  const url = buildCartPermalink('marinelayer.com', [{ variant_id: 1001 }]);
  assert.equal(url, 'https://marinelayer.com/cart/1001:1');
});

test('buildCartPermalink: multiple variants comma-joined', () => {
  const url = buildCartPermalink('marinelayer.com', [
    { variant_id: 1001 },
    { variant_id: 1002 },
    { variant_id: 1003 },
  ]);
  assert.equal(url, 'https://marinelayer.com/cart/1001:1,1002:1,1003:1');
});

test('buildCartPermalink: accepts raw integer ids', () => {
  const url = buildCartPermalink('marinelayer.com', [1001, 1002]);
  assert.equal(url, 'https://marinelayer.com/cart/1001:1,1002:1');
});

test('buildCartPermalink: honors explicit quantity', () => {
  const url = buildCartPermalink('marinelayer.com', [{ variant_id: 1001, quantity: 2 }]);
  assert.equal(url, 'https://marinelayer.com/cart/1001:2');
});

test('buildCartPermalink: normalizes host', () => {
  const url = buildCartPermalink('HTTPS://MarineLayer.com/products/x', [{ variant_id: 1001 }]);
  assert.equal(url, 'https://marinelayer.com/cart/1001:1');
});

test('buildCartPermalink: throws on empty variants', () => {
  assert.throws(() => buildCartPermalink('marinelayer.com', []), (err) => err.code === 'empty_variants');
});

test('buildCartPermalink: throws invalid_variant_id on non-numeric', () => {
  for (const bad of [{ variant_id: null }, { variant_id: 'abc' }, { variant_id: 0 }, { variant_id: -1 }]) {
    assert.throws(
      () => buildCartPermalink('marinelayer.com', [bad]),
      (err) => err.code === 'invalid_variant_id',
      `expected invalid_variant_id for ${JSON.stringify(bad)}`,
    );
  }
});

test('buildCartPermalink: throws invalid_host on bad host', () => {
  assert.throws(
    () => buildCartPermalink('', [{ variant_id: 1001 }]),
    (err) => err.code === 'invalid_host',
  );
});
