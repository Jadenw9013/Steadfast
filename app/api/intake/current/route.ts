import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── ClientIntake → iOS response shape adapter ─────────────────────────────────
// The iOS IntakeCurrentResponse expects:
//   { status: "NONE"|"PENDING"|"IN_PROGRESS"|"COMPLETED",
//     intake: { id, status, completedAt, template: { id, name, sections }, answers: [{ questionId, answer }] } | null }
//
// IntakePacket and ClientIntake are different DB models. This route queries both
// and returns a unified response so iOS works regardless of which system the
// coach used to send the intake.

const CLIENT_INTAKE_TEMPLATE = {
  id: "ci_default_template",
  name: "Intake Questionnaire",
  sections: [
    {
      id: "ci_sec_body",
      title: "Body Measurements",
      questions: [
        { id: "bodyweightLbs", label: "What is your current bodyweight?", type: "number", required: true, options: null, placeholder: "e.g. 175" },
        { id: "heightInches", label: "How tall are you? (inches)", type: "number", required: true, options: null, placeholder: "e.g. 70 (5′10″ = 70)" },
        { id: "ageYears", label: "How old are you?", type: "number", required: true, options: null, placeholder: "e.g. 28" },
        { id: "gender", label: "What is your gender?", type: "select", required: true, options: ["Male", "Female", "Prefer not to say"], placeholder: null },
      ],
    },
    {
      id: "ci_sec_goals",
      title: "Goals & Training",
      questions: [
        { id: "primaryGoal", label: "What is your primary goal?", type: "select", required: true, options: ["Lose body fat", "Build muscle", "Improve athletic performance", "Maintain weight", "General health"], placeholder: null },
        { id: "trainingExperience", label: "How would you describe your training experience?", type: "select", required: true, options: ["Beginner (0–1 year)", "Some experience (1–2 years)", "Intermediate (2–5 years)", "Advanced (5+ years)"], placeholder: null },
        { id: "trainingDaysPerWeek", label: "How many days per week can you train?", type: "number", required: true, options: null, placeholder: "e.g. 4" },
        { id: "gymAccess", label: "What equipment do you have access to?", type: "select", required: true, options: ["Full gym membership", "Home gym with equipment", "Minimal equipment (dumbbells / bands)", "No equipment (bodyweight only)"], placeholder: null },
      ],
    },
    {
      id: "ci_sec_diet",
      title: "Diet & Restrictions",
      questions: [
        { id: "dietaryRestrictions", label: "Do you have any dietary restrictions?", type: "textarea", required: false, options: null, placeholder: "e.g. Vegetarian, gluten-free, no dairy… (or type \"None\")" },
        { id: "dietaryPreferences", label: "Any other food preferences or dislikes?", type: "textarea", required: false, options: null, placeholder: "e.g. I don't like fish, I prefer Mediterranean foods…" },
        { id: "currentDiet", label: "Describe what you typically eat in a day", type: "textarea", required: false, options: null, placeholder: "Walk me through a typical day of eating—meals, snacks, rough portions…" },
      ],
    },
    {
      id: "ci_sec_health",
      title: "Health & Injuries",
      questions: [
        { id: "injuries", label: "Do you have any injuries or physical limitations?", type: "textarea", required: false, options: null, placeholder: "Describe any injuries, pain, or movement restrictions… (or type \"None\")" },
      ],
    },
  ],
};

const CI_FIELDS = [
  "bodyweightLbs", "heightInches", "ageYears", "gender", "primaryGoal",
  "trainingExperience", "trainingDaysPerWeek", "gymAccess",
  "injuries", "dietaryRestrictions", "dietaryPreferences", "currentDiet",
];

function clientIntakeToAnswers(ci: Record<string, unknown>): { questionId: string; answer: string }[] {
  return CI_FIELDS
    .filter((f) => ci[f] != null && ci[f] !== "")
    .map((f) => ({ questionId: f, answer: String(ci[f]) }));
}

// Convert IntakePacket formAnswers (object) to iOS answers array
function packetFormAnswersToArray(
  formAnswers: unknown
): { questionId: string; answer: string }[] {
  if (!formAnswers || typeof formAnswers !== "object") return [];
  const obj = formAnswers as Record<string, unknown>;
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => ({ questionId: k, answer: String(v) }));
}

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

      const answers = packetFormAnswersToArray(displayPacket.formAnswers);

      return NextResponse.json({
        status,
        intake: {
          id: displayPacket.id,
          status,
          completedAt: displayPacket.submittedAt?.toISOString() ?? null,
          template: template
            ? { id: template.id, name: "Intake Questionnaire", sections: template.sections }
            : CLIENT_INTAKE_TEMPLATE, // fallback template if coach hasn't customized
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
      const answers = clientIntakeToAnswers(clientIntake as unknown as Record<string, unknown>);

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
