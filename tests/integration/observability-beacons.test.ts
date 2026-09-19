import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-920 — the three degradation beacons, tested against the exact row shapes
 * of the three production incidents that motivated this ticket:
 *
 *  - T-803 (still live on `main` at the time of writing): a per-week training
 *    read with no cross-week fallback. `getTrainingProgramForReview` must
 *    still return `{ source: "empty", program: null }` unchanged — this
 *    ticket only reports the defect, it does not fix it.
 *  - T-800 (already fixed): a MACROS plan publish rejected as empty while the
 *    row's `items` array has content — the exact shape that let a foods plan
 *    publish and read back as "macros with zero targets".
 *  - T-841 (already fixed): a save whose `planExtras` payload silently omits
 *    keys the stored row has.
 *
 * Every "noise floor" case proves the SAME code path emits nothing for the
 * benign case, so a passing beacon test can never be "it always fires."
 *
 * `lib/observability/sinks.ts`'s only built-in sink writes one line of JSON
 * to `console.error`, so this suite spies on `console.error` and parses each
 * call as JSON, rather than mocking the observability module — that also
 * proves redaction actually ran end-to-end, not just that `reportAnomaly` was
 * called with the right arguments.
 */

import { db } from "@/lib/db";
import { getTrainingProgramForReview } from "@/lib/queries/training-programs";
import { publishTrainingProgramTarget } from "@/lib/training-programs/publish";
import { getMealPlanPublishTarget, publishMealPlanTarget } from "@/lib/meal-plans/publish";
import { getMealPlanSaveTarget, saveMealPlanDraftContent } from "@/lib/meal-plans/drafts";
import { TRAINING_WEEK_EMPTY, MEALPLAN_MODE_DISAGREEMENT, MEALPLAN_SAVE_DROPPED_KEYS } from "@/lib/observability/events";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

const WEEK_A = new Date("2026-03-02T00:00:00Z");
const WEEK_B = new Date("2026-03-09T00:00:00Z");
const WEEK_C = new Date("2026-03-16T00:00:00Z");

suite("observability beacons (T-920) — the three production incidents as code", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  // Every db-method spy created by a test is restored here, not inline at the
  // end of the test body — a failing assertion above an inline
  // `.mockRestore()` would otherwise leave the mock permanently in place
  // (e.g. `groupBy` rejecting forever) and turn one failure into a cascade
  // across the rest of the file.
  let dbSpies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbSpies = [];
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    dbSpies.forEach((spy) => spy.mockRestore());
    dbSpies = [];
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Every JSON-shaped line written to console.error during the test so far. */
  function capturedEvents(): Array<Record<string, unknown>> {
    const calls: unknown[][] = consoleErrorSpy.mock.calls;
    return calls
      .map((call: unknown[]) => call[0])
      .filter((arg: unknown): arg is string => typeof arg === "string")
      .map((line: string) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((parsed: Record<string, unknown> | null): parsed is Record<string, unknown> => parsed !== null);
  }

  function eventsNamed(evt: string): Array<Record<string, unknown>> {
    return capturedEvents().filter((e) => e.evt === evt);
  }

  /** Every raw string console.error was called with, for the PII proof. */
  function allRawLines(): string[] {
    const calls: unknown[][] = consoleErrorSpy.mock.calls;
    return calls.map((call: unknown[]) => String(call[0]));
  }

  async function makeClient() {
    const clerkId = randomUUID();
    return db.user.create({
      data: { clerkId, email: `client-${clerkId}@example.test`, isClient: true },
    });
  }

  // ── Training beacon (T-803) ────────────────────────────────────────────────

  describe("sf.training.week_empty_with_history", () => {
    it("fires when the read week is empty but the client has a program in another week (T-803 reproduction)", async () => {
      const client = await makeClient();
      await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_A, status: "PUBLISHED", publishedAt: new Date() },
      });

      const result = await getTrainingProgramForReview(client.id, WEEK_B);

      // Unchanged behaviour — this ticket reports the defect, T-803 fixes it.
      expect(result).toEqual({ source: "empty", program: null });

      const fired = eventsNamed(TRAINING_WEEK_EMPTY.evt);
      expect(fired).toHaveLength(1);
      expect(fired[0].level).toBe("warning");
      expect(fired[0].ids).toMatchObject({ clientId: client.id });
      expect(fired[0].context).toEqual({
        weeksWithPrograms: 1,
        hasPublished: true,
        hasDraft: false,
      });
    });

    it("reports hasDraft/hasPublished truthfully instead of hardcoded false", async () => {
      const client = await makeClient();
      await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_A, status: "DRAFT" },
      });

      const result = await getTrainingProgramForReview(client.id, WEEK_B);

      expect(result).toEqual({ source: "empty", program: null });
      const fired = eventsNamed(TRAINING_WEEK_EMPTY.evt);
      expect(fired).toHaveLength(1);
      expect(fired[0].context).toEqual({
        weeksWithPrograms: 1,
        hasPublished: false,
        hasDraft: true,
      });
    });

    it("creates a genuine SUPERSEDED row through the real publish path, and does not fire for a past week whose only programs are superseded", async () => {
      const client = await makeClient();

      // WEEK_A publishes first...
      const draftA = await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_A, status: "DRAFT" },
      });
      const publishA = await publishTrainingProgramTarget({
        id: draftA.id,
        clientId: client.id,
        status: "DRAFT",
      });
      expect(publishA.ok).toBe(true);

      // ...then WEEK_B publishes, which (via the real, unfiltered-by-weekOf
      // supersede transaction in lib/training-programs/publish.ts) flips
      // WEEK_A's row to a genuine SUPERSEDED, not one built with `db.create`.
      const draftB = await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_B, status: "DRAFT" },
      });
      const publishB = await publishTrainingProgramTarget({
        id: draftB.id,
        clientId: client.id,
        status: "DRAFT",
      });
      expect(publishB.ok).toBe(true);

      const supersededA = await db.trainingProgram.findUniqueOrThrow({ where: { id: draftA.id } });
      expect(supersededA.status).toBe("SUPERSEDED");

      // Remove the only remaining live program so the client's entire
      // history is superseded rows — the exact state the status filter must
      // not count toward the beacon.
      await db.trainingProgram.delete({ where: { id: draftB.id } });

      const result = await getTrainingProgramForReview(client.id, WEEK_A);

      expect(result).toEqual({ source: "empty", program: null });
      expect(eventsNamed(TRAINING_WEEK_EMPTY.evt)).toHaveLength(0);
    });

    it("BLOCKER regression: a failed status lookup degrades to no beacon, never a rejected read (empty path)", async () => {
      const client = await makeClient();
      // A genuine program in another week means the assertion below actually
      // discriminates: without the `.catch`, this fixture would otherwise
      // fire the beacon, so "zero events" is meaningful, not tautological.
      await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_B, status: "PUBLISHED", publishedAt: new Date() },
      });
      const groupBySpy = vi
        .spyOn(db.trainingProgram, "groupBy")
        .mockRejectedValueOnce(new Error("simulated pool exhaustion"));
      dbSpies.push(groupBySpy);

      const result = await getTrainingProgramForReview(client.id, WEEK_A);

      expect(result).toEqual({ source: "empty", program: null });
      expect(eventsNamed(TRAINING_WEEK_EMPTY.evt)).toHaveLength(0);
    });

    it("does not fire when the client genuinely has no programs at all (noise floor)", async () => {
      const client = await makeClient();
      const countSpy = vi.spyOn(db.trainingProgram, "count");
      dbSpies.push(countSpy);

      const result = await getTrainingProgramForReview(client.id, WEEK_A);

      expect(result).toEqual({ source: "empty", program: null });
      expect(eventsNamed(TRAINING_WEEK_EMPTY.evt)).toHaveLength(0);
      expect(countSpy.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it("regression: a week with a draft and a week with a published program are unchanged and silent", async () => {
      const client = await makeClient();
      const draft = await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_A, status: "DRAFT" },
      });
      const published = await db.trainingProgram.create({
        data: { clientId: client.id, weekOf: WEEK_B, status: "PUBLISHED", publishedAt: new Date() },
      });
      const countSpy = vi.spyOn(db.trainingProgram, "count");
      dbSpies.push(countSpy);

      const draftResult = await getTrainingProgramForReview(client.id, WEEK_A);
      expect(draftResult.source).toBe("draft");
      expect(draftResult.program?.id).toBe(draft.id);

      const publishedResult = await getTrainingProgramForReview(client.id, WEEK_B);
      expect(publishedResult.source).toBe("published");
      expect(publishedResult.program?.id).toBe(published.id);

      // Neither hit branch runs the extra count query, and neither fires.
      expect(countSpy).not.toHaveBeenCalled();
      expect(eventsNamed(TRAINING_WEEK_EMPTY.evt)).toHaveLength(0);
    });
  });

  // ── Meal-plan publish beacon (T-800) ───────────────────────────────────────

  describe("sf.mealplan.mode_payload_disagreement", () => {
    it("fires when a MACROS publish is rejected empty while items has content (T-800 reproduction)", async () => {
      const client = await makeClient();
      const plan = await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: WEEK_A,
          version: 1,
          status: "DRAFT",
          planMode: "MACROS",
          items: {
            create: [
              { mealName: "Meal 1", sortOrder: 0, foodName: "Chicken breast", quantity: "6", unit: "oz" },
              { mealName: "Meal 2", sortOrder: 1, foodName: "White rice", quantity: "1", unit: "cup" },
              { mealName: "Meal 3", sortOrder: 2, foodName: "Broccoli", quantity: "1", unit: "cup" },
            ],
          },
        },
      });

      const target = await getMealPlanPublishTarget(plan.id);
      const result = await publishMealPlanTarget(target!);

      expect(result).toEqual({ ok: false, code: "EMPTY_PLAN", planMode: "MACROS" });

      const fired = eventsNamed(MEALPLAN_MODE_DISAGREEMENT.evt);
      expect(fired).toHaveLength(1);
      expect(fired[0].ids).toMatchObject({ clientId: client.id, planId: plan.id });
      expect(fired[0].context).toEqual({ planMode: "MACROS", itemCount: 3, macroTargetCount: 0 });
    });

    it("does not fire for a genuinely blank plan (noise floor)", async () => {
      const client = await makeClient();
      const plan = await db.mealPlan.create({
        data: { clientId: client.id, weekOf: WEEK_A, version: 1, status: "DRAFT", planMode: "MEAL_PLAN" },
      });

      const target = await getMealPlanPublishTarget(plan.id);
      const result = await publishMealPlanTarget(target!);

      expect(result).toEqual({ ok: false, code: "EMPTY_PLAN", planMode: "MEAL_PLAN" });
      expect(eventsNamed(MEALPLAN_MODE_DISAGREEMENT.evt)).toHaveLength(0);
    });
  });

  // ── Meal-plan save beacon (T-841) ──────────────────────────────────────────

  describe("sf.mealplan.save_dropped_keys", () => {
    const storedPlanExtras = {
      metadata: { coachNotes: "Contact the client directly at alice@example.com re: cutting phase" },
      confidence: { meals: 0.9 },
    };

    it("fires when a save omits a top-level planExtras key the stored row has (T-841 reproduction)", async () => {
      const client = await makeClient();
      const plan = await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: WEEK_C,
          version: 1,
          status: "DRAFT",
          planMode: "MEAL_PLAN",
          planExtras: storedPlanExtras,
          items: { create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Eggs", quantity: "3", unit: "each" }] },
        },
      });

      const target = await getMealPlanSaveTarget(plan.id);
      const savedPlanExtras = { confidence: { meals: 0.9 } };
      await saveMealPlanDraftContent(target!, { planExtras: savedPlanExtras });

      const fired = eventsNamed(MEALPLAN_SAVE_DROPPED_KEYS.evt);
      expect(fired).toHaveLength(1);
      expect(fired[0].ids).toMatchObject({ clientId: client.id, planId: plan.id });
      expect(fired[0].context).toEqual({
        droppedKeys: "metadata",
        droppedCount: 1,
        targetStatus: "DRAFT",
      });

      // Save behaviour itself is unchanged — the row now holds exactly the
      // submitted planExtras.
      const saved = await db.mealPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(saved.planExtras).toEqual(savedPlanExtras);

      // PII proof — the dropped key's own content (a coach note + an email)
      // must never appear anywhere in ANY captured event line, only its name.
      const raw = allRawLines().join("\n");
      expect(raw).not.toContain("alice@example.com");
      expect(raw).not.toContain("Contact the client directly");
    });

    it("does not fire when the save carries every stored key (noise floor)", async () => {
      const client = await makeClient();
      const plan = await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: WEEK_C,
          version: 1,
          status: "DRAFT",
          planMode: "MEAL_PLAN",
          planExtras: storedPlanExtras,
        },
      });

      const target = await getMealPlanSaveTarget(plan.id);
      await saveMealPlanDraftContent(target!, { planExtras: storedPlanExtras });

      expect(eventsNamed(MEALPLAN_SAVE_DROPPED_KEYS.evt)).toHaveLength(0);
    });

    it("masks a stored key outside planExtrasSchema's shape as [unknown], never its literal name", async () => {
      const client = await makeClient();
      // A hostile/legacy stored row: `metadata` is a real schema key, but
      // `secretInternalNote` is not — nothing in planExtrasSchema.shape allows
      // it, so it must never reach a log line under its own name.
      const hostilePlanExtras = {
        metadata: { coachNotes: "keep this" },
        secretInternalNote: "should never be logged by name",
      };
      const plan = await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: WEEK_C,
          version: 1,
          status: "DRAFT",
          planMode: "MEAL_PLAN",
          planExtras: hostilePlanExtras,
        },
      });

      const target = await getMealPlanSaveTarget(plan.id);
      await saveMealPlanDraftContent(target!, { planExtras: {} });

      const fired = eventsNamed(MEALPLAN_SAVE_DROPPED_KEYS.evt);
      expect(fired).toHaveLength(1);
      const droppedKeys = String(fired[0].context && (fired[0].context as Record<string, unknown>).droppedKeys);
      expect(droppedKeys.split(",").sort()).toEqual(["[unknown]", "metadata"]);
      expect(droppedKeys).not.toContain("secretInternalNote");

      const raw = allRawLines().join("\n");
      expect(raw).not.toContain("secretInternalNote");
    });

    it("fires with targetStatus PUBLISHED when the edit forks a new draft off a published plan (CB04)", async () => {
      const client = await makeClient();
      const plan = await db.mealPlan.create({
        data: {
          clientId: client.id,
          weekOf: WEEK_C,
          version: 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
          planMode: "MEAL_PLAN",
          planExtras: storedPlanExtras,
          items: { create: [{ mealName: "Meal 1", sortOrder: 0, foodName: "Eggs", quantity: "3", unit: "each" }] },
        },
      });

      const target = await getMealPlanSaveTarget(plan.id);
      const result = await saveMealPlanDraftContent(target!, { planExtras: { confidence: { meals: 0.9 } } });

      // The fork happened — the published row itself is untouched (CB04).
      expect(result.forkedNewDraftId).toBeDefined();
      const untouched = await db.mealPlan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(untouched.status).toBe("PUBLISHED");
      expect(untouched.planExtras).toEqual(storedPlanExtras);

      const fired = eventsNamed(MEALPLAN_SAVE_DROPPED_KEYS.evt);
      expect(fired).toHaveLength(1);
      expect(fired[0].context).toEqual({
        droppedKeys: "metadata",
        droppedCount: 1,
        targetStatus: "PUBLISHED",
      });
    });
  });
});
