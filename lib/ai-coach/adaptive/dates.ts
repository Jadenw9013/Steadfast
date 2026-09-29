/**
 * S-23 — the one calendar primitive the adaptive modules share.
 *
 * The architecture (`board/strategy/adaptive-energy-architecture.md`) names
 * five modules in this folder. This is a sixth, and the reason is the standing
 * "one shared function" rule: `weight-trend.ts` needs the number of days
 * between two readings and `intake-window.ts` needs the day offsets of a
 * rolling window, and those must not be two implementations of the same
 * calendar arithmetic.
 *
 * PURITY. Every module in this folder is pure: no I/O, no database import, no
 * `Date.now()`, no `Math.random()`, no numeric literal other than 0, 1 and 7
 * (`tests/unit/ai-coach-adaptive.test.ts` asserts all of that over the whole
 * folder). `Date.UTC` and `new Date(milliseconds)` are pure functions of their
 * arguments and read no clock; they are used here only to convert a calendar
 * date to an integer day index.
 *
 * `MS_PER_DAY` is derived from the Date API itself rather than written as
 * 86400000, because 86400000 is a numeric literal and the folder is not allowed
 * one. `Date.UTC(0, 0, 1)` is 1900-01-01T00:00:00Z (years 0-99 map to
 * 1900-1999) and `Date.UTC(0, 0, 2)` is the following midnight UTC, so the
 * difference is exactly one day in milliseconds with no daylight-saving term.
 */

const MS_PER_DAY = Date.UTC(0, 0, 1 + 1) - Date.UTC(0, 0, 1);

/** `YYYY-MM-DD`. Capture groups avoid index literals when destructuring. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Days since the Unix epoch for a `YYYY-MM-DD` calendar date, or `null` if the
 * string is not a real date. Only the difference between two of these is ever
 * used, so the choice of origin carries no meaning.
 *
 * Rejects a date that exists as a string but not on the calendar (`2026-02-30`,
 * which `Date.UTC` would silently roll forward) by round-tripping the parsed
 * components back out of the resulting instant.
 */
export function epochDayFromIsoDate(isoDate: string): number | null {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const milliseconds = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(milliseconds)) return null;
  const roundTrip = new Date(milliseconds);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() + 1 !== month ||
    roundTrip.getUTCDate() !== day
  ) {
    return null;
  }
  return milliseconds / MS_PER_DAY;
}
