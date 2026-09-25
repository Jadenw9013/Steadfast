import { describe, it, expect } from "vitest";
import { acceptAnywayRedirectTarget, confirmErrorMessageForCode } from "@/lib/activation";

/**
 * T-987 review round 1, MAJOR 1 (both reviewers) —
 * `/invite/[token]`'s "acceptAnyway" server action used to discard
 * `redeemInvite`'s result and redirect to `/client?welcomed=1`
 * unconditionally. A second holder of the token, an expired invite, AI
 * enrollment in another tab, another coach or a deactivated account all
 * refuse at the service level and write nothing — the page still claimed
 * success. This pins the corrected redirect target for every case.
 *
 * T-987 review round 2 (parity MINOR 2, code review finding C) — the
 * redirect target carries a stable CODE, never the free-text sentence:
 * round-tripping the raw sentence through the URL let anyone holding any
 * valid token render arbitrary text ("phishing copy") in the error card on
 * the real product domain. `confirmErrorMessageForCode` is the one table
 * both the redirect target and the page's rendering read from.
 */
describe("acceptAnywayRedirectTarget", () => {
  it("sends a genuine success to the welcome dashboard", () => {
    expect(acceptAnywayRedirectTarget("tok_abc", { success: true })).toBe("/client?welcomed=1");
  });

  const refusals = [
    "This invite has already been used.",
    "This invite has expired or is no longer available. Ask your coach for a new one.",
    "Pause AI coaching or resolve your provider before accepting a human coach.",
    "Leave your current coaching relationship before accepting another coach.",
    "This client account is unavailable.",
    "This coach is unavailable.",
    "This invite is no longer available.",
  ];

  it("never redirects to the welcome dashboard on any refusal — the exact lie this fix closes", () => {
    for (const error of refusals) {
      const target = acceptAnywayRedirectTarget("tok_abc", { success: false, error });
      expect(target).not.toBe("/client?welcomed=1");
      expect(target.startsWith("/invite/tok_abc?confirmError=")).toBe(true);
    }
  });

  it("carries a CODE, never the raw sentence, in the URL", () => {
    const target = acceptAnywayRedirectTarget("tok_xyz", {
      success: false,
      error: "This invite has already been used.",
    });
    const url = new URL(target, "https://example.test");
    const code = url.searchParams.get("confirmError");
    expect(code).toBe("already_used");
    // The exact defect this fix closes: the raw sentence (with its spaces
    // and punctuation — a code is a single underscored token) must never
    // appear in the query string, encoded or not.
    expect(target).not.toContain("This invite has already been used");
    expect(target).not.toContain(encodeURIComponent("This invite has already been used."));
  });

  it("every known refusal sentence round-trips through a code back to itself, exactly", () => {
    for (const error of refusals) {
      const target = acceptAnywayRedirectTarget("tok_abc", { success: false, error });
      const code = new URL(target, "https://example.test").searchParams.get("confirmError");
      expect(confirmErrorMessageForCode(code)).toBe(error);
    }
  });

  it("URL-encodes the token", () => {
    const target = acceptAnywayRedirectTarget("tok with spaces", { success: false, error: "anything" });
    expect(target.startsWith(`/invite/${encodeURIComponent("tok with spaces")}`)).toBe(true);
  });

  it("an error string that matches no known sentence (a thrown-error sentinel) maps to the generic code and message", () => {
    const target = acceptAnywayRedirectTarget("tok_abc", { success: false, error: "__unexpected__" });
    const code = new URL(target, "https://example.test").searchParams.get("confirmError");
    expect(code).toBe("unknown");
    expect(confirmErrorMessageForCode(code)).toBe(
      "Something went wrong confirming this invite. Please try again."
    );
  });
});

describe("confirmErrorMessageForCode", () => {
  it("never echoes an unrecognised code — always the generic fallback", () => {
    const generic = "Something went wrong confirming this invite. Please try again.";
    expect(confirmErrorMessageForCode("<script>alert(1)</script>")).toBe(generic);
    expect(confirmErrorMessageForCode("call +1-555-scam-now")).toBe(generic);
    expect(confirmErrorMessageForCode(null)).toBe(generic);
    expect(confirmErrorMessageForCode(undefined)).toBe(generic);
    expect(confirmErrorMessageForCode("")).toBe(generic);
    // Object.prototype keys must not be reachable through the lookup.
    expect(confirmErrorMessageForCode("toString")).toBe(generic);
    expect(confirmErrorMessageForCode("constructor")).toBe(generic);
  });
});
