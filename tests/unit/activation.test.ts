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
    it("returns an already-connected message when prospect was already linked", () => {
        const msg = getActivationMessage("Alex", {
            linked: true,
            clientId: "user_123",
            email: "alex@test.com",
            alreadyConnected: true,
        });
        expect(msg).toContain("Alex");
        expect(msg).toContain("already connected");
    });

    it("returns a pending-acceptance message when an invite was sent — never claims immediate access", () => {
        const msg = getActivationMessage("Sam", {
            linked: false,
            inviteToken: "tok_abc",
            email: "sam@test.com",
        });
        expect(msg).toContain("Sam");
        expect(msg).toContain("accept");
        // CB01 regression guard: activation must never claim the client is
        // already on the roster before they have consented.
        expect(msg).not.toContain("has been activated and added to your roster");
    });

    it("returns a no-email message without claiming anything was sent", () => {
        const msg = getActivationMessage("Jordan", {
            linked: false,
            inviteToken: null,
            email: null,
            noEmailOnFile: true,
        });
        expect(msg).toContain("Jordan");
        expect(msg).toContain("email");
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

    it("exports acceptClientInviteForUser", async () => {
        const mod = await import("@/lib/activation");
        expect(typeof mod.acceptClientInviteForUser).toBe("function");
    });

    it("LinkResult discriminated union covers all three branches", () => {
        // Type-level test: ensure every path produces valid, distinct messages
        const linkedResult = { linked: true as const, clientId: "x", email: "x@x.com", alreadyConnected: true as const };
        const inviteResult = { linked: false as const, inviteToken: "tok", email: "y@y.com" };
        const noEmailResult = { linked: false as const, inviteToken: null, email: null, noEmailOnFile: true as const };

        const messages = [linkedResult, inviteResult, noEmailResult].map((r) => getActivationMessage("Test", r));
        for (const m of messages) expect(m.length).toBeGreaterThan(0);

        // Messages must all be distinct
        expect(new Set(messages).size).toBe(messages.length);
    });
});

/**
 * CB01 regression guard: linkOrInviteProspect must never resolve a match by
 * phone number alone. This is a static-source check (not a DB-dependent
 * behavioral test) that fails loudly if phone-based User lookup is
 * reintroduced into lib/activation.ts.
 */
describe("CB01 — no phone-match authorization", () => {
    it("lib/activation.ts never queries User by phoneNumber", async () => {
        const fs = await import("node:fs/promises");
        const source = await fs.readFile(new URL("../../lib/activation.ts", import.meta.url), "utf8");
        // The ProspectInfo type may still carry a prospectPhone field (other
        // callers construct it), but activation.ts itself must never use it
        // to resolve which User account to act on.
        expect(source).not.toMatch(/phoneNumber/);
    });
});
