import { NextRequest, NextResponse } from "next/server";
import { assertMessagingAllowed } from "@/lib/messages/permissions";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday } from "@/lib/utils/date";

// ── GET — fetch message thread ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId query param is required" },
        { status: 400 }
      );
    }

    // Authorization check
    // Check client self-access first so dual-role users aren't blocked
    let counterpartId: string | null = null;
    // CB03: when the requester is a coach, only their own conversation with
    // this client — never a predecessor coach's history.
    let coachScope: string | undefined;
    if (user.isClient && user.id === clientId) {
      // Client accessing their own thread — always allowed, full archive.
      const assignment = await db.coachClient.findFirst({
        where: { clientId: user.id },
        select: { coachId: true },
      });
      counterpartId = assignment?.coachId ?? null;
    } else if (user.isCoach) {
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: user.id, clientId } },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      counterpartId = clientId;
      coachScope = user.id;
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let isBlockedByMe = false;
    let blockedMe = false;
    if (counterpartId) {
      const [blockedByMeRow, blockedMeRow] = await Promise.all([
        db.userBlock.findUnique({
          where: { blockerId_blockedId: { blockerId: user.id, blockedId: counterpartId } },
          select: { id: true },
        }),
        db.userBlock.findUnique({
          where: { blockerId_blockedId: { blockerId: counterpartId, blockedId: user.id } },
          select: { id: true },
        }),
      ]);
      isBlockedByMe = !!blockedByMeRow;
      blockedMe = !!blockedMeRow;
    }

    const messages = await db.message.findMany({
      where: { clientId, ...(coachScope ? { coachId: coachScope } : {}) },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        senderId: true,
        createdAt: true,
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            activeRole: true,
          },
        },
      },
    });

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        content: m.body,
        senderId: m.senderId,
        createdAt: m.createdAt.toISOString(),
        sender: m.sender,
        isDraft: false,
      })),
      isBlockedByMe,
      blockedMe,
    });
  } catch (err) {
    console.error("[GET /api/messages]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── POST — send message ───────────────────────────────────────────────────────

const sendMessageSchema = z.object({
  clientId: z.string().min(1),
  content: z.string().min(1).max(5000),
});

export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { clientId, content } = parsed.data;

    // Compute weekOf internally for DB compatibility
    const weekOf = normalizeToMonday(new Date());

    // Authorization — client self-access checked first so dual-role users aren't blocked
    const actingAsClient = user.isClient && user.id === clientId;
    let counterpartId: string;
    // CB03: the specific coach this message belongs to.
    let coachIdForMessage: string;
    if (actingAsClient) {
      const hasCoach = await db.coachClient.findFirst({
        where: { clientId: user.id },
        select: { coachId: true },
      });
      if (!hasCoach) {
        return NextResponse.json(
          { error: "Connect to a coach before sending messages" },
          { status: 422 }
        );
      }
      counterpartId = hasCoach.coachId;
      coachIdForMessage = hasCoach.coachId;
    } else if (user.isCoach) {
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: user.id, clientId } },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json(
          { error: "Not assigned to this client" },
          { status: 403 }
        );
      }
      counterpartId = clientId;
      coachIdForMessage = user.id;
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Block check — reject if either party has blocked the other, without
    // revealing which direction the block is in.
    try {
      await assertMessagingAllowed(user.id, counterpartId);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "You can't message this user.") throw error;
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    const message = await db.message.create({
      data: { clientId, weekOf, senderId: user.id, body: content, coachId: coachIdForMessage },
      select: { id: true, body: true, senderId: true, weekOf: true, createdAt: true },
    });

    // Notifications (fire-and-forget, mirrors sendMessage() action)
    Promise.resolve().then(async () => {
      try {
        const senderName = user.firstName || (actingAsClient ? "Your client" : "Your coach");
        if (!actingAsClient && user.isCoach) {
          const { notifyCoachMessage } = await import("@/lib/sms/notify");
          notifyCoachMessage(clientId).catch(console.error);
          const client = await db.user.findUnique({
            where: { id: clientId },
            select: { email: true, firstName: true, emailCoachMessages: true, pushCoachMessages: true },
          });
          if (client?.email && client.emailCoachMessages) {
            const { sendEmail } = await import("@/lib/email/sendEmail");
            const { newMessageEmail } = await import("@/lib/email/templates");
            const email = newMessageEmail(client.firstName || "there", senderName, "/client/messages");
            sendEmail({ to: client.email, ...email }).catch(console.error);
          }
          if (client?.pushCoachMessages) {
            const { pushNewMessage } = await import("@/lib/notifications/push");
            pushNewMessage(clientId, senderName).catch(console.error);
          }
        } else {
          const assignment = await db.coachClient.findFirst({
            where: { clientId: user.id },
            select: { coachId: true },
          });
          if (assignment?.coachId) {
            const { notifyClientMessage } = await import("@/lib/sms/notify");
            notifyClientMessage(assignment.coachId, senderName).catch(console.error);
            const coach = await db.user.findUnique({
              where: { id: assignment.coachId },
              select: { email: true, firstName: true, emailClientMessages: true, pushClientMessages: true },
            });
            if (coach?.email && coach.emailClientMessages) {
              const { sendEmail } = await import("@/lib/email/sendEmail");
              const { newMessageEmail } = await import("@/lib/email/templates");
              const email = newMessageEmail(coach.firstName || "Coach", senderName, "/coach");
              sendEmail({ to: coach.email, ...email }).catch(console.error);
            }
            if (coach?.pushClientMessages) {
              const { pushNewMessage } = await import("@/lib/notifications/push");
              pushNewMessage(assignment.coachId, senderName).catch(console.error);
            }
          }
        }
      } catch (err) {
        console.error("Failed to send message notification", err);
      }
    }).catch(console.error);

    return NextResponse.json(
      {
        message: {
          id: message.id,
          content: message.body,
          senderId: message.senderId,
          createdAt: message.createdAt.toISOString(),
          isDraft: false,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/messages]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
