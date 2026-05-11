import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartDir, profilePath, retailersPath, requestsDir } from '../lib/paths.js';

test('cartDir respects HOME env', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(cartDir(), '/tmp/fake-home/.claude/cart');
});

test('profilePath returns profile.md inside cartDir', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(profilePath(), '/tmp/fake-home/.claude/cart/profile.md');
});

test('retailersPath returns retailers.md inside cartDir', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(retailersPath(), '/tmp/fake-home/.claude/cart/retailers.md');
});

test('requestsDir returns requests/ inside cartDir', () => {
  process.env.HOME = '/tmp/fake-home';
  assert.equal(requestsDir(), '/tmp/fake-home/.claude/cart/requests');
});
