import { randomUUID } from "crypto";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";
import { consumeQuota } from "@/lib/security/quota";
import { readBoundedBody } from "@/lib/security/body";
import { MAX_CHECKIN_PHOTOS } from "@/lib/validations/check-in";

const BUCKET = "check-in-photos";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try { user = await getCurrentDbUser(); }
  catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
  if (!user.isClient) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const uploaded: string[] = [];
  try {
    const { id: checkInId } = await params;
    const owned = await db.checkIn.findFirst({ where: { id: checkInId, clientId: user.id, deletedAt: null }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    if (!await consumeQuota("photo-batches", user.id, 60, 3600)) return NextResponse.json({ error: "Upload limit reached. Please try again later." }, { status: 429 });
    const bytes = await readBoundedBody(req, 20 * 1024 * 1024);
    const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
    const files = form.getAll("photos");
    if (!files.length || files.length > MAX_CHECKIN_PHOTOS || files.some(file => typeof file === "string" || file.size === 0 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      return NextResponse.json({ error: `Upload 1–${MAX_CHECKIN_PHOTOS} JPEG, PNG, or WebP photos, up to 5 MB each.` }, { status: 422 });
    }
    const images: Buffer[] = [];
    try {
      for (const file of files as File[]) {
        // Decode instead of trusting MIME; normalize orientation and strip EXIF/location.
        images.push(await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
          .rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer());
      }
    } catch { return NextResponse.json({ error: "One of the images could not be read. Please choose another photo." }, { status: 422 }); }
    const supabase = createServiceClient();
    const photos = await db.$transaction(async tx => {
      // Serialize batches so concurrent uploads cannot exceed the photo limit.
      await tx.$queryRaw`SELECT id FROM "CheckIn" WHERE id = ${checkInId} FOR UPDATE`;
      const checkIn = await tx.checkIn.findFirst({ where: { id: checkInId, clientId: user.id, deletedAt: null }, select: { _count: { select: { photos: true } } } });
      if (!checkIn || checkIn._count.photos + images.length > MAX_CHECKIN_PHOTOS) throw new Error("Photo limit reached or check-in unavailable");
      const created: { id: string; path: string }[] = [];
      for (const [index, image] of images.entries()) {
        const path = `${checkInId}/${randomUUID()}.jpg`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, image, { contentType: "image/jpeg" });
        if (error) throw new Error("Photo upload failed");
        uploaded.push(path);
        const photo = await tx.checkInPhoto.create({ data: { checkInId, storagePath: path, sortOrder: checkIn._count.photos + index } });
        created.push({ id: photo.id, path });
      }
      return created;
    }, { timeout: 30000 });
    return NextResponse.json({ photos }, { status: 201 });
  } catch (error) {
    if (uploaded.length) {
      try {
        const result = await createServiceClient().storage.from(BUCKET).remove(uploaded);
        if (result.error) console.error("[photo rollback] Storage cleanup requires retry", result.error.message);
      } catch (cleanupError) { console.error("[photo rollback]", cleanupError); }
    }
    console.error("[check-in photos]", error);
    const tooLarge = error instanceof Error && error.message === "Request too large";
    return NextResponse.json({ error: tooLarge ? "Upload is too large. Please use smaller photos." : "Photos could not be uploaded. Please refresh and try again." }, { status: tooLarge ? 413 : 422 });
  }
}
