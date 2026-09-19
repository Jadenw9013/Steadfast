import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T-920 — `lib/observability/report.ts` is the ONLY place `ObservabilityEvent`
 * objects are built. This file pins down the three properties that make it
 * safe to call from anywhere without becoming a new failure mode:
 *   - a broken sink can never propagate an exception back to the caller,
 *   - the emitted shape is exactly the closed `ObservabilityEvent` type (this
 *     is the test that would catch someone adding an `extra` map),
 *   - the built-in console sink is one line of valid JSON.
 */

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("@/lib/observability/sinks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/observability/sinks")>();
  return {
    ...actual,
    // Only activeSinks() is overridden; consoleSink stays the real
    // implementation so the "consoleSink" suite below exercises the actual
    // `console.error(JSON.stringify(...))` code path.
    activeSinks: () => [{ name: "mock", emit: mocks.emit }],
  };
});

import { reportAnomaly, reportServerError } from "@/lib/observability/report";
import { consoleSink } from "@/lib/observability/sinks";

describe("reportAnomaly / reportServerError — never throw", () => {
  beforeEach(() => {
    mocks.emit.mockReset();
  });

  it("a sink that throws does not propagate out of reportAnomaly", () => {
    mocks.emit.mockImplementation(() => {
      throw new Error("sink is broken");
    });
    expect(() =>
      reportAnomaly("sf.test.example", { context: { a: "b" }, allow: ["a"] })
    ).not.toThrow();
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });

  it("a sink that throws does not propagate out of reportServerError", () => {
    mocks.emit.mockImplementation(() => {
      throw new Error("sink is broken");
    });
    expect(() => reportServerError("sf.test.error", new Error("boom"))).not.toThrow();
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });
});

describe("ObservabilityEvent — closed shape", () => {
  beforeEach(() => {
    mocks.emit.mockReset();
  });

  // The full, frozen key list from the parent spec's `ObservabilityEvent`
  // type. Any key emitted outside this list — most importantly a future
  // `extra` map — fails this test.
  const ALLOWED_EVENT_KEYS = [
    "evt",
    "level",
    "ts",
    "release",
    "env",
    "platform",
    "route",
    "method",
    "statusCode",
    "durationMs",
    "errorName",
    "errorMessage",
    "prismaCode",
    "frames",
    "ids",
    "context",
  ];

  it("reportAnomaly emits no key outside ObservabilityEvent", () => {
    reportAnomaly("sf.test.example", {
      ids: { clientId: "client_1" },
      context: { weeksWithPrograms: 2 },
      allow: ["weeksWithPrograms"],
      route: "/api/coach/clients/clx123abc/training",
    });
    const event = mocks.emit.mock.calls[0][0];
    for (const key of Object.keys(event)) {
      expect(ALLOWED_EVENT_KEYS).toContain(key);
    }
  });

  it("reportServerError emits no key outside ObservabilityEvent", () => {
    reportServerError("sf.test.error", new Error("boom"), {
      route: "/api/coach/clients/clx123abc/training",
      method: "GET",
      statusCode: 500,
      ids: { clientId: "client_1" },
    });
    const event = mocks.emit.mock.calls[0][0];
    for (const key of Object.keys(event)) {
      expect(ALLOWED_EVENT_KEYS).toContain(key);
    }
  });

  it("reportAnomaly always sets the required base fields", () => {
    reportAnomaly("sf.test.example", {});
    const event = mocks.emit.mock.calls[0][0];
    expect(event.evt).toBe("sf.test.example");
    expect(event.level).toBe("warning");
    expect(event.platform).toBe("web");
    expect(typeof event.ts).toBe("string");
    expect(typeof event.release).toBe("string");
    expect(["production", "preview", "development"]).toContain(event.env);
  });
});

describe("releaseId", () => {
  const originalSha = process.env.VERCEL_GIT_COMMIT_SHA;

  afterEach(() => {
    if (originalSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = originalSha;
  });

  it('returns "local" when VERCEL_GIT_COMMIT_SHA is unset', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    vi.resetModules();
    const { releaseId } = await import("@/lib/observability/release");
    expect(releaseId()).toBe("local");
  });

  it("returns the 7-char prefix when VERCEL_GIT_COMMIT_SHA is set", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "c928ee81234567890abcdef";
    vi.resetModules();
    const { releaseId } = await import("@/lib/observability/release");
    expect(releaseId()).toBe("c928ee8");
  });

  it("memoizes at module scope — a later env change does not affect an already-loaded module", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "aaaaaaa1111111111111111";
    vi.resetModules();
    const { releaseId } = await import("@/lib/observability/release");
    expect(releaseId()).toBe("aaaaaaa");
    process.env.VERCEL_GIT_COMMIT_SHA = "bbbbbbb2222222222222222";
    expect(releaseId()).toBe("aaaaaaa");
  });
});

describe("consoleSink", () => {
  it("emits exactly one line and it is valid JSON", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      consoleSink.emit({
        evt: "sf.test.example",
        level: "warning",
        ts: new Date().toISOString(),
        release: "local",
        env: "development",
        platform: "web",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0][0] as string;
      expect(() => JSON.parse(line)).not.toThrow();
      const parsed = JSON.parse(line);
      expect(parsed.evt).toBe("sf.test.example");
    } finally {
      spy.mockRestore();
    }
  });
});
