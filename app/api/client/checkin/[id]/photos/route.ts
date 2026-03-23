import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";

const BUCKET = "check-in-photos";
const MAX_PHOTOS = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id: checkInId } = await params;

    // Verify check-in ownership
    const checkIn = await db.checkIn.findUnique({
      where: { id: checkInId },
      select: {
        clientId: true,
        deletedAt: true,
        _count: { select: { photos: true } },
      },
    });

    if (!checkIn || checkIn.deletedAt) {
      return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    }
    if (checkIn.clientId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existingCount = checkIn._count.photos;
    if (existingCount >= MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_PHOTOS} photos per check-in` },
        { status: 422 }
      );
    }

    const formData = await req.formData();
    const files = formData.getAll("photos") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No photos provided" }, { status: 422 });
    }

    const slots = MAX_PHOTOS - existingCount;
    const toUpload = files.slice(0, slots);

    const supabase = createServiceClient();
    const createdPhotos: { id: string; path: string }[] = [];
    let sortOrder = existingCount;

    for (const file of toUpload) {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${checkInId}/${Date.now()}-${sortOrder}.${ext}`;

      const buffer = Buffer.from(await file.arrayBuffer());

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: file.type || "image/jpeg" });

      if (error) {
        console.error("[photo upload]", error.message);
        continue; // skip failed uploads rather than aborting the whole batch
      }

      const photo = await db.checkInPhoto.create({
        data: { checkInId, storagePath: path, sortOrder },
        select: { id: true, storagePath: true },
      });

      createdPhotos.push({ id: photo.id, path: photo.storagePath });
      sortOrder++;
    }

    return NextResponse.json({ photos: createdPhotos }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/client/checkin/[id]/photos]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
