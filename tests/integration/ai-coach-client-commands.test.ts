import { assignFixtureReviewer } from "../helpers/ai-reviewer";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ clerkId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.clerkId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { db } from "@/lib/db";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
import { POST } from "@/app/api/client/ai-coach/commands/route";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
const answers = { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC" };
const safety = { chestPainDuringExercise: "NO", dizzinessOrFainting: "NO", heartCondition: "NO", pregnantOrPostpartum: "NO", recentInjuryOrSurgery: "NO" };
suite("client intake, consent and HTTP boundaries", () => {
  beforeEach(() => { vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"); vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true"); });
  afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID(); const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await assignFixtureReviewer(client.id);
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
});
