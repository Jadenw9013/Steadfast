import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-2056 (audit G3 / web D4 + D6) — a coach's account purge must leave each of
 * that coach's clients in a clean provider state, and must not destroy a
 * client's intake answers when the client has another coach.
 *
 * Before the fix, purge deleted the coach's CoachClient rows with raw SQL and
 * never re-reconciled ClientCoachingContext. The FK is ON DELETE SET NULL, so
 * each client was left {mode: HUMAN, activeCoachClientId: null}, which
 * getClientProvider derives into resolutionRequired: every client plan route
 * then answered 409 "Your coaching provider needs resolution." on web and iOS.
 */

const mocks = vi.hoisted(() => ({
  authUserId: "",
  remove: vi.fn(),
  deleteIdentity: vi.fn(),
  billing: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    storage: {
      from: (bucket: string) => ({ remove: (paths: string[]) => mocks.remove(bucket, paths) }),
    },
  }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
  clerkClient: async () => ({
    users: { deleteUser: mocks.deleteIdentity, getUser: async () => ({ imageUrl: null }) },
  }),
}));
vi.mock("@/lib/account-deletion/billing", () => ({ stopAccountBilling: mocks.billing }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/email/sendEmail", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { db } from "@/lib/db";
import { purgeUserAccount } from "@/lib/account-deletion/purge";
import { reconcileCoachingContextForClient } from "@/lib/activation";
import { getClientProvider } from "@/lib/queries/client-provider";
import { GET as clientHome } from "@/app/api/client/home/route";
import { GET as clientMealPlan } from "@/app/api/client/meal-plan/current/route";
import { GET as clientTraining } from "@/app/api/client/training/current/route";
import { GET as intakeCurrent } from "@/app/api/intake/current/route";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

async function user(opts: { coach?: boolean; client?: boolean; deactivated?: boolean } = {}) {
  const id = randomUUID();
  return db.user.create({
    data: {
      clerkId: id,
      email: `${id}@example.test`,
      isCoach: opts.coach ?? false,
      isClient: opts.client ?? false,
      activeRole: opts.coach ? "COACH" : "CLIENT",
      isDeactivated: opts.deactivated ?? false,
    },
  });
}

async function clientReadStatuses(clerkId: string) {
  mocks.authUserId = clerkId;
  const home = await clientHome();
  const mealPlan = await clientMealPlan();
  const training = await clientTraining();
  return { home: home.status, mealPlan: mealPlan.status, training: training.status };
}

suite("coach account purge reconciles each client's provider (T-2056)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.deleteIdentity.mockResolvedValue({});
    mocks.billing.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("leaves a sole-coach client with no coach and a two-coach client with the other coach, never resolutionRequired", async () => {
    const coachA = await user({ coach: true, deactivated: true });
    const coachB = await user({ coach: true });
    const solo = await user({ client: true });
    const shared = await user({ client: true });

    // solo: A is the only coach; the context comes from the real reconcile.
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: solo.id } });
    await reconcileCoachingContextForClient(db, solo.id);
    // shared: A (active) and B. Normal flow refuses a second coach, so this
    // legacy shape is seeded directly: the context points at A.
    const sharedA = await db.coachClient.create({
      data: { coachId: coachA.id, clientId: shared.id },
    });
    const sharedB = await db.coachClient.create({
      data: { coachId: coachB.id, clientId: shared.id },
    });
    await db.clientCoachingContext.create({
      data: { clientId: shared.id, mode: "HUMAN", activeCoachClientId: sharedA.id, revision: 1 },
    });

    // Both clients read normally before the purge.
    expect(await clientReadStatuses(solo.clerkId)).toEqual({ home: 200, mealPlan: 200, training: 200 });
    expect(await clientReadStatuses(shared.clerkId)).toEqual({ home: 200, mealPlan: 200, training: 200 });
    const soloBefore = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: solo.id } });
    const sharedBefore = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: shared.id } });

    await db.accountDeletionRequest.create({
      data: {
        userId: coachA.id,
        roleAtRequest: "COACH",
        status: "PURGING",
        purgeStartedAt: new Date(),
        scheduledPurgeAt: new Date(0),
      },
    });
    await purgeUserAccount(coachA.id);
    expect(await db.user.findUnique({ where: { id: coachA.id } })).toBeNull();

    // Stored context: solo has no coach, shared moved to B. Revision bumped so
    // clients holding the old revision refresh.
    const soloAfter = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: solo.id } });
    expect(soloAfter).toMatchObject({ mode: "NONE", activeCoachClientId: null, resolutionRequired: false });
    expect(soloAfter.revision).toBeGreaterThan(soloBefore.revision);
    const sharedAfter = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: shared.id } });
    expect(sharedAfter).toMatchObject({ mode: "HUMAN", activeCoachClientId: sharedB.id, resolutionRequired: false });
    expect(sharedAfter.revision).toBeGreaterThan(sharedBefore.revision);

    // Derived provider (the authority every client read uses).
    expect(await getClientProvider(solo.id)).toMatchObject({
      origin: "NONE",
      resolutionRequired: false,
      coachId: null,
    });
    expect(await getClientProvider(shared.id)).toMatchObject({
      origin: "HUMAN",
      resolutionRequired: false,
      coachId: coachB.id,
      activeCoachClientId: sharedB.id,
    });

    // The REST reads iOS uses (and the web pages share the provider) do not 409.
    expect(await clientReadStatuses(solo.clerkId)).toEqual({ home: 200, mealPlan: 200, training: 200 });
    expect(await clientReadStatuses(shared.clerkId)).toEqual({ home: 200, mealPlan: 200, training: 200 });
    mocks.authUserId = shared.clerkId;
    const home = await (await clientHome()).json();
    expect(home.coachAssignment.coach.id).toBe(coachB.id);
    mocks.authUserId = solo.clerkId;
    expect((await (await clientHome()).json()).coachAssignment).toBeNull();
  });

  it("re-homes a client's intake to their remaining coach instead of deleting it (D6)", async () => {
    const coachA = await user({ coach: true, deactivated: true });
    const coachB = await user({ coach: true });
    const moved = await user({ client: true });
    const solo = await user({ client: true });

    // moved: A sent the intake, then the client moved to B (A's row is gone).
    await db.clientIntake.create({
      data: {
        coachId: coachA.id,
        clientId: moved.id,
        status: "COMPLETED",
        completedAt: new Date(),
        primaryGoal: "Keep this answer",
        bodyweightLbs: 170,
      },
    });
    await db.coachClient.create({ data: { coachId: coachB.id, clientId: moved.id } });
    await reconcileCoachingContextForClient(db, moved.id);
    // solo: A sent the intake and is still the only coach.
    await db.clientIntake.create({
      data: { coachId: coachA.id, clientId: solo.id, status: "COMPLETED", primaryGoal: "Solo" },
    });
    await db.coachClient.create({ data: { coachId: coachA.id, clientId: solo.id } });
    await reconcileCoachingContextForClient(db, solo.id);

    await db.accountDeletionRequest.create({
      data: {
        userId: coachA.id,
        roleAtRequest: "COACH",
        status: "PURGING",
        purgeStartedAt: new Date(),
        scheduledPurgeAt: new Date(0),
      },
    });
    await purgeUserAccount(coachA.id);

    const kept = await db.clientIntake.findUnique({ where: { clientId: moved.id } });
    expect(kept).toMatchObject({
      coachId: coachB.id,
      status: "COMPLETED",
      primaryGoal: "Keep this answer",
      bodyweightLbs: 170,
    });
    // T-2060 (decision 6): no other coach to re-home to, so the COMPLETED
    // intake stays with the client, coachId NULL (it used to be deleted).
    expect(await db.clientIntake.findUnique({ where: { clientId: solo.id } })).toMatchObject({
      coachId: null,
      status: "COMPLETED",
      primaryGoal: "Solo",
    });
    expect(await db.user.findUnique({ where: { id: coachA.id } })).toBeNull();
  });

  it("T-2060: sole-coach purge keeps a COMPLETED intake (coachId NULL), deletes unfinished and self intakes; the client still reads it; a later client purge removes it", async () => {
    const coachA = await user({ coach: true, client: true, deactivated: true });
    const completed = await user({ client: true });
    const pending = await user({ client: true });
    const inProgress = await user({ client: true });
    await db.clientIntake.create({
      data: { coachId: coachA.id, clientId: completed.id, status: "COMPLETED", completedAt: new Date(), primaryGoal: "Keep mine", bodyweightLbs: 160 },
    });
    await db.clientIntake.create({ data: { coachId: coachA.id, clientId: pending.id, status: "PENDING" } });
    await db.clientIntake.create({ data: { coachId: coachA.id, clientId: inProgress.id, status: "IN_PROGRESS", startedAt: new Date() } });
    // The coach's own self row (a dual-role coach who sent themself an intake).
    await db.clientIntake.create({ data: { coachId: coachA.id, clientId: coachA.id, status: "COMPLETED" } });
    for (const c of [completed, pending, inProgress]) {
      await db.coachClient.create({ data: { coachId: coachA.id, clientId: c.id } });
      await reconcileCoachingContextForClient(db, c.id);
    }

    await db.accountDeletionRequest.create({
      data: { userId: coachA.id, roleAtRequest: "BOTH", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) },
    });
    await purgeUserAccount(coachA.id);

    expect(await db.clientIntake.findUnique({ where: { clientId: completed.id } })).toMatchObject({
      coachId: null, status: "COMPLETED", primaryGoal: "Keep mine", bodyweightLbs: 160,
    });
    expect(await db.clientIntake.findUnique({ where: { clientId: pending.id } })).toBeNull();
    expect(await db.clientIntake.findUnique({ where: { clientId: inProgress.id } })).toBeNull();
    expect(await db.clientIntake.count({ where: { clientId: coachA.id } })).toBe(0);

    // The coachless client still reads their own answers, and is not prompted.
    mocks.authUserId = completed.clerkId;
    const current = await intakeCurrent();
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ status: "COMPLETED" });
    const home = await clientHome();
    expect(home.status).toBe(200);
    expect((await home.json()).intakeStatus).toBe("COMPLETED");

    // A later purge of that client removes the orphaned intake.
    await db.user.update({ where: { id: completed.id }, data: { isDeactivated: true } });
    await db.accountDeletionRequest.create({
      data: { userId: completed.id, roleAtRequest: "CLIENT", status: "PURGING", purgeStartedAt: new Date(), scheduledPurgeAt: new Date(0) },
    });
    await purgeUserAccount(completed.id);
    expect(await db.clientIntake.count({ where: { clientId: completed.id } })).toBe(0);
  });
});
