import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return aiHttp(req, true, async () => finalizeCurrentClientPlan(id));
}
