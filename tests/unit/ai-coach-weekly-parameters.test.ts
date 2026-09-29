import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import {
  escalationTemplatesContentSchema,
  policyBundleContentSchema,
} from "@/lib/ai-coach/artifacts/schema";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";
import { buildWeeklyFixtureReview } from "@/lib/ai-coach/weekly-controller";
import { runSnapshotSchema } from "@/lib/ai-coach/run-command";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { resolveNutritionSafetyPolicy } from "@/lib/ai-coach/nutrition-safety";
import { resolvePrescriptionParameters } from "@/lib/ai-coach/prescription/parameters";
import { resolveTrainingParameters } from "@/lib/ai-coach/training/parameters";
import {
  WEEKLY_COOLDOWN_RULE_ID,
  WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS,
  WEEKLY_CUMULATIVE_RULE_ID,
  WEEKLY_DROP_SESSION_RULE_ID,
  WEEKLY_EVIDENCE_RULE_ID,
  WEEKLY_PARAMETER_IDS,
  WEEKLY_RECOMPOSE_RULE_ID,
  WEEKLY_REESTIMATE_RULE_ID,
  WEEKLY_RELATIVE_STEP_RULE_ID,
  resolveWeeklyParameters,
} from "@/lib/ai-coach/weekly-parameters";

function bundle() {
  return policyBundleContentSchema.parse(
    buildSyntheticArtifactSet("t2007-weekly-parameters").policyBundle.content
  );
}

function unavailableSnapshot(reasonCodes: string[], missingParameterIds: string[]) {
  const intake = {
    goal: "BODY_COMPOSITION" as const,
    experienceLevel: "NEW" as const,
    trainingDaysPerWeek: 2,
    equipmentAccess: ["NONE" as const],
    allergies: [],
    dietaryRestrictions: [],
    foodBudgetLevel: "LOW" as const,
    trackingPreference: "NUMBERS_VISIBLE" as const,
    unitsPreference: "METRIC" as const,
    heightCm: 170,
    weightKg: 70,
  };
  const { payload } = buildInitialFixturePlan(intake, "initial-rx", "MEALS");
  return runSnapshotSchema.parse({
    schemaVersion: 1,
    synthetic: true,
    intake,
    policyVersion: payload.policyVersion,
    catalogVersions: payload.catalogVersions,
    modelConfiguration: "synthetic-template-v1",
    weeklyPolicy: { status: "UNAVAILABLE", reasonCodes, missingParameterIds },
    baseVersionId: "base",
    basePayload: payload,
    representation: "MEALS",
    reviewWindowKey: "2026-09-14",
    reviewTimezone: "America/Los_Angeles",
    sourceRefs: [],
    evidence: { sessions: [], observations: [] },
    history: [
      {
        id: "base",
        acceptedAt: "2026-08-01T12:00:00.000Z",
        changeClass: "INITIAL",
        reviewWindowKey: "2026-07-27",
        payload,
      },
    ],
  });
}

describe("weekly policy parameter resolver", () => {
  it.each([...WEEKLY_PARAMETER_IDS, ...WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS])(
    "fails closed when %s is missing",
    (id) => {
      const policy = structuredClone(bundle());
      policy.numericParameters = policy.numericParameters.filter(
        (parameter) => parameter.id !== id
      );
      const result = resolveWeeklyParameters(policy, { synthetic: true });
      expect(result).toEqual({
        ok: false,
        reasonCodes: ["WEEKLY_PARAMETER_MISSING"],
        missingParameterIds: [id],
      });
      if (result.ok) throw new Error("missing weekly parameter unexpectedly resolved");
      expect(
        buildWeeklyFixtureReview(
          unavailableSnapshot(result.reasonCodes, result.missingParameterIds)
        )
      ).toMatchObject({
        payload: null,
        decision: { action: "HOLD", reasonCodes: ["WEEKLY_PARAMETER_MISSING"] },
      });
    }
  );

  it.each([
    [WEEKLY_EVIDENCE_RULE_ID, "evidenceRuleIds"],
    [WEEKLY_COOLDOWN_RULE_ID, "cooldownRuleIds"],
    [WEEKLY_CUMULATIVE_RULE_ID, "cumulativeLimitRuleIds"],
    ["PROGRESSION.RULE.BOUNDED_TRAINING.V1", "adjustmentRuleIds"],
    [WEEKLY_RELATIVE_STEP_RULE_ID, "adjustmentRuleIds"],
    [WEEKLY_DROP_SESSION_RULE_ID, "adjustmentRuleIds"],
  ] as const)("fails closed when rule %s is absent", (ruleId, group) => {
    const policy = structuredClone(bundle());
    policy.ruleIds = policy.ruleIds.filter((id) => id !== ruleId);
    policy[group] = policy[group].filter((id) => id !== ruleId);
    expect(resolveWeeklyParameters(policy, { synthetic: true })).toMatchObject({
      ok: false,
      reasonCodes: ["WEEKLY_METHOD_UNSUPPORTED"],
    });
  });

  it("requires exactly one energy method and one simplification method", () => {
    for (const variants of [
      [WEEKLY_RELATIVE_STEP_RULE_ID, WEEKLY_REESTIMATE_RULE_ID],
      [WEEKLY_DROP_SESSION_RULE_ID, WEEKLY_RECOMPOSE_RULE_ID],
    ]) {
      const policy = structuredClone(bundle());
      policy.ruleIds.push(variants[1]);
      policy.adjustmentRuleIds.push(variants[1]);
      expect(resolveWeeklyParameters(policy, { synthetic: true })).toMatchObject({
        ok: false,
        reasonCodes: ["WEEKLY_METHOD_UNSUPPORTED"],
      });
      policy.adjustmentRuleIds = policy.adjustmentRuleIds.filter(
        (ruleId) => !variants.includes(ruleId)
      );
      expect(resolveWeeklyParameters(policy, { synthetic: true })).toMatchObject({
        ok: false,
        reasonCodes: ["WEEKLY_METHOD_UNSUPPORTED"],
      });
    }
  });

  it("permits session-drop only for a synthetic artifact", () => {
    expect(resolveWeeklyParameters(bundle(), { synthetic: true }).ok).toBe(true);
    expect(resolveWeeklyParameters(bundle(), { synthetic: false })).toMatchObject({
      ok: false,
      reasonCodes: ["WEEKLY_RULE_NOT_PERMITTED_FOR_LIVE_BUNDLE"],
    });
  });

  it("rejects an incompatible unit or applicability rule without throwing", () => {
    const policy = structuredClone(bundle());
    const parameter = policy.numericParameters.find((item) => item.id === WEEKLY_PARAMETER_IDS[0])!;
    parameter.unit = "WRONG_UNIT";
    expect(resolveWeeklyParameters(policy, { synthetic: true })).toEqual({
      ok: false,
      reasonCodes: ["WEEKLY_PARAMETER_INCOMPATIBLE"],
      missingParameterIds: [WEEKLY_PARAMETER_IDS[0]],
    });
  });

  it("rejects non-finite values, missing applicability, and broken safety floors", () => {
    const nonFinite = structuredClone(bundle());
    nonFinite.numericParameters.find((item) => item.id === WEEKLY_PARAMETER_IDS[0])!.value =
      Number.NaN;
    expect(resolveWeeklyParameters(nonFinite, { synthetic: true })).toMatchObject({
      ok: false,
      reasonCodes: ["WEEKLY_PARAMETER_INCOMPATIBLE"],
      missingParameterIds: [WEEKLY_PARAMETER_IDS[0]],
    });

    const missingApplicability = structuredClone(bundle());
    missingApplicability.numericParameters.find(
      (item) => item.id === WEEKLY_PARAMETER_IDS[0]
    )!.applicabilityRuleIds = [];
    expect(resolveWeeklyParameters(missingApplicability, { synthetic: true })).toMatchObject({
      ok: false,
      reasonCodes: ["WEEKLY_PARAMETER_INCOMPATIBLE"],
      missingParameterIds: [WEEKLY_PARAMETER_IDS[0]],
    });

    const brokenFloor = structuredClone(bundle());
    const floorId = brokenFloor.safetyControls.nutritionLimits.minimumDailyEnergyParameterId;
    brokenFloor.numericParameters = brokenFloor.numericParameters.filter(
      (item) => item.id !== floorId
    );
    expect(() => resolveWeeklyParameters(brokenFloor, { synthetic: true })).not.toThrow();
    expect(resolveWeeklyParameters(brokenFloor, { synthetic: true })).toMatchObject({
      ok: false,
      reasonCodes: ["WEEKLY_PARAMETER_INCOMPATIBLE"],
    });
  });

  it("leaves the signed bundle unavailable for exactly the 18 still-unsigned weekly inputs", () => {
    // S-23 signed the ten consumed `PROGRESSION.*` values, so they drop out of
    // this list. S-25 signed `ROUNDING.MACRO_GRAMS.DECIMALS`, which the weekly
    // controller shares with the prescription engine, so it drops out too. The
    // controller still fails closed on the 18 `WEEKLY.*` values alone — which
    // is why the progression set stays inert until those are supplied.
    const draft = loadDraftUnsignedPolicyBundle();
    const result = resolveWeeklyParameters(draft.content, { synthetic: false });
    expect(result).toMatchObject({ ok: false, reasonCodes: ["WEEKLY_PARAMETER_MISSING"] });
    if (result.ok) throw new Error("unsigned draft unexpectedly resolved");
    const stillMissing = [...WEEKLY_PARAMETER_IDS].sort();
    expect(stillMissing).toHaveLength(18);
    expect(result.missingParameterIds).toEqual(stillMissing);
    // The shared rounding value is present now, and present is not the same as
    // consumed: asserting it by id keeps the count above honest.
    expect(
      draft.content.numericParameters.some(
        (parameter) => parameter.id === "ROUNDING.MACRO_GRAMS.DECIMALS"
      )
    ).toBe(true);
    for (const id of WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS) {
      expect({ id, missing: result.missingParameterIds.includes(id) }).toEqual({
        id,
        missing: false,
      });
    }
  });

  it("produces a stable digest that changes when any resolved value changes", () => {
    const first = resolveWeeklyParameters(bundle(), { synthetic: true });
    for (let index = 0; index < 50; index += 1)
      expect(resolveWeeklyParameters(bundle(), { synthetic: true })).toEqual(first);
    if (!first.ok) throw new Error("synthetic weekly policy did not resolve");
    const changed = structuredClone(bundle());
    changed.numericParameters.find((item) => item.id === WEEKLY_PARAMETER_IDS[0])!.value += 1;
    const third = resolveWeeklyParameters(changed, { synthetic: true });
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.parameterSetDigest).not.toBe(first.parameterSetDigest);
  });

  it("does not consume the two reserved load progression parameters", () => {
    const policy = bundle();
    expect(
      policy.numericParameters.map((parameter) => parameter.id)
    ).toEqual(
      expect.arrayContaining([
        "PROGRESSION.STRENGTH.LOAD.INCREMENT_FRACTION",
        "PROGRESSION.STRENGTH.LOAD.MAX_INCREASE_FRACTION_PER_WINDOW",
      ])
    );
    expect(WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS).not.toContain(
      "PROGRESSION.STRENGTH.LOAD.INCREMENT_FRACTION"
    );
    expect(WEEKLY_CONSUMED_PROGRESSION_PARAMETER_IDS).not.toContain(
      "PROGRESSION.STRENGTH.LOAD.MAX_INCREASE_FRACTION_PER_WINDOW"
    );
  });

  it("leaves the existing nutrition, prescription, and training resolvers valid", () => {
    const artifacts = buildSyntheticArtifactSet("t2007-upstream-resolvers");
    const policy = bundle();
    const safety = resolveNutritionSafetyPolicy(policy);
    expect(safety.resolutionStatus).toBe("RESOLVED");
    if (safety.resolutionStatus !== "RESOLVED") throw new Error("Expected RESOLVED");
    const explanationTexts = escalationTemplatesContentSchema
      .parse(artifacts.escalationTemplates.content)
      .templates.map((template) => ({ id: template.id, text: template.nextStepText }));
    expect(
      resolvePrescriptionParameters(
        policy,
        explanationTexts.map((template) => template.text),
        safety.nutritionLimits
      ).ok
    ).toBe(true);
    expect(resolveTrainingParameters(policy, explanationTexts).ok).toBe(true);
  });

  it("keeps policy numbers out of the weekly controller source", () => {
    const file = path.join(process.cwd(), "lib", "ai-coach", "weekly-controller.ts");
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const allowed = new Set(["0", "1", "2", "7"]);
    const offenders: string[] = [];
    let structuralKeys: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "STRUCTURAL") {
        const call = node.initializer;
        if (call && ts.isCallExpression(call)) {
          const object = call.arguments[0];
          if (object && ts.isObjectLiteralExpression(object))
            structuralKeys = object.properties.flatMap((property) =>
              property.name ? [property.name.getText(sourceFile)] : []
            );
        }
        return;
      }
      if (ts.isNumericLiteral(node) && !allowed.has(node.text)) offenders.push(node.text);
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);
    expect(structuralKeys).toEqual([
      "MILLISECONDS_PER_DAY",
      "KILOGRAMS_PER_POUND",
      "PRESCRIPTION_ID_HASH_LENGTH",
      "PERCENT",
    ]);
    expect(offenders).toEqual([]);
  });
});
