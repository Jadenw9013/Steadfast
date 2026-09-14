# API and state contracts

**Normative proposal for implementation.** This file owns vocabulary and transaction semantics across the pack. Types below are contract sketches to implement as strict Zod schemas and inferred TypeScript types; they are not existing code. Clinical parameter values come only from an approved policy bundle. All IDs are opaque server-owned identifiers. Client-supplied `clientId`, `origin`, ownership, reviewer identity and decision classes never grant authority.

## Identity, revisions and evidence

`ClientCoachingContext(clientId UNIQUE, mode NONE|HUMAN|AI, activeCoachClientId?, revision, resolutionRequired)` is the single current-provider authority. Keep the profile and adjustment history across pauses and re-enrollment. Ambiguous legacy assignments set `resolutionRequired`; do not choose the first coach or delete relationships during backfill. Historical access is separately scoped to a consented relationship or conversation.

`AiCoachProfile(clientId UNIQUE)` contains confirmed intake/preferences, `profileRevision`, `observationRevision`, `safetyRevision`, fixed review timezone/schedule and `activePlanVersionId`. Use an allowlisted, versioned intake schema; raw form JSON is not a clinical profile.

| Field | Meaning and invalidation rule |
|---|---|
| `contextRevision` | Increments on authority changes. Any mismatch invalidates a pending activation. |
| `profileRevision` | Confirmed intake, goal or relevant preference changes. A new allergy cannot remain only in a pending draft. |
| `observationRevision` | Correction/invalidation epoch for edited, deleted or late evidence affecting the frozen review. Ordinary new logs after the snapshot cutoff do not increment it solely because they exist. |
| `safetyRevision` | Current reviewed safety assessment and per-domain permissions. Relevant new concerns immediately invalidate affected availability and proposals. |
| `sourceRefs[]` | Exact source ID/revision, source kind, unit, observation time and reporting completeness for evidence actually used. Corrections/deletions must be detectable at acceptance even if an aggregate epoch is accidentally unchanged. |
| `inputSnapshotHash` | Hash of minimized immutable input, source references, lookback, policy and catalog versions. A hash does not replace retaining enough authorized evidence to reproduce the decision. |

Do not reinterpret a missing field as zero, a missing workout as a failure, a subjective rating as measured intake, or user-confirmed visual food estimation as weighed food. Known values can be incorrect; record their provenance and allow correction.

## Time and cumulative limits

Two different intervals are required:

- `lookbackStart`, `lookbackEnd`, `snapshotCutoffAt`: observations summarized by the review, with documented inclusive/exclusive boundaries (`[start,end)`).
- `reviewWindowKey`, `activationStartsAt`, `activationEndsAt`: current window in which a proposed routine change may activate.

Example: a Monday review summarizes the previous week but spends the **current** week's adjustment slot. Binding acceptance to the already-ended lookback would make every proposal stale.

For the pilot, choose and retain one IANA review timezone at first enrollment. The activation window is local Monday 00:00 through the next local Monday 00:00, converted to UTC using a tested timezone library already available where suitable. DST means it is not always 168 hours. Key is that local Monday's `YYYY-MM-DD`, scoped by persistent client ID. Travel changes display timezone only. Freeze review timezone during the pilot; a later schedule migration must preserve overlapping/cumulative limits. Legacy `weekOf` still uses the repository's Monday-UTC helper and is not interchangeable with this key.

`AiAdjustmentSlot(clientId, reviewWindowKey)` has a database unique constraint and permanently records the accepted ROUTINE plan/version and timestamp. Superseding, declining later proposals, pausing, changing nutrition presentation or re-enrolling cannot erase it. Expired unaccepted proposals are invalidated and require a fresh review of current context. A new `INITIAL` run for a returning client must compare retained plans/history and be classified by actual changes; the run kind cannot bypass the slot or cumulative policy limits.

The approved policy separately limits cumulative changes across windows and domains. Calendar rollover alone is not evidence for a new change.

## States that must remain distinct

```ts
type CoachingMode = "NONE" | "HUMAN" | "AI";
type RunKind = "INITIAL" | "WEEKLY_REVIEW" | "REPRESENTATION";
type RunStatus = "QUEUED" | "RUNNING" | "RETRY_WAIT" |
  "COMPLETED" | "FAILED" | "CANCELED";
type ReviewAction = "HOLD" | "SIMPLIFY" | "ADJUST" |
  "CLARIFY" | "PAUSE_REFER";
type ChangeClass = "INITIAL" | "ROUTINE" |
  "TARGET_PRESERVING" | "PROTECTIVE";
type PlanStatus = "PROPOSED" | "ACCEPTED" | "DECLINED" |
  "SUPERSEDED" | "INVALIDATED";
type ReviewerStatus = "NOT_REQUIRED" | "PENDING" |
  "APPROVED" | "REJECTED";
type SafetyDisposition = "CLEAR" | "CLARIFY" | "RESTRICTED" |
  "REFER" | "URGENT";
type DomainPermission = "ALLOW" | "HOLD_ONLY" | "PAUSED";
type ObservationStatus = "NOT_REPORTED" | "REPORTED_COMPLETE" |
  "REPORTED_PARTIAL" | "REPORTED_NOT_DONE" | "NOT_SCHEDULED";
```

Run success does not mean eligibility, reviewer approval or user acceptance. A validated HOLD result needs no new plan or acceptance click. Material planned changes, including SIMPLIFY that alters the prescription, are ROUTINE. A presentation change or prevalidated equivalent food swap is TARGET_PRESERVING only when numerical and relevant safety constraints truly remain satisfied. PROTECTIVE is assigned by reviewed deterministic policy and cannot intensify restriction or exertion. Safety restrictions take effect immediately; a newly composed material replacement still follows the applicable validation/reviewer/acceptance requirements.

Run transitions: QUEUED→RUNNING on a valid claim; RUNNING→QUEUED only after a persisted stage checkpoint; RUNNING→COMPLETED on a validated final result; RUNNING→RETRY_WAIT for a retryable failure within budget; RETRY_WAIT→RUNNING when due; RUNNING/RETRY_WAIT→FAILED after terminal error or exhausted budget. Reconciliation moves expired RUNNING leases to RETRY_WAIT or FAILED with fencing. Any nonterminal run can become CANCELED after authority/safety invalidation. Terminal rows are never reopened. A manual retry after terminal failure requires a server-authorized, audited retry generation and remaining client-period budget; it creates a linked new run, never a client-chosen random business-key escape. Retry-generation counters do not reset adjustment slots, clinical limits or spending counters.

New serious structured safety reports trigger reviewed synchronous guidance and affected-domain restrictions before background work. Free text is untrusted; a concern extractor can increase caution but cannot clear a restriction. Failure to classify a possible material concern conservatively restricts the affected domain pending clarification. Do not wait for a model queue to respond to an explicitly reported urgent concern.

## Canonical content

```ts
type PlanPayloadV1 = {
  schemaVersion: 1;
  nutrition: NutritionPrescription | null;
  meals: MealWeek | null;
  strength: SessionPrescription[];
  cardio: CardioPrescription[];
  policyVersion: string;
  catalogVersions: { food: string; exercise: string };
};

type ReviewDecisionV1 = {
  action: ReviewAction;
  reasonCodes: string[]; // closed policy-owned registry, not arbitrary model text
  evidenceRefs: SourceRef[];
  limitations: string[]; // bounded, checked user-facing statements
  changeClass: ChangeClass | null;
  changes: PlanChange[];
  nextActionTemplateId: string;
  proposedPlanVersionId: string | null;
};
```

Implement nested definitions with bounded arrays, finite numeric ranges, explicit units, discriminated unions, strict unknown-field rejection and semantic checks. `nutrition:null` means unavailable or unsupported, never zero calories. The complete MVP must also support eligible users with a non-null personalized nutrition prescription.

- Nutrition: prescription ID, reviewed estimation method, target and permitted practical ranges, macro units, assumptions, applicability and policy provenance. Server math owns values.
- Meals: catalog recipe/food IDs and versions, ingredient amounts and units, raw/cooked state, recipe yield/servings, source nutrient precision/energy method, verified allergen metadata and substitutions. Missing micronutrients remain unknown. Daily/weekly totals and grocery quantities are calculated from these records.
- Strength: stable exercise ID/version and session-template ID, schedule, prescribed sets/reps/effort/rest, equipment and reviewed substitutions. No regex parsing of instructions into prescriptions.
- Cardio: typed modality, duration, frequency, reviewed intensity description and allowed progression. No `__CARDIO__` sentinel.
- Session results: unique session instance/client event ID, plan version, exercise ID, actual set index, reps, load value/unit and load kind (`EXTERNAL`, `BODYWEIGHT`, `ASSISTED`), timestamps and pain/effort fields. Zero external load is valid for bodyweight; missing is different. A second workout in the same week does not overwrite the first.

`AiPlanVersion` stores immutable payload/hash, owner, base version, all relevant revisions, activation window, change class, validation report and lifecycle. `acceptedAt` never resets. Corrections create a new version. Approved reviewer decisions bind to the exact payload hash, policy and evidence revisions; a modified candidate needs a new decision. Reviewer authorization is an explicit capability grant with appropriate verified qualifications and scope, never simply `isCoach`.

## Shared read contract

`ClientPlanViewV1` returns server-resolved `origin`, `contextRevision`, active plan summary, allowed domain views, permitted proposal summary, recent review and next action. AI reads follow `activePlanVersionId`; human reads use an adapter over human records and preserve existing presentation. Never write AI duplicates to legacy plan tables.

Active, proposed and historical material are clearly distinguishable. A paused domain is excluded from actionable instructions, with separately labeled history available under its access policy. Technical failure preserves only currently permitted active content. Do not return prompts, model traces, other users' data, raw health notes, or internal approval commentary in a general plan DTO. Reviewers get a separate minimized, authorized view.

## Proposed transport surface

Web actions in `app/actions/` and API route handlers call the same services in proposed `lib/ai-coach/` and `lib/coaching/`. Reuse existing APIs through adapters where practical; retain native compatibility and version responses. New paths below are proposals, not existing routes.

| Endpoint | Contract |
|---|---|
| `GET /api/client/coaching-context` | Current provider, allowed capabilities, resolution requirement and revisions. |
| `POST /api/client/ai-coach/enroll` | Confirmed intake revision, explicit consent receipt and expected context revision; establishes entitlement-checked AI context. |
| `PUT /api/client/ai-coach/intake` | Versioned structured input and expected profile revision; drafts separate from confirmed values; safety disclosures applied immediately. |
| `POST /api/client/ai-coach/runs` | Requested run kind and client idempotency key; server derives window, owner and applicable source snapshot. Returns 202 after durable persistence. |
| `GET /api/client/ai-coach/runs/[runId]` | Owner-scoped status, safe error, poll delay and permitted result reference. |
| `GET /api/client/plan/current` | `ClientPlanViewV1`; existing meal/training current endpoints become compatible projections of the same reader. |
| `POST /api/client/ai-coach/check-ins` | Shared structured check-in command, explicit completeness, source revisions and idempotency; does not require a fabricated human assignment. |
| `POST /api/client/ai-coach/sessions` | Versioned session event/upsert with expected event revision. |
| `POST /api/client/ai-coach/plans/[id]/accept` | Expected base version, current revisions and request key; server verifies all values against stored truth. |
| `POST /api/client/ai-coach/plans/[id]/decline` | Idempotent decline of owned proposal, optional bounded reason. |
| `POST /api/client/coaching-transition` | Explicit destination, scoped consent/token and expected context revision; one shared transition service. |
| `POST /api/ops/ai-coach/plans/[id]/review` | Restricted reviewer capability; hash-bound decision and structured rationale. Require authenticated same-origin/CSRF protection for cookie-based mutation. |
| `GET /api/cron/ai-coach` | Machine-authenticated bounded sweep; no client identity from query parameters. |

Use verified Clerk server identity, active-account checks, schema/body-size limits and rate limits. Never rely on a page layout to authorize an action/API. Cookie-authenticated mutations need same-origin/CSRF controls; bearer-native requests need verified tokens, not a public CORS wildcard with credentials. Implement against current official framework/auth documentation.

Intake draft creation is available to an authenticated invited applicant before AI becomes the active provider; it creates/reuses the persistent profile without changing authority. Enrollment then binds a confirmed revision and explicit transition consent. Process a separately validated safety-disclosure command independently of full-form confirmation, so valid relevant disclosures update existing AI restrictions even if unrelated draft fields fail validation. Removing an answer does not clear a restriction; clearing follows the reviewed resolution pathway. A human-coached applicant must explicitly complete the provider transition before AI activation.

Scope idempotency to authenticated owner and operation. Persist request-key/digest receipts: the same key and payload returns the original operation receipt; the same key with different input returns `REVISION_CONFLICT`. For acceptance replay, preserve that receipt while freshly resolving the current active ID; never return a stale active pointer as today's state. Independently deduplicate run creation by a server-derived business key over client, context/profile/observation/safety revisions, frozen relevant source-revision/content digest, policy/catalog/model-configuration versions, run kind, active base, activation window, requested representation and server-owned retry generation (normally zero). Do not use a changing request timestamp alone to distinguish work. A resolved concern, answered clarification or relevant version change must permit fresh work; a different browser request key with otherwise identical business inputs cannot buy another logical run or evade limits. A permitted representation change creates a new immutable version and conditional pointer update under the same validation/ownership checks; it never edits an existing payload.

Responses use `{data,requestId}` or `{error:{code,message,fieldErrors?,retryable},requestId}`. Codes include `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404, also when needed to avoid object enumeration), `VALIDATION_ERROR` (422), `STALE_PROPOSAL`/`REVISION_CONFLICT`/`WINDOW_CLOSED`/`ADJUSTMENT_LIMIT_REACHED` (409), `SAFETY_RESTRICTED` (409), `ENTITLEMENT_REQUIRED` (403), `RATE_LIMITED` (429), `TEMPORARILY_UNAVAILABLE` (503). Structured recovery data comes from a fresh authorized read, never a raw provider/database error.

## Atomic acceptance

In one short transaction, always lock the persistent client User row first, then context, profile and candidate. This applies to initial creation and every later transition, acceptance, safety mutation and deactivation. Every relevant writer follows the same lock order.

1. Verify active authenticated account, candidate ownership and authorized access to its receipt. If the operation/version was already accepted, return the permanent receipt and freshly resolved **current** active ID without changing state. Do this before stale-base/revision/window checks; valid retries remain valid after supersession or a permitted provider transition. History access does not grant new activation authority.
2. For first acceptance, require candidate status `PROPOSED`, AI authority, unambiguous context, valid entitlement, publication flag and expected revisions. DECLINED, INVALIDATED and unaccepted SUPERSEDED candidates cannot activate.
3. Recheck current policy availability, safety/domain permission, source correction/deletion status, validation and required exact-hash reviewer approval. Confirm exact base active version and non-expired activation window.
4. For ROUTINE, insert the unique adjustment slot and verify cumulative policy bounds. No model or user can label a change exempt.
5. Accept candidate, retain accepted timestamp, supersede the old active lifecycle, update active pointer and insert a deduplicated outbox event atomically.
6. Commit before network notifications; revalidate web reads. Any failed condition leaves no partial plan, slot or notification.

Provider switching, account deactivation/deletion and safety-changing mutations use this same serialization boundary. Workers recheck fencing token plus current context after external I/O; a stale worker cannot write a candidate into the live state. Snapshots describe historical evidence, never current permission.

Implementation slices and verification IDs are in [08](08-Implementation-Backlog.md) and [09](09-Validation-Release-Operations.md).
