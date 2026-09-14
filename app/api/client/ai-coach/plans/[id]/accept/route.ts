import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { AiCoachError } from "@/lib/ai-coach/access";
import { acceptPlanVersionAtomic } from "@/lib/ai-coach/plan-acceptance";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return aiHttp(req, true, async (clientId, body) => {
    const result = await acceptPlanVersionAtomic(clientId, id, body);
    if (!result.success) throw new AiCoachError(result.code, result.error, result.code === "NOT_FOUND" ? 404 : result.code === "VALIDATION_ERROR" ? 422 : result.code === "TEMPORARILY_UNAVAILABLE" ? 503 : ["ENTITLEMENT_REQUIRED", "FORBIDDEN"].includes(result.code) ? 403 : 409);
    return { alreadyAccepted: result.alreadyAccepted, activeVersionId: result.activeVersionId };
  });
}
