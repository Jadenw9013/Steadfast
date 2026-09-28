import { collectEvidence, evidenceSnapshotSchema } from "./evidence-snapshot";
import { z } from "zod";
import { substitutionSchema } from "./representation";
import { db } from "@/lib/db";
import { intakeAnswersSchema } from "./intake";
import {
  cardioSessionSchema,
  planPayloadSchema,
  quantitiesSchema,
  sourceRefSchema,
  strengthSessionSchema,
  type PlanPayload,
} from "./plan-contract";
import { contentHash } from "./canonical-json";
import { reviewWindow } from "./review-window";
// T-2041: these three constants are no longer the *writer* of the snapshot's
// binding — `resolveRuntimeArtifactSet` is. They stay because the
// `superRefine` below still needs them to hold a legacy (unbound) snapshot to
// exactly today's strictness.
import { ACTIVE_POLICY_VERSION } from "./policy/policy-version";
import { FOOD_CATALOG_VERSION } from "./catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "./catalog/exercise-catalog";
import {
  resolveAiCoachRuntimeBinding,
  resolveRuntimeArtifactSet,
  resolvedRuntimeArtifactSetSchema,
  type ResolvedRuntimeArtifactSet,
} from "./runtime-binding";
import {
  ArtifactLoadError,
  getReviewedPolicyBundleContent,
  loadRunBoundArtifactSet,
  type ReviewedArtifactSet,
} from "./artifacts/repository";
import { escalationTemplatesContentSchema, exerciseCatalogContentSchema } from "./artifacts/schema";
import {
  resolvedWeeklyParametersSchema,
  resolveWeeklyParameters,
  type ResolvedWeeklyParameters,
  type WeeklyReasonCode,
} from "./weekly-parameters";
import { resolvePrescriptionParametersForArtifacts } from "./prescription-binding";
import { buildPrescriptionInput, computePrescription } from "./prescription";
import { resolveTrainingParameters } from "./training/parameters";
import { composeTraining } from "./training";
import { trainingCatalogSourceFromArtifactContent } from "./training/catalog-source";
import { reportAnomaly } from "@/lib/observability/report";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
import { AiCoachError, jsonValue, lockAiClient } from "./access";
import { assertAiCoachOperationEnabled } from "./operations";

export const runCommandSchema = z
  .object({
    substitution: substitutionSchema.optional(),
    requestKey: z.string().uuid(),
    kind: z.enum(["INITIAL", "WEEKLY_REVIEW", "REPRESENTATION"]),
    representation: z.enum(["MACROS", "MEALS"]),
    expectedContextRevision: z.number().int().nonnegative(),
    expectedProfileRevision: z.number().int().nonnegative(),
  })
  .strict();

const weeklyPolicySnapshotSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("RESOLVED"),
      sourceArtifact: z
        .object({
          id: z.string().min(1),
          kind: z.literal("POLICY_BUNDLE"),
          artifactKey: z.string().min(1),
          version: z.number().int().positive(),
          digest: z.string().length(64),
          engineVersion: z.string().min(1),
        })
        .strict(),
      parameters: resolvedWeeklyParametersSchema,
      parameterSetDigest: z.string().length(64),
      energyReestimate: z
        .object({
          weightKg: z.number().positive().finite(),
          weightMeasuredOn: z.string(),
          targets: quantitiesSchema,
        })
        .strict()
        .nullable(),
      simplifiedTraining: z
        .object({
          strength: z.array(strengthSessionSchema).max(7),
          cardio: z.array(cardioSessionSchema).max(7),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      reasonCodes: z.array(z.string().min(1).max(120)).min(1).max(20),
      missingParameterIds: z.array(z.string().min(1).max(160)).max(200),
    })
    .strict(),
]);
export const runSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    // T-2041: the four values below were `z.literal(...)` of the compile-time
    // fixture constants. They are **widened in place, not removed** — the
    // object is `.strict()`, so deleting them would make every stored
    // snapshot fail to parse with "Unrecognized key", and widening a literal
    // does not change the parse *output* for a stored value, so `contentHash`
    // is byte-identical for every row written before this change. The
    // `superRefine` below restores exactly today's strictness whenever there
    // is no `runtimeBinding`.
    synthetic: z.boolean(),
    intake: intakeAnswersSchema,
    policyVersion: z.string().min(1).max(120),
    catalogVersions: z
      .object({
        food: z.string().min(1).max(120),
        exercise: z.string().min(1).max(120),
      })
      .strict(),
    modelConfiguration: z.string().min(1).max(120),
    baseVersionId: z.string().nullable(),
    basePayload: planPayloadSchema.nullable(),
    representation: z.enum(["MACROS", "MEALS"]),
    reviewWindowKey: z.string(),
    reviewTimezone: z.string(),
    lastSafetyResolutionAt: z.string().datetime().nullable().optional(),
    sourceRefs: z.array(sourceRefSchema).max(2180),
    evidence: evidenceSnapshotSchema.default({ observations: [], sessions: [] }),
    history: z
      .array(
        z
          .object({
            id: z.string(),
            acceptedAt: z.string().datetime(),
            changeClass: z.string().nullable(),
            reviewWindowKey: z.string().nullable(),
            payload: planPayloadSchema,
          })
          .strict()
      )
      .max(500)
      .default([]),
    substitution: substitutionSchema.nullable().default(null),
    /**
     * T-2041 — the runtime artifact set resolved once, at `requestAiRun`, and
     * frozen for the life of the run.
     *
     * `.optional()` and **never** `.default()`. A default would materialise a
     * key that is absent in stored JSON and break three hashes at once:
     * `AiCoachRun.businessKey` (hashed from the parsed snapshot below, so
     * dedup would reshard for rows that already exist),
     * `AiPlanVersion.validationReport.inputHash` (`managed-executor.ts`),
     * which `weekly-proof.ts` compares against a fresh `contentHash` — every
     * existing weekly candidate would become un-acceptable — and
     * `retry-command.ts`, which re-stores the parsed snapshot and would write
     * the injected default permanently into a legacy row.
     */
    runtimeBinding: resolvedRuntimeArtifactSetSchema.optional(),
    /** Weekly decisions consume this frozen block only. Optional without a
     * default so historical snapshots retain their exact hashes. */
    weeklyPolicy: weeklyPolicySnapshotSchema.optional(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    // A **mixed** snapshot is unrepresentable. With no binding the four
    // top-level values must be exactly today's fixture constants (this is
    // precisely the strictness the four `z.literal`s used to enforce, so no
    // stored row changes verdict); with a binding they must equal the
    // binding's, whose own schema already requires one exact artifact
    // reference per kind carrying the very keys it claims. That is what lets
    // `generationBindingFromSnapshot` read a legacy snapshot's own four
    // fields as the fixture binding without consulting a constant.
    const expected = snapshot.runtimeBinding ?? {
      synthetic: true,
      policyVersion: ACTIVE_POLICY_VERSION,
      catalogVersions: { food: FOOD_CATALOG_VERSION, exercise: EXERCISE_CATALOG_VERSION },
      modelConfiguration: "synthetic-template-v1",
    };
    const mismatches: [path: (string | number)[], ok: boolean][] = [
      [["synthetic"], snapshot.synthetic === expected.synthetic],
      [["policyVersion"], snapshot.policyVersion === expected.policyVersion],
      [
        ["catalogVersions", "food"],
        snapshot.catalogVersions.food === expected.catalogVersions.food,
      ],
      [
        ["catalogVersions", "exercise"],
        snapshot.catalogVersions.exercise === expected.catalogVersions.exercise,
      ],
      [["modelConfiguration"], snapshot.modelConfiguration === expected.modelConfiguration],
    ];
    for (const [path, ok] of mismatches) {
      if (ok) continue;
      ctx.addIssue({
        code: "custom",
        path,
        message: snapshot.runtimeBinding
          ? "A run snapshot must agree with its own frozen runtime binding."
          : "An unbound run snapshot must carry exactly the fixture runtime constants.",
      });
    }
  });
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

/**
 * T-2041 — resolves the runtime artifact set a new run will be frozen to.
 *
 * Returns the resolved set, or the error that must be raised once the
 * transaction has run its existing checks, or neither.
 *
 * **The one degrade, and its blast radius.** A FIXTURE binding whose
 * synthetic artifact set is simply not present in this environment
 * (`ARTIFACT_MISSING` / `ARTIFACT_NOT_EFFECTIVE`) does not fail the request:
 * the snapshot is written in the legacy unbound shape, exactly as every run
 * written before this ticket, and `generationBindingFromSnapshot` reads the
 * fixture binding back off the snapshot's own four fields. That keeps an
 * existing synthetic run byte-identical (T-2022's acceptance criterion) in a
 * dev or test database that never published the fixture artifacts.
 *
 * It can never apply to a real account. The branch is gated on
 * `binding.mode === "FIXTURE"` — the resolver's own verdict, not a re-read of
 * the profile flag — and:
 *  - a FIXTURE binding is only ever returned for a synthetic profile, and only
 *    after `requireFixtureRuntime()`, which refuses production and refuses a
 *    missing `AI_COACH_FIXTURE_MODE`;
 *  - a LIVE binding needs an ACTIVE release, and every failure on that path —
 *    including a missing, revoked, expired or reclassified artifact — is
 *    raised, so a real client's run is never written unbound.
 * Any other `ArtifactLoadError`, on either branch, is raised too: a fixture
 * set that exists but is corrupt, incompatible or revoked is a real fault.
 */
async function resolveRunRuntimeBinding(clientId: string): Promise<{
  runtime: ResolvedRuntimeArtifactSet | null;
  runtimeError: unknown;
  profileClass: { isSynthetic: boolean } | null;
}> {
  const profileClass = await db.aiCoachProfile.findUnique({
    where: { clientId },
    select: { isSynthetic: true },
  });
  // No profile: `lockAiClient` already raises FORBIDDEN 403 for this, in the
  // transaction, in its existing position. Nothing is pre-empted here.
  if (!profileClass) return { runtime: null, runtimeError: null, profileClass: null };
  let binding;
  try {
    binding = await resolveAiCoachRuntimeBinding(null, profileClass);
  } catch (err) {
    return { runtime: null, runtimeError: err, profileClass };
  }
  try {
    const runtime = await resolveRuntimeArtifactSet(binding, clientId);
    return { runtime, runtimeError: null, profileClass };
  } catch (err) {
    const absent =
      err instanceof ArtifactLoadError &&
      (err.code === "ARTIFACT_MISSING" || err.code === "ARTIFACT_NOT_EFFECTIVE");
    if (absent && binding.mode === "FIXTURE") {
      // Lead review, T-2041: name the *cause* and the *consequence* on one
      // line. The degrade is silent by design — the run is still written — so
      // this beacon is the only place it is visible, and it previously
      // surfaced to whoever hit it as a `runtimeBinding` key that was simply
      // missing much later. `policyArtifactKey` is the fixture key whose
      // artifact set this environment does not publish; `consequence` says
      // what was written instead. Both are server-owned content identifiers,
      // never client data.
      reportAnomaly("ai_coach.run.runtime_binding_unavailable", {
        ids: { clientId },
        context: {
          reason: err.code,
          mode: binding.mode,
          policyArtifactKey: binding.artifactRequest.policyArtifactKey,
          engineVersion: binding.artifactRequest.engineVersion,
          consequence: "RUN_SNAPSHOT_WRITTEN_UNBOUND",
        },
        allow: ["reason", "mode", "policyArtifactKey", "engineVersion", "consequence"],
      });
      return { runtime: null, runtimeError: null, profileClass };
    }
    return { runtime: null, runtimeError: err, profileClass };
  }
}

type WeeklyResolutionContext =
  | {
      status: "RESOLVED";
      artifacts: ReviewedArtifactSet;
      parameters: ResolvedWeeklyParameters;
      parameterSetDigest: string;
      sourceArtifact: {
        id: string;
        kind: "POLICY_BUNDLE";
        artifactKey: string;
        version: number;
        digest: string;
        engineVersion: string;
      };
    }
  | {
      status: "UNAVAILABLE";
      reasonCodes: WeeklyReasonCode[];
      missingParameterIds: string[];
    };

async function resolveWeeklyContext(
  clientId: string,
  kind: z.infer<typeof runCommandSchema>["kind"],
  runtime: ResolvedRuntimeArtifactSet | null
): Promise<WeeklyResolutionContext | undefined> {
  if (kind !== "WEEKLY_REVIEW") return undefined;
  if (!runtime) {
    return {
      status: "UNAVAILABLE",
      reasonCodes: ["WEEKLY_ARTIFACT_UNAVAILABLE"],
      missingParameterIds: [],
    };
  }
  try {
    const artifacts = await db.$transaction((tx) =>
      loadRunBoundArtifactSet(tx, clientId, {
        engineVersion: runtime.engineVersion,
        references: runtime.artifactRefs,
      })
    );
    const resolved = resolveWeeklyParameters(getReviewedPolicyBundleContent(artifacts.policy), {
      synthetic: artifacts.policy.synthetic,
    });
    if (!resolved.ok) return { status: "UNAVAILABLE", ...resolved };
    return {
      status: "RESOLVED",
      artifacts,
      parameters: resolved.parameters,
      parameterSetDigest: resolved.parameterSetDigest,
      sourceArtifact: {
        id: artifacts.policy.id,
        kind: "POLICY_BUNDLE",
        artifactKey: artifacts.policy.artifactKey,
        version: artifacts.policy.version,
        digest: artifacts.policy.contentDigest,
        engineVersion: runtime.engineVersion,
      },
    };
  } catch {
    return {
      status: "UNAVAILABLE",
      reasonCodes: ["WEEKLY_ARTIFACT_UNAVAILABLE"],
      missingParameterIds: [],
    };
  }
}

function freezeWeeklyPolicy(
  context: WeeklyResolutionContext,
  intake: RunSnapshot["intake"],
  basePayload: PlanPayload | null,
  evidence: z.infer<typeof evidenceSnapshotSchema>,
  evaluatedOn: string
): z.infer<typeof weeklyPolicySnapshotSchema> {
  if (context.status === "UNAVAILABLE") return context;
  let energyReestimate: {
    weightKg: number;
    weightMeasuredOn: string;
    targets: z.infer<typeof quantitiesSchema>;
  } | null = null;
  let simplifiedTraining: {
    strength: PlanPayload["strength"];
    cardio: PlanPayload["cardio"];
  } | null = null;

  if (
    context.parameters.adjustment.energyMethod === "REESTIMATE_FROM_CURRENT_WEIGHT" &&
    basePayload?.nutrition?.method === "REVIEWED_PRESCRIPTION_V1"
  ) {
    const latest = evidence.observations
      .filter((row) => row.payload.weight?.comparableConditions)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const weight = latest?.payload.weight;
    if (latest && weight) {
      try {
        const resolved = resolvePrescriptionParametersForArtifacts(context.artifacts);
        const built = buildPrescriptionInput(intake, evaluatedOn);
        if (resolved.ok && built.ok) {
          const weightKg = weight.value * (weight.unit === "LB" ? 0.45359237 : 1);
          const weightMeasuredOn = latest.occurredAt.slice(0, 10);
          const result = computePrescription(resolved.parameters, {
            ...built.input,
            weightKg,
            weightMeasuredOn,
          });
          if (result.status === "PRESCRIBED") {
            const prescription = result.prescription;
            energyReestimate = {
              weightKg,
              weightMeasuredOn,
              targets: {
                energyKcal: prescription.targetEnergyKcal,
                proteinG: prescription.proteinG,
                carbsG:
                  (prescription.carbohydrateRangeG.min + prescription.carbohydrateRangeG.max) / 2,
                fatG: (prescription.fatRangeG.min + prescription.fatRangeG.max) / 2,
              },
            };
          }
        }
      } catch {
        energyReestimate = null;
      }
    }
  }

  if (
    context.parameters.simplify.method === "RECOMPOSE_AT_FEWER_DAYS" &&
    intake.intakeVersion === 2 &&
    basePayload
  ) {
    try {
      const policy = getReviewedPolicyBundleContent(context.artifacts.policy);
      const templates = escalationTemplatesContentSchema.parse(
        context.artifacts.escalationTemplates.content
      );
      const training = resolveTrainingParameters(
        policy,
        templates.templates.map((template) => ({ id: template.id, text: template.nextStepText }))
      );
      const fewerDays =
        basePayload.strength.length - context.parameters.simplify.trainingDaysDecrement;
      if (training.ok && fewerDays > 0) {
        const catalog = trainingCatalogSourceFromArtifactContent(
          exerciseCatalogContentSchema.parse(context.artifacts.exerciseCatalog.content)
        );
        const composed = composeTraining(training.parameters, catalog, training.effortText, {
          intakeVersion: 2,
          trainingDaysPerWeek: fewerDays,
          equipmentAccess: intake.equipmentAccess,
          experienceLevel: intake.experienceLevel,
          sessionLengthBand: intake.sessionLengthBand ?? null,
          trainingContextStatus: intake.trainingContextStatus ?? null,
          energyReducedRelativeToMaintenance: null,
          activeContraindicationRuleIds: [],
        });
        if (composed.status === "COMPOSED") {
          simplifiedTraining = { strength: composed.strength, cardio: composed.cardio };
        }
      }
    } catch {
      simplifiedTraining = null;
    }
  }

  return {
    status: "RESOLVED",
    sourceArtifact: context.sourceArtifact,
    parameters: context.parameters,
    parameterSetDigest: context.parameterSetDigest,
    energyReestimate,
    simplifiedTraining,
  };
}

/** Owner and business identity are entirely server-derived; request keys cannot buy new runs. */
export async function requestAiRun(clientId: string, raw: unknown) {
  const parsed = runCommandSchema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "Invalid plan request.", 422);
  const input = parsed.data;
  await assertAiCoachOperationEnabled("GENERATION");
  if (input.substitution && (input.kind !== "REPRESENTATION" || input.representation !== "MEALS"))
    throw new AiCoachError("VALIDATION_ERROR", "Substitutions require meal representation.", 422);
  // T-2041: the run's runtime artifact binding is resolved **once**, here,
  // before the transaction opens — `resolveRuntimeArtifactSet` opens its own
  // and nesting is not allowed (risk 4). This is the only point where the
  // client, the profile classification and the ACTIVE release are all in
  // scope, and it makes the binding immutable for the life of the run, which
  // is what lets the executor, a retry, the weekly replay and finalization
  // all read one stored truth instead of re-deriving four.
  //
  // Nothing is thrown out here: the resolve outcome is carried into the
  // transaction and raised only after `lockAiClient` and the idempotency
  // receipt have had their say, so this ticket moves no existing fail-closed
  // error earlier and a replayed request key still returns its cached result.
  const { runtime, runtimeError, profileClass } = await resolveRunRuntimeBinding(clientId);
  const weeklyContext = await resolveWeeklyContext(clientId, input.kind, runtime);
  return db.$transaction(async (tx) => {
    const { context, profile } = await lockAiClient(tx, clientId);
    // The classification above was read outside this lock. If it moved, the
    // binding resolved against it is not the binding this run would get.
    if (profileClass && profile.isSynthetic !== profileClass.isSynthetic)
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "Your account classification changed. Refresh to continue."
      );
    const digest = contentHash(input);
    const receipt = await tx.aiOperationReceipt.findUnique({
      where: {
        clientId_operation_requestKey: { clientId, operation: "RUN", requestKey: input.requestKey },
      },
    });
    if (receipt) {
      if (receipt.inputDigest !== digest)
        throw new AiCoachError(
          "REVISION_CONFLICT",
          "This request key was already used with different input."
        );
      return receipt.result as { runId: string };
    }
    if (runtimeError) throw runtimeError;
    if (!isAiCoachGenerationEnabled())
      throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Plan preparation is paused.", 503);
    if (
      context!.revision !== input.expectedContextRevision ||
      profile.profileRevision !== input.expectedProfileRevision
    )
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "Your intake or coaching provider changed. Refresh to continue."
      );
    if (!profile.consentedAt || !profile.reviewTimezone) {
      if (profile.confirmedIntake && (profile.isSynthetic || context?.mode === "AI")) {
        const consentedAt = profile.consentedAt ?? new Date();
        const reviewTimezone = profile.reviewTimezone ?? "America/Los_Angeles";
        await tx.aiCoachProfile.update({
          where: { clientId },
          data: { consentedAt, reviewTimezone },
        });
        profile.consentedAt = consentedAt;
        profile.reviewTimezone = reviewTimezone;
      } else {
        throw new AiCoachError(
          "VALIDATION_ERROR",
          "Confirm intake and consent before requesting a plan.",
          422
        );
      }
    }
    const intake = intakeAnswersSchema.safeParse(profile.confirmedIntake);
    if (!intake.success)
      throw new AiCoachError("VALIDATION_ERROR", "Complete and confirm your intake first.", 422);
    if (
      [profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].some(
        (p) => p !== "ALLOW"
      )
    )
      throw new AiCoachError(
        "SAFETY_RESTRICTED",
        "Resolve the current safety restriction before preparing a new plan."
      );
    const base = profile.activePlanVersionId
      ? await tx.aiPlanVersion.findFirst({
          where: { id: profile.activePlanVersionId, clientId, acceptedAt: { not: null } },
        })
      : null;
    const historyExists = await tx.aiPlanVersion.count({
      where: { clientId, acceptedAt: { not: null } },
    });
    if ((input.kind === "INITIAL" && historyExists > 0) || (input.kind !== "INITIAL" && !base))
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "The requested operation does not match your plan history."
      );
    const window = reviewWindow(new Date(), profile.reviewTimezone);
    const start = window.evidenceStartsAt;
    const collected =
      input.kind === "WEEKLY_REVIEW"
        ? await collectEvidence(tx, clientId, start, window.lookbackEnd)
        : { evidence: { observations: [], sessions: [] }, sourceRefs: base?.sourceRefs ?? [] };
    const history = await tx.aiPlanVersion.findMany({
      where: { clientId, acceptedAt: { not: null } },
      orderBy: { acceptedAt: "asc" },
      take: 501,
      select: {
        id: true,
        acceptedAt: true,
        changeClass: true,
        reviewWindowKey: true,
        payload: true,
      },
    });
    if (history.length > 500)
      throw new AiCoachError(
        "VALIDATION_ERROR",
        "Plan history requires a reviewed archival policy before another change.",
        422
      );
    const resolution = await tx.aiSafetyDisclosureEvent.findFirst({
      where: {
        clientId,
        structuredAnswers: { path: ["source"], equals: "REVIEWED_RESOLUTION" },
        dispositionAfter: "CLEAR",
      },
      orderBy: { reportedAt: "desc" },
      select: { reportedAt: true },
    });
    const snapshot = runSnapshotSchema.parse({
      schemaVersion: 1,
      // T-2041: from the resolved set, never from a constant. When no set
      // could be resolved (see `resolveRunRuntimeBinding`) the snapshot keeps
      // the legacy unbound shape, which the schema's `superRefine` pins to
      // exactly these fixture constants.
      synthetic: runtime?.synthetic ?? true,
      intake: intake.data,
      policyVersion: runtime?.policyVersion ?? ACTIVE_POLICY_VERSION,
      catalogVersions: runtime?.catalogVersions ?? {
        food: FOOD_CATALOG_VERSION,
        exercise: EXERCISE_CATALOG_VERSION,
      },
      modelConfiguration: runtime?.modelConfiguration ?? "synthetic-template-v1",
      ...(runtime ? { runtimeBinding: runtime } : {}),
      ...(weeklyContext
        ? {
            weeklyPolicy: freezeWeeklyPolicy(
              weeklyContext,
              intake.data,
              base ? planPayloadSchema.parse(base.payload) : null,
              collected.evidence,
              window.key
            ),
          }
        : {}),
      baseVersionId: base?.id ?? null,
      basePayload: base?.payload ?? null,
      representation: input.representation,
      reviewWindowKey: window.key,
      reviewTimezone: profile.reviewTimezone,
      lastSafetyResolutionAt: resolution?.reportedAt.toISOString() ?? null,
      sourceRefs: collected.sourceRefs,
      evidence: collected.evidence,
      history: history.map((p) => ({ ...p, acceptedAt: p.acceptedAt!.toISOString() })),
      substitution: input.substitution ?? null,
    });
    const revisions = {
      contextRevision: context!.revision,
      profileRevision: profile.profileRevision,
      observationRevision: profile.observationRevision,
      safetyRevision: profile.safetyRevision,
    };
    const businessKey = contentHash({
      clientId,
      kind: input.kind,
      snapshot: jsonValue(snapshot),
      ...revisions,
    });
    let run = await tx.aiCoachRun.findUnique({ where: { businessKey } });
    if (!run) {
      const recent = await tx.aiCoachRun.count({
        where: { clientId, createdAt: { gte: new Date(Date.now() - 86400000) } },
      });
      if (recent >= 8)
        throw new AiCoachError(
          "RATE_LIMITED",
          "The daily preparation limit has been reached. Try again later.",
          429
        );
      run = await tx.aiCoachRun.create({
        data: {
          clientId,
          kind: input.kind,
          businessKey,
          ...revisions,
          inputSnapshot: jsonValue(snapshot),
          snapshotCutoffAt: new Date(),
          activationStartsAt: window.activationStartsAt,
          activationEndsAt: window.activationEndsAt,
          lookbackStart: input.kind === "WEEKLY_REVIEW" ? start : window.lookbackStart,
          lookbackEnd: window.lookbackEnd,
        },
      });
    }
    const result = { runId: run.id };
    await tx.aiOperationReceipt.create({
      data: {
        clientId,
        operation: "RUN",
        requestKey: input.requestKey,
        inputDigest: digest,
        result,
      },
    });
    return result;
  });
}
