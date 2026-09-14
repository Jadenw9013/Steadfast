import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { retryManagedRun } from "@/lib/ai-coach/retry-command";
export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) { const { runId } = await params; return aiHttp(req, true, (id, body) => retryManagedRun(id, runId, body)); }
