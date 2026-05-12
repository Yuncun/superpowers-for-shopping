import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../server/render.js';

const BASE = {
  id: 'aabbccdd11223344',
  token: 'ffee00112233445566778899aabbccdd',
  baseUrl: 'http://127.0.0.1:54321',
};

test('output starts with <!doctype html>', () => {
  const html = renderPage(BASE);
  assert.ok(html.startsWith('<!doctype html>'), `got: ${html.slice(0, 30)}`);
});

test('output contains window.__SESSION__ with id, token, baseUrl', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('window.__SESSION__'), 'missing __SESSION__ assignment');
  assert.ok(html.includes(BASE.id), 'id not in output');
  assert.ok(html.includes(BASE.token), 'token not in output');
  assert.ok(html.includes('127.0.0.1:54321'), 'baseUrl not in output');
});

test('adversarial baseUrl does not break out of script context', () => {
  const evil = { ...BASE, baseUrl: '</script><script>alert(1)</script>' };
  const html = renderPage(evil);
  // The literal </script> must NOT appear inside the data block.
  // The JSON encoding escapes '<' to '<', so the tag is neutralized.
  // Find the __SESSION__ assignment and check the content up to the closing tag.
  const start = html.indexOf('window.__SESSION__');
  const end = html.indexOf('</script>', start);
  const dataBlock = html.slice(start, end);
  assert.ok(!dataBlock.includes('</script>'), `script context escaped: ${dataBlock}`);
});

test('CSS contains a .grid class', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('.grid'), 'missing .grid class in CSS');
});

test('JS branches on state.stage for thumbs, final, redirect', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('thumbs'), 'missing thumbs stage');
  assert.ok(html.includes('final'), 'missing final stage');
  assert.ok(html.includes('redirect'), 'missing redirect stage');
});

test('JS render contains a branch for login_required stage', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('login_required'), 'missing login_required stage branch in JS');
});

test('JS render sends login_complete action for login_required stage', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('login_complete'), "missing login_complete action in JS");
});

test('JS opens an EventSource', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('EventSource('), 'missing EventSource call');
});

test('JS sends actions via fetch or navigator.sendBeacon', () => {
  const html = renderPage(BASE);
  const hasFetch = html.includes('fetch(');
  const hasBeacon = html.includes('navigator.sendBeacon(');
  assert.ok(hasFetch || hasBeacon, 'missing fetch or sendBeacon for action posting');
});

// Regression: a quoting bug inside a render branch (e.g. an unescaped
// apostrophe in a single-quoted JS string nested in the outer template
// literal) makes the whole inline <script> unparseable, so the page renders
// blank. Browser-side parse failures are silent unless you have devtools open.
// Compile the inline script with vm.Script — if the syntax is bad anywhere,
// this throws synchronously regardless of which render branch contains it.
test('inline script body parses as valid JavaScript', () => {
  const html = renderPage(BASE);
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no <script> block in rendered HTML');
  const scriptBody = m[1];
  assert.doesNotThrow(
    () => new vm.Script(scriptBody, { filename: 'rendered-inline.js' }),
    (err) => {
      // Surface the file:line so a future regression is debuggable from CI.
      return new Error(`Inline script parse failure: ${err.message}\nScript head:\n${scriptBody.slice(0, 400)}`);
    },
  );
});
