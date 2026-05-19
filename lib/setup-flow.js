// lib/setup-flow.js
// Pure orchestrator for the /cart-setup flow.
//
// Single-page form replacing the 6-section chat wizard:
//   1. readProfile → render form pre-populated
//   2. wait for submit or dismissed
//   3. on submit: merge submitted fields into profile, validate, write
//   4. tally what changed, push summary, shut down
//
// Deps: same shape as feedback-flow. All side effects injected.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fields this flow is responsible for. Anything else on the profile
// (palette, purchase_history, thumb_signals, last_setup) is preserved.
const SCALAR_FIELDS = ['budget_default', 'moodboard_url'];
const OBJECT_FIELDS = ['sizes', 'budget_caps', 'fit_notes'];
const ARRAY_FIELDS = ['brands_love', 'brands_avoid'];

/**
 * Merge a submitted form payload into an existing profile object.
 * Returns a new merged object — does not mutate the input.
 *
 * Submitted fields are normalized:
 *   - sizes / budget_caps / fit_notes: merge with existing object
 *     (missing keys preserved; empty-string values removed)
 *   - brands_love / brands_avoid: replace with submitted array
 *   - budget_default / moodboard_url: replace with submitted scalar
 *
 * Fields not present in submitted are left untouched on profile.
 */
export function mergeSubmittedProfile(profile, submitted) {
  const merged = { ...profile };

  for (const field of SCALAR_FIELDS) {
    if (submitted && Object.prototype.hasOwnProperty.call(submitted, field)) {
      merged[field] = submitted[field];
    }
  }

  for (const field of ARRAY_FIELDS) {
    if (submitted && Array.isArray(submitted[field])) {
      merged[field] = submitted[field].slice();
    }
  }

  for (const field of OBJECT_FIELDS) {
    if (submitted && submitted[field] && typeof submitted[field] === 'object') {
      const next = { ...(profile[field] || {}) };
      for (const [k, v] of Object.entries(submitted[field])) {
        // empty strings clear the key; everything else is set.
        if (v === '' || v == null) {
          delete next[k];
        } else {
          next[k] = v;
        }
      }
      merged[field] = next;
    }
  }

  return merged;
}

/**
 * Summarize what changed between two profile objects in a human-readable way.
 * Returns an array of short strings.
 */
export function diffProfiles(before, after) {
  const lines = [];
  for (const field of SCALAR_FIELDS) {
    if (before[field] !== after[field]) {
      lines.push(`${field}: ${fmt(before[field])} → ${fmt(after[field])}`);
    }
  }
  for (const field of ARRAY_FIELDS) {
    const a = Array.isArray(before[field]) ? before[field].join(', ') : '';
    const b = Array.isArray(after[field]) ? after[field].join(', ') : '';
    if (a !== b) lines.push(`${field}: [${b}]`);
  }
  for (const field of OBJECT_FIELDS) {
    const a = before[field] || {};
    const b = after[field] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const parts = [];
    for (const k of keys) {
      if (a[k] !== b[k]) parts.push(`${k}=${fmt(b[k])}`);
    }
    if (parts.length > 0) lines.push(`${field}: ${parts.join(', ')}`);
  }
  return lines;
}

function fmt(v) {
  if (v == null || v === '') return '–';
  return String(v);
}

/**
 * Run the cart-setup UI flow.
 *
 * Deps:
 *   readProfile()                   → Promise<Profile>
 *   writeProfile(profile)           → Promise<void>
 *   validateProfile(profile)        → {valid, errors}
 *   startServer({render})           → Promise<{createSession, shutdown}>
 *   render                          → renderPage function for the page
 *   openUrl(url)                    → Promise<void>
 *   now?()                          → 'YYYY-MM-DD' (for last_setup)
 *   log?(msg)                       → void
 *   sleep?(ms)                      → Promise<void>
 *
 * Returns one of:
 *   { outcome: 'dismissed' }
 *   { outcome: 'success', changes, profile }
 *   { outcome: 'flow_error', error }
 */
export async function runSetupFlow({
  deps: {
    readProfile,
    writeProfile,
    validateProfile,
    startServer,
    render,
    openUrl,
    now = () => new Date().toISOString().slice(0, 10),
    log,
    sleep = defaultSleep,
  },
}) {
  let server;
  try {
    const initialProfile = await readProfile();

    server = await startServer({ render });
    const session = server.createSession();
    await openUrl(session.url);

    let currentProfile = initialProfile;
    session.pushState({ stage: 'form', profile: currentProfile });

    // Allow re-submit on validation failure: loop until success or dismissed.
    while (true) {
      const action = await session.nextAction({ types: ['submit', 'dismissed'] });

      if (action.type === 'dismissed') {
        return { outcome: 'dismissed' };
      }

      const submitted = action.profile || {};
      const candidate = mergeSubmittedProfile(currentProfile, submitted);
      candidate.last_setup = now();

      const v = validateProfile(candidate);
      if (!v.valid) {
        if (log) log(`validation failed: ${v.errors.join('; ')}`);
        session.pushState({ stage: 'form', profile: candidate, errors: v.errors });
        continue;
      }

      session.pushState({ stage: 'saving', message: 'Saving profile…' });

      try {
        await writeProfile(candidate);
      } catch (err) {
        if (log) log(`write failed: ${err.message}`);
        session.pushState({
          stage: 'form',
          profile: candidate,
          errors: [`write failed: ${err.message}`],
        });
        continue;
      }

      const changes = diffProfiles(initialProfile, candidate);
      const summary = changes.length > 0
        ? `${changes.length} field${changes.length === 1 ? '' : 's'} updated`
        : 'No changes.';

      session.pushState({
        stage: 'done',
        message: 'Profile saved.',
        summary,
        changes,
      });

      await sleep(800);

      return { outcome: 'success', changes, profile: candidate };
    }
  } catch (err) {
    return { outcome: 'flow_error', error: err.message ?? String(err) };
  } finally {
    if (server) {
      try { await server.shutdown(); } catch { /* ignore */ }
    }
  }
}
