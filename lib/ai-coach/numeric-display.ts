/**
 * T-2030 review r1 MINOR 5 — the single formatter that turns a validated
 * numeric target into the string a client reads, shared between the
 * bounded-prose validator/prompt (`provider/constrained-boundary.ts`,
 * `provider/explanation-prose.ts` — server-only) and the plan display card
 * (`components/ai-coach/plan-display.tsx`, reachable from a "use client"
 * tree via `components/ai-coach/experience.tsx`). Deliberately
 * dependency-free — no `db`, no `fetch`, no `process.env`, no `Date` — so
 * it is safe to import from client code without pulling a server-only
 * module (and its Postgres driver) into the browser bundle.
 */
export function formatNumericDisplayValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
