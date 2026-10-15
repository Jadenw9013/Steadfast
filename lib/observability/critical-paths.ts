/**
 * Route patterns where a 5xx means a coach or client cannot complete their
 * work. T-923 consumes this list as alerting policy.
 */
export const CRITICAL_ROUTE_PATTERNS: readonly string[] = [
  "/api/coach/clients/[id]/meal-plan",
  "/api/coach/clients/[id]/meal-plan/publish",
  "/api/coach/clients/[id]/training",
  "/api/coach/clients/[id]/training/publish",
  "/api/client/checkin",
  "/api/messages",
  "/api/mealplans/import-plan",
];

export function isCriticalRoute(pattern: string | undefined): boolean {
  return pattern !== undefined && CRITICAL_ROUTE_PATTERNS.includes(pattern);
}
