import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";

/**
 * S-34 — `/client`'s coaching chooser (state-table rows 4/5) and the §2
 * consequence on the four tabs. Technique: `await` the async Server
 * Component directly and walk the returned element tree for stubbed
 * component identity, exactly as
 * tests/integration/client-plan-page-provider-scope.test.ts:13-18,49-60. All
 * provider state comes from the real `getClientProvider`, never a mock.
 *
 * `AiCoachingChooser` itself is **not** mocked (review round 1, finding 1):
 * it has no DB import (type-only imports only, see its own file comment),
 * so the real component can run both for `findNode` identity matching
 * against the page's unrendered element tree *and* for
 * `renderToStaticMarkup`, which is how case A proves the `/coaches` link
 * actually survives a governance pause rather than asserting a tautological
 * prop on a stubbed `null`.
 */

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => auth.user }));
vi.mock("@/components/ai-coach/client-surface", () => ({
  AiClientSurface: function AiClientSurface() { return null; },
  ProviderResolution: function ProviderResolution() { return null; },
}));

import { db } from "@/lib/db";
import { getClientProvider } from "@/lib/queries/client-provider";
import { GOVERNANCE_SCOPES, getGenerationDeliveryState } from "@/lib/ai-coach/operations";
import { activateTestLiveRelease, deactivateTestLiveRelease } from "../helpers/ai-live-launch";
import { AiClientSurface } from "@/components/ai-coach/client-surface";
import { AiCoachingChooser } from "@/components/ai-coach/coaching-chooser";
import ClientDashboard from "@/app/client/page";
import { CheckInForm } from "@/components/check-in/check-in-form";
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

/** Positive text-content check against the unrendered element tree (string
 * children are present directly, before any renderer runs) — review round 1
 * finding 4: a page that fell through to the wrong branch, or returned an
 * empty fragment, must not pass a test that only checks what is *absent*. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findText(node: any, text: string): boolean {
  if (node == null) return false;
  if (typeof node === "string") return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => findText(child, text));
  if (typeof node === "object") return findText(node.props?.children, text);
  return false;
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

    it("A — the degrade regression the ticket requires: a governance pause produces PAUSED exactly, and the human-coach /coaches link still renders", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };

      // The flag must be on so the pause — not the flag — is what the
      // chooser reports (review round 1, finding 1: the suite-level
      // beforeEach only stubs FEATURE_AI_COACH_ENROLLMENT, so without this
      // the test passed via DISABLED_BY_FLAG before the GENERATION row was
      // ever read, and deleting the `update` below changed nothing).
      vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");

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
      expect(chooser.props.aiPreparationState).toBe("PAUSED");

      // The human-coach path survives the pause: render the *real*
      // component with the exact props the page produced and look for the
      // actual `/coaches` link in the markup, not a truthy field on the
      // offer DTO (which says nothing about what the component does with
      // it).
      const html = renderToStaticMarkup(createElement(AiCoachingChooser, chooser.props));
      expect(html).toContain('href="/coaches"');

      const provider = await getClientProvider(client.id);
      expect(provider.aiDiscovery).not.toBeNull();
    });

    it("A2 — flag unset: aiPreparationState is DISABLED_BY_FLAG exactly, and the human-coach /coaches link still renders", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };

      // Explicit, not relied-on-by-omission: the suite-level beforeEach
      // stubs only FEATURE_AI_COACH_ENROLLMENT, so this forces the
      // GENERATION flag unset regardless of what the environment the test
      // runner inherited happens to have.
      vi.stubEnv("FEATURE_AI_COACH_GENERATION", undefined);

      const tree = await ClientDashboard();
      const chooser = findNode(tree, AiCoachingChooser);
      expect(chooser).not.toBeNull();
      expect(chooser.props.aiPreparationState).toBe("DISABLED_BY_FLAG");

      const html = renderToStaticMarkup(createElement(AiCoachingChooser, chooser.props));
      expect(html).toContain('href="/coaches"');
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

    it("E — the §2 consequence: each tab renders its own NONE branch (a positive node, not just an absent one), never AiClientSurface", async () => {
      const client = await offerStateClient();
      auth.user = { ...client, isClient: true };

      // /client/plan's NONE branch is plain text with no CTA link, so its
      // positive assertion is a text match rather than an href.
      const planTree = await ClientPlanPage();
      expect(findNode(planTree, AiClientSurface)).toBeNull();
      expect(findText(planTree, "No current plan")).toBe(true);

      const trainingTree = await ClientTrainingPage();
      expect(findNode(trainingTree, AiClientSurface)).toBeNull();
      expect(findAllByHref(trainingTree, "/coaches").length).toBeGreaterThan(0);

      const mealPlanTree = await ClientMealPlanPage();
      expect(findNode(mealPlanTree, AiClientSurface)).toBeNull();
      expect(findAllByHref(mealPlanTree, "/coaches").length).toBeGreaterThan(0);

      // S-34 review finding 3: check-in now has its own NONE branch
      // (mirroring training/meal-plan), so an offer-state (zero-CoachClient)
      // client sees "Check-In requires a coach" + a /coaches CTA instead of
      // a form whose every submission `lib/check-ins/submit.ts` would
      // reject. CheckInForm must NOT be the node that renders here.
      const checkInTree = await ClientCheckInPage();
      expect(findNode(checkInTree, AiClientSurface)).toBeNull();
      expect(findNode(checkInTree, CheckInForm)).toBeNull();
      expect(findAllByHref(checkInTree, "/coaches").length).toBeGreaterThan(0);
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

  it("H — getGenerationDeliveryState reads DISABLED_BY_FLAG with the flag unset, provably without any database access, and PAUSED in production with no GENERATION control row", async () => {
    // review round 1, finding 5: `count() === 0` after `deleteMany` only
    // proves the rows are gone, not that the function made no query. Spy on
    // the model the function would have to call through if it reached the
    // gate at all, and assert it never did.
    const spy = vi.spyOn(db.aiCoachOperationalControl, "findUnique");
    try {
      // `vi.stubEnv(name, undefined)` rather than a raw `delete` — the raw
      // mutation is not tracked by `vi.unstubAllEnvs()` (`:afterEach` below)
      // and would leak into whatever runs after this file in the same
      // worker (review round 1, finding 5).
      vi.stubEnv("FEATURE_AI_COACH_GENERATION", undefined);
      expect(await getGenerationDeliveryState()).toBe("DISABLED_BY_FLAG");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }

    await db.aiCoachOperationalControl.deleteMany({ where: { scope: "GENERATION" } });
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(await getGenerationDeliveryState()).toBe("PAUSED");
  });
});
