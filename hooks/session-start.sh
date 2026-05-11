#!/bin/bash
# Surface a feedback nudge for old pending purchases.
MSG=$(node "${CLAUDE_PLUGIN_ROOT}/bin/cart-pending-check.js" 2>/dev/null)
if [ -n "$MSG" ]; then
  jq -nc --arg msg "$MSG" '{systemMessage: $msg}'
fi
exit 0
