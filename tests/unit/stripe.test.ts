import { describe, it, expect, vi } from 'vitest';
import { getBillingStatus } from '@/lib/billing/stripe';

// Mock stripe module
vi.mock('stripe', () => {
  return {
    Stripe: class {
      subscriptions = {
        retrieve: vi.fn((customerId: string) => {
          if (customerId === 'cus_error') {
            return Promise.reject(new Error('Stripe API error'));
          }
          return Promise.resolve({ status: 'active' });
        })
      };
    }
  };
});

describe('getBillingStatus', () => {
  it('should return the subscription status when successful', async () => {
    const status = await getBillingStatus('cus_123');
    expect(status).toBe('active');
  });

  it('should return "inactive" when stripe throws an error', async () => {
    // Suppress console.error for this test to avoid noisy output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const status = await getBillingStatus('cus_error');

    expect(status).toBe('inactive');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
