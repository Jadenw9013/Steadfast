import { createHash } from "crypto";
import { db } from "@/lib/db";

/** Atomic fixed-window quota shared by all application instances. */
export async function consumeQuota(scope: string, userId: string, limit: number, windowSeconds: number) {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = createHash("sha256").update(`${scope}:${userId}:${window}`).digest("hex");
  const expiresAt = new Date((window + 1) * windowSeconds * 1000);
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RequestQuota" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = "RequestQuota"."count" + 1
    RETURNING "count"
  `;
  return rows[0].count <= limit;
}

/** One reminder batch per local calendar day, including retries and concurrent cron runs. */
export async function claimDailyReminder(kind: string, userId: string, localDate: string) {
  const key = createHash("sha256").update(`reminder:${kind}:${userId}:${localDate}`).digest("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RequestQuota" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO NOTHING RETURNING "count"
  `;
  return rows.length === 1;
}
