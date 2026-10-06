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

**S-29 (2026-10-02): `evidence[].status` is now derived provenance, not a hardcoded guess, and no real client could
reach `APPROVE_AUTOMATICALLY` before this landed.** `finalization.ts` built the autonomy gate's `evidence[]` as
`status: ruleId === "SYNTHETIC_EVIDENCE_RULE" ? "SUFFICIENT" : "UNKNOWN"` mapped over `policy.evidenceRuleIds` —
correct only while the fixture bundle declared exactly that one rule id. T-2007 (2026-09-28) added
`WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` to `evidenceRuleIds`, and the real signed bundle declares
`['NUTRITION_EVIDENCE_RULE', 'WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1']` — neither the hardcoded id — so every
candidate finalized against the real bundle wrote `UNKNOWN` and the gate turned that into `GATE_EVIDENCE_MISSING`
-> `FOCUSED_CLARIFICATION` for every one of them (15 integration tests across 6 files had been red since the
merge; S-24 misattributed the symptom to S-15's gate change before the lead traced it to the actual reason code).
S-17 had already added a *publication-time* guard, `assertEvidenceRulesHaveClaims`
(`lib/ai-coach/autonomy/gate.ts`), that throws `ARTIFACT_INCOMPATIBLE` when a declared evidence rule has no
covering reviewed claim — but that guard and `finalization.ts`'s status map were two independently-written copies
of "is this rule substantiated", and only one of them got updated. The fix is Design A (frozen, with amendment
A′): `evidence[].status` means **policy provenance** — a rule is `SUFFICIENT` iff the digest-verified reviewed
`EVIDENCE_REGISTRY` loaded in the same artifact set carries a claim listing it in `ruleIds`, `UNKNOWN` otherwise
— and the relation now lives in exactly one pure module, `lib/ai-coach/autonomy/evidence-status.ts`
(`evidenceRuleIsSubstantiated`, `unsubstantiatedEvidenceRuleIds`, `deriveEvidenceGateEntries`), with **four**
callers: `assertEvidenceRulesHaveClaims` (refactored onto it, same thrown message, same code), `finalization.ts`'s
`evidence[]` construction (the bug itself), and the validation harness's two gate-input builders
(`scripts/ai-coach-validation-harness.ts`, which used to hardcode `status: "SUFFICIENT"` for every rule — the
harness and the product disagreeing about evidence is exactly the drift class the harness exists to catch). The
same commit fixes the one reader the change unmasks: `gate.ts`'s `evidenceCurrent` check used to pass
`input.evidence.flatMap((item) => item.sourceRefs)` straight to `evidenceIsCurrent`, and finalization attaches the
same `sourceRefs` array to every evidence entry, so once `evidenceRuleIds` has length 2 that flatMap duplicates
the candidate's refs once per rule; `evidenceIsCurrent` fails closed (`false`) on its `max(2180)` guard, so a
candidate with more than 1090 refs would have silently `HOLD`ed on `GATE_EVIDENCE_STALE` — unreachable only
because `GATE_EVIDENCE_MISSING` fired first. Deduped with the existing `sortedUniqueSourceRefs` helper (now
exported), which has the same answer for a multiset and its set, so this is not a widening. **Explicitly out of
scope and not fixed here: client evidence (has this client supplied enough history) for the weekly rule is a
different thing, already computed at `lib/ai-coach/weekly-controller.ts:289-322`
(`minConsecutiveWeeks`/`maxMissingWeeks` -> `HOLD`/`INSUFFICIENT_EVIDENCE`) at execution time, before a weekly
candidate is ever written — finalization's per-rule status is the provenance half only.** `INSUFFICIENT` stays
written by nobody; that is a named open question, not an oversight (T-2000 review r1 BLOCKER 1,
`board/reviews/T-2000-r1.md:16-47`, asked for exactly the provenance mapping this delivers). No enum value, schema,
migration, REST contract or Swift type changed — `evidence[].status`'s three-value enum (`SUFFICIENT` /
`INSUFFICIENT` / `UNKNOWN`) is unchanged and `plan-acceptance.ts`'s replay of a stored `gateInput` through
`serverAutonomyGateInputSchema` still parses every row written before or after this change.

**S-26/S-27 (2026-09-29): a run that fails its first attempt spun forever locally, and the progress UI was inventing
stages.** Found when a local synthetic account's plan request sat on "Safety & Verification" for 3300 seconds. Two
independent local-dev traps plus one UI defect, all reproduced against Postgres (a v2-intake synthetic account,
zero rows in `AiCoachArtifactVersion`, `requestAiRun` → `drainRunNow` → `getAiWorkspace` at each state):
- **The four progress "stages" in `AiRunProgressTracker` (`components/ai-coach/experience.tsx`) were a
  `setInterval`-driven animation, not state** — `processManagedRun` is a single opaque pass; nothing in the
  executor reports "Metabolic Profiling" or "Verifying clinical macronutrient floors". Replaced with an honest
  indeterminate indicator (elapsed seconds, no percentage, no named stage), a **120s elapsed ceiling** past which
  the card stops implying progress and tells the person they can leave, and a `RETRY_WAIT` branch that is
  visually (amber, no spinner) and textually distinct from QUEUED/RUNNING: it says an attempt already failed,
  shows `attempts`/`maxAttemptsPerRun` (both newly projected onto `getAiWorkspace`'s run objects — the run's
  `lastError`, a server-owned `AiCoachError.code` for every run this query returns, is also projected and mapped
  to copy client-side, never rendered raw).
- **A new stable code, `RUNTIME_ARTIFACTS_UNPUBLISHED`** (`lib/ai-coach/error.ts`), added — not a repurposing of
  `TEMPORARILY_UNAVAILABLE` — for the one case that means "this environment has never published a usable
  reviewed/fixture artifact set at all" (`ArtifactLoadError` code `ARTIFACT_MISSING`/`ARTIFACT_NOT_EFFECTIVE` from
  `composeManagedInitialPlan`'s `loadReviewedArtifactSet` call, `managed-executor.ts`). The other four call sites
  that shared `TEMPORARILY_UNAVAILABLE` before this (`requireFixtureRuntime`, the binding-mismatch checks in
  `managed-executor.ts` and `runtime-binding.ts`) are unchanged.
  **Known limitation, found but not fixed this ticket:** `composeManagedInitialPlan`'s fallback branch (used
  whenever a run's snapshot has no frozen `runtimeBinding` — i.e. exactly the T-2041 unbound-snapshot degrade)
  calls `loadReviewedArtifactSet`, which resolves artifacts for **`getCurrentDbUser()`'s current session**, not
  for `claim.run.clientId`. Reproduced: the same run's **first** attempt (drained inside the enqueuing client's
  own request) got `RUNTIME_ARTIFACTS_UNPUBLISHED`; a **second** attempt with no Clerk session (what the cron
  sweep's and `pnpm ai-coach:sweep`'s request context actually is) hit `getCurrentDbUser`'s plain
  `Error("Not authenticated")` instead — not an `AiCoachError`, so it falls through to `processManagedRun`'s
  generic `MANAGED_RUN_FAILED`, masking the real cause again on every retry after the first. Not fixed here
  because the identity-resolution change is bigger than this ticket's scope and touches a documented T-2022
  contract; flagged for a follow-up ticket.
- **`pnpm ai-coach:sweep`** (`scripts/ai-coach-sweep.ts`) calls the real `runExecutorSweep()` once and prints the
  summary — the smallest non-production driver for the fact that **runs do not self-advance in local dev**.
  `runExecutorSweep` has exactly one other caller, the Vercel Cron route, which does not exist in `next dev`;
  the only other driver, `scheduleRunDrain`/`drainRunNow`, advances a run by exactly one stage and never
  reconciles an expired lease or re-arms a due `RETRY_WAIT`. Refuses when `NODE_ENV === "production"` or
  `VERCEL_ENV` is set. Does not change the production drain path — the cron stays the durable driver everywhere
  it exists.
- **`pnpm ai-coach:seed-fixtures`** (`scripts/ai-coach-seed-fixtures.ts`) publishes the synthetic runtime artifact
  set with a long (10-year) explicit expiry and prints every artifact key/version/effectiveAt/expiresAt it wrote.
  Shares its builder (`lib/ai-coach/artifacts/fixture-seed.ts`'s `publishRuntimeFixtureArtifactSet`) with
  `tests/helpers/ai-artifacts.ts`'s `publishFreshRuntimeFixtureArtifacts`, which keeps its original 1-hour expiry
  unchanged (a developer who reused *that* test helper to seed a local environment got a working setup that
  silently reverted to the unbound-snapshot degrade an hour later — the exact trap this bug report started
  from). Refuses outside development (same `NODE_ENV`/`VERCEL_ENV` check) and requires `--yes`; prints the
  target host/port/database name, never a credential or the full connection string.
- **Open question for the lead, not resolved here:** should `resolveRunRuntimeBinding` (`run-command.ts`) still
  write a run it already knows cannot succeed (the T-2041 silent-degrade decision)? Refusing at enqueue would
  turn this into an instant, clear error instead of a run that fails on its first drain.

**S-19 three self-serve dead ends in the intake (2026-09-28):** all three reproduced against Postgres by
replaying the wizard's real command sequence (`tests/integration/ai-coach-intake-wizard-confirm.test.ts`), not
by reading code. (1) A second intake pass with a changed allergen still sets `nutritionPermission: PAUSED` /
`safetyDisposition: RESTRICTED` and cancels the queued run — that pause is correct and was **not** removed. What
changed is that the dead end is now stated instead of silent: `getAiWorkspace` projects
`safetyRestriction`, built by `lib/ai-coach/safety-restriction.ts`, whose `planRequestIsSafetyBlocked` is the
same function `requestAiRun` uses for its `SAFETY_RESTRICTED` 409, so `/client/ai-coach` names the restricted
domains, says the client cannot clear it and that only an authorized reviewer can, and replaces the
plan-request button with that statement rather than letting the client discover the 409. Step 3 of the wizard
warns before a confirmed intake's allergy answers are changed. No re-evaluation shape was shipped:
`submitSafetyDisclosure` ratchets monotonically and stores no per-cause provenance, and `resolveAiSafety` can
leave a domain more permissive than the rule table would re-derive, so a re-derivation could silently undo a
reviewer's decision. (2) The step-4 button read "Confirm & Build Plan" / "Building your plan..." and landed on
the consent card having enrolled nothing. The consent step was **kept** — `ENROLL` verifies
`consentTextDigest` against the live release's approved discovery text, so consent cannot honestly be recorded
from a screen that does not show that text — and the button now reads "Confirm my answers" with a caption
naming disclosure review and consent as the next step; the landing card's heading and first line say the same.
(3) `needsSafetyDisclosure` read `view.confirmedIntake === null`, a proxy: a profile confirmed or seeded without
an `AiSafetyDisclosureEvent` row skipped `SAFETY` and then took `CONFIRM_INTAKE`'s
`422 "Complete the safety questions first."` with no way out. Both sides now read one predicate,
`hasRecordedSafetyDisclosure`, projected as `safetyDisclosureCompleted`. Two additive workspace DTO fields, no
migration, no table change; iOS decodes both optionally or ignores them.

**S-20 live-launch SQL gate: two reported defects explained, and SINGLE_SIGNER_ACCOUNTABLE_OWNER (2026-09-28):** S-20 was filed against two defects in `validate_ai_coach_live_launch_approval`, the raw-SQL half of the launch gate called by the `AiCoachLiveLaunchPacket_lifecycle_guard` trigger — an operator-precedence bug in the jurisdiction containment clause (`->` and `@>` share a precedence level and are left-associative, so `item->'jurisdictions' @> candidate->'jurisdictions'` parses as `((item->'jurisdictions') @> candidate) -> 'jurisdictions'` and raises 42883, swallowed by `EXCEPTION WHEN OTHERS THEN RETURN false`), and a naive `TIMESTAMP` vs `timestamptz` comparison resolved through the session `TimeZone`. **Both are real in `20260922000000_ai_coach_live_launch_readiness`; neither has ever been live.** `20260922010000_ai_coach_governed_activation` already replaced that body with one that parenthesises both containment operands and pins all four instant comparisons to `AT TIME ZONE 'UTC'`, so the v1 text only ever exists between two migrations of the same replay and no packet was ever evaluated by it. That is the answer to the ticket's open question, and it also disproves the working assumption that a valid packet had never passed the gate: the existing `ai-coach-live-launch-readiness.test.ts` lifecycle test and the five suites using `activateTestLiveRelease` all approve real seven-signer packets through the trigger. All of it is now pinned mechanically in `tests/integration/ai-coach-live-launch-sql-gate.test.ts`, which installs the committed v1 body under a throwaway name (read out of its own migration file, not paraphrased), shows it returning false, strips its `EXCEPTION` handler to surface the 42883, and shows the jurisdiction-only fix still failing under a UTC+14 session. Audit result for the whole function, not just the two named lines: `@>` occurs exactly twice in the entire migration set and every other JSONB access feeds a comparison, cast or function call, all of which bind looser than `->` and therefore cannot reassociate. On top of that, `20260928000000_ai_coach_single_signer_accountable_owner` lands the recorded v1 scope reduction (`board/V1-SCOPE.md`, Jaden, 2026-09-27): the required approvals move from all seven to **NUTRITION_PROFESSIONAL only**, the requirement all twelve decision records already bind to. The SQL accepts 1..7 approvals with exactly one NUTRITION_PROFESSIONAL and no duplicated requirement; `lib/ai-coach/live-launch/schema.ts` gains `LIVE_LAUNCH_APPROVAL_MODE`/`ALL_APPROVAL_REQUIREMENTS` and now validates **every** approval the packet carries rather than only the required subset, because the SQL loop always did — without that, an expired optional LEGAL_SCOPE approval would have been ready in TypeScript and refused by the trigger. What v1 gives up is recorded in that file and in `docs/ai-coach/approval/live-launch-approval-packet-v1.md`: legal scope review, provider privacy/security sign-off and SLO/spend-limits sign-off, not legal review alone. `scripts/evaluate-ai-coach-final-provider.ts` was deliberately left demanding current signed `PROVIDER_PRIVACY_SECURITY` **and** `SLO_AND_SPEND_LIMITS` approvals — it authorizes real provider I/O against a real credential, so producing `REAL_PROVIDER_EVALUATION` evidence still needs those two or a separate recorded decision. No table, column, index or data change; one `CREATE OR REPLACE FUNCTION`. `EXPECTED_MIGRATIONS` 78 -> 79.

**T-2028 four-step web intake rebuild (2026-09-27):** `components/ai-coach/intake-wizard.tsx` replaces the five-stage clinical questionnaire with four responsive card screens: Goal, Training Setup, Nutrition & Tracking, and Body Stats & Confirm. The visible choices are limited to goals, experience, days/week, equipment, session duration, dietary style, tracking style, six allergen tags, units, height, weight and age. Fresh clients complete the pre-existing safety prerequisite inside step 4: the clear path is one tap (“None of these apply”), while a concern or uncertainty expands the existing tri-state questions; edits of an already-confirmed intake do not repeat it. The client still uses `SAFETY`, `ALLERGIES` and `CONFIRM_INTAKE` in that order, and redirects to `/client/ai-coach` only after all commands succeed. `buildConfirmPayload` maps the plain-language choices into the frozen v2 schema, assigns `UNKNOWN` and omits values for unasked population/activity/cooking groups, represents goal pace as `UNDECIDED`, uses conservative allergen declarations (`UNSURE` cross-contact; gluten remains `OTHER: gluten`), and never forwards server-owned compatibility keys. The wizard imports AI Coach code only from the zod-only `intake-contract.ts` leaf; no backend, route, table, Prisma, DTO or iOS contract changed. Focused verification: `pnpm exec vitest run tests/unit/ai-coach-intake*` — 7 files, 73 tests passed. Synthetic browser evidence at 390px and 1280px covers every step, deferred validation, reload/resume, success redirect and retryable confirm failure (`board/evidence/ui/T-2028/`).

**S-17 signed the five v1 artifacts and reduced the launch packet to one signer, 2026-09-28:** the policy
bundle, food catalog, exercise catalog, evidence registry and escalation templates now carry
`reviewMetadata.decision: "APPROVED"` with Jaden Wong as `QUALIFIED_CONTENT_REVIEWER`, reviewed 2026-09-27
against `steadfast-hq/board/REVIEW-WORKSHEET.md`; every per-record review state moved `PROPOSED` -> `ACCEPTED`
and a schema refinement now makes "APPROVED at the top, PROPOSED underneath" unparseable. **No credential is
claimed anywhere** — the qualifications array holds the single worksheet line and a test scans the registry for
credential wording, exempting only the three fixed strings that *deny* one. The fifteen client sentences were
already byte-identical to the worksheet and did not change. Worksheet section 3 supplied the two
`TRAINING.EFFORT.*` sentences and a new `PRESCRIPTION.EXPLANATION.NUTRITION.TARGET.V1`, bound through
`trainingEffortTemplateIds` / `prescriptionExplanationTemplateIds`, never `escalationTemplateIds`; the three
copy templates carry a `NOT_AN_ESCALATION.` reason-code prefix so the S-15 separation is checkable rather than
remembered. Worksheet section 2 replaced the two placeholder sources with PubMed `19204579` and `24222017`,
and both claim ids moved because the old ones named a Steadfast proposal and a pending placeholder. **Each
claim asserts an accountable-owner scope attestation and explicitly denies an independent verification of the
source's full text**, and a test fails if that denial is ever dropped. `proposalProvenance` became available on
signed metadata (it was draft-only, so signing silently deleted the field the anti-fabrication guard reads).
`legalReviewStatus: "APPROVED"` is qualified by `legalReviewBasis: "ACCOUNTABLE_OWNER_SCOPE_ATTESTATION"` plus
the owner's scope note, because **there is no legal signer**; `jurisdictions` and every template's `geographies`
are `["US"]` and a test keeps them equal. **The launch-packet signer reduction is NOT in this change and
`REQUIRED_APPROVAL_REQUIREMENTS` still lists all seven roles** — see `board/` for the blocked write-up: the same
policy is duplicated in the `validate_ai_coach_live_launch_approval` trigger
(`20260922000000_ai_coach_live_launch_readiness`), and that function carries two latent defects that surface the
moment its approval clauses are touched, so the reduction could not be landed safely in this ticket. Separately,
S-17 fixed a live gap the weekly-controller merge left behind: the synthetic fixture declared
`WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` in `evidenceRuleIds` with no covering claim, which
`assertEvidenceRulesHaveClaims` turns into a 503 with no decision row; that was 24 of the 47 AI Coach
integration failures on `team/sprint-1`. **Two things did not happen and must not be assumed:** training still
refuses with `TRAINING_PARAMETER_MISSING` over 23 absent dose parameters, and nothing is registered or
activated — a signature is not an activation.

**S-25 the thirteen prescription parameters and the two nutrition safety floors, 2026-09-29:** the accountable owner's adopted values (`steadfast-hq/board/DOSE-WORKSHEET-3.md`, ADOPTED section) were written into `lib/ai-coach/artifacts/drafts/policy-bundle-nutrition.draft-unsigned.v1.json`: the eight Section A prescriptions (LOSE gradual -0.10, LOSE moderate -0.20, GAIN gradual +0.05, GAIN moderate +0.10, MAINTAIN 0.00, relative bounds +/-0.25, `ENERGY.BODY_MASS.ENERGY_PER_KG` 7700), the five Section B constants (weight staleness 14 days, energy step 10 kcal, macro decimals 0, projected-change decimals 2, tolerance 5%), and the two Section C safety floors as new parameters `SAFETY.NUTRITION.MIN_DAILY_ENERGY.FLOOR.V1` = 1200 `KCAL_PER_DAY` and `SAFETY.NUTRITION.MAX_WEEKLY_LOSS_RATE.CEILING.V1` = 1.0 `PERCENT_BODY_WEIGHT_PER_WEEK`. **The Section C edit is atomic by construction**: the two `safetyControls.nutritionLimits` hooks were repointed off their `PENDING_RD_DECISION_*` placeholders in the same write that added the parameters, because a repointed hook whose parameter is absent does not pass `policyBundleContentSchema` at all and a parameter with the wrong unit, wrong applicability rule or a non-positive value throws `ArtifactLoadError` out of `resolveNutritionSafetyPolicy` before any parameter set exists (`tests/unit/ai-coach-nutrition-safety-floors.test.ts` proves each state against a mutated copy). Bundle parameters 108 -> 123, provenance rows 108 -> 123, all 15 bound to `CLAIM.OWNER.TRAINING.DOSE_AND_PROGRESSION` with the owner's second sentence verbatim: *"proposed by engineering, adopted by me, without claiming external literature sources."* No new claim was created and neither claim-shape guard was touched; the sanctioned owner-adoption list stays at one id, and that claim's declared rule set grew to the union its parameters declare, which is what the existing guard requires. **Consequences, measured over 4064 synthetic profiles** (`steadfast-hq/board/evidence/v1-prescription-harness.md`): `resolvePrescriptionParameters` and `resolveNutritionSafetyPolicy` both resolve; 496 v2 profiles reach a nutrition target where 0 did before, and the autonomy gate returns `APPROVE_AUTOMATICALLY` for 478 of them; only `LOSE.MODERATE` ever reaches a bound (energy floor 3, loss-rate ceiling 9); the +/-0.25 relative bounds never bind and cannot at these five fractions, whose largest magnitude is 0.20. **The 1.0 %/week ceiling at 7700 kcal/kg permits a daily deficit of 11 kcal per kg of body mass** — 440 kcal/day at 40 kg, 1320 at 120 kg, 2200 at 200 kg — because `ENERGY.BODY_MASS.ENERGY_PER_KG` is read inside the clamp, not only in the client-facing forecast. Nothing is registered or activated; a signature is still not an activation and the AI Coach flags stay off.

**S-23 adaptive energy, phases 1 and 2 plus the pure estimator, 2026-09-29:** adds `AiNutritionLog` (migration `20260929000000_ai_nutrition_log`, `EXPECTED_MIGRATIONS` 79 -> 80) — one row per client per calendar day with `source` (`PLAN_AS_WRITTEN | PLAN_WITH_EDITS | MANUAL | SKIPPED`) and `completeness` (`FULL | PARTIAL | NONE`) as the client's own declaration, `@@unique([clientId, loggedOn])` (which is also the rolling-window index; no second index was added), a purge line in `lib/account-deletion/purge.ts`, and four hand-written CHECK constraints that keep a declared "I did not log" day distinguishable from a day with no row. Adds five pure modules under `lib/ai-coach/adaptive/` — `parameters.ts` (T-2032 total resolver over nine `ADAPTIVE.*` ids; **no value for any of them is in this repository**, so it refuses every current bundle with `ADAPTIVE_PARAMETER_MISSING`), `weight-trend.ts` (two-state Kalman filter, irregular `Δt` in days, two-point initialization, exposes `P[1][1]`), `intake-window.ts`, `expenditure.ts`, `gate.ts` (the five conditions including the asymmetric reduction rule; every HOLD names its failing condition) — plus a sixth, `dates.ts`, holding the single shared ISO-date-to-day-index conversion. The composer's AST purity test is extended over the whole folder: no numeric literal other than 0, 1 and 7, no clock, no randomness, no database. **Nothing calls any of it.** `energyMethod` does NOT gain `ADAPTIVE_OBSERVED_EXPENDITURE` in this slice and a unit test asserts both that no product module imports the folder and that the enum still has exactly its two values; phase 4 is a separate ticket. `scripts/ai-coach-validation-harness.ts` gains `--adaptive-history`, a synthetic-history mode that measures the estimator's error against known ground truth across a declared grid. **Two errors in `board/strategy/adaptive-energy-architecture.md` were found and NOT implemented as written**: the expenditure formula's weight term must be subtracted, not added (a losing client burns more than they eat), and the slope-uncertainty expression must not be divided by `N` (it is already kcal/day). Both are recorded with derivations and golden vectors in `board/evidence/S-23-adaptive.md`.

**S-V1-artifacts DRAFT_UNSIGNED evidence registry and escalation templates, 2026-09-27:** the two of the five artifact kinds `loadLiveArtifactSetForLaunchValidation` requires that existed only as synthetic fixtures now have real drafts: `lib/ai-coach/artifacts/drafts/evidence-registry.draft-unsigned.v1.json` (9 claims) and `escalation-templates.draft-unsigned.v1.json` (15 templates), with loaders mirroring `loadDraftUnsignedExerciseCatalog` (strict parse, refusal when `NODE_ENV === "production"`, review states in the file envelope rather than in the hashed content). **Engineering authored structure, not content.** No evidence claim states what a source says: each records that the draft policy bundle already cites that source and that Steadfast has not verified it, `reviewer.name`/`qualifications` are the fixed `UNREVIEWED_DRAFT_*` sentinels, and a unit test re-derives every `sourceUrl` and rule binding from the bundle so this file cannot introduce a citation the bundle does not already carry. Client-facing copy carries no digit and no spelled-out number, never implies a human is reviewing (v1 has none), makes no diagnosis and implies no urgency; all five rules are mechanical in `tests/unit/ai-coach-evidence-escalation-drafts.test.ts`, each red-proved by mutation. The template set covers every `AutonomyGateReasonCode`, every `PrescriptionReasonCode` and every reason code the draft bundle's `safetyControls` can emit, and array order is pinned because `resolveNextActionTemplateId`'s degraded lookup is a `find`. Three clinical values are deliberately absent and fail closed (T-2039's pattern): no `TRAINING.EFFORT.STRENGTH.V1` or `TRAINING.EFFORT.CARDIO.V1` copy, so `resolveTrainingParameters` returns `TRAINING_EXPLANATION_TEMPLATE_UNAVAILABLE`, and no prescription explanation text, so `computePrescription` returns `PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE`. One placeholder claim is present rather than absent, `CLAIM.PENDING.NUTRITION_EVIDENCE_RULE`, because `assertEvidenceRulesHaveClaims` throws inside the gate transaction (a 503 with no decision row) and no publication-path check catches the gap; its own text says no evidence has been supplied. The draft bundle's `escalationTemplateIds`, screening binding and five contraindication bindings were re-pointed from `synthetic-pause-refer-template` (an id only a synthetic artifact carries, so it could never satisfy a live launch) to these templates; no parameter, value or rule id changed. Nothing is registered and no caller exists: G01/G03 have not happened. Reviewer handover: `docs/ai-coach/18-Evidence-and-Escalation-Drafts.md`.

**T-2041 — the run snapshot carries its runtime artifact binding (2026-09-27):** `requestAiRun` now resolves the runtime artifact set **once**, before its transaction opens, through T-2000's `resolveAiCoachRuntimeBinding` plus the new `resolveRuntimeArtifactSet` (`lib/ai-coach/runtime-binding.ts`), and freezes it into the run snapshot as one key, `runtimeBinding`. The executor, a retry, the weekly replay and finalization all read that stored truth instead of re-deriving the binding from a constant or from a fresh resolve; `managed-executor.ts` no longer calls `resolveAiCoachRuntimeBinding` + `loadReviewedArtifactSet` at execution time for a bound run and instead re-loads the snapshot's **exact five references** under the lock it already took (`loadRunBoundArtifactSet`, additive in `artifacts/repository.ts`), so a revoked, expired, superseded, reclassified or digest-mismatched artifact fails the run closed under a named reason (`TEMPORARILY_UNAVAILABLE`, the same mapping `composeManagedInitialPlan` already used) before any candidate is written. `finalization.ts` compares the frozen `artifactRefs` against the set it has just loaded for the account and raises `VALIDATION_ERROR` 422 "The proposal was prepared against different reviewed content." when the reviewed content rotated under a pending proposal — the same class as the existing `candidate.policyVersion` 422 above it, and deliberately *not* the client-input class T-2033 routes to a HOLD. **The key is `.optional()` and never `.default()`**: a default would materialise a key absent in stored JSON and move three hashes at once — `AiCoachRun.businessKey`, `AiPlanVersion.validationReport.inputHash` (re-derived at `weekly-proof.ts:13`, so every existing weekly candidate would become un-acceptable) and `retry-command.ts`'s re-store, which would write the default permanently into a legacy row. The four top-level fields (`synthetic`, `policyVersion`, `catalogVersions`, `modelConfiguration`) were **widened in place, not removed** — the object is `.strict()`, so deleting them would make every stored snapshot fail to parse — and a new `superRefine` makes a mixed snapshot unrepresentable: with no binding the four must be exactly today's fixture constants (precisely the old `z.literal` strictness), with a binding they must equal the binding's, whose own schema requires one exact reference per kind carrying the very keys it claims. Golden proof that nothing moved: `contentHash(runSnapshotSchema.parse(legacy))` is pinned in `tests/unit/ai-coach-run-snapshot.test.ts` at `f0996c93…` — captured from the pre-change schema at base commit `7bd49f1` — and asserted again as a QUEUED-across-deploy replay in `tests/integration/ai-coach-managed-executor.test.ts`. **One deliberate degrade:** a FIXTURE binding whose synthetic artifact set is simply not published in this environment (`ARTIFACT_MISSING`/`ARTIFACT_NOT_EFFECTIVE`) writes the legacy unbound snapshot and fires `ai_coach.run.runtime_binding_unavailable`; it cannot reach a real account, because FIXTURE mode requires `requireFixtureRuntime()` (never production) and every LIVE failure is raised. A **new synthetic run in an environment that does publish the fixture set gets a different `businessKey`** than the byte-identical request made before this change (its snapshot gains a key); stored rows are untouched. `plan-contract.ts`'s `LIVE_COMPOSITION_UNAVAILABLE` is still written by nobody — `managed-executor.ts:162` *throws* it for any non-synthetic account before the snapshot is parsed (T-2000 review finding 2), so live composition remains blocked and the reason reaches the client as `AiCoachRun.lastError`, not as a `resultDecision`. **Rollback caveat (the release packet must state this in bold):** the reverted `.strict()` schema rejects the unknown `runtimeBinding` key, so any run created between deploy and revert would fail to parse in the executor, a retry and `weekly-proof`; pair the revert with `UPDATE "AiCoachRun" SET "inputSnapshot" = "inputSnapshot" - 'runtimeBinding' WHERE "inputSnapshot" ? 'runtimeBinding';`. No Prisma change, no migration, no purge line. REST and Swift contracts unchanged. New tests: `tests/unit/ai-coach-run-snapshot.test.ts`, `tests/integration/ai-coach-live-generation-binding.test.ts`.

**T-2039 deterministic training/cardio composer with bundle-parameterised dose, workload caps and reserved progression IDs, 2026-09-26:** `composeTraining` (`lib/ai-coach/training/index.ts`) implements the 14-step frozen composition order and is now the single producer of prescribed session structure, exercise selection, dose parameters, cardio volume, and workload caps for v2 initial plans. Dose (sets, reps, rest seconds), exercise counts, session durations, cardio frequencies, and weekly workload caps are strictly parameterised from policy bundle values (`TRAINING.DOSE.*`, `CARDIO.DOSE.*`, `WORKLOAD.*`) and template effort text; files under `lib/ai-coach/training/` contain NO numeric literals other than `0`, `1`, and `7`, and no string literals > 30 chars outside reason codes, parameter IDs, and imports, verified mechanically via TypeScript AST analysis. In v2 `composeInitialPlan`, `composeTraining` replaces hard-coded exercise constants, failing closed with empty strength/cardio sections and structured reason codes on missing inputs, unsupported versions, missing parameters, uncatalogued templates, or contraindications lacking substitutes, while the legacy v1 fixture composer (`composeLegacySyntheticPlan` / `buildInitialFixturePlan`) remains byte-identical. All 46 parameters (34 composer + 12 progression) are populated with synthetic values in `synthetic-fixtures.ts`, and the draft nutrition policy bundle is updated with 11 proposed training parameters while 23 dose parameters and 12 progression parameters remain omitted awaiting qualified review per Section 4 of `17-Policy-Parameter-Catalogue.md`. Nothing reaches production clients: the draft exercise catalog version `exercise-beginner-v1` is disabled by default in production and rejected by the loader, and the unsigned draft bundle cannot be published. A 630-case matrix test confirms every combination of equipment tiers, training days (1..7), experience levels, and duration bands composes cleanly and validates against `planPayloadSchema`.

**T-2040 catalog references resolve by key, 2026-09-26:** `lib/ai-coach/catalog/loader.ts` becomes an explicit key -> map registry with a third lookup error, `CATALOG_VERSION_NOT_SERVED`, plus `foodCatalogIsServedInCode` / `exerciseCatalogIsServedInCode`. The in-code catalogs are now understood as the fixture keys this build happens to carry; **the reviewed artifact set is the authority for any key it does not carry** (`artifacts/repository.ts`'s `getReviewedFoodItem` / `getReviewedExerciseItem`, reached through `autonomy/gate.ts`'s `catalogItemsValid`). So `planPayloadSchema.superRefine` no longer marks a payload invalid merely because it is bound to a catalog this build cannot resolve: it still rejects `UNKNOWN_ID` and `CATALOG_VERSION_MISMATCH` inside a served catalog, still checks the plan-binding (`catalogVersion !== plan.catalogVersions.*`) first and unconditionally, and only swallows `CATALOG_VERSION_NOT_SERVED`. Before this change a plan bound to a live reviewed catalog could not be represented at all, and the failure was not a rejected write but a blank screen on nine read paths (`validated-plan.ts`, the workspace `activePlan` and `equivalent`, `availableSubstitutions`, `workouts/ai-session.ts`, `nutrition-safety.ts`'s `readNutritionHistory` — where a parse failure becomes `UNVERIFIABLE` and a permanent HOLD — finalization/acceptance, and the constrained-provider boundary). Three behaviour changes follow from routing by key and are asserted in `tests/unit/ai-coach-catalog.test.ts`: an unrecognised key (`food-fixture-v0`, `exercise-fixture-v0`) and the unavailable T-2038 draft key now report `CATALOG_VERSION_NOT_SERVED` where they reported `CATALOG_VERSION_MISMATCH` or `UNKNOWN_ID`; every one stays `success: false` and none throws. **Exercise-modality authority moved to the reviewed artifact:** `catalogItemsValid` now throws when a strength slot holds a non-`STRENGTH` item or a cardio slot a non-`CARDIO` one, landing on the existing `GATE_CANDIDATE_INVALID` through the existing `catch` — no new reason code, no `GATE_ORDER` or `validationReport.checks` change — so relaxing the schema loses no guarantee and the artifact path is strictly stronger than before. `representation.ts` stops comparing and rewriting `FOOD_CATALOG_VERSION`: a substitution is validated against the plan's own `catalogVersions.food`, the MEALS branch refuses (`NO_FEASIBLE_MEALS`, never a throw) to compose fixture meals into a plan bound to another catalog, and the two `payload.catalogVersions.food = FOOD_CATALOG_VERSION` re-labelling assignments are deleted. `plan-contract.ts` widens `contentKind` to `z.enum(["SYNTHETIC_FIXTURE", "REVIEWED_LIVE_V1"])` and appends `LIVE_COMPOSITION_UNAVAILABLE` to `decisionSchema.reasonCodes`; both are additive and nothing writes either value until T-2041. **No stored row changes meaning:** every existing payload uses `food-fixture-v1`, `food-fixture-v2` or `exercise-fixture-v1`, all served, and golden content hashes for the synthetic corpus captured from the pre-change code at `408bf8f` are asserted unchanged in `tests/unit/ai-coach-plan-contract.test.ts` and `tests/unit/ai-coach-representation.test.ts`. No Prisma change, no migration, no purge line. REST and Swift contracts are unchanged. New read-path proof: `tests/integration/ai-coach-live-catalog-binding.test.ts`.

**T-2036/T-2021 meal-template review fixes and macro-fit solver, 2026-09-27:** the draft meal-template artifact now keeps all 20 ingredients backed by raw USDA records at `state: "RAW"`; the 19 affected templates explicitly say `weigh raw`, so the displayed state and nutrient basis cannot diverge. `requiresReviewerPortion` is enforced as a strict iff: a direct food range uses `DEFAULT_100G_BAND` or extends above 300g, both requiring RD triage. The template composer now scores complete slot combinations against all four daily macro targets before selection, solves ingredient grams with deterministic box-constrained weighted least squares, refines the rounded 5g lattice, and retains the best visited iterate. It still returns no week unless every rounded day passes all four tolerances and final source-aware composition re-verification. The realistic 2200 kcal / 150g protein / 250g carbohydrate / 70g fat case composes at 10%; low- and high-energy targets select different slates. Tests now directly exercise the step-5 re-verification phase, answer-owned allergy merging, tri-state allergens, mandatory vegan/pescatarian/omnivore filtering, repeat limits, truthful failure macros and grocery aggregation. The artifact remains `DRAFT_UNSIGNED`; no production caller supplies the template options bag and no route, database, payload or iOS contract changed.

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
| T-2028    | A03v2   | Web UX replacement for T-2024's wizard: four card-based steps with intuitive selections, compact one-time safety disclosure, deterministic v2 mapping with unasked governed fields left `UNKNOWN`, existing `ALLERGIES` + `CONFIRM_INTAKE` transport, and success-only redirect to the AI Coach home. No schema, backend, database or iOS change. |
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

**T-2009 (2026-09-28, shipped as S-18):** a newly requested run no longer waits for the daily sweep.
`POST /api/client/ai-coach/runs` and `POST /api/client/ai-coach/runs/[runId]/retry` schedule a
post-response drain of **that one run id** with `after()` from `next/server`
(`lib/ai-coach/kick.ts` → `drainRunNow`, `lib/ai-coach/executor.ts`); both routes carry
`runtime = "nodejs"` and `maxDuration = 120` (15s request phase + 45s `PROVIDER_TIMEOUT_MS` + 45s
for the rest of `processManagedRun`, and above the 90s lease so a drain that finishes does so inside
its own lease). Rules that must survive any future edit:
- **The kick never double-executes.** It claims through the same `claimQueuedRun` conditional update
  (`{ id, status: "QUEUED", fencingToken }`, `attempts` incremented in the same statement) that the
  cron sweep uses, so exactly one of {kick, sweep, second kick} wins and the losers do nothing.
- **The kick never writes FAILED and never reconciles.** A drain that faults after claiming leaves
  the row RUNNING with a lease; the sweep's `reconcileExpiredRuns` is what recovers it. It also
  never selects rows and never touches an id but its own — it is not a second sweep.
- **The cron is the durable floor and is unchanged** (`5 4 * * *`). Nothing may assume the kick ran;
  the UI keeps polling exactly as before.
- **Inert while `FEATURE_AI_COACH_GENERATION` is unset**, on two layers: `requestAiRun` throws
  before creating a row, and `drainRunNow` returns `"flag_disabled"` before any database access. The
  no-deploy kill lever is the existing `AiCoachOperationalControl` GENERATION/PROVIDER row, which
  stops the kick in the same call it stops the sweep.
- **`after()` throws synchronously at the call site** with no request scope (Next E468) or no
  `waitUntil` (E91) — including under vitest. `scheduleRunDrain` catches that, emits one
  `sf.aicoach.run_kick` beacon with `outcome: "schedule_unavailable"`, and run creation is
  unaffected. Beacon allow-list is frozen at `["outcome", "runKind"]`; no failure reason, no ids.

**S-16 (2026-09-28):** `CONFIRM_INTAKE` (v2) now defaults the seven bookkeeping status fields to
`UNKNOWN` server-side when they are absent (`applyIntakeV2ConfirmDefaults`,
`lib/ai-coach/intake-contract.ts`, called from `confirmIntake`). `UNKNOWN` is the restrictive value
— the governed values must then be absent and personalized nutrition stays pending. It only ever
fills what is absent (missing/`undefined`/`null`), never overwrites an answered status, and never
infers `CONFIRMED` from the presence of a governed value. **No clinical or safety field is
defaulted**: `allergenDeclarations` (still a hard 422 when absent, still hash-compared against the
saved draft), `dietaryPattern`, `dislikes` and `cuisinePreferences` stay required, because "no
pattern declared" and "no dislikes" are the *least* restrictive states and a default there would
silently widen what a plan may contain.

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
  catalog/food-source.ts        T-2036 FoodCatalogSource interface, inCodeFoodCatalogSource, sourcedFoodCatalogSource
  catalog/meal-template-schema.ts T-2036 mealTemplateSchema, portionRangeSchema, substitutionGroupSchema, superRefine
  meal-composer.ts              T-2036/T-2021 composeWeekFromTemplates, macro-aware combination scoring and bounded solver
  grocery.ts                    T-2036 buildGroceryList and GroceryLine with purchase vs consumed quantities
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
  executor.ts                   A05  runExecutorSweep / processClaimedRun / drainRunNow (T-2009) / defaultModelProvider
  kick.ts                       T-2009 runIdOf + scheduleRunDrain — the ONLY lib/ai-coach file that imports next/server
  run-status.ts                 A05  getRunStatusForClient — safe minimized DTO
  plan-acceptance.ts            A10  acceptPlanVersionAtomic / declinePlanVersion — THE real acceptance service
  acceptance-notifications.ts   T-502 drainAcceptanceNotifications — bounded outbox drain phase in runExecutorSweep
```

### Routes

```
app/api/cron/ai-coach-executor/route.ts             A05  authenticated sweep trigger — scheduled daily at 04:05 UTC (T-503, `5 4 * * *`), maxDuration=180, no-op while flag unset
app/api/client/ai-coach/runs/route.ts                A02/T-2009 creates the run, then schedules the post-response drain; nodejs, maxDuration=120
app/api/client/ai-coach/runs/[runId]/retry/route.ts  A05/T-2009 same shape; kicks the NEW retry run id
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
tests/unit/ai-coach-run-kick.test.ts                 T-2009 (16 tests, no DB needed — runIdOf, scheduleRunDrain, source guards)
tests/integration/ai-coach-run-kick.test.ts          T-2009 (8 tests — claim idempotency with the sweep, torn-down kick recovery, flag/pause inertness)
tests/unit/ai-coach-intake-confirm-defaults.test.ts  S-16   (9 tests, no DB needed — the seven status defaults)
tests/integration/ai-coach-intake-wizard-confirm.test.ts S-16 (4 tests — the four-step wizard's real command sequence confirms cleanly)
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
`nutrition-totals.ts` gives raw per-food gram totals; T-2036 provides
`buildGroceryList` in `lib/ai-coach/grocery.ts` to turn that into practical
purchasable quantities derived solely from reported source facts). Mode switch (macro ⇄ meals) must keep exactly one prescription
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
`PRESENT` or `UNKNOWN` and `UNKNOWN` fails closed downstream. **A09/A07 reads
`allergenFactsV2`, not `allergenFacts`:** the legacy struct cannot express
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
what keeps `Spinach souffle` out of a vegan client's catalog.

T-2036 builds the meal-template model (`lib/ai-coach/catalog/meal-template-schema.ts`),
checked-in draft template set (`lib/ai-coach/artifacts/drafts/meal-templates.draft-unsigned.v1.json`),
deterministic coordinate solver (`lib/ai-coach/meal-composer.ts`), substitution
group resolver (`lib/ai-coach/representation.ts:substitutionOptionsFor`), and
grocery aggregator (`lib/ai-coach/grocery.ts`). When pattern or budget constraints
produce no feasible slate, the composer returns structured failure reasons (`NO_FEASIBLE_MEALS`)
with the affected slot and worst macro rather than an empty screen, degrading gracefully.

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

### T-2007 — bundle-driven weekly controller (2026-09-28)

Weekly review parameters are now resolved from the run-bound policy artifact and frozen into an optional `weeklyPolicy` snapshot block. New weekly runs therefore replay without live policy selection; acceptance re-loads the exact policy reference and verifies the resolved parameter digest. Historical snapshots keep their hashes because the new field has no default and fail closed for new weekly proposals.

Energy changes support the reviewed `REESTIMATE_FROM_CURRENT_WEIGHT` method through the T-2003 prescription engine, with minimum-energy, cooldown, per-review, and cumulative limits. Schedule simplification can use a frozen T-2039 recomposition at fewer days; session dropping remains restricted to the synthetic fixture. Evidence sufficiency now counts qualifying check-ins by canonical week using bundle-defined completeness and missing-week thresholds. The unsigned draft declares these methods but omits all weekly values, so live use remains unavailable pending qualified review.

### S-33 — four onboarding honesty fixes lifted from the T-2008 candidate (2026-10-02)

An architect audit of the abandoned `team/T-2008-ai-coach-onboarding-reliability-candidate` branch
(`556b980`, see `board/tickets-archive/T-2008.md`'s "Overlap audit") found four small, independent fixes
worth keeping even though the candidate's larger redesign (executor-side finalization, the
discovery/chooser rewrite, weekly-evidence-rule scoping, the every-minute cron) was rejected. This
ticket hand-lifted exactly those four onto `team/sprint-1`:

1. **`foodBudgetLevel` is now an asked question, not an invented default.** The wizard previously wrote
   `foodBudgetLevel: "MODERATE"` into every `CONFIRM_INTAKE` regardless of what the client chose
   (`components/ai-coach/intake-wizard.tsx`'s `mapSelectionsToAnswers`), silently narrowing which meal
   templates (`lib/ai-coach/catalog/meal-template-schema.ts`'s `budgetBand` filter) a plan could draw
   from. The wizard now asks ("Food budget": Budget-conscious / Moderate / No preference) in stage 2,
   requires a choice before continuing (`intakeStepIssues`), and `mapSelectionsToAnswers` omits the key
   entirely when unset. Because `foodBudgetLevel` is a required (non-optional) field in both
   `intakeAnswersSchema` and `intakeV2ConfirmObjectSchema` (`lib/ai-coach/intake-contract.ts`), an intake
   that reaches `CONFIRM_INTAKE` without it already degrades correctly today: `confirmIntake`
   (`lib/ai-coach/intake.ts`) returns `{ success: false }` from its `safeParse`, and
   `client-commands.ts`'s `CONFIRM_INTAKE` branch turns that into a 422 `VALIDATION_ERROR` ("Complete the
   intake before confirming.") — never a 500. No server change was needed for this; only the client had
   to stop manufacturing an answer and start requiring one.
2. **Three invented clinical claims removed from the wizard's copy**: "clinical DRI equations" / "BMR &
   TDEE" (final-stats intro), "≥2.0g/kg" (the High Protein dietary option), and "PAR-Q" (the safety-check
   intro), plus the emoji-led "Both tracking styles provide exact ingredient measurements" claim and the
   goal-card descriptions' specific physiological promises ("preserve lean muscle tissue", "controlled
   caloric surplus", etc). Nothing in the product computes a DRI equation, enforces a protein ratio, or
   runs a named screening instrument — this was G01/G09 territory asserted as settled fact. Replaced with
   neutral, non-clinical copy; no `PENDING_G01_WORDING` placeholder was touched.
3. **The intake wizard resumes at the first incomplete stage**, not always stage 1. `firstIncompleteIntakeStage`
   walks stages 0–2's `intakeStepIssues`; stage 3 is the only remaining destination once those are clean,
   because it owns body-stat validation, the safety prerequisite and final review and there is no stage
   after it — so a complete draft always resumes there regardless of whether the safety disclosure is
   itself still outstanding (stage 3's own render handles that). The candidate's version of this function
   had a dead tail (both branches of its final `if` returned the same literal `3`, so its
   `safetyDisclosureCompleted` argument never changed the result); the lifted version keeps the parameter
   for callers' clarity but documents and `void`s it rather than pretending it discriminates between two
   outcomes that cannot exist on a four-stage wizard. S-19's dead-end fixes (the unliftable-restriction
   explanation, the relabelled confirm button, disclosure-row-derived `needsSafetyDisclosure`) are
   untouched.
4. **`nextAttemptAt` on workspace runs.** `getAiWorkspace`'s run projection (`lib/queries/ai-coach.ts`)
   now adds `nextAttemptAt: run.status === "RETRY_WAIT" ? run.leaseExpiresAt?.toISOString() ?? null :
   null` next to S-26's `attempts`/`lastError`/`maxAttemptsPerRun` — additive, one nullable field, no
   schema or migration change (`failRunAttempt` already wrote the retry instant into `leaseExpiresAt`,
   `lib/ai-coach/runs.ts:96`). S-26's RETRY_WAIT card (`components/ai-coach/experience.tsx`) shows it as
   **"Eligible to retry after `<local time>`"** when present, alongside the existing attempt-count
   sentence — never absent when `nextAttemptAt` is null, and never "scheduled for" or "will retry at":
   the executor sweep is a daily cron in production today (S-32 §1 is undecided), so the only honest claim
   is when the run *becomes eligible*, not when it will actually run.

**Deliberately not lifted** (per the audit and the ticket's hard fence): the weekly-evidence-rule scoping
in `finalization.ts`/`gate.ts` (contradicts S-29 and does not fix its P0), `capabilities.ts`'s hardcoded
kill switch, the executor cron cadence change, executor-side finalization and the deleted "Run final
safety checks" button (would strand `PENDING_FINALIZATION` proposals — no replacement trigger exists on
sprint-1), any `PENDING_G01_WORDING` replacement, the T-2025 five-stage walkthrough test deletion, and the
entire iOS commit (`a3c025e` adds `prepareInitial`/`representation` to every ENROLL command; sprint-1's
ENROLL schema is `.strict()` and would 422 it outright). `lib/ai-coach/finalization.ts`, `gate.ts`,
`managed-executor.ts` and `vercel.json` were not touched. (The `AiDiscoverySurface`/`/client` chooser
rewrite itself *was* lifted — separately, as its own ticket, shape-only and without `capabilities.ts` — see
S-34 below.)

No schema change, no migration, no new dependency. Files touched: `components/ai-coach/intake-wizard.tsx`,
`lib/queries/ai-coach.ts`, `components/ai-coach/experience.tsx`, plus test fixtures in
`tests/unit/ai-coach-intake-wizard-confirm-payload.test.ts`, `tests/unit/ai-coach-intake-wizard-round3.test.ts`,
`tests/unit/ai-coach-intake-wizard-stages.test.ts`, `tests/unit/ai-coach-experience.test.ts` and
`tests/integration/ai-coach-intake-wizard-confirm.test.ts` (all needed `foodBudgetLevel`/`nextAttemptAt`
added to fixtures that previously relied on the behaviour this ticket removed). Gates: full suite on a
freshly replayed local DB, same 7 pre-existing failures as the documented baseline (6×
`ai-coach-weekly-trajectory` `P2002`, 1× `ai-coach-beginner-workflow` timezone — S-30), unit 1856 passed
(1846 baseline + 10 new), `pnpm run type-check` clean, `eslint` clean on every changed file.

### S-34 — `/client` coaching chooser, web/iOS parity (2026-10-02)

iOS `team/sprint-1` already renders a chooser from a live discovery offer
(`ClientProviderModel.phase` returns `.aiDiscovery(offer)`,
`ClientTabView` renders `AICoachDiscoveryView`); web's six client route
guards instead treated any offer as a provider switch and handed an
offer-state client the whole AI workspace. This ticket makes web match iOS's
phase ordering — no wire change, no iOS change.

1. **Two pure predicates carry the whole routing decision**, exported from
   `lib/queries/client-provider.ts` (additive; `getClientProvider`'s body and
   return keys are untouched): `rendersAiWorkspace(provider)` —
   `origin === "AI" || (aiPreviewAvailable && !aiDiscovery)` — and
   `rendersCoachingChooser(provider)`, a type guard —
   `!resolutionRequired && origin !== "AI" && aiDiscovery !== null`. All six
   guards (`app/client/layout.tsx`, `app/client/page.tsx`,
   `app/client/plan/page.tsx`, `app/client/training/page.tsx`,
   `app/client/meal-plan/page.tsx`, `app/client/check-in/page.tsx`) now call
   `rendersAiWorkspace` instead of each inlining
   `origin === "AI" || aiPreviewAvailable` — `grep -rn aiPreviewAvailable
   app/ lib/ components/` after this ticket finds only the computation, the
   predicate and tests. The synthetic-fixture-preview population
   (`syntheticPreviewAvailable`) keeps today's takeover unchanged; only a
   client with a **live** offer moves, and only on `/client` — the four tabs
   fall through to their existing NONE branch, unchanged copy.
2. **The chooser is `components/ai-coach/coaching-chooser.tsx`** (new),
   `AiCoachingChooser({ offer, aiPreparationState })` — not `"use client"`,
   not `async`, type-only imports of `AiCoachDiscoveryOffer`
   (`lib/ai-coach/discovery.ts`) and `AiCoachDeliveryState`
   (`lib/ai-coach/operations.ts`) so it stays a leaf a Server Component can
   render without pulling `lib/db.ts` into any bundle that needs this shape
   (the `intake-contract.ts` leaf-module lesson). Rendered only from
   `app/client/page.tsx` when `rendersCoachingChooser(provider)` is true; the
   `await getGenerationDeliveryState()` call sits inside that branch, so a
   client with no offer costs nothing extra. All three non-`"ENABLED"`
   delivery states render byte-identically — one neutral
   `role="status"` notice ("AI coaching cannot prepare a plan right now.")
   — because `lib/ai-coach/discovery.ts` already freezes "any gate failure is
   indistinguishable from unavailable"; the AI CTA is never disabled or
   removed. No `capabilities.ts` and no `lib/ai-coach/discovery.ts` change —
   S-32 §2's rejection stands.
3. **`getGenerationDeliveryState()`** (`lib/ai-coach/operations.ts`,
   additive) is a structural copy of `getAcceptanceDeliveryState` for the
   `GENERATION` scope: `isAiCoachGenerationEnabled()` first (zero DB access
   when the flag is off), then `assertAiCoachOperationEnabled("GENERATION")`.
   `AcceptanceDeliveryState` becomes an alias of the new
   `AiCoachDeliveryState` union; its 10 existing references are unaffected.
4. **Not lifted from the candidate** (`556b980`): the invented frame copy
   ("Review both options before choosing…", "Work with a coach"), the
   `offer.releaseId === "synthetic-preview-release"` string match and its
   paragraph, `/client/ai-coach/intake` as the AI destination (uses
   `/client/ai-coach/start` instead — the path `/ai-coach` already
   deep-links and the one in the `/client/ai-coach/[[...path]]` allow-list),
   and the deletion of `syntheticPreviewAvailable`.

No schema change, no migration, no new dependency, no iOS change
(`build_order: web-only`). Files: `lib/queries/client-provider.ts`,
`lib/ai-coach/operations.ts`, `components/ai-coach/coaching-chooser.tsx`
(new), `app/client/page.tsx`, `app/client/layout.tsx`,
`app/client/plan/page.tsx`, `app/client/training/page.tsx`,
`app/client/meal-plan/page.tsx`, `app/client/check-in/page.tsx`. Tests:
`tests/unit/ai-coach-coaching-chooser.test.ts`,
`tests/unit/client-provider-routing.test.ts`,
`tests/integration/client-coaching-chooser.test.ts` (includes the frozen
nine-key contract freeze for `GET /api/client/coaching-context`, case A — a
governance-disabled `GENERATION` control row, with the flag on, produces
`aiPreparationState === "PAUSED"` exactly, and `renderToStaticMarkup` of the
real `AiCoachingChooser` with the page's own props still contains the
`/coaches` link — and case A2, the same for an unset flag producing
`DISABLED_BY_FLAG`), `tests/browser/ai-coach-coaching-chooser-evidence.mjs`.
(Round-1 review finding 1/2: the first committed version of case A only
disabled the control row without stubbing `FEATURE_AI_COACH_GENERATION`, so
it passed via the flag check, never the pause, and this paragraph's earlier
wording claimed coverage that did not exist. Fixed in round 2.)

### S-31 — food catalog version 2, unsigned draft (2026-10-02)

24 `foodState: "COOKED"` records (5 pork, 4 beef, 7 chicken, 6 turkey, 2 tuna — not "chicken and
turkey" as the ticket's own framing said; corrected in the worksheet) sat uncommitted in
`wt/T-2042-cooked-foods` for five days from a 2026-09-27 ingest rerun, alongside the 232 items S-17
signed as v1. The lead committed the worktree output as `aff0f71` on `team/T-2042-cooked-foods`
without merging it (a signed artifact's content cannot change under its signature), and Jaden decided
to adopt. This ticket builds `content.version: 2` of the `food-catalog` artifact as a new
**DRAFT_UNSIGNED** file, `lib/ai-coach/artifacts/drafts/food-catalog-fdc.v2.draft-unsigned.v1.json`,
loaded by the new `loadDraftUnsignedFoodCatalogV2()` (`artifacts/drafts/loader.ts`) — v1's file, loader
and signed `reviewMetadata` are untouched.

Built by a one-shot script (not committed, the S-25 pattern), never hand-typed: load v1 verbatim, load
`aff0f71`'s copy of the catalog via `git show`, assert the 24 new ids are absent from v1 and present in
source, append them after v1's own 232 items (not the source commit's restamped copies of them — see
below), write `proposalProvenance` rows naming the source commit, the ingest date and each FDC id in
the same five-field shape v1's rows use. `tests/unit/ai-coach-food-catalog-v2-draft.test.ts` (6 tests)
pins the two digests (computed via `contentHash`, pasted from stdout), asserts the 232 carried items
are `toEqual` v1's own items, and proves the read-path split: `sourcedFoodCatalogSource` resolves a
sample id at `food-catalog:v2` and reports `UNKNOWN_ID` for the same id at `food-catalog:v1`.

**Finding: `aff0f71`'s own 232 carried items are not byte-identical to v1.** The 9/27 rerun restamped
`source.reviewedAt`, `sourceRecord.retrievedAt` and every `allergenFactsV2.categories[].verifiedAt` on
all 256 items, including the 232 that didn't otherwise change. v2 therefore takes the 232 from v1
itself, not from the source commit, to honor "byte-identical carryover" literally.

**Composition is unaffected, measured not assumed:** the validation harness run before and after
building v2 produced byte-identical output across the 4064-profile grid (1 `COMPOSED_WITH_MEALS`, 496
`MACROS_ONLY`, 3567 `UNAVAILABLE`, 0 `THREW`) — the real composer path (`composeMealsToPrescription`
called with no `options`, `representation.ts:112` / `initial-plan.ts:652`) never reaches the FDC
catalog at any version; it is hard-wired to three fixture ids against the synthetic fixture catalog.
The template-based path that could read the FDC catalog (`meal-composer.ts`'s
`composeWeekFromTemplates`) is reached by no live caller, and the T-2036 meal-template draft (29
distinct referenced FDC ids, independently re-scanned) names none of the 24 — T-2036 is not blocked on
this ticket.

**Judgment call, not a stop:** the artifact *database* model (`AiCoachArtifactVersion`, keyed by
`(artifactKey, version)` with `state`, `orderBy version desc`) already supports multiple versions per
key; only the file loader hard-coded one filename per module, which is additive to fix (a sibling
constant and function), not a schema redesign — so this ticket did not stop on the "exactly one version
per key" question the spec raised.

**Not adopted into the working tree:** the allowlist/coverage-plan deltas in `aff0f71` (24 more
allowlist entries, one new coverage-plan category `COOKED_PROTEINS`). Applying them breaks an existing
pinned unit test asserting the plan has exactly ten category ids
(`ai-coach-fdc-curation.test.ts`, "every derived categoryId is one of the coverage plan's ten ids").
Neither file is read by any runtime path (grep-confirmed: only ingest tooling and tests), and the
ticket's stated deliverable is the catalog version plus the worksheet, so this was left as a named,
unresolved delta rather than silently widening the ticket by editing an unrelated pinned test.
`fdc-source-exclusions.v1.json` carries no substantive delta at all (same 13 excluded ids, same
reasons; only timestamps moved), so nothing there was adopted either.

Worksheet: `board/CATALOG-WORKSHEET-v2.md` (the 24 records' macros/allergens/provenance, both digests,
the exact `reviewMetadata` fields Jaden changes to sign — `decision`, `reviewedAt`, `reviewRecordId`,
with everything else carried from v1's signed record unchanged). No migration, no network, no new
dependency, no iOS change. Gates: `pnpm run type-check` clean; `pnpm exec vitest run tests/unit`
1876 passed / 0 failed / 119 files (baseline 1870/118, +6 new tests, zero regressions, including a
full re-run of the `ai-coach-fdc-*` suite after reverting the two auxiliary-file edits); `eslint` clean
on both changed files; harness before/after byte-identical (see above).

**Round 2 (review findings):** round 1's `proposalProvenance` held only the 24 new rows for 256 items
— 232 items had none, violating the same invariant v1 is held to
(`assertProvenanceCoversEveryItem`, pulled out of `ai-coach-fdc-allowlist.test.ts` into
`tests/helpers/food-catalog-provenance.ts` and pointed at v2 directly, replacing a weaker sibling
assertion). Fixed: `proposalProvenance` is now v1's 232 rows byte-identical plus the 24 new rows, 256
for 256, rebuilt by the same one-shot script. `content` digest is unchanged
(`ff2f6a5…137510`); `reviewMetadata` digest moved to `1d3d1e2…de052` and is re-pinned. The worksheet's
signing section was rewritten to the exact final object derived from `schema.ts`'s two `.strict()`
discriminated-union shapes (5 fields deleted, several added/changed — not "three fields changed" as
round 1 said), `signoffScope[3]` now names both ingest runs (plural), and the species count was
corrected to 5 pork / 4 beef / 7 chicken / 6 turkey / 2 tuna in the worksheet and both docs (was
miscounted "8 turkey, 5 chicken" in round 1). The ingest CLI (`scripts/ai-coach-ingest-fdc.ts`) now
refuses to write `--out` over a file whose `reviewMetadata.decision` is `APPROVED` unless `--force` is
passed (`isSignedFoodCatalogFile`, `lib/ai-coach/catalog/fdc/signed-file-guard.ts`, one test in
`tests/unit/ai-coach-ingest-fdc-write-guard.test.ts`); the README's re-ingest examples now point `--out`
at a v2 path. Gates after round 2: `pnpm run type-check` clean; `pnpm exec vitest run tests/unit`
**1878 passed / 0 failed / 120 files**; `eslint` clean on every changed file; `doc_check.py` still 100.

### S-36a — four composer defects fixed so the template composer can succeed against a bound catalog (2026-10-06)

T-2036 shipped a general template composer (`meal-composer.ts`) and the real draft template set/catalog, but
nothing on the managed run path could actually compose a meal with them — four independent defects, each
confirmed by test on `team/sprint-1@faed556` before the fix:

1. **Equipment was set membership, not a capability lattice.** A client who declares `["FULL_KITCHEN"]` did not
   satisfy a `STOVETOP`/`OVEN`/`MICROWAVE` template, so `DINNER` (all 9 schedulable templates name an appliance)
   had zero survivors for every client, every time. Fixed with an exported `EQUIPMENT_PROVIDES` lattice in
   `meal-composer.ts` (`FULL_KITCHEN` provides every appliance plus `NONE`; the three single appliances provide
   only themselves plus `NONE`; `OVEN` does **not** imply `STOVETOP`) and `clientEquipment` built as the union of
   `EQUIPMENT_PROVIDES[e]` over the declared equipment. The per-template rejection reason/detail
   (`DIETARY_RESTRICTION_UNSATISFIED` / `EQUIPMENT_UNAVAILABLE`) is unchanged.
2. **The policy-usability check was always the one-argument, compile-time form.** `checkMealComposition` called
   `checkPolicyVersionUsable(policyVersion)` with no second argument, so a run bound to a real policy key always
   got `POLICY_UNKNOWN_VERSION`. `CheckMealCompositionInput` and `ComposeTemplatesInput` both gain an optional
   `runtimePolicyArtifactKey`, forwarded into the two-argument form T-2000 already added; omitted, nothing changes.
3. **The composer stamped the template's declared `catalogVersion`; the payload stamped the binding's key.**
   `meal-composer.ts`'s emitted `PlanPayload` ingredient used the template's own `"food-catalog:v1"` while
   `assembleV2Plan` stamps `catalogVersions.food = binding.foodCatalogVersion` (the artifact key, `"food-catalog"`)
   — `plan-contract.ts`'s per-ingredient binding check requires those equal, so the first successful composition
   would have **thrown** inside `planPayloadSchema.parse`, failing the run instead of degrading. Fixed with an
   optional `payloadCatalogVersion` on `ComposeTemplatesInput`: resolution during the solve still uses the
   template's own declared version (so the real catalog source still resolves every ingredient); only the
   *emitted* payload ingredient is restamped. A frozen binding-time check runs before any solve: when
   `payloadCatalogVersion` is supplied, the injected source's own `catalogVersion` must equal it or start with
   `` `${payloadCatalogVersion}:v` ``, else `CATALOG_REFERENCE_INVALID` with `{expected, actual}` — the
   "the template set and the catalog must be the same artifact" check on this side of S-36b.
4. **The options branch stamped compile-time constants (`ACTIVE_POLICY_VERSION` / `EXERCISE_CATALOG_VERSION`)
   into its own verification payload**, so a run bound to a real policy/exercise key verified against the wrong
   values. `ComposeMealsToPrescriptionOptions` gains optional `policyVersion` / `exerciseCatalogVersion` (default
   to the two compile-time constants, so the T-2036 unit corpus is unaffected); `composeMealsToPrescriptionWithReasons`
   resolves both once and uses them for the compose call, `runtimePolicyArtifactKey` (set to the SAME value as
   `policyVersion`, an identity by construction — see code comment for why that's safe), and the verification
   payload/`mealTargetsMatch` call, so none of the three can disagree.

**New shared mapper, `lib/ai-coach/meal-constraints.ts`** (`mealComposerConstraintsFromIntake`): the single,
pure function mapping a confirmed intake to `ComposeConstraints`, implementing S-36 decision 3's fail-closed
rules — no meal composition (block `COOKING_ACCESS_NOT_CONFIRMED` / `ALLERGENS_NOT_CONFIRMED`) unless cooking
access and allergen declarations are both `CONFIRMED`; `patternTags: []` when no pattern is declared or it is
`OTHER`/`NONE_DECLARED`; a dislike with `canonicalFoodId: null` is dropped and counted, never matched by label.
**S-36 decision 4 (whether a non-mandatory declared pattern should still hard-filter) is Jaden's, not decided
here** — the mapper passes `patternMandatory` through exactly as declared, with a comment citing the decision.

**`composeInitialPlan` gains an optional `mealComposer: { templateSet, source } | null` field.** Absent (every
production call site today — `managed-executor.ts` passes none), behaviour is byte-identical, asserted by test.
Present and `mode === "MEALS"`: the mapper runs first; on a block, `meals: null` with the prescription kept and
one of two frozen, non-clinical explanation/nextAction pairs (never a new decision reason code — the closed
`decisionSchema.reasonCodes` registry is untouched, the structured block travels only in `ComposeReason[]`,
read by tests/the harness); on success, the real composer runs against the supplied template set/catalog.
`composeLegacyMealsInternal` (the three-hard-wired-id path) gained one guard: it refuses (returning
`CATALOG_REFERENCE_INVALID`/`CATALOG_NOT_SERVED_IN_CODE`) when `foodCatalogIsServedInCode(foodCatalogVersion)`
is false, so a run bound to a reviewed catalog key can never silently fall back to the fixture ids.

**`representation.ts:112`** (named drift since T-2040/S-31): `composeMealsToPrescription(..., FOOD_CATALOG_VERSION)`
→ `composeMealsToPrescription(..., payload.catalogVersions.food)`. Proven a no-op by the existing golden-hash
test (`ai-coach-representation.test.ts`) passing unchanged: the `:85` gate four lines above already guarantees
`payload.catalogVersions.food === FOOD_CATALOG_VERSION` on every input that reaches line 112.

**Measured on the harness, not assumed (`scripts/ai-coach-validation-harness.ts`):** the primary table and its
run key are **byte-identical** to the pre-S-36a baseline — `3567 UNAVAILABLE / 496 MACROS_ONLY / 1
COMPOSED_WITH_MEALS / 0 THREW`, run key `e2360a4489c7e776a98437202db968add2d1d55443628f5981452f7d0657584c` —
because every harness v2 profile's `allergenDeclarations.status` is `UNKNOWN` (decision 3 fails closed on that,
same as today) and no production call site passes `mealComposer`. A **second, separately-labelled table**
("Composition against the reviewed catalog and template set") re-evaluates the same 4064 profiles with
`allergenDeclarations` overridden to `{ status: "CONFIRMED", noKnownAllergens: true }` — a stated measurement
assumption, not product behaviour — against the real draft template set (`meal-templates:v1`) and the signed v1
catalog (`food-catalog:v1`), through the real shared composer. Measured result: **6 of 4064 profiles compose**
(490 `MACROS_ONLY`, 3568 `UNAVAILABLE`, 0 `THREW`). All 6 composed profiles are tagged `VEGAN` with a mandatory
(hard-filter) pattern, **and all 6 sit at the body-weight grid's extreme low edge (40-41 kg, the bundle's
declared minimum)** — this is a boundary-stress-test artifact of the grid design, not a general finding that
vegan composes and omnivore does not at typical body weights; zero `OMNIVORE` profiles composed in this run.
This is the opposite of S-36's own nominal-carb/fat-share proxy prediction (which expected omnivore to compose
and vegan not to) — the proxy was explicitly flagged as a *necessary-condition* approximation, not a prediction,
precisely because protein (a third, independent constraint) and the real solver's rounding can move the result
either way. The honest ceiling is the content gap S-36 already named: the draft template set's achievable
macro combinations are narrow, and this is Jaden's content decision (S-36 decisions reserved, items 2 and 4),
not something this ticket's engineering widens.

Files: `lib/ai-coach/meal-composer.ts`, `composition-feasibility.ts`, `representation.ts`, `initial-plan.ts`,
`meal-constraints.ts` (new), `scripts/ai-coach-validation-harness.ts`. Tests:
`tests/unit/ai-coach-meal-composer.test.ts` (+6), `ai-coach-meal-constraints.test.ts` (new, 14),
`ai-coach-composer.test.ts` (+4), `ai-coach-representation.test.ts` (+2), `ai-coach-meal-templates.test.ts` (+2).
No migration, no Prisma change, no REST/Swift contract change, no iOS change. Gates: `pnpm run type-check`
clean; `pnpm exec vitest run tests/unit` — see `board/evidence/S-36a.md` for the exact counts; `eslint` clean on
every changed file; harness primary table/run key byte-identical (see above, re-run and diffed to confirm).
