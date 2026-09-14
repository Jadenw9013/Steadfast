import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
/** Dedicated synthetic fixture only. Never creates grants for real accounts. */
export async function assignFixtureReviewer(clientId: string) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (process.env.SECURITY_INTEGRATION !== "1" || url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required");
  const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
  return db.aiCoachReviewerGrant.create({ data: { userId: user.id, clientIds: [clientId], domains: ["NUTRITION", "STRENGTH", "CARDIO"], qualificationNote: "SYNTHETIC TEST REVIEWER" } });
}
