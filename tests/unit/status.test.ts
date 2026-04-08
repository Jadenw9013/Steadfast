import { describe, it, expect } from "vitest";
import { deriveStatusState } from "@/lib/status";

describe("deriveStatusState", () => {
  // ── Overdue override ──────────────────────────────────────────────────────
  describe("overdue cadence", () => {
    it("returns 'overdue' when cadenceStatus is overdue regardless of scores", () => {
      expect(deriveStatusState({ cadenceStatus: "overdue", weeklyScore: 100, liveScore: 100 })).toBe("overdue");
    });

    it("returns 'overdue' even with no scores", () => {
      expect(deriveStatusState({ cadenceStatus: "overdue" })).toBe("overdue");
    });

    it("returns 'overdue' even with low scores", () => {
      expect(deriveStatusState({ cadenceStatus: "overdue", weeklyScore: 0, liveScore: 0 })).toBe("overdue");
    });
  });

  // ── Blended score formula ─────────────────────────────────────────────────
  describe("blending formula (weekly * 0.75 + live * 0.25)", () => {
    it("computes blended correctly with both scores", () => {
      // weekly=80, live=100 → blended = 80*0.75 + 100*0.25 = 60+25 = 85 → locked_in
      expect(deriveStatusState({ weeklyScore: 80, liveScore: 100 })).toBe("locked_in");
    });

    it("computes blended correctly near boundary", () => {
      // weekly=80, live=60 → blended = 60 + 15 = 75 → on_track
      expect(deriveStatusState({ weeklyScore: 80, liveScore: 60 })).toBe("on_track");
    });

    it("computes blended correctly for low scores", () => {
      // weekly=40, live=20 → blended = 30 + 5 = 35 → off_plan
      expect(deriveStatusState({ weeklyScore: 40, liveScore: 20 })).toBe("off_plan");
    });

    it("rounds blended to nearest integer", () => {
      // weekly=86, live=81 → blended = 64.5 + 20.25 = 84.75 → round = 85 → locked_in
      expect(deriveStatusState({ weeklyScore: 86, liveScore: 81 })).toBe("locked_in");
    });
  });

  // ── Threshold boundaries ──────────────────────────────────────────────────
  describe("threshold boundaries", () => {
    it("exactly 85 → locked_in", () => {
      expect(deriveStatusState({ weeklyScore: 85 })).toBe("locked_in");
    });

    it("84 → on_track", () => {
      expect(deriveStatusState({ weeklyScore: 84 })).toBe("on_track");
    });

    it("exactly 65 → on_track", () => {
      expect(deriveStatusState({ weeklyScore: 65 })).toBe("on_track");
    });

    it("64 → needs_focus", () => {
      expect(deriveStatusState({ weeklyScore: 64 })).toBe("needs_focus");
    });

    it("exactly 40 → needs_focus", () => {
      expect(deriveStatusState({ weeklyScore: 40 })).toBe("needs_focus");
    });

    it("39 → off_plan", () => {
      expect(deriveStatusState({ weeklyScore: 39 })).toBe("off_plan");
    });

    it("0 → off_plan", () => {
      expect(deriveStatusState({ weeklyScore: 0 })).toBe("off_plan");
    });

    it("100 → locked_in", () => {
      expect(deriveStatusState({ weeklyScore: 100 })).toBe("locked_in");
    });
  });

  // ── Fallback behavior ────────────────────────────────────────────────────
  describe("score fallbacks", () => {
    it("uses weeklyScore alone when liveScore is null", () => {
      expect(deriveStatusState({ weeklyScore: 90, liveScore: null })).toBe("locked_in");
    });

    it("uses liveScore alone when weeklyScore is null", () => {
      expect(deriveStatusState({ weeklyScore: null, liveScore: 50 })).toBe("needs_focus");
    });

    it("defaults to 70 (on_track) when both scores are null", () => {
      expect(deriveStatusState({ weeklyScore: null, liveScore: null })).toBe("on_track");
    });

    it("defaults to 70 (on_track) when no scores provided at all", () => {
      expect(deriveStatusState({})).toBe("on_track");
    });
  });

  // ── Non-overdue cadence statuses ──────────────────────────────────────────
  describe("non-overdue cadence statuses", () => {
    it("ignores cadenceStatus='reviewed' and uses scores", () => {
      expect(deriveStatusState({ cadenceStatus: "reviewed", weeklyScore: 30 })).toBe("off_plan");
    });

    it("ignores cadenceStatus='upcoming' and uses scores", () => {
      expect(deriveStatusState({ cadenceStatus: "upcoming", weeklyScore: 90 })).toBe("locked_in");
    });

    it("ignores null cadenceStatus", () => {
      expect(deriveStatusState({ cadenceStatus: null, weeklyScore: 50 })).toBe("needs_focus");
    });
  });
});
