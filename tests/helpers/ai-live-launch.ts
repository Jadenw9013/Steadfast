import { randomUUID } from "node:crypto";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import type { ArtifactDraftInput, ArtifactReference } from "@/lib/ai-coach/artifacts/schema";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { db } from "@/lib/db";
import {
  activateAiCoachLiveRelease,
  approveLiveLaunchPacket,
  deactivateAiCoachLiveRelease,
  registerLiveLaunchPacket,
  type ActiveAiCoachLiveRelease,
} from "@/lib/ai-coach/live-launch/repository";
import type { GovernanceScope } from "@/lib/ai-coach/operations";
import {
  REQUIRED_APPROVAL_REQUIREMENTS,
  REQUIRED_DECISION_IDS,
  REQUIRED_EVIDENCE_REQUIREMENTS,
  liveLaunchPacketSchema,
  type LiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/schema";

const DIGEST = "a".repeat(64);

export const TEST_RUNTIME_CONFIGURATION = {
  schemaVersion: 1 as const,
  provider: {
    configurationId: "synthetic-final-provider-v1",
    version: 1,
    protocol: "STEADFAST_CONSTRAINED_JSON_V1" as const,
    gatewayUrl: "https://provider.invalid/v1/constrained",
    credentialEnvironmentVariable: "AI_COACH_PROVIDER_CREDENTIAL" as const,
    providerName: "Synthetic isolated-test provider",
    modelIdentifier: "synthetic-model-v1",
    processingRegion: "SYNTHETIC_TEST_REGION",
    requestStorage: "DISABLED" as const,
    trainingUse: "DISABLED" as const,
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

export function completeNonTestLaunchPacket(input: {
  suffix: string;
  artifactBindings: ArtifactReference[];
  now?: Date;
}): LiveLaunchPacket {
  const now = input.now ?? new Date();
  const signedAt = new Date(now.getTime() - 60_000).toISOString();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  const releaseId = `synthetic-isolated-release-${input.suffix}`;
  const approvalIds = new Map(
    REQUIRED_APPROVAL_REQUIREMENTS.map((requirement) => [
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
    runtimeConfiguration: TEST_RUNTIME_CONFIGURATION,
    runtimeConfigurationDigest: TEST_RUNTIME_CONFIGURATION_DIGEST,
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
    approvals: REQUIRED_APPROVAL_REQUIREMENTS.map((requirement) => ({
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
      subjectConfigurationDigest: TEST_RUNTIME_CONFIGURATION_DIGEST,
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
      subjectConfigurationDigest: TEST_RUNTIME_CONFIGURATION_DIGEST,
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
