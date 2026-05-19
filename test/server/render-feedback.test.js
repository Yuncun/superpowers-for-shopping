import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../server/render-feedback.js';

const BASE = {
  id: 'aabbccdd11223344',
  token: 'ffee00112233445566778899aabbccdd',
  baseUrl: 'http://127.0.0.1:54321',
};

test('feedback: output starts with <!doctype html>', () => {
  const html = renderPage(BASE);
  assert.ok(html.startsWith('<!doctype html>'), `got: ${html.slice(0, 30)}`);
});

test('feedback: output contains window.__SESSION__ with id, token, baseUrl', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('window.__SESSION__'));
  assert.ok(html.includes(BASE.id));
  assert.ok(html.includes(BASE.token));
  assert.ok(html.includes('127.0.0.1:54321'));
});

test('feedback: adversarial baseUrl does not break out of script context', () => {
  const evil = { ...BASE, baseUrl: '</script><script>alert(1)</script>' };
  const html = renderPage(evil);
  const start = html.indexOf('window.__SESSION__');
  const end = html.indexOf('</script>', start);
  const dataBlock = html.slice(start, end);
  assert.ok(!dataBlock.includes('</script>'), `script context escaped: ${dataBlock}`);
});

test('feedback: JS branches on form, saving, done stages', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes("stage === 'form'"), 'missing form stage branch');
  assert.ok(html.includes("stage === 'saving'"), 'missing saving stage branch');
  assert.ok(html.includes("stage === 'done'"), 'missing done stage branch');
});

test('feedback: JS sends submit and dismissed actions', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes("type: 'submit'"), 'missing submit action');
  assert.ok(html.includes("type: 'dismissed'"), 'missing dismissed action');
});

test('feedback: JS opens an EventSource', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('EventSource('), 'missing EventSource call');
});

test('feedback: choice labels include Kept / Returned / Skip', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('Kept'));
  assert.ok(html.includes('Returned'));
  assert.ok(html.includes('Skip'));
});

// Same regression guard as the /cart render test: a quoting bug inside the
// inline script makes the page render blank. vm.Script catches it.
test('feedback: inline script body parses as valid JavaScript', () => {
  const html = renderPage(BASE);
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no <script> block in rendered HTML');
  const scriptBody = m[1];
  assert.doesNotThrow(
    () => new vm.Script(scriptBody, { filename: 'rendered-inline.js' }),
    (err) => new Error(
      `Inline script parse failure: ${err.message}\nScript head:\n${scriptBody.slice(0, 400)}`,
    ),
  );
});
