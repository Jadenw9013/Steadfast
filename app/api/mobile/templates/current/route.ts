import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getActiveTemplateForClient } from "@/lib/queries/check-in-templates";

/**
 * GET /api/mobile/templates/current
 * Returns the active check-in template for the current client.
 */
export async function GET() {
    try {
        const user = await getCurrentDbUser();
        const template = await getActiveTemplateForClient(user.id);

        if (!template) {
            return NextResponse.json({ templateId: null, questions: [] });
        }

        const questions = (template.questions as unknown[]) ?? [];

        return NextResponse.json({
            templateId: template.id,
            questions,
        });
    } catch {
        return NextResponse.json(
            { error: "Not authenticated" },
            { status: 401 }
        );
    }
}
