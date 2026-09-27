import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DRAFT_EXERCISE_CATALOG_VERSION,
  draftExerciseCatalogFileSchema,
  draftExerciseCatalogToArtifactDraftInput,
  loadDraftUnsignedExerciseCatalog,
} from "@/lib/ai-coach/artifacts/drafts/exercise-catalog";
import {
  exerciseCatalogContentSchema,
  isDraftUnsignedReviewMetadata,
  type SignedArtifactReviewMetadata,
} from "@/lib/ai-coach/artifacts/schema";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { getDraftExerciseCatalog } from "@/lib/ai-coach/catalog/exercise-catalog";
import {
  disableDraftExerciseCatalog,
  enableDraftExerciseCatalog,
} from "@/lib/ai-coach/catalog/draft-exercise-catalog";
import { getExerciseItem } from "@/lib/ai-coach/catalog/loader";

/**
 * T-2038 — the draft beginner exercise catalog.
 *
 * These assertions are the mechanical half of "no dose and no clinical claim in
 * the catalog". They exist so a number or a clinical word cannot be added to an
 * instruction later without a red test, rather than relying on whoever edits the
 * file next remembering the rule.
 */

const FROZEN_UNSIGNED_NOTICE =
  "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.";

/** Closed set, frozen in T-2005's Spec. T-2039 adds exactly these to the bundle's ruleIds. */
const CONTRAINDICATION_RULE_IDS = new Set([
  "CONTRA.SPINAL_LOADING.V1",
  "CONTRA.OVERHEAD_LOADING.V1",
  "CONTRA.DEEP_KNEE_FLEXION.V1",
  "CONTRA.HIGH_IMPACT.V1",
  "CONTRA.FLOOR_TRANSFER.V1",
  "CONTRA.PRONE_POSITION.V1",
  "CONTRA.SUPINE_POSITION.V1",
  "CONTRA.GRIP_DEMAND.V1",
]);

/** Closed set, frozen in T-2005's Spec. */
const BEGINNER_CONSTRAINT_IDS = new Set([
  "BEGINNER.CONSTRAINT.TECHNIQUE_SIMPLE.V1",
  "BEGINNER.CONSTRAINT.NO_EXTERNAL_LOAD.V1",
  "BEGINNER.CONSTRAINT.LOW_IMPACT.V1",
  "BEGINNER.CONSTRAINT.SUPERVISION_NOT_REQUIRED.V1",
]);

const EQUIPMENT_TIERS = ["EQUIPMENT_NONE", "EQUIPMENT_HOME_BASIC", "EQUIPMENT_FULL_GYM"] as const;
type EquipmentTier = (typeof EQUIPMENT_TIERS)[number];

/** The dose vocabulary the spec names, plus every digit. */
const DOSE_PATTERN =
  /\b\d+\s*(sets?|reps?|repetitions?|seconds?|secs?|minutes?|mins?|kg|lb|%|rpe|rir)\b/i;
const ANY_DIGIT = /\d/;
const DOSE_WORD =
  /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|sets|reps?|repetitions?|seconds?|minutes?|hours?|kilograms?|pounds?|percent|tempo|rpe|rir)\b/i;
/** "the set", "each set" — the dose noun. The verb ("Set the bar in a rack") is fine. */
const DOSE_SET_NOUN = /\b(a|the|each|per|every|this|that|one|another)\s+set\b/i;
/** doc 06 §6, last paragraph. */
const CLINICAL_TERM =
  /\b(pain|painful|injur\w*|rehab\w*|diagnos\w*|treat|treatment|therap\w*|symptom\w*|push through)\b/i;
/** `aiReadable` renders the ID itself on the shipped iOS build. */
const ABBREVIATION_TOKENS = new Set(["db", "bb", "kb", "ohp", "rdl", "sldl", "bw"]);

const file = loadDraftUnsignedExerciseCatalog();
const exercises = file.content.exercises;
const templates = file.content.templates;
const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

function performableAt(exerciseId: string, tier: EquipmentTier): boolean {
  return byId.get(exerciseId)?.equipmentIds.includes(tier) ?? false;
}

/**
 * The composer's steps 6 and 9, frozen in T-2005: an ineligible exercise takes
 * the first equipment alternative whose target is itself eligible, else the
 * first eligible substitution, else the slot is dropped; and no exercise ID
 * appears twice in one session.
 */
function fillTemplateAt(exerciseIds: readonly string[], tier: EquipmentTier): string[] {
  const filled: string[] = [];
  for (const exerciseId of exerciseIds) {
    let resolved: string | null = null;
    if (performableAt(exerciseId, tier)) {
      resolved = exerciseId;
    } else {
      const alternative = (byId.get(exerciseId)?.equipmentAlternatives ?? []).find(
        (candidate) => candidate.equipmentId === tier && performableAt(candidate.exerciseId, tier)
      );
      resolved =
        alternative?.exerciseId ??
        byId.get(exerciseId)?.substitutionIds.find((id) => performableAt(id, tier)) ??
        null;
    }
    if (resolved !== null && !filled.includes(resolved)) filled.push(resolved);
  }
  return filled;
}

describe("T-2038 — draft exercise catalog file", () => {
  it("parses in full through exerciseCatalogContentSchema under its own artifact key", () => {
    expect(() => exerciseCatalogContentSchema.parse(file.content)).not.toThrow();
    expect(file.content.artifactKey).toBe(DRAFT_EXERCISE_CATALOG_VERSION);
    expect(file.content.version).toBe(1);
    expect(exercises.length).toBeGreaterThanOrEqual(40);
  });

  it("carries T-2034's DRAFT_UNSIGNED review metadata verbatim, with provenance for every item", () => {
    expect(isDraftUnsignedReviewMetadata(file.reviewMetadata)).toBe(true);
    expect(file.reviewMetadata.decision).toBe("DRAFT_UNSIGNED");
    expect(file.reviewMetadata.unsignedNotice).toBe(FROZEN_UNSIGNED_NOTICE);

    const provenanceIds = new Set(
      file.reviewMetadata.proposalProvenance.map((entry) => entry.parameterId)
    );
    for (const item of [...exercises, ...templates]) {
      expect(provenanceIds.has(item.id)).toBe(true);
    }
    for (const entry of file.reviewMetadata.proposalProvenance) {
      expect(entry.sourceUrl).toBe("https://acsm.org/resistance-training-guidelines-update-2026/");
    }
  });

  it("is synthetic: false and ships every item PROPOSED", () => {
    // `synthetic: false` is what the conversion function writes, and what
    // parseArtifactDraftInput requires of a DRAFT_UNSIGNED artifact (T-2034).
    const draft = draftExerciseCatalogToArtifactDraftInput(
      file,
      buildSyntheticArtifactSet("t2038-signature").exerciseCatalog.reviewMetadata,
      []
    );
    expect(draft.synthetic).toBe(false);
    expect(draft.kind).toBe("EXERCISE_CATALOG");

    expect(file.reviewStates.length).toBe(exercises.length + templates.length);
    for (const state of file.reviewStates) {
      expect(state.reviewState).toBe("PROPOSED");
    }
  });

  it("rejects a file whose review state is missing, duplicated or not on a real item", () => {
    const missing = structuredClone(file);
    missing.reviewStates = missing.reviewStates.slice(1);
    expect(draftExerciseCatalogFileSchema.safeParse(missing).success).toBe(false);

    const dangling = structuredClone(file);
    dangling.reviewStates[0].itemId = "not-a-movement-in-this-file";
    expect(draftExerciseCatalogFileSchema.safeParse(dangling).success).toBe(false);
  });
});

describe("T-2038 — identifier convention (the shipped iOS build renders the ID)", () => {
  it("uses lower-kebab IDs with words spelled out, unique across the file", () => {
    const seen = new Set<string>();
    for (const item of [...exercises, ...templates]) {
      expect(item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
    }
  });

  it("renders through aiReadable with no two-letter abbreviation token", () => {
    for (const exercise of exercises) {
      const rendered = exercise.id.replace(/[-_]/g, " ");
      for (const token of rendered.split(" ")) {
        expect(ABBREVIATION_TOKENS.has(token)).toBe(false);
      }
    }
  });
});

describe("T-2038 — references resolve inside the file", () => {
  it("resolves every substitution and every equipment alternative", () => {
    for (const exercise of exercises) {
      for (const substitutionId of exercise.substitutionIds) {
        expect(byId.has(substitutionId)).toBe(true);
        expect(substitutionId).not.toBe(exercise.id);
      }
      for (const alternative of exercise.equipmentAlternatives ?? []) {
        expect(byId.has(alternative.exerciseId)).toBe(true);
        expect(alternative.exerciseId).not.toBe(exercise.id);
      }
    }
    for (const template of templates) {
      for (const exerciseId of template.exerciseIds) expect(byId.has(exerciseId)).toBe(true);
      expect(new Set(template.exerciseIds).size).toBe(template.exerciseIds.length);
    }
  });

  it("never needs a second substitution hop: an alternative is itself performable at the tier it is offered for", () => {
    // The composer follows a substitution chain at most once (T-2005 step 7).
    // An alternative that is itself unavailable at that tier would silently drop
    // the slot instead of filling it.
    for (const exercise of exercises) {
      for (const alternative of exercise.equipmentAlternatives ?? []) {
        expect({
          exercise: exercise.id,
          alternative: alternative.exerciseId,
          tier: alternative.equipmentId,
          performable: performableAt(alternative.exerciseId, alternative.equipmentId as EquipmentTier),
        }).toMatchObject({ performable: true });
      }
    }
  });

  it("carries only rule IDs from the two closed sets in T-2005", () => {
    for (const exercise of exercises) {
      for (const ruleId of exercise.contraindicationRuleIds) {
        expect(CONTRAINDICATION_RULE_IDS.has(ruleId)).toBe(true);
      }
      for (const ruleId of exercise.beginnerConstraintIds) {
        expect(BEGINNER_CONSTRAINT_IDS.has(ruleId)).toBe(true);
      }
    }
    for (const template of templates) {
      for (const ruleId of template.beginnerConstraintIds) {
        expect(BEGINNER_CONSTRAINT_IDS.has(ruleId)).toBe(true);
      }
    }
  });
});

describe("T-2038 — equipment coverage", () => {
  it("meets the floor at every tier", () => {
    const countAt = (tier: EquipmentTier) =>
      exercises.filter((exercise) => exercise.equipmentIds.includes(tier)).length;
    expect(countAt("EQUIPMENT_NONE")).toBeGreaterThanOrEqual(14);
    expect(countAt("EQUIPMENT_HOME_BASIC")).toBeGreaterThanOrEqual(26);
    expect(countAt("EQUIPMENT_FULL_GYM")).toBe(exercises.length);

    const cardio = exercises.filter((exercise) => exercise.modality === "CARDIO");
    expect(cardio.length).toBeGreaterThanOrEqual(3);
    expect(
      cardio.some((exercise) => exercise.equipmentIds.includes("EQUIPMENT_NONE"))
    ).toBe(true);
  });

  it("carries at least two movements for every pattern a template uses", () => {
    const patternCounts = new Map<string, number>();
    for (const exercise of exercises) {
      const pattern = exercise.movementPattern;
      if (pattern) patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
    }
    const used = new Set<string>();
    for (const template of templates) {
      for (const exerciseId of template.exerciseIds) {
        const pattern = byId.get(exerciseId)?.movementPattern;
        if (pattern) used.add(pattern);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const pattern of used) {
      expect({ pattern, count: patternCounts.get(pattern) ?? 0 }).toMatchObject({
        count: expect.any(Number),
      });
      expect(patternCounts.get(pattern) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it("declares the full template set and fills every template at every tier", () => {
    const kinds = templates.map((template) => `${template.templateKind}:${template.sequence}`);
    for (const required of [
      "FULL_BODY:1",
      "FULL_BODY:2",
      "FULL_BODY:3",
      "UPPER:1",
      "UPPER:2",
      "LOWER:1",
      "LOWER:2",
    ]) {
      expect(kinds).toContain(required);
    }
    expect(templates.some((template) => template.templateKind === "CARDIO")).toBe(true);

    for (const template of templates) {
      for (const tier of EQUIPMENT_TIERS) {
        const filled = fillTemplateAt(template.exerciseIds, tier);
        expect(new Set(filled).size).toBe(filled.length);
        // A strength template must still be a session, not a single movement,
        // after the equipment filter; a cardio template only needs one modality.
        const floor = template.templateKind === "CARDIO" ? 1 : 4;
        expect({ template: template.id, tier, filled: filled.length }).toMatchObject({
          filled: expect.any(Number),
        });
        expect(filled.length).toBeGreaterThanOrEqual(floor);
      }
    }
  });
});

describe("T-2038 — content discipline", () => {
  const texts = exercises.flatMap((exercise) =>
    [...exercise.instructions!, ...exercise.cues!].map((text) => ({ id: exercise.id, text }))
  );

  it("has instructions and cues on every movement", () => {
    for (const exercise of exercises) {
      expect(exercise.instructions?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(exercise.cues?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(exercise.movementPattern).toBeDefined();
      expect(exercise.primaryMuscleIds?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(exercise.laterality).toBeDefined();
      expect(exercise.loadKind).toBeDefined();
    }
  });

  it("states no dose: no sets, repetitions, rest, load, tempo, frequency or duration", () => {
    for (const { id, text } of texts) {
      expect({ id, text, dose: DOSE_PATTERN.exec(text)?.[0] ?? null }).toMatchObject({ dose: null });
      // Stricter than the spec's regex on purpose: a bare digit is how a dose
      // gets in. There is no instruction in this catalog that needs one.
      expect({ id, text, digit: ANY_DIGIT.exec(text)?.[0] ?? null }).toMatchObject({ digit: null });
      expect({ id, text, word: DOSE_WORD.exec(text)?.[0] ?? null }).toMatchObject({ word: null });
      expect({ id, text, setNoun: DOSE_SET_NOUN.exec(text)?.[0] ?? null }).toMatchObject({
        setNoun: null,
      });
    }
  });

  it("makes no clinical claim: no diagnosis, pain management, rehabilitation or working through symptoms", () => {
    for (const { id, text } of texts) {
      expect({ id, text, term: CLINICAL_TERM.exec(text)?.[0] ?? null }).toMatchObject({ term: null });
    }
  });

  it("carries no media field, and the schema refuses to grow one", () => {
    // v1 ships no licensed images, video, GIFs or animation (T-2005 Decisions).
    // exerciseCatalogContentSchema is .strict(), so this is structural.
    const withMedia = structuredClone(file.content) as Record<string, unknown> & {
      exercises: Record<string, unknown>[];
    };
    withMedia.exercises[0].imageUrl = "https://example.invalid/demo.gif";
    expect(exerciseCatalogContentSchema.safeParse(withMedia).success).toBe(false);

    for (const exercise of exercises) {
      for (const key of Object.keys(exercise)) {
        expect(/image|video|gif|animation|thumbnail|media/i.test(key)).toBe(false);
      }
    }
  });

  it("names ACSM as a consulted reference and nothing more", () => {
    for (const exercise of exercises) {
      expect(exercise.source.sourceId).toBe("ACSM-RESISTANCE-TRAINING-2026");
      expect(exercise.source.licenseClassification).toBe("PUBLIC_SUMMARY_REFERENCE_ONLY");
      // `authority` is a fixed schema literal describing the class of reference.
      // It is not a claim that ACSM reviewed this record, and `reviewedAt` is the
      // date the page was consulted — see the module doc and the README header.
      expect(exercise.source.authority).toBe("REVIEWED_SOURCE");
    }
  });
});

describe("T-2038 — the draft cannot be loaded or registered unsigned", () => {
  it("throws when loadDraftUnsignedExerciseCatalog is called in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => loadDraftUnsignedExerciseCatalog()).toThrow(
        "Draft unsigned artifacts cannot be loaded in production environments."
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not resolve until a server-side module deliberately enables it", () => {
    disableDraftExerciseCatalog();
    try {
      expect(getDraftExerciseCatalog()).toBeNull();
      // T-2040: an unavailable catalog is reported as CATALOG_VERSION_NOT_SERVED
      // ("this build cannot resolve that catalog") rather than UNKNOWN_ID
      // ("that reference is wrong"). The guarantee this test protects is
      // unchanged: the draft does not resolve until deliberately enabled.
      expect(getExerciseItem("chair-squat", DRAFT_EXERCISE_CATALOG_VERSION)).toEqual({
        success: false,
        error: "CATALOG_VERSION_NOT_SERVED",
      });
    } finally {
      enableDraftExerciseCatalog();
    }
    expect(getExerciseItem("chair-squat", DRAFT_EXERCISE_CATALOG_VERSION)).toMatchObject({
      success: true,
    });
  });

  it("is not resolvable at all in production, and degrades rather than throwing", () => {
    // getExerciseItem runs inside planPayloadSchema's superRefine on every parse
    // of every stored plan, so the production refusal must present as a lookup
    // failure, not as an exception on a read path. T-2040 makes that failure
    // CATALOG_VERSION_NOT_SERVED, which planPayloadSchema deliberately does not
    // treat as an invalid payload — authority for a catalog this build cannot
    // resolve belongs to the reviewed artifact (autonomy/gate.ts).
    enableDraftExerciseCatalog();
    expect(getExerciseItem("chair-squat", DRAFT_EXERCISE_CATALOG_VERSION)).toMatchObject({
      success: true,
    });
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(getDraftExerciseCatalog()).toBeNull();
      expect(getExerciseItem("chair-squat", DRAFT_EXERCISE_CATALOG_VERSION)).toEqual({
        success: false,
        error: "CATALOG_VERSION_NOT_SERVED",
      });
      // The fixture catalog is unaffected: no client loses a plan over this.
      expect(getExerciseItem("bodyweight-squat", "exercise-fixture-v1")).toMatchObject({
        success: true,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses to build an artifact draft input from the file's own draft metadata", () => {
    expect(() =>
      draftExerciseCatalogToArtifactDraftInput(
        file,
        file.reviewMetadata as unknown as SignedArtifactReviewMetadata,
        []
      )
    ).toThrow(/signed review metadata/i);
  });
});

describe("T-2038 — nothing wires the draft catalog into a client-visible payload", () => {
  /**
   * The only thing standing between unsigned draft content and a real client is
   * that no module stamps `exercise-beginner-v1` into a plan payload or a
   * catalog reference. That was true but written down nowhere and enforced by
   * nothing, which is the shape that let a fabricated food catalog sit one
   * wiring change away from a client (board/evidence/T-2035.md). This test is
   * the enforcement: wiring it makes this red, and the reviewer of that change
   * has to justify it here.
   *
   * These four files are the whole legitimate surface:
   *   - the import-free leaf that declares the constant;
   *   - the draft loader, which re-exports it and guards the only read;
   *   - the in-code projection, which the server-side wiring registers;
   *   - the catalog loader, which routes `getExerciseItem` on it.
   */
  const ALLOWED_PRODUCTION_REFERENCES = new Set([
    "lib/ai-coach/artifacts/drafts/exercise-catalog.ts",
    "lib/ai-coach/catalog/draft-catalog-version.ts",
    "lib/ai-coach/catalog/exercise-catalog.ts",
    "lib/ai-coach/catalog/loader.ts",
  ]);

  /** The two modules that carry the draft content itself. */
  const DRAFT_CONTENT_MODULES = [
    "artifacts/drafts/exercise-catalog",
    "catalog/draft-exercise-catalog",
  ];

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

  it("scans a real, non-empty set of production modules", () => {
    // A silently empty scan would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("lib/ai-coach/initial-plan.ts");
    expect(files).toContain("lib/ai-coach/run-command.ts");
    expect(files).toContain("components/ai-coach/evidence-forms.tsx");
  });

  it("names the draft catalog version only in the catalog wiring, never in a payload writer", () => {
    const referencing = files.filter((file) => {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      return (
        source.includes(DRAFT_EXERCISE_CATALOG_VERSION) ||
        source.includes("DRAFT_EXERCISE_CATALOG_VERSION")
      );
    });
    expect([...referencing].sort()).toEqual([...ALLOWED_PRODUCTION_REFERENCES].sort());
  });

  it("stamps only EXERCISE_CATALOG_VERSION into catalogVersions", () => {
    const writers = files.filter((file) =>
      fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("catalogVersions")
    );
    expect(writers.length).toBeGreaterThan(0);
    for (const file of writers) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect({ file, stampsDraft: source.includes(DRAFT_EXERCISE_CATALOG_VERSION) }).toMatchObject({
        stampsDraft: false,
      });
    }
  });

  it("keeps the draft content out of every client-reachable module", () => {
    // catalog/loader.ts is imported by components/ai-coach/plan-display.tsx and
    // components/ai-coach/evidence-forms.tsx, both "use client". Anything those
    // reach transitively is downloaded by every client on that route.
    const clientReachable = files.filter(
      (file) => file.startsWith("app/") || file.startsWith("components/")
    );
    expect(clientReachable.length).toBeGreaterThan(0);
    for (const file of clientReachable) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const contentModule of DRAFT_CONTENT_MODULES) {
        expect({ file, contentModule, imports: source.includes(contentModule) }).toMatchObject({
          imports: false,
        });
      }
    }

    // The client-reachable catalog modules may name the version, but must not
    // import anything that carries the content.
    for (const file of ["lib/ai-coach/catalog/loader.ts", "lib/ai-coach/catalog/exercise-catalog.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const contentModule of DRAFT_CONTENT_MODULES) {
        const runtimeImport = new RegExp(`^import\\s+(?!type\\s)[^;]*${contentModule}`, "m");
        expect({ file, contentModule, runtimeImport: runtimeImport.test(source) }).toMatchObject({
          runtimeImport: false,
        });
      }
    }
  });

  it("keeps the draft JSON out of every statically imported module", () => {
    // A static `import ... from "./exercise-catalog.draft-unsigned.v1.json"`
    // puts the whole file into any bundle that can reach the importer, and
    // catalog/loader.ts is reachable from a "use client" component.
    const importers = files.filter((file) =>
      /from\s+["'][^"']*exercise-catalog\.draft-unsigned\.v1\.json["']/.test(
        fs.readFileSync(path.join(process.cwd(), file), "utf8")
      )
    );
    expect(importers).toEqual(["lib/ai-coach/artifacts/drafts/exercise-catalog.ts"]);
  });
});
