import { describe, expect, it } from "vitest";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  validatedExplanation,
  type ConstrainedProviderBoundaryRuntime,
  type NumericField,
  type ReviewedNextAction,
} from "@/lib/ai-coach/provider/constrained-boundary";
import { validateExplanationProse } from "@/lib/ai-coach/provider/explanation-prose";
import type { ConstrainedProviderOutput } from "@/lib/ai-coach/provider/adapter";

/**
 * T-2030 review r1 MINOR 1. The pre-change (commit `783baad`, the base this
 * ticket branched from) `validatedExplanation()` is reproduced verbatim
 * below — `git show 783baad:lib/ai-coach/provider/constrained-boundary.ts`
 * lines 377-397 — so this test is self-contained and re-runnable in the
 * repo, not an ad-hoc external script. It is compared against the real,
 * exported, post-change `validatedExplanation` (imported above) for the
 * no-prose synthetic case, which is the only case that can ever affect a
 * pre-existing `AiAutomaticPlanApproval` row (every such row predates
 * prose, by definition). The pinned hex below was produced by running the
 * `oldValidatedExplanation` function immediately below against the exact
 * fixed literal inputs in this file — anyone can reproduce it by re-running
 * this test, or by checking out 783baad and running the equivalent code
 * against the same inputs by hand.
 */

type OldNumericField = { id: string; value: number; unit: string };
type OldReviewedNextAction = {
  templateId: string;
  locale: string;
  nextStepText: string;
  nonMonitoringStatement: string;
};
type OldRuntime = { limitations: readonly { id: string; text: string }[] };
type OldOutput = {
  explanation: { reasonCodes: string[]; numericFieldIds: string[] };
};

// Verbatim copy of commit 783baad's
// lib/ai-coach/provider/constrained-boundary.ts:377-397 (pre-T-2030).
function oldValidatedExplanation(
  output: OldOutput,
  nextAction: OldReviewedNextAction,
  numericFields: readonly OldNumericField[],
  runtime: OldRuntime
) {
  const requestedNumericFields = new Set(output.explanation.numericFieldIds);
  return {
    templateId: nextAction.templateId,
    locale: nextAction.locale,
    reasonCodes: output.explanation.reasonCodes,
    nextStepText: nextAction.nextStepText,
    numericFields: numericFields.filter((field) => requestedNumericFields.has(field.id)),
    limitations: [
      ...runtime.limitations,
      {
        id: "REVIEWED_NON_MONITORING_STATEMENT",
        text: nextAction.nonMonitoringStatement,
      },
    ],
  };
}

const PINNED_PRE_CHANGE_DIGEST =
  "f763cb291d9d73a12bdaa18d2f5f00672101579b035221dcf2704440d4e59f2c";

const nextAction: ReviewedNextAction = {
  templateId: "synthetic-pause-refer-template",
  locale: "en-US",
  nextStepText: "Review your proposal.",
  nonMonitoringStatement: "Synthetic non-monitoring statement.",
};
const runtime: ConstrainedProviderBoundaryRuntime = {
  promptContractVersion: "t1007-synthetic-v1",
  languageProvenance: "SYNTHETIC_SERVER_FIXTURE",
  preferenceIds: [],
  clarificationIds: [],
  limitations: [{ id: "SYNTHETIC_TEST_ONLY", text: "Synthetic fixture output only." }],
  providerConfiguration: "SYNTHETIC_CONSTRAINED_PROVIDER_ONLY",
};
const numericFields: NumericField[] = [
  {
    id: "NUTRITION_ENERGY_KCAL",
    value: 1734,
    unit: "KCAL_PER_DAY",
    displayLabel: "Energy",
    displayValue: "1734",
  },
  {
    id: "NUTRITION_PROTEIN_G",
    value: 1,
    unit: "GRAMS_PER_DAY",
    displayLabel: "Protein",
    displayValue: "1",
  },
];
const output: ConstrainedProviderOutput = {
  schemaVersion: 1,
  preferenceIds: [],
  concern: { disposition: "NONE", clarificationId: null },
  rankedOptionIds: [],
  explanation: {
    templateId: "synthetic-pause-refer-template",
    reasonCodes: ["GATE_APPROVED"],
    numericFieldIds: ["NUTRITION_ENERGY_KCAL", "NUTRITION_PROTEIN_G"],
    limitationIds: [],
  },
};

/** Fixed literal state, matching finalization.ts's untouched `state` shape
 * (`clientId`, `planVersionId`, ... `providerSelection`). */
function stateWith(explanation: unknown) {
  return {
    clientId: "synthetic-client",
    planVersionId: "synthetic-plan",
    gateDecisionId: "synthetic-gate",
    providerBoundaryAuditId: "synthetic-audit",
    evaluationKey: "synthetic-evaluation-key",
    candidatePayloadHash: "synthetic-payload-hash",
    artifactRequest: { policyArtifactKey: "policy-fixture-v1", engineVersion: "v1" },
    artifactRefs: [],
    sourceRefs: [],
    gateInput: { synthetic: true },
    providerSelection: {
      preferenceIds: ["SYNTHETIC_PREFERENCE_SIMPLE"],
      rankedOptionIds: ["FOOD:synthetic-food-item"],
      explanation,
    },
  };
}

describe("T-2030 golden stateDigest — pinned against commit 783baad", () => {
  it("the pre-change function itself hashes to the pinned digest (proves the pin is real, not circular)", () => {
    const oldExplanation = oldValidatedExplanation(
      output,
      nextAction,
      numericFields.map(({ id, value, unit }) => ({ id, value, unit })),
      runtime
    );
    expect("text" in oldExplanation).toBe(false);
    expect(contentHash(stateWith(oldExplanation))).toBe(PINNED_PRE_CHANGE_DIGEST);
  });

  it("the real, exported, post-change validatedExplanation() hashes identically for the no-prose case", () => {
    // No prose supplied — the SyntheticConstrainedProvider shape, and the
    // only shape any pre-existing AiAutomaticPlanApproval row can have.
    const explanationValidation = validateExplanationProse(
      {
        outcome: "APPROVE_AUTOMATICALLY",
        reasonCodes: ["GATE_APPROVED"],
        numericFields,
        displayNames: [],
        catalogVocabulary: [],
        maxCharacters: 400,
        minCharacters: 40,
        language: "en",
      },
      undefined
    );
    expect(explanationValidation.accepted).toBe(false);

    const newExplanation = validatedExplanation(
      output,
      nextAction,
      numericFields,
      runtime,
      explanationValidation
    );
    expect("text" in newExplanation).toBe(false);

    const newDigest = contentHash(stateWith(newExplanation));
    expect(newDigest).toBe(PINNED_PRE_CHANGE_DIGEST);
  });
});
