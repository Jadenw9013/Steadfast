import { describe, it, expect } from "vitest";
import { getActivationMessage, validateActivationPreconditions } from "@/lib/activation";

/**
 * Activation safety tests.
 *
 * These validate the pure-function guards and message helpers from
 * lib/activation.ts. The actual DB-dependent linkOrInviteProspect
 * function is tested via the coaching-request-handoff tests and
 * manual smoke tests.
 *
 * KEY INVARIANT: Every activation path (bypass, normal pipeline, API route)
 * MUST use linkOrInviteProspect from lib/activation.ts. If you are
 * adding a new activation path, it MUST call that helper — never
 * inline the link/invite logic.
 */

describe("getActivationMessage", () => {
    it("returns roster message when prospect was linked", () => {
        const msg = getActivationMessage("Alex", {
            linked: true,
            clientId: "user_123",
            email: "alex@test.com",
        });
        expect(msg).toContain("Alex");
        expect(msg).toContain("roster");
    });

    it("returns pending message when prospect has no account", () => {
        const msg = getActivationMessage("Sam", {
            linked: false,
            inviteToken: "tok_abc",
            email: "sam@test.com",
        });
        expect(msg).toContain("Sam");
        expect(msg).toContain("create their account");
    });
});

describe("validateActivationPreconditions", () => {
    it("returns error for ACTIVE leads (idempotency guard)", () => {
        const err = validateActivationPreconditions({ consultationStage: "ACTIVE" });
        expect(err).toBe("Already active.");
    });

    // ── Normal pipeline (allowAnyStage = false) ──────────────────────────
    describe("normal pipeline (strict stage check)", () => {
        it("allows FORMS_SIGNED", () => {
            const err = validateActivationPreconditions({ consultationStage: "FORMS_SIGNED" });
            expect(err).toBeNull();
        });

        it("allows INTAKE_SUBMITTED", () => {
            const err = validateActivationPreconditions({ consultationStage: "INTAKE_SUBMITTED" });
            expect(err).toBeNull();
        });

        it("blocks PENDING", () => {
            const err = validateActivationPreconditions({ consultationStage: "PENDING" });
            expect(err).toContain("complete intake");
        });

        it("blocks CONSULTATION_SCHEDULED", () => {
            const err = validateActivationPreconditions({ consultationStage: "CONSULTATION_SCHEDULED" });
            expect(err).toContain("complete intake");
        });

        it("blocks FORMS_SENT", () => {
            const err = validateActivationPreconditions({ consultationStage: "FORMS_SENT" });
            expect(err).toContain("complete intake");
        });
    });

    // ── Bypass pipeline (allowAnyStage = true) ───────────────────────────
    describe("bypass pipeline (any stage allowed)", () => {
        it("allows PENDING when bypass is enabled", () => {
            const err = validateActivationPreconditions({
                consultationStage: "PENDING",
                allowAnyStage: true,
            });
            expect(err).toBeNull();
        });

        it("allows CONSULTATION_SCHEDULED when bypass is enabled", () => {
            const err = validateActivationPreconditions({
                consultationStage: "CONSULTATION_SCHEDULED",
                allowAnyStage: true,
            });
            expect(err).toBeNull();
        });

        it("allows FORMS_SENT when bypass is enabled", () => {
            const err = validateActivationPreconditions({
                consultationStage: "FORMS_SENT",
                allowAnyStage: true,
            });
            expect(err).toBeNull();
        });

        it("still blocks ACTIVE even with bypass (idempotency)", () => {
            const err = validateActivationPreconditions({
                consultationStage: "ACTIVE",
                allowAnyStage: true,
            });
            expect(err).toBe("Already active.");
        });
    });
});

/**
 * ARCHITECTURAL INVARIANT TEST
 *
 * This test documents the critical safety rule: all activation
 * code paths must use the shared linkOrInviteProspect helper.
 * If this file fails to import from lib/activation.ts, it means
 * the helper was moved or removed — which is a breaking change.
 */
describe("activation helper contract", () => {
    it("exports linkOrInviteProspect", async () => {
        const mod = await import("@/lib/activation");
        expect(typeof mod.linkOrInviteProspect).toBe("function");
    });

    it("exports getActivationMessage", async () => {
        const mod = await import("@/lib/activation");
        expect(typeof mod.getActivationMessage).toBe("function");
    });

    it("exports validateActivationPreconditions", async () => {
        const mod = await import("@/lib/activation");
        expect(typeof mod.validateActivationPreconditions).toBe("function");
    });

    it("LinkResult discriminated union covers both branches", () => {
        // Type-level test: ensure both paths produce valid messages
        const linkedResult = { linked: true as const, clientId: "x", email: "x@x.com" };
        const inviteResult = { linked: false as const, inviteToken: "tok", email: "y@y.com" };

        // Both must produce non-empty strings
        expect(getActivationMessage("Test", linkedResult).length).toBeGreaterThan(0);
        expect(getActivationMessage("Test", inviteResult).length).toBeGreaterThan(0);

        // Messages must be different
        expect(getActivationMessage("Test", linkedResult))
            .not.toBe(getActivationMessage("Test", inviteResult));
    });
});
