// lib/profile-flow.js
// Pure orchestrator for the unified /cart-profile UI.
//
// Long-lived session: stays open until the user dismisses or closes the tab.
// Dispatches on action type — every action mutates underlying storage and
// re-pushes a fresh full state so the UI can re-render the active tab.
//
// Action types:
//   submit-profile          → mergeSubmittedProfile + validate + writeProfile
//   submit-retailer-add     → addRetailer
//   submit-retailer-remove  → removeRetailer
//   submit-feedback         → updatePurchase per non-skip item
//   dismissed               → exit success

import { mergeSubmittedProfile } from './setup-flow.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACTION_TYPES = [
  'submit-profile',
  'submit-retailer-add',
  'submit-retailer-remove',
  'submit-feedback',
  'dismissed',
];

const VALID_INITIAL_TABS = new Set(['profile', 'retailers', 'feedback']);

/**
 * Load the full snapshot pushed to the UI.
 */
async function loadSnapshot({ readProfile, readRetailers, listPending }) {
  const [profile, retailersResult, pending] = await Promise.all([
    readProfile(),
    readRetailers(),
    listPending(),
  ]);
  return {
    profile,
    retailers: (retailersResult && retailersResult.retailers) || [],
    pending: pending || [],
  };
}

/**
 * Run the unified profile UI flow.
 *
 * Required deps:
 *   readProfile()                      → Promise<Profile>
 *   writeProfile(profile)              → Promise<void>
 *   validateProfile(profile)           → {valid, errors}
 *   readRetailers()                    → Promise<{last_updated, retailers}>
 *   addRetailer({host})                → Promise<{added, reason?}>
 *   removeRetailer(host)               → Promise<{removed, reason?}>
 *   listPending()                      → Promise<Array<purchase>>
 *   updatePurchase(key, upd)           → Promise<{updated, reason?}>
 *   startServer({render})              → Promise<{createSession, shutdown}>
 *   render                             → renderPage function
 *   openUrl(url)                       → Promise<void>
 *   initialTab?                        → 'profile' | 'retailers' | 'feedback'
 *   now?()                             → 'YYYY-MM-DD'
 *   log?(msg)                          → void
 *   sleep?(ms)                         → Promise<void>
 *
 * Returns:
 *   { outcome: 'success' | 'dismissed' | 'flow_error', error?, actionsApplied }
 */
export async function runProfileFlow({
  deps: {
    readProfile,
    writeProfile,
    validateProfile,
    readRetailers,
    addRetailer,
    removeRetailer,
    listPending,
    updatePurchase,
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
      snapshot = await loadSnapshot({ readProfile, readRetailers, listPending });
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
        pending: snapshot.pending,
      };
      if (initialTab && VALID_INITIAL_TABS.has(initialTab)) {
        payload.initialTab = initialTab;
      }
      if (banner) payload.banner = banner;
      session.pushState(payload);
    }

    pushSnapshot();

    // Main loop: dispatch actions until dismissed.
    while (true) {
      let action;
      try {
        action = await session.nextAction({ types: ACTION_TYPES });
      } catch (err) {
        // session_closed — treat as dismissed.
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
        } else if (action.type === 'submit-feedback') {
          await handleFeedback(action, snapshot, {
            updatePurchase, listPending, log, pushSnapshot,
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

// ---------- action handlers ----------

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
  snapshot.profile = await deps.readProfile(); // re-read for canonical shape
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

async function handleFeedback(action, snapshot, deps) {
  const items = Array.isArray(action.items) ? action.items : [];
  let kept = 0, returned = 0, skipped = 0, errors = 0;
  const errorDetails = [];

  for (const it of items) {
    const decision = it.decision === 'yes' || it.decision === 'no' ? it.decision : 'skip';
    if (decision === 'skip') { skipped++; continue; }
    try {
      const result = await deps.updatePurchase(
        { date: it.date, item: it.item, brand: it.brand },
        { kept: decision, notes: typeof it.notes === 'string' ? it.notes : '' },
      );
      if (result && result.updated) {
        if (decision === 'yes') kept++; else returned++;
      } else {
        errors++;
        errorDetails.push({ item: it.item, reason: (result && result.reason) || 'unknown' });
      }
    } catch (err) {
      errors++;
      errorDetails.push({ item: it.item, reason: err.code || err.message || 'unknown' });
    }
  }

  snapshot.pending = await deps.listPending();
  const parts = [];
  if (kept > 0) parts.push(`${kept} kept`);
  if (returned > 0) parts.push(`${returned} returned`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (errors > 0) parts.push(`${errors} failed`);
  deps.pushSnapshot({
    tab: 'feedback',
    kind: errors > 0 ? 'error' : 'success',
    text: parts.length > 0 ? `Saved — ${parts.join(' · ')}.` : 'Saved.',
  });
}

// ---------- helpers ----------

function tabForAction(type) {
  if (type === 'submit-profile') return 'profile';
  if (type === 'submit-retailer-add' || type === 'submit-retailer-remove') return 'retailers';
  if (type === 'submit-feedback') return 'feedback';
  return 'profile';
}

function describe(type) {
  if (type === 'submit-profile') return 'save profile';
  if (type === 'submit-retailer-add') return 'add retailer';
  if (type === 'submit-retailer-remove') return 'remove retailer';
  if (type === 'submit-feedback') return 'save feedback';
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
