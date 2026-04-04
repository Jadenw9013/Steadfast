import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── ClientIntake field whitelist ──────────────────────────────────────────────
// When saving answers to a ClientIntake record, we map the questionId directly
// to the column name. Only these fields are allowed.
const CI_NUMBER_FIELDS = new Set(["bodyweightLbs", "heightInches"]);
const CI_INT_FIELDS = new Set(["ageYears", "trainingDaysPerWeek"]);
const CI_STRING_FIELDS = new Set([
  "gender", "primaryGoal", "trainingExperience", "gymAccess",
  "injuries", "dietaryRestrictions", "dietaryPreferences", "currentDiet",
]);
const CI_ALL_FIELDS = new Set([...CI_NUMBER_FIELDS, ...CI_INT_FIELDS, ...CI_STRING_FIELDS]);

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
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Accept both shapes:
    //   IntakePacket style: { answers: { questionId: value, ... } }
    //   ClientIntake style: { answers: [{ questionId, answer }] }
    const rawAnswers = body.answers;
    if (!rawAnswers || typeof rawAnswers !== "object") {
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
          select: { prospectId: true },
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

      // Merge answers with existing (partial save)
      // Handle both object-style and array-style answers
      let answersToMerge: Record<string, unknown>;
      if (Array.isArray(rawAnswers)) {
        // Array of { questionId, answer } → convert to flat object
        answersToMerge = {};
        for (const item of rawAnswers) {
          if (item.questionId && item.answer !== undefined) {
            answersToMerge[item.questionId] = item.answer;
          }
        }
      } else {
        answersToMerge = rawAnswers;
      }

      const merged = {
        ...(typeof packet.formAnswers === "object" && packet.formAnswers !== null
          ? packet.formAnswers as Record<string, unknown>
          : {}),
        ...answersToMerge,
      };

      const updated = await db.intakePacket.update({
        where: { id },
        data: { formAnswers: merged as Record<string, string> },
        select: {
          id: true,
          formAnswers: true,
          submittedAt: true,
        },
      });

      // Convert object formAnswers to iOS answers array
      const answersObj = typeof updated.formAnswers === "object" && updated.formAnswers !== null
        ? updated.formAnswers as Record<string, unknown>
        : {};
      const answersArray = Object.entries(answersObj)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => ({ questionId: k, answer: String(v) }));

      // Return flat IntakePacketData shape (iOS expects this, not wrapped)
      return NextResponse.json({
        id: updated.id,
        status: "IN_PROGRESS",
        completedAt: null,
        template: null,
        answers: answersArray,
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

    // Parse answers array: [{ questionId, answer }]
    const items: { questionId: string; answer: string }[] = Array.isArray(rawAnswers)
      ? rawAnswers
      : Object.entries(rawAnswers).map(([k, v]) => ({ questionId: k, answer: String(v) }));

    // Build update data from allowed fields
    const updateData: Record<string, unknown> = {
      status: "IN_PROGRESS",
      startedAt: clientIntake.startedAt ?? new Date(),
    };

    for (const item of items) {
      if (!CI_ALL_FIELDS.has(item.questionId)) continue;
      const val = item.answer;
      if (CI_NUMBER_FIELDS.has(item.questionId)) {
        const n = parseFloat(val);
        if (!isNaN(n)) updateData[item.questionId] = n;
      } else if (CI_INT_FIELDS.has(item.questionId)) {
        const n = parseInt(val, 10);
        if (!isNaN(n)) updateData[item.questionId] = n;
      } else {
        updateData[item.questionId] = val || null;
      }
    }

    const updated = await db.clientIntake.update({
      where: { id },
      data: updateData,
    });

    // Return answers array in the same shape iOS expects
    const FIELDS = [
      "bodyweightLbs", "heightInches", "ageYears", "gender", "primaryGoal",
      "trainingExperience", "trainingDaysPerWeek", "gymAccess",
      "injuries", "dietaryRestrictions", "dietaryPreferences", "currentDiet",
    ];
    const ci = updated as unknown as Record<string, unknown>;
    const answersArr = FIELDS
      .filter((f) => ci[f] != null && ci[f] !== "")
      .map((f) => ({ questionId: f, answer: String(ci[f]) }));

    // Return flat IntakePacketData shape (iOS expects this, not wrapped)
    return NextResponse.json({
      id: updated.id,
      status: "IN_PROGRESS",
      completedAt: null,
      template: null,
      answers: answersArr,
    });
  } catch (err) {
    console.error("[PUT /api/intake/[id]/answers]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
