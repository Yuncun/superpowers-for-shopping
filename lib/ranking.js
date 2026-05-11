// lib/ranking.js
// Pure ranking/filtering module. No I/O. Synchronous.

/**
 * Parse a price string into a float. Returns null if price is null/undefined
 * or if the stripped string is not a valid number.
 * @param {string|null|undefined} p
 * @returns {number|null}
 */
function parsePrice(p) {
  if (p == null) return null;
  const stripped = String(p).replace(/[^\d.]/g, '');
  const n = parseFloat(stripped);
  return isNaN(n) ? null : n;
}

/**
 * Apply ranking heuristics to a list of candidates given a user profile.
 *
 * Steps (in order):
 * 1. Drop candidates whose brand (case-insensitive) is a substring match for
 *    any entry in profile.brands_avoid.
 * 2. Drop candidates where parsePrice(candidate.price) > budget_caps.clothes,
 *    unless budget_caps.clothes is absent or the price is null/unparseable.
 * 3. Stable partition: loved-brand candidates first, then the rest.
 *    Preserve original order within each group.
 *
 * @param {Array<{brand: string, price: string|null, title: string, url: string}>} candidates
 * @param {object} profile
 * @returns {Array}
 */
export function applyRanking(candidates, profile) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('candidates must be an array');
  }
  if (typeof profile !== 'object' || profile === null) {
    throw new TypeError('profile must be an object');
  }

  // Coerce missing/null fields.
  const brandsAvoid = Array.isArray(profile.brands_avoid) ? profile.brands_avoid : [];
  const brandsLove = Array.isArray(profile.brands_love) ? profile.brands_love : [];
  const budgetCaps = (profile.budget_caps && typeof profile.budget_caps === 'object' && !Array.isArray(profile.budget_caps))
    ? profile.budget_caps
    : {};

  // Lower-case once.
  const avoidLower = brandsAvoid.map((b) => String(b).toLowerCase());
  const loveLower = brandsLove.map((b) => String(b).toLowerCase());

  // Step 1: filter banned brands.
  let filtered = candidates.filter((c) => {
    if (!avoidLower.length) return true;
    const brandLower = String(c.brand).toLowerCase();
    return !avoidLower.some((banned) => brandLower.includes(banned));
  });

  // Step 2: filter over-budget candidates (keep null price).
  const clothesCap = typeof budgetCaps.clothes === 'number' && budgetCaps.clothes > 0
    ? budgetCaps.clothes
    : null;
  if (clothesCap !== null) {
    filtered = filtered.filter((c) => {
      const price = parsePrice(c.price);
      if (price === null) return true; // missing price → keep
      return price <= clothesCap;
    });
  }

  // Step 3: stable partition — loved brands first.
  if (!loveLower.length) return filtered;

  const loved = [];
  const rest = [];
  for (const c of filtered) {
    const brandLower = String(c.brand).toLowerCase();
    if (loveLower.some((fav) => brandLower.includes(fav))) {
      loved.push(c);
    } else {
      rest.push(c);
    }
  }
  return [...loved, ...rest];
}
