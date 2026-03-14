import { describe, it, expect } from "vitest";
import { generateCoachCode } from "../../lib/auth/roles";

describe("generateCoachCode", () => {
  it("should generate a 6-character code", () => {
    const code = generateCoachCode();
    expect(code).toHaveLength(6);
  });

  it("should only contain characters from the allowed set", () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = generateCoachCode();
    for (const char of code) {
      expect(chars).toContain(char);
    }
  });

  it("should generate unique codes in a small sample", () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      const code = generateCoachCode();
      expect(codes.has(code)).toBe(false);
      codes.add(code);
    }
    expect(codes.size).toBe(100);
  });
});
