// lib/flow.js
//
// Pure orchestrator for /cart "Threat Mode" — no thumbs, no candidate picking,
// no auth retry. Every external call goes through deps. Never process.exit,
// never throw on runtime conditions, always shutdown.
//
// Flow:
//   1. Read profile + retailers.
//   2. Push 'searching' state with all retailers pending.
//   3. Search retailers in parallel; push updated 'searching' as each resolves.
//   4. Rank + filter via profile; diversify (max-per-retailer); pick top N.
//   5. Group picks by host; build per-host Shopify cart permalinks.
//   6. Push 'done' state with picks + permalinks; await user click.
//   7. On review: open each permalink in the user's browser, append history rows,
//      passively merge product colors into profile.palette, return success.

import { applyRanking as defaultApplyRanking } from './ranking.js';
import { buildCartPermalink as defaultBuildPermalink } from './retailers/shopify.js';
import {
  extractColorsFromProduct as defaultExtractColors,
  mergePaletteCandidates as defaultMergePalette,
} from './palette-extractor.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGET_PICKS = 5;
const MIN_CAP_PER_RETAILER = 2;

/**
 * Reduce a free-form descriptive query to the head noun phrase that Shopify
 * suggest is most likely to match. Shopify's `/search/suggest.json` performs
 * substring matching against product titles, so verbose queries like
 *   "A sweater - light, kind of baggy, modern"
 * return zero hits because no product title contains all those words. We:
 *   - cut at the first descriptive separator (`-`, `—`, `,`, parenthetical)
 *   - strip a leading article (a / an / the / some / any)
 *   - trim whitespace
 *
 * Returns the simplified query; never returns null/undefined.
 */
export function simplifyQuery(raw) {
  let q = String(raw ?? '').trim();
  if (!q) return q;
  const cutAt = q.search(/\s+[-—]\s+|,|\s+\(/);
  if (cutAt > 0) q = q.slice(0, cutAt);
  q = q.replace(/^(a|an|the|some|any)\s+/i, '');
  return q.trim();
}

/**
 * Round-robin interleave with dynamic per-retailer cap and refill.
 *
 * Phase 1: take up to `cap` from each list, round-robin, to maximize variety.
 * Phase 2: if still short of `n`, keep round-robining over the remaining items
 *          (cap relaxed) so we hit `n` whenever there's enough supply.
 *
 * Stable on ties (preserves order within each retailer's list).
 */
export function diversify(byHost, cap, n) {
  const queues = Array.from(byHost.entries())
    .filter(([, items]) => items.length > 0)
    .map(([host, items]) => ({ host, capped: items.slice(0, cap), rest: items.slice(cap) }));

  const out = [];

  // Phase 1: respect the cap.
  let progress = true;
  while (out.length < n && progress) {
    progress = false;
    for (const q of queues) {
      if (out.length >= n) break;
      const next = q.capped.shift();
      if (next) { out.push(next); progress = true; }
    }
  }

  // Phase 2: relax the cap to reach n.
  progress = true;
  while (out.length < n && progress) {
    progress = false;
    for (const q of queues) {
      if (out.length >= n) break;
      const next = q.rest.shift();
      if (next) { out.push(next); progress = true; }
    }
  }

  return out;
}

/**
 * Dynamic cap: with few retailers returning results, allow more per retailer
 * so we still hit the target. With many retailers, default to MIN_CAP to keep
 * picks diverse.
 */
function computeCap(numRetailersWithResults, target) {
  if (numRetailersWithResults <= 0) return MIN_CAP_PER_RETAILER;
  return Math.max(MIN_CAP_PER_RETAILER, Math.ceil(target / numRetailersWithResults));
}

export async function runCartFlow({
  query,
  retailers,
  deps: {
    readProfile,
    readRetailers,
    search,
    startServer,
    openUrl,
    log,
    sleep = defaultSleep,
    appendPurchase = null,
    extractColors = defaultExtractColors,
    mergePalette = defaultMergePalette,
    updateProfile = null,
    now = () => new Date().toISOString().slice(0, 10),
    applyRanking = defaultApplyRanking,
    buildPermalink = defaultBuildPermalink,
  },
}) {
  const profile = await readProfile();
  // The user sees `query` (their original wording) in the UI; retailers see
  // `searchQuery` (the simplified noun phrase).
  const searchQuery = simplifyQuery(query) || String(query ?? '').trim();

  // Resolve retailer list: explicit arg wins; otherwise read from store.
  let resolvedRetailers = retailers;
  if (resolvedRetailers === undefined || resolvedRetailers === null) {
    const stored = await readRetailers();
    resolvedRetailers = stored.retailers.map((r) => r.host);
  }

  if (!resolvedRetailers || resolvedRetailers.length === 0) {
    return { outcome: 'no_retailers' };
  }

  let server;
  try {
    server = await startServer();
    const session = server.createSession();
    openUrl(session.url);

    // Per-retailer progress tracking.
    const progress = resolvedRetailers.map((host) => ({ host, status: 'pending' }));
    session.pushState({ stage: 'searching', query, retailers: progress });

    // Kick off searches in parallel; update progress as each resolves.
    const settled = await Promise.all(
      resolvedRetailers.map(async (host, i) => {
        try {
          const results = await search(host, searchQuery);
          progress[i] = { host, status: 'done', count: results.length };
          session.pushState({ stage: 'searching', query, retailers: progress.slice() });
          return results;
        } catch (err) {
          if (log) log(`search failed for ${host}: ${err?.message ?? err}`);
          progress[i] = { host, status: 'error' };
          session.pushState({ stage: 'searching', query, retailers: progress.slice() });
          return [];
        }
      }),
    );

    // Group + rank per retailer (so per-host caps respect profile ranking).
    // Dedup keys:
    //   - url             (different listings for same item)
    //   - brand + title   (same product listed under multiple slugs)
    //   - brand + base    (color variants — "Boxy Sweater | Navy" vs
    //                      "Boxy Sweater | Skywriting" share the base title)
    const byHost = new Map();
    for (let i = 0; i < resolvedRetailers.length; i++) {
      const host = resolvedRetailers[i];
      const ranked = applyRanking(settled[i], profile);
      const seenUrl = new Set();
      const seenTitleBase = new Set();
      const deduped = [];
      for (const c of ranked) {
        if (!c.url || seenUrl.has(c.url)) continue;
        if (!Array.isArray(c.variants) || c.variants.length === 0) continue;
        const baseKey = makeTitleKey(c.brand, c.title);
        if (baseKey && seenTitleBase.has(baseKey)) continue;
        seenUrl.add(c.url);
        if (baseKey) seenTitleBase.add(baseKey);
        deduped.push({ ...c, host });
      }
      if (deduped.length > 0) byHost.set(host, deduped);
    }

    const cap = computeCap(byHost.size, TARGET_PICKS);
    const picks = diversify(byHost, cap, TARGET_PICKS);

    if (picks.length === 0) {
      session.pushState({ stage: 'empty', query });
      await session.nextAction({ types: ['dismissed'] }).catch(() => {});
      return { outcome: 'no_results' };
    }

    // Group picks by host and build one permalink per host (all that host's variants).
    const cartsByHost = new Map();
    for (const p of picks) {
      const arr = cartsByHost.get(p.host) || [];
      arr.push(p);
      cartsByHost.set(p.host, arr);
    }
    const carts = [];
    for (const [host, hostPicks] of cartsByHost) {
      const variants = hostPicks.map((p) => ({ variant_id: p.variants[0].variant_id }));
      carts.push({ host, url: buildPermalink(host, variants), count: hostPicks.length });
    }

    session.pushState({
      stage: 'done',
      query,
      picks: picks.map(serializePick),
      carts,
    });

    const action = await session.nextAction({
      types: ['review', 'dismissed'],
    });

    if (action.type === 'dismissed') {
      return { outcome: 'dismissed' };
    }

    // review: open each cart permalink and record the picks.
    for (const c of carts) {
      try { await openUrl(c.url); }
      catch (err) { if (log) log(`openUrl failed for ${c.host}: ${err?.message ?? err}`); }
    }

    if (appendPurchase) {
      for (const p of picks) {
        await appendPurchase({
          date: now(),
          item: p.title ?? '',
          brand: p.brand ?? '',
          '$': p.price ?? '',
          url: p.url ?? '',
        });
      }
    }

    if (updateProfile) {
      let palette = profile.palette || [];
      for (const p of picks) {
        const tokens = extractColors(p);
        if (tokens.length > 0) palette = mergePalette(palette, tokens);
      }
      if (palette.length > (profile.palette || []).length) {
        await updateProfile({ palette });
      }
    }

    session.pushState({ stage: 'review_opened', carts });
    await sleep(1500);
    return { outcome: 'reviewed', carts, picks };
  } catch (err) {
    if (err?.message === 'session_closed') return { outcome: 'dismissed' };
    throw err;
  } finally {
    if (server) await server.shutdown();
  }
}

/**
 * Build a dedup key that collapses color/variant suffixes commonly appended
 * to Shopify product titles. Examples that should share a key:
 *   "Boxy Sweater in Everyday Cotton | Navy"
 *   "Boxy Sweater in Everyday Cotton | Skywriting"
 * Both reduce to "boxy sweater in everyday cotton".
 *
 * Returns '' (falsy) if neither brand nor title is usable.
 */
export function makeTitleKey(brand, title) {
  const t = String(title ?? '').trim();
  if (!t) return '';
  const base = t.split('|')[0].trim().toLowerCase();
  return `${String(brand ?? '').toLowerCase()}|${base}`;
}

function serializePick(p) {
  return {
    title: p.title ?? null,
    brand: p.brand ?? null,
    price: p.price ?? null,
    image: p.image ?? null,
    url: p.url ?? null,
    host: p.host,
  };
}
