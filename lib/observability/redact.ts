import { ZodError } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { AiCoachError } from "@/lib/ai-coach/access";

/**
 * T-920 — the whole redaction contract lives in this file. Nothing outside it
 * may build an `ObservabilityEvent.context` by hand: `reportAnomaly` and
 * `reportServerError` (`lib/observability/report.ts`) always route through
 * `redactContext`, and `sanitizeErrorMessage` is the only path an error
 * message can take to a sink. A call site that skips these and builds an
 * event literal bypasses redaction entirely — see the parent spec's blast
 * radius note on "a second writer bypassing the shared service".
 */

export const REDACTED = "[redacted]";

const CONTEXT_VALUE_MAX_LENGTH = 120;
const ERROR_MESSAGE_MAX_LENGTH = 200;

// Applied in order, case-insensitive, to every string value AND to every
// error message. Each pattern is intentionally broad (favor over-redaction):
// a scrubbed line that loses a little context is fine, a leaked secret is not.
const SCRUB_PATTERNS: RegExp[] = [
  // email
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
  // E.164 phone: "+" then a non-zero digit then 6-14 more digits (7-15 total).
  /\+[1-9]\d{6,14}/g,
  // JWT — frozen pattern from the parent spec, matches the header segment.
  /ey[A-Za-z0-9_-]{10,}\./gi,
  // any URL containing a query string
  /https?:\/\/\S*\?\S*/gi,
  // API-key-shaped prefixes (real keys embed underscores, e.g. "sk_live_51H...").
  // `\b` anchors each to a word boundary so an ordinary word that merely
  // contains the prefix mid-token ("task_status", "risk_level", "disk_usage")
  // is left alone — only a genuine "sk_"/"pk_"/"whsec_" token start matches.
  /\bsk_[A-Za-z0-9_]+/gi,
  /\bpk_[A-Za-z0-9_]+/gi,
  /\bwhsec_[A-Za-z0-9_]+/gi,
  // a base64-looking run longer than 64 chars
  /[A-Za-z0-9+/]{65,}={0,2}/g,
];

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Applies every scrub pattern. Order does not matter for correctness: later
 *  patterns still match through an already-redacted `[redacted]` marker
 *  because it contains no whitespace. */
function scrub(value: string): string {
  let result = value;
  for (const pattern of SCRUB_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/** Scrub then truncate — scrub first so a secret that starts before the
 *  truncation point is still caught in full, not just its scrubbed head. */
function scrubAndTruncate(value: string, maxLength: number): string {
  return truncate(scrub(value), maxLength);
}

/** Same scrub patterns as `scrubAndTruncate`, with no truncation — for
 *  `ObservabilityEvent.ids` values, which are opaque DB identifiers today but
 *  are not validated to be, so a value that turns out to be free text (an
 *  email, say) is still caught rather than emitted verbatim. */
export function scrubIdentifier(value: string): string {
  return scrub(value);
}

/**
 * Closed allow-list redaction: only keys present in `allow` survive, and only
 * when their value is a string, number or boolean (anything else — object,
 * array, undefined, null, function — is dropped rather than coerced, since a
 * caller passing an object through `context` is exactly the shape of an
 * `extra`-map escape hatch this ticket refuses to add).
 */
export function redactContext(
  context: Record<string, unknown> | undefined,
  allow: readonly string[]
): Record<string, string | number | boolean> | undefined {
  if (!context) return undefined;

  const result: Record<string, string | number | boolean> = {};
  for (const key of allow) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) continue;
    const value = context[key];
    if (typeof value === "string") {
      result[key] = scrubAndTruncate(value, CONTEXT_VALUE_MAX_LENGTH);
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Returns the error's own message ONLY for the three classes the parent spec
 * allowlists — `AiCoachError`, `Prisma.PrismaClientKnownRequestError` and
 * `ZodError` — all of which are our own, bounded, non-arbitrary message
 * shapes. Anything else (an arbitrary thrown `Error`, a third-party library
 * error, a raw string or object) returns `undefined`: only the constructor
 * name (`errorName`, built by the caller) is ever emitted for those.
 */
export function sanitizeErrorMessage(error: unknown): string | undefined {
  const isAllowlisted =
    error instanceof AiCoachError ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof ZodError;
  if (!isAllowlisted) return undefined;

  const message = error instanceof Error ? error.message : String(error);
  return scrubAndTruncate(message, ERROR_MESSAGE_MAX_LENGTH);
}

/** Segments that look like an opaque id (cuid, uuid, numeric id, or any other
 *  short-or-long alphanumeric token that mixes letters and digits) rather than
 *  a static route segment ("api", "coach", "meal-plan", ...). */
function isIdSegment(segment: string): boolean {
  if (segment === "") return false;
  // UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  // purely numeric id
  if (/^\d+$/.test(segment)) return true;
  // Provider-prefixed opaque ids (Clerk `user_...`, Stripe `cus_...`, etc.).
  if (/^[a-z][a-z0-9]*_[a-z0-9_-]{6,}$/i.test(segment)) return true;
  // long opaque alphanumeric token (cuid, mongo objectid, etc.)
  if (/^[a-z0-9]{20,}$/i.test(segment)) return true;
  // shorter alphanumeric token that mixes letters and digits — e.g. a short
  // cuid-shaped fixture id like "clx123abc"
  if (/^[a-z0-9]{6,}$/i.test(segment) && /[0-9]/.test(segment) && /[a-z]/i.test(segment)) return true;
  return false;
}

/** Strips query string / fragment and replaces every id-shaped path segment
 *  with `[id]`, so the same logical route always produces the same pattern
 *  regardless of which row it was called for. */
export function routePattern(pathname: string): string {
  let pathOnly = pathname;
  try {
    pathOnly = new URL(pathname, "http://route-pattern.invalid").pathname;
  } catch {
    // Malformed input still goes through the conservative query/fragment and
    // id-segment stripping below; observability must never throw.
  }
  const withoutFragment = pathOnly.split("#")[0] ?? pathOnly;
  const withoutQuery = withoutFragment.split("?")[0] ?? withoutFragment;
  return withoutQuery
    .split("/")
    .map((segment) => (isIdSegment(segment) ? "[id]" : segment))
    .join("/");
}

/** Matches a V8 stack-trace frame line ending in `(path:line:col)` or
 *  `at path:line:col`, capturing the file path and line number. */
const STACK_FRAME_PATTERN = /\(?([^\s()]+):(\d+):\d+\)?\s*$/;

/** Reduces an absolute file path to a project-relative one starting at the
 *  first `lib/`, `app/`, `tests/` or `scripts/` segment. Falls back to the
 *  bare filename when none of those markers are found, so an unexpected path
 *  shape degrades to "no source text" rather than leaking a full disk path. */
function toRelativeSourcePath(absolutePath: string): string {
  const match = absolutePath.match(/[/\\](lib|app|tests|scripts)[/\\].*$/);
  if (match) return match[0].slice(1).replace(/\\/g, "/");
  const parts = absolutePath.split(/[/\\]/);
  return parts[parts.length - 1] ?? absolutePath;
}

/**
 * Reduces an error's stack trace to our own `"file:line"` frames only — no
 * function names, no source text, no `node_modules` frames, no absolute
 * paths outside the project.
 */
export function safeFrames(stack: string | undefined, limit = 5): string[] | undefined {
  if (!stack) return undefined;

  const frames: string[] = [];
  for (const rawLine of stack.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("at ")) continue;
    if (line.includes("node_modules")) continue;

    const match = line.match(STACK_FRAME_PATTERN);
    if (!match) continue;
    const [, filePath, lineNo] = match;
    if (!filePath || filePath.includes("node_modules")) continue;

    frames.push(`${toRelativeSourcePath(filePath)}:${lineNo}`);
    if (frames.length >= limit) break;
  }

  return frames.length > 0 ? frames : undefined;
}
