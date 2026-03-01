import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";

export async function GET() {
    try {
        const user = await getCurrentDbUser();
        const mealPlan = await getCurrentPublishedMealPlan(user.id);
        return NextResponse.json({ mealPlan });
    } catch {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
}
