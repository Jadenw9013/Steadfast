import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  bootstrapGovernanceGrant,
  grantGovernanceGrant,
  revokeGovernanceGrant,
  grantReviewerGrant,
  revokeReviewerGrant,
  grantClientEntitlement,
  revokeClientEntitlement,
  GOVERNANCE_SCOPES,
} from "@/lib/ai-coach/grants";
import {
  requireGovernanceGrant,
  getAiCoachOperationalMonitoring,
  setAiCoachOperationalControl,
} from "@/lib/ai-coach/operations";
import { publishArtifactVersion, registerArtifactVersion } from "@/lib/ai-coach/artifacts/repository";
import {
  activateAiCoachLiveRelease,
  approveLiveLaunchPacket,
  deactivateAiCoachLiveRelease,
  registerLiveLaunchPacket,
} from "@/lib/ai-coach/live-launch/repository";
import {
  buildNonSyntheticLaunchTestArtifacts,
  completeNonTestLaunchPacket,
} from "@/tests/helpers/ai-live-launch";
import { getReviewerQueue } from "@/lib/ai-coach/reviewer";
import { getReviewerOperations } from "@/lib/ai-coach/reviewer-operations";
import { resolveAiSafety } from "@/lib/ai-coach/safety-resolution";
import { lockAiClient } from "@/lib/ai-coach/access";
import { getClientProvider } from "@/lib/queries/client-provider";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: table-wide AI Coach state; runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");

suite("T-995 — AI Coach grant provisioning (lib/ai-coach/grants.ts)", () => {
  afterAll(() => db.$disconnect());

  async function makeUser(
    overrides: Partial<{ isClient: boolean; isCoach: boolean; isDeactivated: boolean }> = {}
  ) {
    const id = randomUUID();
    return db.user.create({
      data: {
        clerkId: id,
        email: `${id}@example.test`,
        isClient: overrides.isClient ?? true,
        isCoach: overrides.isCoach ?? false,
        isDeactivated: overrides.isDeactivated ?? false,
      },
    });
  }

  /** A fresh user directly seeded with all eight scopes — the standard test
   * fixture for "an existing CONTROL_OPERATIONS holder", mirroring the direct
   * `db.aiCoachGovernanceGrant.create` fixture pattern already used in
   * ai-coach-end-to-end-governance.test.ts / ai-coach-provider-boundary.test.ts
   * / ai-coach-release-drills.test.ts. Bootstrap itself is tested separately. */
  async function controlActor() {
    const actor = await makeUser({ isClient: false, isCoach: true });
    await db.aiCoachGovernanceGrant.create({
      data: { userId: actor.id, scopes: [...GOVERNANCE_SCOPES], grantRef: "fixture-root" },
    });
    return actor;
  }

  async function aiClient(
    opts: {
      synthetic?: boolean;
      context?: "AI" | "HUMAN" | "NONE";
      resolutionRequired?: boolean;
    } = {}
  ) {
    const client = await makeUser();
    if (opts.synthetic !== undefined) {
      await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: opts.synthetic } });
    }
    if (opts.context !== undefined) {
      await db.clientCoachingContext.create({
        data: { clientId: client.id, mode: opts.context, resolutionRequired: opts.resolutionRequired ?? false },
      });
    }
    return client;
  }

  describe("bootstrap", () => {
    // Bootstrap's invariant ("no AiCoachGovernanceGrant row exists at all")
    // is global to the table, so every test in this block snapshots and
    // clears AiCoachGovernanceGrant/AiCoachAccessGrantEvent first and
    // restores exactly what it found afterward — the same pattern
    // account-deletion.test.ts uses for the AiCoachOperationalControl
    // singleton. This is the disposable local SECURITY_INTEGRATION test
    // database; the window is the duration of one `it`.
    // T-995 r2 NIT 11 (code review): a global (not per-row-scoped) delete is
    // still riskier than it needs to be — a hard crash inside `run()` loses
    // the try/finally restore, and a suite running concurrently against the
    // *same* database would see the table go empty mid-window even though it
    // is restored afterward. Per the 2026-09-25 board rule adopted mid-task
    // for this ticket, all `SECURITY_INTEGRATION=1` runs for T-995 now use a
    // private, disposable `steadfast_migration_replay_T995` database that no
    // other worktree/ticket ever touches, which removes the concurrent-suite
    // half of the risk structurally; the crash-safety half is unchanged but
    // low-cost here because the whole database is rebuilt from a migration
    // replay before every run regardless, so there is no other test's
    // long-lived fixture to lose. Left as snapshot-then-restore (not
    // rewritten to a narrower per-row scope) for that reason — flagging the
    // reasoning rather than silently accepting the finding as-is.
    async function withEmptyGovernanceTable<T>(run: () => Promise<T>): Promise<T> {
      const priorGrants = await db.aiCoachGovernanceGrant.findMany();
      const priorEvents = await db.aiCoachAccessGrantEvent.findMany();
      await db.aiCoachAccessGrantEvent.deleteMany();
      await db.aiCoachGovernanceGrant.deleteMany();
      try {
        return await run();
      } finally {
        await db.aiCoachAccessGrantEvent.deleteMany();
        await db.aiCoachGovernanceGrant.deleteMany();
        if (priorGrants.length) await db.aiCoachGovernanceGrant.createMany({ data: priorGrants });
        if (priorEvents.length) await db.aiCoachAccessGrantEvent.createMany({ data: priorEvents });
      }
    }

    it("creates the first governance grant with all eight scopes and one BOOTSTRAP audit row", async () => {
      await withEmptyGovernanceTable(async () => {
        const owner = await makeUser({ isClient: false, isCoach: true });
        const result = await bootstrapGovernanceGrant({
          userId: owner.id,
          grantRef: "signed-ref",
          actorRef: "Named Human, operational owner",
          reasonCode: "GOVERNANCE_BOOTSTRAP",
          confirmBootstrap: true,
        });
        expect(result.grantType).toBe("GOVERNANCE");
        expect(result.action).toBe("BOOTSTRAP");
        expect(result.subjectUserId).toBe(owner.id);
        expect([...result.scopes].sort()).toEqual([...GOVERNANCE_SCOPES].sort());

        const grants = await db.aiCoachGovernanceGrant.findMany();
        expect(grants).toHaveLength(1);
        expect(grants[0].userId).toBe(owner.id);
        expect([...grants[0].scopes].sort()).toEqual([...GOVERNANCE_SCOPES].sort());

        const events = await db.aiCoachAccessGrantEvent.findMany();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          grantType: "GOVERNANCE",
          action: "BOOTSTRAP",
          actorUserId: owner.id,
          subjectUserId: owner.id,
          governanceGrantId: grants[0].id,
        });
      });
    });

    it("refuses a second time; exactly one grant row and one audit row exist", async () => {
      await withEmptyGovernanceTable(async () => {
        const owner = await makeUser({ isClient: false, isCoach: true });
        await bootstrapGovernanceGrant({
          userId: owner.id,
          grantRef: "signed-ref",
          actorRef: "Named Human, operational owner",
          reasonCode: "GOVERNANCE_BOOTSTRAP",
          confirmBootstrap: true,
        });
        const other = await makeUser({ isClient: false, isCoach: true });
        await expect(
          bootstrapGovernanceGrant({
            userId: other.id,
            grantRef: "signed-ref-2",
            actorRef: "Named Human, operational owner",
            reasonCode: "GOVERNANCE_BOOTSTRAP",
            confirmBootstrap: true,
          })
        ).rejects.toMatchObject({ code: "ALREADY_BOOTSTRAPPED", status: 409 });
        expect(await db.aiCoachGovernanceGrant.count()).toBe(1);
        expect(await db.aiCoachAccessGrantEvent.count()).toBe(1);
      });
    });

    it("still refuses after the first grant is revoked", async () => {
      await withEmptyGovernanceTable(async () => {
        const owner = await makeUser({ isClient: false, isCoach: true });
        const result = await bootstrapGovernanceGrant({
          userId: owner.id,
          grantRef: "signed-ref",
          actorRef: "Named Human, operational owner",
          reasonCode: "GOVERNANCE_BOOTSTRAP",
          confirmBootstrap: true,
        });
        await db.aiCoachGovernanceGrant.update({
          where: { id: result.grantRecordId },
          data: { revokedAt: new Date() },
        });
        const other = await makeUser({ isClient: false, isCoach: true });
        await expect(
          bootstrapGovernanceGrant({
            userId: other.id,
            grantRef: "signed-ref-2",
            actorRef: "Named Human, operational owner",
            reasonCode: "GOVERNANCE_BOOTSTRAP",
            confirmBootstrap: true,
          })
        ).rejects.toMatchObject({ code: "ALREADY_BOOTSTRAPPED" });
      });
    });

    it("refuses without --confirm-bootstrap (service called with the flag false)", async () => {
      await withEmptyGovernanceTable(async () => {
        const owner = await makeUser({ isClient: false, isCoach: true });
        await expect(
          bootstrapGovernanceGrant({
            userId: owner.id,
            grantRef: "signed-ref",
            actorRef: "Named Human, operational owner",
            reasonCode: "GOVERNANCE_BOOTSTRAP",
            confirmBootstrap: false as unknown as true,
          })
        ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED", status: 422 });
        expect(await db.aiCoachGovernanceGrant.count()).toBe(0);
      });
    });

    it("concurrent bootstrap — two promises raced; exactly one succeeds (advisory lock)", async () => {
      await withEmptyGovernanceTable(async () => {
        const a = await makeUser({ isClient: false, isCoach: true });
        const b = await makeUser({ isClient: false, isCoach: true });
        const results = await Promise.allSettled([
          bootstrapGovernanceGrant({
            userId: a.id,
            grantRef: "ref-a",
            actorRef: "Human A",
            reasonCode: "GOVERNANCE_BOOTSTRAP",
            confirmBootstrap: true,
          }),
          bootstrapGovernanceGrant({
            userId: b.id,
            grantRef: "ref-b",
            actorRef: "Human B",
            reasonCode: "GOVERNANCE_BOOTSTRAP",
            confirmBootstrap: true,
          }),
        ]);
        const statuses = results.map((r) => r.status);
        expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
        expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);
        expect(await db.aiCoachGovernanceGrant.count()).toBe(1);
      });
    });
  });

  describe("grant-governance requires CONTROL_OPERATIONS", () => {
    it("actor with only VIEW_AGGREGATE_MONITORING throws FORBIDDEN", async () => {
      const actor = await makeUser({ isClient: false, isCoach: true });
      await db.aiCoachGovernanceGrant.create({
        data: { userId: actor.id, scopes: ["VIEW_AGGREGATE_MONITORING"], grantRef: "fixture" },
      });
      const subject = await makeUser({ isClient: false, isCoach: true });
      await expect(
        grantGovernanceGrant({
          actorUserId: actor.id,
          userId: subject.id,
          scopes: ["PUBLISH_ARTIFACTS"],
          grantRef: "ref",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });

    it("actor with a revoked grant throws", async () => {
      const actor = await makeUser({ isClient: false, isCoach: true });
      await db.aiCoachGovernanceGrant.create({
        data: {
          userId: actor.id,
          scopes: [...GOVERNANCE_SCOPES],
          grantRef: "fixture",
          revokedAt: new Date(),
        },
      });
      const subject = await makeUser({ isClient: false, isCoach: true });
      await expect(
        grantGovernanceGrant({
          actorUserId: actor.id,
          userId: subject.id,
          scopes: ["PUBLISH_ARTIFACTS"],
          grantRef: "ref",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("actor whose User.isDeactivated throws", async () => {
      const actor = await makeUser({ isClient: false, isCoach: true, isDeactivated: true });
      await db.aiCoachGovernanceGrant.create({
        data: { userId: actor.id, scopes: [...GOVERNANCE_SCOPES], grantRef: "fixture" },
      });
      const subject = await makeUser({ isClient: false, isCoach: true });
      await expect(
        grantGovernanceGrant({
          actorUserId: actor.id,
          userId: subject.id,
          scopes: ["PUBLISH_ARTIFACTS"],
          grantRef: "ref",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("create then revoke, for each of the three types", () => {
    it("GOVERNANCE", async () => {
      const root = await controlActor();
      const subject = await makeUser({ isClient: false, isCoach: true });
      const granted = await grantGovernanceGrant({
        actorUserId: root.id,
        userId: subject.id,
        scopes: ["PUBLISH_ARTIFACTS", "REVOKE_ARTIFACTS"],
        grantRef: "signed-ref",
        actorRef: "Human",
        reasonCode: "TEST_GRANT",
      });
      const grantRow = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: subject.id },
      });
      expect([...grantRow.scopes].sort()).toEqual(["PUBLISH_ARTIFACTS", "REVOKE_ARTIFACTS"].sort());
      const rootGrantRow = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: root.id },
      });
      const grantEvent = await db.aiCoachAccessGrantEvent.findUniqueOrThrow({
        where: { id: granted.auditEventId },
      });
      expect(grantEvent).toMatchObject({
        grantType: "GOVERNANCE",
        action: "GRANT",
        actorUserId: root.id,
        subjectUserId: subject.id,
        governanceGrantId: rootGrantRow.id,
        actorRef: "Human",
        reasonCode: "TEST_GRANT",
      });

      const revoked = await revokeGovernanceGrant({
        actorUserId: root.id,
        userId: subject.id,
        actorRef: "Human",
        reasonCode: "TEST_REVOKE",
      });
      const revokedGrantRow = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: subject.id },
      });
      expect(revokedGrantRow.revokedAt).not.toBeNull();
      const revokeEvent = await db.aiCoachAccessGrantEvent.findUniqueOrThrow({
        where: { id: revoked.auditEventId },
      });
      expect(revokeEvent).toMatchObject({
        grantType: "GOVERNANCE",
        action: "REVOKE",
        actorUserId: root.id,
        subjectUserId: subject.id,
        governanceGrantId: rootGrantRow.id,
        actorRef: "Human",
        reasonCode: "TEST_REVOKE",
      });
    });

    it("REVIEWER", async () => {
      const root = await controlActor();
      const reviewer = await makeUser({ isClient: false, isCoach: true });
      const client = await aiClient({ context: "AI" });
      const granted = await grantReviewerGrant({
        actorUserId: root.id,
        userId: reviewer.id,
        clientIds: [client.id],
        domains: ["NUTRITION"],
        qualificationNote: "Registered dietitian, license 123",
        actorRef: "Human",
        reasonCode: "TEST_GRANT",
      });
      const grantRow = await db.aiCoachReviewerGrant.findUniqueOrThrow({
        where: { userId: reviewer.id },
      });
      expect(grantRow.grantedBy).toBe(root.id);
      expect(grantRow.clientIds).toEqual([client.id]);
      const rootGrantRow = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: root.id },
      });
      const grantEvent = await db.aiCoachAccessGrantEvent.findUniqueOrThrow({
        where: { id: granted.auditEventId },
      });
      expect(grantEvent).toMatchObject({
        grantType: "REVIEWER",
        action: "GRANT",
        actorUserId: root.id,
        subjectUserId: reviewer.id,
        governanceGrantId: rootGrantRow.id,
      });

      const revoked = await revokeReviewerGrant({
        actorUserId: root.id,
        userId: reviewer.id,
        actorRef: "Human",
        reasonCode: "TEST_REVOKE",
      });
      const revokedRow = await db.aiCoachReviewerGrant.findUniqueOrThrow({
        where: { userId: reviewer.id },
      });
      expect(revokedRow.revokedAt).not.toBeNull();
      const revokeEvent = await db.aiCoachAccessGrantEvent.findUniqueOrThrow({
        where: { id: revoked.auditEventId },
      });
      expect(revokeEvent).toMatchObject({
        grantType: "REVIEWER",
        action: "REVOKE",
        actorUserId: root.id,
        subjectUserId: reviewer.id,
      });
    });

    it("ENTITLEMENT", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const client = await aiClient({ synthetic: true, context: "AI" });
        const granted = await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST_GRANT",
        });
        const row = await db.aiCoachEntitlement.findUniqueOrThrow({ where: { clientId: client.id } });
        expect(row.grantedBy).toBe(root.id);
        const rootGrantRow = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
          where: { userId: root.id },
        });
        const grantEvent = await db.aiCoachAccessGrantEvent.findUniqueOrThrow({
          where: { id: granted.auditEventId },
        });
        expect(grantEvent).toMatchObject({
          grantType: "ENTITLEMENT",
          action: "GRANT",
          actorUserId: root.id,
          subjectUserId: client.id,
          governanceGrantId: rootGrantRow.id,
        });

        const revoked = await revokeClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          actorRef: "Human",
          reasonCode: "TEST_REVOKE",
        });
        const revokedRow = await db.aiCoachEntitlement.findUniqueOrThrow({
          where: { clientId: client.id },
        });
        expect(revokedRow.revokedAt).not.toBeNull();
        const revokeEvent = await db.aiCoachAccessGrantEvent.findUniqueOrThrow({
          where: { id: revoked.auditEventId },
        });
        expect(revokeEvent).toMatchObject({
          grantType: "ENTITLEMENT",
          action: "REVOKE",
          actorUserId: root.id,
          subjectUserId: client.id,
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("revoke-governance refuses to remove the last CONTROL_OPERATIONS grant", async () => {
    // The guard counts every non-revoked CONTROL_OPERATIONS grant in the
    // whole table, so every other one (from earlier tests in this file, or
    // left behind by another suite) is neutralized for the duration of this
    // test only, and restored afterward.
    const others = await db.aiCoachGovernanceGrant.findMany({
      where: { revokedAt: null, scopes: { has: "CONTROL_OPERATIONS" } },
    });
    if (others.length) {
      await db.aiCoachGovernanceGrant.updateMany({
        where: { id: { in: others.map((g) => g.id) } },
        data: { revokedAt: new Date() },
      });
    }
    try {
      const root = await controlActor();
      await expect(
        revokeGovernanceGrant({
          actorUserId: root.id,
          userId: root.id,
          actorRef: "Human",
          reasonCode: "TEST_REVOKE",
        })
      ).rejects.toMatchObject({ code: "LAST_CONTROL_GRANT", status: 409 });
      const row = await db.aiCoachGovernanceGrant.findUniqueOrThrow({ where: { userId: root.id } });
      expect(row.revokedAt).toBeNull();
    } finally {
      if (others.length) {
        await db.aiCoachGovernanceGrant.updateMany({
          where: { id: { in: others.map((g) => g.id) } },
          data: { revokedAt: null },
        });
      }
    }
  });

  it("revoke-governance refuses when the only other CONTROL_OPERATIONS holder is deactivated (T-995 r2 MAJOR 1)", async () => {
    // The count must read the same predicate requireGovernanceGrant reads —
    // a non-revoked grant belonging to a deactivated user is not a usable,
    // repairable authority, so it must not count as "another holder" that
    // makes this revoke safe.
    const others = await db.aiCoachGovernanceGrant.findMany({
      where: { revokedAt: null, scopes: { has: "CONTROL_OPERATIONS" } },
    });
    if (others.length) {
      await db.aiCoachGovernanceGrant.updateMany({
        where: { id: { in: others.map((g) => g.id) } },
        data: { revokedAt: new Date() },
      });
    }
    try {
      const root = await controlActor();
      const deactivatedHolder = await makeUser({
        isClient: false,
        isCoach: true,
        isDeactivated: true,
      });
      await db.aiCoachGovernanceGrant.create({
        data: {
          userId: deactivatedHolder.id,
          scopes: [...GOVERNANCE_SCOPES],
          grantRef: "fixture-deactivated-holder",
        },
      });
      await expect(
        revokeGovernanceGrant({
          actorUserId: root.id,
          userId: root.id,
          actorRef: "Human",
          reasonCode: "TEST_REVOKE",
        })
      ).rejects.toMatchObject({ code: "LAST_CONTROL_GRANT", status: 409 });
      const row = await db.aiCoachGovernanceGrant.findUniqueOrThrow({ where: { userId: root.id } });
      expect(row.revokedAt).toBeNull();
    } finally {
      if (others.length) {
        await db.aiCoachGovernanceGrant.updateMany({
          where: { id: { in: others.map((g) => g.id) } },
          data: { revokedAt: null },
        });
      }
    }
  });

  it("revoke-then-grant race: entitlement grant never succeeds with a governance grant that is revoked at commit time (T-995 r2 MINOR 4)", async () => {
    // T-995 r2 review round 2 MINOR 2: a single race with both outcomes
    // accepted, no barrier, is not strong enough — measured, not assumed.
    // A first fix here looped the same race 20x; deleting the `User(actor)`
    // FOR UPDATE at grants.ts and running that loop still passed 20/20 (see
    // T-995-web-engineer-r2.md for the pasted run). Root cause: the loop's
    // assertions accept *either* outcome (entitlement succeeds, or fails
    // FORBIDDEN with no row) as valid — which is correct in general, since
    // both are legitimate depending on who wins the race — but that means no
    // iteration count can ever fail from removing the lock, because the
    // assertions never encode the one thing the lock actually prevents:
    // deciding to grant *before* a concurrent revoke commits, then still
    // completing *after* it commits. Fixed with a real barrier instead: hold
    // a hand-built revoke transaction open — its writes made but not yet
    // committed — start the real `grantClientEntitlement`, give it time to
    // either block (fixed) or run ahead (unfixed), then release the revoke.
    // With the fix, `grantClientEntitlement` must be blocked on that exact
    // `User(actor)` row until the revoke commits, then see the now-revoked
    // grant and refuse. Without it, `grantClientEntitlement`'s unlocked read
    // happens while the revoke is provably still uncommitted, and it still
    // completes once unblocked by the audit-event row's implicit FK lock on
    // `User(actor)` — a real row does get written. This is exactly why the
    // single-line reorder (`AiCoachGovernanceGrant(actor)` first, the
    // original MINOR 4 fix attempt) produced a genuine Postgres deadlock:
    // it inverted `grantGovernanceGrant`/`revokeGovernanceGrant`'s own
    // `User(subject)` -> `AiCoachGovernanceGrant(subject)` order.
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    try {
      const root = await controlActor(); // extra CONTROL_OPERATIONS holder, so the revoke is never the last one
      const actor = await controlActor(); // the actor whose grant races a concurrent revoke
      const client = await aiClient({ synthetic: true, context: "AI" });

      let releaseRevoke: () => void = () => {};
      const barrier = new Promise<void>((resolve) => {
        releaseRevoke = resolve;
      });

      // Hand-built, barrier-controlled equivalent of revokeGovernanceGrant's
      // write path (governance grant lookup omitted — not needed to prove
      // this point) — deliberately not the exported function, which has no
      // injectable pause point. Locks and writes match grants.ts's revoke
      // path exactly; only the `await barrier` is test-only.
      const revokePromise = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('steadfast.ai_coach.governance_grants'))::text`;
        const rootGrant = await requireGovernanceGrant(root.id, "CONTROL_OPERATIONS", tx);
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "AiCoachGovernanceGrant" WHERE "userId" = ${actor.id} FOR UPDATE`;
        const existing = await tx.aiCoachGovernanceGrant.findUniqueOrThrow({
          where: { userId: actor.id },
        });
        const grant = await tx.aiCoachGovernanceGrant.update({
          where: { userId: actor.id },
          data: { revokedAt: new Date() },
        });
        await tx.aiCoachAccessGrantEvent.create({
          data: {
            actorUserId: root.id,
            subjectUserId: actor.id,
            governanceGrantId: rootGrant.id,
            grantType: "GOVERNANCE",
            action: "REVOKE",
            grantRecordId: grant.id,
            scopes: existing.scopes,
            actorRef: "Human",
            reasonCode: "BARRIER_TEST_REVOKE",
          },
        });
        // Writes are made but this transaction is deliberately held open —
        // uncommitted, locks still held — until the barrier releases.
        await barrier;
        return grant;
      });

      // Let the revoke reach and pass the barrier-holding point before
      // starting the real grant attempt.
      await new Promise((resolve) => setTimeout(resolve, 100));

      const entitlementSettled = grantClientEntitlement({
        actorUserId: actor.id,
        clientId: client.id,
        expiresAt: null,
        actorRef: "Human",
        reasonCode: "BARRIER_TEST_GRANT",
      }).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason })
      );

      // Give the grant attempt time to either block on the actor's `User`
      // row (fixed) or run all the way to its own implicit-FK wait point
      // (unfixed) before the revoke is allowed to commit.
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseRevoke();

      const [entitlementResult] = await Promise.all([entitlementSettled, revokePromise]);

      const actorGrantRow = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: actor.id },
      });
      expect(actorGrantRow.revokedAt).not.toBeNull();

      // The one invariant the fix exists to guarantee: an entitlement grant
      // whose authorization read could only have happened while the revoke
      // was provably still uncommitted must never still succeed once that
      // revoke has committed.
      expect(entitlementResult.status).toBe("rejected");
      if (entitlementResult.status === "rejected") {
        expect(entitlementResult.reason).toMatchObject({ code: "FORBIDDEN" });
      }
      expect(await db.aiCoachEntitlement.findUnique({ where: { clientId: client.id } })).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("a revoked grant fails every consumer", () => {
    it("GOVERNANCE: requireGovernanceGrant, monitoring, operational control, artifact publish and activation all throw", async () => {
      const root = await controlActor();
      const actor = await makeUser({ isClient: false, isCoach: true });
      await db.aiCoachGovernanceGrant.create({
        data: { userId: actor.id, scopes: [...GOVERNANCE_SCOPES], grantRef: "fixture" },
      });
      await revokeGovernanceGrant({
        actorUserId: root.id,
        userId: actor.id,
        actorRef: "Human",
        reasonCode: "TEST_REVOKE",
      });

      for (const scope of GOVERNANCE_SCOPES) {
        await expect(requireGovernanceGrant(actor.id, scope)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
      await expect(getAiCoachOperationalMonitoring(actor.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        setAiCoachOperationalControl(actor.id, {
          scope: "GENERATION",
          disabled: true,
          reasonCode: "test",
          incidentReference: null,
          expectedRevision: null,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        publishArtifactVersion({
          id: `nonexistent-artifact-${randomUUID()}`,
          effectiveAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 86_400_000),
          engineVersion: "ai-coach-artifact-engine-v1",
          governance: { actorUserId: actor.id, reasonCode: "test" },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        activateAiCoachLiveRelease({
          packetId: `nonexistent-packet-${randomUUID()}`,
          actorUserId: actor.id,
          signedActivationRef: "ref",
          reasonCode: "test",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("REVIEWER: getReviewerQueue, getReviewerOperations and resolveAiSafety all throw FORBIDDEN", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const reviewer = await makeUser({ isClient: false, isCoach: true });
        const client = await aiClient({ synthetic: true, context: "AI" });
        await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
        await grantReviewerGrant({
          actorUserId: root.id,
          userId: reviewer.id,
          clientIds: [client.id],
          domains: ["NUTRITION", "STRENGTH", "CARDIO"],
          qualificationNote: "Registered dietitian, license 123",
          actorRef: "Human",
          reasonCode: "TEST_GRANT",
        });
        await revokeReviewerGrant({
          actorUserId: root.id,
          userId: reviewer.id,
          actorRef: "Human",
          reasonCode: "TEST_REVOKE",
        });

        await expect(getReviewerQueue(reviewer.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(getReviewerOperations(reviewer.id)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          resolveAiSafety(reviewer.id, {
            requestKey: randomUUID(),
            clientId: client.id,
            expectedSafetyRevision: 0,
            domains: ["NUTRITION"],
            reviewReference: "ref",
            rationale: "Rationale text, long enough to pass validation.",
            confirmed: true,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("ENTITLEMENT: lockAiClient throws ENTITLEMENT_REQUIRED and getClientProvider(...).aiDiscovery is null", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const client = await aiClient({ synthetic: true, context: "AI" });
        await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST_GRANT",
        });
        await revokeClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          actorRef: "Human",
          reasonCode: "TEST_REVOKE",
        });

        await expect(db.$transaction((tx) => lockAiClient(tx, client.id))).rejects.toMatchObject({
          code: "ENTITLEMENT_REQUIRED",
        });
        const provider = await getClientProvider(client.id);
        expect(provider.aiDiscovery).toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("entitlement written by the CLI passes lockAiClient unchanged", async () => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    try {
      const root = await controlActor();
      const client = await aiClient({ synthetic: true, context: "AI" });
      const granted = await grantClientEntitlement({
        actorUserId: root.id,
        clientId: client.id,
        expiresAt: null,
        actorRef: "Human",
        reasonCode: "TEST_GRANT",
      });
      const locked = await db.$transaction((tx) => lockAiClient(tx, client.id));
      expect(locked.profile.clientId).toBe(client.id);
      const entitlementRow = await db.aiCoachEntitlement.findUniqueOrThrow({
        where: { clientId: client.id },
      });
      expect(entitlementRow.id).toBe(granted.grantRecordId);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("entitlement written by the CLI passes lockAiClient unchanged — non-synthetic profile with an ACTIVE release (T-995 r2 MINOR 5)", async () => {
    // The fixture-shape test above only exercises requireFixtureRuntime();
    // this is the branch the first real client actually takes: a
    // non-synthetic profile, an ACTIVE ready release, and lockAiClient
    // re-asserting that same release inside its own transaction. Setup
    // mirrors tests/integration/ai-coach-live-launch-readiness.test.ts's
    // "accepts only the complete draft -> approve -> activate -> ..." case.
    const root = await controlActor();
    const suffix = randomUUID();
    const artifacts = buildNonSyntheticLaunchTestArtifacts(suffix);
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 3_600_000);
    for (const artifact of artifacts.leaves) {
      await registerArtifactVersion(artifact);
      await publishArtifactVersion({
        id: artifact.id,
        effectiveAt,
        expiresAt,
        engineVersion: "ai-coach-artifact-engine-v1",
      });
    }
    await registerArtifactVersion(artifacts.policy);
    await publishArtifactVersion({
      id: artifacts.policy.id,
      effectiveAt,
      expiresAt,
      engineVersion: "ai-coach-artifact-engine-v1",
    });
    const packet = completeNonTestLaunchPacket({ suffix, artifactBindings: artifacts.references });
    await registerLiveLaunchPacket(packet);
    // activate/deactivate both upsert all five AiCoachOperationalControl
    // scopes as a global side effect (the kill switch), so this snapshot +
    // restore is required to avoid leaking `disabled: true` into every test
    // — in this file or any other — that runs afterward in the same
    // database and depends on ARTIFACT_PUBLICATION being enabled (e.g.
    // ai-coach-live-launch-readiness.test.ts's own approveLiveLaunchPacket
    // calls). Found by a real cross-file failure, not by inspection.
    const OPERATIONAL_SCOPES = [
      "GENERATION",
      "PROVIDER",
      "FINALIZATION",
      "ACCEPTANCE",
      "ARTIFACT_PUBLICATION",
    ] as const;
    const priorControls = await db.aiCoachOperationalControl.findMany({
      where: { scope: { in: [...OPERATIONAL_SCOPES] } },
    });
    await approveLiveLaunchPacket({
      packetId: packet.packetId,
      actorUserId: root.id,
      effectiveAt,
      expiresAt,
      reasonCode: "T995_R2_TEST_APPROVAL",
      signedApprovalIndexRef: "t995-r2-test-signed-approval-index",
    });
    await activateAiCoachLiveRelease({
      packetId: packet.packetId,
      actorUserId: root.id,
      signedActivationRef: "t995-r2-test-signed-activation",
      reasonCode: "T995_R2_TEST_ACTIVATION",
    });
    try {
      const client = await aiClient({ synthetic: false, context: "AI" });
      const granted = await grantClientEntitlement({
        actorUserId: root.id,
        clientId: client.id,
        expiresAt: null,
        actorRef: "Human",
        reasonCode: "TEST_GRANT",
      });
      const locked = await db.$transaction((tx) => lockAiClient(tx, client.id));
      expect(locked.profile.clientId).toBe(client.id);
      expect(locked.liveRelease).toMatchObject({ packetId: packet.packetId });
      const entitlementRow = await db.aiCoachEntitlement.findUniqueOrThrow({
        where: { clientId: client.id },
      });
      expect(entitlementRow.id).toBe(granted.grantRecordId);
    } finally {
      await deactivateAiCoachLiveRelease({
        actorUserId: root.id,
        signedActivationRef: "t995-r2-test-signed-deactivation",
        reasonCode: "T995_R2_TEST_ROLLBACK",
        reason: "T-995 r2 test cleanup.",
      });
      // Restore every scope's control row to exactly what this test found —
      // update it back if a row already existed, delete it if it did not
      // (mirrors account-deletion.test.ts's MINOR 5 handling of this same
      // global singleton table).
      const priorByScope = new Map(priorControls.map((c) => [c.scope, c]));
      for (const scope of OPERATIONAL_SCOPES) {
        const prior = priorByScope.get(scope);
        if (prior) {
          await db.aiCoachOperationalControl.update({
            where: { scope },
            data: {
              disabled: prior.disabled,
              reasonCode: prior.reasonCode,
              incidentReference: prior.incidentReference,
              updatedByGrantId: prior.updatedByGrantId,
              revision: prior.revision,
            },
          });
        } else {
          await db.aiCoachOperationalControl.deleteMany({ where: { scope } });
        }
      }
    }
  });

  describe("entitlement refusal matrix (rows 5, 6, 15-18)", () => {
    it("refuses a non-synthetic profile with no active live release (row 17)", async () => {
      const root = await controlActor();
      const client = await aiClient({ synthetic: false, context: "AI" });
      await expect(
        grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "LIVE_ACTIVATION_MISSING" });
    });

    it("refuses a synthetic profile outside fixture mode (row 16)", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "false");
      try {
        const root = await controlActor();
        const client = await aiClient({ synthetic: true, context: "AI" });
        await expect(
          grantClientEntitlement({
            actorUserId: root.id,
            clientId: client.id,
            expiresAt: null,
            actorRef: "Human",
            reasonCode: "TEST",
          })
        ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("refuses HUMAN mode and resolutionRequired (row 18)", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const humanClient = await aiClient({ synthetic: true, context: "HUMAN" });
        await expect(
          grantClientEntitlement({
            actorUserId: root.id,
            clientId: humanClient.id,
            expiresAt: null,
            actorRef: "Human",
            reasonCode: "TEST",
          })
        ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

        const resolutionClient = await aiClient({
          synthetic: true,
          context: "AI",
          resolutionRequired: true,
        });
        await expect(
          grantClientEntitlement({
            actorUserId: root.id,
            clientId: resolutionClient.id,
            expiresAt: null,
            actorRef: "Human",
            reasonCode: "TEST",
          })
        ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("refuses a missing profile (row 15)", async () => {
      const root = await controlActor();
      const client = await makeUser();
      await expect(
        grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses isClient:false and isDeactivated (rows 5, 6)", async () => {
      const root = await controlActor();
      const notClient = await makeUser({ isClient: false });
      await expect(
        grantClientEntitlement({
          actorUserId: root.id,
          clientId: notClient.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const deactivated = await makeUser({ isDeactivated: true });
      await expect(
        grantClientEntitlement({
          actorUserId: root.id,
          clientId: deactivated.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("reviewer grant refusal matrix (rows 12, 13)", () => {
    it("refuses self-review", async () => {
      const root = await controlActor();
      const reviewer = await makeUser({ isClient: false, isCoach: true });
      await expect(
        grantReviewerGrant({
          actorUserId: root.id,
          userId: reviewer.id,
          clientIds: [reviewer.id],
          domains: ["NUTRITION"],
          qualificationNote: "Registered dietitian",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses a HUMAN context", async () => {
      const root = await controlActor();
      const reviewer = await makeUser({ isClient: false, isCoach: true });
      const client = await aiClient({ context: "HUMAN" });
      await expect(
        grantReviewerGrant({
          actorUserId: root.id,
          userId: reviewer.id,
          clientIds: [client.id],
          domains: ["NUTRITION"],
          qualificationNote: "Registered dietitian",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    });

    it("refuses resolutionRequired regardless of mode", async () => {
      const root = await controlActor();
      const reviewer = await makeUser({ isClient: false, isCoach: true });
      const client = await aiClient({ context: "AI", resolutionRequired: true });
      await expect(
        grantReviewerGrant({
          actorUserId: root.id,
          userId: reviewer.id,
          clientIds: [client.id],
          domains: ["NUTRITION"],
          qualificationNote: "Registered dietitian",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    });

    // T-995 r2 MAJOR 2 — relaxed from "refuses a client with no context" to a
    // success case: row 13 as originally frozen refused any client whose
    // mode !== "AI", but no real (non-synthetic) client can reach mode "AI"
    // before T-2000 (ENROLL still calls requireReviewerCapacity, which itself
    // requires a reviewer grant to already exist), a deadlock for the exact
    // "first real client" scenario the ticket exists to unblock. A NONE-mode
    // client — including one with no ClientCoachingContext row at all — is
    // harmless to name pre-enrollment: no reviewer consumer reads anything
    // for a client before it has a PROPOSED plan or a safety disposition.
    it("succeeds for a NONE-mode client, including one with no ClientCoachingContext row at all", async () => {
      const root = await controlActor();
      const reviewerNoRow = await makeUser({ isClient: false, isCoach: true });
      const clientNoRow = await makeUser();
      const grantedNoRow = await grantReviewerGrant({
        actorUserId: root.id,
        userId: reviewerNoRow.id,
        clientIds: [clientNoRow.id],
        domains: ["NUTRITION"],
        qualificationNote: "Registered dietitian",
        actorRef: "Human",
        reasonCode: "TEST",
      });
      expect(grantedNoRow.clientIds).toEqual([clientNoRow.id]);

      const reviewerExplicitNone = await makeUser({ isClient: false, isCoach: true });
      const clientExplicitNone = await aiClient({ context: "NONE" });
      const grantedExplicitNone = await grantReviewerGrant({
        actorUserId: root.id,
        userId: reviewerExplicitNone.id,
        clientIds: [clientExplicitNone.id],
        domains: ["NUTRITION"],
        qualificationNote: "Registered dietitian",
        actorRef: "Human",
        reasonCode: "TEST",
      });
      expect(grantedExplicitNone.clientIds).toEqual([clientExplicitNone.id]);
    });
  });

  it("grant-entitlement succeeds with zero AiCoachReviewerGrant rows anywhere (T-2000 invariant)", async () => {
    // Scoped to this test only: snapshot every existing reviewer grant (and
    // any approval rows FK'd to them, which would otherwise block deletion),
    // clear the table, run the assertion, then restore exactly what was
    // found. Same disposable-local-DB reasoning as the bootstrap block above.
    const priorGrants = await db.aiCoachReviewerGrant.findMany();
    const priorApprovals = priorGrants.length
      ? await db.aiPlanReviewerApproval.findMany({
          where: { reviewerGrantId: { in: priorGrants.map((g) => g.id) } },
        })
      : [];
    if (priorApprovals.length) {
      await db.aiPlanReviewerApproval.deleteMany({
        where: { id: { in: priorApprovals.map((a) => a.id) } },
      });
    }
    if (priorGrants.length) await db.aiCoachReviewerGrant.deleteMany();
    try {
      expect(await db.aiCoachReviewerGrant.count()).toBe(0);
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const client = await aiClient({ synthetic: true, context: "AI" });
        await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        });
        expect(await db.aiCoachReviewerGrant.count()).toBe(0);
        const locked = await db.$transaction((tx) => lockAiClient(tx, client.id));
        expect(locked.profile.clientId).toBe(client.id);
      } finally {
        vi.unstubAllEnvs();
      }
    } finally {
      await db.aiCoachReviewerGrant.deleteMany();
      if (priorGrants.length) await db.aiCoachReviewerGrant.createMany({ data: priorGrants });
      if (priorApprovals.length) {
        await db.aiPlanReviewerApproval.createMany({ data: priorApprovals });
      }
    }
  });

  describe("ALREADY_GRANTED and re-activation in place (unique subject columns)", () => {
    it("GOVERNANCE", async () => {
      const root = await controlActor();
      const subject = await makeUser({ isClient: false, isCoach: true });
      await grantGovernanceGrant({
        actorUserId: root.id,
        userId: subject.id,
        scopes: ["PUBLISH_ARTIFACTS"],
        grantRef: "ref-1",
        actorRef: "Human",
        reasonCode: "TEST",
      });
      await expect(
        grantGovernanceGrant({
          actorUserId: root.id,
          userId: subject.id,
          scopes: ["REVOKE_ARTIFACTS"],
          grantRef: "ref-2",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "ALREADY_GRANTED", status: 409 });
      const before = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: subject.id },
      });
      await revokeGovernanceGrant({
        actorUserId: root.id,
        userId: subject.id,
        actorRef: "Human",
        reasonCode: "TEST",
      });
      await grantGovernanceGrant({
        actorUserId: root.id,
        userId: subject.id,
        scopes: ["REVOKE_ARTIFACTS"],
        grantRef: "ref-3",
        actorRef: "Human",
        reasonCode: "TEST",
      });
      const after = await db.aiCoachGovernanceGrant.findUniqueOrThrow({
        where: { userId: subject.id },
      });
      expect(after.id).toBe(before.id);
      expect(after.revokedAt).toBeNull();
      expect(after.scopes).toEqual(["REVOKE_ARTIFACTS"]);
      expect(await db.aiCoachGovernanceGrant.count({ where: { userId: subject.id } })).toBe(1);
    });

    it("REVIEWER", async () => {
      const root = await controlActor();
      const reviewer = await makeUser({ isClient: false, isCoach: true });
      const client = await aiClient({ context: "AI" });
      await grantReviewerGrant({
        actorUserId: root.id,
        userId: reviewer.id,
        clientIds: [client.id],
        domains: ["NUTRITION"],
        qualificationNote: "RD 1",
        actorRef: "Human",
        reasonCode: "TEST",
      });
      await expect(
        grantReviewerGrant({
          actorUserId: root.id,
          userId: reviewer.id,
          clientIds: [client.id],
          domains: ["STRENGTH"],
          qualificationNote: "RD 2",
          actorRef: "Human",
          reasonCode: "TEST",
        })
      ).rejects.toMatchObject({ code: "ALREADY_GRANTED" });
      const before = await db.aiCoachReviewerGrant.findUniqueOrThrow({
        where: { userId: reviewer.id },
      });
      await revokeReviewerGrant({
        actorUserId: root.id,
        userId: reviewer.id,
        actorRef: "Human",
        reasonCode: "TEST",
      });
      await grantReviewerGrant({
        actorUserId: root.id,
        userId: reviewer.id,
        clientIds: [client.id],
        domains: ["STRENGTH"],
        qualificationNote: "RD 2",
        actorRef: "Human",
        reasonCode: "TEST",
      });
      const after = await db.aiCoachReviewerGrant.findUniqueOrThrow({
        where: { userId: reviewer.id },
      });
      expect(after.id).toBe(before.id);
      expect(after.revokedAt).toBeNull();
      expect(after.domains).toEqual(["STRENGTH"]);
      expect(await db.aiCoachReviewerGrant.count({ where: { userId: reviewer.id } })).toBe(1);
    });

    it("ENTITLEMENT", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const client = await aiClient({ synthetic: true, context: "AI" });
        await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        });
        await expect(
          grantClientEntitlement({
            actorUserId: root.id,
            clientId: client.id,
            expiresAt: null,
            actorRef: "Human",
            reasonCode: "TEST",
          })
        ).rejects.toMatchObject({ code: "ALREADY_GRANTED" });
        const before = await db.aiCoachEntitlement.findUniqueOrThrow({
          where: { clientId: client.id },
        });
        await revokeClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          actorRef: "Human",
          reasonCode: "TEST",
        });
        await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST",
        });
        const after = await db.aiCoachEntitlement.findUniqueOrThrow({
          where: { clientId: client.id },
        });
        expect(after.id).toBe(before.id);
        expect(after.revokedAt).toBeNull();
        expect(await db.aiCoachEntitlement.count({ where: { clientId: client.id } })).toBe(1);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    // T-995 r2 MINOR 6 — deliberate, now-documented deviation from refusal
    // row 9 as originally frozen ("grant-* refuses when a non-revoked row
    // exists"): an expired-but-not-revoked entitlement is treated as
    // inactive, matching access.ts/client-provider.ts, and re-activated in
    // place rather than refused with ALREADY_GRANTED.
    it("ENTITLEMENT after expiry re-activates in place", async () => {
      vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
      try {
        const root = await controlActor();
        const client = await aiClient({ synthetic: true, context: "AI" });
        const firstGrant = await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          actorRef: "Human",
          reasonCode: "TEST",
        });
        // Simulate the grant having since expired, without revoking it —
        // the row must still read as non-revoked (revokedAt stays null).
        await db.aiCoachEntitlement.update({
          where: { clientId: client.id },
          data: { expiresAt: new Date(Date.now() - 1000 * 60 * 60) },
        });
        const before = await db.aiCoachEntitlement.findUniqueOrThrow({
          where: { clientId: client.id },
        });
        expect(before.revokedAt).toBeNull();

        const secondGrant = await grantClientEntitlement({
          actorUserId: root.id,
          clientId: client.id,
          expiresAt: null,
          actorRef: "Human",
          reasonCode: "TEST_REACTIVATE",
        });
        const after = await db.aiCoachEntitlement.findUniqueOrThrow({
          where: { clientId: client.id },
        });
        expect(after.id).toBe(before.id);
        expect(after.id).toBe(firstGrant.grantRecordId);
        expect(after.id).toBe(secondGrant.grantRecordId);
        expect(after.expiresAt).toBeNull();
        expect(after.revokedAt).toBeNull();
        expect(await db.aiCoachEntitlement.count({ where: { clientId: client.id } })).toBe(1);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
