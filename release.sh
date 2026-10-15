#!/usr/bin/env bash
set -euo pipefail

echo "=============================="
echo "STEADFAST PRODUCTION CHECK"
echo "=============================="

# Common excludes for all checks
EXCLUDES=(
  --exclude-dir=node_modules
  --exclude-dir=.next
  --exclude-dir=.claude
  --exclude-dir=.git
  --exclude-dir=tests
)

# Only scan runtime-like source files
RUNTIME=(
  --include=*.ts
  --include=*.tsx
  --include=*.js
  --include=*.jsx
  --include=*.mjs
  --exclude=release.sh
  --exclude=*.md
  --exclude=.env*
)

STATUS_TYPECHECK="SKIPPED"
STATUS_UNIT="SKIPPED"

echo ""
echo "1. Running build..."
pnpm run build || { echo "Build failed"; exit 1; }

echo ""
echo "2. Running lint..."
pnpm run lint || { echo "Lint failed"; exit 1; }

echo ""
echo "2b. Running type-check..."
pnpm run type-check && STATUS_TYPECHECK="PASSED" || { echo "Type-check failed"; exit 1; }

echo ""
echo "2c. Running unit/smoke tests..."
pnpm test && STATUS_UNIT="PASSED" || { echo "Unit tests failed"; exit 1; }

echo ""
echo "3. Checking for localhost in runtime code..."
HITS=$(grep -Rn "localhost" . "${EXCLUDES[@]}" "${RUNTIME[@]}" \
  | grep -Ev "^\s*//.*localhost" \
  | grep -Ev "^\s*\*.*localhost" \
  | grep -Ev "/\*.*localhost" \
  || true)

if [[ -n "${HITS}" ]]; then
  echo "${HITS}"
  echo "FAIL: Found localhost references in runtime code. Fix before deploy."
  exit 1
fi
echo "   OK"

echo ""
echo "4. Checking for browser-only PDF libs (pdfjs/DOMMatrix)..."
HITS=$(grep -Rn -E "pdfjs-dist|react-pdf|DOMMatrix" . "${EXCLUDES[@]}" "${RUNTIME[@]}" \
  | grep -Ev "^\s*//" \
  | grep -Ev "^\s*\*" \
  | grep -Ev "^\s*/\*" \
  || true)

if [[ -n "${HITS}" ]]; then
  echo "${HITS}"
  echo "WARN: Found browser-only PDF libs. Ensure not used server-side."
fi

echo ""
echo "5. Checking for test Clerk keys in source..."
HITS=$(grep -Rn -E "pk_test_|sk_test_" . "${EXCLUDES[@]}" "${RUNTIME[@]}" || true)
if [[ -n "${HITS}" ]]; then
  echo "${HITS}"
  echo "FAIL: Found Clerk test keys in source code. Use env vars."
  exit 1
fi
echo "   OK"

echo ""
echo "6. Checking for console.log in client components..."
HITS=$(grep -Rn "console\.log(" . "${EXCLUDES[@]}" \
  --include="*.tsx" --include="*.jsx" \
  --exclude=release.sh \
  | grep -Ev "^\s*//" \
  | grep -Ev "^\s*\*" \
  | grep -Ev "^\s*/\*" \
  || true)

if [[ -n "${HITS}" ]]; then
  echo "${HITS}"
  echo "WARN: Found console.log in client components. Review before deploy."
fi

echo ""
echo "7. Checking for Prisma include in pages/queries (use select instead)..."
# The @prisma/adapter-pg driver crashes on String[]/Int[]/Json columns
# when include pulls all columns via Neon pooled connections.
HITS=$(grep -Rn "include:" app/ lib/queries/ "${EXCLUDES[@]}" \
  --include="*.ts" --include="*.tsx" \
  | grep -Ev "\"use client\"" \
  | grep -Ev "^\\s*//" \
  | grep -Ev "^\\s*\\*" \
  | grep -Ev "app/actions/" \
  | grep -Ev "app/api/" \
  || true)

if [[ -n "${HITS}" ]]; then
  echo "${HITS}"
  echo "WARN: Found Prisma 'include:' in page/query files."
  echo "      Prefer explicit 'select:' to avoid @prisma/adapter-pg crashes"
  echo "      with String[]/Int[]/Json columns on Neon pooled connections."
fi

echo ""
echo "=============================="
echo "Release checks complete."
echo "Result: build=PASSED lint=PASSED type-check=${STATUS_TYPECHECK} unit-tests=${STATUS_UNIT}"
echo "NOT run by this script: Playwright e2e (tests/e2e/), opt-in SECURITY_INTEGRATION=1"
echo "integration tests (tests/integration/), authorization-race/concurrency tests,"
echo "clinical/policy review, and real accessibility/user testing."
echo "A clean run above means these specific automated checks passed on this commit —"
echo "it is not a general 'safe to deploy' certification. See"
echo "docs/ai-coach/09-Validation-Release-Operations.md for the full gate list on AI Coach work."
echo "=============================="
