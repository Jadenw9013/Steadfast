import { describe, it, expect } from "vitest";
import { acceptAnywayRedirectTarget } from "@/lib/activation";

/**
 * T-987 review round 1, MAJOR 1 (both reviewers) —
 * `/invite/[token]`'s "acceptAnyway" server action used to discard
 * `redeemInvite`'s result and redirect to `/client?welcomed=1`
 * unconditionally. A second holder of the token, an expired invite, AI
 * enrollment in another tab, another coach or a deactivated account all
 * refuse at the service level and write nothing — the page still claimed
 * success. This pins the corrected redirect target for every case.
 */
describe("acceptAnywayRedirectTarget", () => {
  it("sends a genuine success to the welcome dashboard", () => {
    expect(acceptAnywayRedirectTarget("tok_abc", { success: true })).toBe("/client?welcomed=1");
  });

  it("never redirects to the welcome dashboard on any refusal — the exact lie this fix closes", () => {
    const refusals = [
      "This invite has already been used.",
      "This invite has expired or is no longer available. Ask your coach for a new one.",
      "Pause AI coaching or resolve your provider before accepting a human coach.",
      "Leave your current coaching relationship before accepting another coach.",
      "This client account is unavailable.",
      "This coach is unavailable.",
    ];
    for (const error of refusals) {
      const target = acceptAnywayRedirectTarget("tok_abc", { success: false, error });
      expect(target).not.toBe("/client?welcomed=1");
      expect(target.startsWith("/invite/tok_abc?confirmError=")).toBe(true);
    }
  });

  it("round-trips the exact refusal sentence, URL-encoded, back to the invite page", () => {
    const target = acceptAnywayRedirectTarget("tok_xyz", {
      success: false,
      error: "This invite has already been used.",
    });
    expect(target).toBe(
      `/invite/tok_xyz?confirmError=${encodeURIComponent("This invite has already been used.")}`
    );
    const url = new URL(target, "https://example.test");
    expect(url.searchParams.get("confirmError")).toBe("This invite has already been used.");
  });
});
