import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  CLIENT_INTAKE_TEMPLATE,
  DOCUMENTS_UNSIGNED_APP_MESSAGE,
  INTAKE_INCOMPLETE_MESSAGE,
  clientIntakeToAnswerMap,
  flattenPacketAnswers,
  mergePacketAnswers,
  missingRequiredAnswers,
  normalizeAnswerInput,
  planClientIntakeUpdate,
  resolveIntakeTemplate,
  toAnswersArray,
  unsignedDocumentIds,
} from "@/lib/intake/completion";

// Submit carries the FULL answer set as a safety net (T-624): the client's
// per-section saves may have been lost, so the payload is merged first and the
// intake is only marked complete if every required question is answered.
// A still-incomplete intake is refused with 422 INTAKE_INCOMPLETE +
// missingQuestionIds before any write, and a packet with an unsigned document
// attached with 422 DOCUMENTS_UNSIGNED, as the web token form already did. The body is optional — an absent or
// unparseable body is treated as "no answers supplied", which is what older iOS
// builds send.
//
// The completeness rule itself lives in `lib/intake/completion.ts` and is shared
// with the web `submitClientIntake` action.

export async function POST(
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
    const incoming =
      body && typeof body === "object"
        ? normalizeAnswerInput((body as Record<string, unknown>).answers) ?? []
        : [];

    // ── 1. Try IntakePacket first ────────────────────────────────────────
    const packet = await db.intakePacket.findUnique({
      where: { id },
      select: {
        id: true,
        submittedAt: true,
        formAnswers: true,
        // Signature state only — no Json column is pulled through a relation.
        documents: { select: { id: true, signature: { select: { id: true } } } },
        coachingRequest: {
          select: {
            id: true,
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

      // Fetch coach template — needed for the completeness check and the response
      const coachId = packet.coachingRequest.coachProfile.userId;
      const templateRow = await db.intakeFormTemplate.findUnique({
        where: { coachId },
        select: { id: true, sections: true },
      });
      const template = resolveIntakeTemplate(templateRow);

      // Merge the submitted answer set over what is already stored, then refuse
      // before any write if a required question is still empty.
      const mergedFormAnswers = mergePacketAnswers(packet.formAnswers, incoming);
      const effective = flattenPacketAnswers(mergedFormAnswers);
      const missing = missingRequiredAnswers(template.sections, effective);
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: INTAKE_INCOMPLETE_MESSAGE,
            code: "INTAKE_INCOMPLETE",
            missingQuestionIds: missing,
          },
          { status: 422 }
        );
      }

      // Documents are the step after the questions in the web packet flow, so
      // they are refused second. The web token form already refuses an unsigned
      // packet (`app/actions/intake.ts` `submitIntakePacket`) and this route did
      // not — one precondition, two surfaces (standing rule 1). It matters more
      // since the stage write above: without this a packet submitted from iOS
      // would give the coach `submittedAt`, the notification email and "Intake
      // Received" on the board with no signature row against any document.
      // iOS cannot sign, so this refusal has to hand the client somewhere: the
      // message names the emailed intake link, which is the only surface that
      // collects a signature, and that form now prefills from and merges into
      // the answers already saved here so finishing there costs them nothing
      // (`app/actions/intake.ts` `submitIntakePacket`, `mergePacketSubmission`).
      const unsigned = unsignedDocumentIds(
        packet.documents,
        packet.documents.filter((doc) => doc.signature !== null).map((doc) => doc.id)
      );
      if (unsigned.length > 0) {
        return NextResponse.json(
          { error: DOCUMENTS_UNSIGNED_APP_MESSAGE, code: "DOCUMENTS_UNSIGNED" },
          { status: 422 }
        );
      }

      // Race-safe: the precondition lives in the WHERE clause, so two concurrent
      // submits cannot both win. The lead's consultation stage moves in the same
      // transaction as the packet, as the web token submit does
      // (`app/actions/intake.ts` `submitIntakePacket`) — without it an
      // iOS-submitted packet leaves the lead stuck on the coach's board — but
      // only from a stage that is not already terminal, unlike that action (see
      // the precondition below). No network I/O inside the transaction
      // (standing rule 5); the coach email is sent after it commits.
      const now = new Date();
      const committed = await db.$transaction(async (tx) => {
        const result = await tx.intakePacket.updateMany({
          where: { id, submittedAt: null },
          data: { formAnswers: mergedFormAnswers as Record<string, string>, submittedAt: now },
        });
        if (result.count === 0) return false;
        // The stage moves only from one that is not already terminal — ACTIVE or
        // DECLINED — which is not the same as "forward": FORMS_SIGNED (set by
        // `app/actions/signature.ts` from the separate /onboarding/sign flow) is
        // a later column and can still be walked back to INTAKE_SUBMITTED here.
        // That is cosmetic; `validateActivationPreconditions` accepts both
        // stages. The terminal pair is what matters: a lead the coach
        // bypass-activated (or declined) can still be handed this un-submitted
        // packet by `GET /api/intake/current`, and an unconditional write would
        // drag an ACTIVE client back into the coach's intake column and re-open
        // activation (`lib/activation.ts` stops answering "Already active." once
        // the stage is INTAKE_SUBMITTED), so the lead could be activated twice.
        await tx.coachingRequest.updateMany({
          where: {
            id: packet.coachingRequest.id,
            consultationStage: { notIn: ["ACTIVE", "DECLINED"] },
          },
          data: { consultationStage: "INTAKE_SUBMITTED" },
        });
        return true;
      });
      if (!committed) {
        return NextResponse.json({ error: "Already submitted" }, { status: 409 });
      }

      const updated = await db.intakePacket.findUnique({
        where: { id },
        select: { id: true, formAnswers: true, submittedAt: true },
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

      // Return IntakePacketData shape for iOS. The `?? ` fallbacks below only
      // satisfy the nullable return type of `findUnique`: the row was just
      // updated on this connection, so it cannot be missing here.
      return NextResponse.json({
        id: updated?.id ?? id,
        status: "COMPLETED",
        completedAt: (updated?.submittedAt ?? now).toISOString(),
        template,
        answers: toAnswersArray(flattenPacketAnswers(updated?.formAnswers ?? mergedFormAnswers)),
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

    // Completeness is derived from what the write will ACTUALLY persist, not
    // from the raw strings: `planClientIntakeUpdate` cannot store "." in a
    // numeric column, so validating the string would pass the guard and then
    // write COMPLETED with the column still null (T-624 review finding 1).
    // Projecting the plan's data over the row and reading it back through the
    // same adapter the response uses makes the guard and the writer the same
    // rule. A refused id is reported too, so a value the client can see on
    // screen is never silently dropped.
    const plan = planClientIntakeUpdate(incoming);
    const effective = clientIntakeToAnswerMap({
      ...(clientIntake as unknown as Record<string, unknown>),
      ...plan.data,
    });
    const missing = [
      ...new Set([
        ...missingRequiredAnswers(CLIENT_INTAKE_TEMPLATE.sections, effective),
        ...plan.refusedQuestionIds,
      ]),
    ];
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: INTAKE_INCOMPLETE_MESSAGE,
          code: "INTAKE_INCOMPLETE",
          missingQuestionIds: missing,
        },
        { status: 422 }
      );
    }

    const now = new Date();
    const result = await db.clientIntake.updateMany({
      where: { id, status: { not: "COMPLETED" } },
      data: {
        ...plan.data,
        status: "COMPLETED",
        completedAt: now,
        startedAt: clientIntake.startedAt ?? now,
      },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Already submitted" }, { status: 409 });
    }

    const updated = await db.clientIntake.findUnique({ where: { id } });

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

    // Return IntakePacketData shape for iOS. As above, the `?? ` fallbacks are
    // type-satisfying guards on `findUnique`, not reachable states.
    return NextResponse.json({
      id: updated?.id ?? id,
      status: "COMPLETED",
      completedAt: (updated?.completedAt ?? now).toISOString(),
      template: CLIENT_INTAKE_TEMPLATE,
      answers: toAnswersArray(
        clientIntakeToAnswerMap((updated ?? clientIntake) as unknown as Record<string, unknown>)
      ),
    });
  } catch (err) {
    console.error("[POST /api/intake/[id]/submit]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
