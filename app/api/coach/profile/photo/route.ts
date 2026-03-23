import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "profile-photos";
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data" },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type}. Use JPEG, PNG, WebP, or HEIC.`,
        },
        { status: 415 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 10 MB limit" },
        { status: 413 }
      );
    }

    // Derive extension from mime type
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
    };
    const ext = extMap[file.type] ?? "jpg";
    const storagePath = `${user.id}/avatar.${ext}`;

    // Upload to Supabase (service role — bypasses RLS)
    const supabase = createServiceClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[coach/profile/photo] Upload error:", uploadError.message);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Persist path to DB
    await db.user.update({
      where: { id: user.id },
      data: { profilePhotoPath: storagePath },
    });

    return NextResponse.json({ profilePhotoPath: storagePath });
  } catch (err) {
    console.error("[POST /api/coach/profile/photo]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
