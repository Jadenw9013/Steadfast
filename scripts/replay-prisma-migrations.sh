#!/usr/bin/env bash

set -euo pipefail
export LC_ALL=C

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly BASELINE_DIR="${REPO_ROOT}/prisma/baselines/20260915000000_legacy"
readonly BASELINE_SQL="${BASELINE_DIR}/baseline.sql"
readonly HISTORICAL_MANIFEST="${BASELINE_DIR}/historical-migrations.sha256"
readonly BASELINE_SHA256="91fda9c79080c6829e35bf0db15f7c6e438110c10c203c46eb0376484d08a63f"
readonly RESOLVE_THROUGH="20260915000000_message_coach_backfill_single_coach"
readonly EXPECTED_RESOLVED_COUNT="66"
readonly HISTORICAL_CHECKIN_MIGRATION="${REPO_ROOT}/prisma/migrations/20260216000000_add_checkin_status/migration.sql"
readonly HISTORICAL_CHECKIN_SHA256="0d96b6e9780e5e1cf7fd47f8f780af2ac58caae7e8416b138b9eb37696db544e"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

# This workflow is intentionally unusable against hosted, shared, or production
# databases. It initializes only a brand-new local disposable database whose
# name advertises that purpose.
node --input-type=module <<'NODE'
const url = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!(["127.0.0.1", "localhost"].includes(url.hostname))) {
  throw new Error("Migration replay is restricted to local PostgreSQL.");
}
if (!databaseName.startsWith("steadfast_migration_replay_")) {
  throw new Error(
    "Disposable database name must start with steadfast_migration_replay_."
  );
}
if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") {
  throw new Error("Migration replay requires the public schema.");
}
NODE

for command_name in psql pnpm shasum; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

verify_sha256() {
  local expected="$1"
  local path="$2"
  local actual
  actual="$(shasum -a 256 "${path}" | awk '{print $1}')"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Checksum mismatch for ${path}. Refusing baseline replay." >&2
    exit 1
  fi
}

cd "${REPO_ROOT}"
verify_sha256 "${BASELINE_SHA256}" "${BASELINE_SQL}"
verify_sha256 "${HISTORICAL_CHECKIN_SHA256}" "${HISTORICAL_CHECKIN_MIGRATION}"
if ! shasum -a 256 -c "${HISTORICAL_MANIFEST}" >/dev/null; then
  echo "A preserved historical migration differs from the reviewed manifest." >&2
  exit 1
fi

baseline_migrations=()
for migration_dir in "${REPO_ROOT}"/prisma/migrations/*; do
  [[ -d "${migration_dir}" ]] || continue
  migration_name="$(basename "${migration_dir}")"
  [[ "${migration_name}" > "${RESOLVE_THROUGH}" ]] && continue
  baseline_migrations+=("${migration_name}")
done

if [[ "${#baseline_migrations[@]}" != "${EXPECTED_RESOLVED_COUNT}" ]]; then
  echo "Expected ${EXPECTED_RESOLVED_COUNT} preserved migrations, found ${#baseline_migrations[@]}." >&2
  exit 1
fi

readonly USER_RELATION_COUNT="$(
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -Atc \
    "SELECT count(*)
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');"
)"

if [[ "${USER_RELATION_COUNT}" != "0" ]]; then
  echo "Refusing replay: the disposable database is not empty." >&2
  exit 1
fi

export DOTENV_CONFIG_QUIET=true

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${BASELINE_SQL}" >/dev/null

resolved_count=0
for migration_name in "${baseline_migrations[@]}"; do
  if ! resolve_output="$(pnpm exec prisma migrate resolve --applied "${migration_name}" 2>&1)"; then
    echo "Failed to record preserved migration ${migration_name}:" >&2
    echo "${resolve_output}" >&2
    exit 1
  fi
  resolved_count=$((resolved_count + 1))
done

echo "Recorded ${resolved_count} preserved legacy migrations as applied."
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status
pnpm exec prisma migrate diff \
  --from-config-datasource \
  --to-schema prisma/schema.prisma \
  --exit-code

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public."MealPlan_one_published_per_client_week"') IS NULL
    OR to_regclass('public."TrainingProgram_one_published_per_client"') IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = 'AiWorkoutSession_modality_check'
    )
  THEN
    RAISE EXCEPTION 'Legacy raw-SQL invariant is missing';
  END IF;
END;
$$;
SELECT 'Legacy raw-SQL invariants present';
SQL

echo "Disposable migration replay completed with no Prisma schema diff."
