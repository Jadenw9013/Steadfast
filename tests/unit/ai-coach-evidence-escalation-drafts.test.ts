import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadDraftUnsignedEvidenceRegistry,
  draftEvidenceRegistryFileSchema,
  evidenceRegistryToArtifactDraftInput,
  PENDING_EVIDENCE_CLAIM_ID_PREFIX,
  UNREVIEWED_DRAFT_QUALIFICATION,
  UNREVIEWED_DRAFT_REVIEWER_NAME,
} from "@/lib/ai-coach/artifacts/drafts/evidence-registry";
import {
  loadDraftUnsignedEscalationTemplates,
  escalationTemplatesToArtifactDraftInput,
  NON_ESCALATION_REASON_CODE_PREFIX,
} from "@/lib/ai-coach/artifacts/drafts/escalation-templates";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";
import { autonomyGateReasonCodeSchema } from "@/lib/ai-coach/autonomy/gate";
import { PRESCRIPTION_REASON_CODES } from "@/lib/ai-coach/prescription-reason-classes";
import {
  evidenceRegistryContentSchema,
  escalationTemplatesContentSchema,
  parseArtifactDraftInput,
} from "@/lib/ai-coach/artifacts/schema";
import {
  EFFORT_CARDIO_TEMPLATE_ID,
  EFFORT_STRENGTH_TEMPLATE_ID,
  TRAINING_COMPOSER_PARAMETER_IDS,
  TRAINING_PROGRESSION_PARAMETER_IDS,
  resolveTrainingParameters,
} from "@/lib/ai-coach/training/parameters";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE } from "@/lib/ai-coach/nutrition-safety";
import { DRAFT_UNSIGNED_METADATA } from "../helpers/ai-draft-review-metadata";

/**
 * S-V1-artifacts / S-17 — the two artifact kinds a v1 launch requires, now
 * signed by the accountable owner.
 *
 * These assertions are the mechanical half of "engineering authors structure,
 * the reviewer authors content". Signing did not relax any of them: a number in
 * client copy, a promise that a human is reviewing, an invented citation, a
 * credential nobody holds, a record whose review state disagrees with the file's
 * decision, or a claim that upgrades a scope attestation into a verification —
 * each fails here rather than relying on the next editor remembering.
 */

const evidenceFile = loadDraftUnsignedEvidenceRegistry();
const escalationFile = loadDraftUnsignedEscalationTemplates();
const bundleFile = loadDraftUnsignedPolicyBundle();
const claims = evidenceFile.content.claims;
const templates = escalationFile.content.templates;

/**
 * S-17 — the reviewer, exactly as `steadfast-hq/board/REVIEW-WORKSHEET.md`
 * section 0 records them. The qualification line is the whole of what is
 * claimed: no registration number, no licence, no certifying body, because
 * there are none. {@link CREDENTIAL_CLAIM} fails if one ever appears.
 */
const SIGNER_NAME = "Jaden Wong";
const SIGNER_QUALIFICATION =
  "Accountable owner and founder. Reviewed within the general fitness and wellness scope " +
  "only; no clinical qualification is claimed.";
const SIGNER_SCOPE_NOTE =
  "Reviewed within general fitness and wellness scope; medical advice disclaimed.";
const REVIEW_DATE = "2026-09-27T00:00:00.000Z";

/**
 * S-23 — the sanctioned owner-adoption claims, decided by the accountable
 * owner and recorded on the board (`board/evidence/v1-dose-harness.md` §7).
 *
 * Every other claim in the registry cites an external source and says that the
 * source supports the rule it is bound to. This one exists to say the opposite:
 * that a set of values was adopted by the owner and has no external source at
 * all. The artifact schema had no other way to express that — every numeric
 * parameter must name a claim, and every other claim must name a real,
 * non-placeholder source — and the alternative was attaching a literature
 * citation to values whose own record says they were never checked against one.
 *
 * Two guards below are keyed to this exact list: the placeholder-host
 * exception, and the second permitted claim shape. Both use set equality in
 * both directions, so the list cannot grow silently and cannot be left behind
 * once the claim it covers is gone. Adding an id here is the same decision
 * being made again, and should be recorded on the board the same way.
 */
const OWNER_ADOPTION_CLAIM_IDS = ["CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION"];

/** The wording shape A is *required* to have, which shape B is forbidden to have. */
const SOURCE_BACKED_CLAIM_PHRASES = [
  "CONFIRMED WITHIN SCOPE.",
  "the accountable owner confirms that this source supports that rule within the " +
    "general fitness and wellness scope",
  "Steadfast has not independently verified the source's full text",
  "Steadfast has not independently verified the cited source's",
];

/**
 * The only places an owner-adoption claim may use "supports", "verified" or
 * "confirmed", each one a negation or a scope attestation rather than a claim
 * that something backs the values. They are stripped before the affirmative
 * scan, exactly as {@link CREDENTIAL_DENIALS} are stripped before the
 * credential scan, so a denial can never be mistaken for the assertion.
 */
const OWNER_ADOPTION_PERMITTED_NEGATIONS = [
  "SCOPE ATTESTATION: confirmed by the accountable owner within the general fitness and " +
    "wellness scope; no clinical qualification, licence, registration number or certifying " +
    "body is claimed.",
  "No external source was consulted for them and none is named.",
  "no external source supports these values, and none is cited",
  "not verified against a primary literature source",
  "not verified against any external source",
  "It is not evidence that they are correct, and it asserts no external support of any kind.",
];

/** Affirmative backing wording. Anything surviving the strip above is a claim. */
const AFFIRMATIVE_BACKING = /\b(supports|verified|confirmed|evidence for)\b/i;

/**
 * Any wording that would turn the signature into a credential claim.
 *
 * Two fixed strings *deny* credentials and so contain these words on purpose —
 * the qualification line and the per-claim scope attestation. Both are asserted
 * by exact equality elsewhere in this file, and both are removed before the scan
 * so the denial cannot be mistaken for the claim.
 */
const CREDENTIAL_CLAIM =
  /\b(registered dietitian|dietitian|RDN?|CPT|licen[cs]\w*|registration number|certif\w*|accredit\w*|board[- ]certified|nutritionist|physician|clinician)\b/i;
const CREDENTIAL_DENIALS = [
  // reviewer.qualifications — worksheet section 0
  "Accountable owner and founder. Reviewed within the general fitness and wellness scope " +
    "only; no clinical qualification is claimed.",
  // reviewMetadata.signoffScope
  "Reviewed within the general fitness and wellness scope only. No clinical qualification, " +
    "licence, registration number or certifying body is claimed or recorded.",
  // every claim's first limitation
  "SCOPE ATTESTATION: confirmed by the accountable owner within the general fitness and " +
    "wellness scope; no clinical qualification, licence, registration number or certifying " +
    "body is claimed.",
];

const signedMetadata = (() => {
  const metadata = escalationFile.reviewMetadata;
  if (metadata.decision !== "APPROVED") throw new Error("escalation templates are not signed");
  return metadata;
})();
const SIGNED_JURISDICTIONS = signedMetadata.jurisdictionReview.jurisdictions;

/** Every digit, and the spelled-out numbers a digit match would miss (T-2038). */
const ANY_DIGIT = /\d/;
const NUMBER_WORD =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|once|twice|thrice|single|double|triple|dozen|half|quarter|percent|calories|kcal|grams?|kilograms?|pounds?|reps?|sets|minutes?|hours?|rpe|rir)\b/i;
/** Copy may point a client at a professional; it may never say one is already looking. */
const REVIEW_PROMISE =
  /\b(review|reviews|reviewed|reviewing|reviewer|our team|we will|we are|we'll|someone will|will contact|will get back|checking on|looking into)\b/i;
/** No urgency the service cannot back. */
const URGENCY =
  /\b(urgent|urgently|immediately|emergency|right away|at once|as soon as possible|asap|dangerous|critical)\b/i;
/** No diagnosis, no treatment, no prescribing. */
const DIAGNOSIS =
  /\b(diagnos\w*|your condition|disorder|disease|symptom\w*|treat|treats|treating|treatment|therap\w*|prescri\w*|medication dose)\b/i;

const clientFacingStrings = templates.flatMap((template) => [
  { id: `${template.id}.nextStepText`, text: template.nextStepText },
  { id: `${template.id}.nonMonitoringStatement`, text: template.nonMonitoringStatement },
]);

describe("S-17 — signed escalation templates (client-facing copy)", () => {
  it("is signed by the named accountable owner, and claims no credential", () => {
    expect(escalationFile.fileSchemaVersion).toBe(1);
    expect(signedMetadata.decision).toBe("APPROVED");
    expect(signedMetadata.reviewer).toEqual({
      name: SIGNER_NAME,
      reviewerType: "QUALIFIED_CONTENT_REVIEWER",
      qualifications: [SIGNER_QUALIFICATION],
    });
    expect(signedMetadata.reviewedAt).toBe(REVIEW_DATE);
    expect(escalationTemplatesContentSchema.parse(escalationFile.content).artifactKey).toBe(
      "escalation-templates-v1"
    );
  });

  it("records the legal status as the owner's own scope attestation, not an external review", () => {
    // There is no legal signer (see REQUIRED_APPROVAL_REQUIREMENTS). `APPROVED`
    // on its own would read as counsel having cleared this copy; these two fields
    // are what stop it reading that way.
    expect(signedMetadata.jurisdictionReview.legalReviewBasis).toBe(
      "ACCOUNTABLE_OWNER_SCOPE_ATTESTATION"
    );
    expect(signedMetadata.jurisdictionReview.scopeNote).toBe(SIGNER_SCOPE_NOTE);
    expect(signedMetadata.jurisdictionReview.recordId).toContain("REVIEW-WORKSHEET");
  });

  it("marks every template ACCEPTED, consistent with the file being signed", () => {
    expect(escalationFile.reviewStates).toHaveLength(templates.length);
    for (const state of escalationFile.reviewStates) {
      expect({ itemId: state.itemId, reviewState: state.reviewState }).toMatchObject({
        itemId: state.itemId,
        reviewState: "ACCEPTED",
      });
    }
  });

  it("contains no digit and no spelled-out number in any client-facing string", () => {
    expect(clientFacingStrings.length).toBeGreaterThan(0);
    for (const { id, text } of clientFacingStrings) {
      expect({ id, text, digit: ANY_DIGIT.test(text) }).toMatchObject({ digit: false });
      expect({ id, text, word: NUMBER_WORD.exec(text)?.[0] ?? null }).toMatchObject({ word: null });
    }
  });

  it("never implies a human is reviewing, because in v1 none is", () => {
    for (const { id, text } of clientFacingStrings) {
      expect({ id, text, term: REVIEW_PROMISE.exec(text)?.[0] ?? null }).toMatchObject({
        term: null,
      });
    }
  });

  it("makes no diagnosis and implies no urgency the service cannot back", () => {
    for (const { id, text } of clientFacingStrings) {
      expect({ id, text, term: DIAGNOSIS.exec(text)?.[0] ?? null }).toMatchObject({ term: null });
      expect({ id, text, term: URGENCY.exec(text)?.[0] ?? null }).toMatchObject({ term: null });
    }
  });

  it("uses one non-monitoring statement across every template, and says the service is not monitoring", () => {
    const statements = new Set(templates.map((template) => template.nonMonitoringStatement));
    expect(statements.size).toBe(1);
    expect([...statements][0]).toContain("Steadfast is not monitoring you");
  });

  it("clears exactly the geographies the signed metadata clears, and declares one locale", () => {
    // S-17 replaced "nobody has cleared anything", which stopped being true, with
    // the invariant it should always have been: the copy's geographies and the
    // signature's jurisdictions are the same list. Copy cleared for a market the
    // signature does not name, or a signature naming a market the copy does not
    // carry, both fail here.
    expect(SIGNED_JURISDICTIONS.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect({ id: template.id, geographies: template.geographies }).toEqual({
        id: template.id,
        geographies: SIGNED_JURISDICTIONS,
      });
      expect(template.locale).toBe("en-US");
    }
  });
});

describe("S-V1-artifacts — escalation reason-code coverage", () => {
  const allowed = new Set(bundleFile.content.escalationTemplateIds);
  const escalationTemplates = templates.filter((template) =>
    template.reasonCodes.every((code) => !code.startsWith(NON_ESCALATION_REASON_CODE_PREFIX))
  );
  const declared = new Set(escalationTemplates.flatMap((template) => template.reasonCodes));

  /** The resolver in autonomy/gate.ts, reimplemented so coverage is proven, not assumed. */
  function templateCovering(codes: readonly string[]) {
    return templates.find(
      (candidate) =>
        allowed.has(candidate.id) && codes.every((code) => candidate.reasonCodes.includes(code))
    );
  }

  it("covers every AutonomyGateReasonCode, including GATE_APPROVED", () => {
    const gateCodes = autonomyGateReasonCodeSchema.options;
    expect(gateCodes.length).toBeGreaterThan(0);
    for (const code of gateCodes) {
      expect({ code, covered: Boolean(templateCovering([code])) }).toMatchObject({
        code,
        covered: true,
      });
    }
  });

  it("covers every PrescriptionReasonCode, as loadLiveArtifactSetForLaunchValidation requires", () => {
    for (const code of ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", ...PRESCRIPTION_REASON_CODES]) {
      expect({ code, declared: declared.has(code) }).toMatchObject({ code, declared: true });
    }
  });

  it("covers every reason code the draft policy bundle's safety controls can emit", () => {
    const { screening, contraindications, nutritionLimits } = bundleFile.content.safetyControls;
    const safetyCodes = [
      screening.flaggedReasonCode,
      screening.unknownReasonCode,
      ...contraindications.map((rule) => rule.reasonCode),
      nutritionLimits.minimumDailyEnergyReasonCode,
      nutritionLimits.maximumWeeklyLossRateReasonCode,
      nutritionLimits.noConsecutiveDeficitReasonCode,
      nutritionLimits.missingRateInputReasonCode,
      nutritionLimits.unverifiableHistoryReasonCode,
      NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE,
    ];
    expect(safetyCodes.length).toBeGreaterThan(0);
    for (const code of safetyCodes) {
      expect({ code, declared: declared.has(code) }).toMatchObject({ code, declared: true });
    }
  });

  it("resolves the composite sets the gate actually builds, not only single codes", () => {
    const { screening, contraindications, nutritionLimits } = bundleFile.content.safetyControls;
    const composites: string[][] = [
      ["GATE_NUTRITION_SAFETY_PAUSE_REFER", screening.flaggedReasonCode],
      [
        "GATE_NUTRITION_SAFETY_PAUSE_REFER",
        screening.unknownReasonCode,
        ...contraindications.map((rule) => rule.reasonCode),
      ],
      [
        "GATE_NUTRITION_SAFETY_HOLD",
        nutritionLimits.minimumDailyEnergyReasonCode,
        nutritionLimits.maximumWeeklyLossRateReasonCode,
        nutritionLimits.noConsecutiveDeficitReasonCode,
      ],
      ["GATE_NUTRITION_SAFETY_HOLD", nutritionLimits.unverifiableHistoryReasonCode],
      ["GATE_NUTRITION_SAFETY_HOLD", NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE],
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_PARAMETER_MISSING"],
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE"],
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_GOAL_PACE_UNDECIDED"],
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE"],
    ];
    for (const codes of composites) {
      expect({ codes, covered: Boolean(templateCovering(codes)) }).toMatchObject({
        codes,
        covered: true,
      });
    }
    expect(
      templateCovering([
        "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
        "PRESCRIPTION_INPUT_OUT_OF_SUPPORTED_RANGE",
      ])?.id
    ).toBe("ESCALATION.NUTRITION.TARGET.NEEDS_ANSWERS.V1");
  });

  it("degrades a mixed-class prescription set to the most protective copy, which pins array order", () => {
    // A set spanning two reason classes matches no single template, so gate.ts
    // falls back to `templateCovering([leading GATE_* code])` — a `find`, so the
    // first template declaring the code wins. It must be the PAUSE_REFER one.
    const mixed = [
      "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
      "PRESCRIPTION_PARAMETER_MISSING",
      "PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE",
    ];
    expect(templateCovering(mixed)).toBeUndefined();
    expect(templateCovering(["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE"])?.id).toBe(
      "ESCALATION.NUTRITION.TARGET.OUT_OF_SCOPE.V1"
    );
  });

  it("declares no reason code that no production code path can emit", () => {
    expect(escalationTemplates).toHaveLength(allowed.size);
    const emittable = new Set<string>([
      ...autonomyGateReasonCodeSchema.options,
      ...PRESCRIPTION_REASON_CODES,
      bundleFile.content.safetyControls.screening.flaggedReasonCode,
      bundleFile.content.safetyControls.screening.unknownReasonCode,
      ...bundleFile.content.safetyControls.contraindications.map((rule) => rule.reasonCode),
      ...Object.values(bundleFile.content.safetyControls.nutritionLimits).filter(
        (value): value is string => typeof value === "string" && value.endsWith("_LIMIT")
      ),
      bundleFile.content.safetyControls.nutritionLimits.noConsecutiveDeficitReasonCode,
      bundleFile.content.safetyControls.nutritionLimits.missingRateInputReasonCode,
      bundleFile.content.safetyControls.nutritionLimits.unverifiableHistoryReasonCode,
      NUTRITION_SAFETY_PARAMETERS_PENDING_REASON_CODE,
    ]);
    for (const code of declared) {
      expect({ code, emittable: emittable.has(code) }).toMatchObject({ code, emittable: true });
    }
  });
});

describe("S-17 — the three copy templates stay out of the escalation path", () => {
  /**
   * S-15: `escalationTemplateIds`, `prescriptionExplanationTemplateIds` and
   * `trainingEffortTemplateIds` were one list, so the two effort sentences
   * published themselves as the explanation underneath clients' calorie targets
   * on 257 of 257 prescriptions. These are the assertions that keep them apart.
   */
  const lists = {
    escalationTemplateIds: bundleFile.content.escalationTemplateIds,
    prescriptionExplanationTemplateIds:
      bundleFile.content.prescriptionExplanationTemplateIds ?? [],
    trainingEffortTemplateIds: bundleFile.content.trainingEffortTemplateIds ?? [],
  };

  it("declares three non-empty, disjoint id lists", () => {
    for (const [name, ids] of Object.entries(lists)) {
      expect({ name, length: ids.length }).toMatchObject({ name });
      expect(ids.length).toBeGreaterThan(0);
    }
    const entries = Object.entries(lists);
    for (const [nameA, idsA] of entries) {
      for (const [nameB, idsB] of entries) {
        if (nameA >= nameB) continue;
        const shared = idsA.filter((id) => idsB.includes(id));
        expect({ nameA, nameB, shared }).toEqual({ nameA, nameB, shared: [] });
      }
    }
  });

  it("names every declared id, and no id appears in more than one list", () => {
    const templateIds = new Set(templates.map((template) => template.id));
    const all = Object.values(lists).flat();
    for (const id of all) {
      expect({ id, present: templateIds.has(id) }).toMatchObject({ id, present: true });
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it("marks the copy templates as non-escalations, so the gate can never select one", () => {
    const copyIds = [
      ...lists.prescriptionExplanationTemplateIds,
      ...lists.trainingEffortTemplateIds,
    ];
    expect(copyIds).toEqual([
      "PRESCRIPTION.EXPLANATION.NUTRITION.TARGET.V1",
      "TRAINING.EFFORT.STRENGTH.V1",
      "TRAINING.EFFORT.CARDIO.V1",
    ]);
    for (const id of copyIds) {
      const template = templates.find((candidate) => candidate.id === id)!;
      expect({ id, marked: template.reasonCodes }).toMatchObject({
        id,
        marked: template.reasonCodes.filter((code) =>
          code.startsWith(NON_ESCALATION_REASON_CODE_PREFIX)
        ),
      });
      // `resolveNextActionTemplateId` only ever selects from escalationTemplateIds.
      expect(lists.escalationTemplateIds).not.toContain(id);
    }
  });

  it("resolves the nutrition explanation without any training effort wording in it", () => {
    const byId = new Map(templates.map((template) => [template.id, template]));
    const nutritionTexts = lists.prescriptionExplanationTemplateIds.map(
      (id) => byId.get(id)!.nextStepText
    );
    const effortTexts = lists.trainingEffortTemplateIds.map((id) => byId.get(id)!.nextStepText);
    expect(nutritionTexts).toHaveLength(1);
    for (const effort of effortTexts) {
      expect(nutritionTexts.join(" ")).not.toContain(effort);
    }
  });
});

describe("S-V1-artifacts — the draft policy bundle binds the draft templates, not the synthetic fixture", () => {
  it("names only templates this artifact declares", () => {
    const templateIds = new Set(templates.map((template) => template.id));
    for (const id of bundleFile.content.escalationTemplateIds) {
      expect({ id, present: templateIds.has(id) }).toMatchObject({ id, present: true });
    }
  });

  it("binds every safety control to a template that declares its reason codes", () => {
    const byId = new Map(templates.map((template) => [template.id, template]));
    const { screening, contraindications } = bundleFile.content.safetyControls;
    const bindings = [
      {
        templateId: screening.escalationTemplateId,
        codes: [screening.flaggedReasonCode, screening.unknownReasonCode],
      },
      ...contraindications.map((rule) => ({
        templateId: rule.escalationTemplateId,
        codes: [rule.reasonCode],
      })),
    ];
    for (const binding of bindings) {
      const template = byId.get(binding.templateId);
      expect({ templateId: binding.templateId, found: Boolean(template) }).toMatchObject({
        templateId: binding.templateId,
        found: true,
      });
      for (const code of binding.codes) {
        expect({ code, declared: template?.reasonCodes.includes(code) }).toMatchObject({
          code,
          declared: true,
        });
      }
    }
  });

  it("references no synthetic fixture id anywhere in the draft artifact set", () => {
    // The bundle shipped bound to `synthetic-pause-refer-template`, an id that
    // only exists on a synthetic artifact and can therefore never satisfy a live
    // launch. The two TRAINING.EFFORT ids stay deliberately dangling (see the
    // fail-closed suite below), so only the `synthetic-` family is checked here.
    const syntheticSet = buildSyntheticArtifactSet();
    const syntheticEscalation = escalationTemplatesContentSchema.parse(
      syntheticSet.escalationTemplates.content
    );
    const syntheticIds = syntheticEscalation.templates
      .map((template) => template.id)
      .filter((id) => /^synthetic/i.test(id));
    expect(syntheticIds).toContain("synthetic-pause-refer-template");
    const serialised = JSON.stringify([bundleFile.content, escalationFile.content]);
    for (const id of syntheticIds) {
      expect({ id, present: serialised.includes(id) }).toMatchObject({ id, present: false });
    }
  });
});

describe("S-17 — the three values the reviewer supplied now compose", () => {
  it("lifts the effort-copy refusal, and resolves the reviewer's adopted training doses", () => {
    /**
     * Read this one carefully, because it says less than it looks like it says.
     *
     * Worksheet section 3a/3b supplied the two effort sentences, so
     * `TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE` is gone. Until S-23 training
     * still did not compose: `resolveTrainingParameters` refused with
     * `TRAINING_PARAMETER_MISSING` over 23 strength and cardio dose parameters
     * the bundle did not carry, because they are doses and S-17 invented none.
     *
     * S-23 wrote them in. The accountable owner adopted all 35 values on
     * 2026-09-29 (`steadfast-hq/board/DOSE-WORKSHEET.md` and
     * `DOSE-WORKSHEET-2.md`) in his own words, recorded verbatim on every one
     * of their `proposalProvenance` rows: "proposed by engineering, adopted by
     * me, not verified against a primary literature source."
     *
     * So this assertion changes sides: it now pins the values the composer
     * actually reads, so a later edit to the bundle cannot move a dose without
     * a test saying so. Resolving is NOT composing — the prescription engine
     * still fails closed on its own 13 absent parameters, which the run
     * recorded in `steadfast-hq/board/evidence/v1-dose-harness.md` measures.
     */
    const explanationTexts = (bundleFile.content.trainingEffortTemplateIds ?? [])
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is (typeof templates)[number] => Boolean(template))
      .map((template) => ({ id: template.id, text: template.nextStepText }));
    expect(explanationTexts.map((item) => item.id)).toEqual([
      EFFORT_STRENGTH_TEMPLATE_ID,
      EFFORT_CARDIO_TEMPLATE_ID,
    ]);

    const resolution = resolveTrainingParameters(bundleFile.content, explanationTexts);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const { parameters } = resolution;
    expect({
      sets: parameters.setsPerExerciseByExperience,
      reps: parameters.repsPerSetByExperience,
      rest: parameters.restSecondsByExperience,
      strengthSessions: parameters.maxStrengthSessionsByExperience,
      cardioMinutes: parameters.cardioSessionMinutesByExperience,
      cardioSessions: parameters.cardioSessionsPerWeekByExperience,
    }).toEqual({
      sets: { NEW: 3, RETURNING: 3, EXPERIENCED: 4 },
      reps: { NEW: 10, RETURNING: 10, EXPERIENCED: 8 },
      rest: { NEW: 90, RETURNING: 90, EXPERIENCED: 120 },
      strengthSessions: { NEW: 3, RETURNING: 4, EXPERIENCED: 4 },
      cardioMinutes: { NEW: 20, RETURNING: 25, EXPERIENCED: 30 },
      cardioSessions: { NEW: 2, RETURNING: 2, EXPERIENCED: 3 },
    });
    expect({
      cardioMaxSessionMinutes: parameters.cardioMaxSessionMinutes,
      workloadTotalSessionsMax: parameters.workloadTotalSessionsMax,
      workloadTrainingMinutesMax: parameters.workloadTrainingMinutesMax,
      workloadTrainingMinutesMaxWhenEnergyReduced:
        parameters.workloadTrainingMinutesMaxWhenEnergyReduced,
      workloadConsecutiveTrainingDaysMax: parameters.workloadConsecutiveTrainingDaysMax,
    }).toEqual({
      cardioMaxSessionMinutes: 45,
      workloadTotalSessionsMax: 6,
      workloadTrainingMinutesMax: 360,
      workloadTrainingMinutesMaxWhenEnergyReduced: 240,
      // Raised from 3 by the accountable owner on 2026-09-29, after the first
      // harness run showed the ceiling of 3 trimming cardio out of a four-day
      // strength split. His reason is recorded on the parameter's provenance
      // row and pinned by the test below.
      workloadConsecutiveTrainingDaysMax: 4,
    });
  });

  it("records the owner's provenance, unchanged, on every value S-23 added", () => {
    // The sentence is the record. A later edit that "improves" it, or a row
    // that quietly acquires a literature citation it never had, fails here.
    const PROVENANCE =
      "proposed by engineering, adopted by me, not verified against a primary literature source.";
    const adopted = [
      ...TRAINING_COMPOSER_PARAMETER_IDS.filter(
        (id) => !id.startsWith("TRAINING.SESSION.")
      ),
      ...TRAINING_PROGRESSION_PARAMETER_IDS,
    ];
    expect(adopted).toHaveLength(35);
    if (bundleFile.reviewMetadata.decision !== "APPROVED")
      throw new Error("policy bundle is not signed");
    const byParameter = new Map(
      (bundleFile.reviewMetadata.proposalProvenance ?? []).map((row) => [row.parameterId, row])
    );
    for (const id of adopted) {
      const locator = byParameter.get(id)?.sourceLocator ?? "";
      expect({ id, startsWithProvenance: locator.startsWith(PROVENANCE) }).toEqual({
        id,
        startsWithProvenance: true,
      });
      // And every one of them names the owner-adoption claim, not a citation.
      expect({ id, claim: byParameter.get(id)?.sourceClaimId }).toEqual({
        id,
        claim: "CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION",
      });
    }

    // Exactly one row carries more than the sentence: the consecutive-days
    // ceiling, which the owner changed after seeing the first harness run. Its
    // reason is part of the record, so it is pinned rather than allowed to
    // drift, and no other row may acquire extra text unnoticed.
    const annotated = adopted.filter(
      (id) => byParameter.get(id)?.sourceLocator !== PROVENANCE
    );
    expect(annotated).toEqual(["WORKLOAD.WEEKLY.CONSECUTIVE_TRAINING_DAYS.MAX"]);
    expect(byParameter.get(annotated[0])?.sourceLocator).toBe(
      PROVENANCE +
        " Raised from three to four on 2026-09-29 so a four-day strength split can schedule" +
        " its cardio without this ceiling trimming it first."
    );
  });

  it("still fails closed on the effort copy itself the moment it is removed", () => {
    // The fail-closed behaviour is what protected clients before the copy
    // existed, and it has to survive the copy arriving.
    const resolution = resolveTrainingParameters(bundleFile.content, []);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reasonCodes).toContain("TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE");
  });

  it("carries the reviewer's three sentences with no number in any of them", () => {
    const supplied = [
      EFFORT_STRENGTH_TEMPLATE_ID,
      EFFORT_CARDIO_TEMPLATE_ID,
      "PRESCRIPTION.EXPLANATION.NUTRITION.TARGET.V1",
    ].map((id) => templates.find((template) => template.id === id)!);
    expect(supplied.every(Boolean)).toBe(true);
    for (const template of supplied) {
      const text = template.nextStepText;
      expect({ id: template.id, digit: ANY_DIGIT.test(text) }).toMatchObject({
        id: template.id,
        digit: false,
      });
      expect({ id: template.id, word: NUMBER_WORD.exec(text)?.[0] ?? null }).toMatchObject({
        id: template.id,
        word: null,
      });
    }
  });
});

describe("S-17 — signed evidence registry", () => {
  const bundleContent = bundleFile.content;
  const bundleMetadata = (() => {
    if (bundleFile.reviewMetadata.decision !== "APPROVED")
      throw new Error("policy bundle is not signed");
    return bundleFile.reviewMetadata;
  })();

  /**
   * The only claim whose source is not derivable from the bundle: it backs a
   * rule rather than a numeric parameter, so it has no `proposalProvenance` row.
   * Worksheet section 2 item 9 supplied it, and pinning it here keeps the
   * "no invented citation" guard total — every other claim is derived, and this
   * one is checked against the worksheet value.
   */
  const OWNER_SUPPLIED_CLAIM_SOURCES: Record<string, string> = {
    "CLAIM.AHA.ACC.TOS.OBESITY.NUTRITION_EVIDENCE": "https://pubmed.ncbi.nlm.nih.gov/24222017/",
  };

  /** Re-derived from the bundle here, independently of whatever wrote the file. */
  const expectedByClaim = new Map<string, { ruleIds: Set<string>; sourceUrls: Set<string> }>();
  for (const parameter of bundleContent.numericParameters) {
    for (const claimId of parameter.evidenceClaimIds) {
      const entry = expectedByClaim.get(claimId) ?? { ruleIds: new Set(), sourceUrls: new Set() };
      for (const ruleId of parameter.applicabilityRuleIds) entry.ruleIds.add(ruleId);
      expectedByClaim.set(claimId, entry);
    }
  }
  for (const row of bundleMetadata.proposalProvenance ?? []) {
    expectedByClaim.get(row.sourceClaimId)?.sourceUrls.add(row.sourceUrl);
  }

  it("is signed, non-synthetic, and keeps its parameter provenance across the signature", () => {
    expect(evidenceFile.fileSchemaVersion).toBe(1);
    expect(evidenceFile.reviewMetadata.decision).toBe("APPROVED");
    expect(evidenceRegistryContentSchema.parse(evidenceFile.content).artifactKey).toBe(
      "evidence-registry-v1"
    );
    // S-17 decision 2: signing used to drop `proposalProvenance`, which is the
    // field the citation guard below reads. This asserts it survived.
    expect(bundleMetadata.proposalProvenance?.length).toBe(
      bundleContent.numericParameters.length
    );
  });

  it("marks every claim ACCEPTED, consistent with the file being signed", () => {
    expect(evidenceFile.reviewStates).toHaveLength(claims.length);
    for (const state of evidenceFile.reviewStates) {
      expect({ itemId: state.itemId, reviewState: state.reviewState }).toMatchObject({
        itemId: state.itemId,
        reviewState: "ACCEPTED",
      });
    }
  });

  it("names no source the policy bundle does not record, or the worksheet did not supply", () => {
    // The guard that makes inventing a citation structurally impossible here.
    expect(expectedByClaim.size).toBeGreaterThan(0);
    for (const claim of claims) {
      const expected = expectedByClaim.get(claim.id);
      if (!expected) {
        expect({ id: claim.id, sourceUrl: claim.sourceUrl }).toEqual({
          id: claim.id,
          sourceUrl: OWNER_SUPPLIED_CLAIM_SOURCES[claim.id],
        });
        continue;
      }
      expect({ id: claim.id, sourceUrl: claim.sourceUrl }).toMatchObject({
        id: claim.id,
        sourceUrl: [...expected.sourceUrls][0],
      });
      expect(expected.sourceUrls.size).toBe(1);
    }
  });

  it("cites no placeholder source except the one sanctioned owner-adoption claim", () => {
    // Worksheet section 2 replaced both. A signed artifact must not carry an
    // `example.invalid` URL or a `CLAIM.PENDING.*` id: each one was a record
    // saying "nothing supports this yet", which a signature cannot be put on.
    //
    // S-23 carve-out, decided by the accountable owner and recorded on the
    // board. Exactly one claim is permitted a placeholder host, because the
    // artifact schema has no other way to say "adopted by the owner, no
    // external source": every numeric parameter must name a claim and every
    // other claim must name a real source. Relaxing it for that one claim is
    // narrower than the alternative, which was attaching a literature citation
    // to values whose own record says they were never checked against one.
    //
    // Keyed to the same sanctioned list as the claim-shape guard below.
    const PLACEHOLDER_HOST_PERMITTED = OWNER_ADOPTION_CLAIM_IDS;
    expect(PLACEHOLDER_HOST_PERMITTED).toHaveLength(1);

    const placeholderHosted = claims
      .filter((claim) => new URL(claim.sourceUrl).hostname.endsWith("example.invalid"))
      .map((claim) => claim.id);
    // Set equality in both directions: an unsanctioned placeholder fails, and
    // so does leaving the carve-out in place after the claim it covers is gone.
    expect([...placeholderHosted].sort()).toEqual([...PLACEHOLDER_HOST_PERMITTED].sort());

    for (const claim of claims) {
      expect({
        id: claim.id,
        pending: claim.id.startsWith(PENDING_EVIDENCE_CLAIM_ID_PREFIX),
      }).toMatchObject({ id: claim.id, pending: false });
    }
  });

  it("keeps the carve-out honest: the sanctioned claim denies being evidence", () => {
    // A placeholder host is only defensible if the claim says outright that
    // nothing supports the values. If that wording is ever softened into an
    // ordinary citation, the carve-out stops being narrow and this fails.
    const owner = claims.find((claim) => claim.id === "CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION");
    expect(owner).toBeDefined();
    if (!owner) return;
    expect(owner.claim.startsWith("ADOPTED WITHIN SCOPE, NOT EVIDENCE.")).toBe(true);
    expect(
      owner.limitations.some(
        (limitation) =>
          limitation.startsWith("NOT EVIDENCE:") &&
          limitation.includes(
            "proposed by engineering, adopted by me, not verified against a primary " +
              "literature source."
          )
      )
    ).toBe(true);
    // And it must not quietly acquire a second, real-looking source.
    expect(new URL(owner.sourceUrl).hostname.endsWith("example.invalid")).toBe(true);
  });

  it("binds every claim to the exact policy rules its parameters declare", () => {
    const policyRuleIds = new Set(bundleContent.ruleIds);
    for (const claim of claims) {
      const expected = expectedByClaim.get(claim.id);
      if (expected) {
        expect({ id: claim.id, ruleIds: [...claim.ruleIds].sort() }).toMatchObject({
          id: claim.id,
          ruleIds: [...expected.ruleIds].sort(),
        });
      }
      for (const ruleId of claim.ruleIds) {
        expect({ id: claim.id, ruleId, known: policyRuleIds.has(ruleId) }).toMatchObject({
          id: claim.id,
          ruleId,
          known: true,
        });
      }
    }
  });

  it("covers every policy evidence rule, so the gate cannot throw ARTIFACT_INCOMPATIBLE with no decision row", () => {
    expect(bundleContent.evidenceRuleIds.length).toBeGreaterThan(0);
    for (const ruleId of bundleContent.evidenceRuleIds) {
      const covering = claims.filter((claim) => claim.ruleIds.includes(ruleId));
      expect({ ruleId, covering: covering.map((claim) => claim.id) }).not.toEqual({
        ruleId,
        covering: [],
      });
    }
  });

  it("covers every claim the policy bundle's numeric parameters reference", () => {
    const claimIds = new Set(claims.map((claim) => claim.id));
    for (const claimId of expectedByClaim.keys()) {
      expect({ claimId, present: claimIds.has(claimId) }).toMatchObject({ claimId, present: true });
    }
  });

  it("names the accountable owner on every claim, and claims no credential anywhere", () => {
    // The predecessor of this test pinned the UNREVIEWED_* sentinels, because
    // nobody had reviewed anything. What it was really protecting is unchanged:
    // the registry must never assert a credential. Worksheet section 0 records
    // that no registration number, licence or certifying body is claimed, so a
    // scan of the whole file is the stronger form of the same guard.
    for (const claim of claims) {
      expect({ id: claim.id, reviewer: claim.reviewer }).toEqual({
        id: claim.id,
        reviewer: { name: SIGNER_NAME, qualifications: [SIGNER_QUALIFICATION] },
      });
      expect(claim.reviewDate).toBe(REVIEW_DATE);
    }

    let scanned = JSON.stringify(evidenceFile);
    for (const denial of CREDENTIAL_DENIALS) {
      expect(scanned).toContain(denial);
      scanned = scanned.split(denial).join(" ");
    }
    expect({ term: CREDENTIAL_CLAIM.exec(scanned)?.[0] ?? null }).toEqual({ term: null });

    // And the unreviewed-draft sentinels are gone: a signed registry that still
    // named one would have been signed without being looked at.
    expect(JSON.stringify(evidenceFile)).not.toContain(UNREVIEWED_DRAFT_REVIEWER_NAME);
    expect(JSON.stringify(evidenceFile)).not.toContain(UNREVIEWED_DRAFT_QUALIFICATION);
  });

  it("states no number in any claim, and allows digits only inside a recorded locator or citation", () => {
    const DIGIT_BEARING_PREFIXES = [
      "Locator recorded by the policy bundle: ",
      "Citation supplied by the accountable owner: ",
    ];
    for (const claim of claims) {
      expect({ id: claim.id, digit: ANY_DIGIT.test(claim.claim) }).toMatchObject({
        id: claim.id,
        digit: false,
      });
      expect({ id: claim.id, word: NUMBER_WORD.exec(claim.claim)?.[0] ?? null }).toMatchObject({
        id: claim.id,
        word: null,
      });
      expect({ id: claim.id, digit: ANY_DIGIT.test(claim.population) }).toMatchObject({
        id: claim.id,
        digit: false,
      });
      for (const limitation of claim.limitations) {
        if (!ANY_DIGIT.test(limitation)) continue;
        expect({
          id: claim.id,
          limitation,
          prefixed: DIGIT_BEARING_PREFIXES.some((prefix) => limitation.startsWith(prefix)),
        }).toMatchObject({ id: claim.id, limitation, prefixed: true });
      }
    }
  });

  it("claims a scope attestation and denies an independent verification, in every sourced claim", () => {
    // This is the line S-17 was told to hold and the reason this test exists.
    // What happened: the accountable owner confirmed each source supports the
    // rule it is bound to, within the general fitness and wellness scope.
    // What did not happen: anyone reading a source's full text and checking it.
    // A claim that asserts the first must keep denying the second, or the
    // signature starts meaning something nobody did.
    //
    // S-23 changed this guard's premise rather than its strength. It used to
    // read "every claim", because every claim cited a source. One now does not,
    // by the accountable owner's decision, so the shape it must take instead is
    // asserted below with equal force. The two shapes are keyed to
    // {@link OWNER_ADOPTION_CLAIM_IDS} and cannot overlap.
    const sourced = claims.filter((claim) => !OWNER_ADOPTION_CLAIM_IDS.includes(claim.id));
    expect(sourced.length).toBe(claims.length - OWNER_ADOPTION_CLAIM_IDS.length);
    expect(sourced.length).toBeGreaterThan(0);

    for (const claim of sourced) {
      expect({ id: claim.id, opens: claim.claim.startsWith("CONFIRMED WITHIN SCOPE.") }).toEqual({
        id: claim.id,
        opens: true,
      });
      expect({ id: claim.id, claim: claim.claim }).toMatchObject({
        id: claim.id,
        claim: expect.stringContaining(
          "the accountable owner confirms that this source supports that rule within the " +
            "general fitness and wellness scope"
        ) as unknown as string,
      });
      expect(claim.claim).toContain(
        "Steadfast has not independently verified the source's full text"
      );

      const attested = claim.limitations.some((limitation) =>
        limitation.startsWith("SCOPE ATTESTATION:")
      );
      const denied = claim.limitations.some((limitation) =>
        limitation.startsWith("Steadfast has not independently verified the cited source's")
      );
      expect({ id: claim.id, attested, denied }).toEqual({ id: claim.id, attested: true, denied: true });
    }
  });

  it("holds the sanctioned owner-adoption claim to the opposite shape, with equal force", () => {
    // The second permitted shape, authorized with the carve-out. A claim that
    // cites nothing cannot say "this source supports that rule" — so where the
    // sourced shape *requires* those phrases, this one *forbids* them, and the
    // denial it carries instead is mandatory rather than optional. The point is
    // that the two shapes cannot converge: neither can be edited into the other
    // without failing here.

    // Keyed both ways. A claim taking this shape without being on the list
    // fails, and a listed claim that stops taking it fails.
    const takesOwnerShape = claims
      .filter((claim) => claim.claim.startsWith("ADOPTED WITHIN SCOPE, NOT EVIDENCE."))
      .map((claim) => claim.id);
    expect([...takesOwnerShape].sort()).toEqual([...OWNER_ADOPTION_CLAIM_IDS].sort());

    // And the same keying from the sourced side, so a claim cannot simply drop
    // both openers and belong to neither shape.
    const takesSourcedShape = claims
      .filter((claim) => claim.claim.startsWith("CONFIRMED WITHIN SCOPE."))
      .map((claim) => claim.id);
    expect([...takesSourcedShape, ...takesOwnerShape].sort()).toEqual(
      claims.map((claim) => claim.id).sort()
    );

    for (const id of OWNER_ADOPTION_CLAIM_IDS) {
      const claim = claims.find((item) => item.id === id);
      expect({ id, found: Boolean(claim) }).toEqual({ id, found: true });
      if (!claim) continue;

      // Mandatory: the opener and the NOT EVIDENCE limitation.
      expect({ id, opens: claim.claim.startsWith("ADOPTED WITHIN SCOPE, NOT EVIDENCE.") }).toEqual({
        id,
        opens: true,
      });
      const denies = claim.limitations.some((limitation) =>
        limitation.startsWith("NOT EVIDENCE:")
      );
      expect({ id, denies }).toEqual({ id, denies: true });

      // Forbidden: every phrase the sourced shape is required to carry.
      for (const phrase of SOURCE_BACKED_CLAIM_PHRASES) {
        const haystack = [claim.claim, claim.population, ...claim.limitations].join(" ");
        expect({ id, phrase, present: haystack.includes(phrase) }).toEqual({
          id,
          phrase,
          present: false,
        });
      }

      // Forbidden: any affirmative "supports / verified / confirmed / evidence
      // for" at all. The handful of negations and the scope attestation are
      // pinned strings and are stripped first, so softening one into an
      // assertion leaves the bare word behind and fails here.
      let scanned = [claim.claim, claim.population, ...claim.limitations].join(" ");
      for (const negation of OWNER_ADOPTION_PERMITTED_NEGATIONS) {
        expect({ id, negation, present: scanned.includes(negation) }).toEqual({
          id,
          negation,
          present: true,
        });
        scanned = scanned.split(negation).join(" ");
      }
      expect({ id, affirmative: AFFIRMATIVE_BACKING.exec(scanned)?.[0] ?? null }).toEqual({
        id,
        affirmative: null,
      });
    }
  });

  it("asserts no verification wording anywhere that the reviewer did not perform", () => {
    // The failure this guards is a later edit quietly upgrading "confirmed the
    // binding" into "verified the source", which is the claim nobody can make.
    const FALSE_VERIFICATION =
      /\b(has verified|have verified|independently verified the source's full text against|peer[- ]reviewed by|validated against the full text)\b/i;
    for (const claim of claims) {
      const haystack = [claim.claim, claim.population, ...claim.limitations].join(" ");
      const scrubbed = haystack
        .split("Steadfast has not independently verified the source's full text")
        .join(" ")
        .split("Steadfast has not independently verified the cited source's full text")
        .join(" ");
      expect({ id: claim.id, term: FALSE_VERIFICATION.exec(scrubbed)?.[0] ?? null }).toEqual({
        id: claim.id,
        term: null,
      });
    }
  });
});

describe("S-V1-artifacts — loaders refuse production and refuse unsigned registration", () => {
  it("throws when loadDraftUnsignedEvidenceRegistry is called in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => loadDraftUnsignedEvidenceRegistry()).toThrow(
        "Draft unsigned artifacts cannot be loaded in production environments."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("throws when loadDraftUnsignedEscalationTemplates is called in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => loadDraftUnsignedEscalationTemplates()).toThrow(
        "Draft unsigned artifacts cannot be loaded in production environments."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("converts both signed artifacts, and refuses the same call on an unsigned file", () => {
    const evidenceInput = evidenceRegistryToArtifactDraftInput(evidenceFile, []);
    const escalationInput = escalationTemplatesToArtifactDraftInput(escalationFile, []);
    expect(parseArtifactDraftInput(evidenceInput).kind).toBe("EVIDENCE_REGISTRY");
    expect(parseArtifactDraftInput(escalationInput).kind).toBe("ESCALATION_TEMPLATES");
    expect(evidenceInput.synthetic).toBe(false);
    expect(escalationInput.synthetic).toBe(false);
    expect(evidenceInput.reviewMetadata).toEqual(evidenceFile.reviewMetadata);
    expect(escalationInput.reviewMetadata).toEqual(escalationFile.reviewMetadata);

    // The refusal is unchanged for a file that has not been signed.
    const unsigned = { ...evidenceFile, reviewMetadata: DRAFT_UNSIGNED_METADATA };
    expect(() => evidenceRegistryToArtifactDraftInput(unsigned, [])).toThrow(
      "signed review metadata"
    );
  });

  it("a signed file whose records are still PROPOSED does not parse", () => {
    // "Approved at the top, unreviewed underneath" was representable before S-17.
    const mixed = {
      ...structuredClone(evidenceFile),
      reviewStates: evidenceFile.reviewStates.map((state, index) =>
        index === 0 ? { ...state, reviewState: "PROPOSED" } : state
      ),
    };
    expect(() => draftEvidenceRegistryFileSchema.parse(mixed)).toThrow(
      /APPROVED artifacts carry ACCEPTED records/
    );
  });

  it("registering either artifact as synthetic is refused downstream too", () => {
    const syntheticInput = {
      ...evidenceRegistryToArtifactDraftInput(evidenceFile, []),
      synthetic: true,
    };
    expect(() => parseArtifactDraftInput(syntheticInput)).toThrow(
      "Synthetic artifacts must carry synthetic-only jurisdiction review status"
    );
  });
});

describe("S-V1-artifacts — the draft content stays out of every client-reachable module", () => {
  const SCANNED_ROOTS = ["lib", "app", "components"];

  function sourceFiles(root: string): string[] {
    const absolute = path.join(process.cwd(), root);
    if (!fs.existsSync(absolute)) return [];
    const found: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "generated") continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          found.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(absolute);
    return found;
  }

  const files = SCANNED_ROOTS.flatMap(sourceFiles);
  const DRAFT_MODULES = [
    "artifacts/drafts/evidence-registry",
    "artifacts/drafts/escalation-templates",
  ];

  it("scans a real, non-empty set of production modules", () => {
    // A silently empty scan would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("lib/ai-coach/autonomy/gate.ts");
    expect(files).toContain("components/ai-coach/evidence-forms.tsx");
  });

  it("is imported by no module under app/ or components/", () => {
    const clientReachable = files.filter(
      (file) => file.startsWith("app/") || file.startsWith("components/")
    );
    expect(clientReachable.length).toBeGreaterThan(0);
    for (const file of clientReachable) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const draftModule of DRAFT_MODULES) {
        expect({ file, draftModule, imports: source.includes(draftModule) }).toMatchObject({
          file,
          draftModule,
          imports: false,
        });
      }
    }
  });

  it("keeps each draft JSON behind exactly one static importer, the guarded loader", () => {
    for (const [json, loader] of [
      [
        "evidence-registry.draft-unsigned.v1.json",
        "lib/ai-coach/artifacts/drafts/evidence-registry.ts",
      ],
      [
        "escalation-templates.draft-unsigned.v1.json",
        "lib/ai-coach/artifacts/drafts/escalation-templates.ts",
      ],
    ] as const) {
      const pattern = new RegExp(`from\\s+["'][^"']*${json.replace(/\./g, "\\.")}["']`);
      const importers = files.filter((file) =>
        pattern.test(fs.readFileSync(path.join(process.cwd(), file), "utf8"))
      );
      expect(importers).toEqual([loader]);
    }
  });

  it("leaves pausedDomains and geographies without a runtime reader", () => {
    // Both fields sit in the hashed content, neither has a consumer, and the
    // approval template has no way to say "nothing is paused" (see the README).
    // If that changes, this test fails and the value stops being inert.
    const ALLOWED = new Set([
      "lib/ai-coach/artifacts/schema.ts",
      "lib/ai-coach/artifacts/synthetic-fixtures.ts",
      "lib/ai-coach/artifacts/drafts/escalation-templates.ts",
    ]);
    for (const field of ["pausedDomains", "geographies"]) {
      const readers = files.filter((file) =>
        fs.readFileSync(path.join(process.cwd(), file), "utf8").includes(field)
      );
      expect(readers.filter((file) => !ALLOWED.has(file))).toEqual([]);
    }
  });
});
