import { verifiedPrimaryEmail } from "@/lib/auth/verified-email";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveRoleOnCreate, resolveRoleOnUpdate } from "@/lib/auth/clerk-webhook";
import { WEBHOOK_FAILED } from "@/lib/observability/events";
import { reportServerError } from "@/lib/observability/report";

export async function POST(req: NextRequest) {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    reportServerError(WEBHOOK_FAILED.evt, err, {
      route: "/api/webhooks/clerk",
      method: "POST",
      statusCode: 400,
      context: { provider: "clerk", phase: "signature" },
      allow: WEBHOOK_FAILED.allow,
    });
    console.error("Clerk webhook verification failed", err);
    return new Response("Webhook verification failed", { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === "user.created" || eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, public_metadata } =
      evt.data;

    const email = verifiedPrimaryEmail(email_addresses.map(address => ({
      id: address.id, emailAddress: address.email_address, verification: address.verification,
    })), evt.data.primary_email_address_id);
    if (!email) {
      return new Response("Waiting for primary email verification", { status: 200 });
    }

    try {
      if (eventType === "user.created") {
        const roleFields = resolveRoleOnCreate(public_metadata?.role);
        await db.user.upsert({
          where: { clerkId: id },
          update: { email, firstName: first_name, lastName: last_name, ...roleFields },
          create: { clerkId: id, email, firstName: first_name, lastName: last_name, ...roleFields },
        });
      } else {
        const existing = await db.user.findUnique({
          where: { clerkId: id },
          select: { isCoach: true },
        });
        const roleFields = resolveRoleOnUpdate(public_metadata?.role, existing);

        await db.user.upsert({
          where: { clerkId: id },
          update: { email, firstName: first_name, lastName: last_name, ...roleFields },
          create: {
            clerkId: id,
            email,
            firstName: first_name,
            lastName: last_name,
            ...resolveRoleOnCreate(public_metadata?.role),
          },
        });
      }
    } catch (err: unknown) {
      // Handle re-registration: email exists under a different clerkId
      // (e.g. user deleted their account, Clerk user was purged, now re-signing up)
      const isUniqueViolation =
        err instanceof Error && err.message.includes("Unique constraint");
      if (!isUniqueViolation) throw err;

      // Never link identities by email collision. Explicit recovery is required.
      return new Response("Identity conflict requires account recovery", { status: 409 });
    }
  }

  return new Response("OK", { status: 200 });
}
