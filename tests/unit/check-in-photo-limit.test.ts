import { describe, it, expect, vi } from "vitest";
import { createCheckInSchema } from "@/lib/validations/check-in";
import { createSignedUploadUrls } from "@/app/actions/storage";

vi.mock("@/lib/auth/roles", () => ({
  getCurrentDbUser: vi.fn().mockResolvedValue({
    id: "user_123",
    clerkId: "clerk_123",
  }),
}));

vi.mock("@/lib/security/quota", () => ({
  consumeQuota: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/supabase/storage", () => ({
  createSignedUploadUrls: vi.fn().mockImplementation((paths: string[]) =>
    Promise.resolve(
      paths.map((p) => ({ path: p, signedUrl: `https://storage/${p}`, token: "tok" }))
    )
  ),
}));

describe("T-950 check-in photo limit regression tests", () => {
  describe("createCheckInSchema", () => {
    it("accepts 3 photos", () => {
      const result = createCheckInSchema.safeParse({
        weight: 150,
        photoPaths: ["p1.jpg", "p2.jpg", "p3.jpg"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts 4 photos (bug report: client attaching 4 photos was rejected on main)", () => {
      const result = createCheckInSchema.safeParse({
        weight: 150,
        photoPaths: ["p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts up to 10 photos", () => {
      const photos = Array.from({ length: 10 }, (_, i) => `photo-${i + 1}.jpg`);
      const result = createCheckInSchema.safeParse({
        weight: 150,
        photoPaths: photos,
      });
      expect(result.success).toBe(true);
    });

    it("rejects 11 photos", () => {
      const photos = Array.from({ length: 11 }, (_, i) => `photo-${i + 1}.jpg`);
      const result = createCheckInSchema.safeParse({
        weight: 150,
        photoPaths: photos,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createSignedUploadUrls server action", () => {
    it("generates signed upload URLs for 4 photos without throwing", async () => {
      const photos = ["front.jpg", "back.jpg", "side-left.jpg", "side-right.jpg"];
      const result = await createSignedUploadUrls(photos);
      expect(result).not.toHaveProperty("error");
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result).toHaveLength(4);
      }
    });

    it("generates signed upload URLs for 10 photos", async () => {
      const photos = Array.from({ length: 10 }, (_, i) => `photo-${i + 1}.jpg`);
      const result = await createSignedUploadUrls(photos);
      expect(result).not.toHaveProperty("error");
      expect(Array.isArray(result)).toBe(true);
      if (Array.isArray(result)) {
        expect(result).toHaveLength(10);
      }
    });

    it("refuses 11 photos with a structured error naming the limit, not an exception", async () => {
      const photos = Array.from({ length: 11 }, (_, i) => `photo-${i + 1}.jpg`);
      let thrownError: unknown = null;
      let result: Awaited<ReturnType<typeof createSignedUploadUrls>> | null = null;
      try {
        result = await createSignedUploadUrls(photos);
      } catch (err) {
        thrownError = err;
      }
      expect(thrownError).toBeNull();
      expect(result).toEqual({ error: expect.stringMatching(/10.*photos.*max/i) });
    });
  });
});
