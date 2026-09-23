import { describe, it, expect } from "vitest";
import { getActivationMessage } from "@/lib/activation";

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

    // T-978: the sibling of the guard above. establishRelationshipOrInvite's
    // candidate set is exact email equality plus prospectId — never a phone
    // lookup. This is the shared primitive activateLead and
    // linkOrInviteProspect both call, so it is the one place CB01 must hold
    // for the whole funnel, not just the pre-existing file.
    it("lib/leads/activate-lead.ts never queries User by phoneNumber", async () => {
        const fs = await import("node:fs/promises");
        const source = await fs.readFile(new URL("../../lib/leads/activate-lead.ts", import.meta.url), "utf8");
        expect(source).not.toMatch(/phoneNumber/);
    });
});

/**
 * T-978 — the message table in lib/leads/activate-lead.ts. All four
 * outcomes and all five refusals: distinct, non-empty. Every one that has a
 * real prospect name available interpolates it (not_found is the deliberate
 * exception — the transaction refuses before any lead is ever read, so
 * there is no name to interpolate; its sentence is a fixed, safe "Lead not
 * found"). No refusal sentence claims anything happened: none may contain
 * "activated", "active client", "roster" or "invite sent" — the pure-function
 * form of "a refusal never claims anything happened".
 */
describe("lib/leads/activate-lead.ts getActivationMessage", () => {
    const FORBIDDEN_IN_REFUSALS = ["activated", "active client", "roster", "invite sent"];

    it("produces nine distinct, non-empty sentences", async () => {
        const { getActivationMessage } = await import("@/lib/leads/activate-lead");
        const states = [
            "already_active",
            "already_on_roster",
            "invite_emailed",
            "invite_created_email_failed",
            "not_found",
            "wrong_stage",
            "no_email_on_file",
            "self_addressed",
            "failed",
        ] as const;
        const messages = states.map((s) => getActivationMessage("Sam", s, { email: "sam@example.test" }));
        for (const m of messages) expect(m.length).toBeGreaterThan(0);
        expect(new Set(messages).size).toBe(messages.length);
    });

    it("interpolates the prospect name in every state except not_found", async () => {
        const { getActivationMessage } = await import("@/lib/leads/activate-lead");
        const states = [
            "already_active",
            "already_on_roster",
            "invite_emailed",
            "invite_created_email_failed",
            "wrong_stage",
            "no_email_on_file",
            "self_addressed",
            "failed",
        ] as const;
        for (const s of states) {
            expect(getActivationMessage("Zaleria", s)).toContain("Zaleria");
        }
        // The deliberate exception: no lead was ever read, so there is
        // nothing to name.
        expect(getActivationMessage("", "not_found")).toBe("Lead not found");
    });

    it("no refusal sentence claims anything happened", async () => {
        const { getActivationMessage } = await import("@/lib/leads/activate-lead");
        const refusals = ["not_found", "wrong_stage", "no_email_on_file", "self_addressed", "failed"] as const;
        for (const r of refusals) {
            const msg = getActivationMessage("Sam", r, { email: "sam@example.test" }).toLowerCase();
            for (const bad of FORBIDDEN_IN_REFUSALS) {
                expect(msg, `refusal "${r}" message "${msg}" must not contain "${bad}"`).not.toContain(bad);
            }
        }
    });
});
