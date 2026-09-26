import { z } from "zod";

/**
 * T-1005 — strict shapes for server-owned reviewed artifacts.
 *
 * These schemas describe governance and integrity only. They do not contain
 * approved clinical constants. Callers (including a model) cannot extend the
 * identifier or fact registries at runtime; only persisted, digest-verified
 * artifacts are resolved by the loader.
 */

export const artifactKindSchema = z.enum([
  "POLICY_BUNDLE",
  "FOOD_CATALOG",
  "EXERCISE_CATALOG",
  "EVIDENCE_REGISTRY",
  "ESCALATION_TEMPLATES",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const versionSchema = z.number().int().positive();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dateTimeSchema = z.string().datetime({ offset: true });

function reportDuplicateIds(
  ids: readonly string[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
  collectionName: string
) {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index, "id"],
        message: `${collectionName} IDs must be unique; duplicate: ${id}`,
      });
    }
    seen.add(id);
  });
}

function reportUnknownIds(
  ids: readonly string[],
  knownIds: ReadonlySet<string>,
  ctx: z.RefinementCtx,
  path: (string | number)[],
  referenceName: string
) {
  ids.forEach((id, index) => {
    if (!knownIds.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `${referenceName} references unknown authoritative ID: ${id}`,
      });
    }
  });
}

export const artifactReferenceSchema = z
  .object({
    id: identifierSchema,
    artifactKey: identifierSchema,
    version: versionSchema,
    kind: artifactKindSchema,
    digest: digestSchema,
  })
  .strict();
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;

export const publicFrameworkReferenceSchema = z
  .object({
    framework: z.enum(["ACE_PUBLIC_SCOPE", "NASM_PUBLIC_SCOPE"]),
    sourceUrl: z.string().url(),
    usage: z.literal("CANDIDATE_SCOPE_REFERENCE_ONLY"),
    proprietaryMaterialCopied: z.literal(false),
    endorsementOrAffiliationClaimed: z.literal(false),
  })
  .strict();

const REQUIRED_EXCLUSIONS = [
  "DIAGNOSIS",
  "TREATMENT_OR_REHABILITATION",
  "CLINICAL_NUTRITION_OR_MEDICAL_NUTRITION_THERAPY",
  "MEDICATION_OR_SUPPLEMENT_PRESCRIBING",
  "CLINICIAN_INSTRUCTION_OVERRIDE",
] as const;

export const signedArtifactReviewMetadataSchema = z
  .object({
    accountableOwner: z
      .object({
        name: z.string().min(1).max(160),
        role: z.string().min(1).max(160),
      })
      .strict(),
    reviewer: z
      .object({
        name: z.string().min(1).max(160),
        reviewerType: z.enum(["QUALIFIED_PROFESSIONAL", "QUALIFIED_CONTENT_REVIEWER"]),
        qualifications: z.array(z.string().min(1).max(240)).min(1).max(20),
      })
      .strict(),
    reviewedAt: dateTimeSchema,
    reviewRecordId: identifierSchema,
    decision: z.literal("APPROVED"),
    signoffScope: z.array(z.string().min(1).max(240)).min(1).max(50),
    allowedScope: z
      .array(z.enum(["GENERAL_FITNESS_PROGRAMMING", "GENERAL_BEHAVIOR_NUTRITION_EDUCATION"]))
      .min(1),
    explicitExclusions: z.array(z.enum(REQUIRED_EXCLUSIONS)).min(REQUIRED_EXCLUSIONS.length),
    jurisdictionReview: z
      .object({
        jurisdictions: z.array(z.string().min(1).max(120)).min(1).max(30),
        legalReviewStatus: z.enum(["APPROVED", "SYNTHETIC_TEST_ONLY"]),
        recordId: identifierSchema,
        reviewedAt: dateTimeSchema,
      })
      .strict(),
    publicFrameworkReferences: z.array(publicFrameworkReferenceSchema).max(10),
  })
  .strict()
  .superRefine((review, ctx) => {
    for (const exclusion of REQUIRED_EXCLUSIONS) {
      if (!review.explicitExclusions.includes(exclusion)) {
        ctx.addIssue({
          code: "custom",
          path: ["explicitExclusions"],
          message: `Missing required exclusion: ${exclusion}`,
        });
      }
    }
    if (new Set(review.explicitExclusions).size !== review.explicitExclusions.length) {
      ctx.addIssue({
        code: "custom",
        path: ["explicitExclusions"],
        message: "Exclusions must be unique.",
      });
    }
  });

export const draftUnsignedReviewMetadataSchema = z
  .object({
    decision: z.literal("DRAFT_UNSIGNED"),
    preparedBy: z.literal("ENGINEERING_DRAFT_FROM_REVIEWED_SOURCE"),
    preparedAt: dateTimeSchema,
    draftRecordId: identifierSchema,
    worksheetSectionIds: z.array(identifierSchema).min(1).max(50),
    proposalProvenance: z
      .array(
        z
          .object({
            parameterId: identifierSchema,
            sourceClaimId: identifierSchema,
            sourceId: identifierSchema,
            sourceUrl: z.string().url(),
            sourceLocator: z.string().min(1).max(240),
          })
          .strict()
      )
      .min(1)
      .max(1000),
    unsignedNotice: z.literal(
      "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE."
    ),
  })
  .strict();

export const artifactReviewMetadataSchema = z.discriminatedUnion("decision", [
  signedArtifactReviewMetadataSchema,
  draftUnsignedReviewMetadataSchema,
]);

export type SignedArtifactReviewMetadata = z.infer<typeof signedArtifactReviewMetadataSchema>;
export type DraftUnsignedReviewMetadata = z.infer<typeof draftUnsignedReviewMetadataSchema>;
export type ArtifactReviewMetadata = z.infer<typeof artifactReviewMetadataSchema>;

export function isDraftUnsignedReviewMetadata(
  value: unknown
): value is DraftUnsignedReviewMetadata {
  return draftUnsignedReviewMetadataSchema.safeParse(value).success;
}

const reviewedSourceSchema = z
  .object({
    sourceId: identifierSchema,
    sourceVersion: z.string().min(1).max(120),
    sourceUrl: z.string().url(),
    reviewedAt: dateTimeSchema,
    licenseClassification: z.string().min(1).max(160),
    authority: z.literal("REVIEWED_SOURCE"),
  })
  .strict();

const contentIdentity = {
  artifactKey: identifierSchema,
  version: versionSchema,
};

const SAFETY_GATE_INPUT_IDS = [
  "AGE_ELIGIBILITY",
  "PREGNANCY_POSTPARTUM",
  "EATING_DISORDER_HISTORY_OR_CONCERN",
  "TYPE_1_DIABETES",
  "CARDIAC_CONDITION",
] as const;

const safetyGateInputIdSchema = z.enum(SAFETY_GATE_INPUT_IDS);

const safetyControlsSchema = z
  .object({
    schemaVersion: z.literal(1),
    screening: z
      .object({
        instrumentId: identifierSchema,
        resultInputId: identifierSchema,
        ruleId: identifierSchema,
        flaggedReasonCode: identifierSchema,
        unknownReasonCode: identifierSchema,
        escalationTemplateId: identifierSchema,
      })
      .strict(),
    contraindications: z
      .array(
        z
          .object({
            inputId: safetyGateInputIdSchema,
            ruleId: identifierSchema,
            reasonCode: identifierSchema,
            escalationTemplateId: identifierSchema,
          })
          .strict()
      )
      .length(SAFETY_GATE_INPUT_IDS.length),
    nutritionLimits: z
      .object({
        minimumDailyEnergyParameterId: identifierSchema,
        maximumWeeklyLossRateParameterId: identifierSchema,
        minimumDailyEnergyRuleId: identifierSchema,
        maximumWeeklyLossRateRuleId: identifierSchema,
        noConsecutiveDeficitRuleId: identifierSchema,
        minimumDailyEnergyReasonCode: identifierSchema,
        maximumWeeklyLossRateReasonCode: identifierSchema,
        noConsecutiveDeficitReasonCode: identifierSchema,
        missingRateInputReasonCode: identifierSchema,
        unverifiableHistoryReasonCode: identifierSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((controls, ctx) => {
    const inputIds = controls.contraindications.map((rule) => rule.inputId);
    reportDuplicateIds(inputIds, ctx, ["contraindications"], "Safety input");
    for (const inputId of SAFETY_GATE_INPUT_IDS) {
      if (!inputIds.includes(inputId)) {
        ctx.addIssue({
          code: "custom",
          path: ["contraindications"],
          message: `Missing required safety input: ${inputId}`,
        });
      }
    }
  });

export const policyBundleContentSchema = z
  .object({
    ...contentIdentity,
    supportedPopulation: z.string().min(1).max(500),
    supportedGoals: z.array(identifierSchema).min(1).max(50),
    requiredInputIds: z.array(identifierSchema).min(1).max(100),
    ruleIds: z.array(identifierSchema).min(1).max(500),
    calculationMethodIds: z.array(identifierSchema).min(1).max(100),
    adjustmentRuleIds: z.array(identifierSchema).min(1).max(100),
    cooldownRuleIds: z.array(identifierSchema).min(1).max(100),
    cumulativeLimitRuleIds: z.array(identifierSchema).min(1).max(100),
    contraindicationRuleIds: z.array(identifierSchema).min(1).max(100),
    evidenceRuleIds: z.array(identifierSchema).min(1).max(100),
    escalationTemplateIds: z.array(identifierSchema).min(1).max(100),
    explanationTemplateIds: z.array(identifierSchema).min(1).max(100),
    safetyControls: safetyControlsSchema,
    numericParameters: z
      .array(
        z
          .object({
            id: identifierSchema,
            value: z.number().finite(),
            unit: identifierSchema,
            applicabilityRuleIds: z.array(identifierSchema).min(1).max(100),
            evidenceClaimIds: z.array(identifierSchema).min(1).max(100),
          })
          .strict()
      )
      .min(1)
      .max(500),
    unknownAnswerBehavior: z.literal("FAIL_CLOSED"),
    outOfScopeOutcome: z.literal("PAUSE_REFER"),
  })
  .strict()
  .superRefine((policy, ctx) => {
    reportDuplicateIds(policy.ruleIds, ctx, ["ruleIds"], "Policy rule");
    reportDuplicateIds(
      policy.numericParameters.map((parameter) => parameter.id),
      ctx,
      ["numericParameters"],
      "Numeric parameter"
    );

    const knownRuleIds = new Set(policy.ruleIds);
    const knownParameterIds = new Set(policy.numericParameters.map((parameter) => parameter.id));
    const knownEscalationTemplateIds = new Set(policy.escalationTemplateIds);
    const requiredInputIds = new Set(policy.requiredInputIds);
    const ruleReferenceFields = [
      "adjustmentRuleIds",
      "cooldownRuleIds",
      "cumulativeLimitRuleIds",
      "contraindicationRuleIds",
      "evidenceRuleIds",
    ] as const;
    for (const field of ruleReferenceFields) {
      reportUnknownIds(policy[field], knownRuleIds, ctx, [field], `Policy ${field}`);
    }
    policy.numericParameters.forEach((parameter, index) => {
      reportUnknownIds(
        parameter.applicabilityRuleIds,
        knownRuleIds,
        ctx,
        ["numericParameters", index, "applicabilityRuleIds"],
        "Numeric parameter rule"
      );
    });

    const safetyRuleReferences = [
      policy.safetyControls.screening.ruleId,
      ...policy.safetyControls.contraindications.map((rule) => rule.ruleId),
      policy.safetyControls.nutritionLimits.minimumDailyEnergyRuleId,
      policy.safetyControls.nutritionLimits.maximumWeeklyLossRateRuleId,
      policy.safetyControls.nutritionLimits.noConsecutiveDeficitRuleId,
    ];
    reportUnknownIds(
      safetyRuleReferences,
      knownRuleIds,
      ctx,
      ["safetyControls"],
      "Safety control rule"
    );
    const safetyNumericParameters = [
      policy.safetyControls.nutritionLimits.minimumDailyEnergyParameterId,
      policy.safetyControls.nutritionLimits.maximumWeeklyLossRateParameterId,
    ].filter((id) => !id.startsWith("PENDING_RD_DECISION"));
    reportUnknownIds(
      safetyNumericParameters,
      knownParameterIds,
      ctx,
      ["safetyControls", "nutritionLimits"],
      "Safety control numeric parameter"
    );
    reportUnknownIds(
      [
        policy.safetyControls.screening.escalationTemplateId,
        ...policy.safetyControls.contraindications.map((rule) => rule.escalationTemplateId),
      ],
      knownEscalationTemplateIds,
      ctx,
      ["safetyControls"],
      "Safety control escalation template"
    );
    for (const [index, inputId] of [
      policy.safetyControls.screening.resultInputId,
      ...policy.safetyControls.contraindications.map((rule) => rule.inputId),
    ].entries()) {
      if (!requiredInputIds.has(inputId)) {
        ctx.addIssue({
          code: "custom",
          path: ["safetyControls", index],
          message: `Safety control input is not declared as required: ${inputId}`,
        });
      }
    }
  });

export type PolicyBundleContent = z.infer<typeof policyBundleContentSchema>;

export const allergenCategorySchema = z.enum([
  "MILK",
  "EGG",
  "FISH",
  "CRUSTACEAN_SHELLFISH",
  "TREE_NUT",
  "PEANUT",
  "WHEAT",
  "SOYBEAN",
  "SESAME",
]);
export type AllergenCategory = z.infer<typeof allergenCategorySchema>;

/**
 * The FoodData Central nutrient numbers that can back each SOURCED_V2 macro.
 * Exported so `lib/ai-coach/catalog/fdc/mapping.ts` reads the same list the
 * schema enforces — one vocabulary, not two that can drift (review r2 MB-1).
 *
 * These are FDC nutrient **numbers** (`nutrient.number`), not nutrient ids.
 * The two differ and the distinction is the whole point: "Energy (Atwater
 * Specific Factors)" has id `2048` but number `"958"`, "Energy (Atwater General
 * Factors)" has id `2047` but number `"957"`, and "Total fat (NLEA)" has id
 * `1085` but number `"298"`. `findNutrient` matches on `nutrientNumber`, so a
 * list written with ids silently matches nothing — which is exactly how the
 * 2026-09-26 run refused 48 records that carried every macro it needed.
 * Verified live against `/food/2258588` and `/food/748608`.
 *
 * `208` / `203` / `204` / `205` are the classic SR Legacy numbers.
 */
export const SOURCED_V2_ENERGY_NUTRIENT_IDS = ["208", "958", "957"] as const;
export const SOURCED_V2_PROTEIN_NUTRIENT_IDS = ["203"] as const;
export const SOURCED_V2_FAT_NUTRIENT_IDS = ["204", "298"] as const;
export const SOURCED_V2_CARBOHYDRATE_NUTRIENT_IDS = ["205"] as const;

export const sourcedFoodCatalogItemSchema = z
  .object({
    id: identifierSchema,
    version: versionSchema,
    name: z.string().min(1).max(240),
    source: reviewedSourceSchema,
    foodState: z.enum(["RAW", "COOKED", "PREPARED", "NOT_APPLICABLE"]),
    servingGrams: z.number().positive().finite(),
    nutrients: z
      .object({
        energyKcal: z.number().nonnegative().finite(),
        proteinGrams: z.number().nonnegative().finite(),
        carbohydrateGrams: z.number().nonnegative().finite(),
        fatGrams: z.number().nonnegative().finite(),
        missingNutrientIds: z.array(identifierSchema).max(200),
      })
      .strict(),
    /**
     * Legacy allergen surface. It has exactly two states — a category is in
     * `contains` or it is not — and `verificationStatus` is pinned to the
     * literal `"REVIEWED_SOURCE"`, so it cannot express `UNKNOWN`. A SOURCED_V2
     * item's real allergen status is mostly `UNKNOWN` (1643 of 1773 facts in
     * the first real run), and projecting that into this struct turns every one
     * of them into "reviewed against the source, and it does not contain this"
     * — a bag of almonds shipping as reviewed and containing nothing. It fails
     * **open**, which is the same false-assertion failure as the fabricated
     * data pointed at a different field (review r2 MB-4).
     *
     * It is therefore optional, and *forbidden* under SOURCED_V2 (see the
     * refinement below). Pre-SOURCED_V2 catalogs that genuinely carry a
     * reviewed exclusion list still use it.
     */
    allergenFacts: z
      .object({
        contains: z.array(identifierSchema).max(50),
        evidenceSourceId: identifierSchema,
        verificationStatus: z.literal("REVIEWED_SOURCE"),
        crossContactRequiresCurrentVerification: z.boolean(),
      })
      .strict()
      .optional(),
    synonyms: z.array(z.string().min(1).max(120)).max(10).optional(),
    sourceRecord: z
      .object({
        system: z.literal("USDA_FDC"),
        recordId: z.string().min(1).max(40),
        dataType: z.enum(["FOUNDATION", "SR_LEGACY"]),
        publicationDate: z.string().min(4).max(40),
        sourceReleaseLabel: z.string().min(1).max(120),
        retrievedAt: z.string().datetime({ offset: true }),
        recordUrl: z.string().url(),
        license: z.literal("CC0_PUBLIC_DOMAIN"),
        attributionText: z.string().min(1).max(400),
      })
      .strict()
      .optional(),
    amountBasis: z
      .object({
        basisGrams: z.literal(100),
        ediblePortionFactor: z.number().positive().max(1).nullable(),
        ediblePortionProvenance: z.enum(["SOURCE_REPORTED", "UNKNOWN"]),
        householdMeasures: z
          .array(
            z
              .object({
                text: z.string().min(1).max(160),
                gramWeight: z.number().positive(),
                provenance: z.literal("SOURCE_PORTION"),
              })
              .strict()
          )
          .max(20),
        yieldMethod: z.enum(["NONE_APPLIED", "UNKNOWN"]),
      })
      .strict()
      .optional(),
    nutrientFacts: z
      .array(
        z
          .object({
            nutrientId: z.string().min(1).max(60),
            nutrientName: z.string().min(1).max(160),
            unit: z.enum(["G", "MG", "UG", "KCAL", "KJ", "IU"]),
            value: z.number().finite().nonnegative().nullable(),
            status: z.enum(["REPORTED", "UNKNOWN"]),
            derivation: z.enum(["ANALYTICAL", "CALCULATED", "MANUFACTURER_LABEL", "UNKNOWN"]),
            derivationDetail: z.string().max(240).nullable(),
          })
          .strict()
      )
      .max(300)
      .optional(),
    energyFact: z
      .object({
        kcal: z.number().finite().nonnegative().nullable(),
        method: z.enum(["ATWATER_GENERAL", "ATWATER_SPECIFIC", "SOURCE_REPORTED_UNSPECIFIED", "UNKNOWN"]),
        methodDetail: z.string().max(240).nullable(),
        macroEnergyDiscrepancyKcal: z.number().finite().nullable(),
      })
      .strict()
      .optional(),
    allergenFactsV2: z
      .object({
        categories: z
          .array(
            z
              .object({
                category: allergenCategorySchema,
                presence: z.enum(["PRESENT", "VERIFIED_ABSENT", "UNKNOWN"]),
                crossContact: z.enum(["PRESENT", "VERIFIED_ABSENT", "UNKNOWN"]),
                basis: z.enum(["SOURCE_RECORD_IDENTITY", "REVIEWER_ATTESTED", "NONE"]),
                ruleId: z.string().min(1).max(80),
                verifiedAt: z.string().datetime({ offset: true }).nullable(),
              })
              .strict()
          )
          .length(9),
        ingredientStatementAvailable: z.boolean(),
        speciesOrTypeDetail: z.string().max(160).nullable(),
      })
      .strict()
      .optional(),
    patternTags: z
      .array(z.enum(["OMNIVORE", "LACTO_OVO_VEGETARIAN", "VEGAN", "PESCATARIAN"]))
      .optional(),
    reviewState: z.enum(["PROPOSED", "ACCEPTED"]).optional(),
    supersedesItemId: z.string().max(160).nullable().optional(),
  })
  .strict();

export type SourcedFoodCatalogItem = z.infer<typeof sourcedFoodCatalogItemSchema>;

export const foodCatalogContentSchema = z
  .object({
    ...contentIdentity,
    catalogProfile: z.enum(["SOURCED_V2"]).optional(),
    market: z.literal("US").optional(),
    items: z.array(sourcedFoodCatalogItemSchema).min(1).max(10_000),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    reportDuplicateIds(
      catalog.items.map((item) => item.id),
      ctx,
      ["items"],
      "Food"
    );

    if (catalog.catalogProfile === "SOURCED_V2") {
      if (catalog.market !== "US") {
        ctx.addIssue({
          code: "custom",
          path: ["market"],
          message: "Market must be US under SOURCED_V2 profile",
        });
      }

      for (let i = 0; i < catalog.items.length; i++) {
        const item = catalog.items[i];
        const itemPath = ["items", i];

        const requiredDossierFields: (keyof typeof item)[] = [
          "synonyms",
          "sourceRecord",
          "amountBasis",
          "nutrientFacts",
          "energyFact",
          "allergenFactsV2",
          "patternTags",
        ];

        for (const field of requiredDossierFields) {
          if (item[field] === undefined) {
            ctx.addIssue({
              code: "custom",
              path: [...itemPath, field],
              message: `Field ${String(field)} is required under SOURCED_V2 profile`,
            });
          }
        }

        // The lossy legacy surface may not coexist with allergenFactsV2. A
        // consumer that has not been updated reads `allergenFacts.contains`
        // and, finding it empty, concludes the food is free of every allergen;
        // the tri-state says UNKNOWN for most of them. Two sources of truth
        // where the lossy one fails open. Absent, that consumer gets a
        // TypeError it must handle, not a false negative it cannot see.
        if (item.allergenFacts !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: [...itemPath, "allergenFacts"],
            message:
              "Field allergenFacts is forbidden under SOURCED_V2 profile: it cannot express UNKNOWN, so it would assert REVIEWED_SOURCE absence for categories whose real status is UNKNOWN. Read allergenFactsV2.",
          });
        }

        if (item.nutrientFacts) {
          /**
           * A macro is backed when *some* nutrient fact carrying one of the
           * accepted ids reports it, and the summary value equals one of those
           * reported values.
           *
           * The id sets are wider than the legacy four because modern USDA
           * Foundation records are (review r2 MB-1): they report energy under
           * the Atwater ids `2047`/`2048` rather than `1008`, and fat under
           * `1085` "Total fat (NLEA)" rather than `1004` "Total lipid (fat)".
           * Matching on a single id per macro is what made the tool refuse 48
           * records — plain chicken breast, cod, olive oil, bell peppers — that
           * carry every macronutrient. "One of the reported values" rather than
           * "the first match" because a record can carry both Atwater energies
           * and the mapper picks one deterministically.
           */
          const requireBackedMacro = (
            label: string,
            field: "proteinGrams" | "fatGrams" | "carbohydrateGrams" | "energyKcal",
            nutrientIds: readonly string[],
            unit: "G" | "KCAL"
          ) => {
            const reported = item.nutrientFacts!.filter(
              (n) =>
                nutrientIds.includes(n.nutrientId) &&
                n.unit === unit &&
                n.status === "REPORTED" &&
                n.value !== null
            );
            if (reported.length === 0) {
              ctx.addIssue({
                code: "custom",
                path: [...itemPath, "nutrients", field],
                message: `${label} must be REPORTED in nutrientFacts under SOURCED_V2`,
              });
              return;
            }
            const summaryValue = item.nutrients[field];
            if (!reported.some((n) => n.value === summaryValue)) {
              ctx.addIssue({
                code: "custom",
                path: [...itemPath, "nutrients", field],
                message: `${label} ${summaryValue} must match a reported nutrientFacts value (${reported
                  .map((n) => n.value)
                  .join(", ")})`,
              });
            }
          };

          requireBackedMacro("Protein", "proteinGrams", SOURCED_V2_PROTEIN_NUTRIENT_IDS, "G");
          requireBackedMacro("Fat", "fatGrams", SOURCED_V2_FAT_NUTRIENT_IDS, "G");
          requireBackedMacro(
            "Carbohydrate",
            "carbohydrateGrams",
            SOURCED_V2_CARBOHYDRATE_NUTRIENT_IDS,
            "G"
          );
          requireBackedMacro("Energy", "energyKcal", SOURCED_V2_ENERGY_NUTRIENT_IDS, "KCAL");
        }
      }
    }
  });

export const exerciseCatalogContentSchema = z
  .object({
    ...contentIdentity,
    exercises: z
      .array(
        z
          .object({
            id: identifierSchema,
            version: versionSchema,
            name: z.string().min(1).max(240),
            modality: z.enum(["STRENGTH", "CARDIO"]),
            source: reviewedSourceSchema,
            equipmentIds: z.array(identifierSchema).min(1).max(50),
            substitutionIds: z.array(identifierSchema).max(100),
            contraindicationRuleIds: z.array(identifierSchema).max(100),
            beginnerConstraintIds: z.array(identifierSchema).min(1).max(100),
            // T-2038 (contract frozen in T-2005): additive movement description.
            // Every field is `.optional()` with NO `.default()` — `artifactContentDigest`
            // hashes the parsed object and `canonicalJson` throws on `undefined` rather
            // than skipping it, so a default would change the digest of every artifact
            // already registered against this schema. Do not add a `.default()` here, and
            // do not add any image/video/GIF/animation field: v1 carries no licensed media.
            movementPattern: z
              .enum([
                "SQUAT",
                "HINGE",
                "HORIZONTAL_PUSH",
                "VERTICAL_PUSH",
                "HORIZONTAL_PULL",
                "VERTICAL_PULL",
                "LUNGE",
                "CARRY",
                "ROTATION",
                "ANTI_ROTATION",
                "ANTI_EXTENSION",
                "GAIT",
                "CYCLIC_CARDIO",
              ])
              .optional(),
            primaryMuscleIds: z.array(identifierSchema).min(1).max(12).optional(),
            laterality: z.enum(["BILATERAL", "UNILATERAL"]).optional(),
            loadKind: z.enum(["EXTERNAL", "BODYWEIGHT", "ASSISTED"]).optional(),
            /** Ordered steps describing how to perform the movement. Never a dose. */
            instructions: z.array(z.string().min(1).max(600)).min(1).max(12).optional(),
            cues: z.array(z.string().min(1).max(240)).max(8).optional(),
            equipmentAlternatives: z
              .array(
                z
                  .object({
                    equipmentId: identifierSchema,
                    exerciseId: identifierSchema,
                  })
                  .strict()
              )
              .max(50)
              .optional(),
          })
          .strict()
      )
      .min(1)
      .max(10_000),
    templates: z
      .array(
        z
          .object({
            id: identifierSchema,
            version: versionSchema,
            exerciseIds: z.array(identifierSchema).min(1).max(100),
            beginnerConstraintIds: z.array(identifierSchema).min(1).max(100),
            source: reviewedSourceSchema,
            // T-2038: additive, optional, no `.default()` — see the note on exercises[].
            name: z.string().min(1).max(240).optional(),
            templateKind: z.enum(["FULL_BODY", "UPPER", "LOWER", "CARDIO"]).optional(),
            /** Stable order within a split. Exercise order inside a template is
             *  `exerciseIds` array order and the composer never re-sorts it. */
            sequence: z.number().int().min(1).max(20).optional(),
          })
          .strict()
      )
      .min(1)
      .max(1_000),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    reportDuplicateIds(
      catalog.exercises.map((exercise) => exercise.id),
      ctx,
      ["exercises"],
      "Exercise"
    );
    reportDuplicateIds(
      catalog.templates.map((template) => template.id),
      ctx,
      ["templates"],
      "Exercise template"
    );

    const exerciseIds = new Set(catalog.exercises.map((exercise) => exercise.id));
    catalog.exercises.forEach((exercise, index) => {
      reportUnknownIds(
        exercise.substitutionIds,
        exerciseIds,
        ctx,
        ["exercises", index, "substitutionIds"],
        "Exercise substitution"
      );
      // T-2038: cross-check only when the optional field is present, so no artifact
      // already registered without it gains a new failure mode.
      if (exercise.equipmentAlternatives) {
        reportUnknownIds(
          exercise.equipmentAlternatives.map((alternative) => alternative.exerciseId),
          exerciseIds,
          ctx,
          ["exercises", index, "equipmentAlternatives"],
          "Exercise equipment alternative"
        );
      }
    });
    catalog.templates.forEach((template, index) => {
      reportUnknownIds(
        template.exerciseIds,
        exerciseIds,
        ctx,
        ["templates", index, "exerciseIds"],
        "Exercise template"
      );
    });
  });

export const evidenceRegistryContentSchema = z
  .object({
    ...contentIdentity,
    claims: z
      .array(
        z
          .object({
            id: identifierSchema,
            version: versionSchema,
            claim: z.string().min(1).max(2_000),
            sourceUrl: z.string().url(),
            population: z.string().min(1).max(1_000),
            limitations: z.array(z.string().min(1).max(1_000)).min(1).max(50),
            reviewer: z
              .object({
                name: z.string().min(1).max(160),
                qualifications: z.array(z.string().min(1).max(240)).min(1).max(20),
              })
              .strict(),
            ruleIds: z.array(identifierSchema).min(1).max(100),
            reviewDate: dateTimeSchema,
          })
          .strict()
      )
      .min(1)
      .max(5_000),
  })
  .strict()
  .superRefine((registry, ctx) => {
    reportDuplicateIds(
      registry.claims.map((claim) => claim.id),
      ctx,
      ["claims"],
      "Evidence claim"
    );
  });

export const escalationTemplatesContentSchema = z
  .object({
    ...contentIdentity,
    templates: z
      .array(
        z
          .object({
            id: identifierSchema,
            version: versionSchema,
            reasonCodes: z.array(identifierSchema).min(1).max(100),
            locale: z.string().min(2).max(35),
            geographies: z.array(z.string().min(1).max(120)).min(1).max(100),
            pausedDomains: z.array(z.enum(["NUTRITION", "STRENGTH", "CARDIO"])).min(1),
            nextStepText: z.string().min(1).max(2_000),
            nonMonitoringStatement: z.string().min(1).max(1_000),
          })
          .strict()
      )
      .min(1)
      .max(1_000),
  })
  .strict()
  .superRefine((registry, ctx) => {
    reportDuplicateIds(
      registry.templates.map((template) => template.id),
      ctx,
      ["templates"],
      "Escalation template"
    );
  });

const contentSchemas = {
  POLICY_BUNDLE: policyBundleContentSchema,
  FOOD_CATALOG: foodCatalogContentSchema,
  EXERCISE_CATALOG: exerciseCatalogContentSchema,
  EVIDENCE_REGISTRY: evidenceRegistryContentSchema,
  ESCALATION_TEMPLATES: escalationTemplatesContentSchema,
} as const;

export type ArtifactContent =
  | z.infer<typeof policyBundleContentSchema>
  | z.infer<typeof foodCatalogContentSchema>
  | z.infer<typeof exerciseCatalogContentSchema>
  | z.infer<typeof evidenceRegistryContentSchema>
  | z.infer<typeof escalationTemplatesContentSchema>;

const artifactDraftBaseSchema = z
  .object({
    id: identifierSchema,
    artifactKey: identifierSchema,
    version: versionSchema,
    kind: artifactKindSchema,
    schemaVersion: z.literal(1),
    engineVersions: z.array(identifierSchema).min(1).max(20),
    dependencies: z.array(artifactReferenceSchema).max(20),
    synthetic: z.boolean(),
    reviewMetadata: artifactReviewMetadataSchema,
    content: z.unknown(),
  })
  .strict();

export type ArtifactDraftInput<TReview = SignedArtifactReviewMetadata> = Omit<
  z.infer<typeof artifactDraftBaseSchema>,
  "content" | "reviewMetadata"
> & {
  content: ArtifactContent;
  reviewMetadata: TReview;
};

const REQUIRED_POLICY_DEPENDENCIES: ArtifactKind[] = [
  "FOOD_CATALOG",
  "EXERCISE_CATALOG",
  "EVIDENCE_REGISTRY",
  "ESCALATION_TEMPLATES",
];

export function parseArtifactDraftInput(raw: unknown): ArtifactDraftInput<ArtifactReviewMetadata> {
  const base = artifactDraftBaseSchema.parse(raw);
  const content = contentSchemas[base.kind].parse(base.content) as ArtifactContent;
  if (content.artifactKey !== base.artifactKey || content.version !== base.version) {
    throw new Error("Artifact content identity must match its immutable registry identity.");
  }
  const dependencyKinds = base.dependencies.map((dependency) => dependency.kind);
  if (new Set(dependencyKinds).size !== dependencyKinds.length) {
    throw new Error("Artifact dependency kinds must be unique.");
  }
  if (base.kind === "POLICY_BUNDLE") {
    if (
      dependencyKinds.length !== REQUIRED_POLICY_DEPENDENCIES.length ||
      REQUIRED_POLICY_DEPENDENCIES.some((kind) => !dependencyKinds.includes(kind))
    ) {
      throw new Error(
        "Policy bundles require one exact food, exercise, evidence and escalation dependency."
      );
    }
  } else if (base.dependencies.length !== 0) {
    throw new Error("Only policy bundles may declare artifact dependencies in schema version 1.");
  }
  if (isDraftUnsignedReviewMetadata(base.reviewMetadata)) {
    if (base.synthetic) {
      throw new Error("Draft unsigned artifacts cannot be synthetic.");
    }
  } else {
    if (
      base.synthetic &&
      base.reviewMetadata.jurisdictionReview.legalReviewStatus !== "SYNTHETIC_TEST_ONLY"
    ) {
      throw new Error("Synthetic artifacts must carry synthetic-only jurisdiction review status.");
    }
    if (
      !base.synthetic &&
      base.reviewMetadata.jurisdictionReview.legalReviewStatus !== "APPROVED"
    ) {
      throw new Error("Non-synthetic artifacts require approved jurisdiction/legal review.");
    }
  }
  return { ...base, content };
}

export function parseArtifactContent(kind: ArtifactKind, raw: unknown): ArtifactContent {
  return contentSchemas[kind].parse(raw) as ArtifactContent;
}
