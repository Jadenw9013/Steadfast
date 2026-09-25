import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_APPROVAL_REQUIREMENTS,
  REQUIRED_DECISION_IDS,
  REQUIRED_EVIDENCE_REQUIREMENTS,
  evaluateLiveLaunchPacketReadiness,
  liveLaunchPacketSchema,
  type LiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/schema";
import { contentHash } from "@/lib/ai-coach/canonical-json";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const NOW = new Date("2026-09-22T12:00:00.000Z");

const RUNTIME_CONFIGURATION = {
  schemaVersion: 1 as const,
  provider: {
    configurationId: "synthetic-final-provider-v1",
    version: 1,
    protocol: "STEADFAST_CONSTRAINED_JSON_V1" as const,
    gatewayUrl: "https://provider.invalid/v1/constrained",
    credentialEnvironmentVariable: "AI_COACH_PROVIDER_CREDENTIAL" as const,
    providerName: "Synthetic final-provider test double",
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
    limitations: [{ id: "SYNTHETIC_LIMITATION", text: "Synthetic test only." }],
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
    summary: "Synthetic test copy only.",
    informationHeading: "Synthetic eligibility information",
    disclosureParagraphs: ["Synthetic disclosure for contract testing only."],
    consentLabel: "I consent to this synthetic test.",
    confirmLabel: "Confirm synthetic choice",
    privacyNoticeLabel: "Review synthetic privacy notice",
    continueLabel: "Continue synthetic eligibility check",
    humanCoachLabel: "Find a synthetic human coach",
    privacyNoticeVersion: "synthetic-privacy-v1",
    privacyNoticeUrl: "https://example.invalid/privacy",
    eligibilitySummary: "Synthetic test accounts only.",
    pricing: null,
  },
};
const CONFIGURATION_DIGEST = contentHash(RUNTIME_CONFIGURATION);

function completeTestPacket(): LiveLaunchPacket {
  const approvalIds = new Map(
    REQUIRED_APPROVAL_REQUIREMENTS.map((requirement) => [
      requirement,
      `approval-${requirement.toLowerCase().replaceAll("_", "-")}`,
    ])
  );
  return liveLaunchPacketSchema.parse({
    schemaVersion: 1,
    packetId: "synthetic-complete-packet-v1",
    packetKey: "synthetic-complete-packet",
    version: 1,
    releaseId: "synthetic-release-v1",
    engineVersion: "synthetic-engine-v1",
    jurisdictions: ["SYNTHETIC_TEST_JURISDICTION"],
    authoredAt: "2026-09-21T12:00:00.000Z",
    authoringStatus: "DRAFT_NOT_AUTHORIZED",
    testOnly: true,
    runtimeConfiguration: RUNTIME_CONFIGURATION,
    runtimeConfigurationDigest: CONFIGURATION_DIGEST,
    sourceRecords: [{ id: "synthetic-source", path: "synthetic", digest: DIGEST }],
    artifactBindings: [
      "POLICY_BUNDLE",
      "FOOD_CATALOG",
      "EXERCISE_CATALOG",
      "EVIDENCE_REGISTRY",
      "ESCALATION_TEMPLATES",
    ].map((kind, index) => ({
      id: `synthetic-artifact-${index}`,
      artifactKey: `synthetic-artifact-key-${index}`,
      version: 1,
      kind,
      digest: DIGEST,
    })),
    decisionRecords: REQUIRED_DECISION_IDS.map((decisionId) => ({
      decisionId,
      status: "APPROVED",
      requiredHumanDecision: null,
      recordId: `synthetic-decision-record-${decisionId.toLowerCase()}`,
      recordDigest: DIGEST,
      approvalId: approvalIds.get("NUTRITION_PROFESSIONAL"),
    })),
    approvals: REQUIRED_APPROVAL_REQUIREMENTS.map((requirement) => ({
      approvalId: approvalIds.get(requirement),
      requirement,
      status: "APPROVED",
      requiredHumanDecision: null,
      reviewer: {
        name: "Synthetic Test Reviewer",
        role: "Synthetic Test Role",
        qualifications: ["SYNTHETIC TEST QUALIFICATION"],
      },
      scope: "Synthetic schema and fail-closed test only",
      jurisdictions: ["SYNTHETIC_TEST_JURISDICTION"],
      subjectReleaseId: "synthetic-release-v1",
      subjectArtifactDigests: Array.from({ length: 5 }, () => DIGEST),
      subjectConfigurationDigest: CONFIGURATION_DIGEST,
      recordId: `synthetic-approval-record-${requirement.toLowerCase().replaceAll("_", "-")}`,
      recordDigest: DIGEST,
      signedAt: "2026-09-21T12:00:00.000Z",
      expiresAt: "2026-09-23T12:00:00.000Z",
      signature: {
        method: "EXTERNAL_SIGNED_RECORD",
        reference: `synthetic-signature-${requirement.toLowerCase().replaceAll("_", "-")}`,
        digest: DIGEST,
      },
    })),
    evidence: REQUIRED_EVIDENCE_REQUIREMENTS.map((requirement) => ({
      evidenceId: `synthetic-evidence-${requirement.toLowerCase().replaceAll("_", "-")}`,
      requirement,
      status: "PASSED",
      requiredHumanDecision: null,
      subjectRevision: "synthetic-release-v1",
      subjectConfigurationDigest: CONFIGURATION_DIGEST,
      recordId: `synthetic-evidence-record-${requirement.toLowerCase().replaceAll("_", "-")}`,
      recordDigest: DIGEST,
      observedAt: "2026-09-21T12:00:00.000Z",
      expiresAt: "2026-09-23T12:00:00.000Z",
      attestation: {
        method: "EXTERNAL_SIGNED_RECORD",
        reference: `synthetic-attestation-${requirement.toLowerCase().replaceAll("_", "-")}`,
        digest: DIGEST,
      },
    })),
  });
}

function expectation(packet: LiveLaunchPacket) {
  return {
    packetId: packet.packetId,
    releaseId: packet.releaseId,
    engineVersion: packet.engineVersion,
    jurisdictions: packet.jurisdictions,
  };
}

function reasonCodes(packet: unknown, expected = expectation(completeTestPacket())) {
  return evaluateLiveLaunchPacketReadiness(packet, expected, NOW).reasons.map(
    (reason) => `${reason.code}:${reason.subject}`
  );
}

describe("AI Coach live-launch packet readiness", () => {
  it("keeps a structurally complete synthetic packet blocked solely by its test-only boundary", () => {
    const packet = completeTestPacket();
    expect(reasonCodes(packet, expectation(packet))).toEqual([
      `PACKET_TEST_ONLY:${packet.packetId}`,
    ]);
  });

  it("accepts the checked-in placeholder packet for authoring but rejects it for readiness", () => {
    const raw = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "docs/ai-coach/approval/live-launch-packet.template.v1.json"),
        "utf8"
      )
    ) as unknown;
    const packet = liveLaunchPacketSchema.parse(raw);
    const codes = reasonCodes(packet, expectation(packet));
    expect(codes).toContain(`PACKET_TEST_ONLY:${packet.packetId}`);
    expect(codes).toContain(`HUMAN_DECISION_REQUIRED:${packet.packetId}`);
    expect(codes).toContain("ARTIFACT_BINDING_MISSING:POLICY_BUNDLE");
    expect(codes).toContain("APPROVAL_NOT_CURRENT:NUTRITION_PROFESSIONAL");
    expect(codes).toContain("EVIDENCE_NOT_CURRENT:REAL_PROVIDER_EVALUATION");
    expect(codes).toContain("EVIDENCE_NOT_CURRENT:FULL_XCODE");
  });

  it("rejects missing, duplicate, and mismatched immutable artifact bindings", () => {
    const missing = completeTestPacket();
    missing.artifactBindings = missing.artifactBindings.slice(1);
    expect(reasonCodes(missing, expectation(missing))).toContain(
      "ARTIFACT_BINDING_MISSING:POLICY_BUNDLE"
    );

    const duplicate = completeTestPacket();
    duplicate.artifactBindings[1] = { ...duplicate.artifactBindings[0] };
    expect(reasonCodes(duplicate, expectation(duplicate))).toEqual([
      "PACKET_SCHEMA_INVALID:packet",
    ]);

    const mismatched = completeTestPacket();
    expect(
      reasonCodes(mismatched, { ...expectation(mismatched), engineVersion: "other-engine-v1" })
    ).toContain(`PACKET_IDENTITY_MISMATCH:${mismatched.packetId}`);
  });

  it("rejects missing, changed, and incompletely bound runtime configurations", () => {
    const missing = completeTestPacket();
    missing.runtimeConfiguration = null;
    missing.runtimeConfigurationDigest = null;
    expect(reasonCodes(missing, expectation(missing))).toContain(
      `RUNTIME_CONFIGURATION_MISSING:${missing.packetId}`
    );

    const changed = completeTestPacket();
    changed.runtimeConfiguration!.provider.modelIdentifier = "different-model-v1";
    expect(reasonCodes(changed, expectation(changed))).toContain(
      `RUNTIME_CONFIGURATION_DIGEST_MISMATCH:${changed.packetId}`
    );

    const approvalMismatch = completeTestPacket();
    approvalMismatch.approvals[0].subjectConfigurationDigest = OTHER_DIGEST;
    expect(reasonCodes(approvalMismatch, expectation(approvalMismatch))).toContain(
      "APPROVAL_NOT_CURRENT:NUTRITION_PROFESSIONAL"
    );

    const evidenceMismatch = completeTestPacket();
    evidenceMismatch.evidence[0].subjectConfigurationDigest = OTHER_DIGEST;
    expect(reasonCodes(evidenceMismatch, expectation(evidenceMismatch))).toContain(
      "EVIDENCE_NOT_CURRENT:T1005_ARTIFACT_INTEGRITY"
    );

    const privateGateway = completeTestPacket();
    privateGateway.runtimeConfiguration!.provider.gatewayUrl = "https://127.0.0.1/provider";
    expect(reasonCodes(privateGateway, expectation(privateGateway))).toEqual([
      "PACKET_SCHEMA_INVALID:packet",
    ]);
  });

  it("rejects every missing, deferred, or unsigned nutrition decision and approval", () => {
    const missingDecision = completeTestPacket();
    missingDecision.decisionRecords = missingDecision.decisionRecords.slice(1);
    expect(reasonCodes(missingDecision, expectation(missingDecision))).toContain(
      "DECISION_MISSING:D01"
    );

    const deferred = completeTestPacket();
    deferred.decisionRecords[0].status = "DEFERRED";
    expect(reasonCodes(deferred, expectation(deferred))).toContain("DECISION_NOT_APPROVED:D01");

    const wrongSigner = completeTestPacket();
    wrongSigner.decisionRecords[0].approvalId = wrongSigner.approvals.find(
      (approval) => approval.requirement === "LEGAL_SCOPE"
    )!.approvalId;
    expect(reasonCodes(wrongSigner, expectation(wrongSigner))).toContain(
      "DECISION_NOT_APPROVED:D01"
    );

    const unresolved = completeTestPacket();
    unresolved.decisionRecords[0].requiredHumanDecision = "A human choice is still unresolved";
    expect(reasonCodes(unresolved, expectation(unresolved))).toContain("DECISION_NOT_APPROVED:D01");

    for (const requirement of REQUIRED_APPROVAL_REQUIREMENTS) {
      const missing = completeTestPacket();
      missing.approvals = missing.approvals.filter(
        (approval) => approval.requirement !== requirement
      );
      expect(reasonCodes(missing, expectation(missing))).toContain(
        `APPROVAL_MISSING:${requirement}`
      );

      const unsigned = completeTestPacket();
      unsigned.approvals.find((approval) => approval.requirement === requirement)!.signature = null;
      expect(reasonCodes(unsigned, expectation(unsigned))).toContain(
        `APPROVAL_UNSIGNED:${requirement}`
      );
    }
  });

  it("rejects expired, future-dated, rejected, digest-mismatched, and placeholder approvals", () => {
    const cases: Array<[string, (packet: LiveLaunchPacket) => void]> = [
      ["expired", (packet) => (packet.approvals[0].expiresAt = NOW.toISOString())],
      ["future", (packet) => (packet.approvals[0].signedAt = "2026-09-24T12:00:00.000Z")],
      ["rejected", (packet) => (packet.approvals[0].status = "REJECTED")],
      ["revoked", (packet) => (packet.approvals[0].status = "REVOKED")],
    ];
    for (const [, mutate] of cases) {
      const packet = completeTestPacket();
      mutate(packet);
      expect(reasonCodes(packet, expectation(packet))).toContain(
        "APPROVAL_NOT_CURRENT:NUTRITION_PROFESSIONAL"
      );
    }

    const mismatch = completeTestPacket();
    mismatch.approvals[0].signature!.digest = OTHER_DIGEST;
    expect(reasonCodes(mismatch, expectation(mismatch))).toContain(
      "APPROVAL_DIGEST_MISMATCH:NUTRITION_PROFESSIONAL"
    );

    const placeholder = completeTestPacket();
    placeholder.approvals[0].requiredHumanDecision =
      "REQUIRED HUMAN DECISION: synthetic adversarial test";
    expect(reasonCodes(placeholder, expectation(placeholder))).toContain(
      `HUMAN_DECISION_REQUIRED:${placeholder.packetId}`
    );

    const unresolved = completeTestPacket();
    unresolved.approvals[0].requiredHumanDecision = "A human choice is still unresolved";
    expect(reasonCodes(unresolved, expectation(unresolved))).toContain(
      "APPROVAL_NOT_CURRENT:NUTRITION_PROFESSIONAL"
    );

    const wrongRelease = completeTestPacket();
    wrongRelease.approvals[0].subjectReleaseId = "different-release-v1";
    expect(reasonCodes(wrongRelease, expectation(wrongRelease))).toContain(
      "APPROVAL_NOT_CURRENT:NUTRITION_PROFESSIONAL"
    );

    const wrongArtifacts = completeTestPacket();
    wrongArtifacts.approvals[0].subjectArtifactDigests = [OTHER_DIGEST];
    expect(reasonCodes(wrongArtifacts, expectation(wrongArtifacts))).toContain(
      "APPROVAL_NOT_CURRENT:NUTRITION_PROFESSIONAL"
    );

    const wrongJurisdiction = completeTestPacket();
    wrongJurisdiction.approvals.find(
      (approval) => approval.requirement === "LEGAL_SCOPE"
    )!.jurisdictions = ["OTHER_TEST_JURISDICTION"];
    expect(reasonCodes(wrongJurisdiction, expectation(wrongJurisdiction))).toContain(
      "APPROVAL_NOT_CURRENT:LEGAL_SCOPE"
    );
  });

  it("rejects missing, stale, failed, unsigned, and digest-mismatched release evidence", () => {
    for (const requirement of REQUIRED_EVIDENCE_REQUIREMENTS) {
      const missing = completeTestPacket();
      missing.evidence = missing.evidence.filter((item) => item.requirement !== requirement);
      expect(reasonCodes(missing, expectation(missing))).toContain(
        `EVIDENCE_MISSING:${requirement}`
      );

      const stale = completeTestPacket();
      stale.evidence.find((item) => item.requirement === requirement)!.expiresAt =
        NOW.toISOString();
      expect(reasonCodes(stale, expectation(stale))).toContain(
        `EVIDENCE_NOT_CURRENT:${requirement}`
      );

      const unsigned = completeTestPacket();
      unsigned.evidence.find((item) => item.requirement === requirement)!.attestation = null;
      expect(reasonCodes(unsigned, expectation(unsigned))).toContain(
        `EVIDENCE_UNSIGNED:${requirement}`
      );
    }

    const failed = completeTestPacket();
    failed.evidence[0].status = "FAILED";
    expect(reasonCodes(failed, expectation(failed))).toContain(
      "EVIDENCE_NOT_CURRENT:T1005_ARTIFACT_INTEGRITY"
    );

    const mismatch = completeTestPacket();
    mismatch.evidence[0].attestation!.digest = OTHER_DIGEST;
    expect(reasonCodes(mismatch, expectation(mismatch))).toContain(
      "EVIDENCE_DIGEST_MISMATCH:T1005_ARTIFACT_INTEGRITY"
    );

    const wrongRelease = completeTestPacket();
    wrongRelease.evidence[0].subjectRevision = "different-release-v1";
    expect(reasonCodes(wrongRelease, expectation(wrongRelease))).toContain(
      "EVIDENCE_NOT_CURRENT:T1005_ARTIFACT_INTEGRITY"
    );

    const unresolved = completeTestPacket();
    unresolved.evidence[0].requiredHumanDecision = "A human choice is still unresolved";
    expect(reasonCodes(unresolved, expectation(unresolved))).toContain(
      "EVIDENCE_NOT_CURRENT:T1005_ARTIFACT_INTEGRITY"
    );
  });
});
