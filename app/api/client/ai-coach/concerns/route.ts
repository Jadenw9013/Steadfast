import { NextRequest } from "next/server";
import { z } from "zod";
import { aiHttp } from "@/lib/ai-coach/http";
import { applyEvidenceConcern } from "@/lib/ai-coach/evidence";
import { AiCoachError } from "@/lib/ai-coach/access";
const schema = z.object({ requestKey: z.string().uuid(), payload: z.object({ safetyChanged: z.enum(["YES", "UNSURE"]) }).strict() }).strict();
export async function POST(req: NextRequest) { return aiHttp(req, true, async (id, body) => { const input = schema.safeParse(body); if (!input.success) throw new AiCoachError("VALIDATION_ERROR", "Choose Yes or Unsure to report a concern.", 422); await applyEvidenceConcern(id, input.data); return { saved: true }; }); }
