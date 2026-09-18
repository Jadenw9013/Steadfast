import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * T-624 — the iOS-facing intake REST routes must make "COMPLETED with missing
 * answers" impossible, must persist explicit clears (numeric columns included)
 * and must return a real template so the iOS save response can decode.
 *
 * REGRESSION-B and REGRESSION-C below fail against the pre-T-624 routes:
 *   B — submit marked an intake COMPLETED whatever the answers were;
 *   C — both PUT branches returned `template: null`, which threw
 *       `valueNotFound` in the iOS decoder and made every section save look
 *       like a network failure.
 */

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({
  getCurrentDbUser: async () => {
    if (!auth.user) throw new Error("Unauthorized");
    return auth.user;
  },
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mail.sendEmail }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { db } from "@/lib/db";
import { GET as currentRoute } from "@/app/api/intake/current/route";
import { PUT as answersRoute } from "@/app/api/intake/[id]/answers/route";
import { POST as submitRoute } from "@/app/api/intake/[id]/submit/route";
import { submitClientIntake } from "@/app/actions/client-intake";
import { saveReviewEdits, submitIntakePacket } from "@/app/actions/intake";
import IntakeTokenPage from "@/app/onboarding/intake/[token]/page";
import { flattenPacketAnswers } from "@/lib/intake/completion";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

const FULL_CI_ANSWERS: Record<string, string> = {
  bodyweightLbs: "175",
  heightInches: "70",
  ageYears: "28",
  gender: "Male",
  primaryGoal: "Build muscle",
  trainingExperience: "Beginner (0–1 year)",
  trainingDaysPerWeek: "4",
  gymAccess: "Full gym membership",
  injuries: "None",
  dietaryRestrictions: "None",
  dietaryPreferences: "None",
  currentDiet: "Three meals a day",
};

// SYNTHETIC coach-authored template used for the IntakePacket branch.
const COACH_SECTIONS = [
  {
    id: "sec_basics",
    title: "Basics",
    questions: [
      { id: "q_goal", label: "Primary goal", type: "long_text", required: true },
      { id: "q_days", label: "Training days", type: "short_text", required: true },
      { id: "q_notes", label: "Anything else", type: "long_text", required: false },
    ],
  },
];

suite("T-624 — intake REST completeness, clears and template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mail.sendEmail.mockResolvedValue({ success: true });
    auth.user = null;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeUser(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    return db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true, ...overrides },
    });
  }

  async function makeClientIntake(answers: Record<string, unknown> = {}) {
    const client = await makeUser();
    const coach = await makeUser({ isClient: false, isCoach: true });
    const intake = await db.clientIntake.create({
      data: { coachId: coach.id, clientId: client.id, status: "IN_PROGRESS", startedAt: new Date(), ...answers },
    });
    auth.user = { ...client, isClient: true };
    return { client, coach, intake };
  }

  async function makePacket(formAnswers: unknown, withTemplate = true) {
    const client = await makeUser();
    const coach = await makeUser({ isClient: false, isCoach: true });
    const profile = await db.coachProfile.create({
      data: { userId: coach.id, slug: `coach-${randomUUID()}` },
    });
    if (withTemplate) {
      await db.intakeFormTemplate.create({ data: { coachId: coach.id, sections: COACH_SECTIONS } });
    }
    const request = await db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName: "SYNTHETIC Prospect",
        prospectEmail: `${randomUUID()}@example.test`,
        intakeAnswers: {},
        prospectId: client.id,
      },
    });
    const packet = await db.intakePacket.create({
      data: {
        coachingRequestId: request.id,
        token: randomUUID(),
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
        formAnswers: formAnswers as never,
      },
    });
    auth.user = { ...client, isClient: true };
    return { client, coach, packet };
  }

  function put(id: string, answers: unknown) {
    return answersRoute(
      new NextRequest(`https://example.test/api/intake/${id}/answers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  function submit(id: string, answers?: unknown) {
    const init: ConstructorParameters<typeof NextRequest>[1] =
      answers === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ answers }),
          };
    return submitRoute(new NextRequest(`https://example.test/api/intake/${id}/submit`, init), {
      params: Promise.resolve({ id }),
    });
  }

  // ── REGRESSION-B ─────────────────────────────────────────────────────────
  it("REGRESSION-B: refuses to complete a ClientIntake whose required answers are missing", async () => {
    const { intake } = await makeClientIntake({
      bodyweightLbs: 175,
      heightInches: 70,
      ageYears: 28,
      // gender deliberately missing
      primaryGoal: "Build muscle",
      trainingExperience: "Beginner (0–1 year)",
      trainingDaysPerWeek: 4,
      gymAccess: "Full gym membership",
    });

    const response = await submit(intake.id);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("INTAKE_INCOMPLETE");
    expect(body.missingQuestionIds).toContain("gender");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(10);

    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.status).toBe("IN_PROGRESS");
    expect(row?.completedAt).toBeNull();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("REGRESSION-B (packet): refuses to submit a packet missing a required coach question", async () => {
    const { packet } = await makePacket({ q_goal: "Lose fat" });

    const response = await submit(packet.id);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("INTAKE_INCOMPLETE");
    expect(body.missingQuestionIds).toEqual(["q_days"]);

    const row = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(row?.submittedAt).toBeNull();
  });

  // ── REGRESSION-C ─────────────────────────────────────────────────────────
  it("REGRESSION-C: PUT answers returns a real template on the ClientIntake branch", async () => {
    const { intake } = await makeClientIntake();
    const response = await put(intake.id, [{ questionId: "gender", answer: "Male" }]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.template).not.toBeNull();
    expect(typeof body.template.id).toBe("string");
    expect(body.template.id.length).toBeGreaterThan(0);
    expect(Array.isArray(body.template.sections)).toBe(true);
    expect(body.template.sections.length).toBeGreaterThan(0);
    expect(body.status).toBe("IN_PROGRESS");
    expect(body.completedAt).toBeNull();
  });

  it("REGRESSION-C: PUT answers returns a real template on the IntakePacket branch", async () => {
    const { packet } = await makePacket({});
    const response = await put(packet.id, [{ questionId: "q_goal", answer: "Lose fat" }]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.template).not.toBeNull();
    expect(typeof body.template.id).toBe("string");
    expect(body.template.id.length).toBeGreaterThan(0);
    expect(body.template.sections.length).toBeGreaterThan(0);
  });

  it("REGRESSION-C: a packet whose coach has no template still gets the built-in one", async () => {
    const { packet } = await makePacket({}, false);
    const body = await (await put(packet.id, [{ questionId: "q_goal", answer: "x" }])).json();
    expect(body.template.id).toBe("ci_default_template");
    expect(body.template.sections.length).toBe(4);
  });

  // ── Submit as a safety net ───────────────────────────────────────────────
  it("completes a ClientIntake when submit carries the answers the section saves lost", async () => {
    const { intake } = await makeClientIntake({
      bodyweightLbs: 175,
      heightInches: 70,
      ageYears: 28,
      gender: "Male",
      primaryGoal: "Build muscle",
      // trainingExperience + gymAccess missing
      trainingDaysPerWeek: 4,
    });

    const response = await submit(intake.id, [
      { questionId: "trainingExperience", answer: "Intermediate (2–5 years)" },
      { questionId: "gymAccess", answer: "Home gym with equipment" },
    ]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("COMPLETED");
    expect(typeof body.completedAt).toBe("string");

    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.status).toBe("COMPLETED");
    expect(row?.trainingExperience).toBe("Intermediate (2–5 years)");
    expect(row?.gymAccess).toBe("Home gym with equipment");
  });

  it("completes a packet when submit carries the answers the section saves lost", async () => {
    const { packet } = await makePacket({ q_goal: "Lose fat" });

    const response = await submit(packet.id, [{ questionId: "q_days", answer: "4" }]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.answers).toEqual(
      expect.arrayContaining([
        { questionId: "q_goal", answer: "Lose fat" },
        { questionId: "q_days", answer: "4" },
      ])
    );

    const row = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(row?.submittedAt).not.toBeNull();
    expect(row?.formAnswers).toMatchObject({ q_goal: "Lose fat", q_days: "4" });
  });

  // ── Explicit clears ──────────────────────────────────────────────────────
  it("persists an explicit clear for a string column", async () => {
    const { intake } = await makeClientIntake({ injuries: "Left knee" });
    const body = await (await put(intake.id, [{ questionId: "injuries", answer: "" }])).json();
    expect(body.answers.find((a: { questionId: string }) => a.questionId === "injuries")).toBeUndefined();
    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.injuries).toBeNull();
  });

  it("persists an explicit clear for a numeric column (the pre-T-624 NaN drop)", async () => {
    const { intake } = await makeClientIntake({ bodyweightLbs: 175, ageYears: 28 });
    const body = await (
      await put(intake.id, [
        { questionId: "bodyweightLbs", answer: "" },
        { questionId: "ageYears", answer: "" },
      ])
    ).json();
    expect(body.answers.map((a: { questionId: string }) => a.questionId)).not.toContain("bodyweightLbs");
    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.bodyweightLbs).toBeNull();
    expect(row?.ageYears).toBeNull();
  });

  it("deletes a cleared key from packet formAnswers and from the response", async () => {
    const { packet } = await makePacket({ q_goal: "Lose fat", q_notes: "Something" });
    const body = await (await put(packet.id, [{ questionId: "q_notes", answer: "" }])).json();
    expect(body.answers).toEqual([{ questionId: "q_goal", answer: "Lose fat" }]);
    const row = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(row?.formAnswers).toEqual({ q_goal: "Lose fat" });
    expect(Object.keys(row?.formAnswers as object)).not.toContain("q_notes");
  });

  it("preserves an unrelated top-level key already stored in formAnswers", async () => {
    const nested = {
      sections: [
        {
          sectionId: "sec_basics",
          sectionTitle: "Basics",
          answers: [{ questionId: "q_goal", label: "Primary goal", value: "Lose fat" }],
        },
      ],
      _coachNotes: "SYNTHETIC note",
    };
    const { packet } = await makePacket(nested);
    const response = await put(packet.id, [{ questionId: "q_days", answer: "4" }]);
    expect(response.status).toBe(200);
    const row = await db.intakePacket.findUnique({ where: { id: packet.id } });
    const stored = row?.formAnswers as Record<string, unknown>;
    expect(stored.sections).toEqual(nested.sections);
    expect(stored._coachNotes).toBe("SYNTHETIC note");
    expect(stored.q_days).toBe("4");
  });

  it("does not 422 a packet stored in the nested web answer shape", async () => {
    const { packet } = await makePacket({
      sections: [
        {
          sectionId: "sec_basics",
          sectionTitle: "Basics",
          answers: [
            { questionId: "q_goal", label: "Primary goal", value: "Lose fat" },
            { questionId: "q_days", label: "Training days", value: "4" },
          ],
        },
      ],
    });

    const response = await submit(packet.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.answers).toEqual(
      expect.arrayContaining([
        { questionId: "q_goal", answer: "Lose fat" },
        { questionId: "q_days", answer: "4" },
      ])
    );
  });

  // ── Double submit ────────────────────────────────────────────────────────
  it("refuses a second submit on both branches without moving the timestamps", async () => {
    const { intake } = await makeClientIntake({
      bodyweightLbs: 175,
      heightInches: 70,
      ageYears: 28,
      gender: "Male",
      primaryGoal: "Build muscle",
      trainingExperience: "Beginner (0–1 year)",
      trainingDaysPerWeek: 4,
      gymAccess: "Full gym membership",
    });
    expect((await submit(intake.id)).status).toBe(200);
    const first = await db.clientIntake.findUnique({ where: { id: intake.id } });
    const second = await submit(intake.id);
    expect(second.status).toBe(409);
    const after = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(after?.completedAt?.toISOString()).toBe(first?.completedAt?.toISOString());

    const { packet } = await makePacket({ q_goal: "Lose fat", q_days: "4" });
    expect((await submit(packet.id)).status).toBe(200);
    const firstPacket = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect((await submit(packet.id)).status).toBe(409);
    const afterPacket = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(afterPacket?.submittedAt?.toISOString()).toBe(firstPacket?.submittedAt?.toISOString());
  });

  it("refuses a section save once the intake is submitted, without writing", async () => {
    const { packet } = await makePacket({ q_goal: "Lose fat", q_days: "4" });
    expect((await submit(packet.id)).status).toBe(200);
    expect((await put(packet.id, [{ questionId: "q_goal", answer: "changed" }])).status).toBe(409);
    // The refusal is now the WHERE clause of the write, not a JS check before
    // it, so a PUT that straddles a submit cannot overwrite the submitted set.
    const afterPut = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(afterPut?.formAnswers).toEqual({ q_goal: "Lose fat", q_days: "4" });

    const { intake } = await makeClientIntake({
      bodyweightLbs: 175,
      heightInches: 70,
      ageYears: 28,
      gender: "Male",
      primaryGoal: "Build muscle",
      trainingExperience: "Beginner (0–1 year)",
      trainingDaysPerWeek: 4,
      gymAccess: "Full gym membership",
    });
    expect((await submit(intake.id)).status).toBe(200);
    expect((await put(intake.id, [{ questionId: "gender", answer: "Female" }])).status).toBe(409);
  });

  // ── Ownership, role and auth ─────────────────────────────────────────────
  it("enforces ownership, role and auth on both branches", async () => {
    const { intake } = await makeClientIntake({ gender: "Male" });
    const { packet } = await makePacket({ q_goal: "Lose fat" });
    const intruder = await makeUser();

    // another client's intake → 403
    auth.user = { ...intruder, isClient: true };
    expect((await put(intake.id, [{ questionId: "gender", answer: "x" }])).status).toBe(403);
    expect((await submit(intake.id)).status).toBe(403);
    expect((await put(packet.id, [{ questionId: "q_goal", answer: "x" }])).status).toBe(403);
    expect((await submit(packet.id)).status).toBe(403);

    // unknown id → 404
    expect((await put("does-not-exist", [])).status).toBe(404);
    expect((await submit("does-not-exist")).status).toBe(404);

    // a non-client user → 403
    const coachOnly = await makeUser({ isClient: false, isCoach: true });
    auth.user = { ...coachOnly, isClient: false };
    expect((await put(intake.id, [])).status).toBe(403);
    expect((await submit(intake.id)).status).toBe(403);
    expect((await currentRoute()).status).toBe(403);

    // unauthenticated → 401
    auth.user = null;
    expect((await put(intake.id, [])).status).toBe(401);
    expect((await submit(intake.id)).status).toBe(401);
    expect((await currentRoute()).status).toBe(401);

    // nothing was written by any of the above
    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.status).toBe("IN_PROGRESS");
    expect((await db.intakePacket.findUnique({ where: { id: packet.id } }))?.submittedAt).toBeNull();
  });

  it("rejects a malformed body on PUT", async () => {
    const { intake } = await makeClientIntake();
    const noBody = await answersRoute(
      new NextRequest(`https://example.test/api/intake/${intake.id}/answers`, { method: "PUT" }),
      { params: Promise.resolve({ id: intake.id }) }
    );
    expect(noBody.status).toBe(400);
    expect((await put(intake.id, "nope" as unknown)).status).toBe(400);
    expect((await put(intake.id, 7 as unknown)).status).toBe(400);
  });

  // ── Existing behaviour unchanged ─────────────────────────────────────────
  it("still walks the happy path: section saves, then submit, one coach email", async () => {
    const { intake, client } = await makeClientIntake();

    // section 1
    const s1 = await (
      await put(intake.id, [
        { questionId: "bodyweightLbs", answer: "175" },
        { questionId: "heightInches", answer: "70" },
        { questionId: "ageYears", answer: "28" },
        { questionId: "gender", answer: "Male" },
      ])
    ).json();
    expect(s1.answers).toEqual([
      { questionId: "bodyweightLbs", answer: "175" },
      { questionId: "heightInches", answer: "70" },
      { questionId: "ageYears", answer: "28" },
      { questionId: "gender", answer: "Male" },
    ]);

    // section 2
    await put(intake.id, [
      { questionId: "primaryGoal", answer: "Build muscle" },
      { questionId: "trainingExperience", answer: "Beginner (0–1 year)" },
      { questionId: "trainingDaysPerWeek", answer: "4" },
      { questionId: "gymAccess", answer: "Full gym membership" },
    ]);
    // sections 3 + 4 (all optional)
    await put(intake.id, [
      { questionId: "dietaryRestrictions", answer: "None" },
      { questionId: "dietaryPreferences", answer: "None" },
      { questionId: "currentDiet", answer: "Three meals a day" },
      { questionId: "injuries", answer: "None" },
    ]);

    const inProgress = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(inProgress?.status).toBe("IN_PROGRESS");
    expect(inProgress?.startedAt).not.toBeNull();

    const response = await submit(intake.id, []);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(intake.id);
    expect(body.status).toBe("COMPLETED");
    expect(typeof body.completedAt).toBe("string");
    expect(body.template.id).toBe("ci_default_template");
    // field-by-field, in the pre-change wire order
    expect(body.answers).toEqual(
      Object.entries(FULL_CI_ANSWERS).map(([questionId, answer]) => ({ questionId, answer }))
    );
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);

    // GET current still reflects the same answers and a real template
    auth.user = { ...client, isClient: true };
    const current = await (await currentRoute()).json();
    expect(current.status).toBe("COMPLETED");
    expect(current.intake.template.id).toBe("ci_default_template");
    expect(current.intake.answers).toEqual(body.answers);
  });

  it("still notifies the coach exactly once on the packet branch", async () => {
    const { packet } = await makePacket({ q_goal: "Lose fat", q_days: "4" });
    expect((await submit(packet.id)).status).toBe(200);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });

  // ── Review r1 finding 1 (BLOCKER) ────────────────────────────────────────
  it("refuses a submit whose numeric answer cannot be stored, instead of completing with a null column", async () => {
    const { intake } = await makeClientIntake({
      bodyweightLbs: 175,
      // heightInches is null — the lost section save this ticket exists for
      ageYears: 28,
      gender: "Male",
      primaryGoal: "Build muscle",
      trainingExperience: "Beginner (0–1 year)",
      trainingDaysPerWeek: 4,
      gymAccess: "Full gym membership",
    });

    // "." is typeable on the .decimalPad iOS renders for a `number` question.
    const response = await submit(intake.id, [{ questionId: "heightInches", answer: "." }]);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("INTAKE_INCOMPLETE");
    expect(body.missingQuestionIds).toContain("heightInches");

    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.status).toBe("IN_PROGRESS");
    expect(row?.completedAt).toBeNull();
    expect(row?.heightInches).toBeNull();
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses every unstorable numeric form, and echoes back what a leading-number value really stored", async () => {
    // A value that yields no number at all is refused on submit even when the
    // column is already filled, so the client is never told "done" about a
    // value that was dropped. (",5" is the comma-locale case.)
    // "1e999" parses to Infinity, which is finite-looking to an isNaN check.
    for (const bad of [".", ",5", "tall", "1e999"]) {
      const { intake } = await makeClientIntake({
        bodyweightLbs: 175,
        heightInches: 70,
        ageYears: 28,
        gender: "Male",
        primaryGoal: "Build muscle",
        trainingExperience: "Beginner (0–1 year)",
        trainingDaysPerWeek: 4,
        gymAccess: "Full gym membership",
      });
      const response = await submit(intake.id, [{ questionId: "bodyweightLbs", answer: bad }]);
      expect(response.status).toBe(422);
      expect((await response.json()).missingQuestionIds).toEqual(["bodyweightLbs"]);
      const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
      expect(row?.status).toBe("IN_PROGRESS");
      expect(Number(row?.bodyweightLbs)).toBe(175);
    }

    // A value with a parseable leading number keeps the pre-T-624 behaviour
    // (`parseFloat("175 lbs")` is 175) — deliberately, because it stores what
    // the client meant AND the echo tells them exactly what was stored, so it
    // is never a silent drop.
    const { intake } = await makeClientIntake();
    const echo = await (await put(intake.id, [{ questionId: "bodyweightLbs", answer: "175 lbs" }])).json();
    expect(echo.answers).toEqual([{ questionId: "bodyweightLbs", answer: "175" }]);
    expect(Number((await db.clientIntake.findUnique({ where: { id: intake.id } }))?.bodyweightLbs)).toBe(175);
  });

  it("refuses an integer that would overflow its column instead of 500ing", async () => {
    // `parseInt("99999999999")` is finite, so only a range check catches it;
    // without one Prisma rejects the write and the client gets a 500 on a
    // submit they have no other way to complete.
    const { intake } = await makeClientIntake({
      bodyweightLbs: 175, heightInches: 70, ageYears: 28, gender: "Male",
      primaryGoal: "Build muscle", trainingExperience: "Beginner (0–1 year)",
      trainingDaysPerWeek: 4, gymAccess: "Full gym membership",
    });
    const response = await submit(intake.id, [{ questionId: "ageYears", answer: "99999999999" }]);
    expect(response.status).toBe(422);
    expect((await response.json()).missingQuestionIds).toEqual(["ageYears"]);
    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.status).toBe("IN_PROGRESS");
    expect(row?.ageYears).toBe(28);
  });

  // ── Review r1 finding 2 ──────────────────────────────────────────────────
  it("lets the newer flat answer win over a coach's stale nested edit", async () => {
    // The coach click-edited an un-submitted packet on the web review page,
    // which writes the nested shape. The client then saves on iOS (flat keys).
    const { packet, client } = await makePacket({
      sections: [
        {
          sectionId: "sec_basics",
          sectionTitle: "Basics",
          answers: [
            { questionId: "q_goal", label: "Primary goal", value: "coach value" },
            { questionId: "q_days", label: "Training days", value: "3" },
          ],
        },
      ],
    });

    const echo = await (await put(packet.id, [{ questionId: "q_goal", answer: "client value" }])).json();
    expect(echo.answers).toEqual(
      expect.arrayContaining([{ questionId: "q_goal", answer: "client value" }])
    );
    expect(echo.answers).not.toEqual(
      expect.arrayContaining([{ questionId: "q_goal", answer: "coach value" }])
    );

    auth.user = { ...client, isClient: true };
    const current = await (await currentRoute()).json();
    expect(current.intake.answers).toEqual(
      expect.arrayContaining([
        { questionId: "q_goal", answer: "client value" },
        { questionId: "q_days", answer: "3" },
      ])
    );
  });

  // ── Review r2 finding 3 ──────────────────────────────────────────────────
  it("makes a clear stick on a mixed-shape packet instead of falling back to the coach's nested value", async () => {
    const { packet, client } = await makePacket({
      sections: [
        {
          sectionId: "sec_basics",
          sectionTitle: "Basics",
          answers: [
            { questionId: "q_goal", label: "Primary goal", value: "coach value" },
            { questionId: "q_days", label: "Training days", value: "3" },
          ],
        },
      ],
      q_goal: "client value",
    });

    const echo = await (await put(packet.id, [{ questionId: "q_goal", answer: "" }])).json();
    expect(echo.answers.map((a: { questionId: string }) => a.questionId)).not.toContain("q_goal");

    auth.user = { ...client, isClient: true };
    const current = await (await currentRoute()).json();
    expect(current.intake.answers.map((a: { questionId: string }) => a.questionId)).not.toContain(
      "q_goal"
    );

    // the entry the coach's page maps over is kept, with a blank value
    const stored = (await db.intakePacket.findUnique({ where: { id: packet.id } }))
      ?.formAnswers as { sections: { answers: { questionId: string; label: string; value: string }[] }[] };
    expect(stored.sections[0].answers).toEqual([
      { questionId: "q_goal", label: "Primary goal", value: "" },
      { questionId: "q_days", label: "Training days", value: "3" },
    ]);

    // and the cleared required answer is genuinely missing at submit
    const refused = await submit(packet.id);
    expect(refused.status).toBe(422);
    expect((await refused.json()).missingQuestionIds).toContain("q_goal");
  });

  // ── Review r1 finding 3 ──────────────────────────────────────────────────
  it("refuses a client-supplied reserved questionId so the coach's page cannot be broken", async () => {
    const nested = {
      sections: [
        {
          sectionId: "sec_basics",
          sectionTitle: "Basics",
          answers: [{ questionId: "q_goal", label: "Primary goal", value: "Lose fat" }],
        },
      ],
      _coachNotes: "SYNTHETIC note",
    };
    const { packet } = await makePacket(nested);

    const response = await put(packet.id, [
      { questionId: "sections", answer: "x" },
      { questionId: "_coachNotes", answer: "" },
      { questionId: "q_days", answer: "4" },
    ]);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answers.map((a: { questionId: string }) => a.questionId)).not.toContain("sections");

    const stored = (await db.intakePacket.findUnique({ where: { id: packet.id } }))
      ?.formAnswers as Record<string, unknown>;
    // still the array the coach's client page does `.map()` over
    expect(Array.isArray(stored.sections)).toBe(true);
    expect(stored.sections).toEqual(nested.sections);
    expect(stored._coachNotes).toBe("SYNTHETIC note");
    expect(stored.q_days).toBe("4");
  });

  // ── Review r1 finding 4 ──────────────────────────────────────────────────
  it("never puts a legacy whitespace-only answer on the wire, on either branch", async () => {
    const { intake, client } = await makeClientIntake({ gender: "   ", primaryGoal: "Build muscle" });

    const current = await (await currentRoute()).json();
    expect(current.intake.answers.map((a: { questionId: string }) => a.questionId)).not.toContain(
      "gender"
    );

    const refused = await submit(intake.id);
    expect(refused.status).toBe(422);
    expect((await refused.json()).missingQuestionIds).toContain("gender");

    const echo = await (await put(intake.id, [{ questionId: "injuries", answer: "  " }])).json();
    expect(echo.answers.map((a: { questionId: string }) => a.questionId)).not.toContain("gender");
    expect((await db.clientIntake.findUnique({ where: { id: intake.id } }))?.injuries).toBeNull();

    const { packet } = await makePacket({ q_goal: "   ", q_days: "4" });
    const packetEcho = await (await put(packet.id, [{ questionId: "q_notes", answer: " " }])).json();
    expect(packetEcho.answers).toEqual([{ questionId: "q_days", answer: "4" }]);
    expect((await submit(packet.id)).status).toBe(422);

    auth.user = { ...client, isClient: true };
  });

  // ── Review r1 finding 6 ──────────────────────────────────────────────────
  it("advances the lead's consultation stage when a packet is submitted from iOS", async () => {
    const { packet } = await makePacket({ q_goal: "Lose fat" });

    // a refused submit must not move the stage
    expect((await submit(packet.id)).status).toBe(422);
    const before = await db.coachingRequest.findUnique({
      where: { id: packet.coachingRequestId },
    });
    expect(before?.consultationStage).toBe("PENDING");

    expect((await submit(packet.id, [{ questionId: "q_days", answer: "4" }])).status).toBe(200);
    const after = await db.coachingRequest.findUnique({
      where: { id: packet.coachingRequestId },
    });
    expect(after?.consultationStage).toBe("INTAKE_SUBMITTED");
  });

  it("never drags an already-active or declined lead backwards into the intake column", async () => {
    // The coach bypass-activated this lead before the packet was ever
    // submitted; `GET /api/intake/current` still hands the app that packet, so
    // a late submit must not re-open activation (`lib/activation.ts` would stop
    // answering "Already active." at INTAKE_SUBMITTED).
    for (const stage of ["ACTIVE", "DECLINED"] as const) {
      const { packet } = await makePacket({ q_goal: "Lose fat" });
      await db.coachingRequest.update({
        where: { id: packet.coachingRequestId },
        data: { consultationStage: stage },
      });

      expect((await submit(packet.id, [{ questionId: "q_days", answer: "4" }])).status).toBe(200);

      const after = await db.coachingRequest.findUnique({
        where: { id: packet.coachingRequestId },
      });
      expect(after?.consultationStage).toBe(stage);
      // the packet itself still submitted
      expect(
        (await db.intakePacket.findUnique({ where: { id: packet.id } }))?.submittedAt
      ).not.toBeNull();
    }
  });

  // ── Parity audit gap 3 ───────────────────────────────────────────────────
  it("refuses a packet submit while a document is still unsigned, and signs off once it is", async () => {
    // The web token form has always refused this (`submitIntakePacket`); the
    // REST route did not, so an iOS submit gave the coach `submittedAt`, the
    // email and "Intake Received" on the board with no signature row anywhere.
    const { packet, coach } = await makePacket({ q_goal: "Lose fat", q_days: "4" });
    const doc = await db.coachDocument.create({
      data: { coachId: coach.id, title: "SYNTHETIC waiver", type: "TEXT", content: "SYNTHETIC" },
    });
    const packetDoc = await db.intakePacketDocument.create({
      data: { intakePacketId: packet.id, coachDocumentId: doc.id },
    });

    const refused = await submit(packet.id);
    expect(refused.status).toBe(422);
    expect((await refused.json()).code).toBe("DOCUMENTS_UNSIGNED");

    // nothing moved: not the packet, not the lead, not the coach's inbox
    expect((await db.intakePacket.findUnique({ where: { id: packet.id } }))?.submittedAt).toBeNull();
    expect(
      (await db.coachingRequest.findUnique({ where: { id: packet.coachingRequestId } }))
        ?.consultationStage
    ).toBe("PENDING");
    expect(mail.sendEmail).not.toHaveBeenCalled();

    // once the signature row exists, the same submit goes through
    await db.documentSignature.create({
      data: {
        intakePacketDocumentId: packetDoc.id,
        coachDocumentId: doc.id,
        signatureType: "TYPED",
        signatureValue: "SYNTHETIC Prospect",
      },
    });
    expect((await submit(packet.id)).status).toBe(200);
    expect(
      (await db.intakePacket.findUnique({ where: { id: packet.id } }))?.submittedAt
    ).not.toBeNull();
  });

  // ── The Server Action shares the same completeness rule ──────────────────
  it("the web submitClientIntake action refuses a whitespace-only required answer", async () => {
    const { intake } = await makeClientIntake();

    // Every value passes the action's zod schema (`gender` is `min(1)`), so this
    // is the reachable half of the shared guard.
    const result = await submitClientIntake({
      bodyweightLbs: 175,
      heightInches: 70,
      ageYears: 28,
      gender: "   ",
      primaryGoal: "Build muscle",
      targetTimeline: "",
      injuries: "",
      dietaryRestrictions: "",
      dietaryPreferences: "",
      currentDiet: "",
      trainingExperience: "Beginner (0–1 year)",
      trainingDaysPerWeek: 4,
      gymAccess: "Full gym membership",
    });
    expect(result).toEqual({ error: { _form: [expect.any(String)] } });

    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.status).toBe("IN_PROGRESS");
    expect(row?.completedAt).toBeNull();
  });

  // ── iOS review r2 / folded T-788 ─────────────────────────────────────────
  it("refuses a section save whose numeric value cannot be stored, instead of echoing the old one back", async () => {
    // The half the client cannot defend against: the column ALREADY holds a
    // value, so a silently dropped write re-reads as "180" and the app adopts
    // that as a successful save and advances — the typed edit is gone with no
    // error. (When the column is empty the app's echo check catches it; when it
    // is not, nothing on the device can tell the difference.)
    const { intake } = await makeClientIntake({ bodyweightLbs: 180, injuries: "None" });

    for (const bad of [".", ",", "about 180", "1e999"]) {
      const response = await put(intake.id, [
        { questionId: "bodyweightLbs", answer: bad },
        { questionId: "injuries", answer: "Left knee" },
      ]);
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe("ANSWER_UNSTORABLE");
      expect(body.refusedQuestionIds).toEqual(["bodyweightLbs"]);
      expect(typeof body.error).toBe("string");

      // refused before the write and for the whole request: the old value is
      // untouched and the section's other answer did not half-save either
      const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
      expect(row?.bodyweightLbs).toBe(180);
      expect(row?.injuries).toBe("None");
    }

    // an out-of-range integer is refused the same way
    const overflow = await put(intake.id, [{ questionId: "ageYears", answer: "99999999999" }]);
    expect(overflow.status).toBe(422);
    expect((await overflow.json()).refusedQuestionIds).toEqual(["ageYears"]);

    // and the corrected retry saves both answers and echoes them back
    const fixed = await put(intake.id, [
      { questionId: "bodyweightLbs", answer: "182.5" },
      { questionId: "injuries", answer: "Left knee" },
    ]);
    expect(fixed.status).toBe(200);
    expect((await fixed.json()).answers).toEqual(
      expect.arrayContaining([
        { questionId: "bodyweightLbs", answer: "182.5" },
        { questionId: "injuries", answer: "Left knee" },
      ])
    );
    const row = await db.clientIntake.findUnique({ where: { id: intake.id } });
    expect(row?.bodyweightLbs).toBe(182.5);
    expect(row?.injuries).toBe("Left knee");
  });

  // ── Review r3 finding 1: the escape hatch must not destroy answers ───────
  it("keeps the answers an app client saved when they finish on the emailed token link", async () => {
    // The whole path the DOCUMENTS_UNSIGNED refusal sends a client down:
    // answers saved from the app, refused at the REST submit because a waiver
    // is attached, then finished on the web token form. Before this fix the
    // token page started blank and its submit replaced `formAnswers`
    // wholesale, so every answer below was silently erased.
    const { packet, client, coach } = await makePacket(null);
    const doc = await db.coachDocument.create({
      data: { coachId: coach.id, title: "SYNTHETIC waiver", type: "TEXT", content: "SYNTHETIC" },
    });
    const packetDoc = await db.intakePacketDocument.create({
      data: { intakePacketId: packet.id, coachDocumentId: doc.id },
    });

    // 1. the client fills the intake in the app
    expect(
      (
        await put(packet.id, [
          { questionId: "q_goal", answer: "Lose fat" },
          { questionId: "q_days", answer: "4" },
          { questionId: "q_notes", answer: "SYNTHETIC note" },
        ])
      ).status
    ).toBe(200);

    // 2. submit is refused: there is no signing UI in the app
    const refused = await submit(packet.id);
    expect(refused.status).toBe(422);
    const refusedBody = await refused.json();
    expect(refusedBody.code).toBe("DOCUMENTS_UNSIGNED");
    // the sentence has to name the way out, or Retry loops forever
    expect(refusedBody.error).toContain("link");
    expect(refusedBody.error.length).toBeLessThanOrEqual(300);

    // 3. they open the emailed link. The token page is rendered for real (it is
    //    a server component, so calling it returns the element it hands the
    //    form) and it must seed the form with what they already answered.
    const rendered = (await IntakeTokenPage({
      params: Promise.resolve({ token: packet.token }),
    })) as unknown as { props: { initialAnswers?: Record<string, string> } };
    const prefill = rendered.props.initialAnswers ?? {};
    expect(prefill).toEqual({ q_goal: "Lose fat", q_days: "4", q_notes: "SYNTHETIC note" });

    // 4. they sign and submit, editing one answer. The payload is built the way
    //    `intake-packet-page.tsx` builds it, from the seeded state.
    const submitted = await submitIntakePacket({
      token: packet.token,
      answers: {
        sections: COACH_SECTIONS.map((s) => ({
          sectionId: s.id,
          sectionTitle: s.title,
          answers: s.questions.map((q) => ({
            questionId: q.id,
            label: q.label,
            value: q.id === "q_days" ? "5" : prefill[q.id] ?? "",
          })),
        })),
      },
      documentSignatures: [
        {
          intakePacketDocumentId: packetDoc.id,
          coachDocumentId: doc.id,
          signatureType: "TYPED",
          signatureValue: "SYNTHETIC Prospect",
        },
      ],
    });
    expect(submitted).toEqual({ success: true });

    // 5. nothing was lost, the edit took, and the coach's nested view exists
    const after = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(after?.submittedAt).not.toBeNull();
    expect(flattenPacketAnswers(after?.formAnswers)).toEqual({
      q_goal: "Lose fat",
      q_days: "5",
      q_notes: "SYNTHETIC note",
    });
    const shape = after?.formAnswers as {
      sections: { answers: { questionId: string; label: string; value: string }[] }[];
    };
    expect(shape.sections[0].answers.map((a) => a.questionId)).toEqual([
      "q_goal",
      "q_days",
      "q_notes",
    ]);
    expect(
      (await db.documentSignature.findFirst({ where: { intakePacketDocumentId: packetDoc.id } }))
    ).not.toBeNull();

    // and the app agrees: the intake reads as completed, with the answers
    auth.user = { ...client, isClient: true };
    const current = await (await currentRoute()).json();
    expect(current.status).toBe("COMPLETED");
    expect(current.intake.answers).toEqual(
      expect.arrayContaining([
        { questionId: "q_goal", answer: "Lose fat" },
        { questionId: "q_days", answer: "5" },
        { questionId: "q_notes", answer: "SYNTHETIC note" },
      ])
    );
  });

  it("keeps an answer the token form never rendered, and clears one it rendered empty", async () => {
    // A coach edited their template after the client answered in the app, so
    // `q_dropped` is not on the form the client sees. Replacing `formAnswers`
    // wholesale would delete it; merging keeps it.
    const { packet, coach } = await makePacket({ q_dropped: "SYNTHETIC leftover", q_notes: "drop me" });

    await submitIntakePacket({
      token: packet.token,
      answers: {
        sections: [
          {
            sectionId: "sec_basics",
            sectionTitle: "Basics",
            answers: [
              { questionId: "q_goal", label: "Primary goal", value: "Lose fat" },
              { questionId: "q_days", label: "Training days", value: "4" },
              { questionId: "q_notes", label: "Anything else", value: "" },
            ],
          },
        ],
      },
      documentSignatures: [],
    });

    const after = await db.intakePacket.findUnique({ where: { id: packet.id } });
    expect(flattenPacketAnswers(after?.formAnswers)).toEqual({
      q_goal: "Lose fat",
      q_days: "4",
      q_dropped: "SYNTHETIC leftover",
    });

    // the coach's review edit merges the same way, sent through the SAME
    // payload shape `components/coach/intake/review-session.tsx` actually
    // sends: its `answers` state starts from the whole stored `formAnswers`
    // (flat keys included — `app/coach/leads/[requestId]/review/page.tsx:23`
    // casts and passes `packet.formAnswers` verbatim) and `commitAnswer` only
    // ever replaces `sections`, so the payload is `{ ...stored, sections: [edited] }`
    // — the stale flat `q_goal: "Lose fat"` rides along with the coach's edit.
    // Pre-fix (flat-over-nested applied to the payload itself), the merge would
    // read the carried-over stale flat key back over the coach's own
    // correction, so this assertion cannot pass without T-624 r4 finding 1's fix.
    auth.user = { id: coach.id, isCoach: true, isClient: false };
    const storedBeforeEdit = await db.intakePacket.findUnique({ where: { id: packet.id } });
    const storedFormAnswers = storedBeforeEdit?.formAnswers as Record<string, unknown>;
    expect(storedFormAnswers.q_goal).toBe("Lose fat"); // sanity: the stale flat key is really there
    await saveReviewEdits({
      packetId: packet.id,
      formAnswers: {
        ...storedFormAnswers,
        sections: [
          {
            sectionId: "sec_basics",
            sectionTitle: "Basics",
            answers: [
              { questionId: "q_goal", label: "Primary goal", value: "Build muscle" },
              { questionId: "q_days", label: "Training days", value: "4" },
              { questionId: "q_notes", label: "Anything else", value: "" },
            ],
          },
        ],
      },
    });
    expect(
      flattenPacketAnswers(
        (await db.intakePacket.findUnique({ where: { id: packet.id } }))?.formAnswers
      )
    ).toEqual({
      q_goal: "Build muscle",
      q_days: "4",
      q_dropped: "SYNTHETIC leftover",
    });
  });
});
