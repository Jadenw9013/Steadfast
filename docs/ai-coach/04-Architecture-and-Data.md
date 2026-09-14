# 04 — Architecture and data

**Status:** proposed implementation design; no application changes or runtime verification. Repository baseline: `bda25ea4673b47ccc4c302cb6becbcbad0842d3a`. [05 — API and state contracts](05-API-and-State-Contracts.md) is authoritative for field names, enums and transition rules. Follow [08 — Implementation backlog](08-Implementation-Backlog.md) rather than creating every module at once.

## 1. Keep one backend and one source for each plan

Use the existing Next.js/TypeScript, Zod, Prisma/Postgres, Clerk and private Supabase stack. Web server actions and native-compatible REST routes call shared application services. Neither transport owns a separate coaching algorithm. This checkout contains the backend and web application; it does not establish a native Swift implementation.

The AI controller is finite: capture evidence, screen scope, compute permitted choices, personalize within reviewed content, validate, and save a decision/proposal. The model cannot set authorization, invent clinical policy, perform nutrient arithmetic, clear exclusions or activate a plan. No new Python service, vector database or multi-agent runtime is necessary for this MVP.

**AI never writes legacy `MacroTarget`, `MealPlan` or `TrainingProgram` rows.** Their current mutable and text-oriented representations make duplicate persistence unnecessarily risky. A server-selected `ClientPlanViewV1` maps the human source or the exact accepted AI version into a common presentation contract. Reuse suitable components through read adapters; keep raw prompts, reviewer notes and unnecessary health detail outside the DTO. The human draft/published fixes in F04/F05 remain independently necessary.

## 2. Domain boundaries and impact map

| Responsibility | Proposed location / existing integration | Boundary |
| --- | --- | --- |
| Active identity and provider | `lib/auth/roles.ts`; shared `lib/coaching/` services | One current plan authority; consented human linking and active-account checks. |
| Intake and safety | `lib/ai-coach/intake.ts`, `safety.ts` | Confirmed structured inputs; immediate scoped restrictions before asynchronous work. |
| Policies and catalogs | `lib/ai-coach/policy/`, `catalog/` | Versioned reviewed rules, foods, recipes, exercise IDs and templates. |
| Calculations and decisions | `nutrition.ts`, `training.ts`, `review.ts`, `validate.ts` | Deterministic amounts, data sufficiency, feasibility and cumulative constraints. |
| Model integration | `lib/ai-coach/providers/` | Minimized context, evaluated configuration, bounded requests, validated output. |
| Durable execution | `runs.ts`; protected cron route | Persistent jobs, leases, retries, stage outputs and reconciliation. |
| Review and acceptance | `acceptance.ts`; shared application services | Qualified pilot approval when required, then atomic user activation. |
| Read presentation | `lib/queries/` and DTO adapters | Explicit origin, availability and domain restrictions; no timestamp-based AI selection. |
| Check-ins and sessions | Shared check-in service plus typed session service | Equivalent web/API semantics, revisioned evidence, stable session/exercise identity. |

These are proposed responsibilities, not permission to scaffold empty files or add dependencies. The existing `lib/llm/parse-meal-plan.ts` imports documents; its extraction prompt is not a coaching policy.

## 3. Persistent records and constraints

| Record | Essential data | Required invariant |
| --- | --- | --- |
| `ClientCoachingContext` | Unique client; mode; active human relationship; revision; resolutionRequired. | Sole current provider authority. HUMAN references the matching authorized relationship; AI/NONE have no active human plan owner. No duplicate `User.coachingMode`. |
| `AiCoachProfile` | Unique persistent client; confirmed intake/schema; profile/observation/safety revisions; consent; fixed review timezone; activePlanVersionId. | Retained across pause and re-enrollment. Scope and domain permissions are separate from enrollment state. |
| `AiCoachRun` | Owner/kind; server-derived business key; frozen input and digest; source revisions/cutoff; activation window; stage/state; lease/retry metadata; version hashes; cost; result/proposal ID. | Duplicate requests resolve the same business operation. Inputs and completed results are immutable; execution metadata can change. |
| `AiPlanVersion` | Owner/version; base plan; canonical payload/hash; provenance; change class; lifecycle; permanent acceptedAt; reviewer status and approval evidence. | Content never changes. Qualified approval binds to exact payload/revisions. An ordinary coach flag is not reviewer authorization. |
| `AiAdjustmentSlot` | Persistent client; reviewWindowKey; accepted plan ID; timestamp. | Unique client/window, inserted with routine acceptance. Retained after supersession, pausing and re-enrollment. |
| `AiWorkoutSession` | Owner/session key; originating plan; occurredAt/timezone; stable exercise IDs; typed sets, units and explicit unknowns; revision. | Multiple same-exercise sessions in one week remain distinct. Bodyweight and zero added load require no invented positive weight. |
| Pilot entitlement and reviewer grants | Client allowlist/expiry/revocation; explicit reviewer scope/qualification verification. | Separate from coach subscriptions and provider authority; grants cannot be self-asserted by model or client. |
| Durable side-effect work | Deduplicated notification/channel attempts and owned storage-removal references. | Database commit does not pretend an email was delivered or a storage object deleted. Failed work remains discoverable. |

Start small reviewed catalogs as schema-validated versioned data where practical. Nutrient records retain source identity/version, raw/cooked state, grams/serving conversions, energy method, precision and unknown values. Ingredient/allergen review is distinct from nutrient completeness. Do not duplicate every ingredient into a new relational subsystem before catalog scale requires it.

The MVP has no full food tracker. Its weekly input schema must nevertheless support the approved adaptation policy through shipped check-in/session screens. Optional logs remain unknown when absent; missing records are not failed adherence or measured zero intake.

## 4. Evidence, time and repeat decisions

Capture values as well as IDs because existing check-ins can be overwritten. Add revisioned submission semantics, preserve metric-only photo edits, and validate template ownership through the shared service. A correction creates a changed source revision; a retry does not silently reread a different snapshot.

`observationRevision` represents corrections, removals or late entries that affect the frozen reviewed evidence/window. Ordinary observations after the cutoff do not continually invalidate a pending proposal. New relevant safety information always triggers reassessment. Document the ingestion rule centrally and test both cases.

Separate the **observation lookback** from the **activation window**. A Monday review may summarize the previous week while using the current week's adjustment slot. Fixed client review timezone and local Monday boundaries define the pilot window; store UTC bounds, timezone and local date. DST changes window duration, so do not add a fixed number of milliseconds. Travel display settings and re-enrollment do not reset this schedule. Legacy `weekOf` continues to use existing Monday-UTC helpers.

Expire proposals when their activation window ends; prepare a fresh review rather than accepting an old change into a new week. The slot is only one defense: cumulative limits and cooldowns also span windows. `INITIAL` after a return cannot erase prior adjustment history. The server derives the change class from the validated difference and reviewed policy, not the run's label or model wording. Protective actions cannot increase restriction or exertion.

## 5. Atomic boundaries

All provider transitions and acceptance use the same lock order: persistent client User row, then context/profile. This also protects first creation. Every legacy assignment writer must use the transition service; adding a lock only to AI enrollment leaves old bypasses open.

Acceptance performs a short transaction: authenticate/recheck active account; inspect entitlement, consent, provider/profile/observation/safety revisions, current policy and required reviewer approval; verify exact base plan and window; insert a routine adjustment slot if required; record acceptance, supersede prior lifecycle metadata and swap the active pointer. Record any notification intent before committing. No model or other network request occurs inside this transaction.

A repeated acceptance returns the existing outcome. Replaying a historical accepted version never reactivates it. Two tabs, a provider switch, deletion, source correction or a competing proposal cannot both win incompatible updates. Generation finalization performs equivalent freshness checks before exposing a proposal, and acceptance checks again later.

Safety restrictions apply when the report is stored, independently of a queued model run or user acceptance. Read DTOs overlay current domain availability on preserved plan history. Technical failure can retain a prior plan only while current safety state still permits it; never fall back to an older timestamp-selected plan to evade a restriction.

## 6. Durable execution and operational limits

Use the Postgres run ledger with an authenticated every-minute Vercel reconciliation sweep on a deployment supporting that cadence. The current daily reminder cron does not supply it. Vercel documents daily-only Hobby scheduling, minute scheduling on Pro/Enterprise, missed/duplicate delivery, overlap and no failure retry; application recovery is therefore mandatory. [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Cron operation](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

Claim bounded batches in short transactions, assign expiring leases with fencing tokens, and release locks before external calls. Every later write verifies the current token and lease. PostgreSQL documents `SKIP LOCKED` as useful for queue-like consumers; do not use it to skip essential acceptance checks. [PostgreSQL locking](https://www.postgresql.org/docs/current/sql-select.html)

Persist stage results; reconcile expired leases and all due retries after missed invocations. Classify transient provider errors separately from terminal validation/scope failures. Enforce timeouts, finite attempts, input/output limits and per-run/client spending caps. Deployment configuration must leave execution headroom. [Function limits](https://vercel.com/docs/functions/limitations)

A crash can duplicate an external model request even when one result is accepted; track attempted cost and do not promise exactly-once provider billing. Initial requests return a persisted run ID and pending state. No fire-and-forget generation. Server-only enrollment, generation and publication switches default OFF and are checked at relevant execution boundaries.

## 7. Privacy, deletion and migration

Minimize provider context and stored snapshots; define retention by purpose. Keep health content out of generic analytics and operational logs. Supabase keys remain server-side; media access remains owned, private and short-lived. Extend account export and retryable purge to AI profiles, snapshots, sessions, plans, approvals, slots and queued work.

Deactivation/withdrawal must block new calls and result commits immediately. An already sent provider request may finish; discard its result and follow the provider-specific deletion/retention procedure. Preserve removed storage paths in durable cleanup work before unlinking them, so later purge can still enumerate objects.

Use additive migrations, isolated development/test databases and explicit backfill reports. Audit ambiguous human assignments and duplicate plan version labels without deleting or guessing history. Reconcile contradictory repository migration instructions in F00 before running schema commands. The release gates and rollback sequence are specified in [09 — Validation, release and operations](09-Validation-Release-Operations.md).
