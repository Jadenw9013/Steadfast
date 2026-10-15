import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@/lib/observability/sinks", () => ({
  activeSinks: () => [{ name: "test", emit: mocks.emit }],
}));

import { ingestAppEvents } from "@/lib/app-events/ingest";

function event(overrides: Record<string, unknown> = {}) {
  return {
    name: "ios.api.decode_failed",
    level: "error",
    ts: new Date().toISOString(),
    appVersion: "1.4.0",
    build: "212",
    osVersion: "18.2",
    deviceModel: "iPhone15,2",
    route: "/api/client/meal-plan/current",
    method: "GET",
    statusCode: 200,
    errorKind: "keyNotFound",
    codingPath: "plan.days.meals.macros",
    count: 1,
    ...overrides,
  };
}

describe("ingestAppEvents", () => {
  beforeEach(() => mocks.emit.mockReset());

  it("accepts a valid batch and emits each event as iOS observability", () => {
    const result = ingestAppEvents("session-user", {
      events: [
        event(),
        event({ name: "ios.api.server_error", statusCode: 500, codingPath: undefined }),
        event({ route: "/api/client/training/current", errorKind: "typeMismatch" }),
      ],
    });

    expect(result).toEqual({ accepted: 3, rejected: 0 });
    expect(mocks.emit).toHaveBeenCalledTimes(3);
    for (const emitted of mocks.emit.mock.calls.map(([value]) => value)) {
      expect(emitted.platform).toBe("ios");
      expect(emitted.ids).toEqual({ userId: "session-user" });
    }
  });

  it("counts an unknown name as rejected without emitting or throwing", () => {
    expect(ingestAppEvents("user", { events: [event({ name: "ios.unknown" })] })).toEqual({
      accepted: 0,
      rejected: 1,
    });
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("strips query strings and rewrites concrete ids before emission", () => {
    const route = "/api/coach/clients/clx1abcdefghijklmnopqrst/meal-plan?email=alice@example.com";
    expect(ingestAppEvents("user", { events: [event({ route })] })).toEqual({
      accepted: 1,
      rejected: 0,
    });
    const encoded = JSON.stringify(mocks.emit.mock.calls[0][0]);
    expect(mocks.emit.mock.calls[0][0].route).toBe("/api/coach/clients/[id]/meal-plan");
    expect(encoded).not.toContain("alice@example.com");
    expect(encoded).not.toContain("?");
  });

  it("drops a malformed coding path but accepts the bounded event", () => {
    expect(ingestAppEvents("user", { events: [event({ codingPath: 'plan["private note"]' })] })).toEqual({
      accepted: 1,
      rejected: 0,
    });
    expect(mocks.emit.mock.calls[0][0].context).not.toHaveProperty("codingPath");
  });

  it("rejects a server event name so the app cannot forge server telemetry", () => {
    expect(ingestAppEvents("user", { events: [event({ name: "sf.route.failed" })] })).toEqual({
      accepted: 0,
      rejected: 1,
    });
  });

  it("ignores a body userId and uses the authenticated session identity", () => {
    expect(ingestAppEvents("trusted-user", { events: [event({ userId: "forged-user" })] })).toEqual({
      accepted: 1,
      rejected: 0,
    });
    expect(mocks.emit.mock.calls[0][0].ids).toEqual({ userId: "trusted-user" });
  });

  it("rejects an over-limit batch as a malformed request", () => {
    expect(() => ingestAppEvents("user", { events: Array.from({ length: 21 }, () => event()) })).toThrow();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it("rejects timestamps outside the accepted clock window", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(ingestAppEvents("user", { events: [event({ ts: old }), event({ ts: future })] })).toEqual({
      accepted: 0,
      rejected: 2,
    });
  });

  it("never emits PII or secret-shaped strings from invalid client fields", () => {
    const secret = "alice@example.com eyJhbGciOiJIUzI1NiJ9.payload sk_live_ABC123";
    const result = ingestAppEvents("user", {
      events: [
        event({
          appVersion: secret,
          build: secret,
          osVersion: secret,
          deviceModel: secret,
          route: `/api/client/home?value=${encodeURIComponent(secret)}`,
          codingPath: secret,
        }),
      ],
    });
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain("alice@example.com");
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain("sk_live_");
  });
});
