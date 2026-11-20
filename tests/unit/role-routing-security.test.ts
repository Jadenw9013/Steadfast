import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: { id: "self", isClient: true, isCoach: false } as null | { id: string; isClient: boolean; isCoach: boolean }, update: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { update: mocks.update } } }));
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: async () => { if (!mocks.user) throw new Error("Not authenticated"); return mocks.user; } }));
vi.mock("@/lib/observability/report", () => ({ reportServerError: mocks.report }));
import { PATCH } from "@/app/api/switch-role/route";
import { POST } from "@/app/api/me/role/route";

beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: "self", isClient: true, isCoach: false }; mocks.update.mockResolvedValue({ id: "self", activeRole: "CLIENT" }); });
describe.each([["PATCH", PATCH], ["POST", POST]] as const)("%s role transport", (method, handler) => {
  const request = (body: string) => new NextRequest("https://example.test/api/role", { method, headers: { "content-type": "application/json" }, body });
  it("requires a session", async () => {
    mocks.user = null;
    expect((await handler(request('{"role":"CLIENT"}'))).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses role escalation regardless of body-supplied flags or ids", async () => {
    expect((await handler(request('{"role":"COACH","isCoach":true,"id":"victim"}'))).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns 400 for malformed JSON without mutating a role", async () => {
    expect((await handler(request("{"))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("bounds request size", async () => {
    expect((await handler(request(JSON.stringify({ role: "CLIENT", extra: "x".repeat(2048) })))).status).toBe(413);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("updates only the signed-in account when its capability permits the role", async () => {
    expect((await handler(request('{"role":"CLIENT","id":"victim"}'))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "self" }, data: { activeRole: "CLIENT" } }));
  });
  it("reports a database failure and returns a safe error", async () => {
    mocks.update.mockRejectedValueOnce(new Error("private database failure"));
    const response = await handler(request('{"role":"CLIENT"}'));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database failure");
    expect(mocks.report).toHaveBeenCalledOnce();
  });
});
