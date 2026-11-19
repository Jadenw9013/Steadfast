import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), pending: vi.fn(), create: vi.fn(), email: vi.fn(), update: vi.fn(), insert: vi.fn(), quota: vi.fn(),
  counts: new Map<string, number>(),
}));
vi.mock("@/lib/db", () => ({ db: {
  coachProfile: { findUnique: mocks.profile }, coachingRequest: { findFirst: mocks.pending, create: mocks.create },
  user: { update: mocks.update }, $executeRawUnsafe: mocks.insert,
} }));
vi.mock("@/lib/security/quota", () => ({ consumeQuota: mocks.quota }));
vi.mock("@/lib/observability/report", () => ({ reportAnomaly: vi.fn(), reportServerError: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => ({ id: "synthetic-user", isCoach: false }), ensureCoachCode: vi.fn() }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: mocks.email }));
vi.mock("@/lib/email/templates", () => ({ newRequestNotificationEmail: () => ({ subject: "Synthetic", html: "Synthetic" }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

function request(path: string, body: unknown) {
  return new NextRequest(`https://example.test${path}`, { method: "POST", body: JSON.stringify(body) });
}
const profileId = "c1234567890123456789012345";
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.counts.clear();
  vi.stubEnv("STEADFAST_COACH_ACCESS_CODE", "synthetic-secret");
  vi.stubEnv("VERCEL", "0");
  mocks.quota.mockImplementation(async (scope: string, key: string, limit: number) => {
    const id = `${scope}:${key}`;
    const count = (mocks.counts.get(id) ?? 0) + 1;
    mocks.counts.set(id, count);
    return count <= limit;
  });
  mocks.profile.mockResolvedValue({ id: profileId, isPublished: true, acceptingClients: true,
    user: { id: "coach", firstName: "Fixture", email: "coach@example.test", emailCoachingRequests: true, pushCoachingRequests: false } });
  mocks.pending.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "request" });
  mocks.email.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("shared abuse prevention", () => {
  it("shares coach attempts across REST, actions, and fresh workers", async () => {
    const route = await import("@/app/api/become-coach/route");
    for (let attempt = 0; attempt < 3; attempt++) expect((await route.POST(request("/api/become-coach", { accessCode: "wrong" }))).status).toBe(403);
    const action = await import("@/app/actions/become-coach");
    expect((await action.becomeCoach({ accessCode: "synthetic-secret" }))?.error).toMatch(/Too many/);
    vi.resetModules();
    const fresh = await import("@/app/api/become-coach/route");
    expect((await fresh.POST(request("/api/become-coach", { accessCode: "wrong" }))).status).toBe(429);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("fails closed when the durable quota is unavailable", async () => {
    mocks.quota.mockRejectedValue(new Error("synthetic outage"));
    const route = await import("@/app/api/become-coach/route");
    expect((await route.POST(request("/api/become-coach", { accessCode: "synthetic-secret" }))).status).toBe(503);
    const action = await import("@/app/actions/become-coach");
    expect((await action.becomeCoach({ accessCode: "synthetic-secret" }))?.error).toMatch(/unavailable/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized bodies without side effects", async () => {
    const route = await import("@/app/api/public/coaching-request/route");
    expect((await route.POST(new NextRequest("https://example.test/api/public/coaching-request", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await route.POST(request("/api/public/coaching-request", { message: "x".repeat(9000) }))).status).toBe(413);
    const registration = await import("@/app/api/become-coach/route");
    expect((await registration.POST(request("/api/become-coach", { accessCode: "x".repeat(300) }))).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("rejects non-phone strings and normalizes phone aliases for deduplication", async () => {
    const { phoneNumberSchema } = await import("@/lib/security/public-submissions");
    expect(phoneNumberSchema.safeParse("not-a-phone-1").success).toBe(false);
    expect(phoneNumberSchema.parse("(415) 555-0100")).toBe("+14155550100");
    expect(phoneNumberSchema.parse("+1 415 555 0100")).toBe("+14155550100");
    const route = await import("@/app/api/public/coaching-request/route");
    expect((await route.POST(request("/api/public/coaching-request", { coachSlug: "fixture", firstName: "Fixture", phoneNumber: "not-a-phone-1" }))).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("caps anonymous writes and notifications across both entry points", async () => {
    const route = await import("@/app/api/public/coaching-request/route");
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await route.POST(request("/api/public/coaching-request", { coachSlug: "fixture", firstName: "Fixture", phoneNumber: `415555010${attempt}` }))).status).toBe(200);
    }
    const action = await import("@/app/actions/coaching-requests");
    expect(await action.submitCoachingRequest({ coachProfileId: profileId, prospectName: "Fixture", prospectEmail: "4155550199", intakeAnswers: { goals: "Synthetic goals" } })).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(mocks.create).toHaveBeenCalledTimes(5);
    expect(mocks.email).toHaveBeenCalledTimes(5);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("refuses lead writes and notifications during quota outages", async () => {
    mocks.quota.mockRejectedValue(new Error("synthetic outage"));
    const route = await import("@/app/api/public/coaching-request/route");
    expect((await route.POST(request("/api/public/coaching-request", { coachSlug: "fixture", firstName: "Fixture", phoneNumber: "4155550100" }))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it("ignores spoofable forwarding headers outside Vercel", async () => {
    const { submissionSource } = await import("@/lib/security/public-submissions");
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4", "x-vercel-forwarded-for": "5.6.7.8" });
    expect(submissionSource(headers)).toBe("untrusted-source");
    vi.stubEnv("VERCEL", "1");
    expect(submissionSource(headers)).toBe("5.6.7.8");
    headers.delete("x-vercel-forwarded-for");
    expect(submissionSource(headers)).toBe("unknown-source");
  });
});
