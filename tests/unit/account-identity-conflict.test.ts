import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser,
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mocks.findUnique, update: mocks.update, upsert: mocks.upsert } },
}));

import { getCurrentDbUser } from "@/lib/auth/roles";

const existing = {
  id: "existing-account",
  clerkId: "user_production",
  email: "owner@example.com",
  isDeactivated: false,
  isCoach: true,
  isClient: true,
  activeRole: "CLIENT",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user_development" });
  mocks.currentUser.mockResolvedValue({
    primaryEmailAddressId: "email_primary",
    emailAddresses: [{
      id: "email_primary",
      emailAddress: existing.email,
      verification: { status: "verified" },
    }],
    publicMetadata: {},
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("account identity conflicts", () => {
  it.each(["development", "test", "production"])("preserves an established identity in %s", async environment => {
    vi.stubEnv("NODE_ENV", environment);
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);

    await expect(getCurrentDbUser()).rejects.toThrow("An account with this email already exists");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("preserves both role capabilities when the authenticated identity matches", async () => {
    mocks.auth.mockResolvedValue({ userId: existing.clerkId });
    mocks.findUnique.mockResolvedValue(existing);

    await expect(getCurrentDbUser()).resolves.toEqual(existing);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("still claims a verified pending placeholder", async () => {
    const placeholder = { ...existing, clerkId: "pending_invite" };
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(placeholder);
    mocks.update.mockResolvedValue({ ...placeholder, clerkId: "user_development" });

    await expect(getCurrentDbUser()).resolves.toMatchObject({ clerkId: "user_development" });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { clerkId: "user_development", firstName: undefined, lastName: undefined },
    });
  });

  it("does not claim a deactivated placeholder", async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...existing, clerkId: "pending_invite", isDeactivated: true,
    });

    await expect(getCurrentDbUser()).rejects.toThrow("Account is pending deletion");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
