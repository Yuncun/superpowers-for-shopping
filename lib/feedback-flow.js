// lib/feedback-flow.js
// Pure orchestrator for the /cart-feedback flow. Every external call goes
// through deps. Never process.exit. Never throw on runtime conditions.
// Always shutdown.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the cart-feedback UI flow.
 *
 * Deps:
 *   listPending()           → Promise<Array<{date,item,brand,$,kept,notes}>>
 *   updatePurchase(key,upd) → Promise<{updated:boolean, reason?:string}>
 *                             (may also throw — caller treats throw as error)
 *   startServer({render})   → Promise<{createSession, shutdown}>
 *   render                  → renderPage function passed to startServer
 *   openUrl(url)            → Promise<void>
 *   log?(msg)               → void (best-effort)
 *   sleep?(ms)              → Promise<void>
 *
 * Returns one of:
 *   { outcome: 'empty' }
 *   { outcome: 'dismissed' }
 *   { outcome: 'success', kept, returned, skipped, errors, errorDetails }
 *   { outcome: 'flow_error', error: string }
 */
export async function runFeedbackFlow({
  deps: {
    listPending,
    updatePurchase,
    startServer,
    render,
    openUrl,
    log,
    sleep = defaultSleep,
  },
}) {
  let pending;
  try {
    pending = await listPending();
  } catch (err) {
    return { outcome: 'flow_error', error: `list_pending_failed: ${err.message}` };
  }

  if (!pending || pending.length === 0) {
    return { outcome: 'empty' };
  }

  let server;
  try {
    server = await startServer({ render });
    const session = server.createSession();
    await openUrl(session.url);

    session.pushState({ stage: 'form', pending });

    const action = await session.nextAction({ types: ['submit', 'dismissed'] });

    if (action.type === 'dismissed') {
      return { outcome: 'dismissed' };
    }

    session.pushState({ stage: 'saving', message: 'Saving feedback…' });

    const items = Array.isArray(action.items) ? action.items : [];

    let kept = 0;
    let returned = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails = [];

    for (const it of items) {
      const decision = it.decision === 'yes' || it.decision === 'no' ? it.decision : 'skip';

      if (decision === 'skip') {
        skipped++;
        continue;
      }

      try {
        const result = await updatePurchase(
          { date: it.date, item: it.item, brand: it.brand },
          { kept: decision, notes: typeof it.notes === 'string' ? it.notes : '' },
        );

        if (result && result.updated) {
          if (decision === 'yes') kept++;
          else returned++;
        } else {
          errors++;
          const reason = (result && result.reason) || 'unknown';
          errorDetails.push({ item: it.item, reason });
          if (log) log(`update failed for "${it.item}" (${it.brand}): ${reason}`);
        }
      } catch (err) {
        errors++;
        const reason = err.code || err.message || 'unknown';
        errorDetails.push({ item: it.item, reason });
        if (log) log(`update threw for "${it.item}" (${it.brand}): ${reason}`);
      }
    }

    session.pushState({
      stage: 'done',
      message: errors > 0 ? 'Saved with some issues.' : 'All set — feedback saved.',
      kept,
      returned,
      skipped,
      errors,
    });

    // Give the browser a beat to render the 'done' state before we tear the
    // SSE connection down. The 'closed' event would also end the page, but a
    // short pause makes the summary actually visible.
    await sleep(800);

    return {
      outcome: 'success',
      kept,
      returned,
      skipped,
      errors,
      errorDetails,
    };
  } catch (err) {
    return { outcome: 'flow_error', error: err.message ?? String(err) };
  } finally {
    if (server) {
      try { await server.shutdown(); } catch { /* ignore */ }
    }
  }
}
