import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";
import { newRequestNotificationEmail } from "@/lib/email/templates";

// ── POST — submit coaching request from marketplace (no auth) ─────────────────

const requestSchema = z.object({
  coachSlug: z.string().min(1, "coachSlug is required"),
  firstName: z.string().min(1, "firstName is required").max(100),
  lastName: z.string().max(100).optional(),
  phoneNumber: z.string().min(7, "Phone number is required").max(30),
  message: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { coachSlug, firstName, lastName, phoneNumber, message } = parsed.data;
    const normalizedPhone = phoneNumber.trim();

    // Find coach by slug
    const profile = await db.coachProfile.findUnique({
      where: { slug: coachSlug },
      select: {
        id: true,
        isPublished: true,
        acceptingClients: true,
        user: {
          select: {
            firstName: true,
            email: true,
            emailCoachingRequests: true,
          },
        },
      },
    });

    if (!profile || !profile.isPublished) {
      return NextResponse.json(
        { error: "Coach profile is unavailable" },
        { status: 404 }
      );
    }

    if (!profile.acceptingClients) {
      return NextResponse.json(
        { error: "This coach is not currently accepting new clients." },
        { status: 422 }
      );
    }

    // Rate limit: prevent multiple pending requests from same phone
    const existingPending = await db.coachingRequest.findFirst({
      where: {
        coachProfileId: profile.id,
        prospectEmail: normalizedPhone,
        status: "PENDING",
      },
      select: { id: true },
    });

    if (existingPending) {
      return NextResponse.json(
        { error: "You already have a pending request with this coach." },
        { status: 409 }
      );
    }

    // If the submitter is authenticated, link their account
    let prospectId: string | undefined;
    try {
      const { auth } = await import("@clerk/nextjs/server");
      const { userId: clerkId } = await auth();
      if (clerkId) {
        const existingUser = await db.user.findUnique({
          where: { clerkId },
          select: { id: true },
        });
        if (existingUser) prospectId = existingUser.id;
      }
    } catch {
      /* unauthenticated — continue without linking */
    }

    // Create CoachingRequest (mirrors submitCoachingRequest action)
    const prospectName = [firstName, lastName].filter(Boolean).join(" ");

    const request = await db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName,
        prospectEmail: normalizedPhone, // legacy field stores phone
        prospectPhone: normalizedPhone,
        intakeAnswers: { message: message || "" },
        status: "PENDING",
        prospectId,
      },
      select: { id: true },
    });

    console.info(
      JSON.stringify({
        event: "marketplace.request.submitted",
        requestId: request.id,
        coachProfileId: profile.id,
        status: "PENDING",
        timestamp: new Date().toISOString(),
      })
    );

    // Coach notification email (preference-gated, fire-and-forget)
    const coachName = profile.user.firstName || "Your coach";
    if (profile.user.emailCoachingRequests) {
      try {
        const notifEmail = newRequestNotificationEmail(
          coachName,
          prospectName,
          `Phone: ${normalizedPhone}`
        );
        sendEmail({ to: profile.user.email, ...notifEmail }).catch(
          console.error
        );
      } catch {
        /* email failure must not break request */
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/public/coaching-request]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
