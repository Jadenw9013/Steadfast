import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

/**
 * S-34 — `/client`'s coaching chooser (state-table rows 4/5) and the §2
 * consequence on the four tabs. Technique: `await` the async Server
 * Component directly and walk the returned element tree for stubbed
 * component identity, exactly as
 * tests/integration/client-plan-page-provider-scope.test.ts:13-18,49-60. All
 * provider state comes from the real `getClientProvider`, never a mock.
 */

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => auth.user }));
vi.mock("@/components/ai-coach/client-surface", () => ({
  AiClientSurface: function AiClientSurface() { return null; },
  ProviderResolution: function ProviderResolution() { return null; },
}));
vi.mock("@/components/ai-coach/coaching-chooser", () => ({
  AiCoachingChooser: function AiCoachingChooser() { return null; },
}));

import { db } from "@/lib/db";
import { getClientProvider } from "@/lib/queries/client-provider";
import { GOVERNANCE_SCOPES, getGenerationDeliveryState } from "@/lib/ai-coach/operations";
import { activateTestLiveRelease, deactivateTestLiveRelease } from "../helpers/ai-live-launch";
import { AiClientSurface } from "@/components/ai-coach/client-surface";
import { AiCoachingChooser } from "@/components/ai-coach/coaching-chooser";
import ClientDashboard from "@/app/client/page";
import ClientPlanPage from "@/app/client/plan/page";
import ClientTrainingPage from "@/app/client/training/page";
import ClientMealPlanPage from "@/app/client/meal-plan/page";
import ClientCheckInPage from "@/app/client/check-in/page";
import { GET as coachingContextRoute } from "@/app/api/client/coaching-context/route";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: this file activates/deactivates the single live release and reads
// AiCoachOperationalControl GENERATION state table-wide. Runs alone.
lockGlobalAiCoachState("exclusive");

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAllByHref(node: any, href: string, acc: any[] = []): any[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const child of node) findAllByHref(child, href, acc);
    return acc;
  }
  if (node.props?.href === href) acc.push(node);
  findAllByHref(node.props?.children, href, acc);
  return acc;
}

suite("S-34 — /client coaching chooser (degrade rule, population regressions, contract freeze)", () => {
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

  async function controlActor() {
    const actor = await makeUser({ isCoach: true, isClient: false });
    await db.aiCoachGovernanceGrant.create({
      data: { userId: actor.id, scopes: [...GOVERNANCE_SCOPES], grantRef: "s34-fixture-root" },
    });
    return actor;
  }

  /** Zero `CoachClient` rows, no `ClientCoachingContext` row (origin NONE),
   * a non-synthetic `AiCoachProfile` and a live `AiCoachEntitlement` — every
   * gate in `getAiCoachClientDiscoveryInTransaction` except the release gate
   * is satisfied, so this client gets a live offer whenever an ACTIVE
   * release exists and `FEATURE_AI_COACH_ENROLLMENT` is on. */
  async function offerStateClient() {
    const client = await makeUser();
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: false } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    return client;
  }

  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("with an ACTIVE live release (offer-state clients)", () => {
    let actor: { id: string };

    beforeEach(async () => {
      actor = await controlActor();
      await activateTestLiveRelease({
        namespace: `s34-chooser-${randomUUID()}`,
        actorUserId: actor.id,
      });
    });
    afterEach(async () => {
      await deactivateTestLiveRelease(actor.id);
    });

    it("A — the degrade regression the ticket requires: an AI pause still shows the human-coach path", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };

      // activateTestLiveRelease enables all five operational-control
      // scopes; explicitly pause GENERATION only, as governance would.
      await db.aiCoachOperationalControl.update({
        where: { scope: "GENERATION" },
        data: { disabled: true, reasonCode: "S34_TEST_PAUSE" },
      });

      const tree = await ClientDashboard();
      const chooser = findNode(tree, AiCoachingChooser);
      expect(chooser).not.toBeNull();
      expect(chooser.props.offer).not.toBeNull();
      expect(chooser.props.aiPreparationState).not.toBe("ENABLED");

      // The human-coach path survives an AI pause: the frozen component
      // contract always carries a /coaches destination in its offer.
      expect(chooser.props.offer.humanCoachLabel).toBeTruthy();
      const provider = await getClientProvider(client.id);
      expect(provider.aiDiscovery).not.toBeNull();
    });

    it("B — control row absent, flag on: aiPreparationState is ENABLED", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };
      vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
      await db.aiCoachOperationalControl.deleteMany({ where: { scope: "GENERATION" } });

      const tree = await ClientDashboard();
      const chooser = findNode(tree, AiCoachingChooser);
      expect(chooser).not.toBeNull();
      expect(chooser.props.aiPreparationState).toBe("ENABLED");
    });

    it("E — the §2 consequence: each tab renders its human/NONE branch, never AiClientSurface, and check-in does not throw for a client with no coach and no template", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };

      const planTree = await ClientPlanPage();
      expect(findNode(planTree, AiClientSurface)).toBeNull();

      const trainingTree = await ClientTrainingPage();
      expect(findNode(trainingTree, AiClientSurface)).toBeNull();
      expect(findAllByHref(trainingTree, "/coaches").length).toBeGreaterThan(0);

      const mealPlanTree = await ClientMealPlanPage();
      expect(findNode(mealPlanTree, AiClientSurface)).toBeNull();
      expect(findAllByHref(mealPlanTree, "/coaches").length).toBeGreaterThan(0);

      await expect(ClientCheckInPage()).resolves.toBeTruthy();
      const checkInTree = await ClientCheckInPage();
      expect(findNode(checkInTree, AiClientSurface)).toBeNull();
    });

    it("G — contract freeze: GET /api/client/coaching-context returns exactly the nine frozen keys", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };

      const res = await coachingContextRoute(
        new NextRequest("https://example.test/api/client/coaching-context")
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body.data).sort()).toEqual(
        [
          "origin",
          "revision",
          "resolutionRequired",
          "activeCoachClientId",
          "coachId",
          "relationshipStartedAt",
          "aiPreviewAvailable",
          "aiDiscovery",
          "aiDiscoveryReasonCode",
        ].sort()
      );
    });
  });

  it("C — regression: AI origin renders AiClientSurface and never AiCoachingChooser, on /client and all four tab pages", async () => {
    const client = await makeUser();
    const coach = await makeUser({ isCoach: true, isClient: false });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    auth.user = { ...client, isClient: true };

    const dashboardTree = await ClientDashboard();
    expect(findNode(dashboardTree, AiClientSurface)).not.toBeNull();
    expect(findNode(dashboardTree, AiCoachingChooser)).toBeNull();

    expect(findNode(await ClientPlanPage(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientTrainingPage(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientMealPlanPage(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientCheckInPage(), AiClientSurface)).not.toBeNull();
  });

  it("D — regression: the synthetic fixture preview keeps today's takeover, on /client and all four tabs", async () => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    const client = await makeUser();
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    auth.user = { ...client, isClient: true };

    const provider = await getClientProvider(client.id);
    expect(provider.aiPreviewAvailable).toBe(true);
    expect(provider.aiDiscovery).toBeNull();

    expect(findNode(await ClientDashboard(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientDashboard(), AiCoachingChooser)).toBeNull();
    expect(findNode(await ClientPlanPage(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientTrainingPage(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientMealPlanPage(), AiClientSurface)).not.toBeNull();
    expect(findNode(await ClientCheckInPage(), AiClientSurface)).not.toBeNull();
  });

  it("F — regression: a HUMAN client with a published plan sees no chooser and no AI node, and the plan still renders", async () => {
    const client = await makeUser();
    const coach = await makeUser({ isCoach: true, isClient: false });
    const link = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.mealPlan.create({
      data: {
        clientId: client.id,
        weekOf: new Date("2026-01-05T00:00:00Z"),
        status: "PUBLISHED",
        publishedAt: new Date(link.createdAt.getTime() + 60_000),
      },
    });
    auth.user = { ...client, isClient: true };

    const tree = await ClientDashboard();
    expect(findNode(tree, AiCoachingChooser)).toBeNull();
    expect(findNode(tree, AiClientSurface)).toBeNull();
    expect(findAllByHref(tree, "/client/meal-plan").length).toBeGreaterThan(0);

    const provider = await getClientProvider(client.id);
    expect(provider.aiDiscovery).toBeNull();
    expect(provider.aiPreviewAvailable).toBe(false);
  });

  it("H — getGenerationDeliveryState reads DISABLED_BY_FLAG with the flag unset (no database access) and PAUSED in production with no GENERATION control row", async () => {
    await db.aiCoachOperationalControl.deleteMany({ where: { scope: "GENERATION" } });

    delete process.env.FEATURE_AI_COACH_GENERATION;
    expect(await getGenerationDeliveryState()).toBe("DISABLED_BY_FLAG");
    expect(await db.aiCoachOperationalControl.count({ where: { scope: "GENERATION" } })).toBe(0);

    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(await getGenerationDeliveryState()).toBe("PAUSED");
    expect(await db.aiCoachOperationalControl.count({ where: { scope: "GENERATION" } })).toBe(0);
  });
});
