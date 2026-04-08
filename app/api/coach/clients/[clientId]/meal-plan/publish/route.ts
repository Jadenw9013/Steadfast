import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { notifyMealPlanUpdated } from "@/lib/sms/notify";

type Params = { params: Promise<{ clientId: string }> };

const publishSchema = z.object({
  mealPlanId: z.string().min(1),
  notifyClient: z.boolean().optional(),
});

// ── POST — publish a draft meal plan ─────────────────────────────────────────

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

    // Verify assignment
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId } },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { mealPlanId, notifyClient } = parsed.data;

    const plan = await db.mealPlan.findUnique({
      where: { id: mealPlanId },
      select: { clientId: true, status: true },
    });
    if (!plan) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    if (plan.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (plan.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Can only publish drafts" },
        { status: 409 }
      );
    }

    await db.mealPlan.update({
      where: { id: mealPlanId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // Fire-and-forget notifications
    if (notifyClient) {
      Promise.resolve()
        .then(async () => {
          try {
            await notifyMealPlanUpdated(clientId, user.firstName);

            const client = await db.user.findUnique({
              where: { id: clientId },
              select: { email: true, firstName: true, emailMealPlanUpdates: true, pushMealPlanUpdates: true },
            });
            if (client?.email && client.emailMealPlanUpdates) {
              const { sendEmail } = await import("@/lib/email/sendEmail");
              const { mealPlanUpdatedEmail } = await import("@/lib/email/templates");
              const email = mealPlanUpdatedEmail(
                client.firstName ?? "there",
                user.firstName ?? "your coach"
              );
              sendEmail({ to: client.email, ...email }).catch(console.error);
            }
            if (client?.pushMealPlanUpdates) {
              const { pushMealPlanUpdated } = await import("@/lib/notifications/push");
              pushMealPlanUpdated(clientId, user.firstName ?? "your coach").catch(console.error);
            }
          } catch (err) {
            console.error("[meal-plan publish] Failed to send notification:", err);
          }
        })
        .catch(console.error);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/coach/clients/[clientId]/meal-plan/publish]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
