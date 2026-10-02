import { buildWeeklyFixtureReview } from "./weekly-controller";
import { evidenceIsCurrent } from "./evidence-snapshot";
import { representFixturePlan } from "./representation";
import { db } from "@/lib/db";
import type { ClaimResult } from "./runs";
import { failRunAttempt } from "./runs";
import { runSnapshotSchema, type RunSnapshot } from "./run-command";
import { composeInitialPlan, composeUnavailablePrescriptionPlan } from "./initial-plan";
import { isV2Intake } from "./intake";
import {
  ArtifactLoadError,
  loadRunBoundArtifactSet,
  resolveArtifactSetForClient,
  type ReviewedArtifactSet,
} from "./artifacts/repository";
import { resolvePrescriptionParametersForArtifacts } from "./prescription-binding";
import { generationBindingFromSnapshot, resolveAiCoachRuntimeBinding } from "./runtime-binding";
import { contentHash } from "./canonical-json";
import { AiCoachError, jsonValue, lockAiClient } from "./access";
import { RUNTIME_ARTIFACTS_UNPUBLISHED } from "./error";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
import {
  callProviderWithTimeout,
  legacySyntheticStageInput,
  type ModelProvider,
} from "./provider/adapter";
import { checkProviderRateLimit, isWithinTokenCeiling } from "./provider/spend-limits";
import { decisionSchema, planPayloadSchema } from "./plan-contract";
import { assertAiCoachOperationEnabled } from "./operations";

/**
 * T-2033 (T-2003 file item 4) — resolves `composeInitialPlan`'s `parameters`
 * from the artifact set this run is bound to, then composes. The runtime
 * binding comes from the *executing account's own profile* (review r1 MINOR
 * 4: never a hardcoded `{ isSynthetic: true }`), and the loaded artifact set
 * is asserted against the run snapshot's own `policyVersion`/`catalogVersions`
 * before any parameter is read from it, so "which bundle produced these
 * numbers" has exactly one answer (CLAUDE.md rule 10). Today the
 * `LIVE_COMPOSITION_UNAVAILABLE` guard in this function's only caller means
 * that profile is always synthetic and the binding always FIXTURE.
 *
 * A v1 intake never attempts resolution
 * (the legacy path never needs engine parameters). A v2 intake whose
 * `resolvePrescriptionParametersForArtifacts` call fails is **not** an
 * exception: it calls `composeUnavailablePrescriptionPlan` directly with the
 * real reason codes so the run still completes with an honest
 * `prescriptionOutcome.status: "UNAVAILABLE"` — the client sees a HOLD with a
 * reason rather than a spinner (T-2003 file item 4). An `ArtifactLoadError`
 * while loading the artifact set itself is not swallowed here either: an
 * `ARTIFACT_MISSING`/`ARTIFACT_NOT_EFFECTIVE` load (this environment has
 * never published a usable set — S-26/S-27) maps to its own
 * `RUNTIME_ARTIFACTS_UNPUBLISHED` 503; every other `ArtifactLoadError`
 * (e.g. a revoked/incompatible bundle) maps to the same `TEMPORARILY_UNAVAILABLE`
 * 503 `finalization.ts` already uses for the identical failure class. Both are
 * distinct from a `resolvePrescriptionParametersForArtifacts` `ok:false`
 * result, which is a normal, expected outcome, not an artifact-loading fault.
 */
async function composeManagedInitialPlan(
  runId: string,
  snapshot: RunSnapshot,
  executingProfile: { isSynthetic: boolean },
  /** T-2041 — the artifact set this run was **frozen** to at `requestAiRun`,
   * already re-loaded from `snapshot.runtimeBinding.artifactRefs` under the
   * executor's lock. When it is present it is the authority and nothing is
   * re-resolved here: before this ticket the composer resolved a fresh set at
   * execution time while the payload's binding came from the snapshot, which
   * is two sources of truth for "which content produced these numbers"
   * (CLAUDE.md rule 10). `null` only for a run whose snapshot predates this
   * ticket, which keeps its previous behaviour exactly. */
  frozenArtifacts: ReviewedArtifactSet | null,
  /** S-28 — the run's own server-derived `claim.run.clientId`. Never resolved
   * a second time from the ambient Clerk session: the executor has no
   * request, and even when one happens to be active it is not necessarily
   * for this run's client. See the fallback below and
   * `resolveArtifactSetForClient`'s doc comment. */
  clientId: string
) {
  const prescriptionId = `rx-${runId}`;
  const generation = generationBindingFromSnapshot(snapshot);
  const binding = {
    policyVersion: generation.policyVersion,
    foodCatalogVersion: generation.catalogVersions.food,
    exerciseCatalogVersion: generation.catalogVersions.exercise,
  };
  if (!isV2Intake(snapshot.intake)) {
    return composeInitialPlan({
      rawAnswers: snapshot.intake,
      prescriptionId,
      mode: snapshot.representation,
      evaluatedOn: new Date().toISOString().slice(0, 10),
      parameters: null,
      binding,
    });
  }
  let artifacts;
  try {
    // S-28: this is the T-2041 unbound-snapshot degrade (no frozen artifact
    // set to re-load). `resolveAiCoachRuntimeBinding(null, executingProfile)`
    // was already identity-safe — it takes the run's own profile explicitly,
    // never a session. The bug was the next step: `loadReviewedArtifactSet`
    // resolves *whose* account to check eligibility/classification against
    // from `getCurrentDbUser()`, which has nothing to do with this run and is
    // frequently absent entirely (the executor has no request). Use
    // `resolveArtifactSetForClient`, which takes `clientId` explicitly and
    // opens its own transaction (there is none open here; see this
    // function's caller).
    if (frozenArtifacts) {
      artifacts = frozenArtifacts;
    } else {
      const request = (await resolveAiCoachRuntimeBinding(null, executingProfile)).artifactRequest;
      artifacts = await db.$transaction((tx) => resolveArtifactSetForClient(tx, clientId, request));
    }
  } catch (err) {
    if (err instanceof ArtifactLoadError) {
      // S-26/S-27: "never published" is a distinct, operator/UI-visible
      // condition from every other artifact-load fault this run can hit
      // (revoked, incompatible, or a binding that no longer matches — see
      // error.ts's RUNTIME_ARTIFACTS_UNPUBLISHED doc comment). Only these
      // two ArtifactLoadError codes mean "this environment has never
      // published/effected a usable reviewed artifact set at all".
      if (err.code === "ARTIFACT_MISSING" || err.code === "ARTIFACT_NOT_EFFECTIVE") {
        throw new AiCoachError(
          RUNTIME_ARTIFACTS_UNPUBLISHED,
          "AI coaching is not available for live use yet: this environment has not published a usable artifact set.",
          503
        );
      }
      throw new AiCoachError(
        "TEMPORARILY_UNAVAILABLE",
        "AI coaching is not available for live use yet.",
        503
      );
    }
    throw err;
  }
  if (
    artifacts.policy.artifactKey !== binding.policyVersion ||
    artifacts.foodCatalog.artifactKey !== binding.foodCatalogVersion ||
    artifacts.exerciseCatalog.artifactKey !== binding.exerciseCatalogVersion
  ) {
    // The payload stamps the snapshot's binding; the engine parameters come
    // from the loaded set. If those two ever disagree the run must fail, not
    // publish numbers attributed to a bundle that did not produce them.
    throw new AiCoachError(
      "TEMPORARILY_UNAVAILABLE",
      "The reviewed artifact set no longer matches this run's binding.",
      503
    );
  }
  const resolved = resolvePrescriptionParametersForArtifacts(artifacts);
  if (!resolved.ok) {
    return composeUnavailablePrescriptionPlan(
      snapshot.intake,
      snapshot.representation,
      binding,
      resolved.reasonCodes
    );
  }
  return composeInitialPlan({
    rawAnswers: snapshot.intake,
    prescriptionId,
    mode: snapshot.representation,
    evaluatedOn: new Date().toISOString().slice(0, 10),
    parameters: resolved.parameters,
    binding,
  });
}

/** Commit candidate and run completion together, after the external provider stage.
 * Model output never supplies targets, catalog IDs, ownership or a plan pointer.
 */
export async function processManagedRun(
  claim: Extract<ClaimResult, { claimed: true }>,
  provider: ModelProvider
): Promise<"completed" | "failed"> {
  try {
    await assertAiCoachOperationEnabled("GENERATION");
    await assertAiCoachOperationEnabled("PROVIDER");
    // T-2000 review finding 2: removing the run-command.ts non-synthetic 503
    // opened generation to a real client, but the composer below
    // (buildInitialFixturePlan / representFixturePlan /
    // buildWeeklyFixtureReview) unconditionally stamps hard-coded fixture
    // doses, foods and `contentKind: "SYNTHETIC_FIXTURE"` into whatever
    // AiPlanVersion it writes — content that is only ever correct for a
    // synthetic test account. Binding real composition to a live release's
    // reviewed catalog is T-2022/T-2039/T-2041; until then, a real client's
    // run must fail closed here, before any composition or write, rather
    // than silently writing fixture clinical content into a real person's
    // plan history.
    const executingProfile = await db.aiCoachProfile.findUnique({
      where: { clientId: claim.run.clientId },
      select: { isSynthetic: true },
    });
    if (!executingProfile?.isSynthetic) {
      throw new AiCoachError(
        "LIVE_COMPOSITION_UNAVAILABLE",
        "Plan composition for a real account is not available yet.",
        503
      );
    }
    const snapshot = runSnapshotSchema.parse(claim.run.inputSnapshot);
    // T-2041: one source of truth for this run's binding — the snapshot.
    const runtime = generationBindingFromSnapshot(snapshot);
    // The lock was already taken here before this ticket (it just sat below
    // the composition). It now also re-loads the exact artifact references
    // the run was frozen to, which is the fail-closed for an artifact that
    // was revoked, expired, superseded or reclassified between request and
    // execution: `loadRunBoundArtifactSet` throws rather than let the run
    // execute against a set the snapshot never named. It costs no extra
    // transaction, and it must happen before any candidate is composed.
    const frozenArtifacts = await db
      .$transaction(async (tx) => {
        await lockAiClient(tx, claim.run.clientId);
        return snapshot.runtimeBinding
          ? await loadRunBoundArtifactSet(tx, claim.run.clientId, {
              engineVersion: snapshot.runtimeBinding.engineVersion,
              references: snapshot.runtimeBinding.artifactRefs,
            })
          : null;
      })
      .catch((err: unknown) => {
        // A revoked, expired, superseded or reclassified artifact must fail
        // the run closed under a *named* reason, not escape `ArtifactLoadError`
        // (which extends the plain Error base) into `failRunAttempt`'s
        // anonymous `MANAGED_RUN_FAILED`. Same mapping, same message and same
        // 503 `composeManagedInitialPlan` already uses for this exact class.
        if (err instanceof ArtifactLoadError) {
          throw new AiCoachError(
            "TEMPORARILY_UNAVAILABLE",
            "The reviewed artifact set no longer matches this run's binding.",
            503
          );
        }
        throw err;
      });
    const generated =
      claim.run.kind === "INITIAL"
        ? await composeManagedInitialPlan(
            claim.run.id,
            snapshot,
            executingProfile,
            frozenArtifacts,
            claim.run.clientId
          )
        : claim.run.kind === "REPRESENTATION" && snapshot.basePayload
          ? representFixturePlan(
              snapshot.basePayload,
              snapshot.intake,
              snapshot.representation,
              snapshot.substitution
            )
          : claim.run.kind === "WEEKLY_REVIEW"
            ? buildWeeklyFixtureReview(snapshot)
            : null;
    if (!generated)
      throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "This run type is not available yet.");
    if (!isAiCoachGenerationEnabled())
      throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Generation paused.");
    if (!(await checkProviderRateLimit(claim.run.clientId, claim.run.kind)))
      throw new AiCoachError("RATE_LIMITED", "Provider budget reached.");
    const stage = await callProviderWithTimeout(
      provider,
      legacySyntheticStageInput(claim.run.kind)
    );
    if (stage.outcome !== "success" || !stage.isFinal || !isWithinTokenCeiling(stage.tokensUsed))
      throw new AiCoachError("VALIDATION_ERROR", "Provider stage did not validate.");
    // The synthetic provider's wording is deliberately not published. Use the
    // bounded explanation template tied to the deterministic decision.
    const payload = generated.payload ? planPayloadSchema.parse(generated.payload) : null;
    const decision = decisionSchema.parse(generated.decision);
    const completed = await db.$transaction(async (tx) => {
      const { context, profile } = await lockAiClient(tx, claim.run.clientId);
      const run = await tx.aiCoachRun.findUnique({ where: { id: claim.run.id } });
      if (
        !run ||
        run.status !== "RUNNING" ||
        run.fencingToken !== claim.fencingToken ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt <= new Date()
      )
        return false;
      if (
        !(await evidenceIsCurrent(tx, claim.run.clientId, snapshot.sourceRefs)) ||
        !isAiCoachGenerationEnabled() ||
        context!.revision !== run.contextRevision ||
        profile.profileRevision !== run.profileRevision ||
        profile.observationRevision !== run.observationRevision ||
        profile.safetyRevision !== run.safetyRevision ||
        profile.activePlanVersionId !== snapshot.baseVersionId ||
        [profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].some(
          (p) => p !== "ALLOW"
        ) ||
        (run.activationEndsAt && run.activationEndsAt <= new Date())
      ) {
        await tx.aiCoachRun.update({
          where: { id: run.id },
          data: { status: "CANCELED", leaseExpiresAt: null },
        });
        return false;
      }
      const latest = await tx.aiPlanVersion.findFirst({
        where: { clientId: run.clientId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const plan = payload
        ? await tx.aiPlanVersion.create({
            data: {
              clientId: run.clientId,
              version: (latest?.version ?? 0) + 1,
              baseVersionId: snapshot.baseVersionId,
              payload: jsonValue(payload),
              payloadHash: contentHash(payload),
              // T-2041: stamped from the run's one binding, not from a
              // second read of the snapshot's top-level fields. Identical
              // values by `runSnapshotSchema`'s superRefine — one source.
              policyVersion: runtime.policyVersion,
              catalogVersions: runtime.catalogVersions,
              contextRevision: run.contextRevision,
              profileRevision: run.profileRevision,
              observationRevision: run.observationRevision,
              safetyRevision: run.safetyRevision,
              activationStartsAt: run.activationStartsAt,
              activationEndsAt: run.activationEndsAt,
              reviewWindowKey: snapshot.reviewWindowKey,
              changeClass: decision.changeClass,
              reviewerStatus:
                decision.changeClass === "TARGET_PRESERVING" ? "NOT_REQUIRED" : "PENDING",
              sourceRefs: jsonValue(snapshot.sourceRefs),
              validationReport: {
                engine: "managed-v1",
                passed: true,
                inputHash: contentHash(snapshot),
              },
            },
          })
        : null;
      const result = await tx.aiCoachRun.updateMany({
        where: {
          id: run.id,
          status: "RUNNING",
          fencingToken: claim.fencingToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: "COMPLETED",
          leaseExpiresAt: null,
          resultPlanVersionId: plan?.id ?? null,
          resultReviewAction: decision.action,
          resultDecision: jsonValue(decision),
        },
      });
      if (result.count !== 1) throw new AiCoachError("REVISION_CONFLICT", "Worker lease changed.");
      return true;
    });
    return completed ? "completed" : "failed";
  } catch (error) {
    // Never persist provider stacks or health notes as a user-facing message.
    await failRunAttempt(
      claim.run.id,
      claim.fencingToken,
      error instanceof AiCoachError ? error.code : "MANAGED_RUN_FAILED"
    );
    return "failed";
  }
}
