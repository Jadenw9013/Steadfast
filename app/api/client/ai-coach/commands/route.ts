import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { aiHttp } from "@/lib/ai-coach/http";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
export async function POST(req: NextRequest) {
  return aiHttp(req, true, async (clientId, body) => {
    const result = await applyAiClientCommand(clientId, body);
    revalidatePath("/client", "layout");
    return result;
  });
}
