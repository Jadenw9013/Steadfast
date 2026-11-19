import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { checkMealPlanWriter, mealPlanWriterRefusalResponse } from "@/lib/meal-plans/writer-gate";
import { reportServerError } from "@/lib/observability/report";
import { planModeSchema, setClientPlanModeForCoach } from "@/lib/meal-plans/macro-targets";

type Params = { params: Promise<{ clientId: string }> };

const setPlanModeSchema = z.object({
  mode: planModeSchema,
});

async function verifyAssignment(coachId: string, clientId: string) {
  return db.coachClient.findUnique({
    where: { coachId_clientId: { coachId, clientId } },
    select: { id: true },
  });
}

// ── POST — coach switches a client between meal-plan and macro-only mode ────

export async function POST(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { clientId } = await params;

    if (!(await verifyAssignment(user.id, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const writer = await checkMealPlanWriter(user.id, clientId);
    if (!writer.ok) return mealPlanWriterRefusalResponse(writer);
    const body = await req.json();
    const parsed = setPlanModeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    await setClientPlanModeForCoach(user.id, clientId, parsed.data.mode);

    return NextResponse.json({ success: true, planMode: parsed.data.mode });
  } catch (err) {
    reportServerError("sf.plan-mode.failed", err, { route: "/api/coach/clients/[id]/plan-mode", statusCode: 500 });
    console.error("[POST /api/coach/clients/[clientId]/plan-mode]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
