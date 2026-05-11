#!/usr/bin/env node
// Live smoke test against marinelayer.com. Run manually:
//   npm run smoke:live
// Not part of `npm test`. Network-dependent; flaky by design.

import assert from 'node:assert/strict';
import { detect, search, fetchVariants } from '../lib/retailers/shopify.js';

const HOST = 'marinelayer.com';

async function main() {
  console.log(`\n=== detect(${HOST}) ===`);
  const isShopify = await detect(HOST);
  console.log('  result:', isShopify);
  assert.equal(isShopify, true, 'expected marinelayer.com to be detected as Shopify');

  console.log(`\n=== search(${HOST}, 'sweater', limit=5) ===`);
  const results = await search(HOST, 'sweater', { limit: 5 });
  console.log(`  ${results.length} products returned`);
  if (results.length > 0) {
    const first = results[0];
    console.log('  first product:', {
      url: first.url,
      brand: first.brand,
      title: first.title,
      price: first.price,
      image: first.image ? `${first.image.slice(0, 60)}…` : null,
      variant_count: first.variants.length,
    });
    assert.ok(Array.isArray(results), 'results must be array');
    assert.ok(first.url.startsWith('https://marinelayer.com/products/'), `bad url: ${first.url}`);
    assert.ok(first.brand, 'expected brand');
    assert.ok(first.title, 'expected title');
    assert.ok(Array.isArray(first.variants), 'expected variants array');
  } else {
    console.log('  WARNING: no results for "sweater" — Shopify ?q= may not work on this store.');
    console.log('  Check whether /products.json?q= is a real search endpoint here.');
  }

  if (results.length > 0) {
    console.log(`\n=== fetchVariants(${results[0].url}) ===`);
    const variants = await fetchVariants(results[0].url);
    console.log(`  ${variants.length} variants returned`);
    if (variants[0]) console.log('  first variant:', variants[0]);
    assert.ok(Array.isArray(variants), 'variants must be array');
  }

  console.log('\nLive smoke OK.');
}

main().catch((err) => {
  console.error('Live smoke FAILED:', err.message);
  if (err.code) console.error('  code:', err.code);
  if (err.status) console.error('  status:', err.status);
  process.exit(1);
});
