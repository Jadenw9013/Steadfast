import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Clerk webhook verification failed", err);
    return new Response("Webhook verification failed", { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, public_metadata } =
      evt.data;

    const email = email_addresses[0]?.email_address;
    if (!email) {
      return new Response("No email found", { status: 400 });
    }

    const isCoach =
      (public_metadata?.role as string)?.toUpperCase() === "COACH";
    const activeRole = isCoach ? "COACH" : "CLIENT" as const;

    await db.user.upsert({
      where: { clerkId: id },
      update: {
        email,
        firstName: first_name,
        lastName: last_name,
        activeRole,
        isCoach,
        isClient: !isCoach,
      },
      create: {
        clerkId: id,
        email,
        firstName: first_name,
        lastName: last_name,
        activeRole,
        isCoach,
        isClient: !isCoach,
      },
    });
  }

  return new Response("OK", { status: 200 });
}
