import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  ANSWER_UNSTORABLE_MESSAGE,
  CLIENT_INTAKE_TEMPLATE,
  clientIntakeToAnswerMap,
  planClientIntakeUpdate,
  flattenPacketAnswers,
  mergePacketAnswers,
  normalizeAnswerInput,
  resolveIntakeTemplate,
  toAnswersArray,
} from "@/lib/intake/completion";

// Answer normalisation, the ClientIntake column whitelist and the merge rules
// live in `lib/intake/completion.ts` (T-624) — shared with `/api/intake/current`,
// `/api/intake/[id]/submit` and the web `submitClientIntake` action.
//
// An answer of "" is an explicit clear: it deletes the key from
// IntakePacket.formAnswers and nulls the ClientIntake column (numeric columns
// included). `template` in the response is never null — iOS decodes it and a
// null there used to fail the whole decode.

export async function PUT(
  req: NextRequest,
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Accept both shapes:
    //   IntakePacket style: { answers: { questionId: value, ... } }
    //   ClientIntake style: { answers: [{ questionId, answer }] }
    const items = normalizeAnswerInput((body as Record<string, unknown>).answers);
    if (!items) {
      return NextResponse.json({ error: "answers required" }, { status: 400 });
    }

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
            coachProfile: { select: { userId: true } },
          },
        },
      },
    });

    if (packet) {
      if (packet.coachingRequest.prospectId !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (packet.submittedAt) {
        return NextResponse.json({ error: "Intake already submitted" }, { status: 409 });
      }

      // Merge answers with existing (partial save). An empty answer deletes the
      // key; unknown top-level keys (e.g. the web form's `sections`) survive.
      const merged = mergePacketAnswers(packet.formAnswers, items);

      // Conditional write, same precondition as submit: a section save that
      // read before a concurrent submit committed must not write its pre-submit
      // merge over the submitted answer set (T-624 review finding 5).
      const result = await db.intakePacket.updateMany({
        where: { id, submittedAt: null },
        data: { formAnswers: merged as Record<string, string> },
      });
      if (result.count === 0) {
        return NextResponse.json({ error: "Intake already submitted" }, { status: 409 });
      }

      const updated = await db.intakePacket.findUnique({
        where: { id },
        select: {
          id: true,
          formAnswers: true,
          submittedAt: true,
        },
      });

      const template = await db.intakeFormTemplate.findUnique({
        where: { coachId: packet.coachingRequest.coachProfile.userId },
        select: { id: true, sections: true },
      });

      // Return flat IntakePacketData shape (iOS expects this, not wrapped)
      // The `?? ` fallbacks are type-satisfying guards on `findUnique`: the row
      // was just updated on this connection, so it cannot be missing here.
      return NextResponse.json({
        id: updated?.id ?? id,
        status: "IN_PROGRESS",
        completedAt: null,
        template: resolveIntakeTemplate(template),
        answers: toAnswersArray(flattenPacketAnswers(updated?.formAnswers ?? merged)),
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
      return NextResponse.json({ error: "Intake already submitted" }, { status: 409 });
    }

    // A value that cannot be stored in its column is refused, not dropped
    // (T-624 review r3, folded T-788). Dropping it and answering 200 is
    // undetectable by the client whenever the column already holds an older
    // value: edit a saved bodyweight of 180 to "." and the re-read echo returns
    // "180", which iOS adopts as a successful save and advances — a lost answer
    // with no error, which is exactly what this ticket exists to stop. The
    // refusal is before the write and covers the whole request, so a section
    // never half-saves; the client fixes the value and the retry re-sends the
    // same set. Same planner, same rule as the submit route.
    const plan = planClientIntakeUpdate(items);
    if (plan.refusedQuestionIds.length > 0) {
      return NextResponse.json(
        {
          error: ANSWER_UNSTORABLE_MESSAGE,
          code: "ANSWER_UNSTORABLE",
          refusedQuestionIds: plan.refusedQuestionIds,
        },
        { status: 422 }
      );
    }

    const ciResult = await db.clientIntake.updateMany({
      where: { id, status: { not: "COMPLETED" } },
      data: {
        ...plan.data,
        status: "IN_PROGRESS",
        startedAt: clientIntake.startedAt ?? new Date(),
      },
    });
    if (ciResult.count === 0) {
      return NextResponse.json({ error: "Intake already submitted" }, { status: 409 });
    }

    const updated = await db.clientIntake.findUnique({ where: { id } });

    // Return flat IntakePacketData shape (iOS expects this, not wrapped)
    return NextResponse.json({
      id: updated?.id ?? id,
      status: "IN_PROGRESS",
      completedAt: null,
      template: CLIENT_INTAKE_TEMPLATE,
      answers: toAnswersArray(
        clientIntakeToAnswerMap((updated ?? clientIntake) as unknown as Record<string, unknown>)
      ),
    });
  } catch (err) {
    console.error("[PUT /api/intake/[id]/answers]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
