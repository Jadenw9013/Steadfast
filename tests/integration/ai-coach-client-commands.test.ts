import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ clerkId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.clerkId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { db } from "@/lib/db";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
import { deriveLegacyAllergyTokens } from "@/lib/ai-coach/intake-allergens";
import { intakeAnswersSchema, type AllergenDeclarations } from "@/lib/ai-coach/intake";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { requestAiRun, runSnapshotSchema } from "@/lib/ai-coach/run-command";
import { POST } from "@/app/api/client/ai-coach/commands/route";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  activateTestLiveRelease,
  createTestGovernanceActor,
  deactivateTestLiveRelease,
  TEST_RUNTIME_CONFIGURATION,
} from "../helpers/ai-live-launch";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: table-wide AI Coach state; runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");
const answers = { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC" };
const safety = { chestPainDuringExercise: "NO", dizzinessOrFainting: "NO", heartCondition: "NO", pregnantOrPostpartum: "NO", recentInjuryOrSurgery: "NO" };
function v2Answers(overrides: Record<string, unknown> = {}) {
  return {
    intakeVersion: 2,
    goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"], foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC",
    ageStatus: "UNKNOWN", energyMethodPopulationCategoryStatus: "UNKNOWN",
    physicalActivityCategoryStatus: "UNKNOWN", bodyMeasurementStatus: "UNKNOWN",
    goalStatus: "UNKNOWN", trainingContextStatus: "UNKNOWN", cookingAccessStatus: "UNKNOWN",
    dislikes: [], cuisinePreferences: [],
    allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    dietaryPattern: { pattern: "NONE_DECLARED", otherLabel: null, mandatory: false, reason: "NOT_STATED", status: "UNKNOWN" },
    ...overrides,
  };
}
suite("client intake, consent and HTTP boundaries", () => {
  beforeEach(() => { vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"); vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true"); });
  afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID(); const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    mocks.clerkId = id; return client;
  }
  const base = () => ({ requestKey: randomUUID(), expectedProfileRevision: 0 });
  it("saves a resumable draft then requires safety, confirmation and explicit consent to enroll", async () => {
    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "SAVE_INTAKE", answers: { goal: "GENERAL_FITNESS" } });
    expect((await db.aiIntakeDraft.findUniqueOrThrow({ where: { clientId: client.id } })).answers).toEqual({ goal: "GENERAL_FITNESS" });
    await expect(applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergies: [] });
    await applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers });
    const enroll = { ...base(), expectedProfileRevision: 1, operation: "ENROLL", consent: true, expectedContextRevision: 0, reviewTimezone: "America/Los_Angeles" };
    await expect(applyAiClientCommand(client.id, { ...enroll, consent: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await applyAiClientCommand(client.id, enroll);
    expect((await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } })).mode).toBe("AI");
    expect(await db.coachClient.count({ where: { clientId: client.id } })).toBe(0);
  });
  it("does not permit stale draft changes or reuse of a request key with different values", async () => {
    const client = await fixture(); const input = { ...base(), operation: "SAVE_INTAKE", answers: { goal: "GENERAL_FITNESS" } };
    await applyAiClientCommand(client.id, input); await applyAiClientCommand(client.id, input);
    await expect(applyAiClientCommand(client.id, { ...input, answers: { goal: "STRENGTH" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(applyAiClientCommand(client.id, { ...input, requestKey: randomUUID(), expectedProfileRevision: 8 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("applies safety independently of an invalid draft and never downgrades urgent disposition on an allergy edit", async () => {
    const client = await fixture();
    await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { confirmedIntake: answers } });
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: { ...safety, chestPainDuringExercise: "YES" } });
    await expect(applyAiClientCommand(client.id, { ...base(), operation: "SAVE_INTAKE", answers: { trainingDaysPerWeek: 90 } })).rejects.toThrow();
    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergies: ["milk"] });
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    expect(await db.aiCoachProfile.findUnique({ where: { clientId: client.id } })).toMatchObject({ safetyDisposition: "URGENT", nutritionPermission: "PAUSED" });
  });
  it("rejects cross-origin and cookie-only mutation requests before writing", async () => {
    const client = await fixture();
    for (const headers of [{ origin: "https://evil.test" }, { cookie: "session=fake" }] as Record<string, string>[]) {
      const res = await POST(new NextRequest("https://example.test/api/client/ai-coach/commands", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ...base(), operation: "SAVE_INTAKE", answers: { goal: "GENERAL_FITNESS" } }) }));
      expect(res.status).toBe(403);
    }
    expect(await db.aiIntakeDraft.count({ where: { clientId: client.id } })).toBe(0);
  });
  it("returns an acknowledged, private response for a same-origin save and rejects oversized bodies", async () => {
    await fixture();
    const req = (body: string) => new NextRequest("https://example.test/api/client/ai-coach/commands", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body });
    const res = await POST(req(JSON.stringify({ ...base(), operation: "SAVE_INTAKE", answers: { goal: "GENERAL_FITNESS" } })));
    expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toContain("no-store"); expect(await res.json()).toMatchObject({ data: { saved: true } });
    expect((await POST(req("x".repeat(33000)))).status).toBe(422);
  });
  it("T-2000: enrolls a non-synthetic profile under an ACTIVE live release with zero reviewer grants", async () => {
    const id = randomUUID();
    const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiCoachProfile.create({
      data: { clientId: client.id, isSynthetic: false, confirmedIntake: answers },
    });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    mocks.clerkId = id;
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2000-client-commands-live-test"
    );
    await activateTestLiveRelease({
      namespace: `client-commands-live-${randomUUID()}`,
      actorUserId: actor.id,
    });
    try {
      expect(
        await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })
      ).toBe(0);
      const discovery = TEST_RUNTIME_CONFIGURATION.discovery;
      const enroll = {
        ...base(),
        operation: "ENROLL",
        consent: true,
        expectedContextRevision: 0,
        reviewTimezone: "America/Los_Angeles",
        consentConfigurationId: discovery.configurationId,
        consentConfigurationVersion: discovery.version,
        privacyNoticeVersion: discovery.privacyNoticeVersion,
        consentTextDigest: contentHash(discovery),
      } as const;
      await expect(applyAiClientCommand(client.id, enroll)).resolves.toMatchObject({
        saved: true,
      });
      expect(
        (await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } }))
          .mode
      ).toBe("AI");
      expect(
        await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })
      ).toBe(0);
    } finally {
      await deactivateTestLiveRelease(actor.id);
    }
  });
  it("T-2000: keeps the consent-digest-mismatch rejection for a non-synthetic ENROLL", async () => {
    const id = randomUUID();
    const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiCoachProfile.create({
      data: { clientId: client.id, isSynthetic: false, confirmedIntake: answers },
    });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    mocks.clerkId = id;
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2000-client-commands-mismatch-test"
    );
    await activateTestLiveRelease({
      namespace: `client-commands-mismatch-${randomUUID()}`,
      actorUserId: actor.id,
    });
    try {
      const enroll = {
        ...base(),
        operation: "ENROLL",
        consent: true,
        expectedContextRevision: 0,
        reviewTimezone: "America/Los_Angeles",
        consentConfigurationId: TEST_RUNTIME_CONFIGURATION.discovery.configurationId,
        consentConfigurationVersion: TEST_RUNTIME_CONFIGURATION.discovery.version,
        privacyNoticeVersion: TEST_RUNTIME_CONFIGURATION.discovery.privacyNoticeVersion,
        consentTextDigest: "0".repeat(64),
      } as const;
      await expect(applyAiClientCommand(client.id, enroll)).rejects.toMatchObject({
        code: "REVISION_CONFLICT",
      });
    } finally {
      await deactivateTestLiveRelease(actor.id);
    }
  });


  it("T-2024: ALLERGIES v2 shape writes both allergenDeclarations and the derived legacy allergies array", async () => {
    const client = await fixture();
    const declarations = {
      status: "CONFIRMED", noKnownAllergens: false,
      items: [{ category: "TREE_NUT", specificity: null, kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
    };
    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergenDeclarations: declarations });
    const draft = await db.aiIntakeDraft.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(draft.answers).toMatchObject({ allergenDeclarations: declarations, allergies: ["TREE_NUT"] });
  });

  it("T-2024: a v2 narrowing (adding specificity under an already-declared category) still bumps safetyRevision and invalidates proposals — the old string comparison would miss it", async () => {
    const broad: AllergenDeclarations = {
      status: "CONFIRMED", noKnownAllergens: false,
      items: [{ category: "TREE_NUT", specificity: null, kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
    };
    const narrowed: AllergenDeclarations = {
      status: "CONFIRMED", noKnownAllergens: false,
      items: [{ category: "TREE_NUT", specificity: "cashew", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
    };
    // Proves the defect the hash comparison fixes: the legacy derived
    // token list the old code compared is IDENTICAL before and after this
    // narrowing, so a plain string comparison would never see a change.
    expect(deriveLegacyAllergyTokens(broad)).toEqual(deriveLegacyAllergyTokens(narrowed));

    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergenDeclarations: broad });
    expect((await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } })).safetyRevision).toBe(1);

    const plan = await db.aiPlanVersion.create({
      data: { clientId: client.id, version: 1, status: "PROPOSED", payload: {}, payloadHash: "h", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 1, policyVersion: "p1", catalogVersions: {} },
    });
    const run = await db.aiCoachRun.create({
      data: { clientId: client.id, kind: "WEEKLY_REVIEW", businessKey: randomUUID(), status: "QUEUED", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 1 },
    });

    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergenDeclarations: narrowed });

    expect((await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } })).safetyRevision).toBe(2);
    expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("INVALIDATED");
    expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELED");
  });

  it("ALLERGIES rejects a payload sending both allergies and allergenDeclarations", async () => {
    const client = await fixture();
    await expect(
      applyAiClientCommand(client.id, {
        ...base(),
        operation: "ALLERGIES",
        allergies: ["milk"],
        allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("ALLERGIES rejects a payload sending neither shape", async () => {
    const client = await fixture();
    await expect(
      applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("T-2024: a v1-shaped CONFIRM_INTAKE against an already-v2 profile is rejected 422", async () => {
    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    await applyAiClientCommand(client.id, {
      ...base(),
      operation: "ALLERGIES",
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    });
    await applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers: v2Answers() });

    await expect(
      applyAiClientCommand(client.id, { ...base(), expectedProfileRevision: 1, operation: "CONFIRM_INTAKE", answers })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "Update Steadfast to change your intake." });
  });

  it("T-2024: a v1-shaped CONFIRM_INTAKE against a v1/absent profile still succeeds (old-build regression)", async () => {
    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergies: [] });
    const result = await applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers });
    expect(result).toMatchObject({ saved: true, profileRevision: 1 });
  });

  it("T-2024: a v2 confirm bumps profileRevision and cancels a QUEUED run + invalidates a PROPOSED plan", async () => {
    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    await applyAiClientCommand(client.id, {
      ...base(),
      operation: "ALLERGIES",
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    });

    const plan = await db.aiPlanVersion.create({
      data: { clientId: client.id, version: 1, status: "PROPOSED", payload: {}, payloadHash: "h", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0, policyVersion: "p1", catalogVersions: {} },
    });
    const run = await db.aiCoachRun.create({
      data: { clientId: client.id, kind: "WEEKLY_REVIEW", businessKey: randomUUID(), status: "QUEUED", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0 },
    });

    const result = await applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers: v2Answers() });
    expect(result).toMatchObject({ saved: true, profileRevision: 1 });
    expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("INVALIDATED");
    expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELED");
  });

  it("T-2024 standing rule 10: a v2 confirmedIntake stays readable at every live read path — getAiWorkspace, ENROLL, and runSnapshotSchema", async () => {
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    await applyAiClientCommand(client.id, {
      ...base(),
      operation: "ALLERGIES",
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    });
    await applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers: v2Answers() });

    // lib/queries/ai-coach.ts:77 — the workspace read path.
    const workspace = await getAiWorkspace(client.id);
    expect(workspace.confirmedIntake).toMatchObject({ intakeVersion: 2 });
    expect(intakeAnswersSchema.safeParse(workspace.confirmedIntake).success).toBe(true);

    // client-commands.ts ENROLL guard — "Confirm your intake before enrolling."
    // must not reject a v2-confirmed intake.
    await applyAiClientCommand(client.id, {
      ...base(),
      expectedProfileRevision: 1,
      operation: "ENROLL",
      consent: true,
      expectedContextRevision: 0,
      reviewTimezone: "America/Los_Angeles",
    });
    expect((await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } })).mode).toBe("AI");

    // run-command.ts:32 via runSnapshotSchema — a requested run's stored
    // inputSnapshot must re-parse with the v2 intake embedded.
    const { runId } = await requestAiRun(client.id, {
      requestKey: randomUUID(),
      kind: "INITIAL",
      representation: "MACROS",
      expectedContextRevision: 1,
      expectedProfileRevision: 1,
    });
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    const parsedSnapshot = runSnapshotSchema.safeParse(run.inputSnapshot);
    expect(parsedSnapshot.success).toBe(true);
    if (!parsedSnapshot.success) throw new Error("unreachable");
    expect(parsedSnapshot.data.intake).toMatchObject({ intakeVersion: 2 });
  });

  it("T-2024 BLOCKER 3: a confirm payload missing allergies (v1) or allergenDeclarations (v2) fails as a clean 422, not a retryable 503, even when a draft row already exists", async () => {
    const client = await fixture();
    // A draft row must exist for this — that is exactly what hid the bug:
    // the `!savedDraft.success` short-circuit threw first when there was
    // no draft at all.
    await applyAiClientCommand(client.id, { ...base(), operation: "SAVE_INTAKE", answers: { goal: "GENERAL_FITNESS" } });

    const v1WithoutAllergies: Record<string, unknown> = { ...answers };
    delete v1WithoutAllergies.allergies;
    await expect(
      applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers: v1WithoutAllergies })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const v2WithoutDeclarations: Record<string, unknown> = v2Answers();
    delete v2WithoutDeclarations.allergenDeclarations;
    await expect(
      applyAiClientCommand(client.id, { ...base(), operation: "CONFIRM_INTAKE", answers: v2WithoutDeclarations })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("T-2024 MAJOR 4: a v1-shaped ALLERGIES command against an already-v2 profile is rejected 422, never a second writer of the derived projection", async () => {
    const client = await fixture();
    const declarations = {
      status: "CONFIRMED",
      noKnownAllergens: false,
      items: [{ category: "TREE_NUT", specificity: null, kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
    };
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    await applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergenDeclarations: declarations });
    await applyAiClientCommand(client.id, {
      ...base(),
      operation: "CONFIRM_INTAKE",
      answers: v2Answers({ allergenDeclarations: declarations }),
    });

    await expect(
      applyAiClientCommand(client.id, {
        ...base(),
        expectedProfileRevision: 1,
        operation: "ALLERGIES",
        allergies: ["peanuts"],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "Update Steadfast to change your intake." });

    // Never became a second writer: the draft's allergenDeclarations/derived
    // allergies must be unchanged by the rejected v1 write.
    const draft = await db.aiIntakeDraft.findUnique({ where: { clientId: client.id } });
    expect((draft?.answers as Record<string, unknown> | undefined)?.allergies).not.toEqual(["peanuts"]);
  });

  it("T-2024 round 3 NIT (parity NIT 3): a v1-shaped ALLERGIES is rejected against a v2 draft even before anything is confirmed", async () => {
    const client = await fixture();
    await applyAiClientCommand(client.id, {
      ...base(),
      operation: "ALLERGIES",
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    });
    // No CONFIRM_INTAKE has happened — profile.confirmedIntake is still
    // null — but the draft already holds v2 allergenDeclarations.
    await expect(
      applyAiClientCommand(client.id, { ...base(), operation: "ALLERGIES", allergies: ["peanuts"] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "Update Steadfast to change your intake." });
  });

  it("T-2024 round 3 MAJOR 2 (parity MAJOR 3): a trailing space in specificity never makes CONFIRM_INTAKE permanently 422", async () => {
    const client = await fixture();
    await applyAiClientCommand(client.id, { ...base(), operation: "SAFETY", answers: safety });
    // Stored trimmed by allergenDeclarationSchema on write.
    await applyAiClientCommand(client.id, {
      ...base(),
      operation: "ALLERGIES",
      allergenDeclarations: {
        status: "CONFIRMED",
        noKnownAllergens: false,
        items: [{ category: "TREE_NUT", specificity: "cashew ", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
      },
    });
    const storedDraft = await db.aiIntakeDraft.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(
      (storedDraft.answers as { allergenDeclarations: { items: { specificity: string }[] } }).allergenDeclarations
        .items[0].specificity
    ).toBe("cashew"); // trimmed on write

    // Confirm sends the untrimmed value a client might still hold in local
    // state (e.g. autocorrect appended a trailing space and the client
    // never re-fetched). Must succeed, not 422.
    const result = await applyAiClientCommand(client.id, {
      ...base(),
      operation: "CONFIRM_INTAKE",
      answers: v2Answers({
        allergenDeclarations: {
          status: "CONFIRMED",
          noKnownAllergens: false,
          items: [{ category: "TREE_NUT", specificity: "cashew ", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
        },
      }),
    });
    expect(result).toMatchObject({ saved: true, profileRevision: 1 });
  });
});
