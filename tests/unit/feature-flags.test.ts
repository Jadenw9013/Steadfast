import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkFeatureEnabled } from "@/lib/flags/check";

describe("checkFeatureEnabled", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clone process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original process.env after each test
    process.env = originalEnv;
  });

  it("should return true by default when no environment variable is set", async () => {
    const result = await checkFeatureEnabled("test_feature", "user_123");
    expect(result).toBe(true);
  });

  it("should return true when the environment variable override is 'true'", async () => {
    process.env.FEATURE_test_feature = "true";
    const result = await checkFeatureEnabled("test_feature", "user_123");
    expect(result).toBe(true);
  });

  it("should return false when the environment variable override is 'false'", async () => {
    process.env.FEATURE_test_feature = "false";
    const result = await checkFeatureEnabled("test_feature", "user_123");
    expect(result).toBe(false);
  });

  it("should return false when the environment variable override is any string other than 'true'", async () => {
    process.env.FEATURE_test_feature = "enabled";
    const result = await checkFeatureEnabled("test_feature", "user_123");
    expect(result).toBe(false);
  });
});
