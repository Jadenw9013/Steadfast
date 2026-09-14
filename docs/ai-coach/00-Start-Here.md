# Steadfast: company review and implementation pack

**Start with the codebase repairs, then build the bounded AI coaching loop.** This is a fresh handoff that replaces the earlier AI Coach Markdown plans. It preserves the requested complete MVP: intake, macro **or** curated meal plan, strength/cardio, weekly check-ins and justified adjustments.

Repository: [Jadenw9013/Steadfast](https://github.com/Jadenw9013/Steadfast). Verified review baseline: `bda25ea4673b47ccc4c302cb6becbcbad0842d3a`, September 13, 2026. The remote HEAD matched the checkout. Later branches may differ; recheck findings before coding.

Six AI reviewers covered company, engineering, human factors, nutrition/fitness/behavior, end-user and tester perspectives through three review rounds. The coordinator reconciled disagreements and corrected the integrated contracts. These are simulated specialist perspectives and static code analysis. **No real user testing, licensed professional approval, application test execution or production audit is claimed.** No application code was changed in this planning task.

## Read in this order

| File | Purpose |
|---|---|
| [01 — Product and scope](01-Product-and-Scope.md) | What the complete MVP does, its users, requirements and exclusions. |
| [02 — Review rounds and decisions](02-Review-Rounds-and-Decisions.md) | What each role considered, disagreements, changes and final decisions. |
| [03 — Codebase audit](03-Codebase-Audit.md) | Verified existing defects, exact source locations, severity and repair expectations. |
| [04 — Architecture and data](04-Architecture-and-Data.md) | System boundaries, persistent records, ownership and reliable execution. |
| [05 — API and state contracts](05-API-and-State-Contracts.md) | Authoritative vocabulary, source revisions, windows, APIs and atomic acceptance. |
| [06 — Coaching policy and AI](06-Coaching-Policy-and-AI.md) | Reviewed policy/content requirements, safe decision boundaries and model responsibilities. |
| [07 — UX and human factors](07-UX-and-Human-Factors.md) | Routes, screens, states, minimal logging, accessibility and neutral copy. |
| [08 — Implementation backlog](08-Implementation-Backlog.md) | Ordered work packages, dependencies, critical details and requirement-to-test mapping. |
| [09 — Validation, release and operations](09-Validation-Release-Operations.md) | Existing test limits, 20 behavioral tests, real research, gates and incident recovery. |
| [10 — Business and pilot](10-Business-and-Pilot.md) | Differentiation hypothesis, scope, staffed pilot, economics and commercial decisions. |
| [11 — Reusable company review workflow](11-Reusable-Company-Review-Workflow.md) | Repeatable multi-role process, prompts, evidence labels and templates for any feature. |
| [12 — Coding-agent runbook](12-Coding-Agent-Runbook.md) | Repository setup, instruction reconciliation, first coding prompt and slice completion rules. |
| [13 — Sources and open decisions](13-Sources-and-Open-Decisions.md) | Primary sources, assumptions and concrete real-world gate owners/artifacts. |

For the fastest coding handoff, give your agent the **whole folder or ZIP**, then ask it to read 00, 03, 05, 08 and 12 first. Relative links remain usable after extraction. File 05 owns contract names and transaction rules; file 08 owns implementation order. If later evidence requires a change, update the decision and affected documents together.

## The consequential choices

- Fix consent-bound coach linking, deactivated-account authorization, private conversation boundaries and published-plan mutation first. The critical account-linking finding is a static verified call chain, not a claim that a breach occurred.
- Keep the existing TypeScript backend. The AI is a client capability with one current provider authority; no fake human account and no duplicate AI writes into mutable human plans.
- Code owns numbers, policy constraints, identity and activation. AI helps interpret preferences, select permitted content and explain checked decisions.
- Weekly review may hold, simplify, adjust, clarify or pause. Missing logs and rough estimates cannot justify automatic restriction. The complete MVP must nevertheless demonstrate a legitimate nutrition adjustment using evidence its UI collects.
- Both macro and meal modes ship in the complete MVP. Photo logging, wearables and broad health chat are deferred.
- Start engineering with synthetic cases. Real individualized plans require actual reviewed policies/catalogs, qualified supervised-pilot review, privacy readiness and tested operational controls.

The durable advantage to test is a beginner completing a feasible week and understanding the next decision. Claims of outperforming competitors or qualified coaches require evidence beyond this plan.
