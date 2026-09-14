# Implementation backlog and delivery order

This is the coding sequence, not an instruction to implement everything in one patch. Requirements are in [01](01-Product-and-Scope.md), code evidence in [03](03-Codebase-Audit.md), normative contracts in [05](05-API-and-State-Contracts.md), verification IDs in [09](09-Validation-Release-Operations.md). Recheck the current branch before each slice. No application code was modified to produce this pack.

Each ID below is a work package. Split it into reviewable sub-slices of at most ten changed files and one feature area, including migrations/tests. Do not claim a large package fits that limit without counting. Keep dependencies explicit; documentation and fixture work can proceed while real policy review is pending.

## Phase F — existing platform repairs

| ID | Outcome and files to inspect | Dependency | Acceptance / rollout |
|---|---|---|---|
| F00 | Correct repository instructions and test baseline. `CLAUDE.md`, patterns/Prisma skills, `package.json`, `release.sh`, design MASTER/page overrides. Normalize pnpm, current tests, isolated migration workflow, AI-specific presentation rules. | None | Documentation matches code; establish actual gate results. Do not run live migrations. Separate docs, release-script and design-override sub-slices. |
| F01 | Central active-account authorization. `lib/auth/roles.ts`, ownership helpers in `lib/queries/check-ins.ts`, their action/API callers. | F00, or urgent focused repair independently | V01 direct-boundary matrix. Preserve dual-role capabilities; never rely on layouts. May ship immediately. |
| F02 | Consent-bound relationships. `lib/activation.ts`, `app/actions/coaching-requests.ts`, `client-invites.ts`, connect-coach API, JIT auth linking. Add expiring intended-client invitation/receipt, `ClientCoachingContext` and one transition service. | F01 | V01/V08. Coach-supplied contact cannot confer authority. Cover every old writer; do not leave an alternate bypass. F02a can urgently remove silent grants under the User lock; F02b adds context/consent migration and F02c converts all acceptance writers. A01 follows completed F02. |
| F03 | Conversation isolation and read semantics. Message schema, `lib/queries/messages.ts`, actions/general/weekly APIs, notifications/block/report flows. | F01/F02 | V02. Preview legacy backfill; ambiguous history is client-only. Add explicit conversation participants and later read receipts. Preserve authorized archive access. |
| F04 | Immutable published human meals. Meal actions and coach meal-plan API, schema/version allocation, queries/editor. | F01 | V03. Draft-only transactional mutation, concurrency-safe version allocation and separate draft from published. Report duplicate historical versions before constraints. |
| F05 | Immutable published human training. Training actions/API, schema/query/editor. | F01 | V03. Metadata and children commit together; save cannot demote published content. Correct both action and API. |
| F06 | One revisioned check-in service. Action/API schemas, template lookup, photo overwrite paths. | F01/F02 | V04. Equivalent transport semantics; explicit photo unchanged/replaced; owned template; revision/correction events. Preserve multiple-per-day behavior. |
| F07 | Truthful logging and current client views. `lib/queries/adherence.ts`, client home/plan, exercise results, checkoff UI. | F06 where ingestion changes | V05. Missing differs from not done; remove misleading adherence/streak math, show macro/cardio independently, preserve repeated/bodyweight sessions. Stage metric/UI repairs separately from new AI session schema. |
| F08 | Reliable operational work: reminders, deletion/media and diagnostics. Cron routes, scheduling helpers, deletion sweep/purge, storage writers. | F01; F06 for removed-photo references | V06/V07. Split F08a reminder due-window/outbox, F08b independent deletion/media cleanup, F08c privacy diagnostics. Failures in reminders cannot suppress deletion. |

F01/F02 address the highest immediate risk and can ship before the feature. F03–F06 protect existing users and form live-AI prerequisites. Do not postpone existing privacy repairs until a new paid product is ready. Current Stripe event-ordering repair (CB11) is a targeted existing-billing ticket within P01; it can ship independently of new client checkout.

## Phase A — implement with synthetic fixtures first

| ID | Concrete outcome / proposed touchpoints | Dependencies | Required evidence |
|---|---|---|---|
| A01 | Reuse F02's `ClientCoachingContext`; add persistent AI profile identity, invited-client entitlement and default-OFF enrollment/generation/publication flags. Extend the F02 transition service for AI and verify all provider writers; retain unresolved-assignment backfill state. | F02/F03 | V08; no fake coach, no duplicate authority, ambiguous backfill preserved, flags enforced at server boundaries. |
| A02 | Implement strict contracts and additive records: runs, immutable plans, adjustment slots, typed sessions, reviewer grants/approvals, side-effect work. Shared plan-read adapter, export, retention and purge hooks. | A01, F04–F06/F08b | V04/V07/V14; database constraints and deletion race tested. Split schema, shared types, read adapter and lifecycle slices. |
| A03 | Staged confirmed intake and safety service. Proposed `lib/ai-coach/intake.ts`, `safety.ts`; start/intake pages and API/actions. Server drafts, required-input mapping, revision checks and immediate restrictions. | A02, F00 design corrections | V09/V17; decline/unsure states work, no unsupported defaults, no wait for cron on explicit urgent concern. Synthetic policy only until approval. |
| A04 | Versioned policy/catalog loaders and deterministic calculators. Reviewed food/recipe/exercise schema, source-aware totals, feasible composition, policy compatibility/revocation checks. | A02 | V09/V19 and boundary/multiweek fixtures. Real content review is a parallel owner deliverable; fixture approval cannot become live approval. |
| A05 | Durable job ledger/executor and provider adapter. Proposed runs/provider modules, authenticated cron, stage outputs, retry/lease/fencing, spend limits and safe status API. | A02/A04 | V10; deployment-capability rehearsal; no fire-and-forget inference or network calls inside transactions. |
| A06 | Internal initial macro + strength/cardio vertical slice. Deterministic initial prescription and reviewed template selection, bounded model explanation, validated candidate, progress/proposal view and shared client plan. | A03–A05; A10 for synthetic activation | V11/V19. No human assignment; explicit target units; typed training/cardio; reject catalog hallucination. This is an internal milestone, not complete meal MVP. |
| A07 | Curated meal mode. Deterministic weekly composition, practical quantities, approved substitutions and grocery aggregation; mode switch keeps one prescription. | A04/A06 | V11, allergy/feasibility/rounding tests. Both modes accessible; no arbitrary recipe generation. Target-preserving swaps get a new auditable representation, not mutation. |
| A08 | Minimal structured weekly observations and session logs. Shared check-in service, typed session IDs, cardio results, corresponding check-in/session views. | F06/F07, A02/A03 | V05/V15; sources/revisions/completeness survive reload, repeated sessions remain independent. Match the chosen policy's evidence needs. |
| A09 | Coordinated weekly controller. Frozen lookback, server-derived activation window, evidence sufficiency, HOLD/SIMPLIFY/ADJUST/CLARIFY/PAUSE_REFER, combined and cumulative validation. | A04–A08 | V12/V13/V15/V16/V19. Include a supported nutrition adjustment from shipped inputs and multiple weeks of noisy/missing evidence. |
| A10 | Atomic proposal lifecycle and acceptance. Acceptance/decline services and UI, immutable payloads, exact-base/revision/policy/entitlement checks, permanent slot, replay receipt, deduplicated notifications. | A02/A03/A04; fixtures allow work before A06 | V13–V18. Implement before enabling any real candidate. A06 uses A10's fixture-tested service; this dependency is intentionally acyclic. |
| A11 | Actual pilot reviewer operations. Restricted reviewer queue/view/decision endpoint, qualification grants, exact-hash approval, backlog and capacity controls. | A05/A10 | V18; no ordinary coach access; unapproved initial/intensifying plans hidden from participants. A technical queue is not a staffing commitment. |
| A12 | Integrated evaluation and usability-ready build. Provider-aware home/navigation, review list/detail (`/client/ai-coach/reviews`), offline/error states, model holdouts, isolated end-to-end tests and operational dashboards. | A06–A11, remaining relevant F repairs | V01–V20 applicable to changed paths; web/API contract parity; evidence report with actual pass/fail/skip, cost and latency. |

Recommended sequence within A: **A01 → A02 → A03/A04 → A05/A10 → A06 → A07/A08 → A09/A11 → A12**. Parallelize only independent scopes; designate one migration/contract owner to prevent divergent enums and schema edits. Every work package remains behind flags until its release stage permits exposure.

## Critical implementation details that cannot be left implicit

### F02: close access-granting side effects

Inventory all `CoachClient` creates/upserts/deletes and every caller of linking helpers. A coach-controlled activation may create an invitation, never a relationship to an existing account by email/phone lookup alone. Authentication resolves identity without granting coaching access. Explicit client acceptance verifies intended account, coach, token validity and sharing scope; serialize token consumption and provider transition. Existing questionable relationships need a read-only provenance assessment and targeted owner decision, not an automatic destructive backfill.

### A05: bounded execution defaults

Proposed engineering starting values: at most three concurrently claimed runs per sweep; one external model stage per run per invocation; at most two declared model stages per run; 45-second provider timeout; 90-second lease; three total attempts per model stage with proposed 60- and 300-second transient retry delays. This caps a normal run at six attempted model calls; lower per-client spending limits may stop it sooner. Successful checkpoints do not reset attempt accounting. Verify function duration of at least 120 seconds and leave time for validation/persistence. These are configurable engineering defaults to validate in staging, not measured latency promises or medical constants. Do not claim an entire large batch and let later leases expire while waiting sequentially.

Rate-limit by client, operation and period; cap input/output tokens and dollar spend using evaluated provider pricing before live calls. Attempt accounting includes crash/retry ambiguity. The minute sweep reconciles all due/expired work, not only the current minute. If the deployment cannot support this configuration, keep live generation disabled and revise this one execution choice; do not silently fall back to the daily reminder job.

### A09: the actual weekly decision procedure

1. Resolve current owner, approved policy and domain permissions; capture exact evidence revisions and lookback.
2. Determine each candidate action's evidence sufficiency. Do not infer measured intake from checkoffs or require an unbuilt tracker.
3. Compute permitted HOLD/simplification/adjustment options deterministically. Rank feasible choices using user constraints; an LLM can help within this set.
4. Validate nutrition, strength and cardio jointly, plus retained adjustment history, cooldown and cumulative rules.
5. Derive change class from the actual difference. Bind candidate to the current activation window and active base, never the expired lookback.
6. Produce checked reason codes and a concrete next action. Save a result without a candidate when no material change is justified.

### A10/A11: two independent gates

Qualified pilot review approves the exact candidate where required; user acceptance chooses whether to activate it. Neither substitutes for the other or clears a new safety concern. Changes after approval invalidate that approval. User acceptance rechecks server truth in a short transaction and inserts the unique slot once. A stale historical acceptance returns a receipt without reactivating an old plan. No model/network I/O is allowed inside the lock.

## Launch and later phases

| ID | Scope | Entry gate / completion |
|---|---|---|
| L01 | Capped supervised real-user pilot | Actual approved policy/catalog, qualified staffing, permitted geography, consent/privacy readiness, deployed queue/recovery and applicable V01–V20 evidence. Review initial numerical and intensifying candidates before visibility. Record feasibility and harms, not claims of proven efficacy. |
| L02 | Broader bounded self-service | Separate written evidence decision on removing routine human review, retained sampling/escalation, incident readiness and scope. No automatic graduation based only on signups. |
| P01 | Existing Stripe ordering repair, then separate paid-client product | Repair existing event-ordering/reconciliation independently. New checkout requires explicit client SKU/channel/cancellation/refund/paused-access decisions, separate entitlements and payment tests. Do not make pilot clients coaches. |
| P02 | Optional photo/barcode food logging | Separate accuracy/usability gate, user correction, ingredient/amount provenance, uncertainty and deletion. Never allow rough image estimates to silently drive energy restriction. |
| P03 | Wearables, richer catalogs, coach copilots or native UI | New evidence packet and reusable review workflow; none is presumed ready or included in this MVP. |

No calendar estimate is asserted without team capacity. A solo coding agent should complete and verify each dependency before moving to the next; six review perspectives do not imply six implementation engineers.

## Requirement traceability

| Product requirement | Implementation | Primary verification |
|---|---|---|
| PR-01 enrollment/intake | F01–F03, A01/A03 | V01/V02/V08/V09 |
| PR-02 coordinated plan | A04/A06/A09 | V09/V11/V12/V19 |
| PR-03 macros | A06/A10 | V11/V14 |
| PR-04 meals | A07 | V09/V11/V19 |
| PR-05 training | F05, A06/A08 | V03/V05/V11 |
| PR-06 evidence | F06/F07, A08 | V04/V05/V15 |
| PR-07 weekly decisions | A09 | V12/V13/V16/V17 |
| PR-08 activation | A10/A11 | V13–V18 |
| PR-09 failure handling | A05/A10/A12 | V10/V14/V17/V20 |
| PR-10 human transition | F02/F03, A01 | V01/V02/V08 |
| PR-11 privacy/control | F08b, A02/A03 | V07/V08/V17/V18 |
| PR-12 accessible/shared clients | F00/F07, A02/A12 | V04/V11/V20 plus real accessibility checks |

For every completed slice, attach actual files/commands/results, remaining risk, flag state and rollback behavior. A proposed acceptance criterion is not a passing test.
