import { describe, it, expect } from "vitest";
import {
  normalizeEmailForMatch,
  accountOwnsEmail,
  maskEmail,
} from "@/lib/auth/invite-email-match";

const verified = (emailAddress: string, id = emailAddress) => ({
  id,
  emailAddress,
  verification: { status: "verified" },
});
const unverified = (emailAddress: string) => ({
  id: emailAddress,
  emailAddress,
  verification: { status: "unverified" },
});

describe("T-1012 invite email matching", () => {
  describe("normalizeEmailForMatch", () => {
    it("lowercases and trims", () => {
      expect(normalizeEmailForMatch("  Jad.Shehadeh@ICloud.com ")).toBe("jad.shehadeh@icloud.com");
    });

    it("treats Apple's icloud/me/mac aliases as one mailbox", () => {
      const canonical = normalizeEmailForMatch("jad@icloud.com");
      expect(normalizeEmailForMatch("jad@me.com")).toBe(canonical);
      expect(normalizeEmailForMatch("jad@mac.com")).toBe(canonical);
    });

    it("ignores dots in gmail local parts, but not elsewhere", () => {
      expect(normalizeEmailForMatch("jad.shehadeh@gmail.com")).toBe(
        normalizeEmailForMatch("jadshehadeh@gmail.com"),
      );
      // Dots are significant outside Gmail — these must stay distinct.
      expect(normalizeEmailForMatch("jad.shehadeh@fastmail.com")).not.toBe(
        normalizeEmailForMatch("jadshehadeh@fastmail.com"),
      );
    });

    it("strips plus tags for providers that support them", () => {
      expect(normalizeEmailForMatch("jad+coach@gmail.com")).toBe("jad@gmail.com");
      expect(normalizeEmailForMatch("jad+coach@icloud.com")).toBe("jad@icloud.com");
    });

    it("maps googlemail.com to gmail.com", () => {
      expect(normalizeEmailForMatch("jad@googlemail.com")).toBe("jad@gmail.com");
    });

    it("does not throw on malformed input", () => {
      expect(normalizeEmailForMatch("")).toBe("");
      expect(normalizeEmailForMatch(null)).toBe("");
      expect(normalizeEmailForMatch("no-at-sign")).toBe("no-at-sign");
      expect(normalizeEmailForMatch("trailing@")).toBe("trailing@");
    });
  });

  describe("accountOwnsEmail", () => {
    it("matches a NON-PRIMARY verified address — the T-1012 regression", () => {
      const addresses = [verified("primary@gmail.com"), verified("invited@icloud.com")];
      expect(accountOwnsEmail(addresses, "invited@icloud.com")).toBe(true);
    });

    it("matches across an Apple alias the coach typed", () => {
      expect(accountOwnsEmail([verified("jad@icloud.com")], "jad@me.com")).toBe(true);
    });

    it("matches a gmail address the coach typed with dots", () => {
      expect(accountOwnsEmail([verified("jadshehadeh@gmail.com")], "jad.shehadeh@gmail.com")).toBe(true);
    });

    it("NEVER matches an unverified address", () => {
      expect(accountOwnsEmail([unverified("invited@icloud.com")], "invited@icloud.com")).toBe(false);
    });

    it("returns false for an address the account does not hold", () => {
      expect(accountOwnsEmail([verified("someone@gmail.com")], "other@icloud.com")).toBe(false);
    });

    it("returns false for an Apple private relay address, which can never match", () => {
      expect(
        accountOwnsEmail([verified("abc123@privaterelay.appleid.com")], "jad@icloud.com"),
      ).toBe(false);
    });

    it("handles missing or empty inputs", () => {
      expect(accountOwnsEmail(null, "jad@icloud.com")).toBe(false);
      expect(accountOwnsEmail([verified("jad@icloud.com")], null)).toBe(false);
      expect(accountOwnsEmail([], "jad@icloud.com")).toBe(false);
    });
  });

  describe("maskEmail", () => {
    it("reveals only the first character and the domain", () => {
      expect(maskEmail("jad.shehadeh@icloud.com")).toBe("j***@icloud.com");
    });
    it("does not leak anything on malformed input", () => {
      expect(maskEmail("garbage")).toBe("***");
      expect(maskEmail(null)).toBe("");
    });
  });
});
