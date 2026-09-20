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
