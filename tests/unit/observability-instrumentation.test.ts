import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ emit: vi.fn(), throwFromSink: false }));

vi.mock("@/lib/observability/sinks", () => ({
  activeSinks: () => [{
    name: "test",
    emit: (event: unknown) => {
      if (mocks.throwFromSink) throw new Error("sink failed");
      mocks.emit(event);
    },
  }],
}));

import { onRequestError } from "@/instrumentation";

const request = {
  path: "https://steadfast.example/api/coach/clients/clx1abcdefghijklmnopqrst/meal-plan?weekOf=2026-09-14",
  method: "GET",
  headers: {
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.private",
    cookie: "__session=private-cookie",
  },
};

const context = {
  routerKind: "App Router" as const,
  routePath: "/api/coach/clients/[clientId]/meal-plan",
  routeType: "route" as const,
  renderSource: "react-server-components" as const,
  revalidateReason: undefined,
};

describe("onRequestError", () => {
  beforeEach(() => {
    mocks.emit.mockReset();
    mocks.throwFromSink = false;
  });

  it("reports a normalized route without ever forwarding request headers", async () => {
    await onRequestError(new Error("private server detail"), request, context);

    expect(mocks.emit).toHaveBeenCalledTimes(1);
    const event = mocks.emit.mock.calls[0][0];
    expect(event.evt).toBe("sf.server.unhandled");
    expect(event.route).toBe("/api/coach/clients/[id]/meal-plan");
    expect(event.method).toBe("GET");
    const encoded = JSON.stringify(event);
    expect(encoded).not.toContain("authorization");
    expect(encoded).not.toContain("eyJhbGci");
    expect(encoded).not.toContain("cookie");
    expect(encoded).not.toContain("private-cookie");
  });

  it("drops context keys outside the frozen allowlist", async () => {
    await onRequestError(new Error("boom"), request, {
      ...context,
      secret: "alice@example.com",
    } as typeof context);

    expect(mocks.emit.mock.calls[0][0].context).not.toHaveProperty("secret");
    expect(JSON.stringify(mocks.emit.mock.calls[0][0])).not.toContain("alice@example.com");
  });

  it("never propagates a throwing sink", async () => {
    mocks.throwFromSink = true;

    await expect(onRequestError(new Error("boom"), request, context)).resolves.toBeUndefined();
  });
});
