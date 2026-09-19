import { Prisma } from "@/app/generated/prisma/client";
import { redactContext, routePattern, safeFrames, sanitizeErrorMessage, scrubIdentifier } from "@/lib/observability/redact";
import { activeSinks } from "@/lib/observability/sinks";
import { deployEnv, releaseId } from "@/lib/observability/release";

export type ObservabilityLevel = "error" | "warning";

/**
 * Closed by design. There is no `extra` map: that is how request bodies,
 * client content and secrets reach a third-party dashboard. New fields
 * require an architect decision, not a cast — do not widen this with an index
 * signature or a `Record<string, unknown>`.
 */
export type ObservabilityEvent = {
  evt: string; // dotted, always `sf.`-prefixed on web
  level: ObservabilityLevel;
  ts: string; // ISO 8601
  release: string; // 7-char sha or "local"
  env: "production" | "preview" | "development";
  platform: "web";
  route?: string; // route PATTERN only
  method?: string;
  statusCode?: number;
  durationMs?: number;
  errorName?: string;
  errorMessage?: string; // only via sanitizeErrorMessage
  prismaCode?: string;
  frames?: string[]; // our own files: "lib/foo.ts:41". Never node_modules.
  ids?: {
    userId?: string;
    clientId?: string;
    coachId?: string;
    planId?: string;
    programId?: string;
    requestId?: string;
  };
  context?: Record<string, string | number | boolean>; // post-redaction only
};

function baseFields(route?: string): Pick<ObservabilityEvent, "ts" | "release" | "env" | "platform" | "route"> {
  return {
    ts: new Date().toISOString(),
    release: releaseId(),
    env: deployEnv(),
    platform: "web",
    ...(route !== undefined ? { route: routePattern(route) } : {}),
  };
}

/** Ids are typed as opaque DB identifiers today, but nothing enforces that at
 *  the call site — route every value through the same scrub patterns as
 *  `context` so a future caller that accidentally passes free text (e.g. an
 *  email) through `ids` degrades to `[redacted]` instead of leaking. */
function scrubIds(ids: ObservabilityEvent["ids"] | undefined): ObservabilityEvent["ids"] | undefined {
  if (!ids) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(ids)) {
    if (typeof value === "string") result[key] = scrubIdentifier(value);
  }
  return Object.keys(result).length > 0 ? (result as ObservabilityEvent["ids"]) : undefined;
}

/** `error instanceof Error ? error.constructor.name : typeof error` — never
 *  throws even for a hostile `error` value (e.g. a getter on `constructor`). */
function errorNameOf(error: unknown): string {
  try {
    if (error instanceof Error) return error.constructor?.name || "Error";
    return typeof error;
  } catch {
    return "UnknownError";
  }
}

/** `for (const s of activeSinks()) { try { s.emit(e) } catch {} }` — one
 *  sink's bug can never block another sink or the caller. */
function emitToSinks(event: ObservabilityEvent): void {
  for (const sink of activeSinks()) {
    try {
      sink.emit(event);
    } catch {
      // A sink's own failure (e.g. a network sink added by a future ticket)
      // must never become a user-facing failure.
    }
  }
}

/**
 * Fires a `warning`-level beacon for a branch that knowingly degraded —
 * content disagreed with its own mode, a lookup missed with no fallback, a
 * merge dropped keys. Synchronous, never throws, never awaits, performs no
 * network I/O itself (a sink might, but that is the sink's problem to solve
 * safely, not this function's).
 */
export function reportAnomaly(
  evt: string,
  opts: {
    ids?: ObservabilityEvent["ids"];
    context?: Record<string, string | number | boolean>;
    allow?: readonly string[];
    route?: string;
  }
): void {
  try {
    const context = redactContext(opts.context, opts.allow ?? []);
    const event: ObservabilityEvent = {
      evt,
      level: "warning",
      ...baseFields(opts.route),
      ...(opts.ids !== undefined ? { ids: scrubIds(opts.ids) } : {}),
      ...(context !== undefined ? { context } : {}),
    };
    emitToSinks(event);
  } catch {
    // Monitoring must never become a user-facing failure.
  }
}

/**
 * Fires an `error`-level event for a real thrown exception. Synchronous,
 * never throws, never awaits.
 */
export function reportServerError(
  evt: string,
  error: unknown,
  opts?: {
    route?: string;
    method?: string;
    statusCode?: number;
    ids?: ObservabilityEvent["ids"];
    context?: Record<string, string | number | boolean>;
    allow?: readonly string[];
  }
): void {
  try {
    const context = redactContext(opts?.context, opts?.allow ?? []);
    const errorMessage = sanitizeErrorMessage(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const frames = safeFrames(stack);
    const prismaCode =
      error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;

    const event: ObservabilityEvent = {
      evt,
      level: "error",
      ...baseFields(opts?.route),
      ...(opts?.method !== undefined ? { method: opts.method } : {}),
      ...(opts?.statusCode !== undefined ? { statusCode: opts.statusCode } : {}),
      ...(opts?.ids !== undefined ? { ids: scrubIds(opts.ids) } : {}),
      errorName: errorNameOf(error),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(prismaCode !== undefined ? { prismaCode } : {}),
      ...(frames !== undefined ? { frames } : {}),
      ...(context !== undefined ? { context } : {}),
    };
    emitToSinks(event);
  } catch {
    // Monitoring must never become a user-facing failure.
  }
}
