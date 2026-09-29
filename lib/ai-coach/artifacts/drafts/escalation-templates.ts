import { z } from "zod";
import type {
  ArtifactDraftInput,
  ArtifactReference,
  SignedArtifactReviewMetadata,
} from "../schema";
import { escalationTemplatesContentSchema } from "../schema";
import {
  artifactFileReviewMetadataSchema,
  reportReviewStateMismatch,
  requireSignedReviewMetadata,
} from "./file-review";
import rawDraftEscalationTemplates from "./escalation-templates.draft-unsigned.v1.json";

/**
 * S-V1-artifacts / S-17 — the escalation templates, signed.
 *
 * `nextStepText` and `nonMonitoringStatement` are the sentences a real person
 * reads when the deterministic gate decides it cannot proceed. They are clinical
 * and legal copy, not engineering copy. Every string was written or confirmed by
 * the accountable owner in `steadfast-hq/board/REVIEW-WORKSHEET.md` and applied
 * here verbatim; S-17 changed none of the wording it was handed. **Nobody may
 * edit a string in this file without a new signed worksheet entry** — an edit
 * made here is content nobody reviewed, wearing a signature that says someone
 * did.
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
 * **Three of these templates are not escalations.** Worksheet section 3 supplied
 * the two training-effort sentences and the nutrition-target explanation, which
 * were the values deliberately left absent so the system failed closed rather
 * than guessing a dose. They live here because that is where copy lives, but
 * they are bound through `policy.trainingEffortTemplateIds` and
 * `policy.prescriptionExplanationTemplateIds` — never through
 * `escalationTemplateIds` — and their `reasonCodes` carry
 * {@link NON_ESCALATION_REASON_CODE_PREFIX} so the separation is checkable
 * rather than remembered. S-15 is why: when all three shared one list, effort
 * copy published itself underneath clients' calorie targets on 257 of 257
 * prescriptions. A test fails if any id appears in more than one list.
 *
 * `geographies` is the market the signed metadata clears
 * (`reviewMetadata.jurisdictionReview.jurisdictions`), and a test asserts the
 * two stay equal so copy and metadata cannot drift. `pausedDomains` has no
 * runtime reader (a test asserts that) and no empty representation in the
 * schema; see the README for the templates where that matters.
 *
 * **This module is server-side and test-side only.** It statically imports the
 * JSON, so any module importing it carries the draft copy into its bundle, the
 * way T-2038's catalog reached a browser chunk. Nothing under `app/` or
 * `components/` may import it, and a unit test asserts it.
 */

/**
 * Marks a template that is copy rather than an escalation.
 *
 * `resolveNextActionTemplateId` only ever selects from
 * `policy.escalationTemplateIds`, so a template carrying this prefix can never
 * be chosen as a gate outcome. The prefix exists so a test can prove that,
 * instead of the separation resting on nobody adding the wrong id to the wrong
 * list — which is exactly what went wrong in S-15.
 */
export const NON_ESCALATION_REASON_CODE_PREFIX = "NOT_AN_ESCALATION.";

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
    reviewMetadata: artifactFileReviewMetadataSchema,
    reviewStates: z.array(draftEscalationReviewStateSchema).min(1).max(20_000),
    content: escalationTemplatesContentSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    reportReviewStateMismatch(file.reviewMetadata, file.reviewStates, ctx);
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
 * Converts the validated file into an `ArtifactDraftInput` ready for
 * registration. The signature is read from the file rather than passed in, so
 * the file and the registered artifact cannot disagree about who signed what,
 * and {@link requireSignedReviewMetadata} refuses an unsigned one from
 * JavaScript as well as from TypeScript.
 *
 * No caller exists, and that is still intentional: registering is activation,
 * and activation is Jaden's step alone.
 */
export function escalationTemplatesToArtifactDraftInput(
  file: DraftEscalationTemplatesFile,
  dependencies: ArtifactReference[]
): ArtifactDraftInput<SignedArtifactReviewMetadata> {
  const signed = requireSignedReviewMetadata(file.reviewMetadata, "escalation templates");
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
