// lib/flow.js
// Pure orchestrator for the /cart flow. Every external call goes through deps.
// Never process.exit. Never throw on runtime conditions. Always shutdown.

import { applyRanking as defaultApplyRanking } from './ranking.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runCartFlow({
  query,
  retailers,
  deps: {
    readProfile,
    readRetailers,
    search,
    getCookieHeader,
    addToCart,
    startServer,
    openUrl,
    openLoginPage,
    log,
    sleep = defaultSleep,
    appendPurchase = null,
    now = () => new Date().toISOString().slice(0, 10),
    applyRanking = defaultApplyRanking,
  },
}) {
  const profile = await readProfile();

  // Resolve retailer list: explicit arg wins; otherwise read from store.
  let resolvedRetailers = retailers;
  if (resolvedRetailers === undefined || resolvedRetailers === null) {
    const stored = await readRetailers();
    resolvedRetailers = stored.retailers.map((r) => r.host);
  }

  if (!resolvedRetailers || resolvedRetailers.length === 0) {
    return { outcome: 'no_results' };
  }

  const settled = await Promise.allSettled(resolvedRetailers.map((h) => search(h, query)));
  const resultSets = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      resultSets.push(s.value);
    } else if (log) {
      log(`search failed for ${resolvedRetailers[i]}: ${s.reason?.message ?? s.reason}`);
    }
  }
  const seen = new Set();
  const deduped = [];
  for (const c of resultSets.flat()) {
    if (c.url && !seen.has(c.url)) {
      seen.add(c.url);
      deduped.push(c);
    }
  }

  const ranked = applyRanking(deduped, profile);
  const candidates = ranked.slice(0, 8);

  if (candidates.length === 0) {
    return { outcome: 'no_results' };
  }

  let server;
  try {
    server = await startServer();
    const session = server.createSession();
    openUrl(session.url);

    session.pushState({ stage: 'loading', message: 'Loading candidates...' });
    session.pushState({ stage: 'thumbs', candidates });

    // Collect thumb actions.
    const tally = {};
    let thumbsAction;
    while (true) {
      const a = await session.nextAction({ types: ['thumb', 'thumbs_complete', 'dismissed'] });
      if (a.type === 'thumb' && a.direction === 'up') {
        tally[a.index] = (tally[a.index] || 0) + 1;
      } else {
        thumbsAction = a;
        break;
      }
    }

    if (thumbsAction.type === 'dismissed') {
      return { outcome: 'dismissed' };
    }

    // Pick top candidate: most ups; ties by listing order; zero ups → index 0.
    let topIndex = 0;
    let topCount = 0;
    for (let i = 0; i < candidates.length; i++) {
      const count = tally[i] || 0;
      if (count > topCount) {
        topCount = count;
        topIndex = i;
      }
    }
    const top = candidates[topIndex];
    const host = new URL(top.url).hostname;

    session.pushState({ stage: 'final', product: top, alternativesCount: candidates.length - 1 });

    const finalAction = await session.nextAction({
      types: ['final_accept', 'final_cancel', 'dismissed'],
    });

    if (finalAction.type === 'final_cancel') {
      return { outcome: 'canceled' };
    }
    if (finalAction.type === 'dismissed') {
      return { outcome: 'dismissed' };
    }

    // final_accept
    if (!top.variants || top.variants.length === 0) {
      session.pushState({ stage: 'done', message: 'This product has no variants.' });
      return { outcome: 'cart_error', host, error: 'no_variants' };
    }

    let cookie = null;
    let result = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      cookie = await getCookieHeader(host);
      if (cookie) {
        result = await addToCart({ host, variantId: top.variants[0].variant_id, cookie });
        if (result.ok) break;
        if (result.error !== 'authentication_required') {
          session.pushState({ stage: 'done', message: `Couldn't add to cart: ${result.error}` });
          return { outcome: 'cart_error', host, error: result.error };
        }
      }
      // Need login (either cookie missing or auth_required from addToCart)
      if (attempt === 2) {
        session.pushState({ stage: 'done', message: `Couldn't authenticate to ${host}. Try /cart-retailers login ${host}.` });
        return { outcome: 'auth_required', host };
      }
      const message = cookie === null ? 'No active session' : 'Session expired';
      session.pushState({ stage: 'login_required', host, message });
      openLoginPage(host).catch(() => {}); // fire-and-forget
      const loginAction = await session.nextAction({ types: ['login_complete', 'dismissed'] });
      if (loginAction.type === 'dismissed') {
        return { outcome: 'dismissed' };
      }
    }

    // Success path (result.ok is true)
    if (appendPurchase) {
      await appendPurchase({
        date: now(),
        item: top.title,
        brand: top.brand,
        '$': top.price,
        kept: '?',
        notes: '',
      });
    }
    const cartUrl = `https://${host}/cart`;
    session.pushState({ stage: 'redirect', url: cartUrl });
    await sleep(2000);
    return { outcome: 'success', product: top, cartUrl };
  } finally {
    if (server) await server.shutdown();
  }
}
