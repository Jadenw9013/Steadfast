import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import { createMealPlanUploadUrl } from "@/lib/supabase/meal-plan-storage";
import { validateUploadFile } from "@/lib/validations/meal-plan-import";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

    const body = await req.json();
    const { clientId, filename, mimeType } = body as {
      clientId?: string;
      filename?: string;
      mimeType?: string;
    };

    if (!clientId || !filename || !mimeType) {
      return NextResponse.json({ error: "Missing clientId, filename, or mimeType" }, { status: 400 });
    }

    // Verify coach-client relationship
    const assignment = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: coach.id, clientId } },
    });
    if (!assignment) return NextResponse.json({ error: "Not assigned to this client" }, { status: 403 });

    // Validate file type
    const validation = validateUploadFile(mimeType);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Build storage path: coaches/{coachId}/clients/{clientId}/{timestamp}_{filename}
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `coaches/${coach.id}/clients/${clientId}/${Date.now()}_${sanitized}`;

    // Create DB record
    const upload = await db.mealPlanUpload.create({
      data: {
        coachId: coach.id,
        clientId,
        storagePath,
        originalFilename: filename,
        mimeType,
        status: "UPLOADED",
      },
    });

    // Generate signed upload URL
    const { signedUrl, token } = await createMealPlanUploadUrl(storagePath);

    return NextResponse.json({
      uploadId: upload.id,
      path: storagePath,
      signedUrl,
      token,
    });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[upload-url]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
