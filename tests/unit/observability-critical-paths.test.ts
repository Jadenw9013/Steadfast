import { describe, expect, it } from "vitest";
import {
  CRITICAL_ROUTE_PATTERNS,
  isCriticalRoute,
} from "@/lib/observability/critical-paths";

describe("critical observability route patterns", () => {
  it("recognizes every declared critical route", () => {
    for (const route of CRITICAL_ROUTE_PATTERNS) {
      expect(isCriticalRoute(route), route).toBe(true);
    }
  });

  it("does not classify public or observability pages as critical", () => {
    expect(isCriticalRoute("/api/public/coaches")).toBe(false);
    expect(isCriticalRoute("/api/ops/ai-coach")).toBe(false);
    expect(isCriticalRoute(undefined)).toBe(false);
  });
});
