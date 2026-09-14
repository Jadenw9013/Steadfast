import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getClientProvider } from "@/lib/queries/client-provider";
import { getCurrentClientPlan } from "@/lib/queries/current-client-plan";
const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => auth.user }));
import { GET as mealRoute } from "@/app/api/client/meal-plan/current/route";
import { GET as trainingRoute } from "@/app/api/client/training/current/route";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("provider-aware shared plan reads", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true")); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function user() { const id = randomUUID(); return db.user.create({ data: { clerkId: id, email: `${id}@example.test` } }); }
  it("does not return a former human plan for an AI or unassigned client", async () => { const client = await user(); await db.mealPlan.create({ data: { clientId: client.id, weekOf: new Date(), status: "PUBLISHED", publishedAt: new Date() } }); expect(await getCurrentClientPlan(client.id)).toMatchObject({ origin: "NONE", currentPlan: null }); await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } }); await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } }); await db.aiCoachEntitlement.create({ data: { clientId: client.id } }); expect(await getCurrentClientPlan(client.id)).toMatchObject({ origin: "AI", currentPlan: null }); expect(await db.coachClient.count({ where: { clientId: client.id } })).toBe(0); });
  it("legacy mobile endpoints never expose historical plans for AI or unassigned clients", async () => {
    const client = await user(); auth.user = { ...client, isClient: true };
    await db.mealPlan.create({ data: { clientId: client.id, weekOf: new Date(), status: "PUBLISHED", publishedAt: new Date() } });
    await db.trainingProgram.create({ data: { clientId: client.id, weekOf: new Date(), status: "PUBLISHED", publishedAt: new Date() } });
    expect(await (await mealRoute()).json()).toEqual({ mealPlan: null });
    expect(await (await trainingRoute()).json()).toEqual({ trainingProgram: null });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    expect((await mealRoute()).status).toBe(409); expect((await trainingRoute()).status).toBe(409);
  });
  it("legacy mobile endpoints filter publications from a previous relationship", async () => {
    const client = await user(); const coach = await user(); auth.user = { ...client, isClient: true };
    await db.coachClient.create({ data: { clientId: client.id, coachId: coach.id } });
    await db.mealPlan.create({ data: { clientId: client.id, weekOf: new Date(), status: "PUBLISHED", publishedAt: new Date(Date.now() - 86400000) } });
    expect(await (await mealRoute()).json()).toEqual({ mealPlan: null });
    const plan = await db.mealPlan.create({ data: { clientId: client.id, weekOf: new Date(), version: 2, status: "PUBLISHED", publishedAt: new Date() } });
    const response = await mealRoute(); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(await response.json()).toMatchObject({ mealPlan: { id: plan.id } });
  });
  it("fails closed for ambiguous or invalid authority", async () => { const client = await user(); const a = await user(); const b = await user(); await db.coachClient.createMany({ data: [{ clientId: client.id, coachId: a.id }, { clientId: client.id, coachId: b.id }] }); expect((await getClientProvider(client.id)).resolutionRequired).toBe(true); await expect(getCurrentClientPlan(client.id)).rejects.toMatchObject({ code: "REVISION_CONFLICT" }); });
  it("uses only publications during the active human relationship", async () => { const client = await user(); const coach = await user(); const link = await db.coachClient.create({ data: { clientId: client.id, coachId: coach.id } }); await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: link.id } }); await db.mealPlan.create({ data: { clientId: client.id, weekOf: new Date(), status: "PUBLISHED", publishedAt: new Date(Date.now() - 86400000) } }); expect(await getCurrentClientPlan(client.id)).toMatchObject({ origin: "HUMAN", currentPlan: { mealPlan: null } }); const plan = await db.mealPlan.create({ data: { clientId: client.id, weekOf: new Date(), version: 2, status: "PUBLISHED", publishedAt: new Date() } }); expect(await getCurrentClientPlan(client.id)).toMatchObject({ origin: "HUMAN", currentPlan: { mealPlan: { id: plan.id } } }); });
});
