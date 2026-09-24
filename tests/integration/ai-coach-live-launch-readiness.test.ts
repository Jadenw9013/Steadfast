import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import { assertAiCoachOperationEnabled } from "@/lib/ai-coach/operations";
import {
  activateAiCoachLiveRelease,
  approveLiveLaunchPacket,
  assertActiveAiCoachLiveReleaseReady,
  assertAiCoachLiveLaunchReady,
  deactivateAiCoachLiveRelease,
  registerLiveLaunchPacket,
  revokeLiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/repository";
import { liveLaunchPacketSchema, type LiveLaunchPacket } from "@/lib/ai-coach/live-launch/schema";
import { getAiCoachPublicDiscoveryOffer } from "@/lib/ai-coach/discovery";
import {
  buildNonSyntheticLaunchTestArtifacts,
  completeNonTestLaunchPacket,
} from "@/tests/helpers/ai-live-launch";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

function draftPacket(): LiveLaunchPacket {
  const template = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "docs/ai-coach/approval/live-launch-packet.template.v1.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
  const suffix = randomUUID();
  return liveLaunchPacketSchema.parse({
    ...template,
    packetId: `synthetic-live-launch-${suffix}`,
    packetKey: `synthetic-live-launch-${suffix}`,
    releaseId: `synthetic-release-${suffix}`,
  });
}

suite.sequential("AI Coach live-launch persistence and production gate", () => {
  let actorUserId: string | null = null;

  beforeEach(async () => {
    const key = randomUUID();
    const actor = await db.user.create({
      data: { clerkId: key, email: `${key}@example.test`, isCoach: true },
    });
    actorUserId = actor.id;
    await db.aiCoachGovernanceGrant.create({
      data: {
        userId: actor.id,
        scopes: [
          "APPROVE_LIVE_LAUNCH",
          "REVOKE_LIVE_LAUNCH",
          "ACTIVATE_LIVE_LAUNCH",
          "DEACTIVATE_LIVE_LAUNCH",
        ],
        grantRef: "synthetic-live-launch-readiness-test",
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (actorUserId) {
      const grantIds = (
        await db.aiCoachGovernanceGrant.findMany({
          where: { userId: actorUserId },
          select: { id: true },
        })
      ).map((grant) => grant.id);
      await db.aiCoachLiveLaunchLifecycleEvent.deleteMany({
        where: { actorUserId },
      });
      await db.aiCoachLiveActivationEvent.deleteMany({ where: { actorUserId } });
      await db.aiCoachOperationalEvent.deleteMany({ where: { actorUserId } });
      await db.aiCoachOperationalControl.deleteMany({
        where: { updatedByGrantId: { in: grantIds } },
      });
      await db.aiCoachGovernanceGrant.deleteMany({ where: { userId: actorUserId } });
      await db.user.deleteMany({ where: { id: actorUserId } });
    }
    actorUserId = null;
  });

  afterAll(() => db.$disconnect());

  it("permits only immutable metadata-free DRAFT inserts", async () => {
    const packet = draftPacket();
    const data = {
      id: packet.packetId,
      packetKey: packet.packetKey,
      version: packet.version,
      schemaVersion: packet.schemaVersion,
      releaseId: packet.releaseId,
      engineVersion: packet.engineVersion,
      jurisdictions: packet.jurisdictions,
      packet,
      contentDigest: "a".repeat(64),
      testOnly: packet.testOnly,
    };
    await expect(
      db.aiCoachLiveLaunchPacket.create({
        data: { ...data, state: "APPROVED", approvedAt: new Date() },
      })
    ).rejects.toThrow("metadata-free drafts");

    const revoked = draftPacket();
    await expect(
      db.aiCoachLiveLaunchPacket.create({
        data: {
          ...data,
          id: revoked.packetId,
          packetKey: revoked.packetKey,
          releaseId: revoked.releaseId,
          packet: revoked,
          state: "REVOKED",
          revokedAt: new Date(),
          revocationReason: "synthetic direct insert",
        },
      })
    ).rejects.toThrow("metadata-free drafts");
  });

  it("registers a draft but blocks approval and loading of its test-only placeholders", async () => {
    const packet = draftPacket();
    await expect(registerLiveLaunchPacket(packet)).resolves.toMatchObject({
      id: packet.packetId,
      state: "DRAFT",
      testOnly: true,
      approvedAt: null,
      revokedAt: null,
    });
    await expect(
      approveLiveLaunchPacket({
        packetId: packet.packetId,
        actorUserId: actorUserId!,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        reasonCode: "SYNTHETIC_TEST_ONLY",
        signedApprovalIndexRef: "synthetic-not-a-real-signature",
      })
    ).rejects.toMatchObject({
      code: "LIVE_LAUNCH_PACKET_NOT_READY",
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "PACKET_TEST_ONLY" }),
        expect.objectContaining({ code: "HUMAN_DECISION_REQUIRED" }),
      ]),
    });
    await expect(
      assertAiCoachLiveLaunchReady({
        packetId: packet.packetId,
        releaseId: packet.releaseId,
        engineVersion: packet.engineVersion,
        jurisdictions: packet.jurisdictions,
      })
    ).rejects.toMatchObject({ code: "LIVE_LAUNCH_PACKET_NOT_APPROVED" });
  });

  it("fails closed on a persisted packet digest mismatch before any artifact lookup", async () => {
    const packet = draftPacket();
    await db.aiCoachLiveLaunchPacket.create({
      data: {
        id: packet.packetId,
        packetKey: packet.packetKey,
        version: packet.version,
        schemaVersion: packet.schemaVersion,
        releaseId: packet.releaseId,
        engineVersion: packet.engineVersion,
        jurisdictions: packet.jurisdictions,
        packet,
        contentDigest: "f".repeat(64),
        testOnly: true,
      },
    });
    await expect(
      approveLiveLaunchPacket({
        packetId: packet.packetId,
        actorUserId: actorUserId!,
        effectiveAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3_600_000),
        reasonCode: "SYNTHETIC_DIGEST_TEST",
        signedApprovalIndexRef: "synthetic-not-a-real-signature",
      })
    ).rejects.toMatchObject({ code: "LIVE_LAUNCH_PACKET_DIGEST_MISMATCH" });
  });

  it("rejects direct lifecycle changes, evidence mutation, and deletion", async () => {
    const packet = draftPacket();
    await registerLiveLaunchPacket(packet);
    await expect(
      db.aiCoachLiveLaunchPacket.update({
        where: { id: packet.packetId },
        data: { state: "APPROVED" },
      })
    ).rejects.toThrow("lifecycle transition");
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_live_launch_action', 'APPROVE', true)`;
        return tx.aiCoachLiveLaunchPacket.update({
          where: { id: packet.packetId },
          data: {
            state: "APPROVED",
            effectiveAt: new Date(Date.now() - 60_000),
            expiresAt: new Date(Date.now() + 3_600_000),
            approvedAt: new Date(),
          },
        });
      })
    ).rejects.toThrow("complete, current, signed, non-test packet");
    await expect(
      db.aiCoachLiveLaunchPacket.update({
        where: { id: packet.packetId },
        data: { packet: { forged: true } },
      })
    ).rejects.toThrow("immutable");
    await expect(
      db.aiCoachLiveLaunchPacket.delete({ where: { id: packet.packetId } })
    ).rejects.toThrow("cannot be deleted");
  });

  it("rejects a direct live-activation INSERT even for an existing packet", async () => {
    const packet = draftPacket();
    await registerLiveLaunchPacket(packet);
    await expect(
      db.aiCoachLiveActivation.create({
        data: {
          id: `forged-live-activation-${randomUUID()}`,
          state: "ACTIVE",
          packetId: packet.packetId,
          packetDigest: "a".repeat(64),
          releaseId: packet.releaseId,
          runtimeConfigurationDigest: "b".repeat(64),
          signedActivationRef: "forged-direct-insert",
          reasonCode: "FORGED_DIRECT_INSERT",
        },
      })
    ).rejects.toThrow("governed activation workflow");
  });

  it("requires the server-selected active release for every production operation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const grant = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
      where: { userId: actorUserId! },
    });
    await db.aiCoachOperationalControl.createMany({
      data: ["GENERATION", "PROVIDER"].map((scope) => ({
        scope: scope as "GENERATION" | "PROVIDER",
        disabled: false,
        reasonCode: "SYNTHETIC_TEST",
        updatedByGrantId: grant.id,
      })),
    });
    await expect(assertAiCoachOperationEnabled("GENERATION")).rejects.toMatchObject({
      code: "LIVE_ACTIVATION_MISSING",
    });
    await expect(assertAiCoachOperationEnabled("PROVIDER")).rejects.toMatchObject({
      code: "LIVE_ACTIVATION_MISSING",
    });
  });

  it("rejects activation after an otherwise approved packet expires", async () => {
    const suffix = randomUUID();
    const artifacts = buildNonSyntheticLaunchTestArtifacts(suffix);
    const artifactEffectiveAt = new Date(Date.now() - 60_000);
    const artifactExpiresAt = new Date(Date.now() + 3_600_000);
    for (const artifact of artifacts.leaves) {
      await registerArtifactVersion(artifact);
      await publishArtifactVersion({
        id: artifact.id,
        effectiveAt: artifactEffectiveAt,
        expiresAt: artifactExpiresAt,
        engineVersion: "ai-coach-artifact-engine-v1",
      });
    }
    await registerArtifactVersion(artifacts.policy);
    await publishArtifactVersion({
      id: artifacts.policy.id,
      effectiveAt: artifactEffectiveAt,
      expiresAt: artifactExpiresAt,
      engineVersion: "ai-coach-artifact-engine-v1",
    });
    const packet = completeNonTestLaunchPacket({
      suffix,
      artifactBindings: artifacts.references,
    });
    await registerLiveLaunchPacket(packet);
    await approveLiveLaunchPacket({
      packetId: packet.packetId,
      actorUserId: actorUserId!,
      effectiveAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 1_000),
      reasonCode: "SYNTHETIC_SHORT_APPROVAL",
      signedApprovalIndexRef: "synthetic-short-signed-approval-index",
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
    await expect(
      activateAiCoachLiveRelease({
        packetId: packet.packetId,
        actorUserId: actorUserId!,
        signedActivationRef: "synthetic-expired-activation-attempt",
        reasonCode: "SYNTHETIC_EXPIRED_ACTIVATION",
      })
    ).rejects.toMatchObject({ code: "LIVE_LAUNCH_PACKET_NOT_READY" });
  });

  it("accepts only the complete draft -> approve -> activate -> deactivate -> revoke lifecycle", async () => {
    const suffix = randomUUID();
    const artifacts = buildNonSyntheticLaunchTestArtifacts(suffix);
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 3_600_000);
    for (const artifact of artifacts.leaves) {
      await registerArtifactVersion(artifact);
      await publishArtifactVersion({
        id: artifact.id,
        effectiveAt,
        expiresAt,
        engineVersion: "ai-coach-artifact-engine-v1",
      });
    }
    await registerArtifactVersion(artifacts.policy);
    await publishArtifactVersion({
      id: artifacts.policy.id,
      effectiveAt,
      expiresAt,
      engineVersion: "ai-coach-artifact-engine-v1",
    });

    const packet = completeNonTestLaunchPacket({
      suffix,
      artifactBindings: artifacts.references,
    });
    await registerLiveLaunchPacket(packet);

    await approveLiveLaunchPacket({
      packetId: packet.packetId,
      actorUserId: actorUserId!,
      effectiveAt,
      expiresAt,
      reasonCode: "SYNTHETIC_ISOLATED_APPROVAL",
      signedApprovalIndexRef: "synthetic-isolated-signed-approval-index",
    });
    const activation = await activateAiCoachLiveRelease({
      packetId: packet.packetId,
      actorUserId: actorUserId!,
      signedActivationRef: "synthetic-isolated-signed-activation",
      reasonCode: "SYNTHETIC_ISOLATED_STAGING_ACTIVATION",
    });
    expect(activation).toMatchObject({
      state: "ACTIVE",
      packetId: packet.packetId,
      releaseId: packet.releaseId,
    });
    await expect(assertActiveAiCoachLiveReleaseReady()).resolves.toMatchObject({
      activationId: activation.id,
      packetId: packet.packetId,
    });
    await expect(getAiCoachPublicDiscoveryOffer()).resolves.toMatchObject({
      releaseId: packet.releaseId,
      configurationId: "synthetic-discovery-v1",
    });

    await deactivateAiCoachLiveRelease({
      actorUserId: actorUserId!,
      signedActivationRef: "synthetic-isolated-signed-deactivation",
      reasonCode: "SYNTHETIC_ISOLATED_ROLLBACK",
      reason: "Synthetic isolated rollback drill completed.",
    });
    await expect(assertActiveAiCoachLiveReleaseReady()).rejects.toMatchObject({
      code: "LIVE_ACTIVATION_MISSING",
    });
    await expect(getAiCoachPublicDiscoveryOffer()).resolves.toBeNull();

    await revokeLiveLaunchPacket({
      packetId: packet.packetId,
      actorUserId: actorUserId!,
      reason: "Synthetic isolated packet revocation test.",
      reasonCode: "SYNTHETIC_ISOLATED_REVOKE",
      signedApprovalIndexRef: "synthetic-isolated-signed-revocation",
    });
    await expect(
      activateAiCoachLiveRelease({
        packetId: packet.packetId,
        actorUserId: actorUserId!,
        signedActivationRef: "synthetic-isolated-reactivation-attempt",
        reasonCode: "SYNTHETIC_ISOLATED_REACTIVATION",
      })
    ).rejects.toMatchObject({ code: "LIVE_LAUNCH_PACKET_NOT_READY" });
  });
});
