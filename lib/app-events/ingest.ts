import { z } from "zod";
import { IOS_API_DECODE_FAILED, IOS_API_SERVER_ERROR } from "@/lib/observability/events";
import { routePattern } from "@/lib/observability/redact";
import { reportAnomaly, reportServerError } from "@/lib/observability/report";

export const APP_EVENT_NAMES = [
  IOS_API_DECODE_FAILED.evt,
  IOS_API_SERVER_ERROR.evt,
] as const;

const codingPathPattern = /^[A-Za-z0-9_.[\]]{0,120}$/;
const routePatternShape = /^\/api\/[A-Za-z0-9\/_\-[\]:.]{0,120}$/;

export const appEventSchema = z
  .object({
    name: z
      .string()
      .max(48)
      .regex(/^ios\.[a-z0-9_]+(\.[a-z0-9_]+)*$/)
      .refine((name): name is (typeof APP_EVENT_NAMES)[number] =>
        APP_EVENT_NAMES.includes(name as (typeof APP_EVENT_NAMES)[number])
      ),
    level: z.enum(["error", "warning"]),
    ts: z.string().datetime({ offset: true }),
    appVersion: z.string().regex(/^[0-9A-Za-z.\-]{1,20}$/),
    build: z.string().regex(/^[0-9A-Za-z.\-]{1,20}$/),
    osVersion: z.string().regex(/^[0-9.]{1,12}$/),
    deviceModel: z.string().regex(/^[A-Za-z0-9,]{1,20}$/),
    route: z
      .string()
      .max(256)
      .refine((route) => routePatternShape.test(routePattern(route)))
      .optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    errorKind: z
      .enum([
        "keyNotFound",
        "typeMismatch",
        "valueNotFound",
        "dataCorrupted",
        "network",
        "timeout",
        "other",
      ])
      .optional(),
    codingPath: z.string().regex(codingPathPattern).optional(),
    count: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type AppEventInput = z.infer<typeof appEventSchema>;

const batchSchema = z
  .object({
    events: z.array(z.unknown()).min(1).max(20),
  })
  .strict();

function normalizedCandidate(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const candidate = { ...(raw as Record<string, unknown>) };

  // Identity is always taken from the authenticated session. A client that
  // sends this key cannot replace it or make the otherwise-valid event fail.
  delete candidate.userId;

  // Coding keys are useful only when they are a schema path. Drop malformed
  // paths while retaining the bounded event around them.
  if (typeof candidate.codingPath === "string" && !codingPathPattern.test(candidate.codingPath)) {
    delete candidate.codingPath;
  }
  return candidate;
}

function isTimestampFresh(ts: string, now: number): boolean {
  const timestamp = Date.parse(ts);
  return timestamp >= now - 24 * 60 * 60 * 1000 && timestamp <= now + 5 * 60 * 1000;
}

function emitAppEvent(userId: string, event: AppEventInput): void {
  const definition =
    event.name === IOS_API_DECODE_FAILED.evt
      ? IOS_API_DECODE_FAILED
      : IOS_API_SERVER_ERROR;
  const context = {
    appVersion: event.appVersion,
    build: event.build,
    osVersion: event.osVersion,
    deviceModel: event.deviceModel,
    ...(event.errorKind !== undefined ? { errorKind: event.errorKind } : {}),
    ...(event.codingPath !== undefined ? { codingPath: event.codingPath } : {}),
    count: event.count ?? 1,
  };
  const options = {
    platform: "ios" as const,
    timestamp: event.ts,
    ids: { userId },
    route: event.route === undefined ? undefined : routePattern(event.route),
    method: event.method,
    statusCode: event.statusCode,
    context,
    allow: definition.allow,
  };

  if (event.level === "warning") {
    reportAnomaly(definition.evt, options);
  } else {
    // Plain Error messages are never emitted by the observability redactor;
    // only the closed event fields above reach a sink.
    reportServerError(definition.evt, new Error(definition.evt), options);
  }
}

export function ingestAppEvents(
  userId: string,
  raw: unknown
): { accepted: number; rejected: number } {
  const batch = batchSchema.parse(raw);
  const now = Date.now();
  let accepted = 0;
  let rejected = 0;

  for (const rawEvent of batch.events) {
    const result = appEventSchema.safeParse(normalizedCandidate(rawEvent));
    if (!result.success || !isTimestampFresh(result.data.ts, now)) {
      rejected += 1;
      continue;
    }
    emitAppEvent(userId, result.data);
    accepted += 1;
  }

  return { accepted, rejected };
}
