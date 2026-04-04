import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// Map ClientIntake fields to answers array
const CI_FIELDS = [
  "bodyweightLbs", "heightInches", "ageYears", "gender", "primaryGoal",
  "trainingExperience", "trainingDaysPerWeek", "gymAccess",
  "injuries", "dietaryRestrictions", "dietaryPreferences", "currentDiet",
];

function toAnswersArray(ci: Record<string, unknown>): { questionId: string; answer: string }[] {
  return CI_FIELDS
    .filter((f) => ci[f] != null && ci[f] !== "")
    .map((f) => ({ questionId: f, answer: String(ci[f]) }));
}

function packetFormAnswersToArray(
  formAnswers: unknown
): { questionId: string; answer: string }[] {
  if (!formAnswers || typeof formAnswers !== "object") return [];
  const obj = formAnswers as Record<string, unknown>;
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ({ questionId: k, answer: String(v) }));
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // ── 1. Try IntakePacket first ────────────────────────────────────────
    const packet = await db.intakePacket.findUnique({
      where: { id },
      select: {
        id: true,
        submittedAt: true,
        formAnswers: true,
        coachingRequest: {
          select: {
            prospectId: true,
            coachProfile: {
              select: {
                userId: true,
                user: { select: { email: true, firstName: true } },
              },
            },
          },
        },
      },
    });

    if (packet) {
      if (packet.coachingRequest.prospectId !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (packet.submittedAt) {
        return NextResponse.json({ error: "Already submitted" }, { status: 409 });
      }

      const now = new Date();
      const updated = await db.intakePacket.update({
        where: { id },
        data: { submittedAt: now },
        select: { id: true, formAnswers: true, submittedAt: true },
      });

      // Fetch coach template for the response
      const coachId = packet.coachingRequest.coachProfile.userId;
      const template = await db.intakeFormTemplate.findUnique({
        where: { coachId },
        select: { id: true, sections: true },
      });

      // Fire-and-forget coach notification email
      try {
        const coachEmail = packet.coachingRequest.coachProfile.user.email;
        const clientName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email;
        const { sendEmail } = await import("@/lib/email/sendEmail");
        sendEmail({
          to: coachEmail,
          subject: `${clientName} completed their intake`,
          html: `<p><strong>${clientName}</strong> has submitted their intake questionnaire. <a href="${process.env.NEXT_PUBLIC_APP_URL}/coach/clients/${user.id}">Review it here</a>.</p>`,
          text: `${clientName} has submitted their intake questionnaire.`,
        }).catch(console.error);
      } catch {
        // Notification failure must not break the response
      }

      // Return IntakePacketData shape for iOS
      return NextResponse.json({
        id: updated.id,
        status: "COMPLETED",
        completedAt: updated.submittedAt?.toISOString() ?? null,
        template: template
          ? { id: template.id, name: "Intake Questionnaire", sections: template.sections }
          : { id: "default", name: "Intake Questionnaire", sections: [] },
        answers: packetFormAnswersToArray(updated.formAnswers),
      });
    }

    // ── 2. Try ClientIntake fallback ────────────────────────────────────
    const clientIntake = await db.clientIntake.findUnique({
      where: { id },
    });

    if (!clientIntake) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (clientIntake.clientId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (clientIntake.status === "COMPLETED") {
      return NextResponse.json({ error: "Already submitted" }, { status: 409 });
    }

    const now = new Date();
    const updated = await db.clientIntake.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        startedAt: clientIntake.startedAt ?? now,
      },
    });

    // Fire-and-forget coach notification email
    try {
      const coach = await db.user.findUnique({
        where: { id: clientIntake.coachId },
        select: { email: true },
      });
      if (coach) {
        const clientName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email;
        const { sendEmail } = await import("@/lib/email/sendEmail");
        sendEmail({
          to: coach.email,
          subject: `${clientName} completed their intake`,
          html: `<p><strong>${clientName}</strong> has submitted their intake questionnaire. <a href="${process.env.NEXT_PUBLIC_APP_URL}/coach/clients/${user.id}">Review it here</a>.</p>`,
          text: `${clientName} has submitted their intake questionnaire.`,
        }).catch(console.error);
      }
    } catch {
      // Notification failure must not break the response
    }

    // Return IntakePacketData shape for iOS
    const ci = updated as unknown as Record<string, unknown>;
    return NextResponse.json({
      id: updated.id,
      status: "COMPLETED",
      completedAt: updated.completedAt?.toISOString() ?? null,
      template: {
        id: "ci_default_template",
        name: "Intake Questionnaire",
        sections: [], // template not needed after submission
      },
      answers: toAnswersArray(ci),
    });
  } catch (err) {
    console.error("[POST /api/intake/[id]/submit]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
