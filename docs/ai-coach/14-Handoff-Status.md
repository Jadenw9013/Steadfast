# Implementation handoff status (updated 2026-09-21)

**This file is not part of the original review pack (00–13).** It was added
during implementation to record what has actually been built, verified and
committed, and what remains, so a different coding agent (or a human) can
pick up the work without re-deriving context. If anything here conflicts
with 00–13, the original pack's contracts win — this file is a status
snapshot, not a spec.

The original handoff below describes committed work on `main`. The Codex
takeover correction described next is recorded in a local commit. Nothing
has been pushed or deployed during the takeover. No real clinical/nutrition/exercise content exists
anywhere in this codebase — every numeric threshold, food, exercise and
policy version introduced so far is explicitly marked SYNTHETIC/FIXTURE in
its source file and is not fit to show a real user.

## Current takeover status — read before the historical log

**T-2040 catalog references resolve by key, 2026-09-26:** `lib/ai-coach/catalog/loader.ts` becomes an explicit key -> map registry with a third lookup error, `CATALOG_VERSION_NOT_SERVED`, plus `foodCatalogIsServedInCode` / `exerciseCatalogIsServedInCode`. The in-code catalogs are now understood as the fixture keys this build happens to carry; **the reviewed artifact set is the authority for any key it does not carry** (`artifacts/repository.ts`'s `getReviewedFoodItem` / `getReviewedExerciseItem`, reached through `autonomy/gate.ts`'s `catalogItemsValid`). So `planPayloadSchema.superRefine` no longer marks a payload invalid merely because it is bound to a catalog this build cannot resolve: it still rejects `UNKNOWN_ID` and `CATALOG_VERSION_MISMATCH` inside a served catalog, still checks the plan-binding (`catalogVersion !== plan.catalogVersions.*`) first and unconditionally, and only swallows `CATALOG_VERSION_NOT_SERVED`. Before this change a plan bound to a live reviewed catalog could not be represented at all, and the failure was not a rejected write but a blank screen on nine read paths (`validated-plan.ts`, the workspace `activePlan` and `equivalent`, `availableSubstitutions`, `workouts/ai-session.ts`, `nutrition-safety.ts`'s `readNutritionHistory` — where a parse failure becomes `UNVERIFIABLE` and a permanent HOLD — finalization/acceptance, and the constrained-provider boundary). Three behaviour changes follow from routing by key and are asserted in `tests/unit/ai-coach-catalog.test.ts`: an unrecognised key (`food-fixture-v0`, `exercise-fixture-v0`) and the unavailable T-2038 draft key now report `CATALOG_VERSION_NOT_SERVED` where they reported `CATALOG_VERSION_MISMATCH` or `UNKNOWN_ID`; every one stays `success: false` and none throws. **Exercise-modality authority moved to the reviewed artifact:** `catalogItemsValid` now throws when a strength slot holds a non-`STRENGTH` item or a cardio slot a non-`CARDIO` one, landing on the existing `GATE_CANDIDATE_INVALID` through the existing `catch` — no new reason code, no `GATE_ORDER` or `validationReport.checks` change — so relaxing the schema loses no guarantee and the artifact path is strictly stronger than before. `representation.ts` stops comparing and rewriting `FOOD_CATALOG_VERSION`: a substitution is validated against the plan's own `catalogVersions.food`, the MEALS branch refuses (`NO_FEASIBLE_MEALS`, never a throw) to compose fixture meals into a plan bound to another catalog, and the two `payload.catalogVersions.food = FOOD_CATALOG_VERSION` re-labelling assignments are deleted. `plan-contract.ts` widens `contentKind` to `z.enum(["SYNTHETIC_FIXTURE", "REVIEWED_LIVE_V1"])` and appends `LIVE_COMPOSITION_UNAVAILABLE` to `decisionSchema.reasonCodes`; both are additive and nothing writes either value until T-2041. **No stored row changes meaning:** every existing payload uses `food-fixture-v1`, `food-fixture-v2` or `exercise-fixture-v1`, all served, and golden content hashes for the synthetic corpus captured from the pre-change code at `408bf8f` are asserted unchanged in `tests/unit/ai-coach-plan-contract.test.ts` and `tests/unit/ai-coach-representation.test.ts`. No Prisma change, no migration, no purge line. REST and Swift contracts are unchanged. New read-path proof: `tests/integration/ai-coach-live-catalog-binding.test.ts`.

**T-2038 draft beginner exercise catalog, additive artifact-schema fields and version-routed loader, 2026-09-26:** `lib/ai-coach/artifacts/drafts/exercise-catalog.draft-unsigned.v1.json` checks in 41 beginner movements and 8 session templates (`FULL_BODY` 1-3, `UPPER` 1-2, `LOWER` 1-2, one `CARDIO`) as a `DRAFT_UNSIGNED` artifact with every item `PROPOSED`, reusing T-2034's review-metadata branch verbatim. `exerciseCatalogContentSchema` gains optional, default-free `movementPattern`, `primaryMuscleIds`, `laterality`, `loadKind`, `instructions`, `cues` and `equipmentAlternatives` on `exercises[]` and `name`, `templateKind`, `sequence` on `templates[]`; the digests of all ten synthetic artifacts are asserted against literals captured before the change (`tests/unit/ai-coach-artifacts.test.ts`). `lib/ai-coach/catalog/exercise-catalog.ts` gains `projectDraftExerciseCatalog()` as a **projection** of that JSON (an unmappable equipment tier throws at module load), and `getExerciseItem` routes on `catalogVersion` exactly as `getFoodItem` routes `food-fixture-v1`. `EXERCISE_CATALOG_VERSION`, the three fixture items and every stored run snapshot are untouched, and the two catalogs cannot resolve each other's IDs. No runtime behaviour changes for any account: nothing stamps `exercise-beginner-v1` into a payload, and the draft has no published artifact. Content is a reference-informed engineering draft for the G02 reviewer, not guidance: instructions carry no dose and no clinical language, enforced mechanically in `tests/unit/ai-coach-exercise-catalog-draft.test.ts`, and ACSM has reviewed or endorsed nothing in it (see `docs/ai-coach/catalog/README.md`, which also lists the known content gaps: no equipment-free vertical pull, no `ROTATION` movement, `CONTRA.HIGH_IMPACT.V1` unused). The draft content is deliberately kept out of every client bundle: `components/ai-coach/{plan-display,evidence-forms}.tsx` are `"use client"` and import `catalog/loader.ts`, so the first version of this ticket shipped 120 KB of unsigned draft movements to the browser through a static JSON import. The version string now lives in an import-free leaf (`lib/ai-coach/catalog/draft-catalog-version.ts`), the JSON is imported only by the guarded loader, and `lib/ai-coach/catalog/draft-exercise-catalog.ts` is the single server-side module that wires the two together — so the production refusal is the only door to the content and `getExerciseItem(id, "exercise-beginner-v1")` reports `UNKNOWN_ID` until a server module deliberately enables it. A unit test scans `lib/`, `app/` and `components/` and fails if any module stamps the draft version into a payload or imports the draft content into the client graph. The composer that reads it is T-2039.

**T-2033 prescription-first composer, real safety projection, and the prescription-unavailable gate check, 2026-09-26:** `composeInitialPlan` (`lib/ai-coach/initial-plan.ts`) replaces `buildInitialFixturePlan`'s inversion for a v2-confirmed intake: it calls `computePrescription` (T-2032) first, then `composeMealsToPrescription` solves and verifies catalog meals against the prescription (never composes portions that miss it; with today's 3-item fixture catalog the MEALS representation is usually infeasible for a real prescription — MACROS is the expected v1 outcome, matching T-2003's design). A v1 intake, or a v2 intake whose engine parameters could not be resolved, routes to `composeLegacySyntheticPlan` (today's fixture-scaled logic, moved verbatim) or `composeUnavailablePrescriptionPlan` respectively — see that file's module doc for the exact routing rule and a flagged judgment call versus the frozen spec text. Every payload now carries `prescriptionOutcome` (`plan-contract.ts`, additive); `nutrition.method` is widened to `z.enum(["SYNTHETIC_CATALOG_MATCH", "REVIEWED_PRESCRIPTION_V1"])`. The autonomy gate (`autonomy/gate.ts`) gains a `TARGET_AND_LIMITS`-stage check (`facts.prescription`) that makes `APPROVE_AUTOMATICALLY` unreachable whenever a goal needs nutrition and the engine did not produce it (`GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE`); `null` (legacy row) is unaffected. `finalization.ts` now recomputes `projectedWeeklyWeightChangeKg` for a `REVIEWED_PRESCRIPTION_V1` candidate by replaying the engine against the stored intake and the currently loaded bundle (T-2000's hard-coded `0`/`null` stays only on the legacy `SYNTHETIC_CATALOG_MATCH` path); a `targetEnergyKcal` mismatch **at an equal `profileRevision`** is a 422, a `parameterSetDigest`-only mismatch is a stale-candidate HOLD (`PRESCRIPTION_PARAMETER_SET_CHANGED`), per T-2003 Amendment 1 §A1.5. Review round 1 added three more distinctions to that replay, because it reads the *live* `confirmedIntake` at *today's* date and so can differ from the candidate's generation input for reasons that are not a policy change: a changed `profileRevision` (the client re-confirmed intake, e.g. a new weigh-in) is HOLD `PRESCRIPTION_CANDIDATE_INPUTS_CHANGED`; an engine `UNAVAILABLE` whose reason codes are not the policy class (e.g. a weigh-in that aged past `ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS`) is HOLD `PRESCRIPTION_CANDIDATE_INPUTS_NOT_REPRODUCIBLE` plus the engine's own codes; only a parameter-resolution failure or a policy-class reason keeps `PRESCRIPTION_PARAMETER_SET_CHANGED`. Three consumers (`autonomy/gate.ts`'s `outcomeFor`, `initial-plan.ts`'s UNAVAILABLE decision, `finalization.ts`) route off one shared three-class split, `lib/ai-coach/prescription-reason-classes.ts`; the composer's UNAVAILABLE decision therefore no longer tells every client to go fix their intake (`CLARIFY`/`MISSING_INPUT` only for the client-fixable class, `PAUSE_REFER`/`SAFETY_CONCERN` for out-of-scope, `HOLD`/`WEEKLY_POLICY_PARAMETERS_UNAVAILABLE` when the reviewed content is not signed). `resolveNextActionTemplateId` now degrades to a template covering the leading `GATE_*` code instead of throwing `ARTIFACT_INCOMPATIBLE` when a bundle does not declare every reason code (an unknown code was a 503 with no decision row, defeating `outcomeFor`'s unknown-is-HOLD forward compatibility), and `loadLiveArtifactSetForLaunchValidation` now requires a live packet to declare `GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE` and all 14 `PrescriptionReasonCode`s so that gap fails at live-launch validation instead of at a client request. `weekly-controller.ts` refuses (HOLD `WEEKLY_POLICY_PARAMETERS_UNAVAILABLE`) rather than scaling a `REVIEWED_PRESCRIPTION_V1` target by the fixture `nutritionStep` constant. `synthetic-fixtures.ts`'s escalation-templates fixture gained `GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE` and the 14 `PrescriptionReasonCode` values (needed for `resolveNextActionTemplateId` to resolve a next-action template for the new check — found by the ticket's own integration test, not anticipated by the spec). Tests: `tests/unit/ai-coach-composer.test.ts` (new), `tests/integration/ai-coach-prescription-flow.test.ts` (new); `tests/unit/ai-coach-prescription.test.ts`'s `buildPrescriptionInput` fixtures were updated to the real, merged v2 schema (T-2003 Amendment 1 §A1.4 — the local mirror in `prescription/inputs.ts` is deleted and replaced with an import from `lib/ai-coach/intake-contract.ts`, the client-safe leaf, not `lib/ai-coach/intake.ts`, to keep the prescription folder's "no `@/lib/db`" purity test green).

**T-2034 draft unsigned review metadata, checked-in draft nutrition bundle, and RD parameter catalogue, 2026-09-26:** splits `artifactReviewMetadataSchema` into `signedArtifactReviewMetadataSchema` and `draftUnsignedReviewMetadataSchema` discriminated on `decision` (`APPROVED` vs `DRAFT_UNSIGNED`). Draft unsigned review metadata does not require jurisdiction or clinical sign-off, but is refused by `assertUsable`, `publishArtifactVersion`, and `loadLiveArtifactSetForLaunchValidation` with `ARTIFACT_UNSIGNED_DRAFT`, ensuring that unreviewed clinical/nutrition content cannot be published or served to real clients. Adds all 75 parameters with fake values to synthetic fixtures. Checks in `lib/ai-coach/artifacts/drafts/policy-bundle-nutrition.draft-unsigned.v1.json` with 62 source-backed proposed parameters with provenance and 13 omitted under the omit-don't-guess rule (per Amendment 1 §A1.3). Adds loader `lib/ai-coach/artifacts/drafts/loader.ts` (throws if `NODE_ENV === "production"`) and `docs/ai-coach/17-Policy-Parameter-Catalogue.md` with complete rule groupings and tables.

**T-2032 prescription engine & round-3 review status (web), 2026-09-25:** adds the pure prescription engine module (`lib/ai-coach/prescription/`) implementing NASEM 2023 energy expenditure equations, objective-driven adjustments, protein g/kg calculation, and AMDR carbohydrate/fat bounds read exclusively from policy bundle parameters. 214 unit tests pass. **Review sign-off:** Formal code review completed in `board/reviews/T-2032-r3.md` (verdict: **APPROVED**). Rounds 1 and 2 returned CHANGES; round 3 addressed the B1 blocker, m14 epsilon scaling, and m15 direction logic. The final review pass caught and fixed a subtle IEEE 754 float discrepancy in `boundViolationIds` where epsilon tolerance in kg space masked loss-rate breaches that downstream strict `>` checks in `nutrition-safety.ts:202` rejected (e.g. w=40, cap=0.35%). Comparison was aligned to bit-identical consumer arithmetic with 0 discrepancies remaining across all supported inputs. Signed off and ready for RD inspection.

**T-2030 bounded explanation prose (web), 2026-09-25:** the constrained
provider may now also return `explanationText`/`clarificationText` — two
short, bounded sentences — alongside the existing IDs-only output
(`provider/adapter.ts`). A new pure module,
`provider/explanation-prose.ts` (`validateExplanationProse`), is the sole
authority on whether any of that text ever reaches a client: it checks
every digit against the server-rendered `displayValue` of a validated
numeric field (no tolerance), every named food/exercise against the
candidate plan's own display names, a closed prohibited-claim term list,
and structural outcome consistency (an explanation only survives on
`APPROVE_AUTOMATICALLY`, a clarification only on `FOCUSED_CLARIFICATION`
with an allowed clarification ID — enforced in `constrained-boundary.ts`,
not the pure validator). A rejection never blocks the deterministic
approval; it only drops the text and the template renders, exactly as
before this ticket. The accepted text is stored inside the existing
`AiAutomaticPlanApproval.providerSelection.explanation` object — a `text`
key is added **only when accepted**, so every pre-existing approval row's
`stateDigest` is unchanged. `AiProviderBoundaryAudit` gains one additive
nullable column, `explanationValidation` (reason codes and a character
count only, never the text). Web renders the validated text in place of
the run's deterministic explanation sentence on the proposal screen,
falling back to that sentence (never an empty paragraph) when no
validated prose exists — this also closes a pre-existing web/iOS parity
gap (iOS already rendered the run's explanation sentence on this screen;
web did not). iOS decoding/rendering is T-2031. No live coach or client
can reach a model-authored word yet: the AI Coach flags are off and no
`AiCoachLiveLaunchPacket` is ACTIVE — see the T-996 entry below.

**Deploy order (review r1 MINOR 7):** migration `20260925000300_ai_coach_explanation_validation`
(`AiProviderBoundaryAudit.explanationValidation`) must apply to Neon
**before** this code deploys. `persistAudit` (`constrained-boundary.ts`)
writes that column unconditionally on every boundary run that calls a
provider — not just prose-bearing ones — and `getAiWorkspace`
(`lib/queries/ai-coach.ts`) selects it unconditionally on every workspace
read, so deploying the code first makes every such write and read throw on
an unknown column, which fail-closes finalization for every client, not
just AI Coach ones reachable today. web `main` auto-deploys on push, so
this is a release-packet ordering step, not just a migration note.
Review r1 MINOR 6 also flagged (not fixed, tracked for the live-provider
rollout alongside T-997): once a live packet is ACTIVE, model-authored
prose inside `AiAutomaticPlanApproval.providerSelection` can make a
retried `finalizeCurrentClientPlan` call for the same candidate hit
`REVISION_CONFLICT` where it previously wouldn't have (see
`finalization.ts`'s comment at the `existing.stateDigest !== stateDigest`
check).

**Autonomy decision, 2026-09-21:** the mandatory human-review assumption for every initial numerical plan and intensifying change is superseded by [15 — Bounded autonomous coaching](15-Bounded-Autonomous-Coaching.md). Runtime approval is allowed only after a deterministic server-side gate returns `APPROVE_AUTOMATICALLY` using a professionally reviewed, versioned policy bundle, curated catalogs, contraindication/escalation rules and compact evidence registry. The prior reviewer queue remains governance/exception tooling. Historical entries below accurately describe what was built under the old assumption; they do not authorize it for v1. No runtime code was changed by this documentation decision.

**T-1006 structural gate, 2026-09-21:** a server-only fixed-order service now
produces only `APPROVE_AUTOMATICALLY`, `HOLD`, `FOCUSED_CLARIFICATION` or
`PAUSE_REFER`. It rejects non-synthetic artifacts, derives authority and account
classification from locked persisted state, consumes the latest digest-verified
T-1003 decision, validates the candidate and evidence revisions, resolves a
reviewed next-action template, and writes an append-only audit record bound to
the artifact set and candidate hash. Reviewer status, model output, caller-owned
identity and synthetic flags are not authority inputs. Audit records are included
in owner export and account deletion. No generation, finalization, acceptance,
feature flag, UI or live content was enabled; T-1007/T-1008 remain the consumers
that must enforce the current gate result at later lifecycle boundaries.

Validation passed with 516 isolated PostgreSQL integration tests, 783 default
tests (517 opt-in tests skipped in that separate run), Prisma generation/schema
validation, type-check, production build, ticket-scoped lint, new-file format and
diff checks. Repository-wide lint and format remain pre-existing baselines (13 errors,
63 warnings; 607 unformatted files). All gate values and fixtures remain
synthetic. Qualified nutrition-professional and jurisdiction-specific legal
approval are still required before any live artifact, threshold, cutoff, claim
or client-facing template can be published.

**T-1007 structural provider boundary, 2026-09-21:** a server-only constrained
provider interface now receives only persisted current-client synthetic language,
reviewed eligible catalog IDs, allowed reference IDs and zero tool capabilities.
Its strict output can select only those references; unknown facts, numerical
prescriptions, safety/authority decisions, activation requests and free-form
clarifications fail closed. T-1006 executes both before and after provider I/O,
and a provider concern can only downgrade the deterministic outcome. The legacy
executor provider seam now receives a tenant-free synthetic probe and can return
only the fixed synthetic `HOLD`, so it cannot bypass the constrained contract.

Provider timeouts and transport retries are bounded. Invalid responses do not
retry or expose partial candidates. Append-only audit rows retain minimized
digests and validated references without raw prompts, traces or errors, and are
covered by owner export and account deletion. The provider implementation remains
synthetic and performs no network I/O; no feature flag, route, public DTO, UI,
runtime acceptance or live content was enabled.

Validation passed with 528 isolated PostgreSQL integration tests, 789 default
tests (523 opt-in/smoke tests skipped in that separate run), Prisma generation and
schema validation, type-check, production build, ticket-scoped lint/format and
diff checks. Repository-wide lint and format remain pre-existing baselines (13
errors, 63 warnings; 600 unformatted files). Live activation remains blocked on
qualified policy/content sign-off, jurisdiction-specific legal review, a reviewed
provider/model and prompt configuration, measured timeout/retry/token/quality
evidence, operational monitoring and T-1008's later-boundary revalidation and
acceptance work. The required graphify rebuild was attempted, but the local
`graphify` Python module is unavailable.

**T-996 Anthropic-direct provider, 2026-09-25:** the T-1007 constrained provider
boundary had no live endpoint to call — `ApprovedConstrainedGatewayProvider`
(`provider/live-gateway.ts`) POSTed a Steadfast-invented `STEADFAST_CONSTRAINED_JSON_V1`
envelope that neither Anthropic's nor OpenAI's API speaks, and nothing implemented
that contract anywhere in either repo. `provider/live-gateway.ts` is deleted;
`provider/anthropic-provider.ts` (`AnthropicConstrainedProvider`,
`loadAnthropicConstrainedProvider`) calls Anthropic's Messages API directly via
`client.messages.parse` + `zodOutputFormat` for a server-enforced structured-output
schema, built from a deterministic system prompt (the envelope's server-owned
allowed-ID lists and task contract only — never client text) and a minimized user
turn. `@anthropic-ai/sdk` (pinned `0.126.0`) is loaded only through a dynamic
`import()`, so it never enters the synthetic path or a client bundle. Zero-data-
retention/no-training moved from invented request flags to organization-level
attestations (`organizationDataControlsRecordId` names the signed record); the
`runtimeConfiguration.provider` schema now carries `vendor`, `apiBaseUrl`, `effort`
and `pricing` instead of `protocol`/`gatewayUrl`, and the DB-side runtime-
configuration guard trigger was updated to match in the same migration. Every test
injects a fake `AnthropicTransport`; no test performs network I/O and no test
statically imports the SDK. This ticket performs zero real inference — flags stay
OFF and no ACTIVE release exists — the first real call is T-997.

The web/backend now contains A06–A09, A11 reviewer operations, and the shared
A12 provider/UI/reliability work. The native repository contains the corresponding
AI navigation, intake, proposals, logging, review history, settings, exports,
validated swaps and ingredient totals. The original “next: A06” entries below
are historical. A12's independent adjudicated evaluation, live operations and
real-user/staging evidence remain incomplete. Launch G01–G09 are not satisfied.

Read [the engineering release evidence report](evidence/2026-09-14-engineering-release-status.md)
for the current V01–V20 evidence matrix and remaining release work. Do not infer
live readiness from synthetic tests, or enable production AI fixture content.
Both repositories have local checkpoint commits; nothing has been pushed,
deployed, signed for distribution or submitted to App Store Connect.

Current verification: 219 local integration tests, 428 unit tests, 24 native
unit tests and two native UI tests pass. The web browser form harness passes.
Type-check passes; lint remains at its established 14 errors/64 warnings.
Final build results are recorded in the evidence report. Heavy Xcode compilation
and backend verification should run sequentially to avoid resource-driven
5-second test timeouts; use `--maxWorkers=4` for the integration suite.

### T-2000 — bounded autonomy is the only real-client path (2026-09-24)

The mandatory-review model that coexisted alongside the T-1006 deterministic
gate is removed from the run, retry and enrollment paths. What changed:
`requireReviewerCapacity` is no longer called anywhere at runtime (deleted
from `run-command.ts`, `retry-command.ts`, the non-synthetic `ENROLL` branch
of `client-commands.ts`); `requireFixtureRuntime()` is deleted from
`run-command.ts` (already covered by `lockAiClient` + `assertAiCoachOperationEnabled("GENERATION")`)
and from `finalization.ts`'s and `plan-acceptance.ts`'s managed paths; and the
`finalization.ts` synthetic-only fence ("Automatic finalization is limited to
persisted synthetic accounts") is replaced by a new shared resolver,
`lib/ai-coach/runtime-binding.ts`: `resolveAiCoachRuntimeBinding` branches on
`profile.isSynthetic` to either the locked fixture artifact set (`FIXTURE`)
or the sole ACTIVE live release's exact artifact references (`LIVE`), failing
closed to `TEMPORARILY_UNAVAILABLE` (503) when neither applies. Finalization,
acceptance and the constrained-provider boundary (`runRuntimeConstrainedProviderBoundary`)
all consult this one binding instead of branching on `isSynthetic` themselves.

**`reviewerStatus` is inert, not retired.** `managed-executor.ts` keeps
writing `PENDING`/`NOT_REQUIRED` exactly as before; no historical row changes
meaning. What changed is that nothing reads it to authorize a managed
(`validationReport !== null`) row: `plan-acceptance.ts`'s reviewer branch
stays guarded by `candidate.validationReport === null`, and `lib/queries/ai-coach.ts`'s
`automaticApproved` now additionally requires the **current** gate decision
(compared by `evaluationKey`, not `currentGate.id`, since acceptance writes a
fresh gate row on every attempt) to have `outcome === "APPROVE_AUTOMATICALLY"`
and to match the persisted automatic approval's `candidatePayloadHash`. A
reviewer `APPROVED` row on a managed candidate whose fresh gate is HOLD does
not activate it — proven by an isolated-Postgres test. The reviewer queue
(`reviewer.ts`) is unchanged: still fenced to `aiCoachProfile.isSynthetic: true`
plus `requireFixtureRuntime()`, so a reviewer can never see or act on a real
client's candidate.

**Generation binding is a separate ticket (T-2022/T-2039/T-2041).**
`runSnapshotSchema` and `buildInitialFixturePlan` still hard-code the
synthetic literals (`synthetic: true`, the fixture policy/catalog keys), so a
real client's *generated* candidate cannot satisfy the live-bound
`bindingsMatch` check in `autonomy/gate.ts` yet. `requestAiRun` creates a
QUEUED run row for a real client under an ACTIVE release (proven), but the
composer that later turns that row into a candidate —
`processManagedRun`/`buildInitialFixturePlan`/`representFixturePlan`/
`buildWeeklyFixtureReview` — is explicitly fenced: it fails closed with the
terminal reason code `LIVE_COMPOSITION_UNAVAILABLE` for any non-synthetic
profile, before composing anything or writing an `AiPlanVersion` row, until
T-2022/T-2039/T-2041 bind real composition to a live release's reviewed
catalog. Round-1 review of this ticket found the fence missing (generation
was open but composition wasn't fenced, so a real client's run would have
written fixture doses/foods into their own plan history and
`exportAiData`/`/api/client/ai-coach/export` would have paged it back to
them) — fixed and tested
(`tests/integration/ai-coach-live-autonomy.test.ts`, "processManagedRun
fails closed for a real client"). This ticket proves finalize→accept on a
live-bound candidate **seeded directly by the test**, not one that traveled
through generation, exactly as the T-1006 gate's own integration test
already seeds candidates.

**The live-bound proof is a control-flow proof, not a content proof.** The
seeded candidate's one strength exercise still resolves through the
compile-time `EXERCISE_CATALOG_VERSION` catalog module
(`lib/ai-coach/catalog/exercise-catalog.ts`), and `payload.contentKind` stays
the literal `"SYNTHETIC_FIXTURE"` (`plan-contract.ts` pins it) — neither can
be anything else until a real signed catalog can parse (T-2040) and
generation binds to it (T-2022/T-2039/T-2041). Round-1 review also found the
server was stamping every reviewed bundle's required-input and evidence-rule
ids `CONFIRMED`/`SUFFICIENT` unconditionally, which was invisible because the
test bundle only ever declared the two ids the fixture code already
recognizes — fixed: `finalization.ts` now maps any id it cannot actually
verify to `UNKNOWN`, failing closed to `FOCUSED_CLARIFICATION`, and
`tests/integration/ai-coach-live-autonomy.test.ts` covers a bundle with
genuinely non-synthetic ids (not the synthetic set with a flag flipped).

**A live nutrition plan is blocked on T-2003/G01, by design.** The only
honest live happy path this ticket can prove is a **training-only** candidate
(`payload.nutrition === null`): `evaluateNutritionSafety` HOLDs whenever
`projectedWeeklyWeightChangeKg` is null, and inventing that number for a real
person is not something any agent may do. `finalization.ts`'s `LIVE` branch
passes `projectedWeeklyWeightChangeKg: null` (never the synthetic `0`
literal), which fails closed to HOLD the moment a live candidate actually
touches nutrition — T-2003 (prescription engine) plus G01 (signed bundle)
are what supply a real projected rate later. In short: live training and
live nutrition both stay impossible in production until
T-2040/T-2041/T-2039 (generation/catalog binding) and T-2003+G01 (a real
projected rate) land — this ticket only proves the *authorization* control
flow that those tickets will run through.

**Contract:** no REST shape change; `GET /api/client/ai-coach/workspace`
keeps `schemaVersion: 1`, the same five `status` values and the same four
`authorization` fields. `checkPolicyVersionUsable` gained one optional,
backward-compatible parameter (`runtimePolicyArtifactKey`) — omitted, it is
byte-identical to before. iOS needs no change.

Gate evidence: `pnpm exec vitest run tests/unit/ai-coach-runtime-binding.test.ts
tests/unit/ai-coach-catalog.test.ts` (26/26); `SECURITY_INTEGRATION=1 pnpm exec
vitest run tests/integration/ai-coach-live-autonomy.test.ts
tests/integration/ai-coach-plan-acceptance.test.ts
tests/integration/ai-coach-end-to-end-governance.test.ts
tests/integration/ai-coach-run-command.test.ts
tests/integration/ai-coach-retry-command.test.ts
tests/integration/ai-coach-client-commands.test.ts
tests/integration/ai-coach-managed-executor.test.ts
tests/integration/ai-coach-weekly-trajectory.test.ts
tests/integration/ai-coach-beginner-workflow.test.ts
tests/integration/ai-coach-live-launch-readiness.test.ts
tests/integration/ai-coach-autonomy-gate.test.ts --maxWorkers=1
--no-file-parallelism` (109/109, round-2 review fixes above included);
`pnpm run type-check` and `pnpm exec eslint` on every changed file. No flag
is enabled by this change; every real-client call still fails closed at
`lockAiClient` while no live release is ACTIVE.

## Codex takeover correction — A10 acceptance boundary (2026-09-13)

Before starting A06 UI, direct PostgreSQL regressions disproved the previous
claim that conditional candidate status updates alone serialized acceptance.
Nine newly added cases failed against the handoff implementation. A different
candidate could activate against the same base, caller revision fields were
ignored, inactive callers could invoke the service, and replay could either
fail or return an old plan as current. Concurrent receipt-key reuse could also
throw a unique-constraint error.

The correction moves all checks, receipt handling and writes into one short
transaction. It locks the persistent User, context, profile and owned candidate,
then the relevant approval/entitlement/grant rows, before checking current
permission. An explicit conditional active-pointer update adds a final guard.
It checks all four caller revisions, uses permanent `acceptedAt` for historical
replay, and returns `activeVersionId: null` when no active pointer exists.
The REST boundary maps the service's active-account rejection to HTTP 403.

**Scope: acceptance concurrency and replay, not completion of the entire AI
Coach product.** A06 remains next. The broader plan payload/source-reference
validation, real review-window/cumulative policy implementation and qualified
review operations remain dependent on A06/A08/A09/A11. Other authority and
safety writers still need review against doc 05's common serialization order;
this correction does not claim to repair all their internal races. Flags remain
unchanged and default OFF. No real recommendations or live policies added.

Changed files: `lib/ai-coach/plan-acceptance.ts`, the accept REST route,
`tests/integration/ai-coach-plan-acceptance.test.ts`, `prisma/schema.prisma`,
`prisma/migrations/20260914000100_nullable_acceptance_current_pointer/migration.sql`,
and this handoff. No native iOS code changed; it shares this backend boundary.

The additive migration drops NOT NULL from the receipt's audit-only current
pointer, so replay after pointer removal can record its actual absence. It was
executed **only against local `127.0.0.1:5432/steadfast_security_test`** using
`prisma db execute --file`; no Neon/dev/production database was migrated.
Apply the tracked migration through the normal deployment workflow before
shipping the changed backend. Existing receipts remain intact. Rollback is
application-only; keep the compatible nullable column and all receipts/slots.

Verification after the correction:

- Type-check: passed.
- Full isolated integration suite: **149/149 passed**, including **38 A10 tests**.
  Four new concurrency cases wait for an actual PostgreSQL blocking dependency
  before committing safety/context/entitlement/deactivation changes.
- `pnpm test`: **392 passed, 153 skipped** (opt-in integration/smoke cases).
  Integration tests were separately executed above; live smoke was not run.
- `pnpm lint`: established **78 problems (14 errors, 64 warnings)**; no increase.
- `pnpm run build`: passed.
- Prisma generate and schema validate: passed.
- Browser/Playwright/native build: not run; no UI/native changes in this slice.
- Required graphify rebuild attempted; unavailable (`ModuleNotFoundError: graphify`).
  Existing graph output was not regenerated.

## A06a — deterministic contract and initial fixture composition

Local implementation adds `plan-contract.ts`, `canonical-json.ts`,
`review-window.ts`, `initial-plan.ts`, and ten unit cases. Strict payloads
reject unknown catalog IDs/modalities/fields and duplicate session/day IDs.
Synthetic initial macro and meal representations share targets; missing
measurements or unsupported food constraints leave nutrition unavailable.
Canonical hashes survive JSONB key reordering. Review windows use local
calendar Mondays and pass 167/169-hour DST fixtures. This is the pure engine
sub-slice; durable generation and UI are still next. No flags or live content
changed. Also scoped the storage-cleanup integration assertion to its own
fixture after the full suite exposed contamination from concurrently created
rows. Verification: type-check/build pass, 149 integration and 402 unit tests
pass, lint stays 78 problems. No schema change in this sub-slice.

The post-commit graphify hook successfully rebuilt the graph using its own
installed Python runtime; the earlier default-python failure does not block it.

## A06b — durable managed-run requests

Added `access.ts` and `run-command.ts`: explicit nonproduction fixture mode,
server-designated synthetic accounts, active account/entitlement/provider checks,
immutable input snapshots, permanent owner/operation/request-key receipts,
server-derived business deduplication and bounded daily creation. Client input
cannot select owner, revisions, snapshots or retry generations. Eleven new real
PostgreSQL cases cover races, replay, fail-closed flags and receipt purge.
Migration `20260914000200_ai_managed_run_contract` was executed only on the
local disposable database; live environments remain untouched. No schema/data
backfill and no account was marked synthetic outside test fixtures. Verification:
160 integration + 402 unit tests pass, type-check/build/schema validation pass,
lint remains 78 problems. Execution/proposal-read/UI wiring is the next slice.

## A06c — managed execution and shared permitted reads

Managed runs now call the provider outside transactions and atomically save a
strictly validated candidate plus terminal result after rechecking lease,
authority, revisions, active base and safety. Initial candidates always enter
PENDING review. `getAiWorkspace` is the common web/native reader: it hides
unapproved numerical content, follows the active pointer and removes paused
domains. Managed acceptance verifies canonical content integrity and test-only
runtime/account status. Provider timeout timers are cleared after settlement.
Five PostgreSQL cases cover publication visibility, late output and domain
filtering. Verification: 165 integration + 402 unit tests, type-check/build pass,
lint baseline unchanged. No additional migration. Initial engine flow is wired;
intake/HTTP/UI and non-initial run kinds remain in progress.

## A06d — intake commands and protected HTTP transport

Added shared client commands for draft/confirm, independent safety/allergy
reports, explicit enrollment consent, fixed review timezone and pause. Existing
intake/safety implementations can join the command transaction rather than
opening nested transactions. Relevant changes invalidate pending work. Safety
reports are not blocked by unrelated stale/invalid form fields and cannot clear
restrictions. The versioned workspace, run-request and command APIs apply
verified identity, same-origin cookie mutation checks, byte limits, quotas,
private no-store responses and safe error envelopes. Tests cover resumable
intake, consent, key conflicts, urgent/allergy handling and HTTP boundaries.
Verification: 170 integration + 402 unit tests pass, type-check/build pass,
lint unchanged. No schema change. Client UI is next.

## A06e — initial client screens

Added the authenticated AI route family and shared client experience/plan
renderer: intake, explicit enrollment, actual run progress, pending/ready/stale
proposals, accepted nutrition/strength/cardio, review history and pause settings.
Mutation failures retain in-memory inputs and reuse operation keys for uncertain
retries; no health form data goes into browser local storage. Accept/decline now
use the same protected HTTP envelope and origin/body/quota controls. Three
rendering tests verify provider labeling, unanswered safety fields and hidden
unapproved instructions. A standalone synthetic UI fixture was inspected in
Chromium at 390px: no horizontal overflow and all measured inputs/selects were
18px with 54px height. This is UI-fixture verification, not an authenticated
end-to-end run of the deployed app. Verification: 170 integration + 405 unit
checks, type-check/build pass, lint baseline unchanged. Reviewer operations,
non-initial generation, logging and provider-aware main navigation remain next.

## A11a — scoped reviewer service

Pulled reviewer operations forward to complete the initial vertical path.
Reviewer grants now require explicit client assignments and domain capabilities;
ordinary coach status, self-review, revoked grants and inactive reviewers cannot
authorize a decision. Approval binds exact content plus policy/catalog/source
references and revisions. Shared participant reads and acceptance recheck this
binding and current capability. Queue reads are case-scoped, bounded and report
backlog/capacity. Purge removes deleted client IDs from assignments.
Migration `20260914000300_reviewer_case_scope` is local-test-only so far. Seven
new PostgreSQL cases pass; full totals 177 integration and 405 unit tests;
type-check/build/schema validation pass, lint remains 78 problems. No real
reviewer grants or qualification records were created. Reviewer UI/API next.

## A11b — reviewer API and workspace

Added `/ops/ai-coach` and its protected API for bounded assigned queues,
backlog/oldest-pending display, exact-state approve/reject and retained rationale
on transient failure. Non-client reviewers are supported without weakening
capability checks; one additional HTTP case verifies this and ordinary-coach
denial. Plan renderers now have unique accessible heading IDs. Verification:
178 integration + 405 unit tests, type-check/build pass; lint unchanged.
No actual staffing or reviewer qualification is asserted by this tooling.

## A07a — meal representation and checked substitution engine

Macro/meal switching and allowlisted equivalent substitutions now produce new
immutable TARGET_PRESERVING proposals through the durable executor. The same
prescription, targets and training are retained; meal totals and current food
constraints are rechecked at composition, read and acceptance. A no-op or
infeasible composition produces a HOLD result without a candidate. Fixture food
catalog v2 adds one explicitly synthetic equivalent; the six unchanged v1
records remain readable and the new item is not available retroactively in v1.
Five unit cases plus a PostgreSQL activation trajectory pass. Full verification:
179 integration + 410 unit tests, type-check/build pass, lint unchanged. No
migration. Representation/swap controls in the UI are next; this remains
synthetic content, not reviewed meal adequacy or real cooking guidance.

## A07b — meal presentation and substitution controls

Accepted plans now offer presentation-change requests and curated ingredient
swap proposals; proposal/reviewer views remain read-only. Prepared weekly
quantities stay separate from unverified purchase weights. One rendering case
verifies actionable-only swap controls. Verification: 179 integration + 411 unit
tests, type-check/build pass, lint unchanged. No schema change.

## A08a — structured private check-in observations

Added revisioned AI observation records, draft/submit ingestion through the shared
check-in facade, and owner-scoped HTTP reads/writes. Explicit completeness,
nullable measurements with units, recovery, barriers and concern answers are
retained without converting unknowns to zero. Storage is separate from legacy
human check-ins so a later human relationship cannot implicitly expose AI health
history. Replays are bound to keys/digests; relevant corrections/late evidence
invalidate pending work while ordinary later logs do not. Explicit concern
handling commits independently of unrelated validation failures. Five new DB
cases pass; totals 184 integration + 411 unit tests; type-check/build/schema
validation pass, lint unchanged. Migration `20260914000400_ai_observation_records`
was applied only locally. Session storage and observation UI remain next.

## What's built and verified (Phase F + Phase A: F00–F08, CB11, A01–A05, A10)

Commits, oldest to newest (`git log --oneline` on `main`):

| Commit    | Slice   | One-line outcome                                                                                                                                                                                  |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2ace11a` | F00     | Reconciled contradictory repo instructions (pnpm, Vitest exists, migration workflow, design overrides).                                                                                           |
| `cbd9f0e` | F01     | Closed the deactivated-account authorization bypass (CB02).                                                                                                                                       |
| `e654a4c` | F02     | Consent-bound coach/client linking — coach-entered contact info can never grant access; added `ClientCoachingContext` (CB01).                                                                     |
| `c64074f` | F03     | Scoped private messages to a specific coach conversation, not client-wide (CB03).                                                                                                                 |
| `6a784cf` | F04/F05 | Published meal plans and training programs are immutable; editing forks a new draft (CB04/CB05).                                                                                                  |
| `61d5b6d` | F06     | One unified check-in service shared by web action and iOS REST route (CB07).                                                                                                                      |
| `d92f406` | F07     | Truthful adherence/exercise-session logging — missing ≠ zero (CB08).                                                                                                                              |
| `3a5e7e8` | F08     | Durable storage-cleanup outbox; decoupled reminder/purge cron sweeps (CB09/CB12).                                                                                                                 |
| `02325a8` | CB11    | Stripe webhook event-ordering fix (existing billing, unrelated to new checkout).                                                                                                                  |
| `580dc50` | A01     | `ClientCoachingContext` single-provider authority, `AiCoachProfile` identity, `AiCoachEntitlement`, default-OFF flags (`lib/flags/ai-coach.ts`).                                                  |
| `d6152e4` | A02     | `AiCoachRun`/`AiPlanVersion`/`AiAdjustmentSlot`/`AiWorkoutSession`/reviewer-grant schema and lifecycle (`lib/ai-coach/runs.ts`, `plan-lifecycle.ts`).                                             |
| `3278ea2` | A03     | Staged intake draft/confirm and safety-disclosure service (`lib/ai-coach/intake.ts`, `safety.ts`).                                                                                                |
| T-2024    | A03v2   | Intake v2 (web): versioned schema (`intakeAnswersSchema` stays the permissive read/compat shape, `intakeV2ConfirmSchema` is the v2 write shape), structured allergens (`lib/ai-coach/intake-allergens.ts`), two-shape `ALLERGIES` command, five-stage wizard (`components/ai-coach/intake-wizard.tsx`). `schemaVersion` stays `1`; new `intakeSchemaVersions: [1,2]` capability field.                |
| `1f7174f` | A04     | Versioned food/exercise catalog loaders, nutrient totals, feasible-composition checks (`lib/ai-coach/catalog/`, `nutrition-totals.ts`, `composition-feasibility.ts`, `policy/policy-version.ts`). |
| `fc545e7` | A05     | Durable job executor + provider adapter, all synthetic (`lib/ai-coach/executor.ts`, `provider/`, `run-status.ts`), authenticated cron route.                                                      |
| `c4f6fe1` | A10     | Full atomic proposal acceptance/decline service — the policy/safety/entitlement/reviewer-gated gate A02 explicitly deferred (`lib/ai-coach/plan-acceptance.ts`).                                  |

A10 was pulled ahead of A06–A09 on purpose: doc 08 states A06 depends on
A10's fixture-tested acceptance service, and that dependency is
"intentionally acyclic" the other way — building A10 first means A06 has
something real to call instead of a stub.

**T-503 (2026-09-24):** A05's cron route is now actually scheduled — `vercel.json` registers
`/api/cron/ai-coach-executor` daily at `04:05 UTC` (`5 4 * * *`), with `maxDuration = 180` (135s
provider ceiling for 3 sequential claims + 45s validation/persistence/reconciliation headroom) and
`runtime = "nodejs"` declared explicitly on the route. The sweep stays a complete no-op — zero
database access — while `FEATURE_AI_COACH_GENERATION` is unset, which is every environment today.
`vercel.json` also gained a second, independent daily drain pass for `/api/cron/purge-deleted-accounts`
at `04:00 UTC`, alongside its existing 19:00 piggyback inside `checkin-reminders` (F08, unchanged). A
fourth `vercel.json` entry is reserved for T-998's alert evaluator.

**A03v2 release-packet note (T-2024 review round 3, MINOR 6):** the
fail-closed sentinel `UNVERIFIABLE_ALLERGEN_STATUS_NOT_CONFIRMED`
(`lib/ai-coach/intake-allergens.ts`, exported as
`UNVERIFIABLE_ALLERGEN_STATUS_SENTINEL`) can reach a real client screen.
`getAiWorkspace` returns `confirmedIntake`/`draft` raw, and the shipped
pre-T-2025 iOS build renders `allergies` into its v1 intake form's
free-text field — so a client with a v2 profile whose allergen status is
DECLINED/UNKNOWN can see this literal string in the Allergies box on an
old app build until that build is replaced by T-2025. Degraded, not
crashed: any attempt to edit or confirm from that stale state is rejected
by the v1 `ALLERGIES`/`CONFIRM_INTAKE` guards
(`lib/ai-coach/client-commands.ts`). No fix is planned on the projection
itself — the sentinel must keep failing closed, and T-2004 must never
"clean" it out of the derived array by treating it as a real category.

### File manifest — `lib/ai-coach/`

```
lib/ai-coach/
  runs.ts                      A02  Run lifecycle: claim/checkpoint/complete/fail/cancel/reconcile/retry
  plan-lifecycle.ts             A02  Storage-level plan version + adjustment-slot primitives (test/internal use only — see plan-acceptance.ts)
  intake.ts                     A03  saveIntakeDraft / getIntakeDraft / confirmIntake — server-only (imports `db`); re-exports everything from intake-contract.ts for existing callers
  intake-contract.ts            T-2024  intakeAnswersSchema / intakeV2ConfirmSchema / isV2Intake / every v2 enum+object schema / PENDING_G01_WORDING — client-safe leaf (zod only, no `db`/Prisma import), so `components/ai-coach/intake-wizard.tsx` can import it without pulling `pg` into the browser bundle (T-2024 review round 4 production-build fix)
  intake-allergens.ts           T-2024  deriveLegacyAllergyTokens / deriveLegacyDietaryRestrictions / canonicalDeclarations (single writer of the legacy allergies/dietaryRestrictions projections)
  safety.ts                     A03  submitSafetyDisclosure / clearSafetyRestriction
  catalog/schema.ts             A04  Zod shapes for FoodItem / ExerciseItem (SYNTHETIC)
  catalog/food-catalog.ts       A04  8-item SYNTHETIC food fixture (food-fixture-v2; 6 retained under LEGACY_FOOD_CATALOG/food-fixture-v1, T-2024 adds a shellfish-tagged item to v2 only)
  catalog/exercise-catalog.ts   A04  3-item SYNTHETIC exercise fixture
  catalog/loader.ts             A04  getFoodItem / getExerciseItem (id+version lookup, rejects unknown/stale)
  catalog/fdc/allowlist-schema.ts T-2035 Allowlist and coverage plan schemas with unique ID and name validations
  catalog/fdc/normalize.ts      T-2035 Pure normalization of USDA FoodData Central records without guessing or defaulting
  catalog/fdc/allergen-rules.ts T-2035 Fail-closed allergen rules across 9 frozen categories; emits PRESENT or UNKNOWN only (VERIFIED_ABSENT needs positive record evidence, which FDC cannot supply). Matches the food's own name/synonyms with generated plurals, never the USDA foodCategory
  catalog/fdc/mapping.ts        T-2035 Pure FDC record to SourcedFoodCatalogItem mapper, derivation/energy method tables, URL redaction. Macro lookup keys on FDC nutrient NUMBERS ("208"/"958"/"957"/"298"), never nutrient ids
  catalog/fdc/source-exclusions.ts T-2035 The ingestion tool's own record of entries it cannot map. A SOURCE LIMITATION, never a review decision; reviewState stays the RD's field
  policy/policy-version.ts      A04  checkPolicyVersionUsable (SYNTHETIC single active version + one revoked version)
  nutrition-totals.ts           A04  computeNutrientTotals / aggregateGramsByFood
  composition-feasibility.ts    A04  checkMealComposition — closed reason-code registry
  provider/adapter.ts           A05  ModelProvider interface, timeout wrapper
  provider/synthetic-provider.ts A05 Synthetic-only constrained provider — no network I/O, ever
  provider/anthropic-provider.ts T-996 Direct Anthropic Messages API constrained provider (dynamic SDK import only)
  provider/constrained-boundary.ts T-1007 runConstrainedProviderBoundary — the only writer of AiAutomaticPlanApproval.providerSelection
  provider/explanation-prose.ts T-2006/T-2030 Pure validateExplanationProse — the only authority on bounded model prose (no db/fetch/env/Date)
  provider/spend-limits.ts      A05  Rate limit (real) + token ceiling (safety backstop, not real pricing)
  executor.ts                   A05  runExecutorSweep / processClaimedRun
  run-status.ts                 A05  getRunStatusForClient — safe minimized DTO
  plan-acceptance.ts            A10  acceptPlanVersionAtomic / declinePlanVersion — THE real acceptance service
  acceptance-notifications.ts   T-502 drainAcceptanceNotifications — bounded outbox drain phase in runExecutorSweep
```

### Routes

```
app/api/cron/ai-coach-executor/route.ts             A05  authenticated sweep trigger — scheduled hourly at :05 UTC (T-503), maxDuration=180, no-op while flag unset
app/api/client/ai-coach/runs/[runId]/route.ts        A05  safe run-status read
app/api/client/ai-coach/plans/[id]/accept/route.ts   A10
app/api/client/ai-coach/plans/[id]/decline/route.ts  A10
```

No UI/pages exist yet for any of this — A06 is the first slice that needs a client-facing page (per doc 08, "progress/proposal view").

### Feature flags (all default OFF — `lib/flags/ai-coach.ts`)

| Env var                        | Gates                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `FEATURE_AI_COACH_ENROLLMENT`  | Whether a client may enroll in AI coaching at all.           |
| `FEATURE_AI_COACH_GENERATION`  | Whether `runExecutorSweep` claims/processes anything.        |
| `FEATURE_AI_COACH_PUBLICATION` | Whether `acceptPlanVersionAtomic` will activate a candidate. |

None of these are set anywhere in this repo's env files. Turning one on
without the corresponding real content/policy (gates G01/G02/G05) would let
a synthetic fixture reach a real user — don't.

### Test coverage

```
tests/integration/ai-coach-context.test.ts          A01  (13 tests)
tests/integration/ai-coach-runs-plans.test.ts        A02  (16 tests)
tests/integration/ai-coach-intake-safety.test.ts     A03  (18 tests incl. T-2024 v2 confirm cases)
tests/unit/ai-coach-catalog.test.ts                  A04  (18 tests, no DB needed)
tests/integration/ai-coach-executor.test.ts          A05  (17 tests)
tests/unit/cron-schedule.test.ts                     A05  (4 tests, no DB needed — pins vercel.json + route segment config, T-503)
tests/integration/ai-coach-plan-acceptance.test.ts   A10  (38 tests after takeover correction)
tests/integration/account-deletion.test.ts           purge coverage extended at every slice
```

Full integration suite (`SECURITY_INTEGRATION=1` against the local
disposable Postgres): **136/136 passing** as of `c4f6fe1`. Full unit/smoke
suite: **392 passing**. Lint baseline: **78 problems (14 errors, 64
warnings)** — all pre-existing, none in any AI Coach file. Production build
clean.

## Standing conventions the next agent must keep following

1. **Verify every slice with the same four gates**, in this order, all
   passing before committing:

   ```bash
   pnpm run type-check
   SECURITY_INTEGRATION=1 DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" pnpm exec vitest run tests/integration/
   pnpm test                     # unit + smoke
   pnpm lint                     # diff against the last known-good count: 78 problems, 14 errors, 64 warnings
   pnpm run build
   ```

   Run type-check _again_ after writing test files, not just after
   implementation files — `vitest run` doesn't type-check, and `tsc` errors
   in a test file only surface at the build step otherwise (this bit A02).

2. **Migration workflow** (never `prisma migrate dev` against Neon,
   never a raw untracked SQL change):

   ```bash
   # edit prisma/schema.prisma, then:
   pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   # hand-copy the output into prisma/migrations/<timestamp>_<name>/migration.sql
   pnpm exec prisma migrate deploy   # applies to the real Neon dev DB
   pnpm exec prisma generate
   ```

   The repository's pre-ledger history is formalized at
   `prisma/baselines/20260915000000_legacy/`. To prove the complete ledger
   from a fresh database, create an empty local database whose name starts
   with `steadfast_migration_replay_` and run `pnpm run prisma:replay` with
   its explicit `DATABASE_URL`. The command checksum-verifies and resolves
   the 66 preserved legacy migrations, deploys every later forward migration,
   verifies the raw-SQL invariants and requires zero schema diff. It rejects
   remote or non-empty targets. Do not use `prisma db push` to substitute for
   migration replay.

3. **Postgres enum values**: `ALTER TYPE ... ADD VALUE` cannot be used in
   the same transaction that then references the new value in a data
   backfill — split into two migrations when this comes up.

4. **Synthetic-fixture discipline**: any new numeric threshold, food,
   exercise, or policy content must be commented as SYNTHETIC/FIXTURE and
   tied to the relevant G0x gate in `13-Sources-and-Open-Decisions.md`.
   Never let a fixture look authoritative.

5. **No network I/O inside `db.$transaction`** — established since F-phase,
   load-bearing for A05's executor (provider call happens strictly between
   two non-transactional conditional updates).

6. **Concurrency correction**: candidate-status guards alone do not serialize
   two different candidates or concurrent authority changes. A10 now uses
   explicit User-first row locks and all checks inside the transaction, plus
   a conditional active-pointer update. Follow doc 05's common lock order for
   related writers. Do not restore the previous check-outside-transaction
   pattern; the takeover regressions demonstrate its failures.

7. **Test DB contamination is real**: `AiCoachRun`/`AiPlanVersion` etc. rows
   from earlier test runs persist in the local test DB (no truncation
   between runs, and integration test files run with real parallelism
   against the same physical database). A05's executor tests hit this
   directly — a global, unscoped query like `findMany({where:{status:
"QUEUED"}})` can and will pick up leftover rows from other test files or
   earlier runs today. Fix pattern used in `executor.ts`: split "claim a
   batch" (which legitimately must see the whole table) from "process one
   already-claimed run" (which tests can call directly per-run, sidestepping
   contamination entirely). Reach for the same split if a new
   global-selection query needs deterministic testing.

8. **Gates G01–G09 are out of scope for a coding agent.** They require a
   named human owner and a real artifact (reviewed clinical policy, staffed
   pilot capacity, legal/privacy sign-off, evaluated provider pricing,
   etc.) — see `13-Sources-and-Open-Decisions.md`. Every slice so far has
   built the _engineering_ around these gates (schema, checks, flags,
   synthetic fixtures) without guessing the content the gates are supposed
   to supply. Keep doing that: implement the mechanism, never the number.

## What's left

Recommended order per doc 08: **A06 → A07/A08 → A09/A11 → A12**, then the
Launch-phase items (L01/L02, P01–P03) which are explicitly gated on real
G0x artifacts, not more code.

### A06 — Internal initial macro + strength/cardio vertical slice

_Dependencies met: A03, A04, A05, A10 all exist._

Doc 08: "Deterministic initial prescription and reviewed template
selection, bounded model explanation, validated candidate, progress/
proposal view and shared client plan. No human assignment; explicit target
units; typed training/cardio; reject catalog hallucination. This is an
internal milestone, not complete meal MVP."

This is the first slice that:

- Actually creates an `AiPlanVersion` candidate from a client's confirmed
  intake (A03) using A04's catalog/feasibility functions, and runs it
  through A05's executor with the `SyntheticFixtureProvider` (or a slightly
  less trivial synthetic provider that echoes back a structured but still
  non-clinical candidate — do not invent real prescription logic; a
  deterministic _placeholder_ numeric target is fine as long as it's
  clearly synthetic, since G01 blocks anything claiming to be real).
- Needs a client-facing page/route to view the proposal and call A10's
  accept/decline routes — the first actual UI work in this whole backlog.
  Check `design-system/steadfast/pages/ai-coach.md` for the override rules
  (permanent dark mode, macros ARE shown in AI mode unlike human-coach
  mode) before writing any component.
- `reviewWindowKey` is currently derived by a placeholder ISO-week function
  in `plan-acceptance.ts` (`reviewWindowKeyFor`) — A09 is supposed to own
  real server-derived activation windows; A06 can keep using the
  placeholder but should not scatter a second copy of window logic.

### A07 — Curated meal mode

_Dependencies: A04, A06._

Deterministic weekly composition, practical quantities, approved
substitutions, grocery aggregation (`aggregateGramsByFood` in
`nutrition-totals.ts` already gives raw per-food gram totals — A07 turns
that into practical purchasable quantities, which A04 explicitly left
undone). Mode switch (macro ⇄ meals) must keep exactly one prescription
active, never two. T-2035 provides the offline USDA FoodData Central ingestion
tool (`scripts/ai-coach-ingest-fdc.ts`) and the pure mapping modules it drives,
with mechanical tri-state allergen facts across the 9 frozen major categories.
The allowlist (`data/ai-coach/catalog/fdc-allowlist.v1.json`) and the
`DRAFT_UNSIGNED` catalog artifact
(`lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.v1.json`) are
**committed outputs of a real operator run** against the live API on 2026-09-26
(`board/evidence/T-2035-real-run.md`); the hand-written versions shipped in
1ec2588 were fabricated and were deleted (`board/evidence/T-2035.md`). They are
never hand-edited after a run: a wrong field is fixed in the code and the run
repeated. A record the tool cannot map is written to
`data/ai-coach/catalog/fdc-source-exclusions.v1.json` by the tool itself, which
records a source limitation and never a review decision — `reviewState` has
exactly one writer, the RD. `VERIFIED_ABSENT` requires positive evidence in the source record,
which no Foundation or SR Legacy record can supply, so ingestion emits only
`PRESENT` or `UNKNOWN` and `UNKNOWN` fails closed downstream. **A09/A07 must
read `allergenFactsV2`, not `allergenFacts`:** the legacy struct cannot express
`UNKNOWN`, so a SOURCED_V2 item carries none and the schema rejects one that
does. See `docs/ai-coach/catalog/README.md`.

T-2016 then deleted `singleIngredientWholeFood` from the allowlist entry (it was
an unverified `true` on every entry with no reader left) and made `categoryId`
and `patternTags` derived from the record's own USDA `foodCategory` in
`lib/ai-coach/catalog/fdc/curation.ts`, with the basis recorded on the entry and
machine-written `triageFlags` for the restaurant/candy/babyfood/industrial-oil
search hits. **All three are engineer-proposed scaffolding until the RD review**
(README §2.2). `patternTags` fails closed to `["OMNIVORE"]` whenever the category
does not unambiguously establish the pattern set, and the record's own
description can then only *narrow* the set further (never widen it), which is
what keeps `Spinach souffle` out of a vegan client's catalog. So **A07/T-2036 must treat an
empty pattern-filtered result as "nothing is tagged for this pattern yet" and
degrade — never as "no foods exist", and never by rendering an empty screen**
(`board/strategy/release-safety.md`). Nothing reads `patternTags` today.

### A08 — Minimal structured weekly observations and session logs

_Dependencies: F06/F07 (done), A02/A03 (done)._

Shared check-in service extension, typed session IDs, cardio results.
`AiWorkoutSession` (A02) already has the schema shape
(`clientEventId`-keyed, independent repeated sessions); this slice is
about the actual logging UI/API and the observation-completeness tracking
that A09's controller will read.

### A09 — Coordinated weekly controller

_Dependencies: A04–A08 (A08 not yet built)._

This is the biggest remaining piece — the actual weekly decision procedure
(doc 08's "A09: the actual weekly decision procedure" section, 6 steps).
It owns:

- Real server-derived activation windows (replacing A10's placeholder
  `reviewWindowKeyFor`).
- Evidence-sufficiency determination from A08's observations.
- The deterministic HOLD/SIMPLIFY/ADJUST/CLARIFY/PAUSE_REFER decision.
- Cumulative policy-bound limit checks that A10 explicitly deferred here
  (search `plan-acceptance.ts` for the comment on this).

Needs A08 first. Do not attempt to shortcut this by inventing a simplified
decision rule — doc 08 requires "a supported nutrition adjustment from
shipped inputs and multiple weeks of noisy/missing evidence" as actual
test evidence (V12/V13/V15/V16/V19), which means the sufficiency logic has
to be real, even if the underlying clinical thresholds stay synthetic.

### A11 — Actual pilot reviewer operations

_Dependencies: A05, A10 (both done)._

Restricted reviewer queue/view/decision endpoint. The data model
(`AiCoachReviewerGrant`, `AiPlanReviewerApproval`) and the _consumption_
side (A10's acceptance service already checks `reviewerStatus`/
`approvedHash`/grant revocation) are done — A11 is the _production_ side:
an endpoint a grant-holder uses to actually approve/reject a specific
candidate, hash-bound, with backlog/capacity controls. This could
plausibly be started now in parallel with A06–A09 since its dependencies
are already satisfied — flagged as available "early start" work if the
next agent wants to parallelize.

Note doc 08's explicit caution: "A technical queue is not a staffing
commitment" — this is infrastructure, not a claim that gate G04 (qualified
pilot capacity) is resolved.

### A12 — Integrated evaluation and usability-ready build

_Dependencies: A06–A11, remaining relevant F repairs._

Last slice. Provider-aware home/navigation, `/client/ai-coach/reviews`
list/detail, offline/error states, model holdouts, end-to-end tests,
operational dashboards. Needs everything above done first.

### Launch phases (L01/L02, P01–P03)

Not code-blocked — blocked on real G0x artifacts (qualified policy review,
staffed pilot, legal/privacy sign-off, evaluated model pricing). Doc 08's
table lists exact entry gates. Do not attempt to satisfy these with more
engineering; they require a named human decision-maker producing a real
artifact.

## If you are Codex picking this up

Read `00-Start-Here.md` → `03-Codebase-Audit.md` → `05-API-and-State-
Contracts.md` → `08-Implementation-Backlog.md` first if you haven't
already, then this file, then the specific domain doc for whichever slice
you're picking up (06 for policy/AI behavior, 07 for UX, 09 for the exact
verification IDs). The `lib/ai-coach/*.ts` files themselves carry detailed
doc-comments tying each function back to the specific doc section and
decision it implements — they're written to be self-explanatory continuation
points, not just implementation.

Start with `git log --oneline` and `git status` to confirm you're seeing
the same state this file describes before trusting anything above it —
this is a snapshot, and the repo may have moved on.

## A08b — typed activity evidence (2026-09-14)

Added owner-scoped strength-set and cardio observations against accepted typed
plan prescriptions. Repeated workouts have explicit instance IDs. Request/event
identity, immutable workout identity, and set uniqueness prevent retries from
overwriting another session. Corrections use revisions and invalidate referenced
review evidence. Missing, partial, skipped and completed activity remain distinct;
bodyweight zero and assisted/external units are retained, and cardio has no fake
strength load. A pain concern independently pauses advice even if other fields
are invalid. Reads expose only the client's typed records.

Migration `20260914000500_typed_ai_sessions` was applied only to the disposable
local test database; existing legacy rows remain compatible. Type-check, build,
Prisma validation, 189 integration and 411 unit tests pass. Lint remains the
established 14-error/64-warning baseline. Activity UI and weekly source snapshots
are subsequent slices; this is not a live coaching release.

## A09a — immutable review inputs and source freshness (2026-09-14)

Weekly requests freeze eight weeks of submitted private observations and typed
sessions, plus retained accepted plan history. Bounded snapshots preserve dates,
units, missingness, source revisions and canonical content digests. Oversized
inputs fail explicitly rather than silently truncating evidence. Worker commit,
proposal visibility, qualified review and atomic acceptance recheck owned source
rows, including their content and deletion state; a stale epoch counter cannot
conceal an edited source. Relevant late evidence invalidates the full frozen
lookback. No numerical weekly controller is claimed by this slice.

Type-check, production build, 194 integration tests and 411 unit tests pass.
Full lint remains 78 baseline problems; changed files have no lint findings.
No migration or live environment change in this slice.

## A09b — coordinated weekly controller (2026-09-14)

Implemented a deterministic, versioned SYNTHETIC weekly policy with meaningful
HOLD, CLARIFY, SIMPLIFY, ADJUST and PAUSE_REFER outcomes. The fixture controller
uses three consecutive weeks of shipped structured inputs, explicit measurement
units/comparability, missingness, barriers and recovery; notes cannot choose
numbers. Strength/cardio progression additionally requires complete typed
prescribed sessions. It filters evidence predating the current material
prescription, changes at most one intensifying domain, validates practical meals,
and checks retained history, cooldowns and cumulative limits. Schedule changes
use the same ROUTINE slot. No physiological cause, exact food intake or calorie
expenditure is inferred. All constants remain synthetic, gated off for real use.

Weekly proposals require qualified review. Their source-bound snapshot and exact
deterministic output are re-derived at review, client visibility and acceptance;
relabeling a change as protective cannot waive these checks. Database trajectories
exercise observations through generation, approval, concurrent acceptance and
post-approval source deletion. Type-check/build pass; 197 integration and 424 unit
tests pass; lint remains 14 errors/64 warnings. No live migration/deployment.
The check-in and activity UI, operational resolution/capacity and provider-aware
web/native integration still need completion; clinical gates remain external.

## A08c — usable evidence forms and correction/deletion (2026-09-14)

Added structured check-in and strength/cardio forms, resumable server drafts,
revisioned corrections, explicit date/units/completeness, separate concern saves,
and repeated workout/set controls. Concerns save before unrelated client form
validation. No health answers are written to local storage. Uncertain saves retain
request/event identity; next sets retain workout identity and receive new events.
Deletion requires an explicit current-record confirmation, tombstones/scrubs the
source, invalidates referenced proposals and never clears safety restrictions.
The UI explains that prior review snapshots follow account retention.

Type-check/build, 199 integration and 424 unit tests pass; lint stays at its
14-error/64-warning baseline. `pnpm exec node tests/browser/ai-coach-evidence.mjs`
exercises real React controls with a synthetic HTTP boundary: draft reload,
uncertain retry, correction, missing weight, concern despite invalid date,
consecutive typed sets and 390px layout. Screenshots were visually inspected at
`/private/tmp/steadfast-evidence-qa/`. This is not an authenticated production E2E
or clinical usability study. All changes remain local and fixture-gated.

## A12a — shared provider and current-plan contract (2026-09-14)

Added one provider resolver and private no-store `/api/client/coaching-context`
and `/api/client/plan/current` responses. AI, human and unassigned are explicit
branches; ambiguity requires resolution. The AI branch reuses the authorized
workspace DTO and never synthesizes a human relationship. The human branch only
returns publications from the current relationship period (legacy plan tables
have no author-coach column) and rechecks provider state after reading.

Type-check/build, 202 integration and 424 unit tests pass; lint remains the
established 78-problem baseline. Main web screens and native consumers are the
next integration slices. No live flag, migration or deployment was changed.

## A12b — main web workflow integration (2026-09-14)

Home, Plan and Check-in now select their current provider explicitly. AI clients
use the same guarded workspace and evidence screens, with five primary mobile
destinations: Home, Plan, Check-in, Reviews and Profile. An unavailable AI provider
is shown as unavailable rather than replaced by historical human instructions.
Human onboarding uses the resolved active relationship rather than an arbitrary
CoachClient row. Ambiguous accounts receive an explicit resolution state.
Portion-preference meal views suppress daily macros while macro mode still shows
targets; accepted/review dates use the fixed review timezone.

Type-check/build, 202 integration and 424 unit tests pass. Changed-file lint has
only five pre-existing dashboard warnings; the additional error caught during
implementation was fixed, restoring the established lint baseline. Native
integration and operational controls remain in progress. No deployment.

## A11c — enforce assigned review capacity (2026-09-14)

Enrollment and new numerical runs now require an active, assigned reviewer whose
scope covers all current fixture domains. Grant-row locks serialize reservations
across clients. Queued/running work counts alongside pending proposals, and
expired windows do not consume capacity indefinitely. Enrollment also checks the
active assigned client count. Equivalent representation changes remain outside
numerical-review capacity. Existing request receipts retain replay semantics.

Test factories now explicitly provision synthetic reviewers only against the
local disposable database. New cases reject incomplete reviewer scope and a full
queue, then permit preparation when backlog is removed. Type-check/build, 203
integration and 424 unit tests pass; lint remains 78 baseline problems. Real
staffing, scope, consent and response obligations still require G04 artifacts.

## A11d — reviewed safety resolution (2026-09-14)

Added an assigned safety-case queue and reviewed domain-resolution command with
current revision, explicit confirmation, supporting reference and rationale.
Grant/account locks recheck active assignment and domain scope. Cross-domain
case disclosures require full scope. Partial resolution preserves unresolved
restrictions and urgent/referral disposition; all changes append an audit event,
increment safety revision and invalidate old proposals. Exact concurrent retries
produce one resolution. The old unscoped clearance helper now always rejects.
Web intake also permits saving a selected concern before other safety answers
are complete, matching the independent evidence-concern route.

Type-check/build, 206 integration and 424 unit tests pass. Changed-file lint is
clean after removing three introduced unused-argument warnings; the global
baseline remains 14 errors/64 warnings. Native contract work is committed in the
companion repo (21 unit tests pass); native screen verification is ongoing.
All clearance references here remain synthetic; no real clinical authorization
or monitored response service is claimed or enabled.

## A12c — durable manual retry and post-clearance evidence (2026-09-14)

Failed managed runs can be retried through an owner-scoped command and client
control. Concurrent requests collapse to one linked run, retain the original
snapshot/cutoff/window/history and recheck current safety, authority, evidence,
daily quota and reviewer capacity. Two manual retry generations are the cap;
terminal rows and adjustment slots never reopen. The legacy unscoped retry helper
rejects managed runs. Safe run-status responses are explicitly no-store.

Weekly snapshots also retain the latest full reviewed clearance timestamp.
Intensification waits for sufficient evidence after that clearance, preventing
both a perpetual resolved-concern loop and immediate escalation from old reports.
Type-check/build, 211 integration and 425 unit tests pass; changed-file lint is
clean and the full baseline remains 14 errors/64 warnings. No deployment.

### A12d — legacy current-plan provider boundaries (2026-09-14)

Main human Home/Plan and legacy iOS home/meal/training endpoints now resolve the
active provider and exclude publications predating the current relationship.
Unassigned current-plan reads return null; AI clients on legacy endpoints receive
a clear upgrade response. API reads recheck provider revisions/relationship after
dependent reads and successful payloads are private/no-store. The shared human
tables lack author-coach IDs, so relationship start remains the conservative
boundary; it is not a reconstructed historical authorship claim. Two new real-DB
route regressions cover AI/NONE and former/current publications. Type-check,
213 integration tests, 425 unit tests and build pass; lint unchanged at 14 errors
and 64 warnings. Logs: `/private/tmp/steadfast-a12d-*`.

### A12e — personal AI data export (2026-09-14)

Owner-authenticated `/api/client/ai-coach/export` streams NDJSON in 100-record
pages, with a manifest and terminal completion record. It includes retained
profile/draft, evidence, plan/approval history, frozen run inputs, safety events,
slots, receipts and notification intents; it excludes other clients, reviewer
qualifications and raw model traces/errors. No entitlement is needed to export
one's retained data. A two-per-hour quota, private/no-store download headers,
cancellation and repeated active-account checks bound resource use and stop
deactivated accounts. The manifest states that concurrent edits are not an atomic
snapshot. Web coaching settings link to the download. Tests cover 105-record
pagination, another owner's private record, deactivation and cancellation.
Type-check, 216 integration tests, 425 unit tests and build pass; lint unchanged
at 14 errors/64 warnings. Logs: `/private/tmp/steadfast-export-*`.

### A11e — assigned operational visibility and calendar evidence (2026-09-14)

Reviewer operations show seven-day run outcomes/retries, expired leases, oldest
open run, closed-window proposals and undelivered notification intents, scoped
to assigned synthetic clients. Revocation/assignment are rechecked after reads;
raw errors/prompts are never returned. Closed-window proposals leave the active
review queue. The eight-week evidence boundary now uses local-calendar
midnight across DST, with spring/fall tests.

**T-502 (2026-09-25) — acceptance notifications are now delivered, not just
recorded.** A bounded drain phase (`lib/ai-coach/acceptance-notifications.ts`,
`drainAcceptanceNotifications`) runs as the *first* statement of
`runExecutorSweep`, before the `FEATURE_AI_COACH_GENERATION` early return —
an outbox row describes a plan already active on the client's screen, so it
must not be stranded by the generation flag being paused. The drain is gated
independently on `FEATURE_AI_COACH_PUBLICATION` plus the `ACCEPTANCE`
operational control, claims each row with a single conditional `updateMany`
guarded on `attempts` (never read-then-write — concurrent sweeps must
deliver exactly once), and sends through one seam,
`lib/notifications/ai-coach-plan.ts` (`deliverAiPlanAcceptanceNotification`),
the only importer of `push.ts` for this event. Terminal outcomes:
`DELIVERED`, `SUPPRESSED_PREFERENCE`, `SUPPRESSED_NO_DEVICE`,
`SUPPRESSED_ACCOUNT_CLOSED`, `SUPPRESSED_SUPERSEDED` (a client with two
pending rows only ever gets the newest push), `SUPPRESSED_STALE` (rows older
than 48 hours are retired without ever sending — the answer to "what happens
to rows written before this shipped": nothing, no backfill), and `ABANDONED`
after `MAX_NOTIFICATION_ATTEMPTS` (5) with growing backoff
(5m/30m/2h/6h) — except `PUSH_CONFIG_MISSING` (no APNs env vars), which backs
off without consuming the attempt budget so a missing env var can never
abandon a cohort's notifications. The push payload is `type:
"MEAL_PLAN_UPDATED"`, deliberately reusing the shipped app's existing
"plan published" routing (`PushNotificationService.swift`) — no iOS change.
`getReviewerOperations` now reports `abandonedNotifications`, `retiredNotifications`
(`SUPPRESSED_STALE` + `SUPPRESSED_SUPERSEDED` — round 2, so a bulk stale/supersede pass doesn't silently drop
the pending count to zero with no visible explanation) and a real `notificationDelivery: "ENABLED" |
"DISABLED_BY_FLAG" | "PAUSED" | "ERRORED"` (round 3 adds `"ERRORED"` for an unexpected gate failure, e.g. a
thrown `LiveLaunchError`) in place of the old hardcoded `"NOT_CONFIGURED"` literal.
`getAcceptanceDeliveryState()` (`lib/ai-coach/operations.ts`) is the single function both the drain's own
gate (`runAcceptanceNotificationPhase`) and this readout call, so the two cannot structurally disagree.

T-502 added `tests/integration/ai-coach-acceptance-notifications.test.ts` (15
new cases), `tests/unit/ai-coach-acceptance-notification-copy.test.ts` (5) and
`tests/unit/ai-coach-acceptance-notification-mapping.test.ts` (7), and
extended `tests/integration/ai-coach-export.test.ts` with one case — 27 new
tests engineer-verified against the ticket branch, on top of whatever full
count qa-verifier records for the sprint branch as a whole (not recomputed
here — see the ticket's own evidence file for the exact commands run).

Verified together with the authority follow-up: 218 integration tests and 427
unit tests pass, type-check/build pass, lint unchanged at 14 errors/64 warnings.
The initial unrestricted integration run hit six 5-second test timeouts while
Xcode/web builds competed for resources. The unchanged tests passed with
`--maxWorkers=4`; no timeouts were increased. Final logs:
`/private/tmp/steadfast-authority-*`. Real alert owners/thresholds and deployed
scheduler/delivery evidence remain external launch artifacts.

### V08 follow-up — provider transition serialization (2026-09-14)

The old A01 enrollment helper was still a consent-free writer despite its locking
comment; it is now explicitly disabled. The managed consent-bound ENROLL command
is the only supported AI enrollment path and also refuses existing human links
when context backfill is absent. Human invite acceptance now holds the same
client User lock, re-reads account/invitation/authority inside the transaction,
rejects inactive accounts/coaches, stale/expired invites, AI authority and a second
human provider, and preserves replay semantics. Relationship deletion paths
also lock the client before deleting/reconciling. Expired invitations continue
to persist EXPIRED, preserving existing behavior. Regression coverage races real
managed enrollment against invite acceptance and tests deactivation/current
invite state. Full shared gate evidence: 218 integration, 427 unit, type-check
and build pass; lint baseline unchanged. No live enrollment flag was enabled.

### A12f — shared meal parity and beginner journey (2026-09-14)

The workspace returns only feasible catalog-validated substitution offers; web
and native clients use those offers rather than inventing replacements. Every
proposal still revalidates at generation/acceptance. Native weekly ingredient
totals preserve food state and catalog version. Web proposed plans now include
an expandable current-plan comparison. A new real-DB beginner regression goes
through safety/intake/consent, initial run, review, acceptance replay, typed
activity/check-in and an early weekly clarification without losing the current
plan or writing human coaching tables. Unit tests cover feasible/unsupported
offers and UI scope; browser form regression remains passing. Current full suite:
219 integration and 428 unit tests. Final logs: `/private/tmp/steadfast-final-*`.

### T-995 — grant provisioning (2026-09-25)

Before this ticket, no production code path could create any of the three
permission rows that gate the whole feature (`AiCoachGovernanceGrant`,
`AiCoachReviewerGrant`, `AiCoachEntitlement`) — only test factories against
the disposable local database wrote them. `lib/ai-coach/grants.ts` is now the
single shared writer for all three, called from two CLI-only scripts (no HTTP
route, mirroring `ai-coach:activate`/`ai-coach:deactivate`):

```sh
pnpm run ai-coach:bootstrap-governance -- --confirm-bootstrap --user-id '<id>' \
  --grant-ref '<signed record id>' --actor-ref '<named human>' --reason-code 'GOVERNANCE_BOOTSTRAP'
pnpm run ai-coach:grant -- grant-governance   --actor-user-id '<id>' --user-id '<id>' --scopes '...' --grant-ref '<id>' --actor-ref '<name>' --reason-code '<CODE>'
pnpm run ai-coach:grant -- grant-reviewer     --actor-user-id '<id>' --user-id '<id>' --client-ids '<id>,<id>' --domains '...' --qualification-note '<note>' --actor-ref '<name>' --reason-code '<CODE>'
pnpm run ai-coach:grant -- grant-entitlement  --actor-user-id '<id>' --client-id '<id>' [--expires-at '<ISO>'] --actor-ref '<name>' --reason-code '<CODE>'
```
(plus the symmetric `revoke-governance`/`revoke-reviewer`/`revoke-entitlement`).

Bootstrap is a once-ever-per-database command: it refuses (`ALREADY_BOOTSTRAPPED`)
if any `AiCoachGovernanceGrant` row exists at all, revoked included, checked
under `pg_advisory_xact_lock('steadfast.ai_coach.governance_grants')`, and
always grants all eight `GOVERNANCE_SCOPES` (no `--scopes` argument). Every
later grant requires an existing `CONTROL_OPERATIONS` holder.
`revoke-governance` additionally refuses (`LAST_CONTROL_GRANT`) if it would
leave zero non-revoked `CONTROL_OPERATIONS` grants. A new append-only table,
`AiCoachAccessGrantEvent` (migration `20260925000000`), records one audit row
per successful create/revoke, purged on both `actorUserId`/`subjectUserId`
and scrubbed (`array_remove`) out of any other row's `clientIds`. The
append-only guard on this table needed one deviation from the original
design: a session-scoped flag (`steadfast.ai_coach_access_grant_purge`,
set only by `lib/account-deletion/purge.ts`) permits the purge path's own
`clientIds`-only scrub UPDATE through the trigger while still rejecting
every other mutation — the shared `prevent_ai_coach_append_only_update()`
function used by every other append-only table blocks *all* updates
unconditionally, which would otherwise have made the required purge scrub
line impossible (caught by a failing integration test before it shipped).

Per T-2000 (Jaden, 2026-09-24), the entitlement path reads no
`AiCoachReviewerGrant` row and calls no reviewer function — the reviewer-grant
CLI stays in scope only for safety-resolution and governance/exception
tooling; `client-commands.ts`, `run-command.ts` and `retry-command.ts` are
untouched and still call `requireReviewerCapacity` for non-synthetic profiles
until T-2000 lands. Nothing here changes web/iOS response shapes — no route,
Server Action or UI was added.

Gates: `pnpm run type-check` (twice), `pnpm exec eslint` on every changed
file, `pnpm exec prisma validate`, `tests/unit/ai-coach-grant-input.test.ts`
(20 tests), `tests/integration/ai-coach-grants.test.ts` plus the
extended `tests/integration/account-deletion.test.ts`, and the named
regression set (`ai-coach-live-launch-readiness`, `ai-coach-end-to-end-governance`,
`ai-coach-provider-boundary`, `ai-coach-reviewer`, `ai-coach-plan-acceptance`,
`ai-coach-context`) all pass. Full unit suite passes (after bumping
`EXPECTED_MIGRATIONS` to 75 for the new migration). No feature flag was
touched; the change is inert until an operator runs a command.

**Round 2 (review + parity fixes, 2026-09-25):**

- **`LAST_CONTROL_GRANT` now also requires the remaining holder to be
  active.** The count previously only checked `revokedAt: null`, matching
  `requireGovernanceGrant`'s revoked-check but not its
  `user.isDeactivated`-check — a revoke could leave the platform's only
  standing `CONTROL_OPERATIONS` grant on a deactivated account, which
  `requireGovernanceGrant` then refuses for every caller (the kill switch
  included), with no repair path but hand-written SQL. Fixed by adding
  `user: { isDeactivated: false }` to the count.
- **`grant-reviewer`'s context refusal (row 13) relaxed.** It refused any
  client whose `ClientCoachingContext.mode !== "AI"` — but no real client can
  reach `mode: "AI"` before T-2000 (ENROLL still calls
  `requireReviewerCapacity`, which itself needs a reviewer grant to already
  exist), a deadlock for the exact "first real client" case this ticket
  exists to unblock. Now refuses only `mode === "HUMAN"` or
  `resolutionRequired`; a `NONE`-mode / no-context (pre-enrollment) client can
  be named.
- **TOCTOU on actor authority closed.** `requireGovernanceGrant(actor, ...)`
  previously ran as an unlocked read before any serializing lock on four of
  the six operations. Governance paths now take the advisory lock before
  reading actor authority; reviewer/entitlement paths now take
  `SELECT ... FROM "AiCoachGovernanceGrant" WHERE "userId" = $actor FOR UPDATE`
  first. A concurrent revoke of the actor's own grant can no longer commit
  between the authority read and this transaction's commit.
- **`lockAiClientRows` extraction fully restored to zero behaviour change.**
  Round 1 moved the client's `isClient`/`isDeactivated` check to after all
  four row locks instead of between lock 1 and lock 2. `lib/ai-coach/access.ts`
  now exposes `lockAiClientUserRow` and `lockAiClientDependentRows`
  separately; `lockAiClient` composes them with the check back in its
  original position, and `lockAiClientRows` (used by `grants.ts`) composes
  the same two helpers with no interleaved check.
- **Recorded, not code-changed:** `grant-entitlement`/`grant-reviewer`/`grant-governance`
  silently re-activate an **expired-but-not-revoked** row in place rather than
  refusing it (a deliberate narrowing of refusal row 9's "any non-revoked row"
  wording for the entitlement path specifically, matching how `access.ts` and
  `client-provider.ts` already treat an expired entitlement as inactive).
- **Purge can still delete the last `CONTROL_OPERATIONS` holder's grant with
  no guard**, and once any grant row has ever existed, bootstrap refuses
  forever. Not a code fix in this ticket — the recovery procedure is a manual
  SQL insert, to be run only as a named incident:
  ```sql
  INSERT INTO "AiCoachGovernanceGrant" ("id","userId","scopes","grantRef")
  VALUES (
    gen_random_uuid()::text,
    '<recovery user id>',
    ARRAY['CONTROL_OPERATIONS','PUBLISH_ARTIFACTS','REVOKE_ARTIFACTS','VIEW_AGGREGATE_MONITORING',
          'APPROVE_LIVE_LAUNCH','REVOKE_LIVE_LAUNCH','ACTIVATE_LIVE_LAUNCH','DEACTIVATE_LIVE_LAUNCH'],
    '<incident reference>'
  );
  ```
  This belongs in the release packet as a named recovery procedure.
- **Deploy ordering (bold, read before pushing): apply migration
  `20260925000000_ai_coach_access_grant_events` to the target database
  BEFORE this commit is deployed.** `purge.ts` references
  `AiCoachAccessGrantEvent` unconditionally; without the migration applied,
  every account-deletion purge run throws, `sweep.ts` resets the request to
  `PENDING` and every pending deletion (web- and iOS-initiated) silently
  stalls with the statutory clock still running. `GET /api/health`
  (`migrationsApplied === migrationsExpected`, expected is **75**) is the
  pre-deploy check.
- New regression tests: `revoke-governance refuses when the only other
  CONTROL_OPERATIONS holder is deactivated`; `grant-reviewer succeeds for a
  NONE-mode / no-context client, refuses a HUMAN-mode client`; a
  revoke-governance-vs-grant-entitlement concurrency race proving no
  entitlement is ever created attributed to a governance grant that is
  revoked at commit time; the non-synthetic + ACTIVE-release writer/reader
  agreement case for `entitlement written by the CLI passes lockAiClient
  unchanged`; `grant-entitlement after expiry re-activates in place`.

### T-509 — explicit purge for observations and operation receipts (2026-09-25)

`AiCheckInObservation` (A08a private check-in/session observations, including
tombstoned rows) and `AiOperationReceipt` (A06d idempotency ledger) are the
only two user-scoped AI Coach tables with `onDelete: Cascade` to `User`; every
other user-scoped `Ai*` table is `Restrict`-by-default and already has an
explicit statement in `lib/account-deletion/purge.ts`. Until this ticket
their rows left the database only via the implicit DB cascade fired by
`tx.user.delete()` — the exact implicit behaviour the rest of the file
deliberately avoids (see the `CoachSettings`/`IntakeFormTemplate` precedent at
`purge.ts:241-243`). A future relation change (or manual DDL) could have
silently left a purged client's private health observations behind with no
test to catch it.

`purge.ts` now deletes both tables explicitly, next to `AiWorkoutSession`
(the other evidence kind `lib/ai-coach/delete-evidence.ts` tombstones) and
before `AiAdjustmentSlot`, with no `deletedAt IS NULL` filter — tombstoned
observations still carry a `clientId` and must be purged, not skipped. This
is defence in depth, not a behaviour change: the rows already left the
database today, thirty lines later in the same transaction.

`tests/integration/account-deletion.test.ts` now seeds a live observation, a
tombstoned observation, and an operation receipt for the purged user, plus
the same three rows for a second, non-purged user as a scoping control, and
asserts the purged user's rows are gone (including the tombstone) and the
other user's rows survive untouched.

**Schema sweep result (stated per the spec's acceptance criterion):** all 30
`^model Ai` matches in `prisma/schema.prisma` plus `ClientCoachingContext`
were checked. Exactly two user-scoped tables were missing a purge line —
both named above and now added. The other four `Ai*` models absent from
`purge.ts` (`AiCoachArtifactVersion`, `AiCoachOperationalControl`,
`AiCoachLiveLaunchPacket`, `AiCoachLiveActivation`) have no `User` foreign key
at all and are correctly absent; no change needed there.

No schema change, no migration, no iOS change (`build_order: web-only`).

Gate results (web repo, isolated local DB): `pnpm run type-check` clean
before and after the test edit; `tests/integration/account-deletion.test.ts`
11/11 passing, and together with `tests/integration/ai-coach-delete-evidence.test.ts`
and `tests/integration/ai-coach-observations.test.ts` (the other two writers
of these tables), 18/18 passing with no fixture interference; `eslint` clean
on both changed files. Per the spec's regression-teeth requirement, the two
new `purge.ts` DELETEs were commented out and the new assertions re-run
first — they passed, proving the DB cascade is what removes the rows today —
then the statements were restored before the real gate run above.
