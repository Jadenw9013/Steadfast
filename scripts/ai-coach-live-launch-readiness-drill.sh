#!/usr/bin/env bash
set -euo pipefail

readonly PACKET="docs/ai-coach/approval/live-launch-packet.template.v1.json"

pnpm exec tsx scripts/validate-ai-coach-live-launch-packet.ts --draft "${PACKET}"

readonly OUTPUT_FILE="$(mktemp)"
trap 'rm -f "${OUTPUT_FILE}"' EXIT
if pnpm exec tsx scripts/validate-ai-coach-live-launch-packet.ts --readiness "${PACKET}" >"${OUTPUT_FILE}" 2>&1; then
  cat "${OUTPUT_FILE}"
  echo "FAIL: the placeholder/test-only packet was accepted for live launch" >&2
  exit 1
fi
cat "${OUTPUT_FILE}"
grep -q "PACKET_TEST_ONLY" "${OUTPUT_FILE}"
grep -q "HUMAN_DECISION_REQUIRED" "${OUTPUT_FILE}"
grep -q "ARTIFACT_BINDING_MISSING" "${OUTPUT_FILE}"
grep -q "APPROVAL_NOT_CURRENT" "${OUTPUT_FILE}"
grep -q "EVIDENCE_NOT_CURRENT" "${OUTPUT_FILE}"
echo "PASS: placeholder packet is schema-valid for authoring and fail-closed for live readiness"
