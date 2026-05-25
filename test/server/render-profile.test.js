import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../server/render-profile.js';

const BASE = {
  id: 'aabbccdd11223344',
  token: 'ffee00112233445566778899aabbccdd',
  baseUrl: 'http://127.0.0.1:54321',
};

test('profile: output starts with <!doctype html>', () => {
  assert.ok(renderPage(BASE).startsWith('<!doctype html>'));
});

test('profile: __SESSION__ embeds id/token/baseUrl', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('window.__SESSION__'));
  assert.ok(html.includes(BASE.id));
  assert.ok(html.includes(BASE.token));
  assert.ok(html.includes('127.0.0.1:54321'));
});

test('profile: adversarial baseUrl is neutralized in script context', () => {
  const evil = { ...BASE, baseUrl: '</script><script>alert(1)</script>' };
  const html = renderPage(evil);
  const start = html.indexOf('window.__SESSION__');
  const end = html.indexOf('</script>', start);
  assert.ok(!html.slice(start, end).includes('</script>'));
});

test('profile: renders three tabs (Profile, Retailers, Feedback)', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes("label: 'Profile'"), 'missing Profile tab');
  assert.ok(html.includes("label: 'Retailers'"), 'missing Retailers tab');
  assert.ok(!html.includes("label: 'Feedback'"), 'Feedback tab must be gone (rot removed)');
});

test('profile: dispatches all expected action types', () => {
  const html = renderPage(BASE);
  for (const type of [
    'submit-profile',
    'submit-retailer-add',
    'submit-retailer-remove',
    'dismissed',
  ]) {
    assert.ok(html.includes(`'${type}'`), `missing action type: ${type}`);
  }
  assert.ok(!html.includes("'submit-feedback'"), 'submit-feedback must be gone (rot removed)');
});

test('profile: does not include palette field (anti-pattern)', () => {
  const html = renderPage(BASE);
  assert.ok(!html.includes("'Palette'"), 'palette section must not exist');
});

test('profile: handles state.initialTab (deprecated-alias deep link)', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('initialTab'), 'page must honor server-pushed initialTab');
});

// Regression guard — caught the v0.11.3 unescaped-apostrophe bug class.
test('profile: inline script body parses as valid JavaScript', () => {
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
