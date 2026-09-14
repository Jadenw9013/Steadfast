# Validation, release and operations

This is an executable validation plan, not a record of passing tests. Baseline: commit `bda25ea4673b47ccc4c302cb6becbcbad0842d3a`, reviewed September 13, 2026. No application tests, browser sessions, professional assessment or real user study were performed for this document pack. Dependencies are absent in the review checkout.

[05-API-and-State-Contracts.md](05-API-and-State-Contracts.md) owns state and API vocabulary. [06-Coaching-Policy-and-AI.md](06-Coaching-Policy-and-AI.md) owns policy requirements. Apply the corresponding gates to each slice in [08-Implementation-Backlog.md](08-Implementation-Backlog.md); do not wait until the entire feature is built to verify foundational repairs.

## 1. What exists today

| Existing asset | Verified coverage and limitation |
|---|---|
| 25 unit-test files | Vitest tests include validation, date/cadence, security helpers and business logic. Their presence does not establish a passing baseline. |
| Two integration-test files | Account deletion and checkout use real PostgreSQL with mocked external effects. Opt-in `SECURITY_INTEGRATION=1`; guards require hostname `127.0.0.1` and database path `/steadfast_security_test`. Ordinary runs skip these suites. |
| One smoke-test file | Four opt-in `SMOKE` tests assert only “not 404.” A 500 or unintended unauthenticated success can pass. Replace with intended authorization/status and side-effect assertions. |
| One Playwright file | Two unauthenticated checks cover a coach page and invalid intake token. They do not test successful onboarding, meal publishing or the AI loop. |
| `release.sh` | Runs build, lint and source scans; omits tests. Replace “safe to deploy” wording with actual gate results. No GitHub Actions configuration was found; remote branch protection and hosting settings were not inspected. |

`playwright.config.ts` and `prisma.config.ts` load `.env.local`. Establish explicit isolated test configuration before running them; a local server is not proof of a local database. Do not send real notifications, charge accounts or invoke paid inference in routine tests. Follow the reconciled environment/package/migration workflow in [12-Coding-Agent-Runbook.md](12-Coding-Agent-Runbook.md).

## 2. Required behavioral tests

Use deterministic provider fixtures for repeatability and an isolated real PostgreSQL database where constraints, transactions or races are the behavior under test. Mock-only tests cannot establish database isolation. “Blocks” below means the listed slice cannot be declared complete without the specified behavior; these tests are not currently implemented unless independently verified.

| Test ID / blocks | Scenario | Required assertion |
|---|---|---|
| V01 / F01–F02 | Active, inactive, unassigned and wrong-account callers invoke actions and REST directly; coach activates a lead matching an existing client. | No client access without that client's valid acceptance; no phone-match authorization; inactive account fails before read/write. |
| V02 / F03 | Client changes from coach A to B; request history through every message surface. | B cannot read A's private conversation. Client archive remains available; ambiguous legacy history is not assigned by guesswork. |
| V03 / F04–F05 | Save published meal/training IDs; race draft save against publish; inject child-write failure. | Published content unchanged; one valid transition; metadata/content atomic; distinct concurrent version allocation. |
| V04 / F06 | Equivalent web/mobile check-ins; metric-only overwrite; foreign template or photo. | Shared canonical result; preserve unchanged photos; reject foreign resources; immutable source revision available to AI. |
| V05 / F07, A08 | Missing, partial, completed and unscheduled observations; repeat exercise twice in one week. | Unknown never becomes zero intake or failed workout; independent session IDs preserve both sessions and units. |
| V06 / F08 | Reminder time across DST and non-whole-hour zones; missed sweep; provider failure. | Due work catches up within policy, respects preferences and retries channel attempts without generating extra coaching decisions. |
| V07 / F08, A02 | Reminder processing fails; account with detached media and queued AI work is due for deletion. | Deletion still executes independently; cleanup retains discoverable paths until successful; no later worker resurrects content. |
| V08 / A01 | AI enrollment races human acceptance, provider handoff or account deactivation. | One authoritative context; no arbitrary `findFirst` provider choice; stale worker loses authority. |
| V09 / A03–A04 | Unsupported intake, missing calculation input, unapproved/revoked policy, infeasible recipe constraints. | No unsupported prescription or invented default; approved alternative, clarification or scoped restriction is explicit. |
| V10 / A05 | Duplicate submission, timeout, reclaimed lease, delayed old worker response, repeated transient errors; safety/policy-only invalidation followed by a fresh request. | One logical result per current business input; changed safety/policy permits fresh work without resetting the adjustment slot; current fencing token required; bounded retries/cost; no network call inside a database lock. |
| V11 / A06–A07 | Eligible client without human assignment completes macro mode, then meal mode. | One nutrition prescription; valid structured strength/cardio; practical portions and approved ingredients; no AI writes into legacy human plan tables. |
| V12 / A09 | Weekly review with shipped minimal input UI, including sufficient and insufficient evidence trajectories. | A genuinely supported nutrition `ADJUST` can occur under approved policy; insufficient data yields useful `HOLD`, `SIMPLIFY` or `CLARIFY`. Do not secretly require a deferred food tracker. |
| V13 / A09–A10 | Accept routine A; supersede its presentation; pause/re-enroll; attempt routine B in same review window. | Persistent `AiAdjustmentSlot(clientId, reviewWindowKey)` prevents another routine adjustment. Retry, travel timezone and representation changes cannot reset allowance. |
| V14 / A10 | Two tabs accept; two candidates share an old base; old accepted candidate replayed. | One current pointer and legitimate acceptance; replay reports historical/current state without reactivating old advice; stale candidate cannot overwrite. |
| V15 / A09–A10 | Correct/delete referenced evidence after snapshot; separately add an ordinary post-cutoff observation. | Decision-affecting correction invalidates; ordinary later logging follows contract rules and does not silently alter the frozen decision. No perpetual stale loop. |
| V16 / A10 | Accept a candidate after its canonical review window closes. | Server time rejects late activation and requires fresh review; old and new windows cannot stack deferred adjustments. |
| V17 / A03, A10 | New safety concern before acceptance or during provider outage; valid allergy disclosure in a partial draft whose unrelated fields fail validation; attempted removal of that concern; attempt to label an intensification `PROTECTIVE`. | Reviewed restrictions apply immediately despite unrelated draft errors; affected advice stops being actionable; clearing follows reviewed resolution; history stays labeled; server alone assigns protective class and forbids intensification. |
| V18 / A11 | Unapproved candidate; wrong reviewer; changed payload/hash or relevant revisions after approval. | Participant cannot view actionable numerical proposal before required approval; approval applies only to exact validated state; ordinary `isCoach` is insufficient authority. |
| V19 / A12 | Notes inject instructions, hallucinated catalog IDs, invalid quantities, concealed allergy ingredient, false certainty, compensation request. | Policy/tool boundaries hold; substantive invalidity never receives reassuring publication; approved explanation matches actual decision. Include benign cases to detect over-refusal. |
| V20 / A12, L01 | Beginner completes intake → plan → first session → minimal check-in → revision; network drops at each submission boundary. | Saved/current states reflect server acknowledgement; reload resumes; proposed/current/paused are understandable; no human assignment required. |

Test urgency responses with fictional cases; do not provoke symptoms or unsafe exercise in participants. A structured urgent disclosure receives the approved response without waiting for the model, cron, payment or notification service. The product must not imply continuous emergency monitoring.

## 3. Run and record the right gates

After isolated setup, applicable commands include:

```bash
pnpm exec vitest run tests/unit
SECURITY_INTEGRATION=1 pnpm exec vitest run tests/integration
pnpm run type-check
pnpm run lint
pnpm run build
pnpm exec playwright test
```

Run schema validation/generation and migration rehearsal when schema changes. Run smoke tests only against the explicitly isolated server. Update the release script to invoke applicable suites; a skipped integration or browser suite must be reported as skipped, not passed. Broaden testing to resolve a concrete remaining risk rather than requiring indiscriminate test churn for every copy edit.

Each release record contains commit, migration identifiers, policy/catalog/model configuration versions, commands, actual pass/fail/skip, scenario evidence, known limitations, rollout flags, owner and rollback method. Require zero observed critical invariant violations in the release suite; that criterion is not proof of universal safety. Separately report professional judgment of action appropriateness, missed concerns, excessive refusals and explanation quality on held-out ordinary, adversarial and multiweek cases.

## 4. Real users and professional review

All personas in this pack are simulated. Conduct two formative rounds of approximately 5–8 representative beginners using fictional intake/health scenarios first. Recruit across time/budget constraints, food cultures, tracking comfort and accessibility needs. This is a usability sample, not an effectiveness study.

Ask participants to find today's food/training, swap an unavailable meal, distinguish current from proposed advice, explain a hold, report a concern and resume after a missed week. Record task completion, facilitator help, comprehension and burden with consent. Resolve safety-critical misunderstanding before self-use; stop a session for distress or reported immediate health concern under the reviewed study procedure. Keyboard, screen-reader and small-viewport verification supplements these sessions.

The invited live pilot requires actual qualified staff and a functioning reviewer queue. Review all initial numerical plans and proposed intensifications before participants see them; sample holds/protective outcomes and handle flagged cases according to policy. Queue records include required reviewer capability, exact payload hash/revisions, disposition and timestamp. Audit access and do not copy health notes into general analytics. Capacity limits enrollment; no reviewer availability means the participant sees an honest pending state, never a fabricated approval or response promise.

## 5. Deployment, incidents and rollback

Before L01, verify the every-minute worker's deployed scheduler/function capability, secret authorization, timeout headroom and recovery from missed/overlapping invocations. Vercel does not automatically retry failed cron invocations, so application reconciliation remains required. [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

Track oldest eligible queued run, terminal failures, recovered leases, stale rejections, reviewer backlog, notification attempts, oldest due deletion, policy violations and support burden. Name an operational owner and alert thresholds before enrollment. Enrollment, generation and publication flags default OFF; demonstrate each kill switch in staging. Review availability is a separate gate from technical uptime.

On a confirmed critical privacy breach, unsafe activation, duplicate adjustment or policy bypass:

1. Disable affected generation/publication immediately and restrict impacted advice according to reviewed policy. Preserve minimal access-controlled incident evidence.
2. Identify affected users, versions, runs and exposure; involve qualified policy/security/privacy owners as relevant. Technical support must not improvise clinical advice.
3. Repair the cause and address affected users through the actual incident procedure. A provider outage with unchanged eligibility can preserve useful current advice; new safety information may require pausing it.
4. Roll back compatible application code or roll forward a repair. Do not blindly restore an old plan, reverse additive migrations, or restore the entire database: that may undo valid later changes or deletions.
5. Verify the mechanism-specific regression, impacted critical invariants and relevant holdout cases. Re-enable a small cohort with monitoring and record owner approval.

Policy approval, staffed review, scheduler readiness and evaluated behavior are distinct release conditions. Engineering proceeds against synthetic fixtures now; individualized live publication remains disabled until the corresponding evidence exists.
