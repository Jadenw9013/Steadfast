import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  CLIENT_INTAKE_TEMPLATE,
  clientIntakeToAnswerMap,
  flattenPacketAnswers,
  resolveIntakeTemplate,
  toAnswersArray,
} from "@/lib/intake/completion";

// ── ClientIntake → iOS response shape adapter ─────────────────────────────────
// The iOS IntakeCurrentResponse expects:
//   { status: "NONE"|"PENDING"|"IN_PROGRESS"|"COMPLETED",
//     intake: { id, status, completedAt, template: { id, name, sections }, answers: [{ questionId, answer }] } | null }
//
// IntakePacket and ClientIntake are different DB models. This route queries both
// and returns a unified response so iOS works regardless of which system the
// coach used to send the intake.
//
// The template, the ClientIntake column whitelist and the answer adapters live in
// `lib/intake/completion.ts` — the single source of truth shared with
// `/api/intake/[id]/answers`, `/api/intake/[id]/submit` and the web
// `submitClientIntake` action (T-624).

export async function GET() {
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

  try {
    // ── 1. Try IntakePacket first (lead-pipeline intake) ──────────────────
    const packet = await db.intakePacket.findFirst({
      where: {
        coachingRequest: { prospectId: user.id },
        submittedAt: null,
      },
      select: {
        id: true,
        submittedAt: true,
        formAnswers: true,
        coachingRequest: {
          select: {
            id: true,
            coachProfile: { select: { userId: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Check for completed packet if no in-progress one
    const displayPacket =
      packet ??
      (await db.intakePacket.findFirst({
        where: {
          coachingRequest: { prospectId: user.id },
          submittedAt: { not: null },
        },
        select: {
          id: true,
          submittedAt: true,
          formAnswers: true,
          coachingRequest: {
            select: {
              id: true,
              coachProfile: { select: { userId: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }));

    if (displayPacket) {
      const coachId = displayPacket.coachingRequest.coachProfile.userId;
      const template = await db.intakeFormTemplate.findUnique({
        where: { coachId },
        select: { id: true, sections: true },
      });

      const status: string = displayPacket.submittedAt
        ? "COMPLETED"
        : (displayPacket.formAnswers ? "IN_PROGRESS" : "PENDING");

      const answers = toAnswersArray(flattenPacketAnswers(displayPacket.formAnswers));

      return NextResponse.json({
        status,
        intake: {
          id: displayPacket.id,
          status,
          completedAt: displayPacket.submittedAt?.toISOString() ?? null,
          // fallback template if the coach hasn't customized theirs
          template: resolveIntakeTemplate(template),
          answers,
        },
      });
    }

    // ── 2. Fallback: check ClientIntake (simple intake stepper) ───────────
    const clientIntake = await db.clientIntake.findUnique({
      where: { clientId: user.id },
    });

    if (clientIntake) {
      const ciStatus = clientIntake.status; // PENDING | IN_PROGRESS | COMPLETED
      const answers = toAnswersArray(
        clientIntakeToAnswerMap(clientIntake as unknown as Record<string, unknown>)
      );

      return NextResponse.json({
        status: ciStatus,
        intake: {
          id: clientIntake.id,
          status: ciStatus,
          completedAt: clientIntake.completedAt?.toISOString() ?? null,
          template: CLIENT_INTAKE_TEMPLATE,
          answers,
        },
      });
    }

    // ── 3. No intake at all ──────────────────────────────────────────────
    return NextResponse.json({ status: "NONE", intake: null });
  } catch (err) {
    console.error("[GET /api/intake/current]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
