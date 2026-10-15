import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireLocalTestDb } from "./require-local-test-db";
/** Dedicated synthetic fixture only. Never creates grants for real accounts. */
export async function assignFixtureReviewer(clientId: string) {
  if (process.env.SECURITY_INTEGRATION !== "1") throw new Error("Dedicated local test database required");
  requireLocalTestDb();
  const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
  return db.aiCoachReviewerGrant.create({ data: { userId: user.id, clientIds: [clientId], domains: ["NUTRITION", "STRENGTH", "CARDIO"], qualificationNote: "SYNTHETIC TEST REVIEWER" } });
}
