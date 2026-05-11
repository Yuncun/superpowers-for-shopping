// lib/flow.js
// Pure orchestrator for the /cart flow. Every external call goes through deps.
// Never process.exit. Never throw on runtime conditions. Always shutdown.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runCartFlow({
  query,
  retailers,
  deps: {
    readProfile,
    search,
    getCookieHeader,
    addToCart,
    startServer,
    openUrl,
    log,
    sleep = defaultSleep,
  },
}) {
  await readProfile();

  const resultSets = await Promise.all(retailers.map((h) => search(h, query)));
  const candidates = resultSets.flat().slice(0, 8);

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

    // final_accept — happy path
    const cookie = await getCookieHeader(host);
    const result = await addToCart({ host, variantId: top.variants[0].variant_id, cookie });
    const cartUrl = `https://${host}/cart`;
    session.pushState({ stage: 'redirect', url: cartUrl });
    await sleep(2000);
    return { outcome: 'success', product: top, cartUrl };
  } finally {
    if (server) await server.shutdown();
  }
}
