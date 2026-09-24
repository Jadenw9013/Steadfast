import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AiCoachOperationalScope } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import {
  assertAiCoachOperationEnabled,
  setAiCoachOperationalControl,
} from "@/lib/ai-coach/operations";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

const scopes: AiCoachOperationalScope[] = [
  "GENERATION",
  "PROVIDER",
  "FINALIZATION",
  "ACCEPTANCE",
  "ARTIFACT_PUBLICATION",
];

suite.sequential("T-1010 isolated kill-switch and rollback drill", () => {
  let actorUserId: string | null = null;

  beforeEach(async () => {
    await db.aiCoachOperationalControl.deleteMany();
    const key = randomUUID();
    const actor = await db.user.create({
      data: { clerkId: key, email: `${key}@example.test`, isCoach: true },
    });
    actorUserId = actor.id;
    await db.aiCoachGovernanceGrant.create({
      data: {
        userId: actor.id,
        scopes: ["CONTROL_OPERATIONS", "VIEW_AGGREGATE_MONITORING"],
        grantRef: "synthetic-t1010-release-drill-v1",
      },
    });
  });

  afterEach(async () => {
    await db.aiCoachOperationalControl.deleteMany();
    if (actorUserId) {
      await db.aiCoachOperationalEvent.deleteMany({ where: { actorUserId } });
      await db.aiCoachGovernanceGrant.deleteMany({ where: { userId: actorUserId } });
      await db.user.deleteMany({ where: { id: actorUserId } });
    }
    actorUserId = null;
  });

  afterAll(() => db.$disconnect());

  it.each(scopes)("disables and restores %s with revision-bound audit evidence", async (scope) => {
    const actor = actorUserId!;
    await expect(assertAiCoachOperationEnabled(scope)).resolves.toBeUndefined();

    const disabled = await setAiCoachOperationalControl(actor, {
      scope,
      disabled: true,
      reasonCode: "SYNTHETIC_KILL_SWITCH_DRILL",
      incidentReference: "synthetic-drill-t1010-v1",
      expectedRevision: null,
    });
    expect(disabled).toMatchObject({ scope, disabled: true, revision: 0 });
    await expect(assertAiCoachOperationEnabled(scope)).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      status: 503,
    });

    await expect(
      setAiCoachOperationalControl(actor, {
        scope,
        disabled: false,
        reasonCode: "SYNTHETIC_ROLLBACK_DRILL_COMPLETE",
        incidentReference: "synthetic-drill-t1010-v1",
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({ scope, disabled: false, revision: 1 });
    await expect(assertAiCoachOperationEnabled(scope)).resolves.toBeUndefined();

    const events = await db.aiCoachOperationalEvent.findMany({
      where: { actorUserId: actor, scope },
      orderBy: { revision: "asc" },
    });
    expect(events).toMatchObject([
      {
        disabled: true,
        reasonCode: "SYNTHETIC_KILL_SWITCH_DRILL",
        incidentReference: "synthetic-drill-t1010-v1",
        revision: 0,
      },
      {
        disabled: false,
        reasonCode: "SYNTHETIC_ROLLBACK_DRILL_COMPLETE",
        incidentReference: "synthetic-drill-t1010-v1",
        revision: 1,
      },
    ]);
    await expect(
      db.aiCoachOperationalEvent.update({
        where: { id: events[0].id },
        data: { reasonCode: "FORGED" },
      })
    ).rejects.toThrow();
  });

  it("rejects stale rollback revisions and stays disabled", async () => {
    const actor = actorUserId!;
    await setAiCoachOperationalControl(actor, {
      scope: "PROVIDER",
      disabled: true,
      reasonCode: "SYNTHETIC_KILL_SWITCH_DRILL",
      incidentReference: "synthetic-drill-t1010-v1",
      expectedRevision: null,
    });
    await expect(
      setAiCoachOperationalControl(actor, {
        scope: "PROVIDER",
        disabled: false,
        reasonCode: "SYNTHETIC_STALE_ROLLBACK",
        incidentReference: "synthetic-drill-t1010-v1",
        expectedRevision: 99,
      })
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(assertAiCoachOperationEnabled("PROVIDER")).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
    });
  });
});
