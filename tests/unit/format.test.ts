import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../../lib/utils/format';

describe('formatCurrency', () => {
  it('formats zero correctly', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats positive integers correctly', () => {
    expect(formatCurrency(100)).toBe('$1.00');
    expect(formatCurrency(99)).toBe('$0.99');
    expect(formatCurrency(2500)).toBe('$25.00');
    expect(formatCurrency(5)).toBe('$0.05');
  });

  it('formats large numbers correctly with commas', () => {
    expect(formatCurrency(123456789)).toBe('$1,234,567.89');
    expect(formatCurrency(100000)).toBe('$1,000.00');
  });

  it('formats negative integers correctly', () => {
    expect(formatCurrency(-100)).toBe('-$1.00');
    expect(formatCurrency(-99)).toBe('-$0.99');
    expect(formatCurrency(-2500)).toBe('-$25.00');
    expect(formatCurrency(-5)).toBe('-$0.05');
  });

  it('handles fractional cents by rounding correctly', () => {
    expect(formatCurrency(100.5)).toBe('$1.01'); // Node 20.19 Intl.NumberFormat rounds 1.005 to 1.01
    expect(formatCurrency(100.4)).toBe('$1.00');
  });
});
