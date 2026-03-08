import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createProfilePhotoUploadUrl } from "@/lib/supabase/profile-photo-storage";
import { db } from "@/lib/db";

export async function POST() {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
        where: { clerkId },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const storagePath = `${user.id}/profile.jpg`;

    try {
        const { signedUrl, token } = await createProfilePhotoUploadUrl(storagePath);
        return NextResponse.json({ signedUrl, token, storagePath });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload URL creation failed";
        console.error("[profile-photo/upload-url] Error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
