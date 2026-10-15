import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";
import {
  policyBundleContentSchema,
  type PolicyBundleContent,
} from "@/lib/ai-coach/artifacts/schema";
import { ArtifactLoadError } from "@/lib/ai-coach/artifacts/repository";
import {
  NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE,
  resolveNutritionSafetyPolicy,
} from "@/lib/ai-coach/nutrition-safety";
import { resolvePrescriptionParameters } from "@/lib/ai-coach/prescription/parameters";

/**
 * S-25 — the two nutrition safety floors, and the proof that the half-applied
 * states between "placeholder" and "adopted" cannot be reached.
 *
 * `steadfast-hq/board/DOSE-WORKSHEET-3.md` section C measured what those
 * half-states do: repointing a `nutritionLimits` hook to a real id without
 * adding the matching parameter throws a `ZodError`, and adding it with the
 * wrong unit throws an `ArtifactLoadError`, in the executor and in
 * finalization, for every client. That is why the hook name, the parameter,
 * its unit and its applicability rule landed in a single edit.
 *
 * "Unreachable, not merely untaken" is what this file asserts, and the two
 * halves of it are different in kind:
 *
 *  - **Hook without parameter is unrepresentable.** Both halves live in one
 *    file behind one strict parse, and `policyBundleContentSchema`'s own
 *    `superRefine` rejects a `nutritionLimits` hook naming a parameter the
 *    bundle does not carry. Such a bundle cannot be loaded, registered or
 *    published, so no runtime ever holds one.
 *  - **Parameter with the wrong unit, rule or a non-positive value parses,
 *    and then refuses.** `resolveNutritionSafetyPolicy` throws before any
 *    parameter set exists, and it is the first call
 *    `resolvePrescriptionParametersForArtifacts` makes, so a target can never
 *    be computed against a half-resolved floor.
 *
 * Every mutation below is applied to a deep copy; the committed artifact is
 * never written.
 */

const MIN_ID = "SAFETY.NUTRITION.MIN_DAILY_ENERGY.FLOOR.V1";
const MAX_ID = "SAFETY.NUTRITION.MAX_WEEKLY_LOSS_RATE.CEILING.V1";

function bundle(): PolicyBundleContent {
  return structuredClone(loadDraftUnsignedPolicyBundle().content);
}

function withoutParameter(id: string): PolicyBundleContent {
  const content = bundle();
  content.numericParameters = content.numericParameters.filter(
    (parameter) => parameter.id !== id
  );
  return content;
}

function patchParameter(
  id: string,
  patch: Partial<PolicyBundleContent["numericParameters"][number]>
): PolicyBundleContent {
  const content = bundle();
  content.numericParameters = content.numericParameters.map((parameter) =>
    parameter.id === id ? { ...parameter, ...patch } : parameter
  );
  return content;
}

describe("S-25 — the committed bundle's nutrition safety floors", () => {
  it("resolves both floors, with the ids, units and rules the worksheet required", () => {
    const content = bundle();
    const limits = content.safetyControls.nutritionLimits;
    expect({
      minimum: limits.minimumDailyEnergyParameterId,
      maximum: limits.maximumWeeklyLossRateParameterId,
    }).toEqual({ minimum: MIN_ID, maximum: MAX_ID });

    const byId = new Map(content.numericParameters.map((parameter) => [parameter.id, parameter]));
    expect(byId.get(MIN_ID)).toMatchObject({
      value: 1200,
      unit: "KCAL_PER_DAY",
      applicabilityRuleIds: ["NUTRITION_MINIMUM_DAILY_ENERGY_RULE"],
    });
    expect(byId.get(MAX_ID)).toMatchObject({
      value: 1,
      unit: "PERCENT_BODY_WEIGHT_PER_WEEK",
      applicabilityRuleIds: ["NUTRITION_MAXIMUM_WEEKLY_LOSS_RATE_RULE"],
    });

    const resolved = resolveNutritionSafetyPolicy(content);
    expect(resolved.resolutionStatus).toBe("RESOLVED");
    if (resolved.resolutionStatus !== "RESOLVED") return;
    expect(resolved.nutritionLimits.minimumDailyEnergyKcal).toBe(1200);
    expect(resolved.nutritionLimits.maximumWeeklyLossRatePercent).toBe(1);
  });

  it("carries each floor under the rule id its own hook names", () => {
    // The indirection is the hazard: the hook names a parameter *and* a rule,
    // and `resolveNutritionSafetyPolicy` requires the parameter to declare
    // that rule. A floor bound to the wrong rule reads as absent.
    const limits = bundle().safetyControls.nutritionLimits;
    const byId = new Map(bundle().numericParameters.map((p) => [p.id, p]));
    expect(
      byId.get(limits.minimumDailyEnergyParameterId)?.applicabilityRuleIds
    ).toContain(limits.minimumDailyEnergyRuleId);
    expect(
      byId.get(limits.maximumWeeklyLossRateParameterId)?.applicabilityRuleIds
    ).toContain(limits.maximumWeeklyLossRateRuleId);
  });
});

describe("S-25 — the half-applied states between placeholder and adopted", () => {
  it("cannot represent a repointed hook whose parameter is absent: the bundle stops parsing", () => {
    // Worksheet section C row 2, the ZodError. The value of asserting it here
    // rather than trusting the measurement is that it proves the refusal is
    // structural: a bundle in this state cannot be loaded at all, so no code
    // path downstream of the loader can observe it.
    for (const id of [MIN_ID, MAX_ID]) {
      const broken = withoutParameter(id);
      const parsed = policyBundleContentSchema.safeParse(broken);
      expect({ id, parsed: parsed.success }).toEqual({ id, parsed: false });
      if (parsed.success) continue;
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        `Safety control numeric parameter references unknown authoritative ID: ${id}`
      );
      // And the throwing form, which is what the loader and the repository use.
      expect(() => policyBundleContentSchema.parse(broken)).toThrow(z.ZodError);
    }
  });

  it("refuses a floor whose unit is wrong, before any parameter set is built", () => {
    // Worksheet section C row 3, the ArtifactLoadError.
    const wrongMinimumUnit = patchParameter(MIN_ID, { unit: "KCAL_PER_WEEK" });
    expect(policyBundleContentSchema.safeParse(wrongMinimumUnit).success).toBe(true);
    expect(() => resolveNutritionSafetyPolicy(wrongMinimumUnit)).toThrow(ArtifactLoadError);
    expect(() => resolveNutritionSafetyPolicy(wrongMinimumUnit)).toThrow(
      "The reviewed minimum daily energy hook is missing or incompatible."
    );

    const wrongRateUnit = patchParameter(MAX_ID, { unit: "PERCENT" });
    expect(() => resolveNutritionSafetyPolicy(wrongRateUnit)).toThrow(
      "The reviewed weekly loss-rate hook is missing or incompatible."
    );
  });

  it("refuses a floor bound to the wrong applicability rule", () => {
    const wrongMinimumRule = patchParameter(MIN_ID, {
      applicabilityRuleIds: ["NUTRITION_NO_CONSECUTIVE_DEFICIT_RULE"],
    });
    expect(() => resolveNutritionSafetyPolicy(wrongMinimumRule)).toThrow(ArtifactLoadError);

    const wrongRateRule = patchParameter(MAX_ID, {
      applicabilityRuleIds: ["NUTRITION_NO_CONSECUTIVE_DEFICIT_RULE"],
    });
    expect(() => resolveNutritionSafetyPolicy(wrongRateRule)).toThrow(ArtifactLoadError);
  });

  it("refuses a floor whose value is not positive", () => {
    // A zero floor is not "no floor"; it is a floor that never binds, which is
    // the shape of the bug nobody notices.
    expect(() => resolveNutritionSafetyPolicy(patchParameter(MIN_ID, { value: 0 }))).toThrow(
      ArtifactLoadError
    );
    expect(() => resolveNutritionSafetyPolicy(patchParameter(MAX_ID, { value: -1 }))).toThrow(
      ArtifactLoadError
    );
  });

  it("still renders a HOLD, not a throw, if the hooks ever return to placeholders", () => {
    // The graceful state the worksheet's row 1 recorded is intact. It covers
    // the placeholder state only, which is the whole reason the edit above had
    // to be atomic.
    const content = bundle();
    content.safetyControls.nutritionLimits.minimumDailyEnergyParameterId =
      "PENDING_RD_DECISION_MIN_DAILY_ENERGY";
    content.safetyControls.nutritionLimits.maximumWeeklyLossRateParameterId =
      "PENDING_RD_DECISION_MAX_WEEKLY_LOSS_RATE";
    expect(policyBundleContentSchema.safeParse(content).success).toBe(true);

    const resolved = resolveNutritionSafetyPolicy(content);
    expect(resolved.resolutionStatus).toBe("PENDING");
    if (resolved.resolutionStatus !== "PENDING") return;
    expect(resolved.pendingParameterIds).toEqual([
      "PENDING_RD_DECISION_MIN_DAILY_ENERGY",
      "PENDING_RD_DECISION_MAX_WEEKLY_LOSS_RATE",
    ]);
    expect(resolved.pendingDecision).toMatchObject({
      outcome: "HOLD",
      reasonCodes: [NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE],
    });
  });

  it("resolves the floors before it resolves any prescription parameter", () => {
    // Why the ordering matters: the floors are an argument to
    // `resolvePrescriptionParameters`, so if the parameter set were built
    // first, a half-resolved floor could reach `computePrescription`. One
    // reader, one order — `lib/ai-coach/prescription-binding.ts` is the only
    // place both calls are made together, and it makes them in this order.
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "lib/ai-coach/prescription-binding.ts"),
      "utf8"
    );
    const safetyAt = source.indexOf("resolveNutritionSafetyPolicy(policy)");
    const prescriptionAt = source.indexOf("resolvePrescriptionParameters(policy");
    expect(safetyAt).toBeGreaterThan(-1);
    expect(prescriptionAt).toBeGreaterThan(-1);
    expect(safetyAt).toBeLessThan(prescriptionAt);

    // And the floors the engine is handed are exactly the resolved ones, so a
    // prescription cannot be computed against a floor nobody validated.
    const content = bundle();
    const safety = resolveNutritionSafetyPolicy(content);
    if (safety.resolutionStatus !== "RESOLVED") throw new Error("committed bundle is PENDING");
    const resolved = resolvePrescriptionParameters(content, ["text"], {
      minimumDailyEnergyKcal: safety.nutritionLimits.minimumDailyEnergyKcal,
      minimumDailyEnergyParameterId: safety.nutritionLimits.minimumDailyEnergyParameterId,
      maximumWeeklyLossRatePercent: safety.nutritionLimits.maximumWeeklyLossRatePercent,
      maximumWeeklyLossRateParameterId: safety.nutritionLimits.maximumWeeklyLossRateParameterId,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.parameters.safetyFloors).toEqual({
      minimumDailyEnergyKcal: 1200,
      minimumDailyEnergyParameterId: MIN_ID,
      maximumWeeklyLossRatePercent: 1,
      maximumWeeklyLossRateParameterId: MAX_ID,
    });
  });
});
