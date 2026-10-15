import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

/**
 * T-2059 (audit RELATIONSHIP-AUDIT-2026-10-15 D3) — re-attribute
 * `Message.coachId` for rows the deployed `main` wrote after
 * `20260913200000_message_coach_scope` was applied (main's schema has no
 * `coachId`, so every one of them is NULL and invisible on coach surfaces).
 *
 * Exactly the audit's §6 / D3 steps, in order, in ONE transaction:
 *   1. The 20260913200000 DML made idempotent:
 *      UPDATE "Message" SET "coachId" = "senderId"
 *       WHERE "coachId" IS NULL AND "senderId" <> "clientId"
 *   2. The T-661 DML body of 20260915000000_message_coach_backfill_single_coach,
 *      read verbatim from the migration file. The file is pinned (review r1
 *      finding 2): its sha256 must equal the pinned constant, the line in
 *      prisma/baselines/20260915000000_legacy/historical-migrations.sha256, and
 *      `_prisma_migrations.checksum` on the target database. The extracted body
 *      must be one statement starting `WITH sole_relationship` and, with
 *      comments stripped, contain no COMMIT/ROLLBACK/DELETE/DROP/TRUNCATE/ALTER.
 *
 * EXCLUSIONS (review r1 finding 1, lead decision: privacy over completeness).
 * Some clients are excluded from BOTH steps entirely; their NULL rows stay NULL
 * and are reported as "excluded":
 *   - every client in the overlap manifest written by the D1 apply (clients
 *     whose stale resolutionRequired flag D1 cleared, i.e. who had 2+
 *     CoachClient rows at the same time, and every client seen with 2+ rows);
 *   - every client with exactly one CoachClient row for whom the database holds
 *     evidence of a DIFFERENT coach that could overlap the surviving row:
 *       ACCEPTED ClientInvite (by email) or ACCEPTED/APPROVED CoachingRequest
 *       from another coach, at any time (no acceptance timestamp exists, so the
 *       other relationship may have started after the survivor's row), or
 *       ClientIntake / OnboardingResponse / MealPlanUpload / WorkoutImport /
 *       Message activity by another coach at or after the survivor's
 *       CoachClient.createdAt.
 * Step 2 is executed verbatim; the exclusion is applied by shadowing
 * "CoachClient" with a session-temporary view (pg_temp is searched first) that
 * omits the excluded clients, so they never form a `sole_relationship`. The
 * view is verified to be the relation the statement resolves to, and dropped
 * before the transaction ends.
 *
 * Step 2 reads ClientCoachingContext, so it must run after the D1
 * reconciliation; the CLI refuses otherwise.
 */

const BACKFILL_MIGRATION_NAME = "20260915000000_message_coach_backfill_single_coach";
const BACKFILL_MIGRATION = `prisma/migrations/${BACKFILL_MIGRATION_NAME}/migration.sql`;
const BASELINE_MANIFEST = "prisma/baselines/20260915000000_legacy/historical-migrations.sha256";
export const PINNED_T661_SHA256 = "dca2dae9079bf444af08a45d3176744509b7c27afc6509c2d4417b905d274b0a";
const START_MARKER = "-- >>> T-661 BACKFILL";
const END_MARKER = "-- <<< T-661 BACKFILL <<<";
const FORBIDDEN = /\b(COMMIT|ROLLBACK|DELETE|DROP|TRUNCATE|ALTER)\b/i;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Extract and validate the T-661 body from migration file text. Exported for tests. */
export function extractT661Statement(sql: string): string {
  const startMarkerAt = sql.indexOf(START_MARKER);
  const endAt = sql.indexOf(END_MARKER);
  if (startMarkerAt === -1 || endAt === -1 || endAt <= startMarkerAt) {
    throw new Error("T-661 backfill markers missing from the migration file");
  }
  const startAt = sql.indexOf("\n", startMarkerAt) + 1;
  const body = stripComments(sql.slice(startAt, endAt)).trim();
  const statement = body.replace(/;\s*$/, "").trim();
  if (statement.includes(";")) throw new Error("T-661 body contains more than one statement; refusing.");
  if (!/^WITH sole_relationship AS \(/.test(statement)) throw new Error("T-661 body does not start with WITH sole_relationship; refusing.");
  if (FORBIDDEN.test(statement)) throw new Error("T-661 body contains a forbidden keyword; refusing.");
  if (!/\bUPDATE "Message" m\s+SET "coachId" = aw\."coachId"\s+FROM attribution_window aw\s+WHERE/.test(statement)) {
    throw new Error("Unexpected T-661 backfill body; refusing to run something other than the shipped UPDATE.");
  }
  return statement;
}

/** Reads the migration file, checks it against both repo pins, returns the statement. */
export function readPinnedT661Statement(root = process.cwd()): string {
  const sql = readFileSync(path.join(root, BACKFILL_MIGRATION), "utf8");
  const actual = sha256(sql);
  const baselineLine = readFileSync(path.join(root, BASELINE_MANIFEST), "utf8")
    .split("\n")
    .find((line) => line.trim().endsWith(BACKFILL_MIGRATION));
  const baseline = baselineLine?.trim().split(/\s+/)[0];
  if (actual !== PINNED_T661_SHA256 || baseline !== PINNED_T661_SHA256) {
    throw new Error(
      `T-661 migration file sha256 ${actual} does not match the pin ${PINNED_T661_SHA256} ` +
        `(historical-migrations.sha256: ${baseline ?? "missing"}); refusing.`
    );
  }
  return extractT661Statement(sql);
}

/** The target database must have applied exactly the pinned file. */
export async function verifyLedgerChecksum(client: DbClient): Promise<void> {
  const rows = await client.$queryRaw<Array<{ checksum: string }>>`
    SELECT checksum FROM "_prisma_migrations"
     WHERE migration_name = ${BACKFILL_MIGRATION_NAME} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  if (rows.length !== 1 || rows[0].checksum !== PINNED_T661_SHA256) {
    throw new Error(
      `_prisma_migrations on the target has ${rows.length === 1 ? `checksum ${rows[0].checksum}` : `${rows.length} applied rows`} ` +
        `for ${BACKFILL_MIGRATION_NAME}, expected ${PINNED_T661_SHA256}; refusing.`
    );
  }
}

/**
 * Single-CoachClient-row clients with evidence of another coach that could
 * overlap the surviving relationship (see header). Read-only.
 */
export async function otherCoachEvidenceClientIds(client: DbClient): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ clientId: string }>>`
    WITH sole AS (
      SELECT cc."clientId", min(cc."coachId") AS "coachId", min(cc."createdAt") AS "rowCreatedAt"
      FROM "CoachClient" cc GROUP BY cc."clientId" HAVING count(*) = 1
    )
    SELECT s."clientId" FROM sole s JOIN "User" u ON u.id = s."clientId"
    WHERE EXISTS (SELECT 1 FROM "ClientInvite" i
                   WHERE i.status = 'ACCEPTED' AND i."coachId" <> s."coachId"
                     AND (lower(i.email) = lower(u.email) OR lower(i."mismatchEmail") = lower(u.email)))
       OR EXISTS (SELECT 1 FROM "CoachingRequest" r JOIN "CoachProfile" cp ON cp.id = r."coachProfileId"
                   WHERE r."prospectId" = s."clientId" AND r.status IN ('ACCEPTED', 'APPROVED') AND cp."userId" <> s."coachId")
       OR EXISTS (SELECT 1 FROM "ClientIntake" x WHERE x."clientId" = s."clientId" AND x."coachId" IS DISTINCT FROM s."coachId" AND x."sentAt" >= s."rowCreatedAt")
       OR EXISTS (SELECT 1 FROM "OnboardingResponse" x WHERE x."clientId" = s."clientId" AND x."coachId" <> s."coachId" AND x."createdAt" >= s."rowCreatedAt")
       OR EXISTS (SELECT 1 FROM "MealPlanUpload" x WHERE x."clientId" = s."clientId" AND x."coachId" <> s."coachId" AND x."createdAt" >= s."rowCreatedAt")
       OR EXISTS (SELECT 1 FROM "WorkoutImport" x WHERE x."clientId" = s."clientId" AND x."coachId" <> s."coachId" AND x."createdAt" >= s."rowCreatedAt")
       OR EXISTS (SELECT 1 FROM "Message" m WHERE m."clientId" = s."clientId" AND m."createdAt" >= s."rowCreatedAt"
                   AND ((m."coachId" IS NOT NULL AND m."coachId" <> s."coachId")
                     OR (m."senderId" <> s."clientId" AND m."senderId" <> s."coachId")))
    ORDER BY s."clientId"`;
  return rows.map((r) => r.clientId);
}

export type UnattributedBreakdown = {
  totalNullCoachId: number;
  excludedOverlapRisk: number;
  excludedOtherCoachEvidence: number;
  clientHasNoCoachClient: number;
  clientHasMultipleCoachClients: number;
  singleCoachContextDisagrees: number;
  singleCoachBeforeRelationshipRow: number;
  singleCoachOtherCoachInterleaved: number;
};

/** Read-only. Why each remaining NULL-coachId message was not attributed. */
export async function unattributedBreakdown(
  client: DbClient = db,
  manifestIds: readonly string[] = [],
  evidenceIds: readonly string[] = []
): Promise<UnattributedBreakdown> {
  const manifest = [...manifestIds];
  const evidence = [...evidenceIds];
  const [row] = await client.$queryRaw<Array<Record<keyof UnattributedBreakdown, bigint>>>`
    WITH rel AS (
      SELECT "clientId", count(*) AS n, min("id") AS only_id, min("createdAt") AS row_created_at
      FROM "CoachClient" GROUP BY "clientId"
    ),
    nulls AS (
      SELECT m."createdAt", COALESCE(rel.n, 0) AS n, rel.row_created_at,
        m."clientId" = ANY(${manifest}::text[]) AS in_manifest,
        m."clientId" = ANY(${evidence}::text[]) AS in_evidence,
        (ctx."clientId" IS NULL OR (ctx.mode = 'HUMAN' AND NOT ctx."resolutionRequired" AND ctx."activeCoachClientId" = rel.only_id)) AS agrees
      FROM "Message" m
      LEFT JOIN rel ON rel."clientId" = m."clientId"
      LEFT JOIN "ClientCoachingContext" ctx ON ctx."clientId" = m."clientId"
      WHERE m."coachId" IS NULL
    )
    SELECT
      count(*) AS "totalNullCoachId",
      count(*) FILTER (WHERE in_manifest) AS "excludedOverlapRisk",
      count(*) FILTER (WHERE NOT in_manifest AND in_evidence) AS "excludedOtherCoachEvidence",
      count(*) FILTER (WHERE NOT in_manifest AND NOT in_evidence AND n = 0) AS "clientHasNoCoachClient",
      count(*) FILTER (WHERE NOT in_manifest AND NOT in_evidence AND n > 1) AS "clientHasMultipleCoachClients",
      count(*) FILTER (WHERE NOT in_manifest AND NOT in_evidence AND n = 1 AND NOT agrees) AS "singleCoachContextDisagrees",
      count(*) FILTER (WHERE NOT in_manifest AND NOT in_evidence AND n = 1 AND agrees AND "createdAt" < row_created_at) AS "singleCoachBeforeRelationshipRow",
      count(*) FILTER (WHERE NOT in_manifest AND NOT in_evidence AND n = 1 AND agrees AND "createdAt" >= row_created_at) AS "singleCoachOtherCoachInterleaved"
    FROM nulls`;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as UnattributedBreakdown;
}

export type ReattributionResult = {
  applied: boolean;
  excludedManifestClients: number;
  excludedEvidenceClients: number;
  senderAttributed: number;
  singleCoachAttributed: number;
  /** Remaining NULL rows after both steps, by reason. */
  unattributed: UnattributedBreakdown;
};

class DryRunRollback extends Error {
  constructor(readonly result: ReattributionResult) {
    super("dry-run rollback");
  }
}

function sqlTextArray(ids: readonly string[]): string {
  for (const id of ids) if (!CLIENT_ID.test(id)) throw new Error(`Refusing unexpected client id shape: ${id}`);
  return ids.length === 0 ? "ARRAY[]::text[]" : `ARRAY[${ids.map((id) => `'${id}'`).join(",")}]::text[]`;
}

/**
 * Runs both steps in one transaction. With `apply: false` the transaction is
 * always rolled back, so the counts are exactly what an apply would write and
 * nothing is committed. `manifestClientIds` is REQUIRED (the overlap manifest);
 * an empty list is allowed only because a manifest can legitimately be empty.
 */
export async function reattributeMessageCoach({
  apply,
  manifestClientIds,
}: {
  apply: boolean;
  manifestClientIds: readonly string[];
}): Promise<ReattributionResult> {
  const backfill = readPinnedT661Statement();
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${apply ? "120s" : "15s"}'`);
        await verifyLedgerChecksum(tx);

        const manifest = [...new Set(manifestClientIds)];
        const evidence = (await otherCoachEvidenceClientIds(tx)).filter((id) => !manifest.includes(id));
        const excluded = [...manifest, ...evidence];

        const senderAttributed = await tx.$executeRaw`
          UPDATE "Message" SET "coachId" = "senderId"
           WHERE "coachId" IS NULL AND "senderId" <> "clientId" AND NOT ("clientId" = ANY(${excluded}::text[]))`;

        const [home] = await tx.$queryRaw<Array<{ nspname: string }>>`
          SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.oid = to_regclass('"CoachClient"') AND c.relkind = 'r'`;
        if (!home || !/^[a-z_][a-z0-9_]*$/.test(home.nspname)) throw new Error("Could not resolve the CoachClient table; refusing.");
        await tx.$executeRawUnsafe(
          `CREATE TEMP VIEW "CoachClient" AS SELECT * FROM "${home.nspname}"."CoachClient" WHERE NOT ("clientId" = ANY(${sqlTextArray(excluded)}))`
        );
        const [shadow] = await tx.$queryRaw<Array<{ shadowed: boolean }>>`
          SELECT to_regclass('"CoachClient"') = to_regclass('pg_temp."CoachClient"') AS shadowed`;
        if (!shadow?.shadowed) throw new Error("Exclusion view does not shadow CoachClient; refusing to run step 2.");
        const singleCoachAttributed = await tx.$executeRawUnsafe(backfill);
        await tx.$executeRawUnsafe('DROP VIEW pg_temp."CoachClient"');

        const unattributed = await unattributedBreakdown(tx, manifest, evidence);
        const result: ReattributionResult = {
          applied: apply,
          excludedManifestClients: manifest.length,
          excludedEvidenceClients: evidence.length,
          senderAttributed,
          singleCoachAttributed,
          unattributed,
        };
        if (!apply) throw new DryRunRollback(result);
        return result;
      },
      { maxWait: 10_000, timeout: 180_000 }
    );
  } catch (error) {
    if (error instanceof DryRunRollback) return error.result;
    throw error;
  }
}
