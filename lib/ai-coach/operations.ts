import { z } from "zod";
import { Prisma, type AiCoachOperationalScope } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { AiCoachError } from "./access";
import type { ActiveAiCoachLiveRelease } from "./live-launch/repository";

export type GovernanceScope =
  | "CONTROL_OPERATIONS"
  | "PUBLISH_ARTIFACTS"
  | "REVOKE_ARTIFACTS"
  | "VIEW_AGGREGATE_MONITORING"
  | "APPROVE_LIVE_LAUNCH"
  | "REVOKE_LIVE_LAUNCH"
  | "ACTIVATE_LIVE_LAUNCH"
  | "DEACTIVATE_LIVE_LAUNCH";

export async function requireGovernanceGrant(
  userId: string,
  scope: GovernanceScope,
  tx: Prisma.TransactionClient | typeof db = db
) {
  const grant = await tx.aiCoachGovernanceGrant.findUnique({
    where: { userId },
    include: { user: { select: { isDeactivated: true } } },
  });
  if (!grant || grant.revokedAt || grant.user.isDeactivated || !grant.scopes.includes(scope)) {
    throw new AiCoachError("FORBIDDEN", "An active AI Coach governance grant is required.", 403);
  }
  return grant;
}

/** A database control can only narrow an already-disabled-by-default flag. */
export async function assertAiCoachOperationEnabled(scope: AiCoachOperationalScope) {
  const control = await db.aiCoachOperationalControl.findUnique({ where: { scope } });
  if (control?.disabled || (process.env.NODE_ENV === "production" && !control)) {
    throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "This AI Coach operation is paused.", 503);
  }
  // A caller, flag, environment value or model output cannot select a packet.
  // Production authority comes only from the one persisted ACTIVE release.
  // T-2000 parity finding P5 considered wrapping this LiveLaunchError the
  // same way runtime-binding.ts does; reverted — this exact call site's raw,
  // specific LiveLaunchError code (e.g. LIVE_ACTIVATION_MISSING) is a
  // pre-existing, deliberate contract other callers/tests already depend on
  // (tests/integration/ai-coach-live-launch-readiness.test.ts "requires the
  // server-selected active release for every production operation"), so
  // wrapping it here would be a regression, not a fix. See T-2000 review
  // round 2 report for the full reasoning.
  if (process.env.NODE_ENV === "production") {
    const { assertActiveAiCoachLiveReleaseReady } = await import("./live-launch/repository");
    await assertActiveAiCoachLiveReleaseReady();
  }
}

export const operationalControlInputSchema = z
  .object({
    scope: z.enum(["GENERATION", "PROVIDER", "FINALIZATION", "ACCEPTANCE", "ARTIFACT_PUBLICATION"]),
    disabled: z.boolean(),
    reasonCode: z.string().trim().min(1).max(120),
    incidentReference: z.string().trim().min(1).max(160).nullable(),
    expectedRevision: z.number().int().nonnegative().nullable(),
  })
  .strict();

const providerMeasurementSchema = z
  .object({
    schemaVersion: z.literal(1),
    attempts: z.number().int().nonnegative(),
    totalLatencyMs: z.number().int().nonnegative(),
    totalRetryDelayMs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    totalSpendMinorUnits: z.number().int().nonnegative().default(0),
  })
  .passthrough();

export async function setAiCoachOperationalControl(actorUserId: string, raw: unknown) {
  const input = operationalControlInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const grant = await requireGovernanceGrant(actorUserId, "CONTROL_OPERATIONS", tx);
    await tx.$queryRaw`SELECT "scope" FROM "AiCoachOperationalControl" WHERE "scope" = ${input.scope}::"AiCoachOperationalScope" FOR UPDATE`;
    const current = await tx.aiCoachOperationalControl.findUnique({
      where: { scope: input.scope },
    });
    if ((current?.revision ?? null) !== input.expectedRevision) {
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "The operational control changed. Reload first.",
        409
      );
    }
    const revision = (current?.revision ?? -1) + 1;
    const control = await tx.aiCoachOperationalControl.upsert({
      where: { scope: input.scope },
      create: {
        scope: input.scope,
        disabled: input.disabled,
        reasonCode: input.reasonCode,
        incidentReference: input.incidentReference,
        updatedByGrantId: grant.id,
        revision,
      },
      update: {
        disabled: input.disabled,
        reasonCode: input.reasonCode,
        incidentReference: input.incidentReference,
        updatedByGrantId: grant.id,
        revision,
      },
    });
    await tx.aiCoachOperationalEvent.create({
      data: {
        actorUserId,
        scope: input.scope,
        disabled: input.disabled,
        reasonCode: input.reasonCode,
        incidentReference: input.incidentReference,
        revision,
      },
    });
    return control;
  });
}

/** Aggregate only: no intake, safety answers, notes, prompts, traces or client IDs. */
export async function getAiCoachOperationalMonitoring(actorUserId: string) {
  await requireGovernanceGrant(actorUserId, "VIEW_AGGREGATE_MONITORING");
  let liveRelease: ActiveAiCoachLiveRelease | null = null;
  try {
    const { assertActiveAiCoachLiveReleaseReady } = await import("./live-launch/repository");
    liveRelease = await assertActiveAiCoachLiveReleaseReady();
  } catch {
    liveRelease = null;
  }
  const windowMinutes =
    liveRelease?.runtimeConfiguration.operations.monitoringWindowMinutes ?? 1_440;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const [
    controls,
    gateOutcomes,
    providerOutcomes,
    providerMeasurementRows,
    activationOutcomes,
    artifactStates,
  ] = await Promise.all([
    db.aiCoachOperationalControl.findMany({ orderBy: { scope: "asc" } }),
    db.aiAutonomyGateDecision.groupBy({
      by: ["outcome"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.aiProviderBoundaryAudit.groupBy({
      by: ["boundaryOutcome", "failureCode"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.aiProviderBoundaryAudit.findMany({
      where: { createdAt: { gte: since }, usage: { not: Prisma.DbNull } },
      select: { usage: true },
    }),
    db.aiPlanActivationAttempt.groupBy({
      by: ["outcome", "reasonCode"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.aiCoachArtifactVersion.groupBy({ by: ["state"], _count: { _all: true } }),
  ]);
  const measurements = providerMeasurementRows.flatMap((row) => {
    const parsed = providerMeasurementSchema.safeParse(row.usage);
    return parsed.success ? [parsed.data] : [];
  });
  const providerMeasurements = measurements.reduce(
    (totals, measurement) => ({
      measuredCalls: totals.measuredCalls + 1,
      attempts: totals.attempts + measurement.attempts,
      totalLatencyMs: totals.totalLatencyMs + measurement.totalLatencyMs,
      totalRetryDelayMs: totals.totalRetryDelayMs + measurement.totalRetryDelayMs,
      inputTokens: totals.inputTokens + measurement.inputTokens,
      outputTokens: totals.outputTokens + measurement.outputTokens,
      totalTokens: totals.totalTokens + measurement.totalTokens,
      totalSpendMinorUnits: totals.totalSpendMinorUnits + measurement.totalSpendMinorUnits,
      maxLatencyMs: Math.max(totals.maxLatencyMs, measurement.totalLatencyMs),
    }),
    {
      measuredCalls: 0,
      attempts: 0,
      totalLatencyMs: 0,
      totalRetryDelayMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalSpendMinorUnits: 0,
      maxLatencyMs: 0,
    }
  );
  const sortedLatencies = measurements
    .map((measurement) => measurement.totalLatencyMs)
    .sort((left, right) => left - right);
  const p95LatencyMs = sortedLatencies.length
    ? sortedLatencies[Math.ceil(sortedLatencies.length * 0.95) - 1]
    : 0;
  const providerCalls = providerOutcomes.reduce((sum, outcome) => sum + outcome._count._all, 0);
  const providerFailures = providerOutcomes
    .filter((outcome) => ["FAIL_CLOSED", "CAUTION"].includes(outcome.boundaryOutcome))
    .reduce((sum, outcome) => sum + outcome._count._all, 0);
  const failureRateBasisPoints = providerCalls
    ? Math.round((providerFailures / providerCalls) * 10_000)
    : 0;
  const limits = liveRelease?.runtimeConfiguration.operations;
  const alertBreaches = limits
    ? [
        p95LatencyMs > limits.maximumP95LatencyMs ? "PROVIDER_P95_LATENCY" : null,
        failureRateBasisPoints > limits.maximumFailureRateBasisPoints
          ? "PROVIDER_FAILURE_RATE"
          : null,
        providerMeasurements.totalTokens > limits.maximumTokensPerWindow
          ? "PROVIDER_TOKEN_SPEND"
          : null,
        providerMeasurements.totalSpendMinorUnits > limits.maximumSpendMinorUnitsPerWindow
          ? "PROVIDER_COST_SPEND"
          : null,
      ].filter((value): value is string => value !== null)
    : [];
  return {
    schemaVersion: 1 as const,
    window: { startsAt: since.toISOString(), endsAt: new Date().toISOString() },
    controls,
    gateOutcomes,
    providerOutcomes,
    providerMeasurements: { ...providerMeasurements, p95LatencyMs, failureRateBasisPoints },
    liveRelease: liveRelease
      ? {
          status: "READY" as const,
          releaseId: liveRelease.releaseId,
          packetDigest: liveRelease.packetDigest,
          runtimeConfigurationDigest: liveRelease.runtimeConfigurationDigest,
          expiresAt: liveRelease.expiresAt.toISOString(),
          operationalOwnerRecordId:
            liveRelease.runtimeConfiguration.operations.operationalOwnerRecordId,
        }
      : { status: "BLOCKED" as const },
    alerts: {
      configured: Boolean(limits),
      status: !limits
        ? ("BLOCKED" as const)
        : alertBreaches.length
          ? ("BREACH" as const)
          : ("OK" as const),
      breachCodes: alertBreaches,
    },
    activationOutcomes,
    artifactStates,
  };
}
