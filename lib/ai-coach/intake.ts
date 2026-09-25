import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";
import { deriveLegacyAllergyTokens, deriveLegacyDietaryRestrictions } from "./intake-allergens";
import { intakeAnswersSchema, intakeDraftSchema, intakeV2ConfirmSchema, isV2Intake } from "./intake-contract";
import type { IntakeDraftAnswers } from "./intake-contract";

/**
 * A03 — staged, confirmed intake: the DB-touching half.
 *
 * The schema/contract (`intakeAnswersSchema`, `intakeV2ConfirmSchema`,
 * every v2 enum/object schema, `PENDING_G01_WORDING`, `isV2Intake`) moved to
 * `./intake-contract` (T-2024 review round 4) — that module has no `db`
 * import, so `components/ai-coach/intake-wizard.tsx` (a `"use client"`
 * component) can import the confirm schema without pulling `lib/db.ts` /
 * `pg` into the browser bundle (Next.js bundles by module, not by
 * tree-shaken export). Everything from `./intake-contract` is re-exported
 * below so every existing server-side import of `./intake` /
 * `@/lib/ai-coach/intake` keeps working unchanged — this file must never be
 * imported from a client component again; only `./intake-contract` is
 * client-safe.
 */
export * from "./intake-contract";

export type SaveIntakeDraftResult =
  | { success: true; answers: IntakeDraftAnswers }
  | { success: false; error: Record<string, string[]> };

/** Merges partial answers into the existing draft. Never requires completeness. */
export async function saveIntakeDraft(clientId: string, rawPartialAnswers: unknown, transaction?: Prisma.TransactionClient): Promise<SaveIntakeDraftResult> {
  const parsed = intakeDraftSchema.safeParse(rawPartialAnswers);
  if (!parsed.success) {
    return { success: false, error: parsed.error.flatten().fieldErrors };
  }

  const client = transaction ?? db;
  const existing = await client.aiIntakeDraft.findUnique({ where: { clientId } });
  const merged = { ...(existing?.answers as IntakeDraftAnswers | undefined), ...parsed.data };

  await client.aiIntakeDraft.upsert({
    where: { clientId },
    create: { clientId, answers: merged as Prisma.InputJsonValue },
    update: { answers: merged as Prisma.InputJsonValue },
  });

  return { success: true, answers: merged };
}

export async function getIntakeDraft(clientId: string): Promise<IntakeDraftAnswers | null> {
  const draft = await db.aiIntakeDraft.findUnique({ where: { clientId } });
  return (draft?.answers as IntakeDraftAnswers | undefined) ?? null;
}

export type ConfirmIntakeResult =
  | { success: true; profileRevision: number }
  | { success: false; error: Record<string, string[]> | string };

/**
 * Confirms a complete intake — the only path that writes
 * AiCoachProfile.confirmedIntake and bumps profileRevision. The draft row
 * is removed once confirmed (it is no longer a draft, and keeping a stale
 * copy around risks it being read as if still pending).
 *
 * Branches on `answers.intakeVersion` (T-2002/T-2024): a v2-shaped confirm
 * is validated with `intakeV2ConfirmSchema`, the server sets `capturedAt`
 * (the client's value, if any, is never trusted), and the legacy
 * `allergies`/`dietaryRestrictions` projections are derived here — the only
 * writer of those two arrays in v2 mode — before the upsert. A v1-shaped
 * confirm (no `intakeVersion`) keeps using the permissive read schema
 * exactly as before.
 */
export async function confirmIntake(clientId: string, rawAnswers: unknown, transaction?: Prisma.TransactionClient): Promise<ConfirmIntakeResult> {
  const version: 1 | 2 = isV2Intake(rawAnswers) ? 2 : 1;
  let dataToStore: Prisma.InputJsonValue;

  if (version === 2) {
    const parsed = intakeV2ConfirmSchema.safeParse(rawAnswers);
    if (!parsed.success) {
      return { success: false, error: parsed.error.flatten().fieldErrors };
    }
    const capturedAt = new Date().toISOString();
    const allergies = deriveLegacyAllergyTokens(parsed.data.allergenDeclarations);
    const dietaryRestrictions = deriveLegacyDietaryRestrictions(parsed.data.dietaryPattern);
    dataToStore = {
      ...parsed.data,
      capturedAt,
      allergies,
      dietaryRestrictions,
    } as unknown as Prisma.InputJsonValue;
  } else {
    const parsed = intakeAnswersSchema.safeParse(rawAnswers);
    if (!parsed.success) {
      return { success: false, error: parsed.error.flatten().fieldErrors };
    }
    dataToStore = parsed.data as unknown as Prisma.InputJsonValue;
  }

  const confirm = async (tx: Prisma.TransactionClient) => {
    const updated = await tx.aiCoachProfile.upsert({
      where: { clientId },
      create: { clientId, confirmedIntake: dataToStore, profileRevision: 1, consentedAt: new Date() },
      update: { confirmedIntake: dataToStore, profileRevision: { increment: 1 } },
    });
    await tx.aiIntakeDraft.deleteMany({ where: { clientId } });
    return updated;
  };
  const profile = transaction ? await confirm(transaction) : await db.$transaction(confirm);
  return { success: true, profileRevision: profile.profileRevision };
}
