import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * T-665 — `/client/meal-plan` and `/client/training` resolve no provider at
 * all: their only gate was an unfiltered `coachClient.findFirst`, and they
 * read the plan with `getCurrentPublishedMealPlan(user.id)` / with no
 * `publishedAfter` at all, so a client who switched coaches saw the
 * *previous* coach's published plan while `/client` and `/client/plan`
 * correctly showed the new coach's (or none). This file proves the fix and
 * that all four client-facing surfaces now agree.
 *
 * Technique (proven in-flight by T-672,
 * tests/integration/message-conversation-scope.test.ts:34-57): `await` the
 * async Server Component directly — it yields a React element tree without
 * rendering — and walk that tree for the props it hands to a stubbed
 * component, matching on the imported component identity, never a string.
 */

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => auth.user }));
vi.mock("@/components/client/simple-meal-plan", () => ({ SimpleMealPlan: function SimpleMealPlan() { return null; } }));
vi.mock("@/components/client/training-program", () => ({ TrainingProgram: function TrainingProgram() { return null; } }));
vi.mock("@/components/ui/export-pdf-button", () => ({ ExportPdfButton: function ExportPdfButton() { return null; } }));
vi.mock("@/components/ai-coach/client-surface", () => ({
  AiClientSurface: function AiClientSurface() { return null; },
  ProviderResolution: function ProviderResolution() { return null; },
}));

import { db } from "@/lib/db";
import { getClientProvider } from "@/lib/queries/client-provider";
import { resolveActiveMealPlanId } from "@/lib/meal-plans/active-plan";
import { getCurrentPublishedMealPlan } from "@/lib/queries/meal-plans";
import { SimpleMealPlan } from "@/components/client/simple-meal-plan";
import { TrainingProgram } from "@/components/client/training-program";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";
import { AiClientSurface, ProviderResolution } from "@/components/ai-coach/client-surface";
import ClientMealPlanPage from "@/app/client/meal-plan/page";
import ClientTrainingPage from "@/app/client/training/page";
import { GET as mealCurrentRoute } from "@/app/api/client/meal-plan/current/route";
import { GET as trainingCurrentRoute } from "@/app/api/client/training/current/route";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findNode(node: any, type: unknown): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, type);
      if (found) return found;
    }
    return null;
  }
  if (node.type === type) return node;
  return findNode(node.props?.children, type);
}

suite("client meal-plan and training pages are provider-aware (T-665)", () => {
  afterAll(() => db.$disconnect());

  async function makeUser(opts: { isCoach?: boolean; isClient?: boolean } = {}) {
    const id = randomUUID();
    return db.user.create({
      data: {
        clerkId: id,
        email: `${id}@example.test`,
        isCoach: !!opts.isCoach,
        isClient: opts.isClient ?? true,
      },
    });
  }

  /** Case 1/2 fixture: coach A published a plan, then the client switched to
   *  coach B. B's `CoachClient.createdAt` is strictly after the plan's
   *  `publishedAt`, so the plan belongs to the previous relationship. */
  async function switchedCoachMealPlanFixture() {
    const client = await makeUser();
    const coachA = await makeUser({ isCoach: true, isClient: false });
    const coachB = await makeUser({ isCoach: true, isClient: false });
    const linkA = await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    const plan = await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date("2026-01-05T00:00:00Z") },
    });
    await db.coachClient.delete({ where: { id: linkA.id } });
    const linkB = await db.coachClient.create({
      data: { coachId: coachB.id, clientId: client.id, createdAt: new Date(plan.publishedAt!.getTime() + 86_400_000) },
    });
    return { client, coachA, coachB, plan, linkB };
  }

  it("case 1 — headline regression: a switched-coach client never sees the previous coach's plan (must fail against sprint-1 code)", async () => {
    const { client, plan } = await switchedCoachMealPlanFixture();
    auth.user = { ...client, isClient: true };

    // Precondition: the stale plan really is on disk, and an unfiltered read
    // (the pre-fix behavior) still finds it.
    expect(await resolveActiveMealPlanId(client.id, new Date(0))).toBe(plan.id);

    const tree = await ClientMealPlanPage();
    // Asserting the prop, not node absence: T-802a (merges first) always
    // renders `<SimpleMealPlan mealPlan={mealPlan} .../>`, with `mealPlan`
    // possibly `null`, so this passes identically before and after that merge.
    expect(findNode(tree, SimpleMealPlan)?.props?.mealPlan ?? null).toBeNull();
    expect(findNode(tree, ExportPdfButton)).toBeNull();
  });

  it("case 2 — agreement: the page's plan id matches /client, /client/plan and GET /api/client/meal-plan/current", async () => {
    const { client } = await switchedCoachMealPlanFixture();
    auth.user = { ...client, isClient: true };
    const provider = await getClientProvider(client.id);

    const tree = await ClientMealPlanPage();
    const rendered = findNode(tree, SimpleMealPlan)?.props?.mealPlan?.id ?? null;

    // `/client` (app/client/page.tsx:148) and `/client/plan`
    // (app/client/plan/page.tsx:24) both evaluate exactly this expression;
    // they are compared here by data expression rather than rendered output
    // because they would need PlanTab/StatusCard/chart stubs for zero extra
    // coverage of this ticket's defect.
    const sharedExpression = (await getCurrentPublishedMealPlan(client.id, provider.relationshipStartedAt))?.id ?? null;
    expect(rendered).toBe(sharedExpression);

    const res = await mealCurrentRoute();
    expect(res.status).toBe(200);
    const iosBody = await res.json();
    expect(rendered).toBe(iosBody.mealPlan?.id ?? null);
  });

  it("case 3 — regression: a normal single-coach client still sees their plan and the Export PDF button", async () => {
    const client = await makeUser();
    const coach = await makeUser({ isCoach: true, isClient: false });
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    const plan = await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date(link.createdAt.getTime() + 60_000) },
    });
    auth.user = { ...client, isClient: true };

    const tree = await ClientMealPlanPage();
    expect(findNode(tree, SimpleMealPlan)?.props?.mealPlan?.id).toBe(plan.id);
    expect(findNode(tree, ExportPdfButton)?.props?.mealPlanId).toBe(plan.id);

    // Positive-side agreement (parity gap 2): case 2 only compares null to
    // null, which an over-broad gate would pass vacuously. Compare the
    // non-null side too, so a page that under-renders relative to the route
    // would be caught here.
    const iosBody = await (await mealCurrentRoute()).json();
    expect(iosBody.mealPlan?.id ?? null).toBe(plan.id);
  });

  it("case 4 — regression: a client with no coach at all sees the empty state, not a stale plan on disk", async () => {
    const client = await makeUser();
    await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date() },
    });
    auth.user = { ...client, isClient: true };

    const tree = await ClientMealPlanPage();
    // Same prop-based assertion as case 1 (see comment there) — the NONE
    // branch returns early today, but asserting the prop keeps this test
    // merge-order-independent regardless of future restructuring.
    expect(findNode(tree, SimpleMealPlan)?.props?.mealPlan ?? null).toBeNull();
    expect(findNode(tree, ExportPdfButton)).toBeNull();
    expect(findNode(tree, ProviderResolution)).toBeNull();
  });

  it("case 5 — ambiguous provider (two CoachClient rows, no ClientCoachingContext) renders ProviderResolution, not a plan", async () => {
    const client = await makeUser();
    const coachA = await makeUser({ isCoach: true, isClient: false });
    const coachB = await makeUser({ isCoach: true, isClient: false });
    await db.coachClient.createMany({ data: [{ coachId: coachA.id, clientId: client.id }, { coachId: coachB.id, clientId: client.id }] });
    await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date() },
    });
    auth.user = { ...client, isClient: true };

    const tree = await ClientMealPlanPage();
    expect(findNode(tree, ProviderResolution)).not.toBeNull();
    expect(findNode(tree, SimpleMealPlan)).toBeNull();
  });

  it("case 6 — AI origin (ClientCoachingContext mode AI) renders AiClientSurface, never the human plan", async () => {
    const client = await makeUser();
    const coach = await makeUser({ isCoach: true, isClient: false });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date() },
    });
    auth.user = { ...client, isClient: true };

    const tree = await ClientMealPlanPage();
    expect(findNode(tree, AiClientSurface)).not.toBeNull();
    expect(findNode(tree, SimpleMealPlan)).toBeNull();
  });

  it("case 8 — production context-repointed path: a ClientCoachingContext row (not the legacy 2-row heuristic) never sees the previous coach's plan", async () => {
    const client = await makeUser();
    const coachA = await makeUser({ isCoach: true, isClient: false });
    const coachB = await makeUser({ isCoach: true, isClient: false });
    // Old link is left on disk (not deleted) — proves the context row, not a
    // "single surviving row" heuristic, decides the provider.
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    const plan = await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date("2026-01-05T00:00:00Z") },
    });
    const linkB = await db.coachClient.create({
      data: { coachId: coachB.id, clientId: client.id, createdAt: new Date(plan.publishedAt!.getTime() + 86_400_000) },
    });
    // Explicit context row, not the `legacy.length === 1` heuristic: exercises
    // `lib/queries/client-provider.ts:9` (context.activeCoachClientId), not `:13`.
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", activeCoachClientId: linkB.id } });
    auth.user = { ...client, isClient: true };

    const tree = await ClientMealPlanPage();
    expect(findNode(tree, SimpleMealPlan)?.props?.mealPlan ?? null).toBeNull();
    expect(findNode(tree, ExportPdfButton)).toBeNull();
    expect(findNode(tree, ProviderResolution)).toBeNull();
    expect(findNode(tree, AiClientSurface)).toBeNull();
  });

  it("case 9 — ClientCoachingContext mode NONE with a lingering CoachClient row renders the empty state, never the plan", async () => {
    const client = await makeUser();
    const coach = await makeUser({ isCoach: true, isClient: false });
    // The link is never deleted — proves the page reads `context.mode`, not a
    // raw `coachClient.findFirst`, for the NONE decision.
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "NONE" } });
    await db.mealPlan.create({
      data: { clientId: client.id, weekOf: new Date("2026-01-05T00:00:00Z"), status: "PUBLISHED", publishedAt: new Date() },
    });
    auth.user = { ...client, isClient: true };

    const tree = await ClientMealPlanPage();
    // Coverage ceiling (r2 MINOR 3): these four assertions cannot tell this
    // NONE empty state ("Meal Plan requires a coach" + /coaches CTA) apart
    // from the HUMAN-but-gated-away empty state ("No meal plan yet") — both
    // render none of the stubbed components below. This case still
    // discriminates against sprint-1 (see the class comment), so it stays a
    // real negative test, just not a NONE-vs-HUMAN one.
    expect(findNode(tree, SimpleMealPlan)?.props?.mealPlan ?? null).toBeNull();
    expect(findNode(tree, ExportPdfButton)).toBeNull();
    expect(findNode(tree, ProviderResolution)).toBeNull();
    expect(findNode(tree, AiClientSurface)).toBeNull();
  });

  describe("case 7 — training twin", () => {
    it("headline regression: a switched-coach client never sees the previous coach's training program", async () => {
      const client = await makeUser();
      const coachA = await makeUser({ isCoach: true, isClient: false });
      const coachB = await makeUser({ isCoach: true, isClient: false });
      const linkA = await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
      const program = await db.trainingProgram.create({
        data: {
          clientId: client.id,
          weekOf: new Date("2026-01-05T00:00:00Z"),
          status: "PUBLISHED",
          publishedAt: new Date("2026-01-05T00:00:00Z"),
          days: { create: [{ dayName: "Day 1", sortOrder: 0 }] },
        },
      });
      await db.coachClient.delete({ where: { id: linkA.id } });
      await db.coachClient.create({
        data: { coachId: coachB.id, clientId: client.id, createdAt: new Date(program.publishedAt!.getTime() + 86_400_000) },
      });
      auth.user = { ...client, isClient: true };

      const tree = await ClientTrainingPage();
      expect(findNode(tree, TrainingProgram)).toBeNull();
      expect(findNode(tree, ExportPdfButton)).toBeNull();

      // Parity gap 2: add the /api/client/training/current comparison (case
      // 2's meal-plan twin already does this for the null side).
      const res = await trainingCurrentRoute();
      expect(res.status).toBe(200);
      const iosBody = await res.json();
      expect(iosBody.trainingProgram?.id ?? null).toBeNull();
    });

    it("regression: a normal single-coach client still sees their training program and the Export PDF button", async () => {
      const client = await makeUser();
      const coach = await makeUser({ isCoach: true, isClient: false });
      const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
      const program = await db.trainingProgram.create({
        data: {
          clientId: client.id,
          weekOf: new Date("2026-01-05T00:00:00Z"),
          status: "PUBLISHED",
          publishedAt: new Date(link.createdAt.getTime() + 60_000),
          days: { create: [{ dayName: "Day 1", sortOrder: 0 }] },
        },
      });
      auth.user = { ...client, isClient: true };

      const tree = await ClientTrainingPage();
      expect(findNode(tree, TrainingProgram)?.props?.program?.id).toBe(program.id);
      expect(findNode(tree, ExportPdfButton)?.props?.resourceId).toBe(program.id);

      // Positive-side /api/client/training/current agreement (parity gap 2).
      const iosBody = await (await trainingCurrentRoute()).json();
      expect(iosBody.trainingProgram?.id ?? null).toBe(program.id);
    });
  });
});
