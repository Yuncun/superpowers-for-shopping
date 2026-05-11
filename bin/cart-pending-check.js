#!/usr/bin/env node
// bin/cart-pending-check.js
// Called by hooks/session-start.sh. Prints a nudge when purchases are 7+ days
// old and still pending (kept === '?'). Exits 0 always; swallows all errors.

import { listPendingPurchases } from '../lib/profile.js';

async function main() {
  const pending = await listPendingPurchases();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const old = pending.filter(r => r.date <= cutoffStr);

  if (old.length === 0) return;

  if (old.length === 1) {
    process.stdout.write(
      `Quick: did you keep the ${old[0].item} from ${old[0].date}? Run /cart-feedback to log it.\n`,
    );
  } else {
    process.stdout.write(
      `Quick: you have ${old.length} pending purchases to confirm. Run /cart-feedback to log them.\n`,
    );
  }
}

main().catch(() => {});
