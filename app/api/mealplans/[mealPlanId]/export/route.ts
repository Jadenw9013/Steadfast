import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { renderMealPlanPdf } from "@/lib/pdf/meal-plan-pdf";
import type { MealPlanPdfData } from "@/lib/pdf/meal-plan-pdf";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mealPlanId: string }> }
) {
  const { mealPlanId } = await params;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { clerkId: userId } });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mealPlan = await db.mealPlan.findUnique({
    where: { id: mealPlanId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      client: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!mealPlan) {
    return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
  }

  // Authorization check
  const isClient = mealPlan.clientId === user.id;
  let coachName: string | undefined;
  let coachHeadline: string | undefined;

  if (!isClient) {
    // Check if user is the coach for this client
    if (!user.isCoach) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const assignment = await db.coachClient.findUnique({
      where: {
        coachId_clientId: { coachId: user.id, clientId: mealPlan.clientId },
      },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    coachName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined;
    const coachProfile = await db.coachProfile.findUnique({
      where: { userId: user.id },
      select: { headline: true },
    });
    coachHeadline = coachProfile?.headline ?? undefined;
  } else {
    // For client export, try to find their coach name
    const assignment = await db.coachClient.findFirst({
      where: { clientId: user.id },
      include: {
        coach: {
          select: {
            firstName: true,
            lastName: true,
            coachProfile: { select: { headline: true } },
          },
        },
      },
    });
    if (assignment) {
      coachName =
        `${assignment.coach.firstName ?? ""} ${assignment.coach.lastName ?? ""}`.trim() ||
        undefined;
      coachHeadline = assignment.coach.coachProfile?.headline ?? undefined;
    }
  }

  const clientName =
    `${mealPlan.client.firstName ?? ""} ${mealPlan.client.lastName ?? ""}`.trim() ||
    "Client";

  const weekLabel = mealPlan.weekOf
    ? mealPlan.weekOf.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    : undefined;

  const pdfData: MealPlanPdfData = {
    clientName,
    coachName,
    coachHeadline,
    weekLabel,
    items: mealPlan.items.map((item) => ({
      mealName: item.mealName,
      foodName: item.foodName,
      quantity: item.quantity,
      unit: item.unit,
      servingDescription: item.servingDescription,
    })),
  };

  const buffer = await renderMealPlanPdf(pdfData);

  const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, "-");
  const dateStr = mealPlan.weekOf
    ? mealPlan.weekOf.toISOString().split("T")[0]
    : "current";
  const filename = `meal-plan_${safeClientName}_${dateStr}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
