import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accountHome, accountReturnTo, authEntryUrl } from "@/lib/auth/entry";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), report: vi.fn(), invite: vi.fn(), redeem: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: mocks.user }));
vi.mock("@/lib/observability/report", () => ({ reportServerError: mocks.report }));
vi.mock("@/app/actions/client-invites", () => ({ getInviteDetails: mocks.invite, redeemInvite: mocks.redeem }));
vi.mock("next/navigation", async original => ({
  ...await original<typeof import("next/navigation")>(),
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));
vi.mock("@clerk/nextjs", () => ({ SignIn: mocks.signIn, SignUp: mocks.signUp }));
vi.mock("@clerk/themes", () => ({ dark: {} }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: (props: { href: string; children: React.ReactNode }) => createElement("a", props) }));
import SignInPage from "@/app/sign-in/[[...sign-in]]/page";
import SignUpPage from "@/app/sign-up/[[...sign-up]]/page";
import AccountPage from "@/app/account/page";
import Home from "@/app/page";
import InvitePage from "@/app/invite/[token]/page";
import { AccountEntry } from "@/components/auth/account-entry";
import { requestApprovedEmail } from "@/lib/email/templates";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: null });
  mocks.signIn.mockReturnValue(null);
  mocks.signUp.mockReturnValue(null);
});

describe("safe authentication return destinations", () => {
  it.each([
    "/client", "/client/meal-plan", "/coach/dashboard", "/coach/clients/client-123",
    "/onboarding", "/onboarding/intake/test-token", "/onboarding/sign/test-token",
    "/invite/test-token", "/invite/team/test-token", "/client?welcomed=1", "/account-deletion-pending",
  ])("preserves %s", destination => {
    expect(accountReturnTo(destination)).toBe(destination);
    expect(new URL(authEntryUrl(destination), "https://example.test").searchParams.get("redirect_url")).toBe(destination);
  });

  it.each([
    undefined, null, 1, ["/client", "https://evil.test"], "", "/", "https://evil.test/client",
    "//evil.test/client", "/\\evil.test", "javascript:alert(1)", "data:text/html,test",
    "/sign-in", "/sign-up", "/api/client/home", "/client/../../sign-in", "/client//evil.test",
    "/client/%2f%2fevil.test", "/client/%255cevil.test", "/client/%0d%0aLocation:evil",
    "/client/\n", "/client/%", "/onboarding/unknown", "/account/anything", "/client" + "x".repeat(2048),
  ])("falls back safely for %j", destination => {
    expect(accountReturnTo(destination)).toBe("/account");
  });

  it("accepts the configured origin but not lookalikes or alternate protocols", () => {
    expect(accountReturnTo("https://app.example.test/invite/token", "https://app.example.test")).toBe("/invite/token");
    expect(accountReturnTo("http://app.example.test/client", "https://app.example.test")).toBe("/account");
    expect(accountReturnTo("https://app.example.test.evil.test/client", "https://app.example.test")).toBe("/account");
    expect(accountReturnTo("https://app.example.test@evil.test/client", "https://app.example.test")).toBe("/account");
  });
});

describe("one entry for new and returning accounts", () => {
  it("uses Clerk's combined flow and the same safe destination for both outcomes", async () => {
    const page = await SignInPage({ searchParams: Promise.resolve({ redirect_url: "/invite/synthetic" }) });
    const html = renderToStaticMarkup(page);
    expect(mocks.signIn.mock.calls[0][0]).toMatchObject({ withSignUp: true, path: "/sign-in", forceRedirectUrl: "/invite/synthetic", signUpForceRedirectUrl: "/invite/synthetic" });
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(html).toContain("don&#x27;t need to request coaching again");
    expect(html).toContain("Trouble getting an email?");
    expect(html).toContain("Not Medical Advice:");
    expect(html).toContain("Consult Your Doctor:");
  });

  it("ignores attacker redirect props and an external redirect_url", async () => {
    const page = await SignInPage({ searchParams: Promise.resolve({ redirect_url: "https://evil.test", sign_in_force_redirect_url: "https://evil.test", sign_up_force_redirect_url: "https://evil.test" }) });
    renderToStaticMarkup(page);
    expect(mocks.signIn.mock.calls[0][0]).toMatchObject({ forceRedirectUrl: "/account", signUpForceRedirectUrl: "/account" });
  });

  it("returns an already-signed-in user to the invite instead of starting authentication again", async () => {
    mocks.auth.mockResolvedValue({ userId: "signed-in" });
    await expect(SignInPage({ searchParams: Promise.resolve({ redirect_url: "/invite/synthetic" }) })).rejects.toThrow("REDIRECT:/invite/synthetic");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("redirects an old signup link to the unified entry without losing its invite", async () => {
    await expect(SignUpPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ redirect_url: "/invite/team/synthetic" }) })).rejects.toThrow("REDIRECT:/sign-in?redirect_url=%2Finvite%2Fteam%2Fsynthetic");
  });

  it.each([
    { route: { "sign-up": ["verify-email-address"] }, query: {} },
    { route: { "sign-up": ["sso-callback"] }, query: {} },
    { route: {}, query: { __clerk_ticket: "synthetic-ticket" } },
    { route: {}, query: { __clerk_status: "complete" } },
  ])("preserves legacy Clerk verification, ticket and OAuth callbacks: %j", async ({ route, query }) => {
    const page = await SignUpPage({ params: Promise.resolve(route), searchParams: Promise.resolve({ ...query, redirect_url: "/invite/synthetic" }) });
    renderToStaticMarkup(page);
    expect(mocks.signUp.mock.calls[0][0]).toMatchObject({ path: "/sign-up", forceRedirectUrl: "/invite/synthetic", signInForceRedirectUrl: "/invite/synthetic" });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("retains required legal information in the compatibility signup shell", () => {
    const html = renderToStaticMarkup(createElement(AccountEntry, { returnTo: "/account", legacySignUp: true }));
    expect(html).toContain("Medical Disclaimer &amp; Liability Notice");
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it("doesn't promise automatic connection or require a new request in approval emails", () => {
    const { text } = requestApprovedEmail("Synthetic client", "Synthetic coach");
    expect(text).toContain("/sign-in");
    expect(text).not.toContain("/sign-up");
    expect(text).not.toContain("connect you automatically");
    expect(text).toContain("accept the pending invite");
  });

  it("offers one continue button on a signed-out client invite without redeeming it", async () => {
    mocks.invite.mockResolvedValue({ status: "PENDING", expiresAt: new Date(Date.now() + 86400000), coach: { firstName: "Synthetic", lastName: "Coach", coachProfile: null } });
    const html = renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ token: "synthetic-token" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/sign-in?redirect_url=%2Finvite%2Fsynthetic-token"');
    expect(html).toContain("Continue to accept invite");
    expect(html).not.toContain("/sign-up");
    expect(mocks.redeem).not.toHaveBeenCalled();
  });
});

describe("authoritative account routing", () => {
  it.each([
    { activeRole: "COACH", isDeactivated: false, destination: "/coach/dashboard" },
    { activeRole: "CLIENT", isDeactivated: false, destination: "/client" },
    { activeRole: "COACH", isDeactivated: true, destination: "/account-deletion-pending" },
    { activeRole: "CLIENT", isDeactivated: true, destination: "/account-deletion-pending" },
  ])("routes $activeRole, deactivated=$isDeactivated", async ({ destination, ...user }) => {
    expect(accountHome(user)).toBe(destination);
    mocks.user.mockResolvedValue(user);
    await expect(AccountPage()).rejects.toThrow(`REDIRECT:${destination}`);
    expect(mocks.user).toHaveBeenCalledWith({ allowInactive: true });
  });

  it("does not choose a workspace using stale Clerk role claims", async () => {
    mocks.auth.mockResolvedValue({ userId: "signed-in", sessionClaims: { metadata: { role: "coach" } } });
    await expect(Home()).rejects.toThrow("REDIRECT:/account");
    mocks.user.mockResolvedValue({ activeRole: "CLIENT", isDeactivated: false });
    await expect(AccountPage()).rejects.toThrow("REDIRECT:/client");
  });

  it("reports an account lookup failure without exposing database details", async () => {
    mocks.user.mockRejectedValueOnce(new Error("private database details"));
    await expect(AccountPage()).rejects.toThrow("We couldn't open your account");
    expect(mocks.report).toHaveBeenCalledWith("sf.auth.account_entry_failed", expect.any(Error), { route: "/account", method: "GET" });
  });

  it("preserves Next's dynamic-render signal rather than turning it into an account failure", async () => {
    const signal = Object.assign(new Error("Dynamic server usage"), { digest: "DYNAMIC_SERVER_USAGE" });
    mocks.user.mockRejectedValueOnce(signal);
    await expect(AccountPage()).rejects.toBe(signal);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
