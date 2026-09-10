import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ block: vi.fn(), findUser: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { userBlock: { findFirst: mocks.block }, user: { findUnique: mocks.findUser } } }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: vi.fn() }));
import { assertMessagingAllowed } from "@/lib/messages/permissions";
import { getCurrentDbUser } from "@/lib/auth/roles";
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
