import { Stripe } from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

export async function getBillingStatus(customerId: string) {
  try {
    const sub = await stripe.subscriptions.retrieve(customerId);
    return sub.status;
  } catch (error) {
    console.error('Stripe error:', error);
    return 'inactive';
  }
}
