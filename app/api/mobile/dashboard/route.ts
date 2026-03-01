import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getClientCheckInsLight, getLatestCoachMessage } from "@/lib/queries/check-ins";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { getWeightHistory } from "@/lib/queries/weight-history";
import { getCoachClientsWithWeekStatus } from "@/lib/queries/check-ins";

export async function GET() {
    try {
        const user = await getCurrentDbUser();

        if (user.activeRole === "CLIENT") {
            const coachAssignment = await db.coachClient.findFirst({
                where: { clientId: user.id },
                include: {
                    coach: {
                        select: { firstName: true, lastName: true, email: true },
                    },
                },
            });

            const [checkIns, mealPlan, latestCoachMessage, weightHistory] =
                await Promise.all([
                    getClientCheckInsLight(user.id),
                    getCurrentPublishedMealPlan(user.id),
                    getLatestCoachMessage(user.id),
                    getWeightHistory(user.id),
                ]);

            return NextResponse.json({
                role: "CLIENT",
                user: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                },
                coach: coachAssignment
                    ? {
                        firstName: coachAssignment.coach.firstName,
                        lastName: coachAssignment.coach.lastName,
                    }
                    : null,
                checkIns,
                mealPlan,
                latestCoachMessage,
                weightHistory,
            });
        }

        if (user.activeRole === "COACH") {
            const clients = await getCoachClientsWithWeekStatus(user.id);
            return NextResponse.json({
                role: "COACH",
                user: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    coachCode: user.coachCode,
                },
                clients,
            });
        }

        return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}
