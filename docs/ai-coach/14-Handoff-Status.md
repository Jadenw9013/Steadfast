# Implementation handoff status (updated 2026-09-14)

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

| Commit | Slice | One-line outcome |
|---|---|---|
| `2ace11a` | F00 | Reconciled contradictory repo instructions (pnpm, Vitest exists, migration workflow, design overrides). |
| `cbd9f0e` | F01 | Closed the deactivated-account authorization bypass (CB02). |
| `e654a4c` | F02 | Consent-bound coach/client linking — coach-entered contact info can never grant access; added `ClientCoachingContext` (CB01). |
| `c64074f` | F03 | Scoped private messages to a specific coach conversation, not client-wide (CB03). |
| `6a784cf` | F04/F05 | Published meal plans and training programs are immutable; editing forks a new draft (CB04/CB05). |
| `61d5b6d` | F06 | One unified check-in service shared by web action and iOS REST route (CB07). |
| `d92f406` | F07 | Truthful adherence/exercise-session logging — missing ≠ zero (CB08). |
| `3a5e7e8` | F08 | Durable storage-cleanup outbox; decoupled reminder/purge cron sweeps (CB09/CB12). |
| `02325a8` | CB11 | Stripe webhook event-ordering fix (existing billing, unrelated to new checkout). |
| `580dc50` | A01 | `ClientCoachingContext` single-provider authority, `AiCoachProfile` identity, `AiCoachEntitlement`, default-OFF flags (`lib/flags/ai-coach.ts`). |
| `d6152e4` | A02 | `AiCoachRun`/`AiPlanVersion`/`AiAdjustmentSlot`/`AiWorkoutSession`/reviewer-grant schema and lifecycle (`lib/ai-coach/runs.ts`, `plan-lifecycle.ts`). |
| `3278ea2` | A03 | Staged intake draft/confirm and safety-disclosure service (`lib/ai-coach/intake.ts`, `safety.ts`). |
| `1f7174f` | A04 | Versioned food/exercise catalog loaders, nutrient totals, feasible-composition checks (`lib/ai-coach/catalog/`, `nutrition-totals.ts`, `composition-feasibility.ts`, `policy/policy-version.ts`). |
| `fc545e7` | A05 | Durable job executor + provider adapter, all synthetic (`lib/ai-coach/executor.ts`, `provider/`, `run-status.ts`), authenticated cron route. |
| `c4f6fe1` | A10 | Full atomic proposal acceptance/decline service — the policy/safety/entitlement/reviewer-gated gate A02 explicitly deferred (`lib/ai-coach/plan-acceptance.ts`). |

A10 was pulled ahead of A06–A09 on purpose: doc 08 states A06 depends on
A10's fixture-tested acceptance service, and that dependency is
"intentionally acyclic" the other way — building A10 first means A06 has
something real to call instead of a stub.

### File manifest — `lib/ai-coach/`

```
lib/ai-coach/
  runs.ts                      A02  Run lifecycle: claim/checkpoint/complete/fail/cancel/reconcile/retry
  plan-lifecycle.ts             A02  Storage-level plan version + adjustment-slot primitives (test/internal use only — see plan-acceptance.ts)
  intake.ts                     A03  saveIntakeDraft / getIntakeDraft / confirmIntake
  safety.ts                     A03  submitSafetyDisclosure / clearSafetyRestriction
  catalog/schema.ts             A04  Zod shapes for FoodItem / ExerciseItem (SYNTHETIC)
  catalog/food-catalog.ts       A04  6-item SYNTHETIC food fixture
  catalog/exercise-catalog.ts   A04  3-item SYNTHETIC exercise fixture
  catalog/loader.ts             A04  getFoodItem / getExerciseItem (id+version lookup, rejects unknown/stale)
  policy/policy-version.ts      A04  checkPolicyVersionUsable (SYNTHETIC single active version + one revoked version)
  nutrition-totals.ts           A04  computeNutrientTotals / aggregateGramsByFood
  composition-feasibility.ts    A04  checkMealComposition — closed reason-code registry
  provider/adapter.ts           A05  ModelProvider interface, timeout wrapper
  provider/synthetic-provider.ts A05 The only provider that exists — no network I/O, ever
  provider/spend-limits.ts      A05  Rate limit (real) + token ceiling (safety backstop, not real pricing)
  executor.ts                   A05  runExecutorSweep / processClaimedRun
  run-status.ts                 A05  getRunStatusForClient — safe minimized DTO
  plan-acceptance.ts            A10  acceptPlanVersionAtomic / declinePlanVersion — THE real acceptance service
```

### Routes

```
app/api/cron/ai-coach-executor/route.ts             A05  authenticated sweep trigger
app/api/client/ai-coach/runs/[runId]/route.ts        A05  safe run-status read
app/api/client/ai-coach/plans/[id]/accept/route.ts   A10
app/api/client/ai-coach/plans/[id]/decline/route.ts  A10
```

No UI/pages exist yet for any of this — A06 is the first slice that needs a client-facing page (per doc 08, "progress/proposal view").

### Feature flags (all default OFF — `lib/flags/ai-coach.ts`)

| Env var | Gates |
|---|---|
| `FEATURE_AI_COACH_ENROLLMENT` | Whether a client may enroll in AI coaching at all. |
| `FEATURE_AI_COACH_GENERATION` | Whether `runExecutorSweep` claims/processes anything. |
| `FEATURE_AI_COACH_PUBLICATION` | Whether `acceptPlanVersionAtomic` will activate a candidate. |

None of these are set anywhere in this repo's env files. Turning one on
without the corresponding real content/policy (gates G01/G02/G05) would let
a synthetic fixture reach a real user — don't.

### Test coverage

```
tests/integration/ai-coach-context.test.ts          A01  (13 tests)
tests/integration/ai-coach-runs-plans.test.ts        A02  (16 tests)
tests/integration/ai-coach-intake-safety.test.ts     A03  (13 tests)
tests/unit/ai-coach-catalog.test.ts                  A04  (18 tests, no DB needed)
tests/integration/ai-coach-executor.test.ts          A05  (12 tests)
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
   Run type-check *again* after writing test files, not just after
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
   DATABASE_URL="postgresql://jadenwong@127.0.0.1:5432/steadfast_security_test" pnpm exec prisma db push --accept-data-loss   # syncs the LOCAL test DB only — never db push against Neon
   ```
   The local test DB cannot replay the full migration history from empty
   (the earliest migrations were baselined against Neon's pre-existing
   schema) — `db push` is the only way to keep it in sync, and this is
   scoped strictly to that one disposable local database.

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
   built the *engineering* around these gates (schema, checks, flags,
   synthetic fixtures) without guessing the content the gates are supposed
   to supply. Keep doing that: implement the mechanism, never the number.

## What's left

Recommended order per doc 08: **A06 → A07/A08 → A09/A11 → A12**, then the
Launch-phase items (L01/L02, P01–P03) which are explicitly gated on real
G0x artifacts, not more code.

### A06 — Internal initial macro + strength/cardio vertical slice
*Dependencies met: A03, A04, A05, A10 all exist.*

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
  deterministic *placeholder* numeric target is fine as long as it's
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
*Dependencies: A04, A06.*

Deterministic weekly composition, practical quantities, approved
substitutions, grocery aggregation (`aggregateGramsByFood` in
`nutrition-totals.ts` already gives raw per-food gram totals — A07 turns
that into practical purchasable quantities, which A04 explicitly left
undone). Mode switch (macro ⇄ meals) must keep exactly one prescription
active, never two.

### A08 — Minimal structured weekly observations and session logs
*Dependencies: F06/F07 (done), A02/A03 (done).*

Shared check-in service extension, typed session IDs, cardio results.
`AiWorkoutSession` (A02) already has the schema shape
(`clientEventId`-keyed, independent repeated sessions); this slice is
about the actual logging UI/API and the observation-completeness tracking
that A09's controller will read.

### A09 — Coordinated weekly controller
*Dependencies: A04–A08 (A08 not yet built).*

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
*Dependencies: A05, A10 (both done).*

Restricted reviewer queue/view/decision endpoint. The data model
(`AiCoachReviewerGrant`, `AiPlanReviewerApproval`) and the *consumption*
side (A10's acceptance service already checks `reviewerStatus`/
`approvedHash`/grant revocation) are done — A11 is the *production* side:
an endpoint a grant-holder uses to actually approve/reject a specific
candidate, hash-bound, with backlog/capacity controls. This could
plausibly be started now in parallel with A06–A09 since its dependencies
are already satisfied — flagged as available "early start" work if the
next agent wants to parallelize.

Note doc 08's explicit caution: "A technical queue is not a staffing
commitment" — this is infrastructure, not a claim that gate G04 (qualified
pilot capacity) is resolved.

### A12 — Integrated evaluation and usability-ready build
*Dependencies: A06–A11, remaining relevant F repairs.*

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
review queue. Notification delivery explicitly remains unconfigured, not falsely
reported as sent. The eight-week evidence boundary now uses local-calendar
midnight across DST, with spring/fall tests.

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
