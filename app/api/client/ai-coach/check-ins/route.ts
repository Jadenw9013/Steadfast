import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { submitAiCheckIn } from "@/lib/check-ins/submit";
import { getAiObservations } from "@/lib/queries/ai-observations";
export async function GET(req: NextRequest) { return aiHttp(req, false, id => getAiObservations(id)); }
export async function POST(req: NextRequest) { return aiHttp(req, true, (id, body) => submitAiCheckIn(id, body)); }
