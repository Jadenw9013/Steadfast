import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, randomInt } from "crypto";

/**
 * T-980 — the intake send paths resolved a lead's email address by a phone
 * number *substring* (`phoneNumber: { contains: last10 }`, `findFirst`, no
 * ordering). Any account whose stored number merely ended in the same ten
 * digits was treated as the prospect: the coach's intake packet / forms link
 * was emailed to that stranger, and the stranger's email was written into
 * the lead's `prospectEmailAddr`, so every later send went to them too.
 *
 * CB01 (e654a4c) removed the same matcher from lib/activation.ts and
 * app/actions/coaching-requests.ts. These tests prove the intake copy is
 * gone too: with only a phone number on the lead, every intake send path
 * fails closed (no email sent, no address written). The exact-identity
 * tiers (`prospectEmailAddr`, an email-shaped `prospectEmail`, the linked
 * `prospectId` user) keep working.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("@/lib/email/sendEmail", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";
import { sendIntakePacket, sendFormsForSignature, resendFormsLink } from "@/app/actions/intake";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: never run against a production database.
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

suite("T-980: intake prospect email never resolves by phone substring", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockClear();
    vi.mocked(sendEmail).mockResolvedValue({ success: true } as never);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  /** A fresh ten-digit number per test so repeated runs never share a match. */
  function tenDigits(): string {
    return `${randomInt(200, 999)}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  }

  async function makeCoach() {
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `coach-${id}@example.test`, isCoach: true, firstName: "Coach" },
    });
    const profile = await db.coachProfile.create({ data: { userId: user.id, slug: `coach-${id}` } });
    mocks.authUserId = user.clerkId;
    return { user, profile };
  }

  /** An unrelated account whose stored number ends in the same ten digits. */
  async function makeStranger(phone10: string) {
    const id = randomUUID();
    return db.user.create({
      data: {
        clerkId: id,
        email: `stranger-${id}@example.test`,
        isClient: true,
        phoneNumber: `+1${phone10}`,
      },
    });
  }

  async function makePhoneOnlyLead(coachProfileId: string, phone10: string, consultationStage: string) {
    return db.coachingRequest.create({
      data: {
        coachProfileId,
        prospectName: "Phone Only",
        prospectEmail: phone10,
        prospectPhone: phone10,
        prospectEmailAddr: null,
        intakeAnswers: {},
        status: "PENDING",
        consultationStage: consultationStage as never,
      },
    });
  }

  async function expectFailedClosed(requestId: string, strangerEmail: string, result: { success: boolean; message?: string }) {
    // The stranger is not emailed and their address is not written into the lead.
    const recipients = vi.mocked(sendEmail).mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients, "intake email went to a phone-substring stranger").not.toContain(strangerEmail);
    const after = await db.coachingRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { prospectEmailAddr: true },
    });
    expect(after.prospectEmailAddr, "stranger's email was backfilled into the lead").toBeNull();
    // Fail closed: nothing sent at all, and the coach is told there is no address.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No email on file/);
  }

  it("sendIntakePacket: a stranger sharing the last 10 digits is neither emailed nor written into the lead", async () => {
    const { profile } = await makeCoach();
    const phone = tenDigits();
    const stranger = await makeStranger(phone);
    const lead = await makePhoneOnlyLead(profile.id, phone, "CONSULTATION_DONE");

    const result = await sendIntakePacket({ requestId: lead.id, documentIds: [] });

    await expectFailedClosed(lead.id, stranger.email!, result);
    const packet = await db.intakePacket.findUnique({ where: { coachingRequestId: lead.id } });
    expect(packet).toBeNull();
  });

  it("sendFormsForSignature: phone-only lead fails closed", async () => {
    const { profile } = await makeCoach();
    const phone = tenDigits();
    const stranger = await makeStranger(phone);
    const lead = await makePhoneOnlyLead(profile.id, phone, "CONSULTATION_DONE");
    await db.clientFormSubmission.create({
      data: { coachingRequestId: lead.id, answers: {}, status: "READY_TO_SEND" },
    });

    const result = await sendFormsForSignature({ requestId: lead.id });

    await expectFailedClosed(lead.id, stranger.email!, result);
  });

  it("resendFormsLink: phone-only lead fails closed", async () => {
    const { profile } = await makeCoach();
    const phone = tenDigits();
    const stranger = await makeStranger(phone);
    const lead = await makePhoneOnlyLead(profile.id, phone, "FORMS_SENT");

    const result = await resendFormsLink({ requestId: lead.id });

    await expectFailedClosed(lead.id, stranger.email!, result);
  });

  it("regression: a lead linked by prospectId still resolves to that exact user and backfills", async () => {
    const { profile } = await makeCoach();
    const phone = tenDigits();
    const id = randomUUID();
    const linked = await db.user.create({
      data: { clerkId: id, email: `linked-${id}@example.test`, isClient: true },
    });
    const lead = await makePhoneOnlyLead(profile.id, phone, "CONSULTATION_DONE");
    await db.coachingRequest.update({ where: { id: lead.id }, data: { prospectId: linked.id } });

    const result = await sendIntakePacket({ requestId: lead.id, documentIds: [] });

    expect(result.success).toBe(true);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual([linked.email]);
    const after = await db.coachingRequest.findUniqueOrThrow({ where: { id: lead.id }, select: { prospectEmailAddr: true } });
    expect(after.prospectEmailAddr).toBe(linked.email);
  });

  it("regression: a lead with prospectEmailAddr still sends to it, even when a phone stranger exists", async () => {
    const { profile } = await makeCoach();
    const phone = tenDigits();
    await makeStranger(phone);
    const lead = await makePhoneOnlyLead(profile.id, phone, "CONSULTATION_DONE");
    await db.coachingRequest.update({ where: { id: lead.id }, data: { prospectEmailAddr: "real.prospect@example.test" } });

    const result = await sendIntakePacket({ requestId: lead.id, documentIds: [] });

    expect(result.success).toBe(true);
    expect(vi.mocked(sendEmail).mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["real.prospect@example.test"]);
  });
});
