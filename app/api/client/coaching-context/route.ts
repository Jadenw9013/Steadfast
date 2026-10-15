import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { getClientProvider } from "@/lib/queries/client-provider";
export async function GET(req: NextRequest) { return aiHttp(req, false, id => getClientProvider(id)); }
