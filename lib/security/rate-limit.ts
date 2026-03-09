"use server";

import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RateLimitConfig {
  /** Maximum number of requests within the window. */
  maxRequests: number;
  /** Window size in seconds. */
  windowSeconds: number;
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

// ── In-memory store ────────────────────────────────────────────────────────────

const store = new Map<string, WindowEntry>();

// Periodic cleanup every 5 minutes to prevent unbounded growth
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

// ── Core rate limiter ──────────────────────────────────────────────────────────

function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanupExpired();

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const existing = store.get(key);

  // If no entry or expired window, start fresh
  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { success: true, remaining: config.maxRequests - 1, resetAt };
  }

  // Within current window
  existing.count++;
  if (existing.count > config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  return {
    success: true,
    remaining: config.maxRequests - existing.count,
    resetAt: existing.resetAt,
  };
}

// ── Pre-configured limiters ────────────────────────────────────────────────────

const ROUTE_CONFIGS: Record<string, RateLimitConfig> = {
  "checkin-upload": { maxRequests: 10, windowSeconds: 60 },
  "profile-photo-upload": { maxRequests: 5, windowSeconds: 60 },
  "mealplan-upload": { maxRequests: 10, windowSeconds: 60 },
  "workout-upload": { maxRequests: 10, windowSeconds: 60 },
  "mealplan-parse": { maxRequests: 5, windowSeconds: 60 },
  "workout-parse": { maxRequests: 5, windowSeconds: 60 },
};

/**
 * Apply rate limiting to a route.
 *
 * Identifies the requester by Clerk userId (preferred) or IP fallback.
 * Returns a result object; throws nothing — callers decide how to respond.
 *
 * @param route – a key from ROUTE_CONFIGS (e.g. "checkin-upload")
 */
export async function rateLimit(route: string): Promise<RateLimitResult> {
  const config = ROUTE_CONFIGS[route];
  if (!config) {
    // Unknown route — allow but log
    console.warn(`[rate-limit] Unknown route key: "${route}"`);
    return { success: true, remaining: 999, resetAt: 0 };
  }

  // Prefer userId, fall back to IP
  let identifier: string;
  try {
    const { userId } = await auth();
    if (userId) {
      identifier = `user:${userId}`;
    } else {
      const hdrs = await headers();
      const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      identifier = `ip:${ip}`;
    }
  } catch {
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    identifier = `ip:${ip}`;
  }

  const key = `${route}:${identifier}`;
  return checkRateLimit(key, config);
}

/**
 * Convenience: apply rate limit and return a 429 NextResponse if exceeded.
 * Returns null if allowed.
 */
export async function rateLimitOrReject(route: string) {
  const { NextResponse } = await import("next/server");

  const result = await rateLimit(route);
  if (!result.success) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }
  return null;
}

/**
 * Rate limit for server actions — throws an error if exceeded.
 */
export async function rateLimitAction(route: string): Promise<void> {
  const result = await rateLimit(route);
  if (!result.success) {
    throw new Error("Too many requests. Please try again later.");
  }
}
