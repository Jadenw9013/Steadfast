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

suite("countConsentAmbiguity — S-21 round 2 (MAJOR 1/2/4)", () => {
  afterAll(() => db.$disconnect());

  it("counts exactly the two knowable ambiguity windows across the four row shapes, through the real Prisma query", async () => {
    const before = await countConsentAmbiguity(db);

    // Shape 1 — confirm-only stamp: consentedAt set by the (now-removed)
    // confirmIntake writer, never enrolled, so no receipt exists at all.
    // Counted in `stampedWithNoEnrollmentReceipt`.
    const confirmOnly = await seedClient();
    await db.clientCoachingContext.create({ data: { clientId: confirmOnly.id, mode: "NONE" } });
    await db.aiCoachProfile.update({
      where: { clientId: confirmOnly.id },
      data: { consentedAt: new Date("2026-09-20T00:00:00.000Z") },
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
      after.consentedAtPredatesEarliestReceipt - before.consentedAtPredatesEarliestReceipt
    ).toBe(1);
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
