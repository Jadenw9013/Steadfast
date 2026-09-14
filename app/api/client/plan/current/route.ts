import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { getCurrentClientPlan } from "@/lib/queries/current-client-plan";
export async function GET(req: NextRequest) { return aiHttp(req, false, id => getCurrentClientPlan(id)); }
