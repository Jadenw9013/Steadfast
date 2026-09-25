import { describe, expect, it, vi } from "vitest";

// This is a pure input-validation unit test: `lib/ai-coach/grants.ts` runs
// its zod validation synchronously before ever opening a `db.$transaction`,
// so `@/lib/db` is mocked to reject immediately with a distinguishable
// sentinel the moment (and only if) validation passes and the service tries
// to reach the database — no local test DB is required or touched here.
const mocks = vi.hoisted(() => ({
  transactionSentinel: new Error("SENTINEL_TRANSACTION_REACHED_UNIT_TEST"),
}));
vi.mock("@/lib/db", () => ({
  db: { $transaction: () => Promise.reject(mocks.transactionSentinel) },
}));

import {
  bootstrapGovernanceGrant,
  grantGovernanceGrant,
  grantReviewerGrant,
  grantClientEntitlement,
  GOVERNANCE_SCOPES,
} from "@/lib/ai-coach/grants";
import { type GovernanceScope } from "@/lib/ai-coach/operations";
import { AiCoachError } from "@/lib/ai-coach/error";

const validGovernanceInput = {
  actorUserId: "actor-1",
  userId: "subject-1",
  scopes: ["PUBLISH_ARTIFACTS"] as GovernanceScope[],
  grantRef: "signed-grant-ref",
  actorRef: "Named Human, operational owner",
  reasonCode: "TEST_GRANT",
};

const validReviewerInput = {
  actorUserId: "actor-1",
  userId: "reviewer-1",
  clientIds: ["client-1", "client-2"],
  domains: ["NUTRITION", "STRENGTH", "CARDIO"] as ("NUTRITION" | "STRENGTH" | "CARDIO")[],
  qualificationNote: "Registered dietitian, license 12345",
  actorRef: "Named Human, operational owner",
  reasonCode: "TEST_GRANT",
};

const validEntitlementInput = {
  actorUserId: "actor-1",
  clientId: "client-1",
  expiresAt: null as Date | null,
  actorRef: "Named Human, operational owner",
  reasonCode: "TEST_GRANT",
};

async function expectValidationError(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AiCoachError);
  await promise.catch((error: unknown) => {
    expect(error).toBeInstanceOf(AiCoachError);
    expect((error as AiCoachError).code).toBe("VALIDATION_ERROR");
    expect((error as AiCoachError).status).toBe(422);
  });
}

describe("T-995 — AI Coach grant input validation (lib/ai-coach/grants.ts)", () => {
  it("GOVERNANCE_SCOPES contains exactly the eight literals requireGovernanceGrant accepts", () => {
    // requireGovernanceGrant's `scope` parameter type is `GovernanceScope`,
    // derived as `(typeof GOVERNANCE_SCOPES)[number]` in lib/ai-coach/operations.ts
    // — the const and the type cannot drift apart by construction. This
    // assertion guards the *contents* against an accidental add/remove/rename.
    expect([...GOVERNANCE_SCOPES].sort()).toEqual(
      [
        "CONTROL_OPERATIONS",
        "PUBLISH_ARTIFACTS",
        "REVOKE_ARTIFACTS",
        "VIEW_AGGREGATE_MONITORING",
        "APPROVE_LIVE_LAUNCH",
        "REVOKE_LIVE_LAUNCH",
        "ACTIVATE_LIVE_LAUNCH",
        "DEACTIVATE_LIVE_LAUNCH",
      ].sort()
    );
  });

  it("rejects an unknown governance scope", async () => {
    await expectValidationError(
      grantGovernanceGrant({
        ...validGovernanceInput,
        scopes: ["NOT_A_REAL_SCOPE" as GovernanceScope],
      })
    );
  });

  it("rejects an empty scope list", async () => {
    await expectValidationError(grantGovernanceGrant({ ...validGovernanceInput, scopes: [] }));
  });

  it("rejects a duplicate scope", async () => {
    await expectValidationError(
      grantGovernanceGrant({
        ...validGovernanceInput,
        scopes: ["PUBLISH_ARTIFACTS", "PUBLISH_ARTIFACTS"],
      })
    );
  });

  it("rejects a domain outside NUTRITION|STRENGTH|CARDIO", async () => {
    await expectValidationError(
      grantReviewerGrant({
        ...validReviewerInput,
        domains: ["NOT_A_DOMAIN" as "NUTRITION"],
      })
    );
  });

  it("rejects an empty domain list", async () => {
    await expectValidationError(grantReviewerGrant({ ...validReviewerInput, domains: [] }));
  });

  it("rejects empty/whitespace actorRef", async () => {
    await expectValidationError(grantGovernanceGrant({ ...validGovernanceInput, actorRef: "   " }));
  });

  it("rejects actorRef over its 200-char cap", async () => {
    await expectValidationError(
      grantGovernanceGrant({ ...validGovernanceInput, actorRef: "a".repeat(201) })
    );
  });

  it("rejects empty/whitespace reasonCode", async () => {
    await expectValidationError(grantGovernanceGrant({ ...validGovernanceInput, reasonCode: "  " }));
  });

  it("rejects reasonCode over its 120-char cap", async () => {
    await expectValidationError(
      grantGovernanceGrant({ ...validGovernanceInput, reasonCode: "a".repeat(121) })
    );
  });

  it("rejects empty/whitespace grantRef", async () => {
    await expectValidationError(grantGovernanceGrant({ ...validGovernanceInput, grantRef: " " }));
  });

  it("rejects grantRef over its 200-char cap", async () => {
    await expectValidationError(
      grantGovernanceGrant({ ...validGovernanceInput, grantRef: "a".repeat(201) })
    );
  });

  it("rejects empty/whitespace qualificationNote", async () => {
    await expectValidationError(
      grantReviewerGrant({ ...validReviewerInput, qualificationNote: "   " })
    );
  });

  it("rejects qualificationNote over its 2000-char cap", async () => {
    await expectValidationError(
      grantReviewerGrant({ ...validReviewerInput, qualificationNote: "a".repeat(2001) })
    );
  });

  it("rejects duplicate ids in clientIds", async () => {
    await expectValidationError(
      grantReviewerGrant({ ...validReviewerInput, clientIds: ["client-1", "client-1"] })
    );
  });

  it("rejects empty clientIds", async () => {
    await expectValidationError(grantReviewerGrant({ ...validReviewerInput, clientIds: [] }));
  });

  it("rejects --expires-at in the past", async () => {
    await expectValidationError(
      grantClientEntitlement({
        ...validEntitlementInput,
        expiresAt: new Date(Date.now() - 1000 * 60 * 60),
      })
    );
  });

  it("rejects a non-ISO / invalid expiresAt (Invalid Date)", async () => {
    await expectValidationError(
      grantClientEntitlement({
        ...validEntitlementInput,
        expiresAt: new Date("not-a-real-date"),
      })
    );
  });

  it("accepts a future ISO instant for expiresAt (validation passes through to the transaction)", async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24);
    await expect(
      grantClientEntitlement({ ...validEntitlementInput, expiresAt: future })
    ).rejects.toBe(mocks.transactionSentinel);
  });

  it("rejects bootstrap without --confirm-bootstrap (service called with the flag false)", async () => {
    await expect(
      bootstrapGovernanceGrant({
        userId: "owner-1",
        grantRef: "signed-ref",
        actorRef: "Named Human, operational owner",
        reasonCode: "GOVERNANCE_BOOTSTRAP",
        confirmBootstrap: false as unknown as true,
      })
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED", status: 422 });
  });
});
