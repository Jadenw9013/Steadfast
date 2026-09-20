/**
 * The three frozen beacons and their context allow-lists (T-920). Owning them
 * here, rather than letting a call site spell out an `evt` string or an
 * `allow` tuple inline, is what makes a typo'd event name or a widened
 * allow-list a compile-time impossibility instead of a code-review miss.
 *
 * T-924 appends sinks in `lib/observability/sinks.ts` and nothing else; new
 * event names are an architect decision, added here.
 */

export const TRAINING_WEEK_EMPTY = {
  evt: "sf.training.week_empty_with_history",
  allow: ["weeksWithPrograms", "hasPublished", "hasDraft"],
} as const;

export const MEALPLAN_MODE_DISAGREEMENT = {
  evt: "sf.mealplan.mode_payload_disagreement",
  allow: ["planMode", "itemCount", "macroTargetCount"],
} as const;

export const MEALPLAN_SAVE_DROPPED_KEYS = {
  evt: "sf.mealplan.save_dropped_keys",
  allow: ["droppedKeys", "droppedCount", "targetStatus"],
} as const;

const IOS_API_CONTEXT = [
  "appVersion",
  "build",
  "osVersion",
  "deviceModel",
  "errorKind",
  "codingPath",
  "count",
] as const;

export const IOS_API_DECODE_FAILED = {
  evt: "ios.api.decode_failed",
  allow: IOS_API_CONTEXT,
} as const;

export const IOS_API_SERVER_ERROR = {
  evt: "ios.api.server_error",
  allow: IOS_API_CONTEXT,
} as const;

export const SERVER_UNHANDLED_ALLOW = [
  "routerKind",
  "routePath",
  "routeType",
  "renderSource",
  "revalidateReason",
] as const;

export const SERVER_UNHANDLED = {
  evt: "sf.server.unhandled",
  allow: SERVER_UNHANDLED_ALLOW,
} as const;

export const ROUTE_FAILED_ALLOW = ["handler"] as const;

export const ROUTE_FAILED = {
  evt: "sf.route.failed",
  allow: ROUTE_FAILED_ALLOW,
} as const;

export const WEBHOOK_FAILED_ALLOW = ["provider", "phase", "eventType"] as const;

export const WEBHOOK_FAILED = {
  evt: "sf.webhook.failed",
  allow: WEBHOOK_FAILED_ALLOW,
} as const;

export const CRON_FAILED_ALLOW = ["job", "phase"] as const;

export const CRON_FAILED = {
  evt: "sf.cron.failed",
  allow: CRON_FAILED_ALLOW,
} as const;

export const AICOACH_ENVELOPE_ALLOW = ["code", "role", "mutation"] as const;

export const AICOACH_ENVELOPE_FAILED = {
  evt: "sf.aicoach.envelope_failed",
  allow: AICOACH_ENVELOPE_ALLOW,
} as const;
