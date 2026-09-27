import { z } from "zod";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "../schema";
import {
  draftUnsignedReviewMetadataSchema,
  escalationTemplatesContentSchema,
  isDraftUnsignedReviewMetadata,
  signedArtifactReviewMetadataSchema,
} from "../schema";
import rawDraftEscalationTemplates from "./escalation-templates.draft-unsigned.v1.json";

/**
 * S-V1-artifacts — the DRAFT_UNSIGNED escalation templates.
 *
 * `nextStepText` and `nonMonitoringStatement` are the sentences a real person
 * reads when the deterministic gate decides it cannot proceed. They are clinical
 * and legal copy, not engineering copy, so every string here is a **candidate**
 * for a qualified professional and legal counsel to correct or replace, and
 * every template is `PROPOSED`.
 *
 * The content rules are structural, enforced by
 * `tests/unit/ai-coach-evidence-escalation-drafts.test.ts` rather than by
 * whoever edits this file next:
 *
 * - No digit and no spelled-out number in any client-facing string. A dose, a
 *   rate or a threshold is a clinical decision, and this artifact carries none.
 * - No promise that a human is reviewing, because none is: v1 is bounded
 *   autonomy with no per-plan human approval
 *   (`board/strategy/ai-coach-v1-autonomy-plan.md`). The copy directs the client
 *   to a qualified professional; it never says one is already looking.
 * - No diagnosis, and no urgency the service cannot back.
 * - One `nonMonitoringStatement`, identical across every template, so the
 *   reviewer corrects one sentence rather than fifteen copies of it.
 *
 * Coverage: `resolveNextActionTemplateId` (autonomy/gate.ts) resolves a template
 * for **every** evaluation, approvals included, and throws `ARTIFACT_INCOMPATIBLE`
 * when neither the whole ordered reason-code set nor the leading `GATE_*` code is
 * covered — a 503 with no decision row. The template array therefore covers every
 * `AutonomyGateReasonCode`, every `PrescriptionReasonCode`, and every reason code
 * the draft policy bundle's `safetyControls` can emit. **Array order is
 * load-bearing:** the degraded lookup is a `find`, so the most protective
 * prescription template precedes the others. A test pins the order.
 *
 * Two deliberate omissions, both fail-closed (the T-2039 pattern):
 *
 * - No template carries `TRAINING.EFFORT.STRENGTH.V1` or `TRAINING.EFFORT.CARDIO.V1`.
 *   Effort guidance is a dose. Without them `resolveTrainingParameters` returns
 *   `TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE` and composes nothing.
 * - No template is bound as a prescription explanation, so
 *   `resolveReviewedPrescriptionExplanationTexts` returns an empty list and
 *   `computePrescription` fails closed to
 *   `PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE`.
 *
 * `geographies` is the sentinel {@link NO_GEOGRAPHY_CLEARED} on every template:
 * no jurisdiction has cleared this copy. `pausedDomains` has no runtime reader
 * (a test asserts that) and no empty representation in the schema; see the
 * README for the one template where that matters.
 *
 * **This module is server-side and test-side only.** It statically imports the
 * JSON, so any module importing it carries the draft copy into its bundle, the
 * way T-2038's catalog reached a browser chunk. Nothing under `app/` or
 * `components/` may import it, and a unit test asserts it.
 */

export const NO_GEOGRAPHY_CLEARED = "PENDING_LEGAL_AND_CLINICAL_REVIEW.NO_GEOGRAPHY_CLEARED";

/**
 * Per-template review marks, in the file envelope rather than in `content` so
 * reviewer workflow state stays out of `artifactContentDigest` (T-2038).
 */
export const draftEscalationReviewStateSchema = z
  .object({
    itemKind: z.literal("TEMPLATE"),
    itemId: z.string().min(1).max(160),
    reviewState: z.enum(["PROPOSED", "ACCEPTED", "STRUCK"]),
  })
  .strict();

export type DraftEscalationReviewState = z.infer<typeof draftEscalationReviewStateSchema>;

export const draftEscalationTemplatesFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    reviewMetadata: draftUnsignedReviewMetadataSchema,
    reviewStates: z.array(draftEscalationReviewStateSchema).min(1).max(20_000),
    content: escalationTemplatesContentSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    const templateIds = new Set(file.content.templates.map((template) => template.id));
    const seen = new Set<string>();
    file.reviewStates.forEach((state, index) => {
      if (seen.has(state.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemId"],
          message: `Duplicate review state for ${state.itemId}`,
        });
      }
      seen.add(state.itemId);
      if (!templateIds.has(state.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates", index, "itemId"],
          message: `Review state references a template that is not in the artifact: ${state.itemId}`,
        });
      }
    });
    for (const templateId of templateIds) {
      if (!seen.has(templateId)) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewStates"],
          message: `Every template needs a review state; missing: ${templateId}`,
        });
      }
    }
  });

export type DraftEscalationTemplatesFile = z.infer<typeof draftEscalationTemplatesFileSchema>;

/**
 * Loads and strictly parses the checked-in DRAFT_UNSIGNED escalation templates.
 * Throws in production environments — draft artifacts must never be loaded in
 * production. Mirrors `loadDraftUnsignedPolicyBundle` /
 * `loadDraftUnsignedExerciseCatalog`.
 */
export function loadDraftUnsignedEscalationTemplates(): DraftEscalationTemplatesFile {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Draft unsigned artifacts cannot be loaded in production environments.");
  }
  return draftEscalationTemplatesFileSchema.parse(rawDraftEscalationTemplates);
}

/**
 * Converts a validated draft file into an `ArtifactDraftInput` ready for
 * registration once signed by a qualified professional reviewer and cleared by
 * legal counsel. The required `signed` argument makes registering an unsigned
 * draft unrepresentable at the type level, and the runtime check makes it
 * unrepresentable from JavaScript too. No caller exists yet; that is intentional
 * — G01/G03 have not happened.
 */
export function draftEscalationTemplatesToArtifactDraftInput(
  file: DraftEscalationTemplatesFile,
  signed: SignedArtifactReviewMetadata,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  if (
    isDraftUnsignedReviewMetadata(signed) ||
    !signedArtifactReviewMetadataSchema.safeParse(signed).success
  ) {
    throw new Error(
      "The escalation templates can only be registered with signed review metadata from a qualified professional reviewer."
    );
  }
  return {
    id: `${file.content.artifactKey}:v${file.content.version}`,
    artifactKey: file.content.artifactKey,
    version: file.content.version,
    kind: "ESCALATION_TEMPLATES",
    schemaVersion: 1,
    engineVersions: ["ai-coach-artifact-engine-v1"],
    dependencies,
    synthetic: false,
    reviewMetadata: signed,
    content: file.content,
  };
}
