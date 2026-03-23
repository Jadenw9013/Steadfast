import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";

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
    const weekOfParam = searchParams.get("weekOf");

    if (!clientId || !weekOfParam) {
      return NextResponse.json(
        { error: "clientId and weekOf query params are required" },
        { status: 400 }
      );
    }

    let weekOf: Date;
    try {
      weekOf = parseWeekStartDate(weekOfParam);
    } catch {
      return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
    }

    // Authorization check
    // Check client self-access first so dual-role users aren't blocked
    if (user.isClient && user.id === clientId) {
      // Client accessing their own thread — always allowed
    } else if (user.isCoach) {
      const assignment = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: user.id, clientId } },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = await db.message.findMany({
      where: { clientId, weekOf },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        body: true,
        senderId: true,
        weekOf: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        content: m.body,
        senderId: m.senderId,
        weekOf: m.weekOf.toISOString(),
        createdAt: m.createdAt.toISOString(),
        isDraft: false,
      })),
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
  weekOf: z.string().min(1),
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

    const { clientId, weekOf: weekOfParam, content } = parsed.data;

    let weekOf: Date;
    try {
      weekOf = parseWeekStartDate(weekOfParam);
    } catch {
      return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
    }

    // Authorization — client self-access checked first so dual-role users aren't blocked
    const actingAsClient = user.isClient && user.id === clientId;
    if (actingAsClient) {
      const hasCoach = await db.coachClient.findFirst({
        where: { clientId: user.id },
        select: { id: true },
      });
      if (!hasCoach) {
        return NextResponse.json(
          { error: "Connect to a coach before sending messages" },
          { status: 422 }
        );
      }
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
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const message = await db.message.create({
      data: { clientId, weekOf, senderId: user.id, body: content },
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
            select: { email: true, firstName: true, emailCoachMessages: true },
          });
          if (client?.email && client.emailCoachMessages) {
            const { sendEmail } = await import("@/lib/email/sendEmail");
            const { newMessageEmail } = await import("@/lib/email/templates");
            const email = newMessageEmail(client.firstName || "there", senderName, "/client/messages");
            sendEmail({ to: client.email, ...email }).catch(console.error);
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
              select: { email: true, firstName: true, emailClientMessages: true },
            });
            if (coach?.email && coach.emailClientMessages) {
              const { sendEmail } = await import("@/lib/email/sendEmail");
              const { newMessageEmail } = await import("@/lib/email/templates");
              const email = newMessageEmail(coach.firstName || "Coach", senderName, "/coach");
              sendEmail({ to: coach.email, ...email }).catch(console.error);
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
          weekOf: message.weekOf.toISOString(),
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
