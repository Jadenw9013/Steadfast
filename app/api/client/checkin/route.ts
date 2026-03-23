import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday, getLocalDate } from "@/lib/utils/date";
import type { Prisma } from "@/app/generated/prisma/client";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const createCheckInApiSchema = z.object({
  weight: z.number().positive().optional(),
  bodyFatPct: z.number().min(0).max(100).optional(),
  dietCompliance: z.number().int().min(1).max(10).optional(),
  energyLevel: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(5000).optional(),
  customResponses: z.record(z.string(), z.unknown()).optional(),
  overwriteToday: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = createCheckInApiSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { weight, bodyFatPct, dietCompliance, energyLevel, notes, customResponses, overwriteToday } = parsed.data;

    // Require an assigned coach (mirrors server action behaviour)
    const coachAssignment = await db.coachClient.findFirst({
      where: { clientId: user.id },
      select: { id: true, coachId: true },
    });
    if (!coachAssignment) {
      return NextResponse.json(
        { error: "Connect to a coach before submitting check-ins" },
        { status: 422 }
      );
    }

    const now = new Date();
    const weekDate = normalizeToMonday(now);
    const tz = user.timezone || "America/Los_Angeles";
    const localDate = getLocalDate(now, tz);

    const checkInFields = {
      weight: weight ?? null,
      bodyFatPct: bodyFatPct ?? null,
      dietCompliance: dietCompliance ?? null,
      energyLevel: energyLevel ?? null,
      notes: notes || null,
      ...(customResponses && {
        customResponses: toJsonValue(customResponses),
      }),
    };

    // Check for existing check-in today
    const existingToday = await db.checkIn.findFirst({
      where: { clientId: user.id, localDate, deletedAt: null },
      orderBy: { submittedAt: "desc" },
      select: { id: true, submittedAt: true },
    });

    // Conflict: existing today, caller hasn't specified overwrite preference
    if (existingToday && overwriteToday === undefined) {
      return NextResponse.json(
        {
          conflict: {
            code: "CHECKIN_EXISTS_TODAY",
            existing: {
              id: existingToday.id,
              submittedAt: existingToday.submittedAt.toISOString(),
            },
          },
        },
        { status: 409 }
      );
    }

    let checkIn;

    if (existingToday && overwriteToday === true) {
      // Overwrite: update the existing check-in for today
      const [, updated] = await db.$transaction([
        db.checkInPhoto.deleteMany({ where: { checkInId: existingToday.id } }),
        db.checkIn.update({
          where: { id: existingToday.id },
          data: {
            ...checkInFields,
            weekOf: weekDate,
            submittedAt: now,
            localDate,
            timezone: tz,
            status: "SUBMITTED",
          },
        }),
      ]);
      checkIn = updated;
    } else {
      // New check-in
      checkIn = await db.checkIn.create({
        data: {
          clientId: user.id,
          weekOf: weekDate,
          isPrimary: true,
          submittedAt: now,
          localDate,
          timezone: tz,
          ...checkInFields,
        },
      });

      // Notify coach (fire-and-forget, mirrors server action)
      if (coachAssignment.coachId) {
        const coachId = coachAssignment.coachId;
        const clientName = user.firstName || "Your client";

        Promise.resolve().then(async () => {
          try {
            const { notifyClientCheckInSubmitted } = await import("@/lib/sms/notify");
            notifyClientCheckInSubmitted(coachId, clientName).catch(console.error);
          } catch { /* ignore */ }

          try {
            const coach = await db.user.findUnique({
              where: { id: coachId },
              select: { email: true, firstName: true, emailClientCheckIns: true },
            });
            if (coach?.email && coach.emailClientCheckIns) {
              const { sendEmail } = await import("@/lib/email/sendEmail");
              const { clientCheckinSubmittedEmail } = await import("@/lib/email/templates");
              const email = clientCheckinSubmittedEmail(coach.firstName || "Coach", clientName);
              sendEmail({ to: coach.email, ...email }).catch(console.error);
            }
          } catch { /* ignore */ }
        }).catch(console.error);
      }
    }

    return NextResponse.json({ checkIn: { id: checkIn.id } }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/client/checkin]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
