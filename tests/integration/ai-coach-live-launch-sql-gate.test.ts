/**
 * S-20 — the raw-SQL half of the live-launch approval gate.
 *
 * `validate_ai_coach_live_launch_approval` is the second of the two places the
 * launch policy is enforced (the first is `evaluateLiveLaunchPacketReadiness`
 * in `lib/ai-coach/live-launch/schema.ts`). It is called from
 * `guard_ai_coach_live_launch_packet`, the BEFORE UPDATE trigger that is the
 * only way a packet row reaches `state = 'APPROVED'`.
 *
 * S-20 was filed against two defects in that function:
 *
 *   1. `item->'jurisdictions' @> candidate->'jurisdictions'` — `->` and `@>`
 *      share a precedence level and are left-associative, so this parses as
 *      `((item->'jurisdictions') @> candidate) -> 'jurisdictions'`, which is a
 *      type error, swallowed by the function's `EXCEPTION WHEN OTHERS THEN
 *      RETURN false`.
 *   2. `(item->>'signedAt')::timestamptz <= approved_at` — a `timestamptz`
 *      compared against a naive `TIMESTAMP` parameter, resolved through the
 *      session `TimeZone` rather than UTC.
 *
 * Both are real, and both are reproduced below against the **committed v1
 * body**, read out of its own migration file so the reproduction tracks the
 * real text rather than a paraphrase of it.
 *
 * Neither is live, and never has been. The ticket's open question — "why does
 * the error not surface at baseline?" — has a flat answer, asserted by the
 * "never runs the v1 body" case below: the v1 body is not the function that
 * runs. `20260922010000_ai_coach_governed_activation` replaces it, a few lines
 * after creating the activation table, with a body that parenthesises both
 * containment operands and pins all four instant comparisons to
 * `AT TIME ZONE 'UTC'`. The v1 text only ever exists between two migrations of
 * the same replay, so no packet has ever been evaluated by it.
 *
 * S-20's own migration
 * (`20260928000000_ai_coach_single_signer_accountable_owner`) is the third and
 * current definition; it keeps both fixes and reduces the required signatures
 * to SINGLE_SIGNER_ACCOUNTABLE_OWNER. The last describe block proves the two
 * enforcement points — this function and `evaluateLiveLaunchPacketReadiness` —
 * return the same verdict for every case, and that a valid one-signer packet
 * actually reaches `state = 'APPROVED'`.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  approveLiveLaunchPacket,
  registerLiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/repository";
import {
  buildNonSyntheticLaunchTestArtifacts,
  completeNonTestLaunchPacket,
  createTestGovernanceActor,
} from "@/tests/helpers/ai-live-launch";
import {
  ALL_APPROVAL_REQUIREMENTS,
  LIVE_LAUNCH_APPROVAL_MODE,
  REQUIRED_APPROVAL_REQUIREMENTS,
  evaluateLiveLaunchPacketReadiness,
  type LiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/schema";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: reads and calls the shared live-launch SQL gate, and registers
// packet rows, but never occupies the single ACTIVE activation row and never
// runs an unscoped delete/count. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");

const VALIDATOR = "validate_ai_coach_live_launch_approval";
const V1_MIGRATION = "prisma/migrations/20260922000000_ai_coach_live_launch_readiness/migration.sql";
const V2_MIGRATION = "prisma/migrations/20260922010000_ai_coach_governed_activation/migration.sql";
const S20_MIGRATION =
  "prisma/migrations/20260928000000_ai_coach_single_signer_accountable_owner/migration.sql";

/** SQL lines with `--` comments stripped, so an assertion about the code
 * cannot be satisfied (or broken) by a comment that quotes the code. */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trimEnd())
    .filter((line) => line.trim() !== "");
}

function assertNoS20Defects(lines: string[], subject: string) {
  // Defect 1: an unparenthesised left operand of `@>`.
  expect(lines.filter((line) => /[^(]item->'jurisdictions' @>/.test(line)), subject).toEqual([]);
  expect(
    lines.filter((line) => /[^(]candidate->'jurisdictions' @>/.test(line)),
    subject
  ).toEqual([]);
  // Defect 2: a timestamptz cast compared without being pinned to UTC.
  expect(
    lines.filter((line) => line.includes("::timestamptz") && !line.includes("AT TIME ZONE 'UTC'")),
    subject
  ).toEqual([]);
}

/** A session timezone far from both UTC and the server default, so a naive
 * `TIMESTAMP` <-> `timestamptz` comparison cannot accidentally agree. */
const FAR_TIMEZONE = "Pacific/Kiritimati"; // UTC+14

/** Reads the `CREATE [OR REPLACE] FUNCTION validate_...` block verbatim out of
 * a committed migration. Deliberately not a copy-paste of the SQL into this
 * file: the reproduction must track the text that actually shipped. */
function validatorBodyFromMigration(migrationPath: string): string {
  const sql = readFileSync(resolve(process.cwd(), migrationPath), "utf8");
  const start = sql.indexOf(`CREATE FUNCTION "${VALIDATOR}"`);
  const startOrReplace = sql.indexOf(`CREATE OR REPLACE FUNCTION "${VALIDATOR}"`);
  const from = start >= 0 ? start : startOrReplace;
  if (from < 0) throw new Error(`No ${VALIDATOR} definition in ${migrationPath}`);
  const terminator = "$$ LANGUAGE plpgsql IMMUTABLE;";
  const to = sql.indexOf(terminator, from);
  if (to < 0) throw new Error(`Unterminated ${VALIDATOR} definition in ${migrationPath}`);
  return sql.slice(from, to + terminator.length);
}

/** Installs `body` under a throwaway name so the real gate is never replaced,
 * runs `run`, and drops it again. */
async function withValidatorVariant<T>(
  body: string,
  run: (functionName: string) => Promise<T>
): Promise<T> {
  const name = `s20_variant_${randomUUID().replaceAll("-", "")}`;
  const renamed = body
    .replace(`CREATE OR REPLACE FUNCTION "${VALIDATOR}"`, `CREATE FUNCTION "${name}"`)
    .replace(`CREATE FUNCTION "${VALIDATOR}"`, `CREATE FUNCTION "${name}"`);
  await db.$executeRawUnsafe(renamed);
  try {
    return await run(name);
  } finally {
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"(JSONB, TIMESTAMP)`);
  }
}

/** The naive-UTC wall clock Prisma writes into `AiCoachLiveLaunchPacket."approvedAt"`
 * (a `TIMESTAMP(3)` column), which is exactly what the trigger passes as
 * `approved_at`. */
function approvedAtLiteral(at: Date): string {
  return at.toISOString().replace("T", " ").replace("Z", "");
}

async function callValidator(
  functionName: string,
  packet: LiveLaunchPacket,
  approvedAt: Date,
  timeZone?: string
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    if (timeZone) await tx.$executeRawUnsafe(`SET LOCAL TimeZone = '${timeZone}'`);
    const rows = await tx.$queryRawUnsafe<{ ok: boolean | null }[]>(
      `SELECT "${functionName}"($1::jsonb, $2::timestamp) AS ok`,
      JSON.stringify(packet),
      approvedAtLiteral(approvedAt)
    );
    return rows[0].ok === true;
  });
}

function validPacket(approvalRequirements?: readonly (typeof ALL_APPROVAL_REQUIREMENTS)[number][]): {
  packet: LiveLaunchPacket;
  approvedAt: Date;
} {
  const suffix = randomUUID();
  const artifacts = buildNonSyntheticLaunchTestArtifacts(suffix);
  return {
    packet: completeNonTestLaunchPacket({
      suffix,
      artifactBindings: artifacts.references,
      approvalRequirements,
    }),
    approvedAt: new Date(),
  };
}

function expectationFor(packet: LiveLaunchPacket) {
  return {
    packetId: packet.packetId,
    releaseId: packet.releaseId,
    engineVersion: packet.engineVersion,
    jurisdictions: packet.jurisdictions,
  };
}

suite.sequential("S-20 — live-launch approval SQL gate", () => {
  describe("reproduction against the committed v1 validator", () => {
    it("defect 1: the unparenthesised jurisdiction clause is a type error; the parenthesised one is not", async () => {
      const operand = `'{"jurisdictions":["US"]}'::jsonb`;
      await expect(
        db.$queryRawUnsafe(
          `SELECT ${operand}->'jurisdictions' @> ${operand}->'jurisdictions' AS ok`
        )
      ).rejects.toThrow(/operator does not exist: boolean -> unknown/);

      const parenthesised = await db.$queryRawUnsafe<{ ok: boolean }[]>(
        `SELECT (${operand}->'jurisdictions') @> (${operand}->'jurisdictions') AS ok`
      );
      expect(parenthesised[0].ok).toBe(true);
    });

    it("defect 1: the v1 body refuses a valid seven-signer packet, and surfaces 42883 once its EXCEPTION handler is removed", async () => {
      const { packet, approvedAt } = validPacket();
      const v1 = validatorBodyFromMigration(V1_MIGRATION);
      expect(v1).toContain("item->'jurisdictions' @> candidate->'jurisdictions'");

      await withValidatorVariant(v1, async (name) => {
        expect(await callValidator(name, packet, approvedAt)).toBe(false);
      });

      // The same body with `EXCEPTION WHEN OTHERS THEN RETURN false` removed,
      // so the error the gate has been swallowing is visible.
      const unswallowed = v1.replace(
        /EXCEPTION WHEN OTHERS THEN\s*\n\s*RETURN false;\s*\n/,
        ""
      );
      expect(unswallowed).not.toContain("EXCEPTION WHEN OTHERS");
      await withValidatorVariant(unswallowed, async (name) => {
        await expect(callValidator(name, packet, approvedAt)).rejects.toThrow(
          /operator does not exist: boolean -> unknown/
        );
      });
    });

    it("defect 2: with the jurisdiction clause parenthesised, the naive TIMESTAMP comparison still refuses a valid packet under a non-UTC session timezone", async () => {
      const { packet, approvedAt } = validPacket();
      const jurisdictionFixedOnly = validatorBodyFromMigration(V1_MIGRATION)
        .replace(
          "item->'jurisdictions' @> candidate->'jurisdictions'",
          "(item->'jurisdictions') @> (candidate->'jurisdictions')"
        )
        .replace(
          "candidate->'jurisdictions' @> item->'jurisdictions'",
          "(candidate->'jurisdictions') @> (item->'jurisdictions')"
        );
      expect(jurisdictionFixedOnly).toContain("(item->>'signedAt')::timestamptz > approved_at");
      expect(jurisdictionFixedOnly).not.toContain("AT TIME ZONE");

      await withValidatorVariant(jurisdictionFixedOnly, async (name) => {
        // UTC session: the naive parameter happens to line up, so the bug hides.
        expect(await callValidator(name, packet, approvedAt, "UTC")).toBe(true);
        // Any other session timezone shifts `approved_at` and the gate refuses.
        expect(await callValidator(name, packet, approvedAt, FAR_TIMEZONE)).toBe(false);
      });
    });
  });

  describe("the validator that actually takes effect", () => {
    it("never runs the v1 body — every replacement after it has both defects fixed, which is why they never surfaced at baseline", async () => {
      // The v1 body ships defective and is superseded inside the same replay,
      // first by 20260922010000 and now by the S-20 migration. Both
      // replacements are checked, so a future one cannot quietly reintroduce
      // either defect by being copied from the wrong ancestor.
      const v1 = statements(validatorBodyFromMigration(V1_MIGRATION));
      expect(v1.some((line) => /[^(]item->'jurisdictions' @>/.test(line))).toBe(true);
      expect(v1.some((line) => line.includes("::timestamptz") && !line.includes("AT TIME ZONE")))
        .toBe(true);

      for (const migration of [V2_MIGRATION, S20_MIGRATION]) {
        assertNoS20Defects(statements(validatorBodyFromMigration(migration)), migration);
      }

      const rows = await db.$queryRawUnsafe<{ src: string }[]>(
        `SELECT prosrc AS src FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`,
        VALIDATOR
      );
      expect(rows).toHaveLength(1);
      const installed = statements(rows[0].src);
      assertNoS20Defects(installed, "the installed function");

      // The installed body is the last migration's, not an earlier one's.
      expect(validatorBodyFromMigration(S20_MIGRATION)).toContain(rows[0].src.trim().slice(0, 200));
      expect(installed.filter((line) => line.includes("AT TIME ZONE 'UTC'"))).toHaveLength(4);
      expect(installed.filter((line) => line.includes("@>"))).toHaveLength(2);
    });

    it("returns true for a valid seven-signer packet, under UTC and under a far-from-UTC session timezone", async () => {
      const { packet, approvedAt } = validPacket();
      expect(packet.approvals).toHaveLength(7);
      expect(await callValidator(VALIDATOR, packet, approvedAt)).toBe(true);
      expect(await callValidator(VALIDATOR, packet, approvedAt, "UTC")).toBe(true);
      expect(await callValidator(VALIDATOR, packet, approvedAt, FAR_TIMEZONE)).toBe(true);
    });

    it("still refuses the packets it is there to refuse", async () => {
      const { approvedAt } = validPacket();

      const expired = validPacket().packet;
      expired.approvals[0].expiresAt = new Date(approvedAt.getTime() - 1_000).toISOString();
      expect(await callValidator(VALIDATOR, expired, approvedAt)).toBe(false);

      const wrongJurisdiction = validPacket().packet;
      wrongJurisdiction.approvals.find(
        (approval) => approval.requirement === "LEGAL_SCOPE"
      )!.jurisdictions = ["A_DIFFERENT_TEST_JURISDICTION"];
      expect(await callValidator(VALIDATOR, wrongJurisdiction, approvedAt)).toBe(false);

      const placeholder = validPacket().packet;
      placeholder.approvals[0].scope = "REQUIRED HUMAN DECISION";
      expect(await callValidator(VALIDATOR, placeholder, approvedAt)).toBe(false);
    });
  });

  describe("SINGLE_SIGNER_ACCOUNTABLE_OWNER", () => {
    it("is the declared mode, and the required set is the one the decision records bind to", () => {
      expect(LIVE_LAUNCH_APPROVAL_MODE).toBe("SINGLE_SIGNER_ACCOUNTABLE_OWNER");
      expect(REQUIRED_APPROVAL_REQUIREMENTS).toEqual(["NUTRITION_PROFESSIONAL"]);
      expect(ALL_APPROVAL_REQUIREMENTS).toHaveLength(7);
    });

    it("accepts a one-signer packet and still accepts the seven-signer packet", async () => {
      const single = validPacket(REQUIRED_APPROVAL_REQUIREMENTS);
      expect(single.packet.approvals).toHaveLength(1);
      expect(single.packet.approvals[0].requirement).toBe("NUTRITION_PROFESSIONAL");
      expect(await callValidator(VALIDATOR, single.packet, single.approvedAt)).toBe(true);
      expect(await callValidator(VALIDATOR, single.packet, single.approvedAt, FAR_TIMEZONE)).toBe(
        true
      );

      const seven = validPacket();
      expect(seven.packet.approvals).toHaveLength(7);
      expect(await callValidator(VALIDATOR, seven.packet, seven.approvedAt)).toBe(true);
    });

    it("refuses a packet with no accountable signature, and one that duplicates it", async () => {
      const { approvedAt } = validPacket();

      const noNutrition = validPacket().packet;
      noNutrition.approvals = noNutrition.approvals.filter(
        (approval) => approval.requirement !== "NUTRITION_PROFESSIONAL"
      );
      expect(noNutrition.approvals).toHaveLength(6);
      expect(await callValidator(VALIDATOR, noNutrition, approvedAt)).toBe(false);

      const empty = validPacket().packet;
      empty.approvals = [];
      expect(await callValidator(VALIDATOR, empty, approvedAt)).toBe(false);

      const duplicated = validPacket(REQUIRED_APPROVAL_REQUIREMENTS).packet;
      duplicated.approvals = [
        duplicated.approvals[0],
        { ...duplicated.approvals[0], approvalId: `${duplicated.approvals[0].approvalId}-dup` },
      ];
      expect(await callValidator(VALIDATOR, duplicated, approvedAt)).toBe(false);
    });

    it("agrees with the TypeScript evaluator on every case, including the optional approvals", async () => {
      const now = new Date();
      const cases: Array<[string, LiveLaunchPacket]> = [];

      cases.push(["one signer", validPacket(REQUIRED_APPROVAL_REQUIREMENTS).packet]);
      cases.push(["seven signers", validPacket().packet]);

      const noNutrition = validPacket().packet;
      noNutrition.approvals = noNutrition.approvals.filter(
        (approval) => approval.requirement !== "NUTRITION_PROFESSIONAL"
      );
      cases.push(["accountable signature removed", noNutrition]);

      // The case the evaluator restructure exists for: LEGAL_SCOPE is no
      // longer *required*, but it is present, and the SQL loop validates
      // every element. Before S-20 the TypeScript side only looked at the
      // required set, so this packet would have been reported ready here and
      // refused by the trigger.
      const staleOptional = validPacket().packet;
      staleOptional.approvals.find((approval) => approval.requirement === "LEGAL_SCOPE")!.expiresAt =
        new Date(now.getTime() - 1_000).toISOString();
      cases.push(["optional LEGAL_SCOPE expired", staleOptional]);

      const unsignedOptional = validPacket().packet;
      unsignedOptional.approvals.find(
        (approval) => approval.requirement === "SLO_AND_SPEND_LIMITS"
      )!.signature!.digest = "b".repeat(64);
      cases.push(["optional SLO_AND_SPEND_LIMITS digest mismatch", unsignedOptional]);

      const wrongJurisdiction = validPacket().packet;
      wrongJurisdiction.approvals.find(
        (approval) => approval.requirement === "LEGAL_SCOPE"
      )!.jurisdictions = ["A_DIFFERENT_TEST_JURISDICTION"];
      cases.push(["optional LEGAL_SCOPE jurisdiction mismatch", wrongJurisdiction]);

      const duplicated = validPacket(REQUIRED_APPROVAL_REQUIREMENTS).packet;
      duplicated.approvals = [
        duplicated.approvals[0],
        { ...duplicated.approvals[0], approvalId: `${duplicated.approvals[0].approvalId}-dup` },
      ];
      cases.push(["duplicate requirement", duplicated]);

      const verdicts: Array<[string, boolean, boolean]> = [];
      for (const [label, packet] of cases) {
        const typescript = evaluateLiveLaunchPacketReadiness(
          packet,
          expectationFor(packet),
          now
        ).ready;
        const sql = await callValidator(VALIDATOR, packet, now);
        verdicts.push([label, typescript, sql]);
      }

      expect(verdicts).toEqual([
        ["one signer", true, true],
        ["seven signers", true, true],
        ["accountable signature removed", false, false],
        ["optional LEGAL_SCOPE expired", false, false],
        ["optional SLO_AND_SPEND_LIMITS digest mismatch", false, false],
        ["optional LEGAL_SCOPE jurisdiction mismatch", false, false],
        ["duplicate requirement", false, false],
      ]);
    });

    it("moves a one-signer packet from DRAFT to APPROVED through the real approval path", async () => {
      // Precondition, named rather than left to surface as a confusing
      // refusal: `approveLiveLaunchPacket` reads the global
      // ARTIFACT_PUBLICATION kill switch, which another file can leave
      // disabled (see ai-coach-grants.test.ts's snapshot/restore comment).
      const control = await db.aiCoachOperationalControl.findUnique({
        where: { scope: "ARTIFACT_PUBLICATION" },
      });
      expect(
        control?.disabled ?? false,
        "ARTIFACT_PUBLICATION is disabled — another suite leaked a kill switch, not an S-20 failure"
      ).toBe(false);

      const suffix = randomUUID();
      const artifacts = buildNonSyntheticLaunchTestArtifacts(suffix);
      const effectiveAt = new Date(Date.now() - 60_000);
      const expiresAt = new Date(Date.now() + 3_600_000);
      for (const artifact of [...artifacts.leaves, artifacts.policy]) {
        await registerArtifactVersion(artifact);
        await publishArtifactVersion({
          id: artifact.id,
          effectiveAt,
          expiresAt,
          engineVersion: "ai-coach-artifact-engine-v1",
        });
      }

      const packet = completeNonTestLaunchPacket({
        suffix,
        artifactBindings: artifacts.references,
        approvalRequirements: REQUIRED_APPROVAL_REQUIREMENTS,
      });
      expect(packet.approvals).toHaveLength(1);
      await registerLiveLaunchPacket(packet);
      await expect(
        db.aiCoachLiveLaunchPacket.findUnique({ where: { id: packet.packetId } })
      ).resolves.toMatchObject({ state: "DRAFT", approvedAt: null });

      const actor = await createTestGovernanceActor(
        ["APPROVE_LIVE_LAUNCH"],
        "s20-single-signer-approver"
      );
      await approveLiveLaunchPacket({
        packetId: packet.packetId,
        actorUserId: actor.id,
        effectiveAt,
        expiresAt,
        reasonCode: "S20_SINGLE_SIGNER_APPROVAL",
        signedApprovalIndexRef: "s20-single-signer-signed-approval-index",
      });

      const approved = await db.aiCoachLiveLaunchPacket.findUnique({
        where: { id: packet.packetId },
      });
      expect(approved).toMatchObject({ state: "APPROVED", testOnly: false, revokedAt: null });
      expect(approved!.approvedAt).toBeInstanceOf(Date);

      await db.aiCoachLiveLaunchLifecycleEvent.deleteMany({ where: { actorUserId: actor.id } });
      await db.aiCoachGovernanceGrant.deleteMany({ where: { userId: actor.id } });
      await db.user.deleteMany({ where: { id: actor.id } });
    });
  });
});
