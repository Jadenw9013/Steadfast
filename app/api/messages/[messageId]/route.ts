import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── DELETE — unsend / delete a message ────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ messageId: string }> }
) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { messageId } = await props.params;

    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    // Find the message
    const message = await db.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, clientId: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Only the sender can unsend their own message
    if (message.senderId !== user.id) {
      return NextResponse.json(
        { error: "You can only unsend your own messages" },
        { status: 403 }
      );
    }

    // Delete the message
    await db.message.delete({
      where: { id: messageId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/messages/:messageId]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
