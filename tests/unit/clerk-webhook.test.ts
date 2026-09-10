import { describe, it, expect } from "vitest";
import { isCoachMetadata, resolveRoleOnCreate, resolveRoleOnUpdate } from "@/lib/auth/clerk-webhook";

describe("isCoachMetadata", () => {
    it("recognizes 'coach' role case-insensitively", () => {
        expect(isCoachMetadata("coach")).toBe(true);
        expect(isCoachMetadata("COACH")).toBe(true);
        expect(isCoachMetadata("Coach")).toBe(true);
    });

    it("returns false for client role, missing metadata, or non-string values", () => {
        expect(isCoachMetadata("client")).toBe(false);
        expect(isCoachMetadata(undefined)).toBe(false);
        expect(isCoachMetadata(null)).toBe(false);
        expect(isCoachMetadata(42)).toBe(false);
    });
});

describe("resolveRoleOnCreate", () => {
    it("sets coach fields when metadata says coach", () => {
        expect(resolveRoleOnCreate("coach")).toEqual({
            activeRole: "COACH",
            isCoach: true,
            isClient: false,
        });
    });

    it("defaults to client fields when metadata doesn't say coach", () => {
        expect(resolveRoleOnCreate(undefined)).toEqual({
            activeRole: "CLIENT",
            isCoach: false,
            isClient: true,
        });
    });
});

describe("resolveRoleOnUpdate", () => {
    // Regression test: a Clerk `user.updated` webhook fires for any profile
    // change, not just role changes. Coaches who got isCoach via the in-app
    // "Become a Coach" flow never have Clerk metadata set to "coach" — this
    // must never strip their access on an incidental sync.
    it("never demotes an existing coach, even when metadata has no role set", () => {
        expect(resolveRoleOnUpdate(undefined, { isCoach: true })).toEqual({});
        expect(resolveRoleOnUpdate("client", { isCoach: true })).toEqual({});
        expect(resolveRoleOnUpdate(null, { isCoach: true })).toEqual({});
    });

    it("promotes to coach when metadata says coach and the user wasn't already one", () => {
        expect(resolveRoleOnUpdate("coach", { isCoach: false })).toEqual({ isCoach: true });
        expect(resolveRoleOnUpdate("coach", null)).toEqual({ isCoach: true });
    });

    it("is a no-op when metadata has no role and the user isn't a coach", () => {
        expect(resolveRoleOnUpdate(undefined, { isCoach: false })).toEqual({});
        expect(resolveRoleOnUpdate(undefined, null)).toEqual({});
    });

    it("never returns isClient or activeRole — those are not touched on update", () => {
        const result = resolveRoleOnUpdate("coach", { isCoach: false });
        expect(result).not.toHaveProperty("isClient");
        expect(result).not.toHaveProperty("activeRole");
    });
});
