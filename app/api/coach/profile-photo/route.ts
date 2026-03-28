import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "profile-photos";
const TTL = 60 * 60; // 1 hour
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getUser() {
  return getCurrentDbUser();
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return map[mime] ?? "jpg";
}

async function signPath(storagePath: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ── GET — return signed URL for current user's profile photo ─────────────────

export async function GET() {
  let user: Awaited<ReturnType<typeof getUser>>;
  try {
    user = await getUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { profilePhotoPath: true },
    });

    const storagePath = dbUser?.profilePhotoPath ?? null;

    if (!storagePath) {
      console.log("[CoachPhoto] source=none userId=%s", user.id);
      return NextResponse.json({ photoUrl: null });
    }

    const photoUrl = await signPath(storagePath);
    if (!photoUrl) {
      console.error("[CoachPhoto] sign error for userId=%s", user.id);
      return NextResponse.json({ photoUrl: null });
    }

    console.log("[CoachPhoto] source=supabase userId=%s", user.id);
    return NextResponse.json(
      { photoUrl },
      { headers: { "Cache-Control": "private, max-age=3000" } }
    );
  } catch (err) {
    console.error("[GET /api/coach/profile-photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST — upload / replace profile photo (multipart/form-data) ──────────────

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getUser>>;
  try {
    user = await getUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Parse multipart
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate mime type
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type. Use JPEG, PNG, or WebP.` },
        { status: 415 }
      );
    }

    // Validate size
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 413 });
    }

    const ext = extFromMime(file.type);
    const newPath = `${user.id}/avatar.${ext}`;

    // Read old path before upload so we can clean up after if needed
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { profilePhotoPath: true },
    });
    const oldPath = dbUser?.profilePhotoPath ?? null;

    // Upload new file first — upsert (overwrite if same path)
    const supabase = createServiceClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[CoachPhotoUpload] upload error:", uploadError.message);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    console.log("[CoachPhotoUpload] uploaded path=%s userId=%s", newPath, user.id);

    // Persist new path to DB
    await db.user.update({
      where: { id: user.id },
      data: { profilePhotoPath: newPath },
    });

    // Cleanup old file if it was a different path (non-destructive — log only on failure)
    if (oldPath && oldPath !== newPath) {
      const { error: delErr } = await supabase.storage.from(BUCKET).remove([oldPath]);
      if (delErr) {
        console.error("[CoachPhotoUpload] cleaned old path=%s failed:", oldPath, delErr.message);
      } else {
        console.log("[CoachPhotoUpload] cleaned old path=%s", oldPath);
      }
    }

    // Return fresh signed URL for immediate UI refresh
    const photoUrl = await signPath(newPath);

    return NextResponse.json({
      success: true,
      photoUrl,
      photoPath: newPath,
      profilePhotoPath: newPath,
    });
  } catch (err) {
    console.error("[POST /api/coach/profile-photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── DELETE — remove profile photo ─────────────────────────────────────────────

export async function DELETE() {
  let user: Awaited<ReturnType<typeof getUser>>;
  try {
    user = await getUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { profilePhotoPath: true },
    });

    const storagePath = dbUser?.profilePhotoPath ?? null;

    // Clear DB first so the app falls back cleanly even if storage deletion fails
    await db.user.update({
      where: { id: user.id },
      data: { profilePhotoPath: null },
    });

    if (storagePath) {
      const supabase = createServiceClient();
      const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (error) {
        console.error("[CoachPhotoDelete] storage cleanup failed:", error.message);
      } else {
        console.log("[CoachPhotoDelete] deleted path=%s userId=%s", storagePath, user.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/coach/profile-photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
