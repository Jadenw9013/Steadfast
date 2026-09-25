#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${#}" -ne 1 ]]; then
  echo "Usage: $0 docs/ai-coach/approval/<candidate-packet>.json" >&2
  exit 2
fi
readonly PACKET="$1"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "REFUSED: DATABASE_URL is required." >&2
  exit 2
fi

node --input-type=module <<'NODE'
const url = new URL(process.env.DATABASE_URL);
const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (/prod|production/i.test(name)) {
  throw new Error("Staging preflight refuses a production-named database.");
}
NODE

pnpm exec tsx scripts/validate-ai-coach-live-launch-packet.ts --readiness "${PACKET}"
pnpm prisma validate
pnpm prisma migrate status
pnpm type-check
pnpm build

echo "PASS: staging preflight completed. No deployment or activation was performed."
echo "NEXT: a named release witness must deploy the exact revision, run the kill-switch drill, and externally sign the resulting evidence digest."
