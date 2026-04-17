import { describe, it, expect } from "vitest";
import { generateCoachSlug } from "@/lib/utils/slug";

describe("generateCoachSlug", () => {
  it("converts regular names to lowercase slugs", () => {
    expect(generateCoachSlug("John Doe")).toBe("john-doe");
    expect(generateCoachSlug("Jane Smith")).toBe("jane-smith");
  });

  it("handles leading and trailing spaces", () => {
    expect(generateCoachSlug("  John Doe  ")).toBe("john-doe");
  });

  it("removes special characters", () => {
    expect(generateCoachSlug("John O'Connor")).toBe("john-o-connor");
    expect(generateCoachSlug("Mary-Jane")).toBe("mary-jane");
    expect(generateCoachSlug("Dr. John!")).toBe("dr-john");
  });

  it("handles multiple consecutive non-alphanumeric characters", () => {
    expect(generateCoachSlug("John   Doe")).toBe("john-doe");
    expect(generateCoachSlug("Jane & John")).toBe("jane-john");
    expect(generateCoachSlug("User@Domain")).toBe("user-domain");
  });

  it("removes leading and trailing hyphens after replacement", () => {
    expect(generateCoachSlug("---John Doe---")).toBe("john-doe");
    expect(generateCoachSlug("!@# John Doe !@#")).toBe("john-doe");
  });

  it("handles empty strings", () => {
    expect(generateCoachSlug("")).toBe("");
  });

  it("handles strings with only special characters", () => {
    expect(generateCoachSlug("!@#$%^&*()")).toBe("");
  });

  it("handles alphanumeric strings correctly", () => {
    expect(generateCoachSlug("Coach123")).toBe("coach123");
    expect(generateCoachSlug("99 Red Balloons")).toBe("99-red-balloons");
  });
});
