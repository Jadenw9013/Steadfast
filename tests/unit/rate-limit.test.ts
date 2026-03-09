import { describe, it, expect, beforeEach } from "vitest";

/**
 * Test the core rate limiting logic for key separation.
 * Verifies that different route keys are properly isolated.
 */

interface WindowEntry {
    count: number;
    resetAt: number;
}

const store = new Map<string, WindowEntry>();

function checkRateLimit(
    key: string,
    config: { maxRequests: number; windowSeconds: number }
) {
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const existing = store.get(key);

    if (!existing || now > existing.resetAt) {
        const resetAt = now + windowMs;
        store.set(key, { count: 1, resetAt });
        return { success: true, remaining: config.maxRequests - 1, resetAt };
    }

    existing.count++;
    if (existing.count > config.maxRequests) {
        return { success: false, remaining: 0, resetAt: existing.resetAt };
    }

    return {
        success: true,
        remaining: config.maxRequests - existing.count,
        resetAt: existing.resetAt,
    };
}

describe("rate-limit core", () => {
    beforeEach(() => {
        store.clear();
    });

    it("allows requests within the limit", () => {
        const config = { maxRequests: 3, windowSeconds: 60 };
        const r1 = checkRateLimit("user:abc", config);
        expect(r1.success).toBe(true);
        expect(r1.remaining).toBe(2);

        const r2 = checkRateLimit("user:abc", config);
        expect(r2.success).toBe(true);
        expect(r2.remaining).toBe(1);

        const r3 = checkRateLimit("user:abc", config);
        expect(r3.success).toBe(true);
        expect(r3.remaining).toBe(0);
    });

    it("blocks requests above the limit", () => {
        const config = { maxRequests: 2, windowSeconds: 60 };
        checkRateLimit("user:xyz", config);
        checkRateLimit("user:xyz", config);

        const r3 = checkRateLimit("user:xyz", config);
        expect(r3.success).toBe(false);
        expect(r3.remaining).toBe(0);
    });

    it("isolates keys — different users don't share limits", () => {
        const config = { maxRequests: 1, windowSeconds: 60 };
        checkRateLimit("user:a", config);

        const r = checkRateLimit("user:b", config);
        expect(r.success).toBe(true);
        expect(r.remaining).toBe(0);
    });

    it("resets after window expires", () => {
        const config = { maxRequests: 1, windowSeconds: 0.001 };
        checkRateLimit("user:reset", config);

        const entry = store.get("user:reset")!;
        entry.resetAt = Date.now() - 1;

        const result = checkRateLimit("user:reset", config);
        expect(result.success).toBe(true);
    });

    it("returns resetAt timestamp", () => {
        const config = { maxRequests: 5, windowSeconds: 120 };
        const before = Date.now();
        const result = checkRateLimit("user:time", config);
        const after = Date.now();

        expect(result.resetAt).toBeGreaterThanOrEqual(before + 120000);
        expect(result.resetAt).toBeLessThanOrEqual(after + 120000);
    });

    // === NEW: Hardening pass 2 tests ===

    it("separates mealplan-parse and workout-parse keys", () => {
        const config = { maxRequests: 2, windowSeconds: 60 };

        // Exhaust mealplan-parse for user:coach1
        checkRateLimit("mealplan-parse:user:coach1", config);
        checkRateLimit("mealplan-parse:user:coach1", config);
        const blocked = checkRateLimit("mealplan-parse:user:coach1", config);
        expect(blocked.success).toBe(false);

        // workout-parse for the same user should still be allowed
        const workoutResult = checkRateLimit("workout-parse:user:coach1", config);
        expect(workoutResult.success).toBe(true);
        expect(workoutResult.remaining).toBe(1);
    });

    it("does not leak limits across different route types for same user", () => {
        const config = { maxRequests: 1, windowSeconds: 60 };

        checkRateLimit("checkin-upload:user:client1", config);
        const checkinBlocked = checkRateLimit("checkin-upload:user:client1", config);
        expect(checkinBlocked.success).toBe(false);

        // Different route type should not be affected
        const profileResult = checkRateLimit("profile-photo-upload:user:client1", config);
        expect(profileResult.success).toBe(true);
    });
});
