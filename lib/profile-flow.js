// lib/profile-flow.js
// Pure orchestrator for the /cart-profile UI (Profile + Retailers tabs).
//
// Long-lived session: stays open until the user dismisses or closes the tab.
// Dispatches on action type — every action mutates underlying storage and
// re-pushes a fresh full state so the UI can re-render the active tab.
//
// Action types:
//   submit-profile          → mergeSubmittedProfile + validate + writeProfile
//   submit-retailer-add     → addRetailer
//   submit-retailer-remove  → removeRetailer
//   dismissed               → exit success

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACTION_TYPES = [
  'submit-profile',
  'submit-retailer-add',
  'submit-retailer-remove',
  'dismissed',
];

const VALID_INITIAL_TABS = new Set(['profile', 'retailers']);

const SCALAR_FIELDS = ['budget_default', 'moodboard_url', 'shopping_for'];
const OBJECT_FIELDS = ['sizes', 'budget_caps', 'fit_notes'];
const ARRAY_FIELDS = ['brands_love', 'brands_avoid'];

/**
 * Merge a submitted form payload into an existing profile object.
 * Returns a new merged object — does not mutate the input.
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

async function loadSnapshot({ readProfile, readRetailers }) {
  const [profile, retailersResult] = await Promise.all([
    readProfile(),
    readRetailers(),
  ]);
  return {
    profile,
    retailers: (retailersResult && retailersResult.retailers) || [],
  };
}

export async function runProfileFlow({
  deps: {
    readProfile,
    writeProfile,
    validateProfile,
    readRetailers,
    addRetailer,
    removeRetailer,
    startServer,
    render,
    openUrl,
    initialTab,
    now = () => new Date().toISOString().slice(0, 10),
    log,
    sleep = defaultSleep,
  },
}) {
  let server;
  let actionsApplied = 0;

  try {
    let snapshot;
    try {
      snapshot = await loadSnapshot({ readProfile, readRetailers });
    } catch (err) {
      return { outcome: 'flow_error', error: `load_failed: ${err.message}`, actionsApplied };
    }

    server = await startServer({ render });
    const session = server.createSession();
    await openUrl(session.url);

    function pushSnapshot(banner) {
      const payload = {
        stage: 'main',
        profile: snapshot.profile,
        retailers: snapshot.retailers,
      };
      if (initialTab && VALID_INITIAL_TABS.has(initialTab)) {
        payload.initialTab = initialTab;
      }
      if (banner) payload.banner = banner;
      session.pushState(payload);
    }

    pushSnapshot();

    while (true) {
      let action;
      try {
        action = await session.nextAction({ types: ACTION_TYPES });
      } catch {
        return { outcome: 'dismissed', actionsApplied };
      }

      if (action.type === 'dismissed') {
        return { outcome: 'success', actionsApplied };
      }

      try {
        if (action.type === 'submit-profile') {
          await handleSubmitProfile(action, snapshot, {
            writeProfile, validateProfile, now, log, pushSnapshot, readProfile,
          });
          actionsApplied++;
        } else if (action.type === 'submit-retailer-add') {
          await handleRetailerAdd(action, snapshot, {
            addRetailer, readRetailers, log, pushSnapshot,
          });
          actionsApplied++;
        } else if (action.type === 'submit-retailer-remove') {
          await handleRetailerRemove(action, snapshot, {
            removeRetailer, readRetailers, log, pushSnapshot,
          });
          actionsApplied++;
        }
      } catch (err) {
        if (log) log(`action handler error (${action.type}): ${err.message}`);
        pushSnapshot({
          tab: tabForAction(action.type),
          kind: 'error',
          text: `Couldn't ${describe(action.type)}: ${err.message}`,
        });
      }
    }
  } catch (err) {
    return { outcome: 'flow_error', error: err.message ?? String(err), actionsApplied };
  } finally {
    if (server) {
      try { await server.shutdown(); } catch { /* ignore */ }
    }
  }
}

async function handleSubmitProfile(action, snapshot, deps) {
  const submitted = action.profile || {};
  const candidate = mergeSubmittedProfile(snapshot.profile, submitted);
  candidate.last_setup = deps.now();

  const v = deps.validateProfile(candidate);
  if (!v.valid) {
    if (deps.log) deps.log(`profile validation failed: ${v.errors.join('; ')}`);
    deps.pushSnapshot({ tab: 'profile', kind: 'error', text: v.errors.join('; ') });
    return;
  }

  await deps.writeProfile(candidate);
  snapshot.profile = await deps.readProfile();
  deps.pushSnapshot({ tab: 'profile', kind: 'success', text: 'Profile saved.' });
}

async function handleRetailerAdd(action, snapshot, deps) {
  const host = (action.host || '').trim();
  if (!host) {
    deps.pushSnapshot({ tab: 'retailers', kind: 'error', text: 'Host is required.' });
    return;
  }

  let result;
  try {
    result = await deps.addRetailer({ host });
  } catch (err) {
    deps.pushSnapshot({ tab: 'retailers', kind: 'error', text: friendlyRetailerError('add', err.message) });
    return;
  }

  if (!result.added) {
    deps.pushSnapshot({ tab: 'retailers', kind: 'error', text: friendlyRetailerError('add', result.reason, host) });
    return;
  }

  const fresh = await deps.readRetailers();
  snapshot.retailers = fresh.retailers || [];
  deps.pushSnapshot({ tab: 'retailers', kind: 'success', text: `Added ${host}.` });
}

async function handleRetailerRemove(action, snapshot, deps) {
  const host = (action.host || '').trim();
  if (!host) {
    deps.pushSnapshot({ tab: 'retailers', kind: 'error', text: 'Host is required.' });
    return;
  }

  let result;
  try {
    result = await deps.removeRetailer(host);
  } catch (err) {
    deps.pushSnapshot({ tab: 'retailers', kind: 'error', text: friendlyRetailerError('remove', err.message) });
    return;
  }

  if (!result.removed) {
    deps.pushSnapshot({ tab: 'retailers', kind: 'error', text: friendlyRetailerError('remove', result.reason, host) });
    return;
  }

  const fresh = await deps.readRetailers();
  snapshot.retailers = fresh.retailers || [];
  deps.pushSnapshot({ tab: 'retailers', kind: 'success', text: `Removed ${host}.` });
}

function tabForAction(type) {
  if (type === 'submit-profile') return 'profile';
  if (type === 'submit-retailer-add' || type === 'submit-retailer-remove') return 'retailers';
  return 'profile';
}

function describe(type) {
  if (type === 'submit-profile') return 'save profile';
  if (type === 'submit-retailer-add') return 'add retailer';
  if (type === 'submit-retailer-remove') return 'remove retailer';
  return 'apply action';
}

function friendlyRetailerError(op, reason, host) {
  const tag = host ? ` (${host})` : '';
  switch (reason) {
    case 'duplicate': return `Already in your list${tag}.`;
    case 'not_found': return `Not in your list${tag}.`;
    case 'not_shopify': return `Not a Shopify-detected store${tag}.`;
    case 'tier1_not_supported': return `Tier-1 retailers are not supported yet${tag}.`;
    case 'invalid_host': return `Invalid host${tag} — use a bare domain like marinelayer.com.`;
    default: return `Couldn't ${op} retailer${tag}: ${reason || 'unknown'}.`;
  }
}
