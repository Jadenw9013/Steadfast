import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * CB11 — Stripe does not guarantee webhook delivery order, but
 * upsertCoachSubscriptionFromStripeSubscription unconditionally overwrote
 * local state from whatever payload arrived, so a late-arriving,
 * chronologically-older event could regress a coach's entitlement after a
 * newer, correct event had already been applied. The effect and the
 * webhook idempotency receipt were also two separate top-level awaits,
 * not atomic.
 *
 * Required regression: an older event applied after a newer one is
 * rejected; events applied in order both take effect; the coach
 * subscription upsert and the webhook receipt commit together.
 */

const mocks = vi.hoisted(() => ({ constructEvent: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
  getStripeWebhookSecret: () => "whsec_test",
}));

import { db } from "@/lib/db";
import { POST as webhookPost } from "@/app/api/webhooks/stripe/route";
import { NextRequest } from "next/server";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
}
const suite = enabled ? describe : describe.skip;

function fakeSubscriptionEvent(opts: {
  id: string;
  created: number; // unix seconds
  coachId: string;
  customerId: string;
  status: string;
  priceId?: string;
}) {
  return {
    id: opts.id,
    type: "customer.subscription.updated",
    created: opts.created,
    data: {
      object: {
        id: `sub_${opts.coachId}`,
        object: "subscription",
        customer: opts.customerId,
        status: opts.status,
        cancel_at_period_end: false,
        trial_end: null,
        metadata: { coachId: opts.coachId },
        items: {
          data: [
            {
              price: { id: opts.priceId ?? "price_test" },
              current_period_start: opts.created,
              current_period_end: opts.created + 30 * 24 * 60 * 60,
            },
          ],
        },
      },
    },
  };
}

suite("CB11 — billing webhook event ordering with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  function req() {
    return new NextRequest("https://example.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "test-sig" },
      body: "{}",
    });
  }

  async function makeCoach() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: true } });
  }

  it("a chronologically older event arriving after a newer one is rejected, not applied", async () => {
    const coach = await makeCoach();
    const customerId = `cus_${coach.id}`;
    const t1 = 1_700_000_000;
    const t2 = t1 + 3600; // one hour later

    // Newer event arrives first: ACTIVE.
    mocks.constructEvent.mockReturnValueOnce(
      fakeSubscriptionEvent({ id: `evt_${randomUUID()}`, created: t2, coachId: coach.id, customerId, status: "active" })
    );
    const first = await webhookPost(req());
    expect(first.status).toBe(200);

    // Older event arrives late: past_due. Must NOT overwrite the newer ACTIVE state.
    mocks.constructEvent.mockReturnValueOnce(
      fakeSubscriptionEvent({ id: `evt_${randomUUID()}`, created: t1, coachId: coach.id, customerId, status: "past_due" })
    );
    const second = await webhookPost(req());
    expect(second.status).toBe(200); // not an error — just a no-op skip

    const row = await db.coachSubscription.findUniqueOrThrow({ where: { coachId: coach.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.lastEventAt?.getTime()).toBe(t2 * 1000);
  });

  it("events applied in chronological order both take effect", async () => {
    const coach = await makeCoach();
    const customerId = `cus_${coach.id}`;
    const t1 = 1_700_100_000;
    const t2 = t1 + 3600;

    mocks.constructEvent.mockReturnValueOnce(
      fakeSubscriptionEvent({ id: `evt_${randomUUID()}`, created: t1, coachId: coach.id, customerId, status: "trialing" })
    );
    await webhookPost(req());

    mocks.constructEvent.mockReturnValueOnce(
      fakeSubscriptionEvent({ id: `evt_${randomUUID()}`, created: t2, coachId: coach.id, customerId, status: "active" })
    );
    await webhookPost(req());

    const row = await db.coachSubscription.findUniqueOrThrow({ where: { coachId: coach.id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.lastEventAt?.getTime()).toBe(t2 * 1000);
  });

  it("the subscription upsert and the webhook receipt are recorded together", async () => {
    const coach = await makeCoach();
    const customerId = `cus_${coach.id}`;
    const eventId = `evt_${randomUUID()}`;
    mocks.constructEvent.mockReturnValueOnce(
      fakeSubscriptionEvent({ id: eventId, created: 1_700_200_000, coachId: coach.id, customerId, status: "active" })
    );
    await webhookPost(req());

    const row = await db.coachSubscription.findUniqueOrThrow({ where: { coachId: coach.id } });
    expect(row.status).toBe("ACTIVE");
    const receipt = await db.stripeWebhookEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(receipt.type).toBe("customer.subscription.updated");
  });

  it("replaying the same event id is idempotent (no duplicate effect)", async () => {
    const coach = await makeCoach();
    const customerId = `cus_${coach.id}`;
    const eventId = `evt_${randomUUID()}`;
    const event = fakeSubscriptionEvent({ id: eventId, created: 1_700_300_000, coachId: coach.id, customerId, status: "active" });

    mocks.constructEvent.mockReturnValueOnce(event);
    await webhookPost(req());
    mocks.constructEvent.mockReturnValueOnce(event);
    const replay = await webhookPost(req());

    expect(replay.status).toBe(200);
    const receiptCount = await db.stripeWebhookEvent.count({ where: { id: eventId } });
    expect(receiptCount).toBe(1);
  });
});
