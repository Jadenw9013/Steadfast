import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB08 — missing daily-adherence records were indistinguishable from
 * verified nonadherence, and repeated same-week training sessions
 * collided on (clientId, exerciseName, programDay, setNumber, weekOf),
 * silently overwriting an earlier session's recorded weight/reps.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V05): missing/untracked days never become failed adherence; repeating
 * an exercise twice in one week preserves independent session IDs.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

import { db } from "@/lib/db";
import { getAdherenceSummary } from "@/lib/queries/adherence";
import { saveExerciseResult } from "@/app/actions/exercise-results";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

suite("CB08 — truthful logging with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeCoachClient() {
    const coachClerkId = randomUUID();
    const coach = await db.user.create({ data: { clerkId: coachClerkId, email: `coach-${coachClerkId}@example.test`, isCoach: true, isClient: false } });
    const clientClerkId = randomUUID();
    const client = await db.user.create({ data: { clerkId: clientClerkId, email: `client-${clientClerkId}@example.test`, isCoach: false, isClient: true, timezone: "America/Los_Angeles" } });
    await db.coachClient.create({ data: { coachId: coach.id, clientId: client.id } });
    return { coach, client };
  }

  it("a day with no DailyAdherence record is reported as untracked, not zero/failed", async () => {
    const { client } = await makeCoachClient();
    // No DailyAdherence rows created at all for this client.
    const summary = await getAdherenceSummary(client.id, "2026-03-09", 7);

    expect(summary.today.tracked).toBe(false);
    for (const day of summary.last7Days) {
      expect(day.tracked).toBe(false);
    }
  });

  it("a day with an actual recorded zero is distinguishable from an untracked day", async () => {
    const { client } = await makeCoachClient();
    await db.dailyAdherence.create({
      data: {
        clientId: client.id,
        date: "2026-03-09",
        weekOf: new Date("2026-03-09T00:00:00Z"),
        workoutCompleted: false,
        meals: { create: [{ mealNameSnapshot: "Breakfast", displayOrder: 0, completed: false }] },
      },
    });

    const summary = await getAdherenceSummary(client.id, "2026-03-09", 7);
    const trackedDay = summary.last7Days.find((d) => d.date === "2026-03-09");
    expect(trackedDay?.tracked).toBe(true);
    expect(trackedDay?.mealsTotal).toBe(1);
    expect(trackedDay?.mealsCompleted).toBe(0);

    const untrackedDay = summary.last7Days.find((d) => d.date !== "2026-03-09");
    expect(untrackedDay?.tracked).toBe(false);
  });

  it("logging the same program day twice in one week (e.g. Monday and Thursday) preserves both sessions independently", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;

    // A Monday and a Thursday in the same ISO week.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-09T18:00:00Z")); // Monday
      const first = await saveExerciseResult({ exerciseName: "Incline Press", programDay: "Day 1", setNumber: 1, weight: 100, reps: 8 }) as { id: string };

      vi.setSystemTime(new Date("2026-03-12T18:00:00Z")); // Thursday, same week
      const second = await saveExerciseResult({ exerciseName: "Incline Press", programDay: "Day 1", setNumber: 1, weight: 105, reps: 6 }) as { id: string };

      expect(second.id).not.toBe(first.id);
      const both = await db.exerciseResult.findMany({ where: { clientId: client.id, exerciseName: "Incline Press", programDay: "Day 1", setNumber: 1 } });
      expect(both).toHaveLength(2);
      expect(both.map((r) => r.weight).sort()).toEqual([100, 105]);
      // Both sessions share the same weekOf (still useful for weekly rollups).
      expect(new Set(both.map((r) => r.weekOf.toISOString())).size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("submitting the same program day/set again on the SAME day corrects it in place (not a new row)", async () => {
    const { client } = await makeCoachClient();
    mocks.authUserId = client.clerkId;

    const first = await saveExerciseResult({ exerciseName: "Squat", programDay: "Day 2", setNumber: 1, weight: 200, reps: 5 }) as { id: string };
    const corrected = await saveExerciseResult({ exerciseName: "Squat", programDay: "Day 2", setNumber: 1, weight: 205, reps: 5 }) as { id: string };

    expect(corrected.id).toBe(first.id);
    const rows = await db.exerciseResult.findMany({ where: { clientId: client.id, exerciseName: "Squat", programDay: "Day 2" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].weight).toBe(205);
  });
});
