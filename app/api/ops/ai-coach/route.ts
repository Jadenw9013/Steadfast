import { NextRequest } from "next/server";
import { z } from "zod";
import { aiHttp } from "@/lib/ai-coach/http";
import { AiCoachError } from "@/lib/ai-coach/access";
import { getReviewerQueue, reviewAiPlan } from "@/lib/ai-coach/reviewer";
export async function GET(req: NextRequest) { return aiHttp(req, false, id => getReviewerQueue(id), "reviewer"); }
const inputSchema = z.object({ planId: z.string().min(1).max(120), requestKey: z.string().uuid(), expectedStateHash: z.string().length(64), approved: z.boolean(), rationale: z.string().max(1000) }).strict();
export async function POST(req: NextRequest) {
  return aiHttp(req, true, async (id, raw) => {
    const input = inputSchema.safeParse(raw);
    if (!input.success) throw new AiCoachError("VALIDATION_ERROR", "Invalid review decision.", 422);
    const { planId, ...decision } = input.data;
    return reviewAiPlan(id, planId, decision);
  }, "reviewer");
}
