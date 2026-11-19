import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { requireLocalTestDb } from "../helpers/require-local-test-db";

const fixture = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => ({ id: fixture.userId, isCoach: false }), ensureCoachCode: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { db } from "@/lib/db";
import { consumeQuota } from "@/lib/security/quota";
import { POST } from "@/app/api/become-coach/route";
import { becomeCoach } from "@/app/actions/become-coach";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
const keys: string[] = [];
afterAll(async () => {
  if (enabled) await db.requestQuota.deleteMany({ where: { key: { in: keys } } });
  vi.unstubAllEnvs();
  await db.$disconnect();
});
function track(scope: string, userId: string, seconds: number) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  for (const offset of [0, 1]) keys.push(createHash("sha256").update(`${scope}:${userId}:${window + offset}`).digest("hex"));
}
suite("durable registration quota", () => {
  it("admits only three concurrent attempts across workers", async () => {
    const userId = randomUUID();
    track("quota-test", userId, 900);
    const results = await Promise.all(Array.from({ length: 15 }, () => consumeQuota("quota-test", userId, 3, 900)));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
  it("REST and server action consume the same persisted budget", async () => {
    fixture.userId = randomUUID();
    track("coach-registration", fixture.userId, 900);
    vi.stubEnv("STEADFAST_COACH_ACCESS_CODE", "synthetic-secret");
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await POST(new NextRequest("https://example.test/api/become-coach", { method: "POST", body: JSON.stringify({ accessCode: "wrong" }) }));
      expect(response.status).toBe(403);
    }
    expect((await becomeCoach({ accessCode: "synthetic-secret" }))?.error).toMatch(/Too many/);
  });
});
