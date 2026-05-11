import test from 'node:test';
import assert from 'node:assert/strict';
import * as shopify from '../../lib/retailers/shopify.js';

test('shopify module loads', () => {
  assert.equal(typeof shopify, 'object');
});
