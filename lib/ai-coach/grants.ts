import { z } from "zod";
import { db } from "@/lib/db";
import { AiCoachError, lockAiClientRows, requireFixtureRuntime } from "./access";
import { GOVERNANCE_SCOPES, requireGovernanceGrant, type GovernanceScope } from "./operations";
import { assertActiveAiCoachLiveReleaseReadyInTransaction } from "./live-launch/repository";

// T-995 — the sole writer for AiCoachGovernanceGrant, AiCoachReviewerGrant
// and AiCoachEntitlement. CLI-only (scripts/bootstrap-ai-coach-governance.ts,
// scripts/manage-ai-coach-grants.ts); there is deliberately no HTTP route.
// Every function runs entirely inside one db.$transaction, writes exactly one
// AiCoachAccessGrantEvent row after the grant row on success, and writes
// nothing on refusal.

export { GOVERNANCE_SCOPES } from "./operations";

export type GrantActionResult = {
  grantType: "GOVERNANCE" | "REVIEWER" | "ENTITLEMENT";
  action: "BOOTSTRAP" | "GRANT" | "REVOKE";
  grantRecordId: string;
  subjectUserId: string;
  auditEventId: string;
  scopes: string[];
  domains: string[];
  clientIds: string[];
  expiresAt: string | null;
  grantedAt: string;
  revokedAt: string | null;
};

const DOMAINS = ["NUTRITION", "STRENGTH", "CARDIO"] as const;

const actorRef = z.string().trim().min(1).max(200);
const reasonCode = z.string().trim().min(1).max(120);
const grantRefField = z.string().trim().min(1).max(200);
const qualificationNote = z.string().trim().min(1).max(2000);
const idField = z.string().trim().min(1).max(120);

const scopesField = z
  .array(z.enum([...GOVERNANCE_SCOPES] as [GovernanceScope, ...GovernanceScope[]]))
  .min(1)
  .refine((v) => new Set(v).size === v.length, { message: "Duplicate scope." });

const domainsField = z
  .array(z.enum(DOMAINS))
  .min(1)
  .refine((v) => new Set(v).size === v.length, { message: "Duplicate domain." });

const clientIdsField = z
  .array(idField)
  .min(1)
  .refine((v) => new Set(v).size === v.length, { message: "Duplicate client id." });

const futureDate = z
  .date()
  .refine((d) => !Number.isNaN(d.getTime()), { message: "Invalid date." })
  .refine((d) => d.getTime() > Date.now(), { message: "expiresAt must be in the future." });

const bootstrapGovernanceGrantSchema = z
  .object({
    userId: idField,
    grantRef: grantRefField,
    actorRef,
    reasonCode,
    confirmBootstrap: z.literal(true),
  })
  .strict();

const grantGovernanceGrantSchema = z
  .object({
    actorUserId: idField,
    userId: idField,
    scopes: scopesField,
    grantRef: grantRefField,
    actorRef,
    reasonCode,
  })
  .strict();

const revokeGovernanceGrantSchema = z
  .object({
    actorUserId: idField,
    userId: idField,
    actorRef,
    reasonCode,
  })
  .strict();

const grantReviewerGrantSchema = z
  .object({
    actorUserId: idField,
    userId: idField,
    clientIds: clientIdsField,
    domains: domainsField,
    qualificationNote,
    actorRef,
    reasonCode,
  })
  .strict();

const revokeReviewerGrantSchema = z
  .object({
    actorUserId: idField,
    userId: idField,
    actorRef,
    reasonCode,
  })
  .strict();

const grantClientEntitlementSchema = z
  .object({
    actorUserId: idField,
    clientId: idField,
    expiresAt: futureDate.nullable(),
    actorRef,
    reasonCode,
  })
  .strict();

const revokeClientEntitlementSchema = z
  .object({
    actorUserId: idField,
    clientId: idField,
    actorRef,
    reasonCode,
  })
  .strict();

function toResult(args: {
  grantType: GrantActionResult["grantType"];
  action: GrantActionResult["action"];
  grantRecordId: string;
  subjectUserId: string;
  auditEventId: string;
  scopes?: string[];
  domains?: string[];
  clientIds?: string[];
  expiresAt?: Date | null;
  grantedAt: Date;
  revokedAt: Date | null;
}): GrantActionResult {
  return {
    grantType: args.grantType,
    action: args.action,
    grantRecordId: args.grantRecordId,
    subjectUserId: args.subjectUserId,
    auditEventId: args.auditEventId,
    scopes: args.scopes ?? [],
    domains: args.domains ?? [],
    clientIds: args.clientIds ?? [],
    expiresAt: args.expiresAt ? args.expiresAt.toISOString() : null,
    grantedAt: args.grantedAt.toISOString(),
    revokedAt: args.revokedAt ? args.revokedAt.toISOString() : null,
  };
}

/** Every refusal from an input schema is a single `AiCoachError("VALIDATION_ERROR", ..., 422)` — never a raw ZodError. */
function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AiCoachError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid input.",
      422
    );
  }
  return parsed.data;
}

/**
 * The once-ever root grant. Refuses unless no `AiCoachGovernanceGrant` row
 * exists at all (revoked included), under an advisory lock. There is no
 * `--scopes` argument: the bootstrap grant always receives all eight scopes.
 */
export async function bootstrapGovernanceGrant(input: {
  userId: string;
  grantRef: string;
  actorRef: string;
  reasonCode: string;
  confirmBootstrap: true;
}): Promise<GrantActionResult> {
  const parsed = bootstrapGovernanceGrantSchema.safeParse(input);
  if (!parsed.success) {
    const confirmationIssue = parsed.error.issues.some((i) => i.path[0] === "confirmBootstrap");
    if (confirmationIssue) {
      throw new AiCoachError(
        "CONFIRMATION_REQUIRED",
        "Bootstrap requires --confirm-bootstrap.",
        422
      );
    }
    throw new AiCoachError("VALIDATION_ERROR", "Invalid bootstrap input.", 422);
  }
  const data = parsed.data;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('steadfast.ai_coach.governance_grants'))::text`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: data.userId },
      select: { id: true, isDeactivated: true },
    });
    if (!user) throw new AiCoachError("NOT_FOUND", "The subject user does not exist.", 404);
    if (user.isDeactivated)
      throw new AiCoachError("FORBIDDEN", "A deactivated account cannot hold a grant.", 403);
    const existingCount = await tx.aiCoachGovernanceGrant.count();
    if (existingCount > 0)
      throw new AiCoachError(
        "ALREADY_BOOTSTRAPPED",
        "A governance grant already exists; bootstrap can only run once.",
        409
      );
    const allScopes = [...GOVERNANCE_SCOPES];
    const grant = await tx.aiCoachGovernanceGrant.create({
      data: { userId: data.userId, scopes: allScopes, grantRef: data.grantRef },
    });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.userId,
        subjectUserId: data.userId,
        governanceGrantId: grant.id,
        grantType: "GOVERNANCE",
        action: "BOOTSTRAP",
        grantRecordId: grant.id,
        scopes: allScopes,
        grantRef: data.grantRef,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "GOVERNANCE",
      action: "BOOTSTRAP",
      grantRecordId: grant.id,
      subjectUserId: data.userId,
      auditEventId: event.id,
      scopes: allScopes,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  });
}

export async function grantGovernanceGrant(input: {
  actorUserId: string;
  userId: string;
  scopes: GovernanceScope[];
  grantRef: string;
  actorRef: string;
  reasonCode: string;
}): Promise<GrantActionResult> {
  const data = parseInput(grantGovernanceGrantSchema, input);
  return db.$transaction(async (tx) => {
    // T-995 r2 MINOR 4 — the advisory lock must be acquired before reading the
    // actor's own authority, not after: acquiring it first guarantees no other
    // governance grant/revoke transaction can commit a change to any governance
    // row (including the actor's own) between this read and this transaction's
    // commit, closing the TOCTOU the review found.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('steadfast.ai_coach.governance_grants'))::text`;
    const actorGrant = await requireGovernanceGrant(data.actorUserId, "CONTROL_OPERATIONS", tx);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: data.userId },
      select: { id: true, isDeactivated: true },
    });
    if (!user) throw new AiCoachError("NOT_FOUND", "The subject user does not exist.", 404);
    if (user.isDeactivated)
      throw new AiCoachError("FORBIDDEN", "A deactivated account cannot hold a grant.", 403);
    await tx.$queryRaw`SELECT "id" FROM "AiCoachGovernanceGrant" WHERE "userId" = ${data.userId} FOR UPDATE`;
    const existing = await tx.aiCoachGovernanceGrant.findUnique({ where: { userId: data.userId } });
    if (existing && !existing.revokedAt)
      throw new AiCoachError(
        "ALREADY_GRANTED",
        "An active governance grant already exists for this user.",
        409
      );
    const grant = existing
      ? await tx.aiCoachGovernanceGrant.update({
          where: { userId: data.userId },
          data: {
            scopes: data.scopes,
            grantRef: data.grantRef,
            grantedAt: new Date(),
            revokedAt: null,
          },
        })
      : await tx.aiCoachGovernanceGrant.create({
          data: { userId: data.userId, scopes: data.scopes, grantRef: data.grantRef },
        });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.actorUserId,
        subjectUserId: data.userId,
        governanceGrantId: actorGrant.id,
        grantType: "GOVERNANCE",
        action: "GRANT",
        grantRecordId: grant.id,
        scopes: data.scopes,
        grantRef: data.grantRef,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "GOVERNANCE",
      action: "GRANT",
      grantRecordId: grant.id,
      subjectUserId: data.userId,
      auditEventId: event.id,
      scopes: data.scopes,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  });
}

export async function revokeGovernanceGrant(input: {
  actorUserId: string;
  userId: string;
  actorRef: string;
  reasonCode: string;
}): Promise<GrantActionResult> {
  const data = parseInput(revokeGovernanceGrantSchema, input);
  return db.$transaction(async (tx) => {
    // T-995 r2 MINOR 4 — advisory lock before reading actor authority; see
    // grantGovernanceGrant for the full reasoning.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('steadfast.ai_coach.governance_grants'))::text`;
    const actorGrant = await requireGovernanceGrant(data.actorUserId, "CONTROL_OPERATIONS", tx);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "AiCoachGovernanceGrant" WHERE "userId" = ${data.userId} FOR UPDATE`;
    const existing = await tx.aiCoachGovernanceGrant.findUnique({ where: { userId: data.userId } });
    if (!existing)
      throw new AiCoachError("NOT_FOUND", "No governance grant exists for this user.", 404);
    if (existing.revokedAt)
      throw new AiCoachError("ALREADY_REVOKED", "This governance grant is already revoked.", 409);
    if (existing.scopes.includes("CONTROL_OPERATIONS")) {
      // T-995 r2 MAJOR 1 — count only *usable* CONTROL_OPERATIONS grants, the
      // same predicate requireGovernanceGrant reads (operations.ts:24-31): a
      // deactivated holder's grant is not a repairable authority, so it must
      // not count as "another" holder that makes this revoke safe.
      const remaining = await tx.aiCoachGovernanceGrant.count({
        where: {
          revokedAt: null,
          scopes: { has: "CONTROL_OPERATIONS" },
          userId: { not: data.userId },
          user: { isDeactivated: false },
        },
      });
      if (remaining === 0)
        throw new AiCoachError(
          "LAST_CONTROL_GRANT",
          "Refusing to remove the last CONTROL_OPERATIONS grant.",
          409
        );
    }
    const grant = await tx.aiCoachGovernanceGrant.update({
      where: { userId: data.userId },
      data: { revokedAt: new Date() },
    });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.actorUserId,
        subjectUserId: data.userId,
        governanceGrantId: actorGrant.id,
        grantType: "GOVERNANCE",
        action: "REVOKE",
        grantRecordId: grant.id,
        scopes: existing.scopes,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "GOVERNANCE",
      action: "REVOKE",
      grantRecordId: grant.id,
      subjectUserId: data.userId,
      auditEventId: event.id,
      scopes: existing.scopes,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  });
}

export async function grantReviewerGrant(input: {
  actorUserId: string;
  userId: string;
  clientIds: string[];
  domains: ("NUTRITION" | "STRENGTH" | "CARDIO")[];
  qualificationNote: string;
  actorRef: string;
  reasonCode: string;
}): Promise<GrantActionResult> {
  const data = parseInput(grantReviewerGrantSchema, input);
  if (data.clientIds.includes(data.userId))
    throw new AiCoachError("FORBIDDEN", "A reviewer cannot be assigned to review themselves.", 403);
  return db.$transaction(async (tx) => {
    // T-995 r2 MINOR 4 — lock the actor's own User row before reading their
    // authority, so a concurrent grant-governance/revoke-governance call
    // naming this same actor cannot commit between this read and this
    // transaction's commit. There is no advisory lock on this path (only the
    // governance ops share one), so this row lock is the sole serializer.
    // Deliberately `User`, not `AiCoachGovernanceGrant`: every
    // grant/revoke-governance call already locks the *subject*'s `User` row
    // before its `AiCoachGovernanceGrant` row (in that order); an earlier
    // version of this fix locked `AiCoachGovernanceGrant` here instead and
    // reproduced a genuine `deadlock detected` (40P01) under
    // `tests/integration/ai-coach-grants.test.ts`'s revoke-then-grant race
    // test — two transactions taking the same two resources in reversed
    // order. Locking `User` here keeps every path's lock order consistent:
    // `User(actor/subject)` always precedes `AiCoachGovernanceGrant(subject)`.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.actorUserId} FOR UPDATE`;
    const actorGrant = await requireGovernanceGrant(data.actorUserId, "CONTROL_OPERATIONS", tx);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    const reviewer = await tx.user.findUnique({
      where: { id: data.userId },
      select: { id: true, isDeactivated: true },
    });
    if (!reviewer) throw new AiCoachError("NOT_FOUND", "The reviewer user does not exist.", 404);
    if (reviewer.isDeactivated)
      throw new AiCoachError("FORBIDDEN", "A deactivated account cannot hold a grant.", 403);
    const sortedClientIds = [...data.clientIds].sort();
    for (const clientId of sortedClientIds) {
      await lockAiClientRows(tx, clientId);
      const clientUser = await tx.user.findUnique({
        where: { id: clientId },
        select: { isClient: true, isDeactivated: true },
      });
      if (!clientUser) throw new AiCoachError("NOT_FOUND", "An assigned client does not exist.", 404);
      if (clientUser.isDeactivated)
        throw new AiCoachError("FORBIDDEN", "An assigned client account is deactivated.", 403);
      if (!clientUser.isClient)
        throw new AiCoachError("FORBIDDEN", "An assigned client is not a client account.", 403);
      // T-995 r2 MAJOR 2 — relaxed from "mode !== AI" (refusal row 13 as
      // originally frozen) to "mode === HUMAN or resolutionRequired" only.
      // A real client cannot reach mode AI until T-2000 removes
      // requireReviewerCapacity from ENROLL (client-commands.ts:189), which
      // itself requires a reviewer grant to already exist for a non-synthetic
      // profile — the original row-13 wording made grant-reviewer unusable
      // for the exact "first real client" case the ticket exists to unblock.
      // A NONE-mode (pre-enrollment, including no context row at all) client
      // is harmless to name in a reviewer grant under bounded autonomy: no
      // reviewer consumer (reviewer.ts, safety-resolution.ts,
      // reviewer-operations.ts) reads anything for a client until that
      // client has a PROPOSED plan or a safety disposition, neither of which
      // exists before enrollment.
      const context = await tx.clientCoachingContext.findUnique({ where: { clientId } });
      if (context?.mode === "HUMAN" || context?.resolutionRequired)
        throw new AiCoachError(
          "REVISION_CONFLICT",
          "An assigned client has an active human coaching relationship or requires resolution.",
          409
        );
    }
    await tx.$queryRaw`SELECT "id" FROM "AiCoachReviewerGrant" WHERE "userId" = ${data.userId} FOR UPDATE`;
    const existing = await tx.aiCoachReviewerGrant.findUnique({ where: { userId: data.userId } });
    if (existing && !existing.revokedAt)
      throw new AiCoachError(
        "ALREADY_GRANTED",
        "An active reviewer grant already exists for this user.",
        409
      );
    const grant = existing
      ? await tx.aiCoachReviewerGrant.update({
          where: { userId: data.userId },
          data: {
            clientIds: data.clientIds,
            domains: data.domains,
            qualificationNote: data.qualificationNote,
            grantedBy: data.actorUserId,
            grantedAt: new Date(),
            revokedAt: null,
          },
        })
      : await tx.aiCoachReviewerGrant.create({
          data: {
            userId: data.userId,
            clientIds: data.clientIds,
            domains: data.domains,
            qualificationNote: data.qualificationNote,
            grantedBy: data.actorUserId,
          },
        });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.actorUserId,
        subjectUserId: data.userId,
        governanceGrantId: actorGrant.id,
        grantType: "REVIEWER",
        action: "GRANT",
        grantRecordId: grant.id,
        domains: data.domains,
        clientIds: data.clientIds,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "REVIEWER",
      action: "GRANT",
      grantRecordId: grant.id,
      subjectUserId: data.userId,
      auditEventId: event.id,
      domains: data.domains,
      clientIds: data.clientIds,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  });
}

export async function revokeReviewerGrant(input: {
  actorUserId: string;
  userId: string;
  actorRef: string;
  reasonCode: string;
}): Promise<GrantActionResult> {
  const data = parseInput(revokeReviewerGrantSchema, input);
  return db.$transaction(async (tx) => {
    // T-995 r2 MINOR 4 — lock the actor's own User row first; see
    // grantReviewerGrant for the full reasoning (including why this is
    // `User`, not `AiCoachGovernanceGrant`).
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.actorUserId} FOR UPDATE`;
    const actorGrant = await requireGovernanceGrant(data.actorUserId, "CONTROL_OPERATIONS", tx);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "AiCoachReviewerGrant" WHERE "userId" = ${data.userId} FOR UPDATE`;
    const existing = await tx.aiCoachReviewerGrant.findUnique({ where: { userId: data.userId } });
    if (!existing)
      throw new AiCoachError("NOT_FOUND", "No reviewer grant exists for this user.", 404);
    if (existing.revokedAt)
      throw new AiCoachError("ALREADY_REVOKED", "This reviewer grant is already revoked.", 409);
    const grant = await tx.aiCoachReviewerGrant.update({
      where: { userId: data.userId },
      data: { revokedAt: new Date() },
    });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.actorUserId,
        subjectUserId: data.userId,
        governanceGrantId: actorGrant.id,
        grantType: "REVIEWER",
        action: "REVOKE",
        grantRecordId: grant.id,
        domains: existing.domains,
        clientIds: existing.clientIds,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "REVIEWER",
      action: "REVOKE",
      grantRecordId: grant.id,
      subjectUserId: data.userId,
      auditEventId: event.id,
      domains: existing.domains,
      clientIds: existing.clientIds,
      grantedAt: grant.grantedAt,
      revokedAt: grant.revokedAt,
    });
  });
}

/**
 * Grants the entitlement — the invitation `discovery.ts` reads. Reads no
 * `AiCoachReviewerGrant` row and calls no reviewer function (T-2000, Jaden
 * 2026-09-24). Rows 15-18 of the refusal matrix are evaluated in the exact
 * order `lockAiClient` (access.ts:32-46) applies them, so a row this command
 * writes can never be one the runtime then refuses.
 */
export async function grantClientEntitlement(input: {
  actorUserId: string;
  clientId: string;
  expiresAt: Date | null;
  actorRef: string;
  reasonCode: string;
}): Promise<GrantActionResult> {
  const data = parseInput(grantClientEntitlementSchema, input);
  return db.$transaction(async (tx) => {
    // T-995 r2 MINOR 4 — lock the actor's own User row first; see
    // grantReviewerGrant for the full reasoning (including why this is
    // `User`, not `AiCoachGovernanceGrant`). This is the fix for the exact
    // scenario the review named and the revoke-then-grant race test proves:
    // a concurrent revoke-governance on this actor can no longer commit
    // between this read and this transaction's commit.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.actorUserId} FOR UPDATE`;
    const actorGrant = await requireGovernanceGrant(data.actorUserId, "CONTROL_OPERATIONS", tx);
    await lockAiClientRows(tx, data.clientId);
    const user = await tx.user.findUnique({
      where: { id: data.clientId },
      select: { isClient: true, isDeactivated: true },
    });
    if (!user) throw new AiCoachError("NOT_FOUND", "The client does not exist.", 404);
    if (user.isDeactivated)
      throw new AiCoachError("FORBIDDEN", "A deactivated account cannot hold an entitlement.", 403);
    if (!user.isClient)
      throw new AiCoachError("FORBIDDEN", "The subject is not a client account.", 403);
    // Rows 15-18, same order as lockAiClient (access.ts:32-46).
    const profile = await tx.aiCoachProfile.findUnique({ where: { clientId: data.clientId } });
    if (!profile) throw new AiCoachError("FORBIDDEN", "An AI Coach profile is required.", 403);
    if (profile.isSynthetic) {
      requireFixtureRuntime();
    } else {
      await assertActiveAiCoachLiveReleaseReadyInTransaction(tx);
    }
    const context = await tx.clientCoachingContext.findUnique({ where: { clientId: data.clientId } });
    if (context?.resolutionRequired || context?.mode === "HUMAN")
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "Your coaching provider has changed. Refresh to continue."
      );
    // T-995 r2 MINOR 6 — deliberate deviation from refusal row 9 as originally
    // frozen ("grant-* refuses when a non-revoked row exists"): an
    // expired-but-not-revoked entitlement is treated as inactive and
    // silently re-activated in place, matching how `access.ts:47-52` and
    // `client-provider.ts:19` already treat an expired entitlement as no
    // entitlement at all. Refusing here would leave an expired invitation
    // unrenewable without first revoking it, which no other read path
    // requires.
    const existing = await tx.aiCoachEntitlement.findUnique({ where: { clientId: data.clientId } });
    const existingActive =
      existing && !existing.revokedAt && !(existing.expiresAt && existing.expiresAt <= new Date());
    if (existingActive)
      throw new AiCoachError(
        "ALREADY_GRANTED",
        "An active entitlement already exists for this client.",
        409
      );
    const entitlement = existing
      ? await tx.aiCoachEntitlement.update({
          where: { clientId: data.clientId },
          data: {
            grantedBy: data.actorUserId,
            grantedAt: new Date(),
            expiresAt: data.expiresAt,
            revokedAt: null,
          },
        })
      : await tx.aiCoachEntitlement.create({
          data: { clientId: data.clientId, grantedBy: data.actorUserId, expiresAt: data.expiresAt },
        });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.actorUserId,
        subjectUserId: data.clientId,
        governanceGrantId: actorGrant.id,
        grantType: "ENTITLEMENT",
        action: "GRANT",
        grantRecordId: entitlement.id,
        expiresAt: data.expiresAt,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "ENTITLEMENT",
      action: "GRANT",
      grantRecordId: entitlement.id,
      subjectUserId: data.clientId,
      auditEventId: event.id,
      expiresAt: entitlement.expiresAt,
      grantedAt: entitlement.grantedAt,
      revokedAt: entitlement.revokedAt,
    });
  });
}

export async function revokeClientEntitlement(input: {
  actorUserId: string;
  clientId: string;
  actorRef: string;
  reasonCode: string;
}): Promise<GrantActionResult> {
  const data = parseInput(revokeClientEntitlementSchema, input);
  return db.$transaction(async (tx) => {
    // T-995 r2 MINOR 4 — lock the actor's own User row first; see
    // grantReviewerGrant for the full reasoning (including why this is
    // `User`, not `AiCoachGovernanceGrant`).
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${data.actorUserId} FOR UPDATE`;
    const actorGrant = await requireGovernanceGrant(data.actorUserId, "CONTROL_OPERATIONS", tx);
    await lockAiClientRows(tx, data.clientId);
    const existing = await tx.aiCoachEntitlement.findUnique({ where: { clientId: data.clientId } });
    if (!existing)
      throw new AiCoachError("NOT_FOUND", "No entitlement exists for this client.", 404);
    if (existing.revokedAt)
      throw new AiCoachError("ALREADY_REVOKED", "This entitlement is already revoked.", 409);
    const entitlement = await tx.aiCoachEntitlement.update({
      where: { clientId: data.clientId },
      data: { revokedAt: new Date() },
    });
    const event = await tx.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: data.actorUserId,
        subjectUserId: data.clientId,
        governanceGrantId: actorGrant.id,
        grantType: "ENTITLEMENT",
        action: "REVOKE",
        grantRecordId: entitlement.id,
        expiresAt: existing.expiresAt,
        actorRef: data.actorRef,
        reasonCode: data.reasonCode,
      },
    });
    return toResult({
      grantType: "ENTITLEMENT",
      action: "REVOKE",
      grantRecordId: entitlement.id,
      subjectUserId: data.clientId,
      auditEventId: event.id,
      expiresAt: entitlement.expiresAt,
      grantedAt: entitlement.grantedAt,
      revokedAt: entitlement.revokedAt,
    });
  });
}
