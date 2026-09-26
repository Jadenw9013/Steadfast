import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { contentHash } from "../canonical-json";
import { requireGovernanceGrant } from "../operations";
import { artifactContentDigest } from "./digest";
import {
  type ArtifactContent,
  type ArtifactDraftInput,
  type ArtifactKind,
  type ArtifactReference,
  type ArtifactReviewMetadata,
  type PolicyBundleContent,
  type SignedArtifactReviewMetadata,
  artifactReferenceSchema,
  escalationTemplatesContentSchema,
  evidenceRegistryContentSchema,
  exerciseCatalogContentSchema,
  policyBundleContentSchema,
  parseArtifactContent,
  parseArtifactDraftInput,
  isDraftUnsignedReviewMetadata,
} from "./schema";
import { z } from "zod";

/** Trusted server tooling only. No route/model tool is allowed to register facts. */

export type ArtifactLoadErrorCode =
  | "ARTIFACT_MISSING"
  | "ARTIFACT_NOT_PUBLISHED"
  | "ARTIFACT_NOT_EFFECTIVE"
  | "ARTIFACT_EXPIRED"
  | "ARTIFACT_REVOKED"
  | "ARTIFACT_INCOMPATIBLE"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "ARTIFACT_INVALID"
  | "ACCOUNT_NOT_ELIGIBLE"
  | "SYNTHETIC_ARTIFACT_FORBIDDEN"
  | "ARTIFACT_UNSIGNED_DRAFT"
  | "UNKNOWN_CATALOG_ID";

export class ArtifactLoadError extends Error {
  constructor(
    public readonly code: ArtifactLoadErrorCode,
    message: string
  ) {
    super(message);
  }
}

type ArtifactStore = Pick<Prisma.TransactionClient, "aiCoachArtifactVersion" | "$queryRaw">;

type PersistedArtifact = {
  id: string;
  artifactKey: string;
  version: number;
  kind: ArtifactKind;
  state: "DRAFT" | "PUBLISHED" | "REVOKED";
  schemaVersion: number;
  engineVersions: string[];
  dependencies: unknown;
  content: unknown;
  contentDigest: string;
  synthetic: boolean;
  reviewMetadata: unknown;
  effectiveAt: Date | null;
  expiresAt: Date | null;
  publishedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
};

export type LoadedArtifact = {
  id: string;
  artifactKey: string;
  version: number;
  kind: ArtifactKind;
  schemaVersion: 1;
  engineVersions: string[];
  dependencies: ArtifactReference[];
  content: ArtifactContent;
  contentDigest: string;
  synthetic: boolean;
  reviewMetadata: SignedArtifactReviewMetadata;
  effectiveAt: Date;
  expiresAt: Date;
  publishedAt: Date;
};

export type ReviewedArtifactSet = {
  policy: LoadedArtifact;
  foodCatalog: LoadedArtifact;
  exerciseCatalog: LoadedArtifact;
  evidenceRegistry: LoadedArtifact;
  escalationTemplates: LoadedArtifact;
};

export type ArtifactLoadRequest = {
  engineVersion: string;
  policyArtifactKey: string;
  exactReferences?: ArtifactReference[];
};

export type LiveArtifactSetLoadRequest = {
  engineVersion: string;
  references: ArtifactReference[];
  now: Date;
};

type ArtifactCompatibilityContext = {
  engineVersion: string;
  now: Date;
};

const verifiedLoadedArtifacts = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rawDigest(row: PersistedArtifact): string {
  return contentHash({
    id: row.id,
    artifactKey: row.artifactKey,
    version: row.version,
    kind: row.kind,
    schemaVersion: row.schemaVersion,
    engineVersions: row.engineVersions,
    dependencies: row.dependencies,
    synthetic: row.synthetic,
    reviewMetadata: row.reviewMetadata,
    content: row.content,
  });
}

function parsePersistedArtifact(
  row: PersistedArtifact
): ArtifactDraftInput<ArtifactReviewMetadata> {
  if (rawDigest(row) !== row.contentDigest) {
    throw new ArtifactLoadError(
      "ARTIFACT_DIGEST_MISMATCH",
      "The reviewed artifact digest does not match persisted content."
    );
  }
  try {
    return parseArtifactDraftInput({
      id: row.id,
      artifactKey: row.artifactKey,
      version: row.version,
      kind: row.kind,
      schemaVersion: row.schemaVersion,
      engineVersions: row.engineVersions,
      dependencies: row.dependencies,
      synthetic: row.synthetic,
      reviewMetadata: row.reviewMetadata,
      content: row.content,
    });
  } catch {
    throw new ArtifactLoadError(
      "ARTIFACT_INVALID",
      "The reviewed artifact does not satisfy its strict schema."
    );
  }
}

function assertUsable(
  row: PersistedArtifact,
  draft: ArtifactDraftInput<ArtifactReviewMetadata>,
  context: ArtifactCompatibilityContext
): LoadedArtifact {
  if (isDraftUnsignedReviewMetadata(draft.reviewMetadata)) {
    throw new ArtifactLoadError(
      "ARTIFACT_UNSIGNED_DRAFT",
      "Draft unsigned artifacts cannot be loaded as usable artifacts."
    );
  }
  const now = context.now;
  if (row.state === "REVOKED" || row.revokedAt) {
    throw new ArtifactLoadError("ARTIFACT_REVOKED", "The reviewed artifact has been revoked.");
  }
  if (row.state !== "PUBLISHED" || !row.publishedAt || !row.effectiveAt || !row.expiresAt) {
    throw new ArtifactLoadError(
      "ARTIFACT_NOT_PUBLISHED",
      "The reviewed artifact is not published."
    );
  }
  if (row.effectiveAt > now) {
    throw new ArtifactLoadError(
      "ARTIFACT_NOT_EFFECTIVE",
      "The reviewed artifact is not effective yet."
    );
  }
  if (row.expiresAt <= now) {
    throw new ArtifactLoadError("ARTIFACT_EXPIRED", "The reviewed artifact has expired.");
  }
  if (!draft.engineVersions.includes(context.engineVersion)) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The reviewed artifact is incompatible with this engine version."
    );
  }
  const loaded: LoadedArtifact = {
    ...draft,
    reviewMetadata: draft.reviewMetadata,
    contentDigest: row.contentDigest,
    effectiveAt: row.effectiveAt,
    expiresAt: row.expiresAt,
    publishedAt: row.publishedAt,
  };
  deepFreeze(loaded);
  verifiedLoadedArtifacts.add(loaded);
  return loaded;
}

function assertVerifiedLoadedArtifact(artifact: LoadedArtifact) {
  if (!verifiedLoadedArtifacts.has(artifact)) {
    throw new ArtifactLoadError(
      "ARTIFACT_INVALID",
      "Catalog access requires an artifact returned by the reviewed server loader."
    );
  }
  const digest = artifactContentDigest({
    id: artifact.id,
    artifactKey: artifact.artifactKey,
    version: artifact.version,
    kind: artifact.kind,
    schemaVersion: artifact.schemaVersion,
    engineVersions: artifact.engineVersions,
    dependencies: artifact.dependencies,
    synthetic: artifact.synthetic,
    reviewMetadata: artifact.reviewMetadata,
    content: artifact.content,
  });
  if (digest !== artifact.contentDigest) {
    throw new ArtifactLoadError(
      "ARTIFACT_DIGEST_MISMATCH",
      "The loaded artifact was modified after server verification."
    );
  }
}

async function loadArtifactByReference(
  store: ArtifactStore,
  reference: ArtifactReference,
  context: ArtifactCompatibilityContext
): Promise<LoadedArtifact> {
  await store.$queryRaw`SELECT "id" FROM "AiCoachArtifactVersion" WHERE "id" = ${reference.id} FOR SHARE`;
  const row = (await store.aiCoachArtifactVersion.findUnique({
    where: { id: reference.id },
  })) as PersistedArtifact | null;
  if (!row)
    throw new ArtifactLoadError("ARTIFACT_MISSING", "A required reviewed artifact is missing.");
  if (
    row.kind !== reference.kind ||
    row.artifactKey !== reference.artifactKey ||
    row.version !== reference.version
  ) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "A required reviewed artifact identity does not match its reference."
    );
  }
  if (row.contentDigest !== reference.digest) {
    throw new ArtifactLoadError(
      "ARTIFACT_DIGEST_MISMATCH",
      "A required reviewed artifact digest does not match its reference."
    );
  }
  return assertUsable(row, parsePersistedArtifact(row), context);
}

function assertAccountClassification(
  artifact: LoadedArtifact,
  persistedClassification: "SYNTHETIC" | "LIVE"
) {
  if (artifact.synthetic && persistedClassification !== "SYNTHETIC") {
    throw new ArtifactLoadError(
      "SYNTHETIC_ARTIFACT_FORBIDDEN",
      "Synthetic artifacts cannot govern a persisted non-synthetic account."
    );
  }
  if (!artifact.synthetic && persistedClassification !== "LIVE") {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "A synthetic test account cannot use a live artifact classification."
    );
  }
}

function assertArtifactSetReferences(set: ReviewedArtifactSet) {
  const policy = policyBundleContentSchema.parse(set.policy.content);
  const exercise = exerciseCatalogContentSchema.parse(set.exerciseCatalog.content);
  const evidence = evidenceRegistryContentSchema.parse(set.evidenceRegistry.content);
  const escalation = escalationTemplatesContentSchema.parse(set.escalationTemplates.content);
  const policyRuleIds = new Set(policy.ruleIds);
  const evidenceClaimIds = new Set(evidence.claims.map((claim) => claim.id));
  const escalationTemplateIds = new Set(escalation.templates.map((template) => template.id));
  const escalationById = new Map(
    escalation.templates.map((template) => [template.id, template] as const)
  );

  for (const templateId of policy.escalationTemplateIds) {
    if (!escalationTemplateIds.has(templateId)) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        `Policy references unknown escalation template ID: ${templateId}`
      );
    }
  }
  const safetyEscalations = [
    {
      templateId: policy.safetyControls.screening.escalationTemplateId,
      reasonCodes: [
        policy.safetyControls.screening.flaggedReasonCode,
        policy.safetyControls.screening.unknownReasonCode,
      ],
    },
    ...policy.safetyControls.contraindications.map((rule) => ({
      templateId: rule.escalationTemplateId,
      reasonCodes: [rule.reasonCode],
    })),
  ];
  for (const binding of safetyEscalations) {
    const template = escalationById.get(binding.templateId);
    if (!template) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        `Safety control references unknown escalation template ID: ${binding.templateId}`
      );
    }
    for (const reasonCode of binding.reasonCodes) {
      if (!template.reasonCodes.includes(reasonCode)) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          `Safety control reason is not supported by its escalation template: ${reasonCode}`
        );
      }
    }
  }
  for (const parameter of policy.numericParameters) {
    for (const claimId of parameter.evidenceClaimIds) {
      if (!evidenceClaimIds.has(claimId)) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          `Policy references unknown evidence claim ID: ${claimId}`
        );
      }
    }
  }
  for (const claim of evidence.claims) {
    for (const ruleId of claim.ruleIds) {
      if (!policyRuleIds.has(ruleId)) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          `Evidence claim references unknown policy rule ID: ${ruleId}`
        );
      }
    }
  }
  for (const exerciseItem of exercise.exercises) {
    for (const ruleId of [
      ...exerciseItem.contraindicationRuleIds,
      ...exerciseItem.beginnerConstraintIds,
    ]) {
      if (!policyRuleIds.has(ruleId)) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          `Exercise references unknown policy rule ID: ${ruleId}`
        );
      }
    }
  }
  for (const template of exercise.templates) {
    for (const ruleId of template.beginnerConstraintIds) {
      if (!policyRuleIds.has(ruleId)) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          `Exercise template references unknown policy rule ID: ${ruleId}`
        );
      }
    }
  }
}

function artifactSetFromDependencies(
  policy: LoadedArtifact,
  dependencies: Map<ArtifactKind, LoadedArtifact>
): ReviewedArtifactSet {
  const foodCatalog = dependencies.get("FOOD_CATALOG");
  const exerciseCatalog = dependencies.get("EXERCISE_CATALOG");
  const evidenceRegistry = dependencies.get("EVIDENCE_REGISTRY");
  const escalationTemplates = dependencies.get("ESCALATION_TEMPLATES");
  if (!foodCatalog || !exerciseCatalog || !evidenceRegistry || !escalationTemplates) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The policy bundle is missing a required compatible dependency."
    );
  }
  return { policy, foodCatalog, exerciseCatalog, evidenceRegistry, escalationTemplates };
}

/**
 * Server-governance loader for an exact, packet-bound live artifact set.
 * It never selects a latest version and refuses synthetic/mixed sets. This is
 * intentionally not exposed through a route or model tool.
 */
export async function loadLiveArtifactSetForLaunchValidation(
  store: Prisma.TransactionClient,
  input: LiveArtifactSetLoadRequest
): Promise<ReviewedArtifactSet> {
  const referenceListSchema = z
    .array(artifactReferenceSchema)
    .length(5)
    .superRefine((references, ctx) => {
      const kinds = references.map((reference) => reference.kind);
      const ids = references.map((reference) => reference.id);
      if (new Set(kinds).size !== kinds.length)
        ctx.addIssue({ code: "custom", message: "Artifact kinds must be unique." });
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: "Artifact IDs must be unique." });
    });
  const parsed = referenceListSchema.safeParse(input.references);
  if (!parsed.success) {
    throw new ArtifactLoadError(
      "ARTIFACT_INVALID",
      "A live launch requires exactly one immutable reference for every artifact kind."
    );
  }
  const referencesByKind = new Map(
    parsed.data.map((reference) => [reference.kind, reference] as const)
  );
  for (const kind of [
    "POLICY_BUNDLE",
    "FOOD_CATALOG",
    "EXERCISE_CATALOG",
    "EVIDENCE_REGISTRY",
    "ESCALATION_TEMPLATES",
  ] as const) {
    if (!referencesByKind.has(kind)) {
      throw new ArtifactLoadError(
        "ARTIFACT_MISSING",
        `The live-launch packet is missing the required ${kind} binding.`
      );
    }
  }

  const policy = await loadArtifactByReference(store, referencesByKind.get("POLICY_BUNDLE")!, {
    engineVersion: input.engineVersion,
    now: input.now,
  });
  if (isDraftUnsignedReviewMetadata(policy.reviewMetadata)) {
    throw new ArtifactLoadError(
      "ARTIFACT_UNSIGNED_DRAFT",
      "Draft unsigned artifacts cannot satisfy live-launch readiness."
    );
  }
  if (policy.synthetic) {
    throw new ArtifactLoadError(
      "SYNTHETIC_ARTIFACT_FORBIDDEN",
      "Synthetic artifacts can never satisfy live-launch readiness."
    );
  }
  if (policy.dependencies.length !== 4) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The live policy must bind exactly one dependency of every required kind."
    );
  }

  const dependencies = new Map<ArtifactKind, LoadedArtifact>();
  for (const dependencyReference of policy.dependencies) {
    const packetReference = referencesByKind.get(dependencyReference.kind);
    if (
      !packetReference ||
      packetReference.id !== dependencyReference.id ||
      packetReference.artifactKey !== dependencyReference.artifactKey ||
      packetReference.version !== dependencyReference.version ||
      packetReference.digest !== dependencyReference.digest
    ) {
      throw new ArtifactLoadError(
        "ARTIFACT_DIGEST_MISMATCH",
        "The packet artifact binding does not match the immutable policy dependency set."
      );
    }
    const dependency = await loadArtifactByReference(store, dependencyReference, {
      engineVersion: input.engineVersion,
      now: input.now,
    });
    if (isDraftUnsignedReviewMetadata(dependency.reviewMetadata)) {
      throw new ArtifactLoadError(
        "ARTIFACT_UNSIGNED_DRAFT",
        "Draft unsigned artifacts cannot satisfy live-launch readiness."
      );
    }
    if (dependency.synthetic) {
      throw new ArtifactLoadError(
        "SYNTHETIC_ARTIFACT_FORBIDDEN",
        "Synthetic artifacts can never satisfy live-launch readiness."
      );
    }
    dependencies.set(dependency.kind, dependency);
  }
  const set = artifactSetFromDependencies(policy, dependencies);
  assertArtifactSetReferences(set);
  deepFreeze(set);
  return set;
}

/** Inserts one immutable, already-reviewed version in DRAFT lifecycle state. */
export async function registerArtifactVersion(raw: unknown) {
  const draft = parseArtifactDraftInput(raw);
  const contentDigest = artifactContentDigest(draft);
  return db.aiCoachArtifactVersion.create({
    data: {
      id: draft.id,
      artifactKey: draft.artifactKey,
      version: draft.version,
      kind: draft.kind,
      schemaVersion: draft.schemaVersion,
      engineVersions: draft.engineVersions,
      dependencies: jsonValue(draft.dependencies),
      content: jsonValue(draft.content),
      contentDigest,
      synthetic: draft.synthetic,
      reviewMetadata: jsonValue(draft.reviewMetadata),
    },
  });
}

/**
 * Publishes only a fully reviewed immutable version. Policy dependencies must
 * already be published, active, digest-matching and compatible at its effective
 * time; the function never fills missing review or policy facts.
 */
export async function publishArtifactVersion(input: {
  id: string;
  effectiveAt: Date;
  expiresAt: Date;
  engineVersion: string;
  governance?: {
    actorUserId: string;
    reasonCode: string;
    incidentReference?: string | null;
  };
}) {
  if (process.env.NODE_ENV === "production" && !input.governance) {
    throw new ArtifactLoadError(
      "ARTIFACT_INVALID",
      "Production artifact publication requires an authorized governance context."
    );
  }
  const publishedAt = new Date();
  if (input.expiresAt <= input.effectiveAt || input.expiresAt <= publishedAt) {
    throw new ArtifactLoadError(
      "ARTIFACT_INVALID",
      "Publication requires an explicit future expiry after the effective date."
    );
  }
  return db.$transaction(async (tx) => {
    const governanceGrant = input.governance
      ? await requireGovernanceGrant(input.governance.actorUserId, "PUBLISH_ARTIFACTS", tx)
      : null;
    if (governanceGrant) {
      const control = await tx.aiCoachOperationalControl.findUnique({
        where: { scope: "ARTIFACT_PUBLICATION" },
      });
      if (control?.disabled) {
        throw new ArtifactLoadError(
          "ARTIFACT_INVALID",
          "Artifact publication is disabled by the operational control."
        );
      }
    }
    await tx.$queryRaw`SELECT "id" FROM "AiCoachArtifactVersion" WHERE "id" = ${input.id} FOR UPDATE`;
    const row = (await tx.aiCoachArtifactVersion.findUnique({
      where: { id: input.id },
    })) as PersistedArtifact | null;
    if (!row)
      throw new ArtifactLoadError("ARTIFACT_MISSING", "The artifact version does not exist.");
    if (row.state !== "DRAFT")
      throw new ArtifactLoadError(
        "ARTIFACT_INVALID",
        "Only a draft artifact version can be published."
      );
    const draft = parsePersistedArtifact(row);
    if (isDraftUnsignedReviewMetadata(draft.reviewMetadata)) {
      throw new ArtifactLoadError(
        "ARTIFACT_UNSIGNED_DRAFT",
        "A draft unsigned artifact cannot be published."
      );
    }
    if (!draft.engineVersions.includes(input.engineVersion)) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        "The reviewed artifact is incompatible with this engine version."
      );
    }
    if (draft.kind === "POLICY_BUNDLE") {
      const policy = assertUsable(
        {
          ...row,
          state: "PUBLISHED",
          publishedAt,
          effectiveAt: input.effectiveAt,
          expiresAt: input.expiresAt,
        },
        draft,
        { engineVersion: input.engineVersion, now: input.effectiveAt }
      );
      const dependencies = new Map<ArtifactKind, LoadedArtifact>();
      for (const reference of draft.dependencies) {
        const dependency = await loadArtifactByReference(tx, reference, {
          engineVersion: input.engineVersion,
          now: input.effectiveAt,
        });
        if (dependency.expiresAt < input.expiresAt) {
          throw new ArtifactLoadError(
            "ARTIFACT_INCOMPATIBLE",
            "A policy dependency must remain effective for the full policy publication window."
          );
        }
        dependencies.set(reference.kind, dependency);
      }
      if (
        [...dependencies.values()].some((dependency) => dependency.synthetic !== draft.synthetic)
      ) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          "A policy and all of its dependencies must share the same synthetic/live classification."
        );
      }
      assertArtifactSetReferences(artifactSetFromDependencies(policy, dependencies));
    }
    await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_artifact_lifecycle_action', 'PUBLISH', true)`;
    const updated = await tx.aiCoachArtifactVersion.update({
      where: { id: input.id },
      data: {
        state: "PUBLISHED",
        publishedAt,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
      },
    });
    if (governanceGrant && input.governance) {
      await tx.aiCoachArtifactLifecycleEvent.create({
        data: {
          actorUserId: input.governance.actorUserId,
          governanceGrantId: governanceGrant.id,
          artifactVersionId: row.id,
          action: "PUBLISH",
          reasonCode: input.governance.reasonCode,
          reviewRecordId: draft.reviewMetadata.reviewRecordId,
          incidentReference: input.governance.incidentReference ?? null,
        },
      });
    }
    return updated;
  });
}

export async function revokeArtifactVersion(
  id: string,
  reason: string,
  governance?: {
    actorUserId: string;
    reasonCode: string;
    reviewRecordId: string;
    incidentReference?: string | null;
  }
) {
  if (process.env.NODE_ENV === "production" && !governance) {
    throw new ArtifactLoadError(
      "ARTIFACT_INVALID",
      "Production artifact revocation requires an authorized governance context."
    );
  }
  const normalizedReason = reason.trim();
  if (!normalizedReason)
    throw new ArtifactLoadError("ARTIFACT_INVALID", "Revocation requires an accountable reason.");
  return db.$transaction(async (tx) => {
    const governanceGrant = governance
      ? await requireGovernanceGrant(governance.actorUserId, "REVOKE_ARTIFACTS", tx)
      : null;
    await tx.$queryRaw`SELECT "id" FROM "AiCoachArtifactVersion" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.aiCoachArtifactVersion.findUnique({ where: { id } });
    if (!row)
      throw new ArtifactLoadError("ARTIFACT_MISSING", "The artifact version does not exist.");
    if (row.state !== "PUBLISHED")
      throw new ArtifactLoadError(
        "ARTIFACT_INVALID",
        "Only a published artifact version can be revoked."
      );
    await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_artifact_lifecycle_action', 'REVOKE', true)`;
    const updated = await tx.aiCoachArtifactVersion.update({
      where: { id },
      data: { state: "REVOKED", revokedAt: new Date(), revocationReason: normalizedReason },
    });
    if (governanceGrant && governance) {
      await tx.aiCoachArtifactLifecycleEvent.create({
        data: {
          actorUserId: governance.actorUserId,
          governanceGrantId: governanceGrant.id,
          artifactVersionId: row.id,
          action: "REVOKE",
          reasonCode: governance.reasonCode,
          reviewRecordId: governance.reviewRecordId,
          incidentReference: governance.incidentReference ?? null,
        },
      });
      for (const scope of ["GENERATION", "PROVIDER", "FINALIZATION", "ACCEPTANCE"] as const) {
        const current = await tx.aiCoachOperationalControl.findUnique({ where: { scope } });
        const revision = (current?.revision ?? -1) + 1;
        await tx.aiCoachOperationalControl.upsert({
          where: { scope },
          create: {
            scope,
            disabled: true,
            reasonCode: "ARTIFACT_REVOKED",
            incidentReference: governance.incidentReference ?? null,
            updatedByGrantId: governanceGrant.id,
            revision,
          },
          update: {
            disabled: true,
            reasonCode: "ARTIFACT_REVOKED",
            incidentReference: governance.incidentReference ?? null,
            updatedByGrantId: governanceGrant.id,
            revision,
          },
        });
        await tx.aiCoachOperationalEvent.create({
          data: {
            actorUserId: governance.actorUserId,
            scope,
            disabled: true,
            reasonCode: "ARTIFACT_REVOKED",
            incidentReference: governance.incidentReference ?? null,
            revision,
          },
        });
      }
    }
    return updated;
  });
}

export async function loadReviewedArtifactSet(
  input: ArtifactLoadRequest
): Promise<ReviewedArtifactSet> {
  return withReviewedArtifactSetForCurrentClient(input, async ({ artifacts }) => artifacts);
}

export type ReviewedArtifactTransactionContext = {
  tx: Prisma.TransactionClient;
  clientId: string;
  artifacts: ReviewedArtifactSet;
};

/**
 * Runs a bounded server callback while the authenticated account/profile and
 * all resolved artifact versions remain locked. The authenticated identity is
 * resolved internally; no caller-supplied client ID or synthetic flag exists.
 */
export async function withReviewedArtifactSetForCurrentClient<T>(
  input: ArtifactLoadRequest,
  use: (context: ReviewedArtifactTransactionContext) => Promise<T>
): Promise<T> {
  const authenticatedUser = await getCurrentDbUser();
  const now = new Date();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${authenticatedUser.id} FOR UPDATE`;
    const account = await tx.user.findUnique({
      where: { id: authenticatedUser.id },
      select: { id: true, isClient: true, isDeactivated: true },
    });
    await tx.$queryRaw`SELECT "id" FROM "AiCoachProfile" WHERE "clientId" = ${authenticatedUser.id} FOR UPDATE`;
    const profile = await tx.aiCoachProfile.findUnique({
      where: { clientId: authenticatedUser.id },
      select: { isSynthetic: true },
    });
    if (!account?.isClient || account.isDeactivated || !profile) {
      throw new ArtifactLoadError(
        "ACCOUNT_NOT_ELIGIBLE",
        "An active persisted client profile is required to load reviewed artifacts."
      );
    }
    const persistedClassification = profile.isSynthetic ? "SYNTHETIC" : "LIVE";

    if (input.exactReferences) {
      const artifacts = await loadLiveArtifactSetForLaunchValidation(tx, {
        engineVersion: input.engineVersion,
        references: input.exactReferences,
        now,
      });
      for (const artifact of Object.values(artifacts)) {
        assertAccountClassification(artifact, persistedClassification);
      }
      return use({ tx, clientId: account.id, artifacts });
    }

    const versions = (await tx.aiCoachArtifactVersion.findMany({
      where: {
        kind: "POLICY_BUNDLE",
        artifactKey: input.policyArtifactKey,
        state: { in: ["PUBLISHED", "REVOKED"] },
      },
      orderBy: [{ version: "desc" }],
    })) as PersistedArtifact[];
    if (versions.length === 0)
      throw new ArtifactLoadError("ARTIFACT_MISSING", "No published policy bundle exists.");
    const selected = versions.find((version) => version.effectiveAt && version.effectiveAt <= now);
    if (!selected)
      throw new ArtifactLoadError("ARTIFACT_NOT_EFFECTIVE", "No policy bundle is effective yet.");
    const policy = await loadArtifactByReference(
      tx,
      {
        id: selected.id,
        artifactKey: selected.artifactKey,
        version: selected.version,
        kind: selected.kind,
        digest: selected.contentDigest,
      },
      { engineVersion: input.engineVersion, now }
    );
    assertAccountClassification(policy, persistedClassification);

    const dependencies = new Map<ArtifactKind, LoadedArtifact>();
    for (const reference of policy.dependencies) {
      const dependency = await loadArtifactByReference(tx, reference, {
        engineVersion: input.engineVersion,
        now,
      });
      assertAccountClassification(dependency, persistedClassification);
      dependencies.set(reference.kind, dependency);
    }
    const set = artifactSetFromDependencies(policy, dependencies);
    if (
      [set.foodCatalog, set.exerciseCatalog, set.evidenceRegistry, set.escalationTemplates].some(
        (artifact) => artifact.synthetic !== policy.synthetic
      )
    ) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        "The policy and dependency classifications do not match."
      );
    }
    assertArtifactSetReferences(set);
    deepFreeze(set);
    return use({ tx, clientId: account.id, artifacts: set });
  });
}

export function getReviewedPolicyBundleContent(artifact: LoadedArtifact): PolicyBundleContent {
  assertVerifiedLoadedArtifact(artifact);
  if (artifact.kind !== "POLICY_BUNDLE") {
    throw new ArtifactLoadError("ARTIFACT_INCOMPATIBLE", "A reviewed policy bundle is required.");
  }
  return policyBundleContentSchema.parse(artifact.content);
}

export function getReviewedFoodItem(artifact: LoadedArtifact, itemId: string) {
  assertVerifiedLoadedArtifact(artifact);
  if (artifact.kind !== "FOOD_CATALOG")
    throw new ArtifactLoadError("ARTIFACT_INCOMPATIBLE", "A food catalog is required.");
  const content = parseArtifactContent("FOOD_CATALOG", artifact.content);
  if (!("items" in content))
    throw new ArtifactLoadError("ARTIFACT_INVALID", "The food catalog content is invalid.");
  const item = content.items.find((candidate) => candidate.id === itemId);
  if (!item)
    throw new ArtifactLoadError(
      "UNKNOWN_CATALOG_ID",
      "The food identifier is not in the reviewed catalog."
    );
  return item;
}

export function getReviewedExerciseItem(artifact: LoadedArtifact, itemId: string) {
  assertVerifiedLoadedArtifact(artifact);
  if (artifact.kind !== "EXERCISE_CATALOG")
    throw new ArtifactLoadError("ARTIFACT_INCOMPATIBLE", "An exercise catalog is required.");
  const content = parseArtifactContent("EXERCISE_CATALOG", artifact.content);
  if (!("exercises" in content))
    throw new ArtifactLoadError("ARTIFACT_INVALID", "The exercise catalog content is invalid.");
  const item = content.exercises.find((candidate) => candidate.id === itemId);
  if (!item)
    throw new ArtifactLoadError(
      "UNKNOWN_CATALOG_ID",
      "The exercise identifier is not in the reviewed catalog."
    );
  return item;
}

/**
 * T-2006 — every reviewed food and exercise name in the loaded catalogs.
 * Server-side only: this is the denylist R7 (`explanation-prose.ts`) scans
 * for a food/exercise the model mentions but the *candidate plan* never
 * offered. Never put this in an envelope or a prompt — handing the model a
 * full catalog vocabulary would give it names it does not otherwise have.
 */
export function reviewedCatalogDisplayNames(artifacts: ReviewedArtifactSet): string[] {
  assertVerifiedLoadedArtifact(artifacts.foodCatalog);
  assertVerifiedLoadedArtifact(artifacts.exerciseCatalog);
  const foodContent = parseArtifactContent("FOOD_CATALOG", artifacts.foodCatalog.content);
  const exerciseContent = parseArtifactContent(
    "EXERCISE_CATALOG",
    artifacts.exerciseCatalog.content
  );
  const names: string[] = [];
  if ("items" in foodContent) names.push(...foodContent.items.map((item) => item.name));
  if ("exercises" in exerciseContent) {
    names.push(...exerciseContent.exercises.map((exercise) => exercise.name));
  }
  return names;
}

/**
 * T-2033 (board/tickets/T-2003.md prescription step 16) — the reviewed
 * `nextStepText` for each id in `policy.explanationTemplateIds` that
 * resolves to a template in the loaded ESCALATION_TEMPLATES artifact, in
 * bundle-declared order. An id with no matching template is skipped, not an
 * error: `resolvePrescriptionParameters`/`computePrescription` fail closed
 * to `PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE` when the resulting list
 * is empty. One reader: both `finalization.ts` (recomputing a candidate's
 * prescription for the digest/target check) and `managed-executor.ts`
 * (generation) call this instead of each re-deriving the mapping.
 */
export function resolveReviewedPrescriptionExplanationTexts(
  artifacts: ReviewedArtifactSet,
  policy: PolicyBundleContent
): string[] {
  assertVerifiedLoadedArtifact(artifacts.escalationTemplates);
  const content = escalationTemplatesContentSchema.parse(artifacts.escalationTemplates.content);
  const byId = new Map(content.templates.map((template) => [template.id, template]));
  const texts: string[] = [];
  for (const id of policy.explanationTemplateIds) {
    const template = byId.get(id);
    if (template) texts.push(template.nextStepText);
  }
  return texts;
}
