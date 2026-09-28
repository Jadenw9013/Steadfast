import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { loadDraftUnsignedPolicyBundle } from "@/lib/ai-coach/artifacts/drafts/loader";
import type {
  EscalationTemplatesContent,
  PolicyBundleContent,
} from "@/lib/ai-coach/artifacts/schema";
import {
  enableDraftExerciseCatalog,
  disableDraftExerciseCatalog,
} from "@/lib/ai-coach/catalog/draft-exercise-catalog";
import { trainingCatalogSourceFromDraftFile } from "@/lib/ai-coach/training/catalog-source";
import { composeTraining } from "@/lib/ai-coach/training/index";
import {
  resolveTrainingParameters,
  EFFORT_STRENGTH_TEMPLATE_ID,
  EFFORT_CARDIO_TEMPLATE_ID,
} from "@/lib/ai-coach/training/parameters";
import type {
  ComposeTrainingInput,
  ExperienceLevel,
  ResolvedTrainingParameters,
  SessionLengthBand,
  TrainingCatalogSource,
  TrainingEquipmentAccess,
} from "@/lib/ai-coach/training/types";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";

const REPO_ROOT = path.resolve(__dirname, "../..");
const TRAINING_DIR = path.resolve(REPO_ROOT, "lib/ai-coach/training");

describe("T-2039 — deterministic training and cardio composer", () => {
  let catalog: TrainingCatalogSource;
  let syntheticParams: ResolvedTrainingParameters;
  let effortText: { strength: string; cardio: string };

  beforeAll(() => {
    enableDraftExerciseCatalog();
    catalog = trainingCatalogSourceFromDraftFile();

    const set = buildSyntheticArtifactSet();
    const escalation = set.escalationTemplates.content as EscalationTemplatesContent;
    if (!("templates" in escalation)) throw new Error("fixture shape changed");
    const explanationTexts = escalation.templates.map((t) => ({
      id: t.id,
      text: t.nextStepText,
    }));
    const resolved = resolveTrainingParameters(
      set.policyBundle.content as PolicyBundleContent,
      explanationTexts
    );
    if (!resolved.ok) throw new Error("Synthetic parameter resolution failed");
    syntheticParams = resolved.parameters;
    effortText = resolved.effortText;
  });

  afterAll(() => {
    disableDraftExerciseCatalog();
  });

  describe("1. 630-case full matrix simulation", () => {
    const equipmentSets: TrainingEquipmentAccess[][] = [
      ["NONE"],
      ["HOME_BASIC"],
      ["FULL_GYM"],
      ["NONE", "HOME_BASIC"],
      ["HOME_BASIC", "FULL_GYM"],
      ["NONE", "HOME_BASIC", "FULL_GYM"],
    ];

    const trainingDays = [1, 2, 3, 4, 5, 6, 7];
    const experiences: ExperienceLevel[] = ["NEW", "RETURNING", "EXPERIENCED"];
    const bands: SessionLengthBand[] = [
      "UNDER_30",
      "MIN_30_45",
      "MIN_45_60",
      "MIN_60_90",
      "OVER_90",
    ];

    it("composes successfully and parses through planPayloadSchema for all 630 cases", () => {
      let caseCount = 0;
      for (const equipmentAccess of equipmentSets) {
        for (const days of trainingDays) {
          for (const exp of experiences) {
            for (const band of bands) {
              caseCount++;
              const result = composeTraining(syntheticParams, catalog, effortText, {
                intakeVersion: 2,
                trainingDaysPerWeek: days,
                equipmentAccess,
                experienceLevel: exp,
                sessionLengthBand: band,
                trainingContextStatus: "CONFIRMED",
                energyReducedRelativeToMaintenance: false,
                activeContraindicationRuleIds: [],
              });

              expect(result.status).toBe("COMPOSED");
              if (result.status !== "COMPOSED") continue;

              const payloadCandidate = {
                schemaVersion: 1,
                contentKind: "SYNTHETIC_FIXTURE",
                nutrition: null,
                meals: null,
                strength: result.strength,
                cardio: result.cardio,
                policyVersion: "policy-bundle-nutrition:v1",
                catalogVersions: {
                  food: "food-fixture-v1",
                  exercise: catalog.catalogVersion,
                },
              };

              const parsed = planPayloadSchema.safeParse(payloadCandidate);
              expect(parsed.success).toBe(true);

              const sessionIds = new Set<string>();
              for (const s of [...result.strength, ...result.cardio]) {
                expect(sessionIds.has(s.sessionId)).toBe(false);
                sessionIds.add(s.sessionId);
                expect(s.day).toBeGreaterThanOrEqual(1);
                expect(s.day).toBeLessThanOrEqual(7);
              }

              for (const s of result.strength) {
                const exIds = new Set<string>();
                for (const ex of s.exercises) {
                  expect(exIds.has(ex.exerciseId)).toBe(false);
                  exIds.add(ex.exerciseId);

                  const catalogEx = catalog.exercises.get(ex.exerciseId);
                  expect(catalogEx).toBeDefined();
                  if (catalogEx) {
                    const performable = catalogEx.equipmentIds.some((eq) =>
                      equipmentAccess.includes(eq)
                    );
                    expect(performable).toBe(true);
                  }
                }

                expect(s.exercises.length).toBeGreaterThanOrEqual(syntheticParams.exerciseCountMin);
                expect(s.exercises.length).toBeLessThanOrEqual(
                  syntheticParams.exerciseCountMaxByBand[band]
                );
              }
            }
          }
        }
      }
      expect(caseCount).toBe(630);
    });
  });

  describe("2. Contraindication excludes and substitutes", () => {
    it("excludes contraindicated exercise, substitutes alternative, and payload parses", () => {
      // With FULL_GYM and 1 day (full-body-session-one):
      // dumbbell-romanian-deadlift carries CONTRA.SPINAL_LOADING.V1.
      // Its substitution hip-hinge-to-wall does not carry it.
      const baseInput: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 1,
        equipmentAccess: ["FULL_GYM"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_45_60",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: ["CONTRA.SPINAL_LOADING.V1"],
      };

      const result = composeTraining(syntheticParams, catalog, effortText, baseInput);
      expect(result.status).toBe("COMPOSED");
      if (result.status !== "COMPOSED") return;

      const exerciseIds = result.strength.flatMap((s) => s.exercises.map((e) => e.exerciseId));
      expect(exerciseIds).not.toContain("dumbbell-romanian-deadlift");
      expect(exerciseIds).toContain("hip-hinge-to-wall");

      const payloadCandidate = {
        schemaVersion: 1,
        contentKind: "SYNTHETIC_FIXTURE",
        nutrition: null,
        meals: null,
        strength: result.strength,
        cardio: result.cardio,
        policyVersion: "policy-bundle-nutrition:v1",
        catalogVersions: {
          food: "food-fixture-v1",
          exercise: catalog.catalogVersion,
        },
      };
      expect(planPayloadSchema.safeParse(payloadCandidate).success).toBe(true);
    });
  });

  describe("3. Contraindication fails closed", () => {
    it("fails closed with TRAINING_CONTRAINDICATED_NO_SUBSTITUTE when an exercise and all its alternatives are contraindicated", () => {
      // In full-body-session-three, dumbbell-farmer-carry has substitutionIds: ["dumbbell-farmer-carry"]
      // and contraindicationRuleIds: ["CONTRA.GRIP_DEMAND.V1"].
      // When CONTRA.GRIP_DEMAND.V1 is active, it and its only substitution are contraindicated.
      const input: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["HOME_BASIC"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_60_90",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: ["CONTRA.GRIP_DEMAND.V1"],
      };

      const result = composeTraining(syntheticParams, catalog, effortText, input);
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.reasonCodes).toContain("TRAINING_CONTRAINDICATED_NO_SUBSTITUTE");
      expect(result.strength).toEqual([]);
      expect(result.cardio).toEqual([]);
    });

    it("never silently drops an exercise when an alternative is blocked", () => {
      // Isolated test with custom catalog
      const testCatalog: TrainingCatalogSource = {
        catalogVersion: "test-catalog-v1",
        exercises: new Map([
          [
            "ex-1",
            {
              id: "ex-1",
              name: "Exercise 1",
              modality: "STRENGTH",
              equipmentIds: ["NONE"],
              substitutionIds: ["ex-1-sub"],
              contraindicationRuleIds: ["CONTRA.TEST.V1"],
              beginnerConstraintIds: [],
              equipmentAlternatives: [],
            },
          ],
          [
            "ex-1-sub",
            {
              id: "ex-1-sub",
              name: "Exercise 1 Sub",
              modality: "STRENGTH",
              equipmentIds: ["NONE"],
              substitutionIds: [],
              contraindicationRuleIds: ["CONTRA.TEST.V1"],
              beginnerConstraintIds: [],
              equipmentAlternatives: [],
            },
          ],
        ]),
        templates: [
          {
            id: "tpl-1",
            templateKind: "FULL_BODY",
            sequence: 1,
            exerciseIds: ["ex-1"],
            beginnerConstraintIds: [],
          },
        ],
      };

      const result = composeTraining(syntheticParams, testCatalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 1,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "UNDER_30",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: ["CONTRA.TEST.V1"],
      });

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.reasonCodes).toContain("TRAINING_CONTRAINDICATED_NO_SUBSTITUTE");
      expect(result.strength).toEqual([]);
      expect(result.cardio).toEqual([]);
    });
  });

  describe("4. Unknown IDs are rejected", () => {
    it("returns TRAINING_TEMPLATE_UNAVAILABLE when a template references an uncatalogued exercise ID", () => {
      const corruptCatalog: TrainingCatalogSource = {
        catalogVersion: catalog.catalogVersion,
        exercises: new Map(catalog.exercises),
        templates: [
          {
            id: "corrupted-template",
            templateKind: "FULL_BODY",
            sequence: 1,
            exerciseIds: ["non-existent-exercise-id"],
            beginnerConstraintIds: [],
          },
        ],
      };

      const result = composeTraining(syntheticParams, corruptCatalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 1,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "UNDER_30",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.reasonCodes).toContain("TRAINING_TEMPLATE_UNAVAILABLE");
      expect(result.strength).toEqual([]);
      expect(result.cardio).toEqual([]);
    });

    it("fails planPayloadSchema parse if a composed payload is hand-mutated to an unknown exerciseId", () => {
      const result = composeTraining(syntheticParams, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 1,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "UNDER_30",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(result.status).toBe("COMPOSED");
      if (result.status !== "COMPOSED") return;

      const mutatedStrength = structuredClone(result.strength);
      mutatedStrength[0].exercises[0].exerciseId = "fabricated-exercise-id";

      const payload = {
        schemaVersion: 1,
        contentKind: "SYNTHETIC_FIXTURE",
        nutrition: null,
        meals: null,
        strength: mutatedStrength,
        cardio: result.cardio,
        policyVersion: "policy-bundle-nutrition:v1",
        catalogVersions: {
          food: "food-fixture-v1",
          exercise: catalog.catalogVersion,
        },
      };

      const parsed = planPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });
  });

  describe("5. Missing parameters fail closed and are reported in full", () => {
    it("fails parameter resolution against draft bundle with exact 23 missing IDs matching catalogue doc Section 4.2", () => {
      const draftBundle = loadDraftUnsignedPolicyBundle();
      const explanationTexts = [
        { id: EFFORT_STRENGTH_TEMPLATE_ID, text: "Strength effort guidance." },
        { id: EFFORT_CARDIO_TEMPLATE_ID, text: "Cardio effort guidance." },
      ];

      const resolution = resolveTrainingParameters(draftBundle.content, explanationTexts);
      expect(resolution.ok).toBe(false);
      if (resolution.ok) return;

      expect(resolution.reasonCodes).toContain("TRAINING_PARAMETER_MISSING");
      expect(resolution.missingParameterIds.length).toBe(23);

      // Read 17-Policy-Parameter-Catalogue.md and verify exact match
      const catalogueDocPath = path.resolve(
        REPO_ROOT,
        "docs/ai-coach/17-Policy-Parameter-Catalogue.md"
      );
      const docContent = fs.readFileSync(catalogueDocPath, "utf-8");

      const section42Start = docContent.indexOf(
        "### 4.2 Training Parameters Awaiting Professional Review (23)"
      );
      expect(section42Start).toBeGreaterThan(0);
      const section43Start = docContent.indexOf(
        "### 4.3 Progression Parameters Awaiting Professional Review (12)"
      );
      expect(section43Start).toBeGreaterThan(section42Start);

      const section42Text = docContent.slice(section42Start, section43Start);
      const expectedIdsFromDoc: string[] = [];
      const rowRegex = /^\|\s*`([A-Z0-9_.]+)`\s*\|/gm;
      let match: RegExpExecArray | null;
      while ((match = rowRegex.exec(section42Text)) !== null) {
        expectedIdsFromDoc.push(match[1]);
      }

      expectedIdsFromDoc.sort();
      expect(expectedIdsFromDoc.length).toBe(23);
      expect(resolution.missingParameterIds).toEqual(expectedIdsFromDoc);
    });

    it("composeTraining returns TRAINING_PARAMETER_MISSING when parameters are missing", () => {
      const result = composeTraining(
        null as unknown as ResolvedTrainingParameters,
        catalog,
        effortText,
        {
          intakeVersion: 2,
          trainingDaysPerWeek: 3,
          equipmentAccess: ["NONE"],
          experienceLevel: "NEW",
          sessionLengthBand: "MIN_30_45",
          trainingContextStatus: "CONFIRMED",
          energyReducedRelativeToMaintenance: false,
          activeContraindicationRuleIds: [],
        }
      );

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.reasonCodes).toContain("TRAINING_PARAMETER_MISSING");
      expect(result.strength).toEqual([]);
      expect(result.cardio).toEqual([]);
    });
  });

  describe("6. Missing inputs fail closed", () => {
    it("reports TRAINING_INPUT_MISSING with exact missing field names", () => {
      const res1 = composeTraining(syntheticParams, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: null,
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(res1.status).toBe("UNAVAILABLE");
      expect(res1.reasonCodes).toContain("TRAINING_INPUT_MISSING");
      if (res1.status === "UNAVAILABLE") {
        expect(res1.missingInputs).toEqual(["sessionLengthBand"]);
      }

      const res2 = composeTraining(syntheticParams, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_30_45",
        trainingContextStatus: "UNKNOWN",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(res2.status).toBe("UNAVAILABLE");
      expect(res2.reasonCodes).toContain("TRAINING_INPUT_MISSING");
      if (res2.status === "UNAVAILABLE") {
        expect(res2.missingInputs).toEqual(["trainingContextStatus"]);
      }

      const res3 = composeTraining(syntheticParams, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: null,
        trainingContextStatus: null,
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(res3.status).toBe("UNAVAILABLE");
      expect(res3.reasonCodes).toContain("TRAINING_INPUT_MISSING");
      if (res3.status === "UNAVAILABLE") {
        expect(res3.missingInputs).toEqual(["sessionLengthBand", "trainingContextStatus"]);
      }
    });

    it("reports TRAINING_INTAKE_VERSION_UNSUPPORTED on intakeVersion other than 2", () => {
      const res = composeTraining(syntheticParams, catalog, effortText, {
        intakeVersion: 1 as unknown as 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_30_45",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(res.status).toBe("UNAVAILABLE");
      expect(res.reasonCodes).toContain("TRAINING_INTAKE_VERSION_UNSUPPORTED");
    });
  });

  describe("7. Workload caps", () => {
    it("reports the catalog session cap when a five-day strength request is reduced to four", () => {
      const permissive: ResolvedTrainingParameters = {
        ...syntheticParams,
        workloadTotalSessionsMax: 20,
        workloadTrainingMinutesMax: 10_000,
        workloadTrainingMinutesMaxWhenEnergyReduced: 10_000,
        workloadConsecutiveTrainingDaysMax: 7,
      };
      const result = composeTraining(permissive, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 5,
        equipmentAccess: ["FULL_GYM"],
        experienceLevel: "EXPERIENCED",
        sessionLengthBand: "MIN_45_60",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(result.status).toBe("COMPOSED");
      if (result.status !== "COMPOSED") return;
      expect(result.strength).toHaveLength(4);
      expect(result.reasonCodes).toContain("TRAINING_STRENGTH_SESSIONS_REDUCED");
      expect(result.appliedCapIds).toContain("TRAINING.TEMPLATE.DAYS.SUPPORTED_MAX");
    });

    it("reports the consecutive-days cap when cardio is reduced to zero", () => {
      const consecutiveOne: ResolvedTrainingParameters = {
        ...syntheticParams,
        workloadTotalSessionsMax: 20,
        workloadTrainingMinutesMax: 10_000,
        workloadTrainingMinutesMaxWhenEnergyReduced: 10_000,
        workloadConsecutiveTrainingDaysMax: 1,
      };
      const result = composeTraining(consecutiveOne, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["FULL_GYM"],
        experienceLevel: "EXPERIENCED",
        sessionLengthBand: "MIN_45_60",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(result.status).toBe("COMPOSED");
      if (result.status !== "COMPOSED") return;
      expect(result.cardio).toHaveLength(0);
      expect(result.reasonCodes).toContain("TRAINING_CARDIO_REDUCED");
      expect(result.reasonCodes).toContain("TRAINING_CARDIO_NOT_ASSIGNED");
      expect(result.appliedCapIds).toContain("WORKLOAD.WEEKLY.CONSECUTIVE_TRAINING_DAYS.MAX");
    });

    it("applies energy-reduced workload cap when energyReducedRelativeToMaintenance is true or null", () => {
      const inputTrue: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 6,
        equipmentAccess: ["FULL_GYM"],
        experienceLevel: "EXPERIENCED",
        sessionLengthBand: "OVER_90", // 120 min planned per strength session
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: true,
        activeContraindicationRuleIds: [],
      };

      const resultTrue = composeTraining(syntheticParams, catalog, effortText, inputTrue);
      expect(resultTrue.status).toBe("COMPOSED");
      if (resultTrue.status !== "COMPOSED") return;

      expect(resultTrue.reasonCodes).toContain("TRAINING_WORKLOAD_CAPPED");
      expect(resultTrue.appliedCapIds).toContain(
        "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED"
      );

      const strengthMinutesTrue =
        resultTrue.strength.length *
        syntheticParams.plannedMinutesByBand[inputTrue.sessionLengthBand!];
      const cardioMinutesTrue = resultTrue.cardio.reduce((sum, s) => sum + s.durationMinutes, 0);
      expect(strengthMinutesTrue + cardioMinutesTrue).toBeLessThanOrEqual(
        syntheticParams.workloadTrainingMinutesMaxWhenEnergyReduced
      );

      // null treated identically (most protective)
      const inputNull: ComposeTrainingInput = {
        ...inputTrue,
        energyReducedRelativeToMaintenance: null,
      };
      const resultNull = composeTraining(syntheticParams, catalog, effortText, inputNull);
      expect(resultNull.status).toBe("COMPOSED");
      if (resultNull.status !== "COMPOSED") return;

      expect(resultNull.reasonCodes).toContain("TRAINING_WORKLOAD_CAPPED");
      expect(resultNull.appliedCapIds).toContain(
        "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED"
      );
    });

    it("reports the reviewed dose parameter when it explicitly assigns zero cardio", () => {
      const zeroCardio: ResolvedTrainingParameters = {
        ...syntheticParams,
        cardioSessionsPerWeekByExperience: {
          ...syntheticParams.cardioSessionsPerWeekByExperience,
          NEW: 0,
        },
      };
      const result = composeTraining(zeroCardio, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 2,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_30_45",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });
      expect(result.status).toBe("COMPOSED");
      if (result.status !== "COMPOSED") return;
      expect(result.cardio).toHaveLength(0);
      expect(result.reasonCodes).toContain("TRAINING_CARDIO_NOT_ASSIGNED");
      expect(result.appliedCapIds).toContain("CARDIO.DOSE.NEW.SESSIONS_PER_WEEK");
    });

    it("applies regular workload cap when energyReducedRelativeToMaintenance is false", () => {
      const inputFalse: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 6,
        equipmentAccess: ["FULL_GYM"],
        experienceLevel: "EXPERIENCED",
        sessionLengthBand: "OVER_90",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      };

      const resultFalse = composeTraining(syntheticParams, catalog, effortText, inputFalse);
      expect(resultFalse.status).toBe("COMPOSED");
      if (resultFalse.status !== "COMPOSED") return;

      expect(resultFalse.appliedCapIds).not.toContain(
        "WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED"
      );
      if (resultFalse.appliedCapIds.length > 0) {
        expect(resultFalse.appliedCapIds).toContain("WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX");
      }

      const strengthMinutes =
        resultFalse.strength.length *
        syntheticParams.plannedMinutesByBand[inputFalse.sessionLengthBand!];
      const cardioMinutes = resultFalse.cardio.reduce((sum, s) => sum + s.durationMinutes, 0);
      expect(strengthMinutes + cardioMinutes).toBeLessThanOrEqual(
        syntheticParams.workloadTrainingMinutesMax
      );
    });
  });

  describe("8. Effort text resolution and limits", () => {
    it("populates effort and intensity verbatim when valid", () => {
      const result = composeTraining(syntheticParams, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: 2,
        equipmentAccess: ["NONE"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_30_45",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      });

      expect(result.status).toBe("COMPOSED");
      if (result.status !== "COMPOSED") return;

      for (const s of result.strength) {
        for (const ex of s.exercises) {
          expect(ex.effort).toBe(effortText.strength);
        }
      }
      for (const c of result.cardio) {
        expect(c.intensity).toBe(effortText.cardio);
      }
    });

    it("fails closed with TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE if effort text is missing or exceeds 200 characters", () => {
      const tooLongText = "A".repeat(201);

      const resLong = composeTraining(
        syntheticParams,
        catalog,
        { strength: tooLongText, cardio: effortText.cardio },
        {
          intakeVersion: 2,
          trainingDaysPerWeek: 2,
          equipmentAccess: ["NONE"],
          experienceLevel: "NEW",
          sessionLengthBand: "MIN_30_45",
          trainingContextStatus: "CONFIRMED",
          energyReducedRelativeToMaintenance: false,
          activeContraindicationRuleIds: [],
        }
      );
      expect(resLong.status).toBe("UNAVAILABLE");
      expect(resLong.reasonCodes).toContain("TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE");
      expect(resLong.strength).toEqual([]);
      expect(resLong.cardio).toEqual([]);

      const resMissing = composeTraining(
        syntheticParams,
        catalog,
        { strength: "", cardio: effortText.cardio },
        {
          intakeVersion: 2,
          trainingDaysPerWeek: 2,
          equipmentAccess: ["NONE"],
          experienceLevel: "NEW",
          sessionLengthBand: "MIN_30_45",
          trainingContextStatus: "CONFIRMED",
          energyReducedRelativeToMaintenance: false,
          activeContraindicationRuleIds: [],
        }
      );
      expect(resMissing.status).toBe("UNAVAILABLE");
      expect(resMissing.reasonCodes).toContain("TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE");
    });
  });

  describe("9. Determinism, golden hashes, and v1 corpus guard", () => {
    it("produces identical contentHash across 50 iterations for 3 representative cases and matches pinned literals", () => {
      const case1Input: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 3,
        equipmentAccess: ["HOME_BASIC"],
        experienceLevel: "NEW",
        sessionLengthBand: "MIN_45_60",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      };
      const case2Input: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 4,
        equipmentAccess: ["FULL_GYM"],
        experienceLevel: "EXPERIENCED",
        sessionLengthBand: "MIN_60_90",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: true,
        activeContraindicationRuleIds: [],
      };
      const case3Input: ComposeTrainingInput = {
        intakeVersion: 2,
        trainingDaysPerWeek: 2,
        equipmentAccess: ["NONE"],
        experienceLevel: "RETURNING",
        sessionLengthBand: "UNDER_30",
        trainingContextStatus: "CONFIRMED",
        energyReducedRelativeToMaintenance: false,
        activeContraindicationRuleIds: [],
      };

      const HASH_CASE_1 = "381defa04d2767d538805f496a54fc2a1904c0176eb59e64d6ba98b1bf68fa78";
      const HASH_CASE_2 = "c4b500fe46dc897121d4e356aa9091de9904638947d5ef52431cf497f5062446";
      const HASH_CASE_3 = "20a61f59a15e0fc918ab457c72ce768b9c481f52a4a1d2298d01278083ba99eb";

      for (let i = 0; i < 50; i++) {
        const res1 = composeTraining(syntheticParams, catalog, effortText, case1Input);
        const res2 = composeTraining(syntheticParams, catalog, effortText, case2Input);
        const res3 = composeTraining(syntheticParams, catalog, effortText, case3Input);

        expect(contentHash(res1)).toBe(HASH_CASE_1);
        expect(contentHash(res2)).toBe(HASH_CASE_2);
        expect(contentHash(res3)).toBe(HASH_CASE_3);
      }
    });

    it("preserves byte-identical v1 synthetic corpus hashes across all three fixture intakes", () => {
      const ANSWERS_A = {
        goal: "GENERAL_FITNESS",
        experienceLevel: "NEW",
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        dietaryRestrictions: [],
        allergies: [],
        foodBudgetLevel: "LOW",
        trackingPreference: "NUMBERS_VISIBLE",
        unitsPreference: "METRIC",
        heightCm: 170,
        weightKg: 70,
      };
      const ANSWERS_B = {
        goal: "BODY_COMPOSITION",
        experienceLevel: "NEW",
        trainingDaysPerWeek: 2,
        equipmentAccess: ["NONE"],
        allergies: [],
        dietaryRestrictions: [],
        foodBudgetLevel: "LOW",
        trackingPreference: "NUMBERS_VISIBLE",
        unitsPreference: "METRIC",
        heightCm: 170,
        weightKg: 70,
      };
      const ANSWERS_C = {
        goal: "GENERAL_FITNESS",
        experienceLevel: "NEW",
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        allergies: [],
        dietaryRestrictions: [],
        foodBudgetLevel: "LOW",
        trackingPreference: "NUMBERS_VISIBLE",
        unitsPreference: "METRIC",
        heightCm: 170,
        weightKg: 70,
      };

      const expectedHashes = [
        [
          "A",
          ANSWERS_A,
          "golden-rx",
          "MACROS",
          "3d27280a1e0ca039b8754580915bf849b969936a21891fd12e2e4c410f06178e",
        ],
        [
          "A",
          ANSWERS_A,
          "golden-rx",
          "MEALS",
          "2c0695febd5d845f4002a279c88750f64804ae7ed35d02c64f3bb2acd32d6704",
        ],
        [
          "B",
          ANSWERS_B,
          "golden-rx",
          "MACROS",
          "7c931fa2079ec01f794721bff9ce85c89121805b9970658874a6ee5794e4f147",
        ],
        [
          "B",
          ANSWERS_B,
          "golden-rx",
          "MEALS",
          "7a92fba8f16ae6dfe57f428d442cf758ca751a95c45f8f8e4b5878171779795f",
        ],
        [
          "C",
          ANSWERS_C,
          "rx",
          "MEALS",
          "12e47e7b70b30e618e27739ec4aeda5080348bd14bc3dfaa095a059fa66ab359",
        ],
        [
          "A",
          ANSWERS_A,
          "initial-rx",
          "MACROS",
          "d5c96d81f44671a6ee8823d181d7be109a6a0e98bda934fdd6eafd379385a424",
        ],
        [
          "A",
          ANSWERS_A,
          "initial-rx",
          "MEALS",
          "754f1bf1c5247a7467b9adffde92c7f4dbbc84e369b106ea6b7300cf0b1b93a6",
        ],
        [
          "B",
          ANSWERS_B,
          "initial-rx",
          "MACROS",
          "f93b636ee9ce641a27f8e1239c577acb012a633103113e8d60fb8e8e7063faf7",
        ],
        [
          "B",
          ANSWERS_B,
          "initial-rx",
          "MEALS",
          "0066a778069493ee433ccd21fc929637e1914352a1b5583fb2e1139a1c3d6065",
        ],
        [
          "C",
          ANSWERS_C,
          "initial-rx",
          "MEALS",
          "754f1bf1c5247a7467b9adffde92c7f4dbbc84e369b106ea6b7300cf0b1b93a6",
        ],
      ] as const;

      for (const [, answers, prescriptionId, mode, expectedHash] of expectedHashes) {
        const { payload } = buildInitialFixturePlan(answers, prescriptionId, mode);
        expect(contentHash(payload)).toBe(expectedHash);
      }
    });
  });

  describe("10. Module purity (no numbers in module, strict AST checks)", () => {
    const ALLOWED_NUMERIC_LITERALS = new Set(["0", "1", "7"]);
    const ALLOWED_REASON_CODES = new Set([
      "TRAINING_INTAKE_VERSION_UNSUPPORTED",
      "TRAINING_INPUT_MISSING",
      "TRAINING_PARAMETER_MISSING",
      "TRAINING_PARAMETER_INCOMPATIBLE",
      "TRAINING_METHOD_UNSUPPORTED",
      "TRAINING_CATALOG_EMPTY_FOR_EQUIPMENT",
      "TRAINING_TEMPLATE_UNAVAILABLE",
      "TRAINING_EXERCISE_COUNT_INFEASIBLE",
      "TRAINING_CONTRAINDICATED_NO_SUBSTITUTE",
      "TRAINING_WORKLOAD_CAPPED",
      "TRAINING_STRENGTH_SESSIONS_REDUCED",
      "TRAINING_CARDIO_REDUCED",
      "TRAINING_CARDIO_NOT_ASSIGNED",
      "TRAINING_WORKLOAD_INFEASIBLE",
      "TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE",
    ]);

    const trainingFiles = fs
      .readdirSync(TRAINING_DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(TRAINING_DIR, f));

    it("contains exactly 4 files in lib/ai-coach/training/", () => {
      expect(trainingFiles.length).toBe(4);
    });

    it("contains NO numeric literals other than 0, 1, and 7", () => {
      const offenders: string[] = [];
      for (const file of trainingFiles) {
        const content = fs.readFileSync(file, "utf8");
        const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

        function visit(node: ts.Node) {
          if (ts.isNumericLiteral(node)) {
            if (!ALLOWED_NUMERIC_LITERALS.has(node.text)) {
              offenders.push(`${path.basename(file)}: numeric literal ${node.text}`);
            }
          }
          ts.forEachChild(node, visit);
        }
        ts.forEachChild(sf, visit);
      }
      expect(offenders).toEqual([]);
    });

    it("contains NO string literals > 30 chars outside reason codes, parameter IDs, and import paths", () => {
      const offenders: string[] = [];
      for (const file of trainingFiles) {
        const content = fs.readFileSync(file, "utf8");
        const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

        function visit(node: ts.Node) {
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            const text = node.text;
            if (text.length > 30) {
              const isImport =
                node.parent &&
                (ts.isImportDeclaration(node.parent) ||
                  ts.isExportDeclaration(node.parent) ||
                  ts.isExternalModuleReference(node.parent));
              const isReasonCode = ALLOWED_REASON_CODES.has(text);
              const isParamOrRuleId =
                text.startsWith("TRAINING.") ||
                text.startsWith("CARDIO.") ||
                text.startsWith("WORKLOAD.") ||
                text.startsWith("PROGRESSION.");

              if (!isImport && !isReasonCode && !isParamOrRuleId) {
                offenders.push(
                  `${path.basename(file)}: string literal > 30 chars: "${text}" (${text.length})`
                );
              }
            }
          }
          ts.forEachChild(node, visit);
        }
        ts.forEachChild(sf, visit);
      }
      expect(offenders).toEqual([]);
    });

    it("never constructs a Number from a string literal", () => {
      const offenders: string[] = [];
      for (const file of trainingFiles) {
        const content = fs.readFileSync(file, "utf8");
        if (/Number\s*\(\s*[`'"]/.test(content)) {
          offenders.push(`${path.basename(file)}: Number("...") constructor`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
