import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../server/render-setup.js';

const BASE = {
  id: 'aabbccdd11223344',
  token: 'ffee00112233445566778899aabbccdd',
  baseUrl: 'http://127.0.0.1:54321',
};

test('setup: output starts with <!doctype html>', () => {
  assert.ok(renderPage(BASE).startsWith('<!doctype html>'));
});

test('setup: __SESSION__ embeds id/token/baseUrl', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('window.__SESSION__'));
  assert.ok(html.includes(BASE.id));
  assert.ok(html.includes(BASE.token));
  assert.ok(html.includes('127.0.0.1:54321'));
});

test('setup: adversarial baseUrl is neutralized in script context', () => {
  const evil = { ...BASE, baseUrl: '</script><script>alert(1)</script>' };
  const html = renderPage(evil);
  const start = html.indexOf('window.__SESSION__');
  const end = html.indexOf('</script>', start);
  assert.ok(!html.slice(start, end).includes('</script>'));
});

test('setup: JS branches on form, saving, done stages', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes("stage === 'form'"));
  assert.ok(html.includes("stage === 'saving'"));
  assert.ok(html.includes("stage === 'done'"));
});

test('setup: page enumerates all expected sections', () => {
  const html = renderPage(BASE);
  // Sections are titles inserted at render time via section('Title', ...).
  for (const title of ['Sizes', 'Budget', 'Brands', 'Fit notes', 'Optional']) {
    assert.ok(html.includes(`'${title}'`), `expected section title literal: ${title}`);
  }
});

test('setup: budget tier options low/mid/high are wired', () => {
  const html = renderPage(BASE);
  // The radio rows are built from option tuples in JS.
  assert.ok(html.includes("'low', 'Low'"));
  assert.ok(html.includes("'mid', 'Mid'"));
  assert.ok(html.includes("'high', 'High'"));
});

test('setup: JS sends submit and dismissed actions', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes("type: 'submit'"));
  assert.ok(html.includes("type: 'dismissed'"));
});

test('setup: does not ask about palette (anti-pattern per cart-setup.md)', () => {
  const html = renderPage(BASE);
  // No palette section/title, no palette input fields.
  assert.ok(!html.includes("'Palette'"), 'palette section must not exist');
  assert.ok(!html.includes("'palette'"), 'palette field must not be referenced');
});

// Regression guard for the v0.11.3 inline-script parse class of bug.
test('setup: inline script body parses as valid JavaScript', () => {
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
