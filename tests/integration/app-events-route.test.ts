import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth/roles", () => ({
  getCurrentDbUser: async () => {
    if (!auth.user) throw new Error("Not authenticated");
    return auth.user;
  },
}));

import { db } from "@/lib/db";
import { POST } from "@/app/api/app-events/route";
import { PUBLIC_ROUTE_PATTERNS } from "@/proxy";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe.sequential : describe.skip;
const originalKillSwitch = process.env.APP_EVENTS_INGEST_DISABLED;

function event() {
  return {
    name: "ios.api.server_error",
    level: "error",
    ts: new Date().toISOString(),
    appVersion: "1.4.0",
    build: "212",
    osVersion: "18.2",
    deviceModel: "iPhone15,2",
    route: "/api/client/home",
    method: "GET",
    statusCode: 500,
    errorKind: "other",
    count: 1,
  };
}

function request(body: string, contentType = "application/json") {
  return new NextRequest("http://localhost/api/app-events", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

suite("POST /api/app-events", () => {
  let createdUserIds: string[] = [];
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    auth.user = null;
    createdUserIds = [];
    delete process.env.APP_EVENTS_INGEST_DISABLED;
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    if (createdUserIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  afterAll(async () => {
    if (originalKillSwitch === undefined) delete process.env.APP_EVENTS_INGEST_DISABLED;
    else process.env.APP_EVENTS_INGEST_DISABLED = originalKillSwitch;
    await db.$disconnect();
  });

  async function signIn() {
    const clerkId = randomUUID();
    const user = await db.user.create({
      data: { clerkId, email: `app-events-${clerkId}@example.test`, isClient: true },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    auth.user = user;
    return user;
  }

  it("returns 401 unauthenticated and emits nothing", async () => {
    const response = await POST(request(JSON.stringify({ events: [event()] })));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("accepts an authenticated valid batch with the ack shape", async () => {
    await signIn();
    const response = await POST(request(JSON.stringify({ events: [event()] })));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1, rejected: 0 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for a streamed body larger than 8 KiB", async () => {
    await signIn();
    const response = await POST(request("x".repeat(9 * 1024)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });

  it("returns 429 on the twenty-first batch in one minute", async () => {
    await signIn();
    for (let index = 0; index < 20; index += 1) {
      const response = await POST(request(JSON.stringify({ events: [event()] })));
      expect(response.status).toBe(202);
    }
    const response = await POST(request(JSON.stringify({ events: [event()] })));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
  });

  it("kill switch returns 204 and emits nothing", async () => {
    process.env.APP_EVENTS_INGEST_DISABLED = "true";
    const response = await POST(request(JSON.stringify({ events: [event()] })));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("malformed JSON returns 400 and never 500", async () => {
    await signIn();
    const response = await POST(request("{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });

  it("remains protected by proxy and does not make another route public", () => {
    expect(PUBLIC_ROUTE_PATTERNS).not.toContain("/api/app-events");
    expect(PUBLIC_ROUTE_PATTERNS).toContain("/api/public(.*)");
  });
});
