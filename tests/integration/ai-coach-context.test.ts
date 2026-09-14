import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * A01 — ClientCoachingContext is the sole current-provider authority
 * (CB06). Every writer that creates or deletes a CoachClient row must
 * reconcile it in the same transaction; AI enrollment requires an
 * explicit entitlement and a server-side flag, and never silently
 * displaces an active human relationship or an already-ambiguous account.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V08): one authoritative context; no arbitrary provider choice; AI
 * enrollment races human acceptance/deactivation correctly; no fake
 * coach, no duplicate authority, ambiguous backfill preserved, flags
 * enforced at server boundaries.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));

import { db } from "@/lib/db";
import { redeemInvite } from "@/app/actions/client-invites";
import { removeClient, leaveCoach } from "@/app/actions/coach-client";
import { enrollInAiCoaching, reconcileCoachingContextForClient } from "@/lib/activation";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("A01 — ClientCoachingContext single-authority with real PostgreSQL constraints", () => {
  const originalFlag = process.env.FEATURE_AI_COACH_ENROLLMENT;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { process.env.FEATURE_AI_COACH_ENROLLMENT = originalFlag; });
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoach() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `coach-${id}@example.test`, isCoach: true, isClient: false, activeRole: "COACH" } });
  }
  async function makeClient() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `client-${id}@example.test`, isCoach: false, isClient: true, activeRole: "CLIENT" } });
  }

  it("a client with no coach relationship has no ambiguous context after F02's invite acceptance creates one", async () => {
    const coach = await makeCoach();
    const client = await makeClient();
    const invite = await db.clientInvite.create({ data: { coachId: coach.id, email: client.email, name: "Client", expiresAt: new Date(Date.now() + 86_400_000) } });

    mocks.authUserId = client.clerkId;
    await redeemInvite(invite.inviteToken);

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.mode).toBe("HUMAN");
    expect(context.resolutionRequired).toBe(false);
    const assignment = await db.coachClient.findUniqueOrThrow({ where: { coachId_clientId: { coachId: coach.id, clientId: client.id } } });
    expect(context.activeCoachClientId).toBe(assignment.id);
  });

  it("removeClient resets context to NONE", async () => {
    const coach = await makeCoach();
    const client = await makeClient();
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await reconcileCoachingContextForClient(db, client.id);

    mocks.authUserId = coach.clerkId;
    await removeClient({ clientId: client.id });

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.mode).toBe("NONE");
    expect(context.activeCoachClientId).toBeNull();
  });

  it("leaveCoach resets context to NONE", async () => {
    const coach = await makeCoach();
    const client = await makeClient();
    const assignment = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await reconcileCoachingContextForClient(db, client.id);

    mocks.authUserId = client.clerkId;
    await leaveCoach({ coachClientId: assignment.id });

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.mode).toBe("NONE");
  });

  it("reconciliation never silently resolves an already-ambiguous account", async () => {
    const coach = await makeCoach();
    const client = await makeClient();
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", resolutionRequired: true, revision: 1 } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });

    await reconcileCoachingContextForClient(db, client.id);

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.resolutionRequired).toBe(true);
    expect(context.activeCoachClientId).toBeNull(); // never guessed
  });

  it("reconciliation never silently reverts an AI-enrolled client to HUMAN or NONE", async () => {
    const coach = await makeCoach();
    const client = await makeClient();
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI", revision: 1 } });
    // A legacy human relationship changing (e.g. an old row cleaned up)
    // must not displace AI authority.
    const assignment = await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    await db.coachClient.delete({ where: { id: assignment.id } });

    await reconcileCoachingContextForClient(db, client.id);

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.mode).toBe("AI");
  });

  it("more than one CoachClient row for a client sets resolutionRequired instead of guessing", async () => {
    const coachA = await makeCoach();
    const coachB = await makeCoach();
    const client = await makeClient();
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: client.id } });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: client.id } });

    await reconcileCoachingContextForClient(db, client.id);

    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(context.resolutionRequired).toBe(true);
    expect(context.activeCoachClientId).toBeNull();
  });

  describe("enrollInAiCoaching", () => {
    it("fails when the enrollment flag is disabled", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "false";
      const client = await makeClient();
      await db.aiCoachEntitlement.create({ data: { clientId: client.id } });

      const result = await enrollInAiCoaching(client.id);
      expect(result.success).toBe(false);
    });

    it("fails when the client has no entitlement", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "true";
      const client = await makeClient();

      const result = await enrollInAiCoaching(client.id);
      expect(result.success).toBe(false);
    });

    it("fails when the entitlement was revoked", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "true";
      const client = await makeClient();
      await db.aiCoachEntitlement.create({ data: { clientId: client.id, revokedAt: new Date() } });

      const result = await enrollInAiCoaching(client.id);
      expect(result.success).toBe(false);
    });

    it("fails when the client currently has an active human coach", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "true";
      const coach = await makeCoach();
      const client = await makeClient();
      await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
      await reconcileCoachingContextForClient(db, client.id);
      await db.aiCoachEntitlement.create({ data: { clientId: client.id } });

      const result = await enrollInAiCoaching(client.id);
      expect(result.success).toBe(false);

      const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
      expect(context.mode).toBe("HUMAN"); // unchanged
    });

    it("succeeds for an entitled client with no current provider, creating a profile and setting mode=AI", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "true";
      const client = await makeClient();
      await db.aiCoachEntitlement.create({ data: { clientId: client.id } });

      const result = await enrollInAiCoaching(client.id);
      expect(result.success).toBe(true);

      const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: client.id } });
      expect(context.mode).toBe("AI");
      const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
      expect(profile).toBeTruthy();
    });

    it("is idempotent when already enrolled", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "true";
      const client = await makeClient();
      await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
      await enrollInAiCoaching(client.id);

      const second = await enrollInAiCoaching(client.id);
      expect(second.success).toBe(true);

      const profileCount = await db.aiCoachProfile.count({ where: { clientId: client.id } });
      expect(profileCount).toBe(1);
    });

    it("fails for an account requiring manual resolution", async () => {
      process.env.FEATURE_AI_COACH_ENROLLMENT = "true";
      const client = await makeClient();
      await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "HUMAN", resolutionRequired: true, revision: 1 } });
      await db.aiCoachEntitlement.create({ data: { clientId: client.id } });

      const result = await enrollInAiCoaching(client.id);
      expect(result.success).toBe(false);
    });
  });
});
