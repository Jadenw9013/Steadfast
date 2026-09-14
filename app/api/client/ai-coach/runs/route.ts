import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { requestAiRun } from "@/lib/ai-coach/run-command";
export async function POST(req: NextRequest) { return aiHttp(req, true, (clientId, body) => requestAiRun(clientId, body)); }
