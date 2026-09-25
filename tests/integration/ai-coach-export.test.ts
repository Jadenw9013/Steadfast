import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { exportAiData } from "@/lib/ai-coach/data-export";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
suite("bounded owner-only AI export", () => {
  afterAll(() => db.$disconnect());
  async function user() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isClient: true } });
  }
  it("exports every page without entitlement and excludes other owners", async () => {
    const a = await user();
    const b = await user();
    await db.aiNutritionSafetyDecision.create({
      data: {
        clientId: a.id,
        evaluationKey: "a".repeat(64),
        policyArtifactId: "synthetic-export-policy:v1",
        policyArtifactVersion: 1,
        policyArtifactDigest: "b".repeat(64),
        outcome: "HOLD",
        reasonCodes: ["SYNTHETIC_EXPORT_REASON"],
        ruleIds: ["SYNTHETIC_EXPORT_RULE"],
        escalationTemplateIds: [],
        inputSnapshot: { synthetic: true },
        inputDigest: "c".repeat(64),
        sourcePlanVersionIds: [],
      },
    });
    await db.aiPlanActivationAttempt.create({
      data: {
        clientId: a.id,
        planVersionId: "synthetic-export-plan",
        requestKeyDigest: "d".repeat(64),
        outcome: "REJECTED",
        reasonCode: "SYNTHETIC_EXPORT_REJECTION",
      },
    });
    await db.aiCheckInObservation.createMany({
      data: Array.from({ length: 105 }, (_, i) => ({
        clientId: a.id,
        clientEventId: randomUUID(),
        occurredAt: new Date(),
        payload: { marker: i },
        inputDigest: String(i),
      })),
    });
    await db.aiCheckInObservation.create({
      data: {
        clientId: b.id,
        clientEventId: randomUUID(),
        occurredAt: new Date(),
        payload: { privateMarker: "other-owner" },
        inputDigest: "secret",
      },
    });
    const records = [];
    for await (const row of exportAiData(a.id)) records.push(row);
    expect(records[0]).toMatchObject({
      dataset: "manifest",
      record: {
        exclusions: expect.arrayContaining([
          "Global reviewed policy, catalog, evidence and escalation artifacts",
        ]),
      },
    });
    expect(records.filter((r) => r.dataset === "observations")).toHaveLength(105);
    expect(records.filter((r) => r.dataset === "nutritionSafetyDecisions")).toHaveLength(1);
    expect(records.filter((r) => r.dataset === "planActivationAttempts")).toHaveLength(1);
    expect(records.at(-1)).toMatchObject({
      dataset: "end",
      record: { counts: { observations: 105 } },
    });
    expect(JSON.stringify(records)).not.toContain("other-owner");
  });
  it("stops an in-flight export after deactivation and never claims completion", async () => {
    const a = await user();
    const iterator = exportAiData(a.id);
    expect((await iterator.next()).value).toMatchObject({ dataset: "manifest" });
    await db.user.update({ where: { id: a.id }, data: { isDeactivated: true } });
    await expect(iterator.next()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("honors cancellation before reading personal records", async () => {
    const a = await user();
    const controller = new AbortController();
    controller.abort();
    await expect(exportAiData(a.id, controller.signal).next()).rejects.toThrow("cancelled");
  });
});
