import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
export async function GET(req: NextRequest) { return aiHttp(req, false, clientId => getAiWorkspace(clientId)); }
