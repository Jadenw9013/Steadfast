/**
 * T-2009 (S-18) — the post-response kick wrapper.
 *
 * Everything here is about one property: scheduling a drain can never break
 * run creation. `after()` throws *synchronously at its call site* when the
 * runtime has no request scope (Next E468) or no `waitUntil` (E91), and
 * vitest is exactly such a runtime, so the try/catch in `scheduleRunDrain`
 * is load-bearing and is pinned below.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  drainRunNow: vi.fn<(runId: string) => Promise<string>>(),
  reportAnomaly: vi.fn(),
}));
vi.mock("next/server", () => ({ after: hoisted.after }));
vi.mock("@/lib/ai-coach/executor", () => ({ drainRunNow: hoisted.drainRunNow }));
vi.mock("@/lib/observability/report", () => ({ reportAnomaly: hoisted.reportAnomaly }));

import { runIdOf, scheduleRunDrain } from "@/lib/ai-coach/kick";
import { AICOACH_RUN_KICK, AICOACH_RUN_KICK_ALLOW } from "@/lib/observability/events";

describe("runIdOf — a check, never a cast", () => {
  it("returns the id for a well-formed command result", () => {
    expect(runIdOf({ runId: "abc" })).toBe("abc");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["empty id", { runId: "" }],
    ["numeric id", { runId: 5 }],
    ["null id", { runId: null }],
    ["a bare string", "abc"],
    ["an array", []],
  ])("returns null for %s", (_label, value) => {
    expect(runIdOf(value)).toBeNull();
  });
});

describe("scheduleRunDrain", () => {
  beforeEach(() => {
    hoisted.after.mockReset();
    hoisted.drainRunNow.mockReset();
    hoisted.reportAnomaly.mockReset();
    hoisted.drainRunNow.mockResolvedValue("completed");
  });
  afterEach(() => vi.restoreAllMocks());

  it("schedules exactly one callback and beacons the drain outcome", async () => {
    hoisted.after.mockImplementation(() => {});
    scheduleRunDrain("r1");

    expect(hoisted.after).toHaveBeenCalledTimes(1);
    expect(typeof hoisted.after.mock.calls[0][0]).toBe("function");
    // Nothing is beaconed until the scheduled callback actually runs.
    expect(hoisted.reportAnomaly).not.toHaveBeenCalled();

    await hoisted.after.mock.calls[0][0]();
    expect(hoisted.drainRunNow).toHaveBeenCalledWith("r1");
    expect(hoisted.reportAnomaly).toHaveBeenCalledTimes(1);
    expect(hoisted.reportAnomaly.mock.calls[0][0]).toBe(AICOACH_RUN_KICK.evt);
    expect(hoisted.reportAnomaly.mock.calls[0][1].context).toEqual({ outcome: "completed" });
  });

  it("does nothing at all without a run id", () => {
    scheduleRunDrain(null);
    scheduleRunDrain("");
    expect(hoisted.after).not.toHaveBeenCalled();
    expect(hoisted.reportAnomaly).not.toHaveBeenCalled();
  });

  it("does not throw when after() is unavailable, and says so once", () => {
    // Reproduces Next E468 / E91: no request scope, or no waitUntil.
    hoisted.after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });

    expect(() => scheduleRunDrain("r1")).not.toThrow();
    expect(hoisted.reportAnomaly).toHaveBeenCalledTimes(1);
    expect(hoisted.reportAnomaly.mock.calls[0][1].context).toEqual({
      outcome: "schedule_unavailable",
    });
  });

  it("never carries a context key outside the frozen allow-list", async () => {
    hoisted.after.mockImplementation(() => {});
    scheduleRunDrain("r1");
    await hoisted.after.mock.calls[0][0]();
    hoisted.after.mockImplementation(() => {
      throw new Error("no waitUntil");
    });
    scheduleRunDrain("r2");

    expect(hoisted.reportAnomaly).toHaveBeenCalledTimes(2);
    for (const call of hoisted.reportAnomaly.mock.calls) {
      expect(Object.keys(call[1].context).length).toBeGreaterThan(0);
      for (const key of Object.keys(call[1].context)) {
        expect(AICOACH_RUN_KICK_ALLOW).toContain(key);
      }
      expect(call[1].allow).toBe(AICOACH_RUN_KICK.allow);
      // No client id, no plan id, no failure reason.
      expect(call[1].ids).toBeUndefined();
    }
  });
});

describe("source guards — the kick is not a second sweep", () => {
  const read = (relative: string) =>
    fs.readFileSync(path.join(process.cwd(), relative), "utf8");

  it("kick.ts never sweeps, reconciles or selects rows", () => {
    const source = read("lib/ai-coach/kick.ts");
    expect(source).not.toMatch(/runExecutorSweep/);
    expect(source).not.toMatch(/reconcileExpiredRuns/);
    expect(source).not.toMatch(/findMany/);
  });

  it("both run-creating routes pin the nodejs runtime and the 120s budget", () => {
    for (const route of [
      "app/api/client/ai-coach/runs/route.ts",
      "app/api/client/ai-coach/runs/[runId]/retry/route.ts",
    ]) {
      const source = read(route);
      expect(source).toContain('export const runtime = "nodejs"');
      expect(source).toContain("export const maxDuration = 120");
      expect(source).toContain("scheduleRunDrain(runIdOf(created))");
    }
  });

  it("the executor itself never imports next/*", () => {
    expect(read("lib/ai-coach/executor.ts")).not.toMatch(/from "next\//);
  });
});
