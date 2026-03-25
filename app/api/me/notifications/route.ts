import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db as prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    
    // Validate request config
    const allowedKeys = [
      "apnsToken",
      "emailCheckInReminders",
      "emailMealPlanUpdates",
      "emailCoachMessages",
      "emailClientCheckIns",
      "emailClientMessages",
      "emailCoachingRequests",
      "pushMealPlanUpdates",
      "pushCheckInReminders",
      "pushCoachMessages",
      "pushClientCheckIns",
      "pushClientMessages",
      "pushCoachingRequests",
      "smsOptIn"
    ];

    const updateData: any = {};
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        updateData[key] = body[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid settings provided" }, { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { clerkId: userId },
      data: updateData,
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Error updating notification settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: {
        emailCheckInReminders: true,
        emailMealPlanUpdates: true,
        emailCoachMessages: true,
        emailClientCheckIns: true,
        emailClientMessages: true,
        emailCoachingRequests: true,
        pushMealPlanUpdates: true,
        pushCheckInReminders: true,
        pushCoachMessages: true,
        pushClientCheckIns: true,
        pushClientMessages: true,
        pushCoachingRequests: true,
      }
    });

    if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ prefs: user });
  } catch (error) {
    console.error("Error fetching notification settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
