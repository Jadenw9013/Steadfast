import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createProfilePhotoUploadUrl } from "@/lib/supabase/profile-photo-storage";
import { validateProfilePhotoUpload } from "@/lib/security/upload-validation";
import { rateLimitOrReject } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";

/** Map MIME type to file extension for storage path. */
function extensionFromMime(mime: string): string {
    switch (mime) {
        case "image/png": return "png";
        case "image/webp": return "webp";
        case "image/jpeg":
        default: return "jpg";
    }
}

export async function POST(req: NextRequest) {
    // Rate limit
    const blocked = await rateLimitOrReject("profile-photo-upload");
    if (blocked) return blocked;

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

    // Require mimeType — reject if missing
    const mimeType = req.nextUrl.searchParams.get("mimeType");
    if (!mimeType) {
        return NextResponse.json(
            { error: "mimeType query parameter is required." },
            { status: 400 }
        );
    }

    const validation = validateProfilePhotoUpload(mimeType);
    if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Use correct extension from MIME type
    const type = req.nextUrl.searchParams.get("type") || "avatar";
    const prefix = type === "banner" ? "banner" : "avatar";
    const ext = extensionFromMime(mimeType);
    const storagePath = `${user.id}/${prefix}-${Date.now()}.${ext}`;

    try {
        const { signedUrl, token } = await createProfilePhotoUploadUrl(storagePath);
        // storagePath is safe to return — it only contains the user's own ID
        // and is validated server-side in confirmProfilePhoto
        return NextResponse.json({ signedUrl, token, storagePath });
    } catch {
        return NextResponse.json(
            { error: "Failed to generate upload URL. Please try again." },
            { status: 500 }
        );
    }
}
