import test from 'node:test';
import assert from 'node:assert/strict';
import { httpGetJson, httpPostJson } from '../lib/http.js';

function makeResponse({ status = 200, body = '', contentType = 'application/json' }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

test('httpGetJson returns parsed body on 200 + application/json', async () => {
  const fetchImpl = async () => makeResponse({ body: { hello: 'world' } });
  const result = await httpGetJson('https://example.com/x', { fetchImpl });
  assert.deepEqual(result, { hello: 'world' });
});

test('httpGetJson throws http_error on 404', async () => {
  const fetchImpl = async () => makeResponse({ status: 404, body: 'Not Found', contentType: 'text/plain' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'http_error' && err.status === 404 && err.url.includes('example.com')
  );
});

test('httpGetJson throws not_json on 200 + text/html (Shopify auth redirect)', async () => {
  const fetchImpl = async () => makeResponse({ body: '<html>login</html>', contentType: 'text/html' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'not_json'
  );
});

test('httpGetJson throws invalid_json when content-type lies', async () => {
  const fetchImpl = async () => makeResponse({ body: 'not json{{{', contentType: 'application/json' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'invalid_json'
  );
});

test('httpGetJson wraps network errors as network_error with URL in message', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => httpGetJson('https://example.com/x?token=secret', { fetchImpl }),
    (err) =>
      err.code === 'network_error'
      && err.message.includes('ECONNREFUSED')
      && err.message.includes('example.com')
      && !err.message.includes('secret')
      && err.url === 'https://example.com/x'
  );
});

test('httpGetJson strips query params from error URL', async () => {
  const fetchImpl = async () => makeResponse({ status: 500, body: 'oops' });
  await assert.rejects(
    () => httpGetJson('https://example.com/x?q=secret-token', { fetchImpl }),
    (err) => !err.url.includes('secret-token') && err.url.includes('/x')
  );
});

test('httpGetJson includes 200-char body excerpt in http_error', async () => {
  const longBody = 'A'.repeat(500);
  const fetchImpl = async () => makeResponse({ status: 500, body: longBody });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.message.length < 500 && err.message.includes('AAA')
  );
});

test('httpGetJson passes custom headers through', async () => {
  let seenInit;
  const fetchImpl = async (url, init) => { seenInit = init; return makeResponse({ body: {} }); };
  await httpGetJson('https://example.com/x', { fetchImpl, headers: { Cookie: 'sess=abc' } });
  assert.equal(seenInit.headers.Cookie, 'sess=abc');
});

test('httpPostJson sends JSON.stringify(body) with content-type', async () => {
  let seenInit;
  const fetchImpl = async (url, init) => { seenInit = init; return makeResponse({ body: { ok: true } }); };
  const result = await httpPostJson('https://example.com/cart/add.js', { id: 42, quantity: 1 }, { fetchImpl });
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers['Content-Type'], 'application/json');
  assert.equal(seenInit.body, JSON.stringify({ id: 42, quantity: 1 }));
  assert.deepEqual(result, { ok: true });
});

test('httpPostJson surfaces 422 with parsed body in error', async () => {
  const fetchImpl = async () => makeResponse({ status: 422, body: { description: 'Out of stock' } });
  await assert.rejects(
    () => httpPostJson('https://example.com/cart/add.js', {}, { fetchImpl }),
    (err) => err.code === 'http_error' && err.status === 422 && err.message.includes('Out of stock')
  );
});

test('httpPostJson wraps network errors as network_error with URL', async () => {
  const fetchImpl = async () => { throw new Error('ETIMEDOUT'); };
  await assert.rejects(
    () => httpPostJson('https://example.com/cart/add.js', {}, { fetchImpl }),
    (err) =>
      err.code === 'network_error'
      && err.message.includes('ETIMEDOUT')
      && err.url === 'https://example.com/cart/add.js'
  );
});

test('httpGetJson throws invalid_url on unparseable input', async () => {
  for (const bad of ['', 'not a url', 'http://', '/relative/path']) {
    await assert.rejects(
      () => httpGetJson(bad, { fetchImpl: async () => ({}) }),
      (err) => err.code === 'invalid_url',
      `expected invalid_url for ${JSON.stringify(bad)}`
    );
  }
});

test('httpPostJson throws invalid_url on unparseable input', async () => {
  await assert.rejects(
    () => httpPostJson('not a url', {}, { fetchImpl: async () => ({}) }),
    (err) => err.code === 'invalid_url'
  );
});

test('httpGetJson accepts application/json with charset (Shopify-style)', async () => {
  const fetchImpl = async () => makeResponse({
    body: { ok: true },
    contentType: 'application/json; charset=utf-8',
  });
  const result = await httpGetJson('https://example.com/x', { fetchImpl });
  assert.deepEqual(result, { ok: true });
});

test('httpGetJson rejects application/jsonweirdsuffix as not_json', async () => {
  const fetchImpl = async () => makeResponse({
    body: '{"hello":"world"}',
    contentType: 'application/jsonweirdsuffix',
  });
  await assert.rejects(
    () => httpGetJson('https://example.com/x', { fetchImpl }),
    (err) => err.code === 'not_json'
  );
});

test('httpPostJson accepts text/javascript (Shopify cart/add.js)', async () => {
  // Shopify's /cart/add.js returns content-type text/javascript with a JSON body.
  // Before v0.11.1 this was misclassified as not_json → authentication_required,
  // masking successful adds as auth failures.
  const fetchImpl = async () => makeResponse({
    body: { id: 12345, quantity: 1, key: 'abc' },
    contentType: 'text/javascript; charset=utf-8',
  });
  const result = await httpPostJson('https://example.com/cart/add.js', { id: 12345 }, { fetchImpl });
  assert.deepEqual(result, { id: 12345, quantity: 1, key: 'abc' });
});

test('httpGetJson accepts application/javascript', async () => {
  const fetchImpl = async () => makeResponse({
    body: { ok: true },
    contentType: 'application/javascript',
  });
  const result = await httpGetJson('https://example.com/x', { fetchImpl });
  assert.deepEqual(result, { ok: true });
});
