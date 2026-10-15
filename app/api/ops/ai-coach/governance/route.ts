import { NextRequest } from "next/server";
import { z } from "zod";
import { aiHttp } from "@/lib/ai-coach/http";
import { publishArtifactVersion, revokeArtifactVersion } from "@/lib/ai-coach/artifacts/repository";
import { SYNTHETIC_ARTIFACT_ENGINE_VERSION } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import {
  getAiCoachOperationalMonitoring,
  operationalControlInputSchema,
  setAiCoachOperationalControl,
} from "@/lib/ai-coach/operations";

const governanceCommandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("SET_CONTROL"), input: operationalControlInputSchema }).strict(),
  z
    .object({
      operation: z.literal("PUBLISH_ARTIFACT"),
      artifactVersionId: z.string().min(1).max(200),
      effectiveAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
      reasonCode: z.string().trim().min(1).max(120),
      incidentReference: z.string().trim().min(1).max(160).nullable(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("REVOKE_ARTIFACT"),
      artifactVersionId: z.string().min(1).max(200),
      reason: z.string().trim().min(1).max(500),
      reasonCode: z.string().trim().min(1).max(120),
      reviewRecordId: z.string().trim().min(1).max(200),
      incidentReference: z.string().trim().min(1).max(160).nullable(),
    })
    .strict(),
]);

export async function GET(req: NextRequest) {
  return aiHttp(
    req,
    false,
    (actorUserId) => getAiCoachOperationalMonitoring(actorUserId),
    "reviewer"
  );
}

export async function POST(req: NextRequest) {
  return aiHttp(
    req,
    true,
    async (actorUserId, raw) => {
      const command = governanceCommandSchema.parse(raw);
      if (command.operation === "SET_CONTROL") {
        return setAiCoachOperationalControl(actorUserId, command.input);
      }
      if (command.operation === "PUBLISH_ARTIFACT") {
        return publishArtifactVersion({
          id: command.artifactVersionId,
          effectiveAt: new Date(command.effectiveAt),
          expiresAt: new Date(command.expiresAt),
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          governance: {
            actorUserId,
            reasonCode: command.reasonCode,
            incidentReference: command.incidentReference,
          },
        });
      }
      return revokeArtifactVersion(command.artifactVersionId, command.reason, {
        actorUserId,
        reasonCode: command.reasonCode,
        reviewRecordId: command.reviewRecordId,
        incidentReference: command.incidentReference,
      });
    },
    "reviewer"
  );
}
