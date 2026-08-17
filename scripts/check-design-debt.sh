#!/usr/bin/env bash
# Design-debt regression gate (plan-refonte-ui-90j.md §2.6).
#
# Counts distinct hardcoded hex colors in client/src CSS (excluding
# styles/tokens.css, the one file allowed to define raw color values)
# and fails the build if the count exceeds the budget for the current
# phase. The budget is REGRESSIVE — it must never go up — not an
# absolute "zero violations" bar. Phase 1 does not require migrating
# the legacy 259; it requires that nobody adds a 260th.
#
# Usage:
#   scripts/check-design-debt.sh                # uses default budget
#   BUDGET=120 scripts/check-design-debt.sh      # override (e.g. J30 milestone)
#
# Milestones from the plan (§2.6 / §7):
#   J0  <= 259   (baseline, measured 2026-08-04)
#   J30 <= 120
#   J60 <= 50
#   J90 <= 20

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUDGET="${BUDGET:-259}"

HEX_COUNT=$(grep -rhoE "#[0-9a-fA-F]{3,8}\b" --include=*.css client/src \
  | grep -v -i "tokens.css" \
  | sort -u \
  | wc -l | tr -d ' ')

echo "Design debt check: distinct hex colors outside tokens.css"
echo "  found:  $HEX_COUNT"
echo "  budget: $BUDGET"

if [ "$HEX_COUNT" -gt "$BUDGET" ]; then
  echo ""
  echo "FAIL: hex color debt increased ($HEX_COUNT > $BUDGET)."
  echo "New hardcoded colors must use client/src/styles/tokens.css variables"
  echo "instead of literal hex/rgb values. If this is an intentional budget"
  echo "bump, update BUDGET in .github/workflows/design-debt.yml with a"
  echo "one-line justification in the PR description."
  exit 1
fi

echo "OK: within budget."
