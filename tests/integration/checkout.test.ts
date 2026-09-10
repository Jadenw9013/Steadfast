import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
const mocks = vi.hoisted(() => ({ userId: "", customer: vi.fn(), list: vi.fn(), create: vi.fn(), retrieve: vi.fn(), portal: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.userId }), currentUser: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripePriceId: () => "price_test", stripe: {
  customers: { create: mocks.customer }, subscriptions: { list: mocks.list },
  checkout: { sessions: { create: mocks.create, retrieve: mocks.retrieve } }, billingPortal: { sessions: { create: mocks.portal } },
} }));
import { db } from "@/lib/db";
import { POST } from "@/app/api/coach/billing/checkout/route";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
(enabled ? describe : describe.skip)("serialized subscription checkout", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const id = randomUUID(); mocks.userId = id;
    await db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: true } });
    mocks.customer.mockResolvedValue({ id: `cus_${id}` });
    mocks.list.mockResolvedValue({ data: [] });
    mocks.create.mockResolvedValue({ id: `cs_${id}`, url: "https://checkout.stripe.com/test" });
    mocks.retrieve.mockResolvedValue({ status: "open", url: "https://checkout.stripe.com/test" });
    mocks.portal.mockResolvedValue({ url: "https://billing.stripe.com/test" });
  });
  afterAll(async () => { await db.$disconnect(); });
  it("reuses one pending checkout under concurrent requests", async () => {
    const results = await Promise.all([POST(), POST(), POST()]);
    expect(results.map(result => result.status)).toEqual([200, 200, 200]);
    expect(mocks.customer).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("routes existing subscribers to management without a second purchase", async () => {
    mocks.list.mockResolvedValue({ data: [{ status: "active" }] });
    const response = await POST();
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/test" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
