import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import type { ArtifactDraftInput, ArtifactReference } from "@/lib/ai-coach/artifacts/schema";
import { contentHash } from "@/lib/ai-coach/canonical-json";
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

function reference(artifact: ArtifactDraftInput): ArtifactReference {
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
  policy.dependencies = leaves.map(reference);
  return { leaves, policy, references: [reference(policy), ...policy.dependencies] };
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
