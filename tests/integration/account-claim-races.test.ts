import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
const webhook = vi.hoisted(() => ({ event: null as unknown }));
vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: async () => webhook.event }));
import { db } from "@/lib/db";
import { claimPendingUser } from "@/lib/auth/claim-pending-user";
import { POST } from "@/app/api/webhooks/clerk/route";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
const users: string[] = [];
afterAll(async () => {
  if (enabled) await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
suite("account identity and role race protection", () => {
  async function placeholder() {
    const key = randomUUID();
    const user = await db.user.create({ data: { clerkId: `pending_${key}`, email: `${key}@example.test`, isClient: true } });
    users.push(user.id);
    return user;
  }
  it("a stale placeholder claim cannot replace the winning identity", async () => {
    const user = await placeholder();
    const input = { id: user.id, pendingClerkId: user.clerkId, firstName: "Fixture", lastName: null };
    const results = await Promise.all([
      claimPendingUser({ ...input, clerkId: `first_${randomUUID()}` }),
      claimPendingUser({ ...input, clerkId: `second_${randomUUID()}` }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).clerkId).toBe(results.find(Boolean)!.clerkId);
  });
  it("concurrent claims by the same identity are idempotent", async () => {
    const user = await placeholder();
    const input = { id: user.id, pendingClerkId: user.clerkId, clerkId: randomUUID(), firstName: "Fixture", lastName: null };
    const results = await Promise.all([claimPendingUser(input), claimPendingUser(input)]);
    expect(results.every((result) => result?.id === user.id)).toBe(true);
  });
  it("replayed user.created preserves coach access, client access and the selected role", async () => {
    const user = await placeholder();
    await db.user.update({ where: { id: user.id }, data: { isCoach: true, isClient: true, activeRole: "COACH" } });
    webhook.event = { type: "user.created", data: {
      id: user.clerkId, first_name: "Fixture", last_name: null, public_metadata: {}, primary_email_address_id: "primary",
      email_addresses: [{ id: "primary", email_address: user.email, verification: { status: "verified" } }],
    } };
    expect((await POST(new NextRequest("https://example.test/api/webhooks/clerk", { method: "POST" }))).status).toBe(200);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ isCoach: true, isClient: true, activeRole: "COACH" });
  });
});
