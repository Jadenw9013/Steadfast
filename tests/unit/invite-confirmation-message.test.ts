import { describe, it, expect } from "vitest";
import { inviteConfirmationMessage } from "@/lib/activation";

/**
 * T-987 — the sentence the REST route (`POST /api/client/connect-coach`)
 * returns as `message` on the 409 `confirmation_required` branch. Pure
 * function, pinned exactly so the frozen contract in board/tickets/T-987.md
 * cannot drift silently.
 */
describe("inviteConfirmationMessage", () => {
    it("names the coach", () => {
        expect(
            inviteConfirmationMessage({
                invitedEmailHint: "j***@icloud.com",
                signedInAs: "jad@privaterelay.appleid.com",
                coachName: "Jane Doe",
            })
        ).toBe(
            "This invite was sent to j***@icloud.com, not jad@privaterelay.appleid.com. Confirm it's you to join Jane Doe."
        );
    });

    it("falls back to 'your coach' when coachName is null", () => {
        expect(
            inviteConfirmationMessage({
                invitedEmailHint: "s***@gmail.com",
                signedInAs: "sam@gmail.com",
                coachName: null,
            })
        ).toBe("This invite was sent to s***@gmail.com, not sam@gmail.com. Confirm it's you to join your coach.");
    });

    it("interpolates the exact hint/signedInAs pair given, verbatim", () => {
        const msg = inviteConfirmationMessage({
            invitedEmailHint: "a***@example.test",
            signedInAs: "attacker@evil.test",
            coachName: "Coach K",
        });
        expect(msg).toContain("a***@example.test");
        expect(msg).toContain("attacker@evil.test");
        expect(msg).toContain("Coach K");
    });
});
