import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createPortfolioMediaUploadUrl } from "@/lib/supabase/portfolio-storage";

export async function POST(request: Request) {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
        where: { clerkId },
        select: { id: true, isCoach: true, teamId: true, teamRole: true, isDeactivated: true },
    });

    if (!user || !user.isCoach || user.isDeactivated) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (user.teamRole !== "HEAD_COACH" || !user.teamId) {
        return NextResponse.json(
            { error: "Only the head coach can upload a team logo." },
            { status: 403 }
        );
    }

    const body = await request.json().catch(() => ({})) as { ext?: string };
    const ext = typeof body.ext === "string" ? body.ext.replace(/[^a-z0-9]/g, "") : "jpg";
    const storagePath = `teams/${user.teamId}/logo.${ext}`;

    try {
        const { signedUrl, token } = await createPortfolioMediaUploadUrl(storagePath);
        return NextResponse.json({ signedUrl, token, storagePath });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload URL creation failed";
        console.error("[team-logo] Error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
