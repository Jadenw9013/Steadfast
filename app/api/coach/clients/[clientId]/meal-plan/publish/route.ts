import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { notifyMealPlanUpdated } from "@/lib/sms/notify";
import { getMealPlanPublishTarget, publishMealPlanTarget } from "@/lib/meal-plans/publish";

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

    const target = await getMealPlanPublishTarget(mealPlanId);
    if (!target) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    if (target.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // CB04 — publishing (supersede + race guard) lives entirely in
    // lib/meal-plans/publish.ts, shared with the publishMealPlan server action.
    const result = await publishMealPlanTarget(target);
    if (!result.ok) {
      if (result.code === "NOT_DRAFT") {
        return NextResponse.json(
          { error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "This plan was already published or changed by someone else",
          code: "PUBLISH_RACE_LOST",
        },
        { status: 409 }
      );
    }

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
