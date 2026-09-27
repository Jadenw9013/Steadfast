import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadDraftUnsignedEvidenceRegistry,
  draftEvidenceRegistryToArtifactDraftInput,
  PENDING_EVIDENCE_CLAIM_ID_PREFIX,
  UNREVIEWED_DRAFT_QUALIFICATION,
  UNREVIEWED_DRAFT_REVIEWER_NAME,
} from "@/lib/ai-coach/artifacts/drafts/evidence-registry";
import {
  loadDraftUnsignedEscalationTemplates,
  draftEscalationTemplatesToArtifactDraftInput,
  NO_GEOGRAPHY_CLEARED,
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
  resolveTrainingParameters,
} from "@/lib/ai-coach/training/parameters";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";

/**
 * S-V1-artifacts — the two artifact kinds a v1 launch requires and that existed
 * only as synthetic fixtures. These assertions are the mechanical half of
 * "engineering authors structure, the reviewer authors content": a number, a
 * promise of human review, an invented citation or a record that is not
 * `PROPOSED` fails here rather than relying on the next editor remembering.
 */

const FROZEN_UNSIGNED_NOTICE =
  "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.";

const evidenceFile = loadDraftUnsignedEvidenceRegistry();
const escalationFile = loadDraftUnsignedEscalationTemplates();
const bundleFile = loadDraftUnsignedPolicyBundle();
const claims = evidenceFile.content.claims;
const templates = escalationFile.content.templates;

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

describe("S-V1-artifacts — DRAFT_UNSIGNED escalation templates (client-facing copy)", () => {
  it("is DRAFT_UNSIGNED, non-synthetic, and carries the frozen unsigned notice", () => {
    expect(escalationFile.fileSchemaVersion).toBe(1);
    expect(escalationFile.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    expect(escalationFile.reviewMetadata.unsignedNotice).toBe(FROZEN_UNSIGNED_NOTICE);
    expect(escalationTemplatesContentSchema.parse(escalationFile.content).artifactKey).toBe(
      "escalation-templates-v1"
    );
  });

  it("marks every template PROPOSED and nothing else", () => {
    expect(escalationFile.reviewStates).toHaveLength(templates.length);
    for (const state of escalationFile.reviewStates) {
      expect({ itemId: state.itemId, reviewState: state.reviewState }).toMatchObject({
        itemId: state.itemId,
        reviewState: "PROPOSED",
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

  it("clears no geography and declares one locale, pending legal review", () => {
    for (const template of templates) {
      expect({ id: template.id, geographies: template.geographies }).toMatchObject({
        id: template.id,
        geographies: [NO_GEOGRAPHY_CLEARED],
      });
      expect(template.locale).toBe("en-US");
    }
  });
});

describe("S-V1-artifacts — escalation reason-code coverage", () => {
  const declared = new Set(templates.flatMap((template) => template.reasonCodes));
  const allowed = new Set(bundleFile.content.escalationTemplateIds);

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
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_PARAMETER_MISSING"],
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_THERAPEUTIC_DIET_OUT_OF_SCOPE"],
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_GOAL_PACE_UNDECIDED"],
    ];
    for (const codes of composites) {
      expect({ codes, covered: Boolean(templateCovering(codes)) }).toMatchObject({
        codes,
        covered: true,
      });
    }
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
    ]);
    for (const code of declared) {
      expect({ code, emittable: emittable.has(code) }).toMatchObject({ code, emittable: true });
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
      { templateId: screening.escalationTemplateId, codes: [screening.flaggedReasonCode, screening.unknownReasonCode] },
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

describe("S-V1-artifacts — omitted clinical values fail closed", () => {
  it("supplies no training effort copy, so the training composer refuses instead of inventing a dose", () => {
    const effortIds = [EFFORT_STRENGTH_TEMPLATE_ID, EFFORT_CARDIO_TEMPLATE_ID];
    for (const id of effortIds) {
      expect({ id, declared: templates.some((template) => template.id === id) }).toMatchObject({
        id,
        declared: false,
      });
    }

    // The bundle still declares the ids, so the resolver's own lookup is what
    // fails — exactly the T-2039 shape (absent value, named refusal).
    const explanationTexts = bundleFile.content.explanationTemplateIds
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is (typeof templates)[number] => Boolean(template))
      .map((template) => ({ id: template.id, text: template.nextStepText }));
    expect(explanationTexts).toEqual([]);

    const resolution = resolveTrainingParameters(bundleFile.content, explanationTexts);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reasonCodes).toContain("TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE");
  });
});

describe("S-V1-artifacts — DRAFT_UNSIGNED evidence registry", () => {
  const bundleContent = bundleFile.content;

  /** Re-derived from the bundle here, independently of whatever wrote the file. */
  const expectedByClaim = new Map<string, { ruleIds: Set<string>; sourceUrls: Set<string> }>();
  for (const parameter of bundleContent.numericParameters) {
    for (const claimId of parameter.evidenceClaimIds) {
      const entry = expectedByClaim.get(claimId) ?? { ruleIds: new Set(), sourceUrls: new Set() };
      for (const ruleId of parameter.applicabilityRuleIds) entry.ruleIds.add(ruleId);
      expectedByClaim.set(claimId, entry);
    }
  }
  for (const row of bundleFile.reviewMetadata.proposalProvenance) {
    expectedByClaim.get(row.sourceClaimId)?.sourceUrls.add(row.sourceUrl);
  }

  it("is DRAFT_UNSIGNED, non-synthetic, and carries the frozen unsigned notice", () => {
    expect(evidenceFile.fileSchemaVersion).toBe(1);
    expect(evidenceFile.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    expect(evidenceFile.reviewMetadata.unsignedNotice).toBe(FROZEN_UNSIGNED_NOTICE);
    expect(evidenceRegistryContentSchema.parse(evidenceFile.content).artifactKey).toBe(
      "evidence-registry-v1"
    );
  });

  it("marks every claim PROPOSED and nothing else", () => {
    expect(evidenceFile.reviewStates).toHaveLength(claims.length);
    for (const state of evidenceFile.reviewStates) {
      expect({ itemId: state.itemId, reviewState: state.reviewState }).toMatchObject({
        itemId: state.itemId,
        reviewState: "PROPOSED",
      });
    }
  });

  it("names no source the draft policy bundle does not already record", () => {
    // The guard that makes inventing a citation structurally impossible here.
    expect(expectedByClaim.size).toBeGreaterThan(0);
    for (const claim of claims) {
      const expected = expectedByClaim.get(claim.id);
      if (!expected) {
        // The only claims without a bundle parameter are the explicit
        // no-evidence placeholders, which must point at no real source.
        expect({ id: claim.id, pending: claim.id.startsWith(PENDING_EVIDENCE_CLAIM_ID_PREFIX) })
          .toMatchObject({ id: claim.id, pending: true });
        expect(new URL(claim.sourceUrl).hostname.endsWith("example.invalid")).toBe(true);
        continue;
      }
      expect({ id: claim.id, sourceUrl: claim.sourceUrl }).toMatchObject({
        id: claim.id,
        sourceUrl: [...expected.sourceUrls][0],
      });
      expect(expected.sourceUrls.size).toBe(1);
    }
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
      expect({ ruleId, covering: covering.length }).toMatchObject({
        ruleId,
        covering: covering.length,
      });
      expect(covering.length).toBeGreaterThan(0);
    }
  });

  it("covers every claim the policy bundle's numeric parameters reference", () => {
    const claimIds = new Set(claims.map((claim) => claim.id));
    for (const claimId of expectedByClaim.keys()) {
      expect({ claimId, present: claimIds.has(claimId) }).toMatchObject({ claimId, present: true });
    }
  });

  it("asserts no reviewer and no qualification, because nobody has reviewed it", () => {
    for (const claim of claims) {
      expect({ id: claim.id, reviewer: claim.reviewer }).toMatchObject({
        id: claim.id,
        reviewer: {
          name: UNREVIEWED_DRAFT_REVIEWER_NAME,
          qualifications: [UNREVIEWED_DRAFT_QUALIFICATION],
        },
      });
      // `reviewDate` is the draft preparation date, not a review date: nothing
      // has been reviewed. Pinning it stops per-claim dates looking like reviews.
      expect(claim.reviewDate).toBe(evidenceFile.reviewMetadata.preparedAt);
    }
  });

  it("states no number in any claim, and allows digits only inside a recorded source locator", () => {
    const LOCATOR_PREFIX = "Locator recorded by the draft policy bundle: ";
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
        expect({ id: claim.id, limitation, prefixed: limitation.startsWith(LOCATOR_PREFIX) })
          .toMatchObject({ id: claim.id, limitation, prefixed: true });
      }
    }
  });

  it("says in every claim that Steadfast has not verified it", () => {
    for (const claim of claims) {
      const unsigned = claim.limitations.some((limitation) =>
        limitation.startsWith("PROPOSED AND UNSIGNED:")
      );
      expect({ id: claim.id, unsigned }).toMatchObject({ id: claim.id, unsigned: true });
      expect(
        claim.claim.startsWith("PROPOSED AND UNVERIFIED.") ||
          claim.claim.startsWith("NO EVIDENCE HAS BEEN SUPPLIED")
      ).toBe(true);
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

  it("refuses to convert either draft to a registrable artifact without signed review metadata", () => {
    const set = buildSyntheticArtifactSet();
    // A non-synthetic artifact additionally needs APPROVED jurisdiction review;
    // the synthetic fixture's metadata is SYNTHETIC_TEST_ONLY.
    const signed = {
      ...set.policyBundle.reviewMetadata,
      jurisdictionReview: {
        ...set.policyBundle.reviewMetadata.jurisdictionReview,
        legalReviewStatus: "APPROVED" as const,
      },
    };
    expect(() =>
      draftEvidenceRegistryToArtifactDraftInput(
        evidenceFile,
        evidenceFile.reviewMetadata as never,
        []
      )
    ).toThrow("qualified professional reviewer");
    expect(() =>
      draftEscalationTemplatesToArtifactDraftInput(
        escalationFile,
        escalationFile.reviewMetadata as never,
        []
      )
    ).toThrow("qualified professional reviewer");

    // With signed metadata both produce a valid, non-synthetic leaf artifact.
    const evidenceInput = draftEvidenceRegistryToArtifactDraftInput(evidenceFile, signed, []);
    const escalationInput = draftEscalationTemplatesToArtifactDraftInput(
      escalationFile,
      signed,
      []
    );
    expect(parseArtifactDraftInput(evidenceInput).kind).toBe("EVIDENCE_REGISTRY");
    expect(parseArtifactDraftInput(escalationInput).kind).toBe("ESCALATION_TEMPLATES");
    expect(evidenceInput.synthetic).toBe(false);
    expect(escalationInput.synthetic).toBe(false);
  });

  it("registering either draft with its own DRAFT_UNSIGNED metadata is refused downstream too", () => {
    const draftInput = {
      id: "evidence-registry-v1:v1",
      artifactKey: "evidence-registry-v1",
      version: 1,
      kind: "EVIDENCE_REGISTRY" as const,
      schemaVersion: 1 as const,
      engineVersions: ["ai-coach-artifact-engine-v1"],
      dependencies: [],
      synthetic: true,
      reviewMetadata: evidenceFile.reviewMetadata,
      content: evidenceFile.content,
    };
    expect(() => parseArtifactDraftInput(draftInput)).toThrow(
      "Draft unsigned artifacts cannot be synthetic"
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
      ["evidence-registry.draft-unsigned.v1.json", "lib/ai-coach/artifacts/drafts/evidence-registry.ts"],
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
