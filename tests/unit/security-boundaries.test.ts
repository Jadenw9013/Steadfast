import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  block: vi.fn(),
  findUser: vi.fn(),
  auth: vi.fn(),
  findCoachClient: vi.fn(),
  findCheckIn: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    userBlock: { findFirst: mocks.block },
    user: { findUnique: mocks.findUser },
    coachClient: { findUnique: mocks.findCoachClient },
    checkIn: { findUnique: mocks.findCheckIn },
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: vi.fn() }));
import { assertMessagingAllowed } from "@/lib/messages/permissions";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { verifyCoachAccessToClient, verifyCoachAccessToCheckIn } from "@/lib/queries/check-ins";
import { isReminderHour } from "@/lib/scheduling/reminder-time";
import { verifiedPrimaryEmail } from "@/lib/auth/verified-email";
import { readBoundedBody } from "@/lib/security/body";
import { isOwnedUploadPath } from "@/lib/validations/storage-path";

beforeEach(() => vi.resetAllMocks());
describe("cross-client security boundaries", () => {
  it.each(["a", "b"])("rejects blocking in either direction (%s)", async blocker => {
    mocks.block.mockImplementation(({ where }) => where.OR.some((pair: {blockerId: string}) => pair.blockerId === blocker) ? { id: "blocked" } : null);
    await expect(assertMessagingAllowed("a", "b")).rejects.toThrow("can't message");
  });
  it("permits an unblocked relationship", async () => {
    mocks.block.mockResolvedValue(null);
    await expect(assertMessagingAllowed("a", "b")).resolves.toBeUndefined();
  });
  it("fails closed when the block lookup fails", async () => {
    mocks.block.mockRejectedValue(new Error("database unavailable"));
    await expect(assertMessagingAllowed("a", "b")).rejects.toThrow("database unavailable");
  });
  it("denies deactivated accounts except explicit lifecycle access", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_a" });
    mocks.findUser.mockResolvedValue({ id: "a", isDeactivated: true });
    await expect(getCurrentDbUser()).rejects.toThrow("pending deletion");
    await expect(getCurrentDbUser({ allowInactive: true })).resolves.toMatchObject({ id: "a" });
  });
  it("preserves ordinary account access", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_a" });
    mocks.findUser.mockResolvedValue({ id: "a", isDeactivated: false });
    await expect(getCurrentDbUser()).resolves.toMatchObject({ id: "a" });
  });
  it("allows a normal upload owned by this identity", () => {
    expect(isOwnedUploadPath("clerk_a/batch/photo.jpg", "clerk_a")).toBe(true);
  });
  it.each(["clerk_b/batch/photo.jpg", "clerk_a/../photo.jpg", "clerk_a/batch/%2e%2e.jpg", "clerk_a//photo.jpg", "clerk_a/batch/x?y", "clerk_a/batch/..", "clerk_a/batch/\\evil.jpg"])("rejects foreign or ambiguous path %s", path => {
    expect(isOwnedUploadPath(path, "clerk_a")).toBe(false);
  });
});

describe("CB02 — coach ownership helpers reject deactivated accounts", () => {
  it("verifyCoachAccessToClient denies a deactivated coach despite a valid assignment", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_coach" });
    mocks.findUser.mockResolvedValue({ id: "coach-1", isCoach: true, isDeactivated: true });
    mocks.findCoachClient.mockResolvedValue({ id: "assignment-1" });
    await expect(verifyCoachAccessToClient("client-1")).rejects.toThrow("pending deletion");
    // Fencing: assignment lookup must not even be needed to deny access.
    expect(mocks.findCoachClient).not.toHaveBeenCalled();
  });

  it("verifyCoachAccessToCheckIn denies a deactivated coach despite a valid assignment", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_coach" });
    mocks.findUser.mockResolvedValue({ id: "coach-1", isCoach: true, isDeactivated: true });
    mocks.findCheckIn.mockResolvedValue({ clientId: "client-1" });
    mocks.findCoachClient.mockResolvedValue({ id: "assignment-1" });
    await expect(verifyCoachAccessToCheckIn("checkin-1")).rejects.toThrow("pending deletion");
    expect(mocks.findCheckIn).not.toHaveBeenCalled();
  });

  it("verifyCoachAccessToClient allows an active, assigned coach", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_coach" });
    mocks.findUser.mockResolvedValue({ id: "coach-1", isCoach: true, isDeactivated: false });
    mocks.findCoachClient.mockResolvedValue({ id: "assignment-1" });
    await expect(verifyCoachAccessToClient("client-1")).resolves.toMatchObject({ id: "coach-1" });
  });

  it("verifyCoachAccessToClient denies an active coach with no assignment to this client", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_coach" });
    mocks.findUser.mockResolvedValue({ id: "coach-1", isCoach: true, isDeactivated: false });
    mocks.findCoachClient.mockResolvedValue(null);
    await expect(verifyCoachAccessToClient("client-1")).rejects.toThrow("Not assigned");
  });

  it("verifyCoachAccessToClient denies a non-coach account", async () => {
    mocks.auth.mockResolvedValue({ userId: "clerk_client" });
    mocks.findUser.mockResolvedValue({ id: "client-1", isCoach: false, isDeactivated: false });
    await expect(verifyCoachAccessToClient("client-2")).rejects.toThrow("Not a coach");
  });
});

describe("identity and request validation", () => {
  it("uses only the verified primary email", () => {
    expect(verifiedPrimaryEmail([
      { id: "secondary", emailAddress: "someone@example.test", verification: { status: "verified" } },
      { id: "primary", emailAddress: "Owner@Example.Test", verification: { status: "verified" } },
    ], "primary")).toBe("owner@example.test");
    expect(verifiedPrimaryEmail([{ id: "primary", emailAddress: "victim@example.test", verification: { status: "unverified" } }], "primary")).toBeNull();
  });
  it("rejects an oversized body without trusting Content-Length", async () => {
    const request = new Request("https://example.test", { method: "POST", body: "123456" });
    await expect(readBoundedBody(request, 5)).rejects.toThrow("Request too large");
  });
  it("preserves an ordinary request body", async () => {
    const bytes = await readBoundedBody(new Request("https://example.test", { method: "POST", body: "hello" }), 5);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });
});

describe("local reminder hour", () => {
  it("evaluates the user's timezone rather than the server's", () => {
    const now = new Date("2026-09-09T16:00:00Z");
    expect(isReminderHour("09:00", "America/Los_Angeles", now)).toBe(true);
    expect(isReminderHour("09:00", "America/New_York", now)).toBe(false);
  });
  it("handles invalid stored zones without failing the entire cron", () => {
    expect(isReminderHour("09:00", "not/a/zone", new Date())).toBe(false);
  });
});
