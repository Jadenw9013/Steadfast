import { z } from "zod";
import { db } from "@/lib/db";
import type { AiSafetyDisposition, AiDomainPermission, Prisma } from "@/app/generated/prisma/client";

/**
 * A03 — safety disclosure processing.
 *
 * *** SYNTHETIC FIXTURE POLICY — NOT CLINICAL GUIDANCE ***
 * The question set and the rule table below exist only to exercise the
 * control flow (immediate, synchronous restriction on a structured
 * report; never loosening an existing restriction; "unsure" treated as a
 * real answer, not a negative one). Real numerical/clinical thresholds
 * must come from docs/ai-coach/13's gate G01 (qualified nutrition and
 * exercise reviewers) — this file must never be the source of an actual
 * safety decision for a real user. See
 * docs/ai-coach/06-Coaching-Policy-and-AI.md §1–2.
 */

export const triStateSchema = z.enum(["YES", "NO", "UNSURE"]);
export type TriState = z.infer<typeof triStateSchema>;

export const safetyDisclosureSchema = z.object({
  chestPainDuringExercise: triStateSchema,
  dizzinessOrFainting: triStateSchema,
  heartCondition: triStateSchema,
  pregnantOrPostpartum: triStateSchema,
  recentInjuryOrSurgery: triStateSchema,
}).strict();
export type SafetyDisclosureInput = z.infer<typeof safetyDisclosureSchema>;

const DISPOSITION_ORDER: AiSafetyDisposition[] = ["CLEAR", "CLARIFY", "RESTRICTED", "REFER", "URGENT"];
const DOMAIN_ORDER: AiDomainPermission[] = ["ALLOW", "HOLD_ONLY", "PAUSED"];

function moreRestrictiveDisposition(a: AiSafetyDisposition, b: AiSafetyDisposition): AiSafetyDisposition {
  return DISPOSITION_ORDER.indexOf(a) >= DISPOSITION_ORDER.indexOf(b) ? a : b;
}
function moreRestrictiveDomain(a: AiDomainPermission, b: AiDomainPermission): AiDomainPermission {
  return DOMAIN_ORDER.indexOf(a) >= DOMAIN_ORDER.indexOf(b) ? a : b;
}

interface ComputedRestriction {
  disposition: AiSafetyDisposition;
  nutrition: AiDomainPermission;
  strength: AiDomainPermission;
  cardio: AiDomainPermission;
}

/** SYNTHETIC rule table — see module docstring. Never used for a real user. */
function evaluateSyntheticSafetyRules(answers: SafetyDisclosureInput): ComputedRestriction {
  let disposition: AiSafetyDisposition = "CLEAR";
  let nutrition: AiDomainPermission = "ALLOW";
  let strength: AiDomainPermission = "ALLOW";
  let cardio: AiDomainPermission = "ALLOW";

  const escalate = (d: AiSafetyDisposition) => { disposition = moreRestrictiveDisposition(disposition, d); };

  if (answers.chestPainDuringExercise === "YES" || answers.dizzinessOrFainting === "YES" || answers.heartCondition === "YES") {
    escalate("URGENT");
    nutrition = moreRestrictiveDomain(nutrition, "PAUSED");
    strength = moreRestrictiveDomain(strength, "PAUSED");
    cardio = moreRestrictiveDomain(cardio, "PAUSED");
  }
  if (answers.pregnantOrPostpartum === "YES") {
    escalate("REFER");
    nutrition = moreRestrictiveDomain(nutrition, "HOLD_ONLY");
    strength = moreRestrictiveDomain(strength, "HOLD_ONLY");
    cardio = moreRestrictiveDomain(cardio, "HOLD_ONLY");
  }
  if (answers.recentInjuryOrSurgery === "YES") {
    escalate("RESTRICTED");
    strength = moreRestrictiveDomain(strength, "HOLD_ONLY");
  }

  // "Failure to classify a possible material concern conservatively
  // restricts the affected domain pending clarification" — an "unsure"
  // answer is never treated as equivalent to "no."
  const unsureDomains: { field: keyof SafetyDisclosureInput; domains: ("nutrition" | "strength" | "cardio")[] }[] = [
    { field: "chestPainDuringExercise", domains: ["strength", "cardio"] },
    { field: "dizzinessOrFainting", domains: ["strength", "cardio"] },
    { field: "heartCondition", domains: ["strength", "cardio"] },
    { field: "pregnantOrPostpartum", domains: ["nutrition", "strength", "cardio"] },
    { field: "recentInjuryOrSurgery", domains: ["strength"] },
  ];
  for (const { field, domains } of unsureDomains) {
    if (answers[field] === "UNSURE") {
      escalate("CLARIFY");
      for (const d of domains) {
        if (d === "nutrition") nutrition = moreRestrictiveDomain(nutrition, "HOLD_ONLY");
        if (d === "strength") strength = moreRestrictiveDomain(strength, "HOLD_ONLY");
        if (d === "cardio") cardio = moreRestrictiveDomain(cardio, "HOLD_ONLY");
      }
    }
  }

  return { disposition, nutrition, strength, cardio };
}

export type SubmitSafetyDisclosureResult =
  | { success: true; disposition: AiSafetyDisposition; safetyRevision: number }
  | { success: false; error: string };

/**
 * Processes a structured safety disclosure independently of the general
 * intake draft's completeness — a valid disclosure applies immediately
 * even if unrelated draft fields are invalid (docs/ai-coach/05). Never
 * waits on a model/queue: this is a plain, synchronous DB transaction. A
 * new disclosure can only make the disposition/domain permissions equal
 * or MORE restrictive than they already were — it can never clear an
 * existing restriction (that's clearSafetyRestriction's job, a distinct,
 * deliberate action never reachable from this function).
 */
export async function submitSafetyDisclosure(clientId: string, rawAnswers: unknown, transaction?: Prisma.TransactionClient): Promise<SubmitSafetyDisclosureResult> {
  const parsed = safetyDisclosureSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    return { success: false, error: "Invalid safety disclosure — every question requires yes, no, or unsure." };
  }

  const computed = evaluateSyntheticSafetyRules(parsed.data);

  const apply = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.aiCoachProfile.findUnique({ where: { clientId } });

    const nextDisposition = existing ? moreRestrictiveDisposition(existing.safetyDisposition, computed.disposition) : computed.disposition;
    const nextNutrition = existing ? moreRestrictiveDomain(existing.nutritionPermission, computed.nutrition) : computed.nutrition;
    const nextStrength = existing ? moreRestrictiveDomain(existing.strengthPermission, computed.strength) : computed.strength;
    const nextCardio = existing ? moreRestrictiveDomain(existing.cardioPermission, computed.cardio) : computed.cardio;

    const profile = await tx.aiCoachProfile.upsert({
      where: { clientId },
      create: {
        clientId,
        safetyDisposition: nextDisposition,
        nutritionPermission: nextNutrition,
        strengthPermission: nextStrength,
        cardioPermission: nextCardio,
        safetyRevision: 1,
      },
      update: {
        safetyDisposition: nextDisposition,
        nutritionPermission: nextNutrition,
        strengthPermission: nextStrength,
        cardioPermission: nextCardio,
        safetyRevision: { increment: 1 },
      },
    });

    await tx.aiSafetyDisclosureEvent.create({
      data: {
        clientId,
        structuredAnswers: parsed.data as unknown as Prisma.InputJsonValue,
        dispositionAfter: profile.safetyDisposition,
        nutritionPermissionAfter: profile.nutritionPermission,
        strengthPermissionAfter: profile.strengthPermission,
        cardioPermissionAfter: profile.cardioPermission,
        safetyRevisionAfter: profile.safetyRevision,
      },
    });

    return profile;
  };
  const result = transaction ? await apply(transaction) : await db.$transaction(apply);
  return { success: true, disposition: result.safetyDisposition, safetyRevision: result.safetyRevision };
}

export type ClearSafetyRestrictionResult = { success: true } | { success: false; error: string };

/** Retired unscoped placeholder. Call resolveAiSafety with the reviewed case,
 * expected revision, domain scope and audit reference. No legacy caller may
 * clear restrictions merely by possessing a grant. */
export async function clearSafetyRestriction(
  _clientId: string,
  _resolverUserId: string,
  _next: { disposition: AiSafetyDisposition; nutrition: AiDomainPermission; strength: AiDomainPermission; cardio: AiDomainPermission }
): Promise<ClearSafetyRestrictionResult> {
  void [_clientId, _resolverUserId, _next];
  return { success: false, error: "Use the scoped, revisioned safety-resolution workflow." };
}
