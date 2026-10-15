import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { deleteAiEvidence } from "@/lib/ai-coach/delete-evidence";
export async function POST(req: NextRequest) { return aiHttp(req, true, (id, body) => deleteAiEvidence(id, body)); }
