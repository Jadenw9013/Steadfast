# Reusable company review workflow

Use this workflow for a new feature, substantial change, or repair. It applies beyond fitness and beyond AI. Specialist perspectives are review tools; they do not replace real users, credentialed professionals, security testing, or production evidence.

## 1. Establish an evidence packet

The coordinator records the user problem, intended audience, observable outcome, scope, non-goals, repository commit, relevant instructions, current user flows, data owners, existing tests, operating constraints and prior decisions. Separate these labels:

- **Observed:** verified in code, a running system, or a cited primary source. State which.
- **Proposed:** a design choice, including its rationale and rejected alternative.
- **Hypothesis:** a claim requiring an experiment or user research.
- **Gate:** evidence or a capability required before a specified release stage.
- **Unknown:** something the team has not established. Give it an owner and next action.

Read the actual implementation before trusting architecture prose. Pin code findings to a commit and file/function. Inspect identity, ownership and lifecycle before designing new screens. Treat marketing pages as evidence of advertised capabilities, not independent performance.

## 2. Round 1 — independent perspectives

Each reviewer works from the evidence packet before reading others' conclusions. They report at most five major concerns, two things worth preserving, one proposed simplification, one measurable failure case and one disagreement to resolve. They must describe the user or system consequence of every recommendation.

| Role | Questions to ask | Required contribution |
|---|---|---|
| CEO | Who benefits first? What promise are we making? What would damage trust? | Value proposition, scope boundary, investment/stop decision. |
| Business planner | What will users pay for repeatedly? Which costs grow with use? | Unit economics, capacity assumptions, willingness-to-pay experiment. |
| Product lead | What complete user job does this solve? What is deferred? | Journey, acceptance criteria, dependencies and scope cuts. |
| Backend developer | Who owns each object? What happens on retries, concurrent writes and deletion? | Data model, invariants, migration and compatibility plan. |
| AI engineer, when relevant | Which decisions need a model? What evidence can it use? What limits its authority? | Typed contracts, deterministic checks, evaluation and bounded failure behavior. |
| Frontend engineer | Can each server state be represented accurately? Does web/mobile behavior agree? | Component boundaries, state table, accessibility and failure recovery. |
| Human factors reviewer | What must the user remember or infer? What is confusing under stress? | Reduced cognitive load, reversible actions, comprehension tests. |
| Behavioral/psychology perspective | What incentives, shame, dependency or compulsions could the product create? | Safer copy, autonomy, burden controls and escalation boundaries. |
| Domain practitioner | What evidence supports advice? Where does this leave normal scope? | Reviewed content/policy requirements, contraindications and referral boundaries. |
| Security/privacy reviewer | Can one actor gain another person's data or authority? | Abuse cases, least privilege, consent, retention and incident controls. |
| External tester perspective | How does this fail when instructions are misunderstood or skipped? | Independent adversarial tasks and observable expected outcomes. |
| End-user perspective | Can I achieve my goal with my time, budget, abilities and knowledge? | Concrete scenario, friction, plain-language comprehension criteria. |
| QA/release/operations | Can failures be detected, contained and recovered without guessing? | Verification matrix, rollout gates, ownership and runbooks. |

For health, finance, legal or other specialist advice, name the real qualifications and review work required. Do not label an AI role-play as a professional approval. Simulated user reactions are hypotheses; schedule real testing.

## 3. Round 2 — deliberate cross-challenge

The coordinator circulates a short proposed decision brief plus the independent reports. Reviewers must challenge a recommendation outside their original perspective. Useful pairings:

- Engineering challenges business scope and support promises; business challenges infrastructure and review cost.
- Domain safety challenges personalization and growth incentives; human factors challenges burdensome screening and confusing refusals.
- Security challenges every identity, sharing and acceptance transition; QA challenges timing, retries and partial failure.
- Frontend challenges backend states that have no understandable user recovery; end-user review challenges jargon and hidden prerequisites.

For each objection record: the recommendation, the failure it prevents, competing options, evidence, cost, decision and residual risk. Resolve conflicts; do not merge every suggestion into an expanding backlog. If the team removes a requested capability, explicitly distinguish sequencing from a scope change.

## 4. Reconcile and freeze a coherent contract

One coordinator owns the integrated plan. Freeze names for states, IDs, ownership, API errors, event timestamps and source-of-truth records. Give each requirement, finding, decision, implementation slice and verification case a stable ID.

Required outputs:

1. Product requirements and explicit exclusions.
2. Verified code audit with priorities and reproduction/test conditions.
3. Architecture, data ownership, APIs and state transitions.
4. Domain policy and evidence requirements, where applicable.
5. User flows and failure-state behavior.
6. Small implementation slices with dependencies and acceptance cases.
7. Test, rollout, rollback and operating plan.
8. Business hypothesis and measurement plan.
9. Decision ledger and coding-agent entry instructions.

Separate an **engineering start gate** from a **real-user launch gate**. A missing medical policy can block real prescriptions while allowing synthetic fixtures and guarded infrastructure. A verified authorization defect should receive a repair slice immediately; it need not wait for the new product.

## 5. Round 3 — closure and handoff challenge

Reviewers inspect the integrated artifacts rather than their own original proposal. Ask them to attempt a coding handoff: can they implement one slice without inventing an ownership rule, data interpretation, commercial promise or clinical constant?

Close only when:

- Critical/high risks have a specified repair or an explicitly blocked release stage.
- Every product requirement maps to a slice and meaningful verification case.
- Conflicting enums, duplicate sources of truth and vague failure behavior are resolved.
- The team identifies what was actually tested and what is only a test plan.
- Professional, user-research and deployment gates have owners and concrete deliverables.
- Remaining decisions cannot silently become guessed implementation defaults.

Run another round only for an unresolved material risk or changed evidence. Agreement between several AI reviewers is not independent validation. Time-box ordinary preference debates; escalate decisions based on impact and evidence.

## 6. Reusable prompts

### Independent reviewer

```text
Review [feature] as [role]. Read [evidence packet] and inspect [paths] at
[commit]. Do not modify the application. Distinguish observed facts,
proposals, hypotheses, unknowns and release gates. Give the five most
important concerns, two strengths, one simplification and one falsifiable
failure case. Cite exact evidence. Identify one decision other roles
should challenge. Do not claim real testing or professional approval.
```

### Cross-reviewer

```text
Read [decision brief] and [peer reports]. Find consequential conflicts,
missing assumptions and scope inflation. For each, compare alternatives,
choose a resolution and name what evidence would change your decision.
Challenge at least one recommendation outside your own role. Update
your conclusions; do not just append a wish list.
```

### Closure reviewer

```text
Inspect [integrated pack] as if another coding agent will implement it
tomorrow. Trace requirements through data/API/UI/test/release behavior.
Find contradictions, unstated ownership, unsafe defaults and promises
without operational support. Report blockers with exact document paths.
Pass means coherent and implementable, not clinically validated or proven.
```

### Implementation slice

```text
Implement slice [ID] from [backlog], at the current verified repository
revision. Read the existing code and applicable project instructions.
Reconcile drift before editing. Stay within the slice and its file budget.
Use synthetic data unless an isolated test environment is established.
Preserve all stated invariants; do not invent missing domain constants.
Run the relevant tests and required gates. Report files changed, actual
results, remaining blockers and rollback behavior. Do not deploy as part
of this request unless separately authorized.
```

## 7. Templates

Decision: `ID | question | alternatives | evidence | decision | owner | residual risk | reopen trigger`.

Slice: `ID | user/system outcome | dependencies | files to inspect | changes | invariants | acceptance cases | rollout/rollback | evidence status`.

Finding: `ID | commit/file/function | observed behavior | preconditions | consequence | severity | repair | verification`.

Research item: `claim | source/date | applicable population/context | limitation | review owner | next review trigger`.

After release, compare observed behavior with the original hypotheses. Feed incidents, misunderstood screens, refusals, support burden and dropouts back into the next evidence packet. Reuse the process, not yesterday's unverified conclusions.
