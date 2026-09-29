import { z } from "zod";
import { artifactKindSchema, artifactReferenceSchema } from "../artifacts/schema";
import { contentHash } from "../canonical-json";
import {
  MAX_NON_STREAMING_OUTPUT_TOKENS,
  MAX_TOKENS_PER_STAGE_CALL,
} from "../provider/spend-limits";

/**
 * A live-launch packet is an evidence index, not an approval UI or an
 * activation flag. Drafts may contain explicit human-decision placeholders;
 * the readiness evaluator rejects every placeholder and test-only packet.
 */

const identifierSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dateTimeSchema = z.string().datetime({ offset: true });

export const REQUIRED_DECISION_IDS = [
  "D01",
  "D02",
  "D03",
  "D04",
  "D05",
  "D06",
  "D07",
  "D08",
  "D09",
  "D10",
  "D11",
  "D12",
] as const;

/**
 * Every approval requirement a launch packet may carry. Unchanged from the
 * original seven-signer design: a packet that *does* carry a legal, privacy,
 * spend or governance signature is still expressible, still parsed, and still
 * validated in full (see `evaluateLiveLaunchPacketReadiness`, which checks
 * every approval present, not only the required ones).
 */
export const ALL_APPROVAL_REQUIREMENTS = [
  "NUTRITION_PROFESSIONAL",
  "LEGAL_SCOPE",
  "PROVIDER_PRIVACY_SECURITY",
  "OPERATIONAL_OWNER",
  "SLO_AND_SPEND_LIMITS",
  "INCIDENT_AND_REFERRAL_WORDING",
  "PRODUCT_GOVERNANCE",
] as const;

/**
 * S-20 / `board/V1-SCOPE.md` (Jaden, 2026-09-27): v1 ships in
 * **SINGLE_SIGNER_ACCOUNTABLE_OWNER** mode. One accountable owner, holding
 * dietitian and CPT credentials, signs the packet as NUTRITION_PROFESSIONAL —
 * the requirement all twelve decision records already bind to.
 *
 * This is a deliberate, recorded scope reduction, not a loosened check. What
 * the other six signatures bought and v1 therefore does without:
 *
 *   - LEGAL_SCOPE — nobody reviews the client-facing clinical copy for legal
 *     exposure, and nobody independently attests that the packet's
 *     jurisdictions are the ones the service may operate in. The jurisdiction
 *     equality check below and its SQL twin still run, but only when a
 *     LEGAL_SCOPE approval is actually present; with none, there is nothing
 *     to check them against.
 *   - PROVIDER_PRIVACY_SECURITY — no independent sign-off that the provider
 *     configuration (no request storage, no training use, no direct
 *     identifiers, no raw prompt logging) is acceptable. The DB trigger
 *     `guard_ai_coach_live_launch_runtime_configuration` still enforces those
 *     four flags mechanically; what is gone is a human attesting to them.
 *   - SLO_AND_SPEND_LIMITS — no independent sign-off on the latency, failure
 *     rate, token and spend ceilings. The ceilings are still enforced at
 *     runtime; nobody but the accountable owner has agreed they are right.
 *   - OPERATIONAL_OWNER, INCIDENT_AND_REFERRAL_WORDING, PRODUCT_GOVERNANCE —
 *     folded into the single accountable owner, who is the same person.
 *
 * Both enforcement points move together: the SQL validator
 * `validate_ai_coach_live_launch_approval`
 * (`prisma/migrations/20260928000000_ai_coach_single_signer_accountable_owner`)
 * accepts 1..7 approvals with exactly one NUTRITION_PROFESSIONAL and no
 * duplicate requirement, which is the same set this file accepts. A packet
 * accepted by one and refused by the other is the failure mode S-20 exists to
 * avoid; `tests/integration/ai-coach-live-launch-sql-gate.test.ts` pins it.
 */
export const LIVE_LAUNCH_APPROVAL_MODE = "SINGLE_SIGNER_ACCOUNTABLE_OWNER" as const;

export const REQUIRED_APPROVAL_REQUIREMENTS = ["NUTRITION_PROFESSIONAL"] as const;

export const REQUIRED_EVIDENCE_REQUIREMENTS = [
  "T1005_ARTIFACT_INTEGRITY",
  "T1006_AUTONOMY_GATE",
  "T1007_PROVIDER_BOUNDARY",
  "T1008_ACTIVATION_LIFECYCLE",
  "T1009_ADVERSARIAL_SUITE",
  "T1010_OPERATIONS_DRILL",
  "STAGING_KILL_SWITCH_DRILL",
  "REAL_PROVIDER_EVALUATION",
  "FULL_XCODE",
] as const;

const decisionIdSchema = z.enum(REQUIRED_DECISION_IDS);
const approvalRequirementSchema = z.enum(ALL_APPROVAL_REQUIREMENTS);
const evidenceRequirementSchema = z.enum(REQUIRED_EVIDENCE_REQUIREMENTS);

const signedRecordSchema = z
  .object({
    method: z.literal("EXTERNAL_SIGNED_RECORD"),
    reference: identifierSchema,
    digest: digestSchema,
  })
  .strict();

const reviewerSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    role: z.string().trim().min(1).max(160),
    qualifications: z.array(z.string().trim().min(1).max(240)).min(1).max(20),
  })
  .strict();

const providerConfigurationSchema = z
  .object({
    configurationId: identifierSchema,
    version: z.number().int().positive(),
    vendor: z.literal("ANTHROPIC"),
    apiBaseUrl: z.literal("https://api.anthropic.com"),
    credentialEnvironmentVariable: z.literal("AI_COACH_PROVIDER_CREDENTIAL"),
    providerName: z.string().trim().min(1).max(160),
    modelIdentifier: identifierSchema,
    effort: z.enum(["low", "medium", "high"]),
    pricing: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        inputMinorUnitsPerMillionTokens: z.number().int().nonnegative().max(100_000_000),
        outputMinorUnitsPerMillionTokens: z.number().int().nonnegative().max(100_000_000),
      })
      .strict(),
    processingRegion: z.string().trim().min(1).max(160),
    requestStorage: z.literal("DISABLED"),
    trainingUse: z.literal("DISABLED"),
    organizationDataControlsRecordId: identifierSchema,
    sendsDirectIdentifiers: z.literal(false),
    sendsCrossClientContext: z.literal(false),
    rawPromptOrTraceLogging: z.literal(false),
    timeoutMs: z.number().int().positive().max(45_000),
    maxAttempts: z.number().int().min(1).max(3),
    retryDelaysMs: z.array(z.number().int().nonnegative().max(300_000)).max(2),
    maxInputTokens: z.number().int().positive().max(MAX_TOKENS_PER_STAGE_CALL),
    maxOutputTokens: z.number().int().positive().max(MAX_TOKENS_PER_STAGE_CALL),
  })
  .strict()
  .superRefine((configuration, ctx) => {
    if (configuration.retryDelaysMs.length !== configuration.maxAttempts - 1) {
      ctx.addIssue({
        code: "custom",
        path: ["retryDelaysMs"],
        message: "Retry delays must contain exactly one entry per retry.",
      });
    }
    if (configuration.maxOutputTokens > MAX_NON_STREAMING_OUTPUT_TOKENS) {
      ctx.addIssue({
        code: "custom",
        path: ["maxOutputTokens"],
        message: "Output tokens must stay within the non-streaming response limit.",
      });
    }
  });

const providerBoundaryConfigurationSchema = z
  .object({
    promptContractVersion: z.literal("t1007-live-v1"),
    allowedPreferenceIds: z.array(identifierSchema).max(100),
    allowedClarificationIds: z.array(identifierSchema).max(100),
    limitations: z
      .array(z.object({ id: identifierSchema, text: z.string().trim().min(1).max(1_000) }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((configuration, ctx) => {
    reportDuplicateValues(
      configuration.allowedPreferenceIds,
      ctx,
      "allowedPreferenceIds",
      "Preference ID"
    );
    reportDuplicateValues(
      configuration.allowedClarificationIds,
      ctx,
      "allowedClarificationIds",
      "Clarification ID"
    );
    reportDuplicateValues(
      configuration.limitations.map((limitation) => limitation.id),
      ctx,
      "limitations",
      "Limitation ID"
    );
  });

const operationsConfigurationSchema = z
  .object({
    monitoringWindowMinutes: z.number().int().positive().max(1_440),
    maximumP95LatencyMs: z.number().int().positive(),
    maximumFailureRateBasisPoints: z.number().int().min(0).max(10_000),
    maximumTokensPerWindow: z.number().int().positive(),
    maximumSpendMinorUnitsPerWindow: z.number().int().nonnegative(),
    spendCurrency: z.string().regex(/^[A-Z]{3}$/),
    operationalOwnerRecordId: identifierSchema,
    incidentRunbookRecordId: identifierSchema,
    referralRunbookRecordId: identifierSchema,
  })
  .strict();

const discoveryConfigurationSchema = z
  .object({
    configurationId: identifierSchema,
    version: z.number().int().positive(),
    locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    serviceLabel: z.string().trim().min(1).max(160),
    headline: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(1_000),
    informationHeading: z.string().trim().min(1).max(160),
    disclosureParagraphs: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    consentLabel: z.string().trim().min(1).max(500),
    confirmLabel: z.string().trim().min(1).max(120),
    privacyNoticeLabel: z.string().trim().min(1).max(160),
    continueLabel: z.string().trim().min(1).max(160),
    humanCoachLabel: z.string().trim().min(1).max(160),
    privacyNoticeVersion: identifierSchema,
    privacyNoticeUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", "Privacy notice must use HTTPS."),
    eligibilitySummary: z.string().trim().min(1).max(1_000),
    pricing: z
      .object({
        productConfigurationId: identifierSchema,
        displayText: z.string().trim().min(1).max(240),
      })
      .strict()
      .nullable(),
  })
  .strict();

// `requestStorage`/`trainingUse` are attestations of an organization-level
// configuration, not request parameters: the Messages API has no per-request
// `store: false`, so zero-data-retention and no-training are set once for the
// whole Anthropic organization/workspace, and `organizationDataControlsRecordId`
// names the signed record that attests they are configured that way.
export const liveRuntimeConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: providerConfigurationSchema,
    providerBoundary: providerBoundaryConfigurationSchema,
    operations: operationsConfigurationSchema,
    discovery: discoveryConfigurationSchema,
  })
  .strict()
  .superRefine((configuration, ctx) => {
    if (configuration.provider.pricing.currency !== configuration.operations.spendCurrency) {
      ctx.addIssue({
        code: "custom",
        path: ["provider", "pricing", "currency"],
        message:
          "The provider pricing currency must match operations.spendCurrency, or the spend estimate and the window cap are in different currencies.",
      });
    }
  });
export type LiveRuntimeConfiguration = z.infer<typeof liveRuntimeConfigurationSchema>;

const approvalSchema = z
  .object({
    approvalId: identifierSchema,
    requirement: approvalRequirementSchema,
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "REVOKED"]),
    requiredHumanDecision: z.string().trim().min(1).max(800).nullable(),
    reviewer: reviewerSchema.nullable(),
    scope: z.string().trim().min(1).max(1000).nullable(),
    jurisdictions: z.array(z.string().trim().min(1).max(120)).max(50),
    subjectReleaseId: identifierSchema.nullable(),
    subjectArtifactDigests: z.array(digestSchema).max(5),
    subjectConfigurationDigest: digestSchema.nullable(),
    recordId: identifierSchema.nullable(),
    recordDigest: digestSchema.nullable(),
    signedAt: dateTimeSchema.nullable(),
    expiresAt: dateTimeSchema.nullable(),
    signature: signedRecordSchema.nullable(),
  })
  .strict();

const decisionRecordSchema = z
  .object({
    decisionId: decisionIdSchema,
    status: z.enum(["PENDING", "APPROVED", "APPROVED_WITH_LIMITS", "REJECTED", "DEFERRED"]),
    requiredHumanDecision: z.string().trim().min(1).max(1200).nullable(),
    recordId: identifierSchema.nullable(),
    recordDigest: digestSchema.nullable(),
    approvalId: identifierSchema.nullable(),
  })
  .strict();

const evidenceSchema = z
  .object({
    evidenceId: identifierSchema,
    requirement: evidenceRequirementSchema,
    status: z.enum(["MISSING", "PASSED", "FAILED", "EXPIRED"]),
    requiredHumanDecision: z.string().trim().min(1).max(800).nullable(),
    subjectRevision: z.string().trim().min(1).max(200).nullable(),
    subjectConfigurationDigest: digestSchema.nullable(),
    recordId: identifierSchema.nullable(),
    recordDigest: digestSchema.nullable(),
    observedAt: dateTimeSchema.nullable(),
    expiresAt: dateTimeSchema.nullable(),
    attestation: signedRecordSchema.nullable(),
  })
  .strict();

const sourceRecordSchema = z
  .object({
    id: identifierSchema,
    path: z.string().trim().min(1).max(500),
    digest: digestSchema,
  })
  .strict();

function reportDuplicateValues(
  values: readonly string[],
  ctx: z.RefinementCtx,
  path: string,
  label: string
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [path, index],
        message: `${label} values must be unique; duplicate: ${value}`,
      });
    }
    seen.add(value);
  });
}

export const liveLaunchPacketSchema = z
  .object({
    schemaVersion: z.literal(1),
    packetId: identifierSchema,
    packetKey: identifierSchema,
    version: z.number().int().positive(),
    releaseId: identifierSchema,
    engineVersion: identifierSchema,
    jurisdictions: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
    authoredAt: dateTimeSchema,
    authoringStatus: z.literal("DRAFT_NOT_AUTHORIZED"),
    testOnly: z.boolean(),
    runtimeConfiguration: liveRuntimeConfigurationSchema.nullable(),
    runtimeConfigurationDigest: digestSchema.nullable(),
    sourceRecords: z.array(sourceRecordSchema).min(1).max(100),
    artifactBindings: z.array(artifactReferenceSchema).max(5),
    decisionRecords: z.array(decisionRecordSchema).max(REQUIRED_DECISION_IDS.length),
    approvals: z.array(approvalSchema).min(1).max(ALL_APPROVAL_REQUIREMENTS.length),
    evidence: z.array(evidenceSchema).max(REQUIRED_EVIDENCE_REQUIREMENTS.length),
  })
  .strict()
  .superRefine((packet, ctx) => {
    reportDuplicateValues(packet.jurisdictions, ctx, "jurisdictions", "Jurisdiction");
    reportDuplicateValues(
      packet.sourceRecords.map((record) => record.id),
      ctx,
      "sourceRecords",
      "Source-record ID"
    );
    reportDuplicateValues(
      packet.artifactBindings.map((binding) => binding.kind),
      ctx,
      "artifactBindings",
      "Artifact kind"
    );
    reportDuplicateValues(
      packet.artifactBindings.map((binding) => binding.id),
      ctx,
      "artifactBindings",
      "Artifact ID"
    );
    reportDuplicateValues(
      packet.decisionRecords.map((decision) => decision.decisionId),
      ctx,
      "decisionRecords",
      "Decision ID"
    );
    reportDuplicateValues(
      packet.approvals.map((approval) => approval.approvalId),
      ctx,
      "approvals",
      "Approval ID"
    );
    reportDuplicateValues(
      packet.approvals.map((approval) => approval.requirement),
      ctx,
      "approvals",
      "Approval requirement"
    );
    reportDuplicateValues(
      packet.evidence.map((evidence) => evidence.evidenceId),
      ctx,
      "evidence",
      "Evidence ID"
    );
    reportDuplicateValues(
      packet.evidence.map((evidence) => evidence.requirement),
      ctx,
      "evidence",
      "Evidence requirement"
    );
  });

export type LiveLaunchPacket = z.infer<typeof liveLaunchPacketSchema>;

export type LiveLaunchExpectation = {
  packetId: string;
  releaseId: string;
  engineVersion: string;
  jurisdictions: string[];
};

export type LiveLaunchReadinessReason = {
  code:
    | "PACKET_SCHEMA_INVALID"
    | "PACKET_TEST_ONLY"
    | "PACKET_IDENTITY_MISMATCH"
    | "RUNTIME_CONFIGURATION_MISSING"
    | "RUNTIME_CONFIGURATION_DIGEST_MISMATCH"
    | "HUMAN_DECISION_REQUIRED"
    | "ARTIFACT_BINDING_MISSING"
    | "DECISION_MISSING"
    | "DECISION_NOT_APPROVED"
    | "APPROVAL_MISSING"
    | "APPROVAL_NOT_CURRENT"
    | "APPROVAL_UNSIGNED"
    | "APPROVAL_DIGEST_MISMATCH"
    | "EVIDENCE_MISSING"
    | "EVIDENCE_NOT_CURRENT"
    | "EVIDENCE_UNSIGNED"
    | "EVIDENCE_DIGEST_MISMATCH";
  subject: string;
};

const PLACEHOLDER = "REQUIRED HUMAN DECISION";

function containsHumanDecisionPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return value.includes(PLACEHOLDER);
  if (Array.isArray(value)) return value.some(containsHumanDecisionPlaceholder);
  if (value && typeof value === "object")
    return Object.values(value).some(containsHumanDecisionPlaceholder);
  return false;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

/** Pure, deterministic assessment used by authoring tools and the DB loader. */
export function evaluateLiveLaunchPacketReadiness(
  raw: unknown,
  expectation: LiveLaunchExpectation,
  now: Date = new Date()
): { packet: LiveLaunchPacket | null; ready: boolean; reasons: LiveLaunchReadinessReason[] } {
  const parsed = liveLaunchPacketSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      packet: null,
      ready: false,
      reasons: [{ code: "PACKET_SCHEMA_INVALID", subject: "packet" }],
    };
  }
  const packet = parsed.data;
  const reasons: LiveLaunchReadinessReason[] = [];
  const add = (code: LiveLaunchReadinessReason["code"], subject: string) => {
    if (!reasons.some((reason) => reason.code === code && reason.subject === subject))
      reasons.push({ code, subject });
  };

  if (packet.testOnly) add("PACKET_TEST_ONLY", packet.packetId);
  if (
    packet.packetId !== expectation.packetId ||
    packet.releaseId !== expectation.releaseId ||
    packet.engineVersion !== expectation.engineVersion ||
    !sameStrings(packet.jurisdictions, expectation.jurisdictions)
  )
    add("PACKET_IDENTITY_MISMATCH", packet.packetId);
  if (containsHumanDecisionPlaceholder(packet)) add("HUMAN_DECISION_REQUIRED", packet.packetId);
  if (!packet.runtimeConfiguration || !packet.runtimeConfigurationDigest) {
    add("RUNTIME_CONFIGURATION_MISSING", packet.packetId);
  } else if (contentHash(packet.runtimeConfiguration) !== packet.runtimeConfigurationDigest) {
    add("RUNTIME_CONFIGURATION_DIGEST_MISMATCH", packet.packetId);
  }

  const boundKinds = new Set(packet.artifactBindings.map((binding) => binding.kind));
  for (const kind of artifactKindSchema.options) {
    if (!boundKinds.has(kind)) add("ARTIFACT_BINDING_MISSING", kind);
  }

  const decisions = new Map(
    packet.decisionRecords.map((decision) => [decision.decisionId, decision] as const)
  );
  const nutritionApprovalId = packet.approvals.find(
    (approval) => approval.requirement === "NUTRITION_PROFESSIONAL"
  )?.approvalId;
  for (const decisionId of REQUIRED_DECISION_IDS) {
    const decision = decisions.get(decisionId);
    if (!decision) add("DECISION_MISSING", decisionId);
    else if (
      !["APPROVED", "APPROVED_WITH_LIMITS"].includes(decision.status) ||
      decision.requiredHumanDecision !== null ||
      !decision.recordId ||
      !decision.recordDigest ||
      !decision.approvalId ||
      decision.approvalId !== nutritionApprovalId
    )
      add("DECISION_NOT_APPROVED", decisionId);
  }

  const approvals = new Map(
    packet.approvals.map((approval) => [approval.requirement, approval] as const)
  );
  for (const requirement of REQUIRED_APPROVAL_REQUIREMENTS) {
    if (!approvals.has(requirement)) add("APPROVAL_MISSING", requirement);
  }
  // S-20: validate every approval the packet carries, not only the required
  // one. Under SINGLE_SIGNER_ACCOUNTABLE_OWNER the other six requirements are
  // optional, but the SQL half of this gate
  // (`validate_ai_coach_live_launch_approval`) loops over *all* of
  // `candidate->'approvals'`. Checking only the required subset here would
  // let a packet carrying, say, an expired LEGAL_SCOPE approval be reported
  // ready by this evaluator and then refused by the trigger — the exact
  // two-enforcement-points disagreement S-20 exists to prevent.
  for (const approval of packet.approvals) {
    const requirement = approval.requirement;
    const signedAt = approval.signedAt ? new Date(approval.signedAt) : null;
    const expiresAt = approval.expiresAt ? new Date(approval.expiresAt) : null;
    if (
      approval.status !== "APPROVED" ||
      approval.requiredHumanDecision !== null ||
      !approval.reviewer ||
      !approval.scope ||
      !approval.recordId ||
      !approval.recordDigest ||
      approval.subjectReleaseId !== packet.releaseId ||
      approval.subjectConfigurationDigest !== packet.runtimeConfigurationDigest ||
      !sameStrings(
        approval.subjectArtifactDigests,
        packet.artifactBindings.map((binding) => binding.digest)
      ) ||
      (requirement === "LEGAL_SCOPE" &&
        !sameStrings(approval.jurisdictions, packet.jurisdictions)) ||
      !signedAt ||
      signedAt > now ||
      !expiresAt ||
      expiresAt <= now
    )
      add("APPROVAL_NOT_CURRENT", requirement);
    if (!approval.signature) add("APPROVAL_UNSIGNED", requirement);
    else if (approval.signature.digest !== approval.recordDigest)
      add("APPROVAL_DIGEST_MISMATCH", requirement);
  }

  const evidenceByRequirement = new Map(
    packet.evidence.map((evidence) => [evidence.requirement, evidence] as const)
  );
  for (const requirement of REQUIRED_EVIDENCE_REQUIREMENTS) {
    const evidence = evidenceByRequirement.get(requirement);
    if (!evidence) {
      add("EVIDENCE_MISSING", requirement);
      continue;
    }
    const observedAt = evidence.observedAt ? new Date(evidence.observedAt) : null;
    const expiresAt = evidence.expiresAt ? new Date(evidence.expiresAt) : null;
    if (
      evidence.status !== "PASSED" ||
      evidence.requiredHumanDecision !== null ||
      evidence.subjectRevision !== packet.releaseId ||
      evidence.subjectConfigurationDigest !== packet.runtimeConfigurationDigest ||
      !evidence.recordId ||
      !evidence.recordDigest ||
      !observedAt ||
      observedAt > now ||
      !expiresAt ||
      expiresAt <= now
    )
      add("EVIDENCE_NOT_CURRENT", requirement);
    if (!evidence.attestation) add("EVIDENCE_UNSIGNED", requirement);
    else if (evidence.attestation.digest !== evidence.recordDigest)
      add("EVIDENCE_DIGEST_MISMATCH", requirement);
  }

  return { packet, ready: reasons.length === 0, reasons };
}
