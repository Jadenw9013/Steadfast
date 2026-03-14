import { auth } from "@clerk/nextjs/server";
import crypto from "crypto";
import { db, prismaErrorMessage } from "@/lib/db";
import { createWorkoutUploadUrl } from "@/lib/supabase/workout-storage";
import { validateWorkoutUploadFile } from "@/lib/validations/workout-import";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

    const body = await req.json();
    const { filename, mimeType, clientId } = body as {
      filename?: string;
      mimeType?: string;
      clientId?: string;
    };

    if (!filename || !mimeType) {
      return NextResponse.json({ error: "Missing filename or mimeType" }, { status: 400 });
    }

    // If clientId provided, verify coach-client relationship
    if (clientId) {
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: coach.id, clientId } },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Not assigned to this client" }, { status: 403 });
      }
    }

    const validation = validateWorkoutUploadFile(mimeType);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = clientId
      ? `coaches/${coach.id}/clients/${clientId}/workout-plans/${crypto.randomUUID()}_${sanitized}`
      : `coaches/${coach.id}/workout-plans/${crypto.randomUUID()}_${sanitized}`;

    const workoutImport = await db.workoutImport.create({
      data: {
        coachId: coach.id,
        clientId: clientId ?? null,
        storagePath,
        originalFilename: filename,
        mimeType,
        status: "UPLOADED",
      },
    });

    const { signedUrl, token } = await createWorkoutUploadUrl(storagePath);

    return NextResponse.json({
      importId: workoutImport.id,
      path: storagePath,
      signedUrl,
      token,
    });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[workout-import/upload-url]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
