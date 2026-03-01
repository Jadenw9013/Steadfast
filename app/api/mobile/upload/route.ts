import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { createSignedUploadUrls } from "@/lib/supabase/storage";
import crypto from "crypto";

/**
 * POST /api/mobile/upload
 * Generate signed upload URLs for check-in photos.
 * Body: { files: [{ fileName: string, contentType: string }] }
 */
export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentDbUser();

        const body = await req.json();
        const files = body.files as
            | { fileName: string; contentType: string }[]
            | undefined;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return NextResponse.json(
                { error: "files array is required" },
                { status: 400 }
            );
        }

        if (files.length > 3) {
            return NextResponse.json(
                { error: "Maximum 3 files allowed" },
                { status: 400 }
            );
        }

        const batchId = crypto.randomUUID();
        const paths = files.map(
            (f, i) => `${user.id}/${batchId}/${i}-${f.fileName}`
        );

        const results = await createSignedUploadUrls(paths);

        const uploads = results.map((r, i) => ({
            fileName: files[i].fileName,
            signedUrl: r.signedUrl,
            token: r.token,
            publicPath: r.path,
        }));

        return NextResponse.json({ uploads });
    } catch (err) {
        console.error("[mobile/upload] Error:", err);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}
