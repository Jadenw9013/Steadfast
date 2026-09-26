import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/app/generated/prisma/client";
import { artifactContentDigest } from "@/lib/ai-coach/artifacts/digest";
import {
  ArtifactLoadError,
  getReviewedExerciseItem,
  getReviewedFoodItem,
  loadLiveArtifactSetForLaunchValidation,
  loadReviewedArtifactSet,
  publishArtifactVersion,
  registerArtifactVersion,
  revokeArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import type { ArtifactDraftInput } from "@/lib/ai-coach/artifacts/schema";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import {
  loadDraftUnsignedPolicyBundle,
  loadDraftUnsignedFoodCatalog,
} from "@/lib/ai-coach/artifacts/drafts/loader";
import { PRESCRIPTION_PARAMETER_SPECS } from "@/lib/ai-coach/prescription/parameters";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
const getCurrentDbUserMock = vi.mocked(getCurrentDbUser);

suite("T-1005 — reviewed artifact registry with real PostgreSQL constraints", () => {
  afterAll(() => db.$disconnect());

  function namespace(label: string) {
    return `${label}-${randomUUID()}`;
  }

  async function createAccount(isSynthetic: boolean) {
    const id = randomUUID();
    const user = await db.user.create({
      data: {
        clerkId: id,
        email: `${id}@example.test`,
        isClient: true,
        isDeactivated: false,
      },
    });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic } });
    return user;
  }

  function authenticateAs(user: Awaited<ReturnType<typeof createAccount>>) {
    getCurrentDbUserMock.mockResolvedValue(user);
  }

  async function registerLeaves(
    set: ReturnType<typeof buildSyntheticArtifactSet>,
    effectiveAt: Date,
    expiresAt: Date
  ) {
    for (const artifact of [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
    ]) {
      await registerArtifactVersion(artifact);
      await publishArtifactVersion({
        id: artifact.id,
        effectiveAt,
        expiresAt,
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      });
    }
  }

  async function registerAndPublish(
    set: ReturnType<typeof buildSyntheticArtifactSet>,
    effectiveAt = new Date(Date.now() - 60_000),
    expiresAt = new Date(Date.now() + 3_600_000)
  ) {
    await registerLeaves(set, effectiveAt, expiresAt);
    await registerArtifactVersion(set.policyBundle);
    await publishArtifactVersion({
      id: set.policyBundle.id,
      effectiveAt,
      expiresAt,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
  }

  function json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  function directInsertWithState(
    artifact: ArtifactDraftInput,
    state: "DRAFT" | "PUBLISHED" | "REVOKED"
  ) {
    const now = new Date();
    return db.aiCoachArtifactVersion.create({
      data: {
        id: artifact.id,
        artifactKey: artifact.artifactKey,
        version: artifact.version,
        kind: artifact.kind,
        state,
        schemaVersion: artifact.schemaVersion,
        engineVersions: artifact.engineVersions,
        dependencies: json(artifact.dependencies),
        content: json(artifact.content),
        contentDigest: artifactContentDigest(artifact),
        synthetic: artifact.synthetic,
        reviewMetadata: json(artifact.reviewMetadata),
        publishedAt: now,
        effectiveAt: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() + 3_600_000),
        revokedAt: state === "REVOKED" ? now : null,
        revocationReason: state === "REVOKED" ? "Synthetic direct insert attempt" : null,
      },
    });
  }

  const request = (policyArtifactKey: string) => ({
    policyArtifactKey,
    engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
  });

  function exactSetReferences(set: ReturnType<typeof buildSyntheticArtifactSet>) {
    return [
      {
        id: set.policyBundle.id,
        artifactKey: set.policyBundle.artifactKey,
        version: set.policyBundle.version,
        kind: set.policyBundle.kind,
        digest: artifactContentDigest(set.policyBundle),
      },
      ...set.policyBundle.dependencies,
    ];
  }

  it("selects the newest effective immutable policy version and resolves only reviewed catalog IDs", async () => {
    const account = await createAccount(true);
    authenticateAs(account);
    const set = buildSyntheticArtifactSet(namespace("selection"));
    const expiresAt = new Date(Date.now() + 3_600_000);
    await registerAndPublish(set, new Date(Date.now() - 60_000), expiresAt);
    const v2 = buildSyntheticArtifactSet(
      set.policyKey.replace("synthetic-policy-", ""),
      2
    ).policyBundle;
    await registerArtifactVersion(v2);
    await publishArtifactVersion({
      id: v2.id,
      effectiveAt: new Date(Date.now() - 30_000),
      expiresAt,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });

    const loaded = await loadReviewedArtifactSet(request(set.policyKey));
    expect(loaded.policy.version).toBe(2);
    expect(getReviewedFoodItem(loaded.foodCatalog, "synthetic-food-item").source.authority).toBe(
      "REVIEWED_SOURCE"
    );
    expect(
      getReviewedExerciseItem(loaded.exerciseCatalog, "synthetic-exercise-item").source.authority
    ).toBe("REVIEWED_SOURCE");
    const loadedFoodContent = loaded.foodCatalog.content;
    if (!("items" in loadedFoodContent)) throw new Error("fixture shape changed");
    expect(() =>
      loadedFoodContent.items.push(structuredClone(loadedFoodContent.items[0]))
    ).toThrow();
    expect(() => getReviewedFoodItem(loaded.foodCatalog, "model-invented-food-id")).toThrowError(
      ArtifactLoadError
    );
  });

  it("fails closed when the newest effective policy is revoked instead of silently falling back", async () => {
    const account = await createAccount(true);
    authenticateAs(account);
    const set = buildSyntheticArtifactSet(namespace("revocation"));
    const expiresAt = new Date(Date.now() + 3_600_000);
    await registerAndPublish(set, new Date(Date.now() - 60_000), expiresAt);
    const v2 = buildSyntheticArtifactSet(
      set.policyKey.replace("synthetic-policy-", ""),
      2
    ).policyBundle;
    await registerArtifactVersion(v2);
    await publishArtifactVersion({
      id: v2.id,
      effectiveAt: new Date(Date.now() - 30_000),
      expiresAt,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
    await revokeArtifactVersion(v2.id, "Synthetic revocation test");

    await expect(loadReviewedArtifactSet(request(set.policyKey))).rejects.toMatchObject({
      code: "ARTIFACT_REVOKED",
    });
  });

  it("keeps the live-launch loader exact, non-synthetic, current, and revocation-aware", async () => {
    const syntheticSet = buildSyntheticArtifactSet(namespace("live-launch-synthetic"));
    await registerAndPublish(syntheticSet);
    await expect(
      db.$transaction((tx) =>
        loadLiveArtifactSetForLaunchValidation(tx, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: exactSetReferences(syntheticSet),
          now: new Date(),
        })
      )
    ).rejects.toMatchObject({ code: "SYNTHETIC_ARTIFACT_FORBIDDEN" });

    const mismatchSet = buildSyntheticArtifactSet(namespace("live-launch-mismatch"));
    await registerAndPublish(mismatchSet);
    const mismatchedReferences = exactSetReferences(mismatchSet);
    mismatchedReferences[0] = { ...mismatchedReferences[0], digest: "f".repeat(64) };
    await expect(
      db.$transaction((tx) =>
        loadLiveArtifactSetForLaunchValidation(tx, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: mismatchedReferences,
          now: new Date(),
        })
      )
    ).rejects.toMatchObject({ code: "ARTIFACT_DIGEST_MISMATCH" });

    const revokedSet = buildSyntheticArtifactSet(namespace("live-launch-revoked"));
    await registerAndPublish(revokedSet);
    await revokeArtifactVersion(revokedSet.policyBundle.id, "Synthetic launch-loader test");
    await expect(
      db.$transaction((tx) =>
        loadLiveArtifactSetForLaunchValidation(tx, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: exactSetReferences(revokedSet),
          now: new Date(),
        })
      )
    ).rejects.toMatchObject({ code: "ARTIFACT_REVOKED" });

    const expiredSet = buildSyntheticArtifactSet(namespace("live-launch-expired"));
    const expiresAt = new Date(Date.now() + 120_000);
    await registerAndPublish(expiredSet, new Date(Date.now() - 60_000), expiresAt);
    await expect(
      db.$transaction((tx) =>
        loadLiveArtifactSetForLaunchValidation(tx, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: exactSetReferences(expiredSet),
          now: new Date(expiresAt.getTime() + 1),
        })
      )
    ).rejects.toMatchObject({ code: "ARTIFACT_EXPIRED" });
  });

  it("fails publication closed on dependency digest and missing-reference mismatches", async () => {
    const digestSet = buildSyntheticArtifactSet(namespace("digest"));
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 3_600_000);
    await registerLeaves(digestSet, effectiveAt, expiresAt);
    digestSet.policyBundle.dependencies[0].digest = "f".repeat(64);
    await registerArtifactVersion(digestSet.policyBundle);
    await expect(
      publishArtifactVersion({
        id: digestSet.policyBundle.id,
        effectiveAt,
        expiresAt,
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_DIGEST_MISMATCH" });

    const missingSet = buildSyntheticArtifactSet(namespace("missing"));
    await registerArtifactVersion(missingSet.policyBundle);
    await expect(
      publishArtifactVersion({
        id: missingSet.policyBundle.id,
        effectiveAt,
        expiresAt,
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_MISSING" });
  });

  it("fails closed on expired or engine-incompatible artifacts", async () => {
    const account = await createAccount(true);
    authenticateAs(account);
    const incompatibleSet = buildSyntheticArtifactSet(namespace("incompatible"));
    await registerAndPublish(incompatibleSet);
    await expect(
      loadReviewedArtifactSet({
        ...request(incompatibleSet.policyKey),
        engineVersion: "incompatible-engine",
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_INCOMPATIBLE" });

    const expiredSet = buildSyntheticArtifactSet(namespace("expired"));
    const expiresAt = new Date(Date.now() + 200);
    await registerAndPublish(expiredSet, new Date(Date.now() - 60_000), expiresAt);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(loadReviewedArtifactSet(request(expiredSet.policyKey))).rejects.toMatchObject({
      code: "ARTIFACT_EXPIRED",
    });
  });

  it("derives synthetic eligibility from the locked persisted profile and ignores a forged request flag", async () => {
    const set = buildSyntheticArtifactSet(namespace("separation"));
    await registerAndPublish(set);
    const syntheticAccount = await createAccount(true);
    authenticateAs(syntheticAccount);
    await expect(loadReviewedArtifactSet(request(set.policyKey))).resolves.toMatchObject({
      policy: { synthetic: true },
    });

    const realAccount = await createAccount(false);
    authenticateAs(realAccount);
    const forgedRequest = { ...request(set.policyKey), accountIsSynthetic: true };
    await expect(loadReviewedArtifactSet(forgedRequest)).rejects.toMatchObject({
      code: "SYNTHETIC_ARTIFACT_FORBIDDEN",
    });
  });

  it("rejects direct INSERT as PUBLISHED or REVOKED", async () => {
    await expect(
      directInsertWithState(
        buildSyntheticArtifactSet(namespace("direct-published")).foodCatalog,
        "PUBLISHED"
      )
    ).rejects.toThrow("must be inserted as DRAFT");
    await expect(
      directInsertWithState(
        buildSyntheticArtifactSet(namespace("direct-revoked")).foodCatalog,
        "REVOKED"
      )
    ).rejects.toThrow("must be inserted as DRAFT");
    await expect(
      directInsertWithState(
        buildSyntheticArtifactSet(namespace("draft-with-publication-metadata")).foodCatalog,
        "DRAFT"
      )
    ).rejects.toThrow("without publication or revocation metadata");
  });

  it("supports only the validated draft to publish to revoke lifecycle", async () => {
    const artifact = buildSyntheticArtifactSet(namespace("valid-lifecycle")).foodCatalog;
    const draft = await registerArtifactVersion(artifact);
    expect(draft).toMatchObject({ state: "DRAFT", publishedAt: null, revokedAt: null });

    await expect(
      db.aiCoachArtifactVersion.update({
        where: { id: artifact.id },
        data: {
          state: "PUBLISHED",
          publishedAt: new Date(),
          effectiveAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
    ).rejects.toThrow("validated repository publication");

    const published = await publishArtifactVersion({
      id: artifact.id,
      effectiveAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
    expect(published).toMatchObject({ state: "PUBLISHED", revokedAt: null });

    const revoked = await revokeArtifactVersion(artifact.id, "Synthetic lifecycle test");
    expect(revoked).toMatchObject({
      state: "REVOKED",
      revocationReason: "Synthetic lifecycle test",
    });
    await expect(
      db.aiCoachArtifactVersion.update({
        where: { id: artifact.id },
        data: { state: "PUBLISHED", revokedAt: null, revocationReason: null },
      })
    ).rejects.toThrow("invalid AI Coach artifact lifecycle transition");
  });

  it.each(["escalation-template", "evidence-claim", "policy-rule"] as const)(
    "rejects a dangling %s reference during policy publication",
    async (referenceKind) => {
      const set = buildSyntheticArtifactSet(namespace(`dangling-${referenceKind}`));
      if (!("numericParameters" in set.policyBundle.content)) {
        throw new Error("fixture shape changed");
      }

      if (referenceKind === "escalation-template") {
        set.policyBundle.content.escalationTemplateIds = ["model-invented-template-id"];
        set.policyBundle.content.safetyControls.screening.escalationTemplateId =
          "model-invented-template-id";
        for (const rule of set.policyBundle.content.safetyControls.contraindications) {
          rule.escalationTemplateId = "model-invented-template-id";
        }
      } else if (referenceKind === "evidence-claim") {
        set.policyBundle.content.numericParameters[0].evidenceClaimIds = [
          "model-invented-evidence-claim",
        ];
      } else {
        if (!("claims" in set.evidenceRegistry.content)) throw new Error("fixture shape changed");
        set.evidenceRegistry.content.claims[0].ruleIds = ["model-invented-policy-rule"];
        const evidenceReference = set.policyBundle.dependencies.find(
          (dependency) => dependency.kind === "EVIDENCE_REGISTRY"
        );
        if (!evidenceReference) throw new Error("fixture dependency changed");
        evidenceReference.digest = artifactContentDigest(set.evidenceRegistry);
      }

      const effectiveAt = new Date(Date.now() - 60_000);
      const expiresAt = new Date(Date.now() + 3_600_000);
      await registerLeaves(set, effectiveAt, expiresAt);
      await registerArtifactVersion(set.policyBundle);
      await expect(
        publishArtifactVersion({
          id: set.policyBundle.id,
          effectiveAt,
          expiresAt,
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
        })
      ).rejects.toMatchObject({ code: "ARTIFACT_INCOMPATIBLE" });
    }
  );

  it("rejects a safety reason that its reviewed escalation template does not support", async () => {
    const set = buildSyntheticArtifactSet(namespace("dangling-safety-reason"));
    if (!("safetyControls" in set.policyBundle.content)) {
      throw new Error("fixture shape changed");
    }
    set.policyBundle.content.safetyControls.screening.flaggedReasonCode =
      "model-invented-safety-reason";
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 3_600_000);
    await registerLeaves(set, effectiveAt, expiresAt);
    await registerArtifactVersion(set.policyBundle);
    await expect(
      publishArtifactVersion({
        id: set.policyBundle.id,
        effectiveAt,
        expiresAt,
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_INCOMPATIBLE" });
  });

  it("rejects a draft whose persisted digest does not match its reviewed content", async () => {
    const artifact = buildSyntheticArtifactSet(namespace("persisted-digest")).foodCatalog;
    await db.aiCoachArtifactVersion.create({
      data: {
        id: artifact.id,
        artifactKey: artifact.artifactKey,
        version: artifact.version,
        kind: artifact.kind,
        schemaVersion: artifact.schemaVersion,
        engineVersions: artifact.engineVersions,
        dependencies: json(artifact.dependencies),
        content: json(artifact.content),
        contentDigest: "f".repeat(64),
        synthetic: artifact.synthetic,
        reviewMetadata: json(artifact.reviewMetadata),
      },
    });
    await expect(
      publishArtifactVersion({
        id: artifact.id,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_DIGEST_MISMATCH" });
  });

  it("enforces immutable artifact content in PostgreSQL", async () => {
    const set = buildSyntheticArtifactSet(namespace("immutable"));
    await registerArtifactVersion(set.foodCatalog);
    await expect(
      db.aiCoachArtifactVersion.update({
        where: { id: set.foodCatalog.id },
        data: { content: json({ altered: true }) },
      })
    ).rejects.toThrow("immutable");
  });

  it("rejects production publication and revocation without an authorized governance context", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        publishArtifactVersion({
          id: randomUUID(),
          effectiveAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 3_600_000),
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
        })
      ).rejects.toThrow("authorized governance context");
      await expect(
        revokeArtifactVersion(randomUUID(), "Synthetic revocation test")
      ).rejects.toThrow("authorized governance context");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("registerArtifactVersion accepts a DRAFT_UNSIGNED policy bundle, then publishArtifactVersion throws ARTIFACT_UNSIGNED_DRAFT and row stays DRAFT", async () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet(namespace("draft-publish-reject"));
    const leaves = [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
    ];
    for (const leaf of leaves) {
      await registerArtifactVersion(leaf);
      await publishArtifactVersion({
        id: leaf.id,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      });
    }

    const artifactKey = namespace("draft-reject-policy");
    const content = { ...draftFile.content, artifactKey };
    const draftInput = {
      id: `${artifactKey}:v1`,
      artifactKey,
      version: 1,
      kind: "POLICY_BUNDLE" as const,
      schemaVersion: 1 as const,
      engineVersions: [SYNTHETIC_ARTIFACT_ENGINE_VERSION],
      dependencies: leaves.map((leaf) => ({
        id: leaf.id,
        artifactKey: leaf.artifactKey,
        version: leaf.version,
        kind: leaf.kind,
        digest: artifactContentDigest(leaf),
      })),
      synthetic: false,
      reviewMetadata: draftFile.reviewMetadata,
      content,
    };

    const registered = await registerArtifactVersion(draftInput);
    expect(registered.state).toBe("DRAFT");

    await expect(
      publishArtifactVersion({
        id: draftInput.id,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      })
    ).rejects.toMatchObject({
      code: "ARTIFACT_UNSIGNED_DRAFT",
    });

    const persisted = await db.aiCoachArtifactVersion.findUnique({
      where: { id: draftInput.id },
    });
    expect(persisted?.state).toBe("DRAFT");
  });

  it("fails to load a row hand-updated to state PUBLISHED with draft metadata through loadReviewedArtifactSet with ARTIFACT_UNSIGNED_DRAFT", async () => {
    const account = await createAccount(false);
    authenticateAs(account);
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet(namespace("hand-updated-published"));
    const leaves = [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
    ];
    for (const leaf of leaves) {
      await registerArtifactVersion(leaf);
      await publishArtifactVersion({
        id: leaf.id,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      });
    }

    const artifactKey = namespace("hand-update-policy");
    const content = { ...draftFile.content, artifactKey };
    const draftInput = {
      id: `${artifactKey}:v1`,
      artifactKey,
      version: 1,
      kind: "POLICY_BUNDLE" as const,
      schemaVersion: 1 as const,
      engineVersions: [SYNTHETIC_ARTIFACT_ENGINE_VERSION],
      dependencies: leaves.map((leaf) => ({
        id: leaf.id,
        artifactKey: leaf.artifactKey,
        version: leaf.version,
        kind: leaf.kind,
        digest: artifactContentDigest(leaf),
      })),
      synthetic: false,
      reviewMetadata: draftFile.reviewMetadata,
      content,
    };

    await registerArtifactVersion(draftInput);

    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_artifact_lifecycle_action', 'PUBLISH', true)`;
      await tx.aiCoachArtifactVersion.update({
        where: { id: draftInput.id },
        data: {
          state: "PUBLISHED",
          publishedAt: now,
          effectiveAt: new Date(now.getTime() - 60_000),
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
      });
    });

    await expect(loadReviewedArtifactSet(request(draftInput.artifactKey))).rejects.toMatchObject({
      code: "ARTIFACT_UNSIGNED_DRAFT",
    });
  });

  it("loadLiveArtifactSetForLaunchValidation refuses a packet binding a draft artifact with ARTIFACT_UNSIGNED_DRAFT", async () => {
    const draftFile = loadDraftUnsignedPolicyBundle();
    const set = buildSyntheticArtifactSet(namespace("live-launch-draft"));
    const leaves = [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
    ];
    for (const leaf of leaves) {
      await registerArtifactVersion(leaf);
      await publishArtifactVersion({
        id: leaf.id,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      });
    }

    const artifactKey = namespace("live-launch-draft-policy");
    const content = { ...draftFile.content, artifactKey };
    const draftInput = {
      id: `${artifactKey}:v1`,
      artifactKey,
      version: 1,
      kind: "POLICY_BUNDLE" as const,
      schemaVersion: 1 as const,
      engineVersions: [SYNTHETIC_ARTIFACT_ENGINE_VERSION],
      dependencies: leaves.map((leaf) => ({
        id: leaf.id,
        artifactKey: leaf.artifactKey,
        version: leaf.version,
        kind: leaf.kind,
        digest: artifactContentDigest(leaf),
      })),
      synthetic: false,
      reviewMetadata: draftFile.reviewMetadata,
      content,
    };

    await registerArtifactVersion(draftInput);
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_artifact_lifecycle_action', 'PUBLISH', true)`;
      await tx.aiCoachArtifactVersion.update({
        where: { id: draftInput.id },
        data: {
          state: "PUBLISHED",
          publishedAt: now,
          effectiveAt: new Date(now.getTime() - 60_000),
          expiresAt: new Date(now.getTime() + 3_600_000),
        },
      });
    });

    const packetReferences = [
      {
        id: draftInput.id,
        artifactKey: draftInput.artifactKey,
        version: draftInput.version,
        kind: draftInput.kind,
        digest: artifactContentDigest(draftInput),
      },
      ...draftInput.dependencies,
    ];

    await expect(
      db.$transaction((tx) =>
        loadLiveArtifactSetForLaunchValidation(tx, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: packetReferences,
          now: new Date(),
        })
      )
    ).rejects.toMatchObject({
      code: "ARTIFACT_UNSIGNED_DRAFT",
    });
  });

  it("publishes and loads the synthetic artifact set with all 75 prescription parameters present in the loaded artifact", async () => {
    const account = await createAccount(true);
    authenticateAs(account);
    const set = buildSyntheticArtifactSet(namespace("all-75-parameters"));
    await registerAndPublish(set);

    const loaded = await loadReviewedArtifactSet(request(set.policyKey));
    expect(loaded.policy.kind).toBe("POLICY_BUNDLE");

    const numericParams =
      loaded.policy.kind === "POLICY_BUNDLE"
        ? (loaded.policy.content as { numericParameters: Array<{ id: string; value: number }> })
            .numericParameters
        : [];

    const paramMap = new Map(numericParams.map((p) => [p.id, p.value]));
    for (const spec of PRESCRIPTION_PARAMETER_SPECS) {
      expect(paramMap.has(spec.id)).toBe(true);
      expect(typeof paramMap.get(spec.id)).toBe("number");
      expect(Number.isFinite(paramMap.get(spec.id))).toBe(true);
    }
  });

  it("registers and publishes a SOURCED_V2 food catalog, loads it, and returns reviewed item with allergenFactsV2 intact", async () => {
    const account = await createAccount(true);
    authenticateAs(account);
    const draftCatalog = loadDraftUnsignedFoodCatalog();
    const set = buildSyntheticArtifactSet(namespace("sourced-catalog"));

    const item0 = draftCatalog.content.items[0];
    const foodArtifactKey = namespace("sourced-food-cat");
    const sourcedFoodCatalog = {
      id: `${foodArtifactKey}:v1`,
      artifactKey: foodArtifactKey,
      version: 1,
      kind: "FOOD_CATALOG" as const,
      schemaVersion: 1 as const,
      engineVersions: [SYNTHETIC_ARTIFACT_ENGINE_VERSION],
      dependencies: [],
      synthetic: true,
      reviewMetadata: set.foodCatalog.reviewMetadata,
      content: {
        artifactKey: foodArtifactKey,
        version: 1,
        catalogProfile: "SOURCED_V2" as const,
        market: "US" as const,
        items: [
          {
            ...item0,
            id: "fdc-sourced-test-item",
          },
        ],
      },
    };

    await registerArtifactVersion(sourcedFoodCatalog);
    const now = new Date();
    await publishArtifactVersion({
      id: sourcedFoodCatalog.id,
      effectiveAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });

    const policyKey = namespace("sourced-policy");
    const policyBundle = {
      ...set.policyBundle,
      id: `${policyKey}:v1`,
      artifactKey: policyKey,
      dependencies: [
        {
          id: sourcedFoodCatalog.id,
          artifactKey: sourcedFoodCatalog.artifactKey,
          version: sourcedFoodCatalog.version,
          kind: sourcedFoodCatalog.kind,
          digest: artifactContentDigest(sourcedFoodCatalog),
        },
        ...set.policyBundle.dependencies.filter((d) => d.kind !== "FOOD_CATALOG"),
      ],
      content: {
        ...set.policyBundle.content,
        artifactKey: policyKey,
      },
    };
    await registerLeaves(set, new Date(now.getTime() - 60_000), new Date(now.getTime() + 3_600_000));
    await registerArtifactVersion(policyBundle);
    await publishArtifactVersion({
      id: policyBundle.id,
      effectiveAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 3_600_000),
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });

    const loaded = await loadReviewedArtifactSet(request(policyKey));
    const reviewedItem = getReviewedFoodItem(loaded.foodCatalog, "fdc-sourced-test-item");
    expect(reviewedItem.id).toBe("fdc-sourced-test-item");
    expect(reviewedItem.allergenFactsV2).toBeDefined();
    expect(reviewedItem.allergenFactsV2?.categories).toHaveLength(9);
  });

  it("registerArtifactVersion applied to the checked-in draft food-catalog file rejects with ARTIFACT_UNSIGNED_DRAFT when publishing", async () => {
    const draftFile = loadDraftUnsignedFoodCatalog();
    const artifactKey = namespace("draft-food-catalog");
    const draftInput = {
      id: `${artifactKey}:v1`,
      artifactKey,
      version: 1,
      kind: "FOOD_CATALOG" as const,
      schemaVersion: 1 as const,
      engineVersions: [SYNTHETIC_ARTIFACT_ENGINE_VERSION],
      dependencies: [],
      synthetic: false,
      reviewMetadata: draftFile.reviewMetadata,
      content: {
        ...draftFile.content,
        artifactKey,
      },
    };

    const registered = await registerArtifactVersion(draftInput);
    expect(registered.state).toBe("DRAFT");

    await expect(
      publishArtifactVersion({
        id: draftInput.id,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      })
    ).rejects.toMatchObject({
      code: "ARTIFACT_UNSIGNED_DRAFT",
    });
  });
});

