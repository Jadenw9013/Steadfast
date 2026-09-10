import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── Shared authorization helper ─────────────────────────────────────────────
// Only allow reporting a user you're actually in an active coach<->client
// relationship with.

async function assertActiveRelationship(
  userId: string,
  isCoach: boolean,
  isClient: boolean,
  targetUserId: string
): Promise<boolean> {
  if (isClient) {
    const asClient = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: targetUserId, clientId: userId } },
      select: { id: true },
    });
    if (asClient) return true;
  }
  if (isCoach) {
    const asCoach = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: userId, clientId: targetUserId } },
      select: { id: true },
    });
    if (asCoach) return true;
  }
  return false;
}

const reportSchema = z.object({
  targetUserId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  reason: z.string().min(1).max(200),
  details: z.string().max(5000).optional(),
});

// ── POST — report a user ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { targetUserId, messageId, reason, details } = parsed.data;

    if (targetUserId === user.id) {
      return NextResponse.json({ error: "You can't report yourself" }, { status: 422 });
    }

    const authorized = await assertActiveRelationship(
      user.id,
      user.isCoach,
      user.isClient,
      targetUserId
    );
    if (!authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const report = await db.messageReport.create({
      data: {
        reporterId: user.id,
        reportedId: targetUserId,
        messageId: messageId ?? null,
        reason,
        details: details ?? null,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json(
      { success: true, report: { id: report.id, createdAt: report.createdAt.toISOString() } },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/messages/report]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
