import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  user: { id: "coach", isCoach: true, firstName: "Coach", lastName: "Synthetic" },
  findRequest: vi.fn(), updateRequest: vi.fn(), link: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  coachProfile: { findUnique: async () => ({ id: "profile" }) },
  coachingRequest: { findUnique: mocks.findRequest, update: mocks.updateRequest },
} }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => mocks.user }));
vi.mock("@/lib/activation", () => ({ linkOrInviteProspect: mocks.link }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { approveCoachingRequest, acceptClient, resendInvite } from "@/app/actions/coaching-requests";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.isCoach = true;
  mocks.findRequest.mockResolvedValue({ id: "lead", coachProfileId: "profile", status: "APPROVED", prospectId: "prospect", prospectName: "Synthetic prospect", prospectEmail: "prospect@example.test", prospectEmailAddr: "prospect@example.test" });
  mocks.link.mockResolvedValue({ linked: false, inviteToken: "synthetic", email: "prospect@example.test" });
  mocks.updateRequest.mockResolvedValue({ id: "lead", status: "APPROVED" });
});

describe("real coaching request handoff actions", () => {
  it("resends for a signed-up prospect without assuming a relationship", async () => {
    expect(await resendInvite("lead")).toMatchObject({ success: true });
    expect(mocks.link).toHaveBeenCalledOnce();
    expect(mocks.updateRequest).toHaveBeenCalledWith(expect.objectContaining({ data: { inviteLastSentAt: expect.any(Date), inviteSendCount: { increment: 1 } } }));
  });
  it("reports connected only when the relationship service confirms it", async () => {
    mocks.link.mockResolvedValueOnce({ linked: true, alreadyConnected: true, clientId: "prospect", email: "prospect@example.test" });
    expect(await resendInvite("lead")).toMatchObject({ success: true, message: expect.stringContaining("roster") });
    expect(mocks.updateRequest).not.toHaveBeenCalled();
  });
  it("does not count an invite when no address can receive one", async () => {
    mocks.link.mockResolvedValueOnce({ linked: false, inviteToken: null, email: null, noEmailOnFile: true });
    expect(await resendInvite("lead")).toMatchObject({ success: false });
    expect(mocks.updateRequest).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "REJECTED", "WAITLISTED"])("does not resend a %s request", async status => {
    mocks.findRequest.mockResolvedValueOnce({ id: "lead", coachProfileId: "profile", status });
    expect(await resendInvite("lead")).toMatchObject({ success: false });
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it("rejects another coach's lead", async () => {
    mocks.findRequest.mockResolvedValueOnce({ id: "lead", coachProfileId: "other-profile", status: "APPROVED" });
    await expect(resendInvite("lead")).rejects.toThrow("Request not found");
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it("requires coach capability", async () => {
    mocks.user.isCoach = false;
    await expect(resendInvite("lead")).rejects.toThrow("Unauthorized");
    expect(mocks.findRequest).not.toHaveBeenCalled();
  });
  it.each([approveCoachingRequest, acceptClient])("does not advance a lead if an invite cannot be delivered", async action => {
    mocks.findRequest.mockResolvedValueOnce({ id: "lead", coachProfileId: "profile", status: "PENDING" });
    mocks.link.mockResolvedValueOnce({ linked: false, inviteToken: null, email: null, noEmailOnFile: true });
    await expect(action("lead")).rejects.toThrow(/email/i);
    expect(mocks.updateRequest).not.toHaveBeenCalled();
  });
  it("does not restore email-based automatic relationship creation at sign-up", () => {
    expect(readFileSync("lib/auth/roles.ts", "utf8")).not.toMatch(/coachClient\.create/);
  });
});
