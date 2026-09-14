# Implementation handoff status (2026-09-13)

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
