import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@clerk/nextjs/server", async original => ({
  ...await original<typeof import("@clerk/nextjs/server")>(),
  clerkMiddleware: vi.fn(),
}));
import { createRouteMatcher } from "@clerk/nextjs/server";
import { PUBLIC_ROUTE_PATTERNS } from "@/proxy";

const publicRoute = createRouteMatcher([...PUBLIC_ROUTE_PATTERNS]);
describe("token onboarding entry points", () => {
  it.each(["/invite/synthetic-token", "/invite/team/synthetic-token", "/onboarding/intake/synthetic-token", "/onboarding/sign/synthetic-token"])("allows a signed-out prospect to reach %s", path => {
    expect(publicRoute(new NextRequest(`https://example.test${path}`))).toBe(true);
  });
  it.each(["/account", "/onboarding", "/client", "/coach/dashboard", "/api/client/home", "/api/intake/current", "/api/coach/leads/synthetic/activate", "/onboarding/intake/synthetic-token/private", "/onboarding/sign/synthetic-token/private"])("keeps %s protected", path => {
    expect(publicRoute(new NextRequest(`https://example.test${path}`))).toBe(false);
  });
});
