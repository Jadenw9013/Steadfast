import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── Shared authorization helper ─────────────────────────────────────────────
// Only allow block/unblock/report actions between users who are actually in
// an active coach<->client relationship with each other.

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

const blockSchema = z.object({
  targetUserId: z.string().min(1),
});

// ── POST — block a user ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { targetUserId } = parsed.data;

    if (targetUserId === user.id) {
      return NextResponse.json({ error: "You can't block yourself" }, { status: 422 });
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

    try {
      await db.userBlock.create({
        data: { blockerId: user.id, blockedId: targetUserId },
      });
    } catch (err: unknown) {
      // Unique constraint violation — already blocked. Idempotent success.
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/messages/block]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── DELETE — unblock a user ─────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { targetUserId } = parsed.data;

    await db.userBlock.deleteMany({
      where: { blockerId: user.id, blockedId: targetUserId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/messages/block]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
