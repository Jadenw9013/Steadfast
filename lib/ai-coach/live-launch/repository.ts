import type { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { contentHash } from "../canonical-json";
import { requireGovernanceGrant } from "../operations";
import { loadLiveArtifactSetForLaunchValidation } from "../artifacts/repository";
import {
  evaluateLiveLaunchPacketReadiness,
  liveLaunchPacketSchema,
  type LiveLaunchExpectation,
  type LiveLaunchPacket,
  type LiveLaunchReadinessReason,
  type LiveRuntimeConfiguration,
} from "./schema";

type PersistedLiveLaunchPacket = {
  id: string;
  packetKey: string;
  version: number;
  state: "DRAFT" | "APPROVED" | "REVOKED";
  schemaVersion: number;
  releaseId: string;
  engineVersion: string;
  jurisdictions: string[];
  packet: unknown;
  contentDigest: string;
  testOnly: boolean;
  effectiveAt: Date | null;
  expiresAt: Date | null;
  approvedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
};

export type LiveLaunchErrorCode =
  | "LIVE_LAUNCH_PACKET_MISSING"
  | "LIVE_LAUNCH_PACKET_NOT_APPROVED"
  | "LIVE_LAUNCH_PACKET_NOT_EFFECTIVE"
  | "LIVE_LAUNCH_PACKET_EXPIRED"
  | "LIVE_LAUNCH_PACKET_REVOKED"
  | "LIVE_LAUNCH_PACKET_DIGEST_MISMATCH"
  | "LIVE_LAUNCH_PACKET_INVALID"
  | "LIVE_LAUNCH_PACKET_NOT_READY"
  | "LIVE_ACTIVATION_MISSING"
  | "LIVE_ACTIVATION_MISMATCH"
  | "LIVE_ACTIVATION_ALREADY_EXISTS";

export class LiveLaunchError extends Error {
  constructor(
    public readonly code: LiveLaunchErrorCode,
    message: string,
    public readonly reasons: LiveLaunchReadinessReason[] = []
  ) {
    super(message);
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parsePersistedPacket(row: PersistedLiveLaunchPacket): LiveLaunchPacket {
  if (contentHash(row.packet) !== row.contentDigest) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_DIGEST_MISMATCH",
      "The live-launch packet digest does not match persisted evidence."
    );
  }
  const parsed = liveLaunchPacketSchema.safeParse(row.packet);
  if (
    !parsed.success ||
    parsed.data.packetId !== row.id ||
    parsed.data.packetKey !== row.packetKey ||
    parsed.data.version !== row.version ||
    parsed.data.schemaVersion !== row.schemaVersion ||
    parsed.data.releaseId !== row.releaseId ||
    parsed.data.engineVersion !== row.engineVersion ||
    parsed.data.testOnly !== row.testOnly
  ) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_INVALID",
      "The persisted live-launch packet does not satisfy its strict identity and evidence schema."
    );
  }
  return parsed.data;
}

function assertPacketContentReady(
  packet: LiveLaunchPacket,
  expectation: LiveLaunchExpectation,
  now: Date
) {
  const readiness = evaluateLiveLaunchPacketReadiness(packet, expectation, now);
  if (!readiness.ready) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_NOT_READY",
      "Live launch remains blocked by missing, stale, unsigned, test-only, or mismatched evidence.",
      readiness.reasons
    );
  }
}

/** Trusted server authoring only; no client or model route calls this function. */
export async function registerLiveLaunchPacket(raw: unknown) {
  const packet = liveLaunchPacketSchema.parse(raw);
  return db.aiCoachLiveLaunchPacket.create({
    data: {
      id: packet.packetId,
      packetKey: packet.packetKey,
      version: packet.version,
      schemaVersion: packet.schemaVersion,
      releaseId: packet.releaseId,
      engineVersion: packet.engineVersion,
      jurisdictions: packet.jurisdictions,
      packet: jsonValue(packet),
      contentDigest: contentHash(packet),
      testOnly: packet.testOnly,
    },
  });
}

export async function approveLiveLaunchPacket(input: {
  packetId: string;
  actorUserId: string;
  effectiveAt: Date;
  expiresAt: Date;
  reasonCode: string;
  signedApprovalIndexRef: string;
  incidentReference?: string | null;
}) {
  const now = new Date();
  if (input.effectiveAt > now || input.expiresAt <= now || input.expiresAt <= input.effectiveAt) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_INVALID",
      "Approval requires a current effective time and an explicit future expiry."
    );
  }
  if (!input.reasonCode.trim() || !input.signedApprovalIndexRef.trim()) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_INVALID",
      "Approval requires an accountable reason and signed approval index reference."
    );
  }

  return db.$transaction(async (tx) => {
    const grant = await requireGovernanceGrant(input.actorUserId, "APPROVE_LIVE_LAUNCH", tx);
    const control = await tx.aiCoachOperationalControl.findUnique({
      where: { scope: "ARTIFACT_PUBLICATION" },
    });
    if (control?.disabled) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_NOT_READY",
        "Live-launch approval is paused by the artifact-publication control."
      );
    }
    await tx.$queryRaw`SELECT "id" FROM "AiCoachLiveLaunchPacket" WHERE "id" = ${input.packetId} FOR UPDATE`;
    const row = (await tx.aiCoachLiveLaunchPacket.findUnique({
      where: { id: input.packetId },
    })) as PersistedLiveLaunchPacket | null;
    if (!row)
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_MISSING",
        "The live-launch packet does not exist."
      );
    if (row.state !== "DRAFT") {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_INVALID",
        "Only a draft live-launch packet can be approved."
      );
    }
    const packet = parsePersistedPacket(row);
    const expectation = {
      packetId: packet.packetId,
      releaseId: packet.releaseId,
      engineVersion: packet.engineVersion,
      jurisdictions: packet.jurisdictions,
    };
    assertPacketContentReady(packet, expectation, now);
    await loadLiveArtifactSetForLaunchValidation(tx, {
      engineVersion: packet.engineVersion,
      references: packet.artifactBindings,
      now,
    });

    await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_live_launch_action', 'APPROVE', true)`;
    const updated = await tx.aiCoachLiveLaunchPacket.update({
      where: { id: row.id },
      data: {
        state: "APPROVED",
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
        approvedAt: now,
      },
    });
    await tx.aiCoachLiveLaunchLifecycleEvent.create({
      data: {
        actorUserId: input.actorUserId,
        governanceGrantId: grant.id,
        packetId: row.id,
        action: "APPROVE",
        reasonCode: input.reasonCode.trim(),
        packetDigest: row.contentDigest,
        signedApprovalIndexRef: input.signedApprovalIndexRef.trim(),
        incidentReference: input.incidentReference ?? null,
      },
    });
    return updated;
  });
}

export async function revokeLiveLaunchPacket(input: {
  packetId: string;
  actorUserId: string;
  reason: string;
  reasonCode: string;
  signedApprovalIndexRef: string;
  incidentReference?: string | null;
}) {
  const reason = input.reason.trim();
  if (!reason || !input.reasonCode.trim() || !input.signedApprovalIndexRef.trim()) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_INVALID",
      "Revocation requires an accountable reason and signed approval index reference."
    );
  }
  return db.$transaction(async (tx) => {
    const grant = await requireGovernanceGrant(input.actorUserId, "REVOKE_LIVE_LAUNCH", tx);
    await tx.$queryRaw`SELECT "id" FROM "AiCoachLiveLaunchPacket" WHERE "id" = ${input.packetId} FOR UPDATE`;
    const row = (await tx.aiCoachLiveLaunchPacket.findUnique({
      where: { id: input.packetId },
    })) as PersistedLiveLaunchPacket | null;
    if (!row)
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_MISSING",
        "The live-launch packet does not exist."
      );
    if (row.state !== "APPROVED") {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_INVALID",
        "Only an approved live-launch packet can be revoked."
      );
    }
    parsePersistedPacket(row);
    await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_live_launch_action', 'REVOKE', true)`;
    const updated = await tx.aiCoachLiveLaunchPacket.update({
      where: { id: row.id },
      data: { state: "REVOKED", revokedAt: new Date(), revocationReason: reason },
    });
    await tx.aiCoachLiveLaunchLifecycleEvent.create({
      data: {
        actorUserId: input.actorUserId,
        governanceGrantId: grant.id,
        packetId: row.id,
        action: "REVOKE",
        reasonCode: input.reasonCode.trim(),
        packetDigest: row.contentDigest,
        signedApprovalIndexRef: input.signedApprovalIndexRef.trim(),
        incidentReference: input.incidentReference ?? null,
      },
    });
    const active = await tx.aiCoachLiveActivation.findFirst({
      where: { packetId: row.id, state: "ACTIVE" },
    });
    if (active) {
      await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_live_activation_action', 'DEACTIVATE', true)`;
      await tx.aiCoachLiveActivation.update({
        where: { id: active.id },
        data: {
          state: "DEACTIVATED",
          revision: { increment: 1 },
          deactivatedAt: new Date(),
          deactivationReason: reason,
        },
      });
      await tx.aiCoachLiveActivationEvent.create({
        data: {
          actorUserId: input.actorUserId,
          governanceGrantId: grant.id,
          activationId: active.id,
          packetId: row.id,
          action: "DEACTIVATE",
          packetDigest: row.contentDigest,
          runtimeConfigurationDigest: active.runtimeConfigurationDigest,
          signedActivationRef: input.signedApprovalIndexRef.trim(),
          reasonCode: input.reasonCode.trim(),
          incidentReference: input.incidentReference ?? null,
        },
      });
    }
    for (const scope of [
      "GENERATION",
      "PROVIDER",
      "FINALIZATION",
      "ACCEPTANCE",
      "ARTIFACT_PUBLICATION",
    ] as const) {
      const current = await tx.aiCoachOperationalControl.findUnique({ where: { scope } });
      const revision = (current?.revision ?? -1) + 1;
      await tx.aiCoachOperationalControl.upsert({
        where: { scope },
        create: {
          scope,
          disabled: true,
          reasonCode: "LIVE_LAUNCH_PACKET_REVOKED",
          incidentReference: input.incidentReference ?? null,
          updatedByGrantId: grant.id,
          revision,
        },
        update: {
          disabled: true,
          reasonCode: "LIVE_LAUNCH_PACKET_REVOKED",
          incidentReference: input.incidentReference ?? null,
          updatedByGrantId: grant.id,
          revision,
        },
      });
      await tx.aiCoachOperationalEvent.create({
        data: {
          actorUserId: input.actorUserId,
          scope,
          disabled: true,
          reasonCode: "LIVE_LAUNCH_PACKET_REVOKED",
          incidentReference: input.incidentReference ?? null,
          revision,
        },
      });
    }
    return updated;
  });
}

/**
 * Production prerequisite only. Passing this function never enables a flag,
 * control, route, provider, or account; it only verifies exact persisted
 * evidence and artifact bindings under row locks.
 */
export async function assertAiCoachLiveLaunchReady(expectation: LiveLaunchExpectation) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AiCoachLiveLaunchPacket" WHERE "id" = ${expectation.packetId} FOR SHARE`;
    const row = (await tx.aiCoachLiveLaunchPacket.findUnique({
      where: { id: expectation.packetId },
    })) as PersistedLiveLaunchPacket | null;
    if (!row)
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_MISSING",
        "The required live-launch packet is missing."
      );
    if (row.state === "REVOKED" || row.revokedAt) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_REVOKED",
        "The live-launch packet has been revoked."
      );
    }
    if (row.state !== "APPROVED" || !row.approvedAt || !row.effectiveAt || !row.expiresAt) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_NOT_APPROVED",
        "The live-launch packet is not approved."
      );
    }
    if (row.effectiveAt > now) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_NOT_EFFECTIVE",
        "The live-launch packet is not effective yet."
      );
    }
    if (row.expiresAt <= now) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_EXPIRED",
        "The live-launch packet has expired."
      );
    }
    const packet = parsePersistedPacket(row);
    assertPacketContentReady(packet, expectation, now);
    await loadLiveArtifactSetForLaunchValidation(tx, {
      engineVersion: packet.engineVersion,
      references: packet.artifactBindings,
      now,
    });
    return {
      packetId: row.id,
      releaseId: row.releaseId,
      packetDigest: row.contentDigest,
      engineVersion: row.engineVersion,
      jurisdictions: [...row.jurisdictions],
      expiresAt: row.expiresAt,
    };
  });
}

export type ActiveAiCoachLiveRelease = {
  activationId: string;
  packetId: string;
  releaseId: string;
  packetDigest: string;
  engineVersion: string;
  jurisdictions: string[];
  expiresAt: Date;
  runtimeConfigurationDigest: string;
  runtimeConfiguration: LiveRuntimeConfiguration;
  artifactBindings: LiveLaunchPacket["artifactBindings"];
};

async function assertActiveReleaseInTransaction(
  tx: Prisma.TransactionClient
): Promise<ActiveAiCoachLiveRelease> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('steadfast.ai_coach.live_activation'))::text`;
  const active = await tx.aiCoachLiveActivation.findFirst({ where: { state: "ACTIVE" } });
  if (!active) {
    throw new LiveLaunchError(
      "LIVE_ACTIVATION_MISSING",
      "No governed AI Coach live release is active."
    );
  }
  await tx.$queryRaw`SELECT "id" FROM "AiCoachLiveLaunchPacket" WHERE "id" = ${active.packetId} FOR SHARE`;
  const row = (await tx.aiCoachLiveLaunchPacket.findUnique({
    where: { id: active.packetId },
  })) as PersistedLiveLaunchPacket | null;
  if (!row) {
    throw new LiveLaunchError(
      "LIVE_ACTIVATION_MISMATCH",
      "The active release packet is unavailable."
    );
  }
  if (
    row.contentDigest !== active.packetDigest ||
    row.releaseId !== active.releaseId ||
    row.state !== "APPROVED" ||
    row.revokedAt
  ) {
    throw new LiveLaunchError(
      "LIVE_ACTIVATION_MISMATCH",
      "The active release no longer matches its approved packet."
    );
  }
  const now = new Date();
  if (!row.effectiveAt || row.effectiveAt > now)
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_NOT_EFFECTIVE",
      "The active release packet is not effective."
    );
  if (!row.expiresAt || row.expiresAt <= now)
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_EXPIRED",
      "The active release packet has expired."
    );
  const packet = parsePersistedPacket(row);
  if (
    !packet.runtimeConfiguration ||
    !packet.runtimeConfigurationDigest ||
    packet.runtimeConfigurationDigest !== active.runtimeConfigurationDigest ||
    contentHash(packet.runtimeConfiguration) !== active.runtimeConfigurationDigest
  ) {
    throw new LiveLaunchError(
      "LIVE_ACTIVATION_MISMATCH",
      "The active release runtime configuration is unavailable or mismatched."
    );
  }
  assertPacketContentReady(
    packet,
    {
      packetId: row.id,
      releaseId: row.releaseId,
      engineVersion: row.engineVersion,
      jurisdictions: row.jurisdictions,
    },
    now
  );
  await loadLiveArtifactSetForLaunchValidation(tx, {
    engineVersion: packet.engineVersion,
    references: packet.artifactBindings,
    now,
  });
  return {
    activationId: active.id,
    packetId: row.id,
    releaseId: row.releaseId,
    packetDigest: row.contentDigest,
    engineVersion: row.engineVersion,
    jurisdictions: [...row.jurisdictions],
    expiresAt: row.expiresAt,
    runtimeConfigurationDigest: active.runtimeConfigurationDigest,
    runtimeConfiguration: packet.runtimeConfiguration,
    artifactBindings: packet.artifactBindings,
  };
}

/**
 * Resolves the sole active release from persisted server-owned state. Callers
 * provide no packet identity, digest, jurisdiction, provider or configuration.
 */
export async function assertActiveAiCoachLiveReleaseReady(): Promise<ActiveAiCoachLiveRelease> {
  return db.$transaction((tx) => assertActiveReleaseInTransaction(tx));
}

export async function assertActiveAiCoachLiveReleaseReadyInTransaction(
  tx: Prisma.TransactionClient
) {
  return assertActiveReleaseInTransaction(tx);
}

/** Trusted CLI/release tooling only; there is deliberately no HTTP route. */
export async function activateAiCoachLiveRelease(input: {
  packetId: string;
  actorUserId: string;
  signedActivationRef: string;
  reasonCode: string;
}) {
  if (!input.packetId.trim() || !input.signedActivationRef.trim() || !input.reasonCode.trim()) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_INVALID",
      "Activation requires an exact packet, signed activation reference and reason."
    );
  }
  return db.$transaction(async (tx) => {
    const grant = await requireGovernanceGrant(input.actorUserId, "ACTIVATE_LIVE_LAUNCH", tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('steadfast.ai_coach.live_activation'))::text`;
    if (await tx.aiCoachLiveActivation.findFirst({ where: { state: "ACTIVE" } })) {
      throw new LiveLaunchError(
        "LIVE_ACTIVATION_ALREADY_EXISTS",
        "A governed AI Coach release is already active."
      );
    }
    await tx.$queryRaw`SELECT "id" FROM "AiCoachLiveLaunchPacket" WHERE "id" = ${input.packetId} FOR SHARE`;
    const row = (await tx.aiCoachLiveLaunchPacket.findUnique({
      where: { id: input.packetId },
    })) as PersistedLiveLaunchPacket | null;
    if (!row)
      throw new LiveLaunchError("LIVE_LAUNCH_PACKET_MISSING", "The launch packet is missing.");
    const packet = parsePersistedPacket(row);
    if (!packet.runtimeConfiguration || !packet.runtimeConfigurationDigest) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_NOT_READY",
        "The launch packet has no approved runtime configuration."
      );
    }
    const now = new Date();
    if (
      row.state !== "APPROVED" ||
      row.testOnly ||
      !row.effectiveAt ||
      row.effectiveAt > now ||
      !row.expiresAt ||
      row.expiresAt <= now ||
      row.revokedAt
    ) {
      throw new LiveLaunchError(
        "LIVE_LAUNCH_PACKET_NOT_READY",
        "The launch packet is not current and approved."
      );
    }
    assertPacketContentReady(
      packet,
      {
        packetId: row.id,
        releaseId: row.releaseId,
        engineVersion: row.engineVersion,
        jurisdictions: row.jurisdictions,
      },
      now
    );
    await loadLiveArtifactSetForLaunchValidation(tx, {
      engineVersion: packet.engineVersion,
      references: packet.artifactBindings,
      now,
    });
    const activationId = `live-activation-${contentHash({ packetId: row.id, digest: row.contentDigest }).slice(0, 24)}`;
    await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_live_activation_action', 'ACTIVATE', true)`;
    const activation = await tx.aiCoachLiveActivation.create({
      data: {
        id: activationId,
        state: "ACTIVE",
        packetId: row.id,
        packetDigest: row.contentDigest,
        releaseId: row.releaseId,
        runtimeConfigurationDigest: packet.runtimeConfigurationDigest,
        signedActivationRef: input.signedActivationRef.trim(),
        reasonCode: input.reasonCode.trim(),
      },
    });
    await tx.aiCoachLiveActivationEvent.create({
      data: {
        actorUserId: input.actorUserId,
        governanceGrantId: grant.id,
        activationId,
        packetId: row.id,
        action: "ACTIVATE",
        packetDigest: row.contentDigest,
        runtimeConfigurationDigest: packet.runtimeConfigurationDigest,
        signedActivationRef: input.signedActivationRef.trim(),
        reasonCode: input.reasonCode.trim(),
      },
    });
    for (const scope of [
      "GENERATION",
      "PROVIDER",
      "FINALIZATION",
      "ACCEPTANCE",
      "ARTIFACT_PUBLICATION",
    ] as const) {
      const current = await tx.aiCoachOperationalControl.findUnique({ where: { scope } });
      const revision = (current?.revision ?? -1) + 1;
      await tx.aiCoachOperationalControl.upsert({
        where: { scope },
        create: {
          scope,
          disabled: false,
          reasonCode: "GOVERNED_LIVE_RELEASE_ACTIVATED",
          updatedByGrantId: grant.id,
          revision,
        },
        update: {
          disabled: false,
          reasonCode: "GOVERNED_LIVE_RELEASE_ACTIVATED",
          incidentReference: null,
          updatedByGrantId: grant.id,
          revision,
        },
      });
      await tx.aiCoachOperationalEvent.create({
        data: {
          actorUserId: input.actorUserId,
          scope,
          disabled: false,
          reasonCode: "GOVERNED_LIVE_RELEASE_ACTIVATED",
          revision,
        },
      });
    }
    return activation;
  });
}

export async function deactivateAiCoachLiveRelease(input: {
  actorUserId: string;
  signedActivationRef: string;
  reasonCode: string;
  reason: string;
  incidentReference?: string | null;
}) {
  const reason = input.reason.trim();
  if (!reason || !input.signedActivationRef.trim() || !input.reasonCode.trim()) {
    throw new LiveLaunchError(
      "LIVE_LAUNCH_PACKET_INVALID",
      "Deactivation requires a signed reference, reason code and reason."
    );
  }
  return db.$transaction(async (tx) => {
    const grant = await requireGovernanceGrant(input.actorUserId, "DEACTIVATE_LIVE_LAUNCH", tx);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('steadfast.ai_coach.live_activation'))::text`;
    const active = await tx.aiCoachLiveActivation.findFirst({ where: { state: "ACTIVE" } });
    if (!active) throw new LiveLaunchError("LIVE_ACTIVATION_MISSING", "No live release is active.");
    await tx.$queryRaw`SELECT set_config('steadfast.ai_coach_live_activation_action', 'DEACTIVATE', true)`;
    const deactivated = await tx.aiCoachLiveActivation.update({
      where: { id: active.id },
      data: {
        state: "DEACTIVATED",
        revision: { increment: 1 },
        deactivatedAt: new Date(),
        deactivationReason: reason,
      },
    });
    await tx.aiCoachLiveActivationEvent.create({
      data: {
        actorUserId: input.actorUserId,
        governanceGrantId: grant.id,
        activationId: active.id,
        packetId: active.packetId,
        action: "DEACTIVATE",
        packetDigest: active.packetDigest,
        runtimeConfigurationDigest: active.runtimeConfigurationDigest,
        signedActivationRef: input.signedActivationRef.trim(),
        reasonCode: input.reasonCode.trim(),
        incidentReference: input.incidentReference ?? null,
      },
    });
    for (const scope of [
      "GENERATION",
      "PROVIDER",
      "FINALIZATION",
      "ACCEPTANCE",
      "ARTIFACT_PUBLICATION",
    ] as const) {
      const current = await tx.aiCoachOperationalControl.findUnique({ where: { scope } });
      const revision = (current?.revision ?? -1) + 1;
      await tx.aiCoachOperationalControl.upsert({
        where: { scope },
        create: {
          scope,
          disabled: true,
          reasonCode: input.reasonCode.trim(),
          incidentReference: input.incidentReference ?? null,
          updatedByGrantId: grant.id,
          revision,
        },
        update: {
          disabled: true,
          reasonCode: input.reasonCode.trim(),
          incidentReference: input.incidentReference ?? null,
          updatedByGrantId: grant.id,
          revision,
        },
      });
      await tx.aiCoachOperationalEvent.create({
        data: {
          actorUserId: input.actorUserId,
          scope,
          disabled: true,
          reasonCode: input.reasonCode.trim(),
          incidentReference: input.incidentReference ?? null,
          revision,
        },
      });
    }
    return deactivated;
  });
}
