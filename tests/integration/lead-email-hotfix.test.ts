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

});
