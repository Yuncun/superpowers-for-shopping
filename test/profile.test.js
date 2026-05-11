import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultProfile } from '../lib/profile.js';

test('getDefaultProfile returns expected schema', () => {
  const p = getDefaultProfile();
  assert.equal(typeof p, 'object');
  assert.ok(p.sizes);
  assert.equal(p.budget_default, 'mid');
  assert.ok(Array.isArray(p.palette));
  assert.ok(Array.isArray(p.brands_love));
  assert.ok(Array.isArray(p.brands_avoid));
  assert.equal(p.moodboard_url, '');
  assert.ok(p.purchase_history);
  assert.ok(p.thumb_signals);
  assert.equal(p.purchase_history.length, 0);
  assert.equal(p.thumb_signals.length, 0);
});
