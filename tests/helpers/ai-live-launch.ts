import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  ArtifactReviewMetadata,
} from "@/lib/ai-coach/artifacts/schema";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { db } from "@/lib/db";
import { publishFreshRuntimeFixtureArtifacts } from "./ai-artifacts";
import {
  activateAiCoachLiveRelease,
  approveLiveLaunchPacket,
  deactivateAiCoachLiveRelease,
  registerLiveLaunchPacket,
  type ActiveAiCoachLiveRelease,
} from "@/lib/ai-coach/live-launch/repository";
import type { GovernanceScope } from "@/lib/ai-coach/operations";
import {
  ALL_APPROVAL_REQUIREMENTS,
  REQUIRED_DECISION_IDS,
  REQUIRED_EVIDENCE_REQUIREMENTS,
  liveLaunchPacketSchema,
  type LiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/schema";

const DIGEST = "a".repeat(64);

/** The synthetic-fixture namespace whose artifact keys are the ones the code's
 * FIXTURE runtime binding resolves (`policy-fixture-v1` / `food-fixture-v2` /
 * `exercise-fixture-v1`). See `buildSyntheticArtifactSet`'s `runtime` flag. */
export const RUNTIME_FIXTURE_NAMESPACE = "t1008-runtime";

export const TEST_RUNTIME_CONFIGURATION = {
  schemaVersion: 1 as const,
  provider: {
    configurationId: "synthetic-final-provider-v1",
    version: 1,
    vendor: "ANTHROPIC" as const,
    apiBaseUrl: "https://api.anthropic.com" as const,
    credentialEnvironmentVariable: "AI_COACH_PROVIDER_CREDENTIAL" as const,
    providerName: "Synthetic isolated-test provider",
    modelIdentifier: "synthetic-model-v1",
    effort: "low" as const,
    pricing: {
      currency: "USD",
      inputMinorUnitsPerMillionTokens: 300,
      outputMinorUnitsPerMillionTokens: 1_500,
    },
    processingRegion: "SYNTHETIC_TEST_REGION",
    requestStorage: "DISABLED" as const,
    trainingUse: "DISABLED" as const,
    organizationDataControlsRecordId: "synthetic-org-data-controls-record",
    sendsDirectIdentifiers: false as const,
    sendsCrossClientContext: false as const,
    rawPromptOrTraceLogging: false as const,
    timeoutMs: 1_000,
    maxAttempts: 2,
    retryDelaysMs: [0],
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
  },
  providerBoundary: {
    promptContractVersion: "t1007-live-v1" as const,
    allowedPreferenceIds: ["SYNTHETIC_PREFERENCE"],
    allowedClarificationIds: ["SYNTHETIC_CLARIFICATION"],
    limitations: [{ id: "SYNTHETIC_LIMITATION", text: "Synthetic isolated test only." }],
  },
  operations: {
    monitoringWindowMinutes: 60,
    maximumP95LatencyMs: 1_000,
    maximumFailureRateBasisPoints: 100,
    maximumTokensPerWindow: 10_000,
    maximumSpendMinorUnitsPerWindow: 100,
    spendCurrency: "USD",
    operationalOwnerRecordId: "synthetic-owner-record",
    incidentRunbookRecordId: "synthetic-incident-runbook",
    referralRunbookRecordId: "synthetic-referral-runbook",
  },
  discovery: {
    configurationId: "synthetic-discovery-v1",
    version: 1,
    locale: "en-US",
    serviceLabel: "Synthetic automated AI coaching",
    headline: "Synthetic AI Coach discovery",
    summary: "Synthetic isolated test copy only.",
    informationHeading: "Synthetic eligibility information",
    disclosureParagraphs: ["Synthetic disclosure for isolated contract testing only."],
    consentLabel: "I consent to this synthetic isolated test.",
    confirmLabel: "Confirm synthetic choice",
    privacyNoticeLabel: "Review synthetic privacy notice",
    continueLabel: "Continue synthetic eligibility check",
    humanCoachLabel: "Find a synthetic human coach",
    privacyNoticeVersion: "synthetic-privacy-v1",
    privacyNoticeUrl: "https://example.invalid/privacy",
    eligibilitySummary: "Synthetic isolated test accounts only.",
    pricing: null,
  },
};
export const TEST_RUNTIME_CONFIGURATION_DIGEST = contentHash(TEST_RUNTIME_CONFIGURATION);

export function artifactReferenceOf(artifact: ArtifactDraftInput): ArtifactReference {
  return {
    id: artifact.id,
    artifactKey: artifact.artifactKey,
    version: artifact.version,
    kind: artifact.kind,
    digest: artifactContentDigest(artifact),
  };
}

/** Isolated-PostgreSQL fixture only; never register outside a disposable test DB. */
export function buildNonSyntheticLaunchTestArtifacts(namespace: string) {
  const source = buildSyntheticArtifactSet(namespace);
  const leaves = [
    source.foodCatalog,
    source.exerciseCatalog,
    source.evidenceRegistry,
    source.escalationTemplates,
  ].map((artifact) => {
    const clone = structuredClone(artifact);
    clone.synthetic = false;
    clone.reviewMetadata.jurisdictionReview.legalReviewStatus = "APPROVED";
    clone.reviewMetadata.jurisdictionReview.jurisdictions = ["SYNTHETIC_TEST_JURISDICTION"];
    return clone;
  });
  const policy = structuredClone(source.policyBundle);
  policy.synthetic = false;
  policy.reviewMetadata.jurisdictionReview.legalReviewStatus = "APPROVED";
  policy.reviewMetadata.jurisdictionReview.jurisdictions = ["SYNTHETIC_TEST_JURISDICTION"];
  policy.dependencies = leaves.map(artifactReferenceOf);
  return { leaves, policy, references: [artifactReferenceOf(policy), ...policy.dependencies] };
}

/**
 * S-20: which signatures the fixture packet carries. Defaults to all seven,
 * deliberately — every existing suite that activates a live release keeps
 * exercising the full seven-signer shape, so the single-signer reduction is
 * proved to *widen* what the gate accepts rather than to move it. Pass
 * `REQUIRED_APPROVAL_REQUIREMENTS` for the SINGLE_SIGNER_ACCOUNTABLE_OWNER
 * shape v1 actually ships.
 */
export type LaunchApprovalRequirement = LiveLaunchPacket["approvals"][number]["requirement"];

export function completeNonTestLaunchPacket(input: {
  suffix: string;
  artifactBindings: ArtifactReference[];
  now?: Date;
  approvalRequirements?: readonly LaunchApprovalRequirement[];
  /** S-21: override for a test that needs a distinguishably different
   * published disclosure (e.g. a later `discovery.version` to simulate
   * re-consent to a newer release) instead of the shared
   * `TEST_RUNTIME_CONFIGURATION`. Defaults to it, byte-identical to before
   * this option existed. */
  runtimeConfiguration?: import("@/lib/ai-coach/live-launch/schema").LiveRuntimeConfiguration;
}): LiveLaunchPacket {
  const now = input.now ?? new Date();
  const runtimeConfiguration = input.runtimeConfiguration ?? TEST_RUNTIME_CONFIGURATION;
  const runtimeConfigurationDigest =
    input.runtimeConfiguration !== undefined
      ? contentHash(input.runtimeConfiguration)
      : TEST_RUNTIME_CONFIGURATION_DIGEST;
  const approvalRequirements = input.approvalRequirements ?? ALL_APPROVAL_REQUIREMENTS;
  const signedAt = new Date(now.getTime() - 60_000).toISOString();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  const releaseId = `synthetic-isolated-release-${input.suffix}`;
  const approvalIds = new Map(
    approvalRequirements.map((requirement) => [
      requirement,
      `synthetic-approval-${requirement.toLowerCase().replaceAll("_", "-")}-${input.suffix}`,
    ])
  );
  return liveLaunchPacketSchema.parse({
    schemaVersion: 1,
    packetId: `synthetic-isolated-packet-${input.suffix}`,
    packetKey: `synthetic-isolated-packet-${input.suffix}`,
    version: 1,
    releaseId,
    engineVersion: "ai-coach-artifact-engine-v1",
    jurisdictions: ["SYNTHETIC_TEST_JURISDICTION"],
    authoredAt: signedAt,
    authoringStatus: "DRAFT_NOT_AUTHORIZED",
    testOnly: false,
    runtimeConfiguration,
    runtimeConfigurationDigest,
    sourceRecords: [{ id: `synthetic-source-${input.suffix}`, path: "synthetic", digest: DIGEST }],
    artifactBindings: input.artifactBindings,
    decisionRecords: REQUIRED_DECISION_IDS.map((decisionId) => ({
      decisionId,
      status: "APPROVED",
      requiredHumanDecision: null,
      recordId: `synthetic-decision-${decisionId.toLowerCase()}-${input.suffix}`,
      recordDigest: DIGEST,
      approvalId: approvalIds.get("NUTRITION_PROFESSIONAL"),
    })),
    approvals: approvalRequirements.map((requirement) => ({
      approvalId: approvalIds.get(requirement),
      requirement,
      status: "APPROVED",
      requiredHumanDecision: null,
      reviewer: {
        name: "Synthetic Isolated Test Reviewer",
        role: "Synthetic Isolated Test Role",
        qualifications: ["SYNTHETIC ISOLATED TEST QUALIFICATION"],
      },
      scope: "Synthetic isolated database lifecycle test only",
      jurisdictions: ["SYNTHETIC_TEST_JURISDICTION"],
      subjectReleaseId: releaseId,
      subjectArtifactDigests: input.artifactBindings.map((binding) => binding.digest),
      subjectConfigurationDigest: runtimeConfigurationDigest,
      recordId: `synthetic-approval-record-${requirement.toLowerCase()}-${input.suffix}`,
      recordDigest: DIGEST,
      signedAt,
      expiresAt,
      signature: {
        method: "EXTERNAL_SIGNED_RECORD",
        reference: `synthetic-signature-${requirement.toLowerCase()}-${input.suffix}`,
        digest: DIGEST,
      },
    })),
    evidence: REQUIRED_EVIDENCE_REQUIREMENTS.map((requirement) => ({
      evidenceId: `synthetic-evidence-${requirement.toLowerCase()}-${input.suffix}`,
      requirement,
      status: "PASSED",
      requiredHumanDecision: null,
      subjectRevision: releaseId,
      subjectConfigurationDigest: runtimeConfigurationDigest,
      recordId: `synthetic-evidence-record-${requirement.toLowerCase()}-${input.suffix}`,
      recordDigest: DIGEST,
      observedAt: signedAt,
      expiresAt,
      attestation: {
        method: "EXTERNAL_SIGNED_RECORD",
        reference: `synthetic-attestation-${requirement.toLowerCase()}-${input.suffix}`,
        digest: DIGEST,
      },
    })),
  });
}

/**
 * T-2000: registers + publishes a non-synthetic ("live-classified") artifact
 * set for `namespace`, then registers + approves + activates a matching
 * live-launch packet, returning the activation plus the packet and artifacts
 * used. Isolated-Postgres fixture only.
 *
 * `actorUserId` must already hold an active AiCoachGovernanceGrant with
 * `APPROVE_LIVE_LAUNCH` and `ACTIVATE_LIVE_LAUNCH` scopes (the caller's
 * beforeEach sets this up, mirroring ai-coach-live-launch-readiness.test.ts).
 */
/** Registers (if missing) and publishes (if not already published) — safe to
 * call repeatedly with the same artifact when a test file shares one
 * artifact set across several activations. */
async function ensurePublished(
  artifact: ArtifactDraftInput,
  effectiveAt: Date,
  expiresAt: Date
): Promise<void> {
  const existing = await db.aiCoachArtifactVersion.findUnique({ where: { id: artifact.id } });
  if (existing?.state === "PUBLISHED") return;
  if (!existing) await registerArtifactVersion(artifact);
  await publishArtifactVersion({
    id: artifact.id,
    effectiveAt,
    expiresAt,
    engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
  });
}

export async function activateTestLiveRelease(input: {
  namespace: string;
  actorUserId: string;
  now?: Date;
  /** Override for a caller that needs specific content (e.g. an exercise ID
   * that also satisfies the code's static hardcoded catalog match) instead
   * of the default generated set. Defaults to
   * `buildNonSyntheticLaunchTestArtifacts(namespace)`. */
  artifacts?: ReturnType<typeof buildNonSyntheticLaunchTestArtifacts>;
  /** Packet/release id suffix, defaults to `namespace`. Override when the
   * same (shared, already-registered) `artifacts` set is activated more
   * than once across separate tests, so each activation gets its own
   * packet/release identity instead of colliding on a duplicate id. */
  packetSuffix?: string;
  /** S-21: forwarded to `completeNonTestLaunchPacket` — see there. */
  runtimeConfiguration?: import("@/lib/ai-coach/live-launch/schema").LiveRuntimeConfiguration;
}): Promise<{
  activation: Awaited<ReturnType<typeof activateAiCoachLiveRelease>>;
  packet: LiveLaunchPacket;
  artifacts: ReturnType<typeof buildNonSyntheticLaunchTestArtifacts>;
  release: () => Promise<ActiveAiCoachLiveRelease>;
}> {
  const now = input.now ?? new Date();
  const effectiveAt = new Date(now.getTime() - 60_000);
  const expiresAt = new Date(now.getTime() + 3_600_000);
  const artifacts = input.artifacts ?? buildNonSyntheticLaunchTestArtifacts(input.namespace);
  for (const artifact of artifacts.leaves) {
    await ensurePublished(artifact, effectiveAt, expiresAt);
  }
  await ensurePublished(artifacts.policy, effectiveAt, expiresAt);
  const packet = completeNonTestLaunchPacket({
    suffix: input.packetSuffix ?? input.namespace,
    artifactBindings: artifacts.references,
    runtimeConfiguration: input.runtimeConfiguration,
  });
  await registerLiveLaunchPacket(packet);
  await approveLiveLaunchPacket({
    packetId: packet.packetId,
    actorUserId: input.actorUserId,
    effectiveAt,
    expiresAt,
    reasonCode: "SYNTHETIC_ISOLATED_TEST_APPROVAL",
    signedApprovalIndexRef: `synthetic-signed-approval-${input.namespace}`,
  });
  const activation = await activateAiCoachLiveRelease({
    packetId: packet.packetId,
    actorUserId: input.actorUserId,
    signedActivationRef: `synthetic-signed-activation-${input.namespace}`,
    reasonCode: "SYNTHETIC_ISOLATED_TEST_ACTIVATION",
  });
  const release = async () => {
    const { assertActiveAiCoachLiveReleaseReady } = await import(
      "@/lib/ai-coach/live-launch/repository"
    );
    return assertActiveAiCoachLiveReleaseReady();
  };
  return { activation, packet, artifacts, release };
}

/** Creates an isolated-DB test user holding an AiCoachGovernanceGrant with the
 * given scopes, for use as `activateTestLiveRelease`'s `actorUserId`. */
export async function createTestGovernanceActor(
  scopes: readonly GovernanceScope[],
  grantRef = "synthetic-isolated-test-actor"
): Promise<{ id: string }> {
  const key = `${grantRef}-${randomUUID()}`;
  const actor = await db.user.create({
    data: { clerkId: key, email: `${key}@example.test`, isCoach: true },
  });
  await db.aiCoachGovernanceGrant.create({
    data: { userId: actor.id, scopes: [...scopes], grantRef },
  });
  return { id: actor.id };
}

/**
 * T-2000: deactivates the currently ACTIVE live release (if any) and wipes
 * every row `activateTestLiveRelease`/`deactivateAiCoachLiveRelease` write
 * that is global rather than scoped to a client row — the five
 * AiCoachOperationalControl scopes and this actor's lifecycle/event/grant
 * rows — so a test that activates a release for its own duration never
 * leaks a disabled-by-default control or a lingering activation into a test
 * that runs after it in the same process. Artifact/packet rows are left in
 * place: they are keyed by the caller's unique namespace and a REVOKED/
 * inactive state never satisfies a fresh `assertActiveAiCoachLiveReleaseReady`.
 */
export async function deactivateTestLiveRelease(actorUserId: string): Promise<void> {
  const active = await db.aiCoachLiveActivation.findFirst({ where: { state: "ACTIVE" } });
  if (active) {
    await deactivateAiCoachLiveRelease({
      actorUserId,
      signedActivationRef: `synthetic-cleanup-${randomUUID()}`,
      reasonCode: "SYNTHETIC_ISOLATED_TEST_CLEANUP",
      reason: "Synthetic isolated test cleanup.",
    });
  }
  await db.aiCoachLiveActivationEvent.deleteMany({ where: { actorUserId } });
  await db.aiCoachLiveLaunchLifecycleEvent.deleteMany({ where: { actorUserId } });
  await db.aiCoachOperationalEvent.deleteMany({ where: { actorUserId } });
  await db.aiCoachOperationalControl.deleteMany({
    where: {
      scope: { in: ["GENERATION", "PROVIDER", "FINALIZATION", "ACCEPTANCE", "ARTIFACT_PUBLICATION"] },
    },
  });
  await db.aiCoachGovernanceGrant.deleteMany({ where: { userId: actorUserId } });
  await db.user.deleteMany({ where: { id: actorUserId } });
}

/** Bumps an artifact's version/id (keeping `artifactKey` — what everything
 * else matches against — unchanged), so a row reusing another fixture's
 * reserved key never collides with that fixture's own `id`. See
 * `buildLiveTrainingArtifacts` for why this is only safe for
 * EXERCISE_CATALOG, not POLICY_BUNDLE. */
export function bumpVersion<T extends ArtifactDraftInput<ArtifactReviewMetadata>>(
  artifact: T,
  version: number
): T {
  const clone = structuredClone(artifact);
  clone.version = version;
  clone.id = `${clone.artifactKey}:v${version}`;
  (clone.content as { version: number }).version = version;
  return clone;
}

/**
 * T-2041: extracted verbatim from `tests/integration/ai-coach-live-autonomy.test.ts`
 * (T-2000) so the new binding suite shares it instead of copying it.
 *
 * A uniquely-namespaced live artifact set (so it can never collide with any
 * other suite's registrations) whose exercise catalog is swapped for one at
 * the code's static hardcoded catalog key, `EXERCISE_CATALOG_VERSION`
 * ("exercise-fixture-v1"), containing "goblet-squat" — present in both that
 * static module (required for `planPayloadSchema`'s own validation of any
 * strength exercise) and this reviewed live artifact.
 *
 * Only the exercise catalog reuses that reserved key, at the reserved
 * version `LIVE_TRAINING_EXERCISE_CATALOG_VERSION`. S-30: it used to be
 * version 2, which is exactly where the "t1008-runtime" runtime series
 * (`publishRuntimeFixtureArtifactSet`, versions 1, 2, 3, ...) lands next, so
 * whichever family wrote `exercise-fixture-v1:v2` first broke the other
 * (P2002 in weekly-trajectory one way, a stale synthetic 1 h row silently
 * reused by the live suites the other way). That is safe only because nothing resolves an
 * EXERCISE_CATALOG artifact by "latest version for this key" the way policy
 * bundles are — every exercise/food/evidence/escalation lookup is by the
 * owning policy's own exact `dependencies` references
 * (`lib/ai-coach/artifacts/repository.ts`'s one `orderBy version desc`
 * query is POLICY_BUNDLE-only). The policy/food/evidence/escalation
 * artifacts here keep a fresh unique namespace and are never shared, so
 * they cannot shadow another suite's synthetic "t1008-runtime" policy the
 * way an earlier version of this fixture (reusing "policy-fixture-v1")
 * once did.
 *
 * T-2000 review finding 7 (read this before trusting what a suite using it
 * proves): this is still a **control-flow proof, not a content proof**. Every
 * fixture here reuses "t1008-runtime" content with `synthetic` flipped.
 */
/** S-30: far outside the runtime fixture series (it advances by one per
 * `publishRuntimeFixtureArtifactSet` call), so the two families can never
 * claim the same `exercise-fixture-v1` id or (kind, key, version) slot. */
export const LIVE_TRAINING_EXERCISE_CATALOG_VERSION = 1_000_000;

export function buildLiveTrainingArtifacts() {
  const runtimeExerciseSource = buildNonSyntheticLaunchTestArtifacts("t1008-runtime").leaves.find(
    (leaf) => leaf.kind === "EXERCISE_CATALOG"
  )!;
  const customExercise = bumpVersion(runtimeExerciseSource, LIVE_TRAINING_EXERCISE_CATALOG_VERSION);

  const base = buildNonSyntheticLaunchTestArtifacts(`live-autonomy-${randomUUID()}`);
  const leaves = base.leaves.map((leaf) =>
    leaf.kind === "EXERCISE_CATALOG" ? customExercise : leaf
  );
  const policy = structuredClone(base.policy);
  policy.dependencies = leaves.map(artifactReferenceOf);
  return { leaves, policy, references: [artifactReferenceOf(policy), ...policy.dependencies] };
}

/**
 * The shared exercise-catalog artifact (reserved key "exercise-fixture-v1")
 * is published once, with a window wide enough to outlive any single
 * test-process run, so a later re-run against the same disposable database
 * never finds it "not effective for the full policy period" against a policy
 * whose own now-based window has moved forward. `activateTestLiveRelease`'s
 * own `ensurePublished` skips re-publishing once a row is PUBLISHED, so this
 * window sticks.
 */
export async function ensureLiveTrainingExerciseCatalogPublished(
  artifacts: ReturnType<typeof buildLiveTrainingArtifacts>
): Promise<void> {
  const customExercise = artifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!;
  const existing = await db.aiCoachArtifactVersion.findUnique({ where: { id: customExercise.id } });
  // S-30: never silently adopt a row some other fixture wrote at this id.
  // Skipping it (the old behaviour) turned an id collision into a dozen
  // unrelated-looking ARTIFACT_INCOMPATIBLE / window failures downstream.
  const expectedDigest = artifactContentDigest(customExercise);
  if (existing && (existing.synthetic || existing.contentDigest !== expectedDigest)) {
    throw new Error(
      `ensureLiveTrainingExerciseCatalogPublished: "${customExercise.id}" already exists with ` +
        `different content (synthetic=${existing.synthetic}, contentDigest=${existing.contentDigest}, ` +
        `expected ${expectedDigest}). Another fixture claimed this reserved id.`
    );
  }
  if (!existing) await registerArtifactVersion(customExercise);
  if (existing?.state !== "PUBLISHED") {
    await publishArtifactVersion({
      id: customExercise.id,
      effectiveAt: new Date("2020-01-01T00:00:00.000Z"),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
  }
}

/**
 * T-2041: registers + publishes a **synthetic-classified** artifact set under
 * a caller-unique namespace, returning its five exact references. Used to
 * prove the run-bound loader refuses a synthetic artifact for a live account
 * (`SYNTHETIC_ARTIFACT_FORBIDDEN`). Isolated-Postgres fixture only.
 */
export async function publishSyntheticArtifactSetForTest(
  namespace: string
): Promise<ArtifactReference[]> {
  const set = buildSyntheticArtifactSet(namespace);
  // A fixed, wide window rather than a `now`-relative one, for the same reason
  // `ensureLiveTrainingExerciseCatalogPublished` uses one: `ensurePublished`
  // skips a row that is already PUBLISHED, so a narrow window written by an
  // earlier run against a reused disposable database would later read as
  // `ARTIFACT_EXPIRED` — which is a *fault*, not an absence, and would fail a
  // request rather than degrade. Equal expiries satisfy
  // `publishArtifactVersion`'s dependency-window check (`<`, not `<=`).
  const effectiveAt = new Date("2020-01-01T00:00:00.000Z");
  const expiresAt = new Date("2099-01-01T00:00:00.000Z");
  for (const leaf of [
    set.foodCatalog,
    set.exerciseCatalog,
    set.evidenceRegistry,
    set.escalationTemplates,
  ]) {
    await ensurePublished(leaf, effectiveAt, expiresAt);
  }
  await ensurePublished(set.policyBundle, effectiveAt, expiresAt);
  return [artifactReferenceOf(set.policyBundle), ...set.policyBundle.dependencies];
}

/**
 * T-2041 (lead review) — asserts the precondition a suite needs before it can
 * observe a **FIXTURE** runtime binding at all.
 *
 * The synthetic runtime artifact set is the set `syntheticRuntimeArtifactRequest()`
 * resolves for every synthetic account, keyed on `ACTIVE_POLICY_VERSION`. When
 * it is not usable *in this database*, `requestAiRun` takes the documented
 * absent-fixture degrade (`lib/ai-coach/run-command.ts`'s
 * `resolveRunRuntimeBinding`): it writes an **unbound** snapshot and reports
 * `ai_coach.run.runtime_binding_unavailable`. That is correct product
 * behaviour, but from a test's point of view it surfaces much later as a
 * missing `snapshot.runtimeBinding` key, which reads as a broken assertion
 * rather than as "this suite never published the fixture set". This throws
 * **at the precondition**, naming the cause and the consequence.
 *
 * Exported separately from the publisher below so the failure path is
 * reachable on its own, and so a suite that only wants to assert the
 * precondition need not re-publish.
 */
export async function assertRuntimeFixtureArtifactsUsable(
  references: readonly ArtifactReference[]
): Promise<void> {
  const policy = references.find((reference) => reference.kind === "POLICY_BUNDLE");
  if (!policy || policy.artifactKey !== ACTIVE_POLICY_VERSION) {
    throw new Error(
      `assertRuntimeFixtureArtifactsUsable: no POLICY_BUNDLE reference keyed "${ACTIVE_POLICY_VERSION}", ` +
        `so a synthetic account's FIXTURE runtime binding cannot resolve to it. Got: ` +
        `${policy?.artifactKey ?? "no POLICY_BUNDLE reference"}.`
    );
  }
  const now = new Date();
  const row = await db.aiCoachArtifactVersion.findUnique({ where: { id: policy.id } });
  const usable =
    row?.state === "PUBLISHED" &&
    !!row.effectiveAt &&
    row.effectiveAt <= now &&
    !!row.expiresAt &&
    row.expiresAt > now;
  if (!usable) {
    throw new Error(
      `assertRuntimeFixtureArtifactsUsable: "${policy.id}" is not a usable published artifact in this ` +
        `database (state=${row?.state ?? "MISSING"}, effectiveAt=${row?.effectiveAt?.toISOString() ?? "null"}, ` +
        `expiresAt=${row?.expiresAt?.toISOString() ?? "null"}). requestAiRun would take the ` +
        `absent-fixture degrade and write an UNBOUND run snapshot, so every assertion about ` +
        `snapshot.runtimeBinding would fail on a missing key instead of on the property under test.`
    );
  }
}

/**
 * The one call any suite makes when it needs `requestAiRun` to freeze a
 * FIXTURE runtime binding: publishes the synthetic runtime artifact set, then
 * verifies the postcondition it exists to establish. Idempotent, and safe to
 * share with any other suite that publishes the same namespace.
 */
export async function publishRuntimeFixtureArtifacts(): Promise<ArtifactReference[]> {
  const references = await publishSyntheticArtifactSetForTest(RUNTIME_FIXTURE_NAMESPACE);
  // S-30: `ensurePublished` keeps whatever window the first writer of the
  // shared `policy-fixture-v1:v1` row chose, and the FIXTURE binding resolves
  // the *latest* version of that key, not v1. On a reused database either one
  // can be a row an earlier run wrote with a now-expired window, so this call
  // was green or red depending on what ran before it. If the version the
  // binding will actually resolve is not this usable v1 set, publish a fresh
  // version (collision-free since S-30; it becomes the latest) and hand back
  // that set instead.
  const latest = await db.aiCoachArtifactVersion.findFirst({
    where: { kind: "POLICY_BUNDLE", artifactKey: ACTIVE_POLICY_VERSION },
    orderBy: { version: "desc" },
    select: { id: true, state: true, effectiveAt: true, expiresAt: true },
  });
  const now = new Date();
  const policyId = references.find((reference) => reference.kind === "POLICY_BUNDLE")?.id;
  const latestIsTheseAndUsable =
    latest?.id === policyId &&
    latest?.state === "PUBLISHED" &&
    !!latest.effectiveAt &&
    latest.effectiveAt <= now &&
    !!latest.expiresAt &&
    latest.expiresAt > now;
  const usable = latestIsTheseAndUsable ? references : await publishFreshRuntimeFixtureArtifacts();
  await assertRuntimeFixtureArtifactsUsable(usable);
  return usable;
}

/**
 * T-2041: extracted from `tests/integration/ai-coach-live-autonomy.test.ts`
 * (T-2000/T-2033) so a second live suite shares it instead of copying it.
 *
 * The LIVE provider boundary is a real HTTPS transport
 * (ApprovedConstrainedGatewayProvider); this stubs it exactly the way
 * `SyntheticConstrainedProvider` echoes references, so a suite proves
 * T-1006/T-1007's control flow without making a real network call or a real
 * model claim. Call it from `beforeEach`, alongside `vi.unstubAllGlobals()`
 * in `afterEach`.
 */
export function stubApprovedLiveProviderTransport(): void {
  vi.stubEnv("AI_COACH_PROVIDER_CREDENTIAL", "synthetic-isolated-test-credential");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      // Sprint-1 regression repair (T-2033, 2026-09-26): this mock parsed
      // a request shape (`{envelope: {allowed: ...}}`) that the real
      // `@anthropic-ai/sdk` client never sends — the actual HTTP request
      // body is the Anthropic Messages API's own shape
      // (`{model, max_tokens, system, messages, output_config}`), with the
      // envelope only present as the JSON-stringified `content` of the
      // single user message (`anthropic-provider.ts`'s `minimizedUserPayload`).
      // Reading `body.envelope.allowed` threw `Cannot read properties of
      // undefined (reading 'allowed')` inside the SDK's own fetch call,
      // which the SDK reports as a generic `APIConnectionError` — surfacing
      // in this suite as every live finalization returning HOLD
      // (`PROVIDER_ERROR`) instead of APPROVE_AUTOMATICALLY. Not a T-2034
      // regression: disabling T-2034's `ARTIFACT_UNSIGNED_DRAFT` refusal
      // entirely does not change this failure (verified), and this parsing
      // bug is unrelated to review-metadata parsing. The response shape
      // below is similarly corrected to the real Messages API response
      // (`content`/`stop_reason`/snake_case `usage`), matching
      // `AnthropicMessageResponse` (`anthropic-provider.ts`) exactly.
      const body = JSON.parse(init.body as string) as {
        messages: { role: string; content: string }[];
      };
      const userMessage = JSON.parse(body.messages[0].content) as {
        allowed: {
          preferenceIds: string[];
          optionIds: string[];
          explanationTemplateIds: string[];
          reasonCodes: string[];
          numericFieldIds: string[];
          limitationIds: string[];
        };
      };
      const allowed = userMessage.allowed;
      const output = {
        schemaVersion: 1,
        preferenceIds: allowed.preferenceIds.slice(0, 1),
        concern: { disposition: "NONE", clarificationId: null },
        rankedOptionIds: allowed.optionIds,
        explanation: {
          templateId: allowed.explanationTemplateIds[0],
          reasonCodes: allowed.reasonCodes,
          numericFieldIds: allowed.numericFieldIds,
          limitationIds: allowed.limitationIds,
        },
      };
      const text = JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(output) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      return new Response(text, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(text).byteLength),
        },
      });
    })
  );

}
