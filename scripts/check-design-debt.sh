#!/usr/bin/env bash
# Design-debt regression gate (plan-refonte-ui-90j.md §2.6).
#
# Counts distinct hardcoded hex colors in client/src CSS (excluding
# styles/tokens.css, the one file allowed to define raw color values), plus
# regressions in hardcoded radii, numeric z-index declarations, and exact
# duplicate CSS files. It fails the build if a count exceeds its budget for the current
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
RADIUS_BUDGET="${RADIUS_BUDGET:-292}"
Z_INDEX_BUDGET="${Z_INDEX_BUDGET:-29}"
DUPLICATE_CSS_BUDGET="${DUPLICATE_CSS_BUDGET:-0}"

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

RADIUS_COUNT=$(grep -rhoE --include=*.css --exclude=tokens.css \
  'border-radius[[:space:]]*:[[:space:]]*[^;}{]+' client/src \
  | grep -v 'var(' | wc -l | tr -d ' ' || true)

Z_INDEX_COUNT=$(grep -rhoE --include=*.css --exclude=tokens.css \
  'z-index[[:space:]]*:[[:space:]]*-?[0-9]+' client/src \
  | wc -l | tr -d ' ' || true)

DUPLICATE_CSS_COUNT=$(find client/src -type f -name '*.css' ! -name 'tokens.css' -print0 \
  | xargs -0 sha256sum \
  | awk '{ print $1 }' | sort | uniq -d | wc -l | tr -d ' ' || true)

echo "  hardcoded radii:          $RADIUS_COUNT/$RADIUS_BUDGET"
echo "  numeric z-index rules:    $Z_INDEX_COUNT/$Z_INDEX_BUDGET"
echo "  duplicate CSS hashes:     $DUPLICATE_CSS_COUNT/$DUPLICATE_CSS_BUDGET"

if [ "$RADIUS_COUNT" -gt "$RADIUS_BUDGET" ]; then
  echo ""
  echo "FAIL: hardcoded border-radius debt increased ($RADIUS_COUNT > $RADIUS_BUDGET)."
  exit 1
fi

if [ "$Z_INDEX_COUNT" -gt "$Z_INDEX_BUDGET" ]; then
  echo ""
  echo "FAIL: numeric z-index debt increased ($Z_INDEX_COUNT > $Z_INDEX_BUDGET)."
  exit 1
fi

if [ "$DUPLICATE_CSS_COUNT" -gt "$DUPLICATE_CSS_BUDGET" ]; then
  echo ""
  echo "FAIL: duplicate CSS hash groups increased ($DUPLICATE_CSS_COUNT > $DUPLICATE_CSS_BUDGET)."
  exit 1
fi

echo "OK: within budget."
