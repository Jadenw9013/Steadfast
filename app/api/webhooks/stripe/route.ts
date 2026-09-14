import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe, getStripeWebhookSecret } from "@/lib/stripe";
import { db } from "@/lib/db";
import { upsertCoachSubscriptionFromStripeSubscription } from "@/lib/billing";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret()
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return new Response("Webhook verification failed", { status: 400 });
  }

  // Signature is verified from here on — the event is genuinely from Stripe.
  // Any error past this point should surface as a 5xx so Stripe retries the
  // delivery; the idempotency check below makes retries safe.
  try {
    const alreadyProcessed = await db.stripeWebhookEvent.findUnique({
      where: { id: event.id },
      select: { id: true },
    });
    if (alreadyProcessed) {
      return new Response("OK", { status: 200 });
    }

    // Network calls to Stripe happen here, outside any DB transaction —
    // resolving which subscription this event concerns can be slow and must
    // never hold a DB connection/lock open while it happens.
    let subscription: Stripe.Subscription | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        subscription = event.data.object as Stripe.Subscription;
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionRef = invoice.parent?.subscription_details?.subscription;
        if (subscriptionRef) {
          const subscriptionId =
            typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef.id;
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        }
        break;
      }

      default:
        // Unhandled event type — not an error, we just don't act on it.
        break;
    }

    // CB11: the effect (subscription upsert) and the idempotency receipt
    // commit atomically. Previously these were two separate top-level
    // awaits — a crash between them left the effect applied with no
    // receipt, so a retried delivery could re-apply it a second time.
    await db.$transaction(async (tx) => {
      if (subscription) {
        await upsertCoachSubscriptionFromStripeSubscription(subscription, new Date(event.created * 1000), tx);
      }
      await tx.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          // Round-trip through JSON to guarantee a plain-serializable value
          // for the Json column (the raw Stripe.Event type isn't directly
          // assignable).
          payload: JSON.parse(JSON.stringify(event)),
        },
      });
    });

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(`[POST /api/webhooks/stripe] event=${event.id} type=${event.type}`, err);
    return new Response("Webhook handler error", { status: 500 });
  }
}
