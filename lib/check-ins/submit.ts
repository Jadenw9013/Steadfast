import { z } from "zod";
import { db } from "@/lib/db";
import { isOwnedUploadPath } from "@/lib/validations/storage-path";
import { normalizeToMonday, getLocalDate } from "@/lib/utils/date";
import type { Prisma } from "@/app/generated/prisma/client";

/** Serialize Zod-validated data to Prisma-compatible JSON. */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Single source of truth for both check-in transport surfaces (the
 * `createCheckIn` server action and the iOS `/api/client/checkin` route —
 * CB07). Both MUST call this instead of re-implementing validation or the
 * overwrite transaction, so the two transports can't silently diverge again.
 *
 * `weight` is required — matching the web action's existing, deliberate
 * business rule (the API previously allowed omitting it; that was an
 * unintentional divergence, not a documented product decision).
 *
 * `photoPaths`: omit the field entirely (`undefined`) to leave existing
 * photos untouched on an overwrite. Pass an array — even `[]` — to
 * explicitly replace them. This distinction did not exist before: both
 * transports used to unconditionally delete-then-recreate photos on every
 * overwrite, so a caller that didn't resend existing paths silently lost
 * them (guaranteed data loss on the API, which never even accepted
 * photoPaths at all).
 */
export const submitCheckInSchema = z.object({
  weight: z.coerce.number().positive({ message: "Weight is required" }),
  bodyFatPct: z.coerce.number().min(0).max(100).optional(),
  dietCompliance: z.coerce.number().int().min(1).max(10).optional().or(z.literal("")),
  energyLevel: z.coerce.number().int().min(1).max(10).optional().or(z.literal("")),
  notes: z.string().max(5000).optional(),
  photoPaths: z.array(z.string()).max(3).optional(),
  overwriteToday: z.boolean().optional(),
  templateId: z.string().optional(),
  customResponses: z.record(z.string(), z.unknown()).optional(),
});

export type SubmitCheckInInput = z.infer<typeof submitCheckInSchema>;

export type SubmitCheckInResult =
  | { error: Record<string, string[]> }
  | { conflict: { code: "CHECKIN_EXISTS_TODAY"; existing: { id: string; submittedAt: string } } }
  | { checkInId: string; overwritten: boolean };

export async function submitCheckIn(
  user: { id: string; clerkId: string; timezone: string | null },
  rawInput: unknown
): Promise<SubmitCheckInResult> {
  const parsed = submitCheckInSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }
  const { weight, bodyFatPct, dietCompliance, energyLevel, notes, photoPaths, overwriteToday, templateId, customResponses } = parsed.data;

  const coachAssignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
    select: { id: true, coachId: true },
  });
  if (!coachAssignment) {
    return {
      error: {
        weekOf: ["You need to connect to a coach before submitting check-ins."],
      },
    };
  }

  if (photoPaths?.some((path) => !isOwnedUploadPath(path, user.clerkId))) {
    return { error: { photoPaths: ["One or more photos do not belong to your account. Please upload them again."] } };
  }

  // CB07: a template snapshot may only come from the client's own assigned
  // coach. Accepting a bare templateId and trusting whatever row it
  // resolves to would let a client (or a compromised/scripted client)
  // freeze an arbitrary, unrelated coach's questions into their own
  // check-in history.
  let templateSnapshot: { version: number; name: string; questions: unknown } | undefined;
  if (templateId) {
    const template = await db.checkInTemplate.findUnique({
      where: { id: templateId },
      select: { coachId: true, questions: true, version: true, name: true },
    });
    if (!template || template.coachId !== coachAssignment.coachId) {
      return { error: { templateId: ["This check-in template is not available."] } };
    }
    templateSnapshot = { version: template.version, name: template.name, questions: template.questions };
  }

  const now = new Date();
  const weekDate = normalizeToMonday(now);
  const tz = user.timezone || "America/Los_Angeles";
  const localDate = getLocalDate(now, tz);

  const checkInFields = {
    weight,
    bodyFatPct: bodyFatPct ?? null,
    dietCompliance: typeof dietCompliance === "number" ? dietCompliance : null,
    energyLevel: typeof energyLevel === "number" ? energyLevel : null,
    notes: notes || null,
    ...(templateId && { templateId }),
    ...(templateSnapshot && { templateSnapshot: toJsonValue(templateSnapshot) }),
    ...(customResponses && { customResponses: toJsonValue(customResponses) }),
  };

  const existingToday = await db.checkIn.findFirst({
    where: { clientId: user.id, localDate, deletedAt: null },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedAt: true },
  });

  if (existingToday && overwriteToday === undefined) {
    return {
      conflict: {
        code: "CHECKIN_EXISTS_TODAY",
        existing: { id: existingToday.id, submittedAt: existingToday.submittedAt.toISOString() },
      },
    };
  }

  if (existingToday && overwriteToday === true) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    // Only touch photos on an explicit replacement. Omitting photoPaths
    // entirely leaves whatever photos this check-in already had.
    if (photoPaths !== undefined) {
      ops.push(db.checkInPhoto.deleteMany({ where: { checkInId: existingToday.id } }));
    }
    ops.push(
      db.checkIn.update({
        where: { id: existingToday.id },
        data: {
          ...checkInFields,
          weekOf: weekDate,
          submittedAt: now,
          localDate,
          timezone: tz,
          status: "SUBMITTED",
          ...(photoPaths !== undefined && {
            photos: { create: photoPaths.map((path, i) => ({ storagePath: path, sortOrder: i })) },
          }),
        },
      })
    );
    const results = await db.$transaction(ops);
    const updated = results[results.length - 1] as { id: string };

    await postCheckInMessage(user.id, coachAssignment.coachId, weekDate, updated.id, now, notes);

    return { checkInId: updated.id, overwritten: true };
  }

  const checkIn = await db.checkIn.create({
    data: {
      clientId: user.id,
      weekOf: weekDate,
      isPrimary: true,
      submittedAt: now,
      localDate,
      timezone: tz,
      ...checkInFields,
      ...(photoPaths !== undefined && {
        photos: { create: photoPaths.map((path, i) => ({ storagePath: path, sortOrder: i })) },
      }),
    },
  });

  await postCheckInMessage(user.id, coachAssignment.coachId, weekDate, checkIn.id, now, notes);

  return { checkInId: checkIn.id, overwritten: false };
}

async function postCheckInMessage(clientId: string, coachId: string, weekOf: Date, checkInId: string, now: Date, notes: string | undefined) {
  try {
    const checkinDate = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const msgBody = `[CHECKIN:${checkInId}:${checkinDate}]${notes || "Check-in submitted"}`;
    await db.message.create({
      data: { clientId, coachId, weekOf, senderId: clientId, body: msgBody },
    });
  } catch { /* message creation must not break check-in */ }
}
