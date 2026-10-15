import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { createTestimonialImageUploadUrl } from "@/lib/supabase/testimonial-storage";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actingUser = await db.user.findUnique({ where: { clerkId: userId }, select: { isDeactivated: true } });
    if (!actingUser || actingUser.isDeactivated) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { fileName, fileType, fileSize } = await req.json();

        // Validate file type
        if (!ALLOWED_TYPES.includes(fileType)) {
            return NextResponse.json(
                { error: "Only JPEG, PNG, and WebP images are allowed." },
                { status: 400 }
            );
        }

        // Validate file size
        if (fileSize > MAX_SIZE_BYTES) {
            return NextResponse.json(
                { error: "Image must be under 5MB." },
                { status: 400 }
            );
        }

        // Generate a unique storage path
        const ext = fileName?.split(".").pop()?.toLowerCase() || "jpg";
        const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

        const { signedUrl, token } = await createTestimonialImageUploadUrl(storagePath);

        return NextResponse.json({ signedUrl, token, storagePath });
    } catch (error) {
        console.error("[testimonial-image-upload] Error:", error);
        return NextResponse.json(
            { error: "Upload failed" },
            { status: 500 }
        );
    }
}
