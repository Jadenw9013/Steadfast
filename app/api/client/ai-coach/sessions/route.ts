import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { submitAiSession } from "@/lib/workouts/ai-session";
import { getAiSessions } from "@/lib/queries/ai-sessions";
export async function GET(req: NextRequest) { return aiHttp(req, false, id => getAiSessions(id)); }
export async function POST(req: NextRequest) { return aiHttp(req, true, (id, body) => submitAiSession(id, body)); }
