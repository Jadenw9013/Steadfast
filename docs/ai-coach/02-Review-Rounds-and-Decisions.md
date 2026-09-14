# Multi-role review record and final decisions

This records the work performed for this pack. Six separate AI reviewers examined the repository and proposed product, then challenged a shared decision brief and the integrated documents. A coordinator reconciled the results. Three rounds occurred; corrections from the closure round were rechecked. All professional and user perspectives are simulated. Code findings are static observations, not executed exploits or passing tests.

## Round 1 — independent role considerations

| Review team / roles | Main consideration | What it changed |
|---|---|---|
| Backend developer and security reviewer | Ownership must be legitimate before an assignment check can protect anything. Published history must survive editing. | Found coach-controlled existing-account linking, deactivation omissions, client-wide conversations and published meal/training mutation. Prioritized F01–F05 before live AI. |
| AI engineer and systems architect | Reliability depends on durable state, evidence provenance and limited authority, not self-critique prompts. | Selected shared TypeScript services, canonical immutable AI plans, read adapters, persistent jobs, exact revisions and guarded activation. |
| Frontend engineer, product designer and human factors reviewer | Beginners need an understandable next action and honest saved/current states. Existing UI can distort evidence. | Identified misleading adherence/streak displays, macro/cardio gaps, bodyweight/session limitations and contradictory design rules. Specified staged intake, minimal logging and explicit proposed/current/paused views. |
| Nutrition adviser, fitness coach and meal-psychology perspective | A valid-looking target can still be inappropriate; safety, evidence sufficiency and practical feasibility are different decisions. | Rejected invented numerical safety defaults, arbitrary upper-age scope, blanket stable-condition refusal and punishment for missing data. Required reviewed policy/content and coordinated domain decisions. |
| CEO, business planner and product lead | The value is repeated user execution, with real support cost and honest competitive claims. | Kept both nutrition modes, deferred the full tracker, separated client entitlements from coach billing and made qualified pilot labor/capacity explicit. |
| External tester, end-user and QA/release perspective | Ordinary misunderstanding, retries and missing data can defeat a polished demo. | Verified thin smoke/browser coverage, reminder timing mismatch and deletion coupling. Added adverse/concurrency cases, real-user protocols and precise release gates. |

The “end-user” review considered time-poor beginners, people with limited food budgets or equipment, users uncomfortable with tracking, bodyweight trainees and people returning after missed weeks. Those scenarios generated hypotheses and tests; no participants were recruited during planning.

## Round 2 — disagreements and reconstruction

| Debate | Competing considerations | Resolution |
|---|---|---|
| Full meals versus a narrow MVP | Business/user request needs meals; engineering needs manageable content. | Build macro mode first internally; deliver both modes before calling the complete MVP done. Restrict meals to feasible reviewed catalogs. |
| Minimal logging versus real adaptation | A full diary can overwhelm beginners; weak evidence cannot justify numerical changes. | Ship structured weekly observations and session logs. Reviewed methods declare sufficiency; do not infer precise intake/expenditure from checkoffs. Require a valid nutrition ADJUST path using shipped inputs. |
| “Better than a coach” versus demonstrable value | Ambition can become unsupported health or competitive claims. | Measure comprehension, execution, appropriate decisions, burden and harm against strong baselines. Superiority remains unproven. |
| Safe fallback versus new health information | Retaining an old plan helps during downtime but can perpetuate unsafe instructions. | Technical failure preserves only still-permitted domains. Safety changes restrict relevant instructions immediately, independent of model jobs. |
| Reusing legacy plan tables versus preserving truth | Reuse looks fast; duplicate mutable projections create inconsistent current plans. | AI stores one immutable canonical plan. A shared server-selected DTO adapts human or AI sources. Repair human mutation independently. |
| Smooth human transfer versus privacy | Seamless handoff can accidentally expose old private conversations. | One current provider authority plus separate consented history permissions. Ambiguous old messages become client-only archives, not guessed recipients. |
| Prompt expertise versus approved policy | Retrieval and JSON improve structure but do not establish clinical correctness. | Deterministic reviewed policy controls actions and values; model authority stays bounded. No live research-to-prescription pipeline. |
| Professional review versus affordability | Unstaffed review promises are misleading; hidden universal labor destroys cost assumptions. | Real qualified review of policies/content and all initial/intensifying pilot plans. Budget capacity; reduce routine review only through a later evidence decision. |
| Multiple reviewers versus scope inflation | Each role can add an entire new platform. | Defer photos, wearables, broad chat, arbitrary recipes, new native UI and paid-client checkout until their separate gates. |

## Round 3 — integrated handoff challenge

Reviewers read the combined product, architecture, contracts, UX, backlog and validation documents. The final round found and corrected implementation issues that earlier high-level agreement had missed:

1. **Acceptance replay order:** checking an old base/revision before recognizing a successful prior acceptance could reject a legitimate retry. The owner-authorized receipt path now runs first and returns the freshly resolved current plan without reactivating history.
2. **Job identity after changed safety:** deduplication that omitted safety, policy and source versions could return an obsolete completed run forever. The business key now includes those inputs and permits fresh eligible work without resetting adjustment limits.
3. **Unconditional lock order:** every relevant mutation locks the persistent client User row before context/profile; the wording no longer suggests that this applies only during creation.
4. **Migration dependency:** F02 needs context for consent-bound transitions. F02 now creates it in a staged repair; A01 reuses it for AI instead of defining a circular prerequisite.
5. **Retry accounting:** the executor now specifies attempt limits per stage and a total stage/call cap, rather than an ambiguous “three retries.”
6. **Safety in unfinished drafts:** a valid concern disclosure cannot wait for unrelated intake fields to pass validation. Safety commands and clearance rules are explicit.
7. **UI contract details:** observation status vocabulary, review-list navigation, grocery quantities and separate lookback/activation dates are carried into the integrated handoff.

The final consistency checks distinguish document coherence from runtime or clinical validation. Actual tests, professional approvals, deployed capacity and participant outcomes remain explicitly uncompleted gates.

## Final decision ledger

| ID | Decision | Consequence / reopen trigger |
|---|---|---|
| D01 | Repair consent and current authorization first. | F01/F02 can ship independently. Reopen only on new call-path evidence, not UI convenience. |
| D02 | One current provider; historical permissions separate. | Context is transactional. Revisit concurrent providers only with an explicit responsibility/access model. |
| D03 | Keep Next/TypeScript and shared services. | No separate Python or vector platform. Revisit on measured capability/scale need. |
| D04 | Immutable AI payloads plus read adapters. | No AI legacy-table copies. Revisit only for a demonstrated consumer requirement with consistency proof. |
| D05 | Reviewed deterministic policy controls prescriptions. | Synthetic development now; real policy gate before live numbers. A new model cannot grant itself more authority. |
| D06 | Both macros and bounded meals in complete MVP. | Internal macro-first sequencing does not remove meals. Broader cuisines require catalog coverage evidence. |
| D07 | Minimal evidence, explicit uncertainty. | Method-specific sufficiency; no hidden tracker dependency. Additional logging must earn its burden. |
| D08 | One routine adjustment slot, persistent history. | Re-enrollment, travel, representation and supersession cannot reset limits. Policy controls cumulative/protective behavior. |
| D09 | Qualified pilot approval and user acceptance are separate. | Both required where applicable; new safety facts invalidate prior permission. |
| D10 | Durable jobs with default-OFF controls. | No fire-and-forget generation. Deployment must support the chosen execution contract. |
| D11 | Invite entitlement before paid-client checkout. | Existing coach billing remains distinct; fix its identified ordering issue independently. |
| D12 | Honest supervised pilot and evidence-based claims. | No imaginary professional service, fabricated testing or automatic “better than coach” positioning. |
| D13 | Privacy lifecycle is part of the feature. | Minimize data, isolate history and preserve cleanup references; account deactivation stops new work. |
| D14 | Reusable review process, bounded coding slices. | [11](11-Reusable-Company-Review-Workflow.md) supplies reusable prompts and closure criteria; [08](08-Implementation-Backlog.md) controls implementation order. |

A later change should name the decision it reopens, new evidence, affected contracts/tests and its owner. Do not quietly add competing enums or sources of truth in a coding-agent prompt.
