import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createPortfolioMediaUploadUrl } from "@/lib/supabase/portfolio-storage";
import { db } from "@/lib/db";

export async function POST() {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
        where: { clerkId },
        select: { id: true, isCoach: true },
    });

    if (!user || !user.isCoach) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
    });

    if (!profile) {
        return NextResponse.json({ error: "Create a marketplace profile first" }, { status: 400 });
    }

    const storagePath = `portfolio/${profile.id}/${crypto.randomUUID()}`;

    try {
        const { signedUrl, token } = await createPortfolioMediaUploadUrl(storagePath);
        return NextResponse.json({ signedUrl, token, storagePath });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload URL creation failed";
        console.error("[portfolio-media/upload-url] Error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
