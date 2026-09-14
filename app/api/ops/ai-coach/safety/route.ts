import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { getSafetyCases, resolveAiSafety } from "@/lib/ai-coach/safety-resolution";
export async function GET(req: NextRequest) { return aiHttp(req, false, id => getSafetyCases(id), "reviewer"); }
export async function POST(req: NextRequest) { return aiHttp(req, true, (id, body) => resolveAiSafety(id, body), "reviewer"); }
