import { NextRequest } from "next/server";
import { z } from "zod";
import { aiHttp } from "@/lib/ai-coach/http";
import { AiCoachError } from "@/lib/ai-coach/access";
import { declinePlanVersion } from "@/lib/ai-coach/plan-acceptance";
const inputSchema = z.object({ requestKey: z.string().uuid().optional(), reason: z.string().max(500).optional() }).strict();
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return aiHttp(req, true, async (clientId, body) => {
    const input = inputSchema.safeParse(body);
    if (!input.success) throw new AiCoachError("VALIDATION_ERROR", "Invalid decline request.", 422);
    const result = await declinePlanVersion(clientId, id, input.data.reason);
    if (!result.success) throw new AiCoachError("VALIDATION_ERROR", result.error, 422);
    return { declined: true };
  });
}
