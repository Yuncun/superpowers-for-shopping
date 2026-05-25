import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../server/render.js';

const BASE = { id: 'abc', token: 'xyz', baseUrl: 'http://127.0.0.1:1234' };

test('render: returns a complete HTML document', () => {
  const html = renderPage(BASE);
  assert.ok(html.startsWith('<!doctype html>'), 'must start with doctype');
  assert.ok(html.includes('</html>'), 'must close html tag');
});

test('render: embeds session info safely', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('"id":"abc"'));
  assert.ok(html.includes('"token":"xyz"'));
});

test('render: escapes < inside embedded JSON to prevent script-context escape', () => {
  const html = renderPage({ id: 'a', token: 'b', baseUrl: 'http://x</script><script>alert(1)</script>' });
  // Raw </script> must not appear within the embedded session JSON.
  // The renderer's own <script> tag is fine; just count opens/closes — the
  // attack would inject an additional pair via the baseUrl.
  const closes = (html.match(/<\/script>/g) || []).length;
  assert.equal(closes, 1, 'only the legitimate </script> may appear');
});

test('render: branches on all expected stages', () => {
  const html = renderPage(BASE);
  for (const stage of ['searching', 'done', 'empty', 'review_opened']) {
    assert.ok(html.includes(`'${stage}'`), `missing branch for stage: ${stage}`);
  }
});

test('render: action types are exactly review + dismissed', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes("type: 'review'"), "missing review action");
  assert.ok(html.includes("type: 'dismissed'"), 'missing dismissed action');
  // Old action types must be gone.
  for (const old of ['thumb', 'thumbs_complete', 'final_accept', 'final_cancel', 'login_complete', 'see_alternatives']) {
    assert.ok(!html.includes(`type: '${old}'`), `obsolete action ${old} still present`);
  }
});

test('render: no thumbs-grid CSS lingering', () => {
  const html = renderPage(BASE);
  assert.ok(!html.includes('.card.voted'), 'voted-card style must be gone');
  assert.ok(!html.includes("vote-up"), 'vote-up style must be gone');
});

test('render: has the Review CTA button', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('btn-review'), 'review button must be present');
});

test('render: includes per-host status row markup', () => {
  const html = renderPage(BASE);
  assert.ok(html.includes('search-row'), 'search-row class must exist for progress UI');
});
