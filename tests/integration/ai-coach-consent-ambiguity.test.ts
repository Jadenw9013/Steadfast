import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { countConsentAmbiguity } from "@/lib/ai-coach/consent-ambiguity";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// This test only creates its own rows and asserts deltas against a snapshot
// taken at the start of each test (never an absolute table-wide count), so
// it tolerates other files' concurrent rows — "shared", not "exclusive".
// See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");

/** A minimal, directly-seeded `AiCoachProviderTransitionReceipt` row — the
 * fields `countConsentAmbiguity` doesn't read are filled with fixed
 * placeholder values; only `clientId` and `createdAt` vary per scenario. */
async function seedReceipt(clientId: string, createdAt: Date) {
  await db.aiCoachProviderTransitionReceipt.create({
    data: {
      clientId,
      fromMode: "NONE",
      fromContextRevision: 0,
      toMode: "AI",
      toContextRevision: 1,
      releaseId: `synthetic-release-${randomUUID()}`,
      runtimeConfigurationDigest: "a".repeat(64),
      discoveryConfigurationId: "synthetic-discovery",
      discoveryConfigurationVersion: 1,
      privacyNoticeVersion: "synthetic-privacy-v1",
      consentTextDigest: "a".repeat(64),
      createdAt,
    },
  });
}

async function seedClient(opts: { isSynthetic?: boolean } = {}) {
  const id = randomUUID();
  const client = await db.user.create({
    data: { clerkId: id, email: `${id}@example.test`, isClient: true },
  });
  await db.aiCoachProfile.create({
    data: { clientId: client.id, isSynthetic: opts.isSynthetic ?? false },
  });
  return client;
}

suite("countConsentAmbiguity — S-21 round 3 (MAJOR 2)", () => {
  afterAll(() => db.$disconnect());

  it("counts exactly the three knowable ambiguity windows across five row shapes, through the real Prisma query", async () => {
    const before = await countConsentAmbiguity(db);

    // Shape 1 — confirm-only stamp, receipt era: consentedAt set by the
    // (now-removed) confirmIntake writer, never enrolled, so no receipt
    // exists at all, and the stamp is on/after RECEIPT_ERA_START
    // (2026-09-23) — every real ENROLL from that date on writes exactly one
    // receipt, so zero receipts here proves this was never a consent
    // decision. Counted in `stampedWithNoEnrollmentReceipt`.
    const confirmOnly = await seedClient();
    await db.clientCoachingContext.create({ data: { clientId: confirmOnly.id, mode: "NONE" } });
    await db.aiCoachProfile.update({
      where: { clientId: confirmOnly.id },
      data: { consentedAt: new Date("2026-09-24T00:00:00.000Z") },
    });

    // Shape 5 — pre-receipt-era stamp, no receipt: consentedAt is set,
    // before RECEIPT_ERA_START, and no receipt exists. Before 2026-09-23
    // (commit 3b9eb3e) ENROLL itself wrote consentedAt with no receipt, no
    // digest check and no synthetic distinction, so this row is
    // indistinguishable from a real pre-era consent — MUST be reported as
    // unclassifiable, never as "never consented".
    const preEraUnclassifiable = await seedClient();
    await db.clientCoachingContext.create({
      data: { clientId: preEraUnclassifiable.id, mode: "NONE" },
    });
    await db.aiCoachProfile.update({
      where: { clientId: preEraUnclassifiable.id },
      data: { consentedAt: new Date("2026-09-15T00:00:00.000Z") },
    });

    // Shape 2 — real enrolment: consentedAt and the receipt's createdAt
    // agree (ENROLL writes both in the same transaction post-S-21 round 2).
    // Counted in neither window.
    const realEnrolment = await seedClient();
    await db.clientCoachingContext.create({ data: { clientId: realEnrolment.id, mode: "AI" } });
    const realConsentedAt = new Date("2026-09-25T00:00:00.000Z");
    await db.aiCoachProfile.update({
      where: { clientId: realEnrolment.id },
      data: { consentedAt: realConsentedAt },
    });
    await seedReceipt(realEnrolment.id, realConsentedAt);

    // Shape 3 — enrolment then paused: PAUSE (and/or a later human-coach
    // reconciliation) moves mode off "AI" without touching `consentedAt` or
    // the receipt (MAJOR 1's point: mode is not the signal). Still has a
    // receipt whose createdAt does not precede consentedAt, so it is
    // counted in neither window, same as shape 2.
    const pausedAfterReal = await seedClient();
    await db.clientCoachingContext.create({ data: { clientId: pausedAfterReal.id, mode: "AI" } });
    const pausedConsentedAt = new Date("2026-09-26T00:00:00.000Z");
    await db.aiCoachProfile.update({
      where: { clientId: pausedAfterReal.id },
      data: { consentedAt: pausedConsentedAt },
    });
    await seedReceipt(pausedAfterReal.id, pausedConsentedAt);
    await db.clientCoachingContext.update({
      where: { clientId: pausedAfterReal.id },
      data: { mode: "HUMAN" },
    });

    // Shape 4 — pre-fix early stamp with a later receipt: round-1 ENROLL
    // preserved confirmIntake's earlier stamp (`?? new Date()`) while still
    // writing a real receipt at the true, later consent moment. Counted in
    // `consentedAtPredatesEarliestReceipt`, not `stampedWithNoEnrollmentReceipt`
    // (it has a receipt — just a later one than the stamp).
    const earlyStampLaterReceipt = await seedClient();
    await db.clientCoachingContext.create({
      data: { clientId: earlyStampLaterReceipt.id, mode: "AI" },
    });
    const earlyConfirmStamp = new Date("2026-09-20T00:00:00.000Z");
    const laterRealReceipt = new Date("2026-09-27T00:00:00.000Z");
    await db.aiCoachProfile.update({
      where: { clientId: earlyStampLaterReceipt.id },
      data: { consentedAt: earlyConfirmStamp },
    });
    await seedReceipt(earlyStampLaterReceipt.id, laterRealReceipt);

    // Control — a synthetic profile that "enrolled" through the fixture
    // branch (consentedAt set, no receipt by design, never by the defect)
    // must not be misreported as ambiguous.
    const synthetic = await seedClient({ isSynthetic: true });
    await db.clientCoachingContext.create({ data: { clientId: synthetic.id, mode: "AI" } });
    await db.aiCoachProfile.update({
      where: { clientId: synthetic.id },
      data: { consentedAt: new Date("2026-09-28T00:00:00.000Z") },
    });

    const after = await countConsentAmbiguity(db);

    expect(after.stampedWithNoEnrollmentReceipt - before.stampedWithNoEnrollmentReceipt).toBe(1);
    expect(
      after.preReceiptEraStampUnclassifiable - before.preReceiptEraStampUnclassifiable
    ).toBe(1);
    expect(
      after.consentedAtPredatesEarliestReceipt - before.consentedAtPredatesEarliestReceipt
    ).toBe(1);
  });

  it("MINOR 3 — a one-second clock-skew tolerance does not misclassify a genuinely fresh, same-transaction enrolment", async () => {
    const before = await countConsentAmbiguity(db);
    const withinTolerance = await seedClient();
    await db.clientCoachingContext.create({ data: { clientId: withinTolerance.id, mode: "AI" } });
    const consentedAt = new Date("2026-10-01T00:00:00.500Z");
    // Receipt's DB-clock timestamp reads 400ms after the app-clock's
    // consentedAt — well within normal same-transaction elapsed time, and
    // under CLOCK_SKEW_TOLERANCE_MS, so this must NOT count as "predates".
    const receiptCreatedAt = new Date("2026-10-01T00:00:00.900Z");
    await db.aiCoachProfile.update({
      where: { clientId: withinTolerance.id },
      data: { consentedAt },
    });
    await seedReceipt(withinTolerance.id, receiptCreatedAt);
    const after = await countConsentAmbiguity(db);
    expect(after).toEqual(before);
  });

  it("is zero-delta when nothing ambiguous is seeded (a confirmed-but-never-consented profile reports neither window)", async () => {
    const before = await countConsentAmbiguity(db);
    const neverConsented = await seedClient();
    await db.clientCoachingContext.create({ data: { clientId: neverConsented.id, mode: "NONE" } });
    // consentedAt stays null — the exact post-fix behaviour this ticket
    // restores for confirmIntake and the run-request fallback.
    const after = await countConsentAmbiguity(db);
    expect(after).toEqual(before);
  });
});
