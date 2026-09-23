import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * T-961 hotfix regression tests.
 *
 * Bug: `createLeadSchema` in app/api/coach/leads/route.ts did not declare
 * `prospectEmailAddr`, so zod stripped the field the iOS app sends and every
 * lead created from iOS was persisted with a null address. `linkOrInviteProspect`
 * only ever read `prospectEmailAddr`, so those leads could never be matched to
 * an existing account or invited by email — they were stuck.
 *
 * These tests must FAIL against 65da78f (the deployed commit this hotfix
 * branches from) and PASS after the fix.
 */

const mocks = vi.hoisted(() => ({ authUserId: "" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
}));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST as createLead } from "@/app/api/coach/leads/route";
import { linkOrInviteProspect } from "@/lib/activation";

const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: never run against a production database.
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;

suite("T-961: lead email hotfix", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeCoach() {
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isCoach: true },
    });
    const profile = await db.coachProfile.create({
      data: { userId: user.id, slug: id },
    });
    return { user, profile };
  }

  it("POST /api/coach/leads persists and echoes prospectEmailAddr sent by the iOS client", async () => {
    const { user, profile } = await makeCoach();
    mocks.authUserId = user.clerkId;

    const req = new NextRequest("https://example.test/api/coach/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospectName: "Jad Shehadeh",
        prospectEmail: "555-0100",
        prospectEmailAddr: "Jad.Shehadeh@Example.com",
      }),
    });

    const response = await createLead(req);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lead.prospectEmailAddr).toBe("jad.shehadeh@example.com");
    // iOS LeadRow declares createdAt and updatedAt non-optional, so the create
    // response must carry both or CreateLeadResponse fails to decode on device.
    expect(typeof body.lead.createdAt).toBe("string");
    expect(typeof body.lead.updatedAt).toBe("string");

    const row = await db.coachingRequest.findUniqueOrThrow({ where: { id: body.lead.id } });
    expect(row.coachProfileId).toBe(profile.id);
    expect(row.prospectEmailAddr).toBe("jad.shehadeh@example.com");
  });

  it("POST /api/coach/leads drops a malformed prospectEmailAddr instead of rejecting the whole lead", async () => {
    const { user } = await makeCoach();
    mocks.authUserId = user.clerkId;

    const req = new NextRequest("https://example.test/api/coach/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prospectName: "Typo Prospect",
        prospectEmail: "555-0101",
        prospectEmailAddr: "not-an-email",
      }),
    });

    const response = await createLead(req);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.lead.prospectEmailAddr).toBeNull();
  });


  it("never links a coach to themselves when their own address is on the lead", async () => {
    // Storing the address the iOS client sends is what makes this reachable
    // from the app: before the fix the field was dropped, so a coach typing
    // their own address could not resolve to their own account.
    const { user, profile } = await makeCoach();
    const lead = await db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName: "Me",
        prospectEmail: "555-0100",
        prospectEmailAddr: user.email,
        intakeAnswers: { goals: "" },
      },
    });

    const result = await linkOrInviteProspect(
      { prospectName: "Me", prospectEmail: "555-0100", prospectPhone: null, prospectEmailAddr: user.email },
      { coachId: user.id, coachFirstName: "Coach" },
      lead.id,
    );

    expect(result.linked).toBe(false);
    const selfLink = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: user.id, clientId: user.id } },
    });
    expect(selfLink).toBeNull();
  });

  it("does not mistake a phone number, a name or a blank contact field for an email", async () => {
    const { user, profile } = await makeCoach();
    for (const contact of ["555-0100", "Jad Shehadeh", " "]) {
      const lead = await db.coachingRequest.create({
        data: {
          coachProfileId: profile.id,
          prospectName: "Jad Shehadeh",
          prospectEmail: contact,
          intakeAnswers: { goals: "" },
        },
      });
      const result = await linkOrInviteProspect(
        { prospectName: "Jad Shehadeh", prospectEmail: contact, prospectPhone: null, prospectEmailAddr: null },
        { coachId: user.id, coachFirstName: "Coach" },
        lead.id,
      );
      // No address on file must never become a link to somebody's account.
      expect(result.linked).toBe(false);
    }
  });


  it("a legacy-column address invites, and never auto-links an existing account (Decision H1)", async () => {
    // H1, recorded 2026-09-23: an address found only in the legacy contact
    // column may be used to SEND an invite, but must never select an existing
    // user and create a CoachClient without that person accepting. This test
    // pins that boundary so a future "helpful" fallback cannot widen it
    // silently. It is an invariant, not a regression: it holds on 65da78f too.
    const { user: coach, profile } = await makeCoach();
    const legacyAddress = `legacy-${randomUUID()}@example.test`.replace(/[0-9]/g, "x");
    const prospect = await db.user.create({
      data: { clerkId: randomUUID(), email: legacyAddress, isClient: true },
    });

    const lead = await db.coachingRequest.create({
      data: {
        coachProfileId: profile.id,
        prospectName: "Legacy Prospect",
        prospectEmail: legacyAddress, // the address lives ONLY here
        prospectEmailAddr: null,
        intakeAnswers: { goals: "" },
      },
    });

    const result = await linkOrInviteProspect(
      {
        prospectName: "Legacy Prospect",
        prospectEmail: legacyAddress,
        prospectPhone: null,
        prospectEmailAddr: null,
      },
      { coachId: coach.id, coachFirstName: "Coach" },
      lead.id,
    );

    // Invited, not linked.
    expect(result.linked).toBe(false);
    const invite = await db.clientInvite.findFirst({
      where: { coachId: coach.id, email: legacyAddress },
    });
    expect(invite).not.toBeNull();

    // The existing account was NOT attached to the coach.
    const link = await db.coachClient.findUnique({
      where: { coachId_clientId: { coachId: coach.id, clientId: prospect.id } },
    });
    expect(link).toBeNull();
  });

});
