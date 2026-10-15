#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test"
readonly IOS_REPOSITORY="${IOS_REPOSITORY:-../ios-steadfast}"

if [[ "${DATABASE_URL:-}" != "${EXPECTED_DATABASE_URL}" ]]; then
  echo "REFUSED: set DATABASE_URL exactly to the dedicated local steadfast_security_test database." >&2
  exit 2
fi

if [[ "${NODE_ENV:-test}" == "production" ]]; then
  echo "REFUSED: release evidence is synthetic-only and cannot run with NODE_ENV=production." >&2
  exit 2
fi

export AI_COACH_FIXTURE_MODE=true
export FEATURE_AI_COACH_ENROLLMENT=false
export FEATURE_AI_COACH_GENERATION=false
export FEATURE_AI_COACH_PUBLICATION=false

echo "AI Coach activation-blocked release-evidence harness v2"
echo "Database: local dedicated steadfast_security_test"
echo "Feature flags: explicitly disabled"
echo "Provider: synthetic only"

pnpm prisma validate
pnpm prisma generate
pnpm exec vitest run \
  tests/unit/ai-coach-artifacts.test.ts \
  tests/unit/ai-coach-discovery-contract.test.ts \
  tests/unit/ai-coach-live-launch-readiness.test.ts \
  tests/unit/ai-coach-live-provider.test.ts \
  tests/unit/ai-coach-nutrition-safety.test.ts \
  tests/unit/ai-coach-provider-evaluation.test.ts \
  tests/unit/ai-coach-spend-estimate.test.ts \
  --reporter=dot

bash scripts/ai-coach-kill-switch-drill.sh
bash scripts/ai-coach-live-launch-readiness-drill.sh

SECURITY_INTEGRATION=1 pnpm exec vitest run \
  tests/integration/ai-coach-*.test.ts \
  tests/integration/account-deletion.test.ts \
  --maxWorkers=1 \
  --no-file-parallelism \
  --reporter=dot

pnpm type-check
pnpm exec eslint \
  lib/account-deletion/purge.ts \
  lib/ai-coach/artifacts/repository.ts \
  lib/ai-coach/executor.ts \
  lib/ai-coach/provider/adapter.ts \
  lib/ai-coach/provider/constrained-boundary.ts \
  lib/ai-coach/provider/live-boundary.ts \
  lib/ai-coach/provider/anthropic-provider.ts \
  lib/ai-coach/discovery.ts \
  lib/ai-coach/live-launch/schema.ts \
  lib/ai-coach/live-launch/repository.ts \
  lib/ai-coach/operations.ts \
  scripts/validate-ai-coach-live-launch-packet.ts \
  scripts/activate-ai-coach-live-release.ts \
  scripts/deactivate-ai-coach-live-release.ts \
  scripts/evaluate-ai-coach-final-provider.ts \
  scripts/check-ai-coach-operational-alerts.ts \
  tests/integration/ai-coach-artifacts.test.ts \
  tests/integration/ai-coach-live-launch-readiness.test.ts \
  tests/unit/ai-coach-discovery-contract.test.ts \
  tests/unit/ai-coach-live-launch-readiness.test.ts \
  tests/unit/ai-coach-live-provider.test.ts \
  tests/helpers/ai-live-launch.ts \
  tests/unit/ai-coach-provider-evaluation.test.ts \
  tests/integration/ai-coach-provider-boundary.test.ts \
  tests/integration/ai-coach-end-to-end-governance.test.ts \
  tests/integration/ai-coach-release-drills.test.ts
pnpm exec prettier --check \
  package.json \
  lib/health/expected-migrations.ts \
  lib/account-deletion/purge.ts \
  lib/ai-coach/artifacts/repository.ts \
  lib/ai-coach/executor.ts \
  lib/ai-coach/provider/adapter.ts \
  lib/ai-coach/provider/constrained-boundary.ts \
  lib/ai-coach/provider/live-boundary.ts \
  lib/ai-coach/provider/anthropic-provider.ts \
  lib/ai-coach/discovery.ts \
  lib/ai-coach/live-launch/schema.ts \
  lib/ai-coach/live-launch/repository.ts \
  lib/ai-coach/operations.ts \
  scripts/validate-ai-coach-live-launch-packet.ts \
  scripts/activate-ai-coach-live-release.ts \
  scripts/deactivate-ai-coach-live-release.ts \
  scripts/evaluate-ai-coach-final-provider.ts \
  scripts/check-ai-coach-operational-alerts.ts \
  LAUNCH_REQUIRED_INPUTS.md \
  docs/ai-coach/approval/README.md \
  docs/ai-coach/approval/live-launch-approval-packet-v1.md \
  docs/ai-coach/approval/live-launch-packet.template.v1.json \
  docs/ai-coach/evidence/live-launch-readiness-v1.md \
  docs/ai-coach/evidence/live-launch-readiness-v2.md \
  tests/fixtures/ai-coach/provider-evaluation-v1.json \
  tests/integration/ai-coach-artifacts.test.ts \
  tests/integration/ai-coach-live-launch-readiness.test.ts \
  tests/unit/ai-coach-discovery-contract.test.ts \
  tests/unit/ai-coach-live-launch-readiness.test.ts \
  tests/unit/ai-coach-live-provider.test.ts \
  tests/helpers/ai-live-launch.ts \
  tests/unit/ai-coach-provider-evaluation.test.ts \
  tests/integration/ai-coach-provider-boundary.test.ts \
  tests/integration/ai-coach-end-to-end-governance.test.ts \
  tests/integration/ai-coach-release-drills.test.ts \
  docs/ai-coach/evidence/T-1009-T-1010-release-evidence-v1.md
pnpm build

if [[ -n "${MIGRATION_REPLAY_DATABASE_URL:-}" ]]; then
  DATABASE_URL="${MIGRATION_REPLAY_DATABASE_URL}" pnpm run prisma:replay
else
  echo "SKIP: MIGRATION_REPLAY_DATABASE_URL was not supplied; run prisma:replay against a new local disposable database separately." >&2
fi

if [[ -x "${IOS_REPOSITORY}/scripts/validate-ai-coach-release.sh" ]]; then
  bash "${IOS_REPOSITORY}/scripts/validate-ai-coach-release.sh"
else
  echo "SKIP: iOS release validator not found at ${IOS_REPOSITORY}." >&2
fi

git diff --check
