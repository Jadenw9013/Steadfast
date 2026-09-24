#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test"

if [[ "${DATABASE_URL:-}" != "${EXPECTED_DATABASE_URL}" ]]; then
  echo "REFUSED: set DATABASE_URL exactly to the dedicated local steadfast_security_test database." >&2
  exit 2
fi

if [[ "${NODE_ENV:-test}" == "production" ]]; then
  echo "REFUSED: the synthetic kill-switch drill cannot run with NODE_ENV=production." >&2
  exit 2
fi

echo "T-1010 synthetic kill-switch/rollback drill"
echo "Database: local dedicated steadfast_security_test"
echo "Live provider calls: disabled"

SECURITY_INTEGRATION=1 \
AI_COACH_FIXTURE_MODE=true \
FEATURE_AI_COACH_ENROLLMENT=false \
FEATURE_AI_COACH_GENERATION=false \
FEATURE_AI_COACH_PUBLICATION=false \
pnpm exec vitest run tests/integration/ai-coach-release-drills.test.ts \
  --maxWorkers=1 \
  --no-file-parallelism \
  --reporter=dot
