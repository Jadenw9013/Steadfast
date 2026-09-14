# Coaching policy, evidence and AI responsibilities

This is an implementation specification, not clinical approval. It implements PR-01–09 through slices A03–A12. [API and state contracts](05-API-and-State-Contracts.md) own the canonical types; [release operations](09-Validation-Release-Operations.md) own deployment gates. Numerical clinical parameters must come from actual qualified review, not this document or a coding model.

## 1. Supported scope and useful limits

Support adult beginners pursuing general fitness and goals covered by the approved policy. Do not invent an upper-age cutoff, infer suitability from body size, or reject every stable chronic condition. Assess the requested action against explicit scope, reported symptoms and relevant restrictions. Clinical nutrition, eating-disorder treatment, pregnancy/lactation programming, rehabilitation and rapid weight manipulation are outside autonomous MVP capability.

NIDDK limits its Body Weight Planner to adults outside pregnancy/breastfeeding; its calculator limits do not establish a universal safe prescription for Steadfast. [NIDDK planner](https://www.niddk.nih.gov/bwp)

Keep three decisions separate:

| Layer | Contract | Purpose |
|---|---|---|
| Safety disposition | `CLEAR / CLARIFY / RESTRICTED / REFER / URGENT` | Determines the appropriate response and support pathway. |
| Domain permission | Nutrition, strength and cardio: `ALLOW / HOLD_ONLY / PAUSED` | Determines which recommendations may remain actionable. |
| Evidence sufficiency | Rule-specific required observations and reasons | Determines whether a particular change is justified. |

An unchanged plan can remain available after a technical failure only while current domain permissions allow it. New safety information can invalidate a proposal and pause affected daily recommendations immediately. Do not wait for a weekly model job. History remains distinguishable from current advice. Urgent responses use reviewed location-appropriate guidance and never imply continuous monitoring.

## 2. Executable policy bundle

Build the loader, validators and synthetic fixtures before real policy content is ready. An approved bundle must contain:

| Group | Required fields or equivalent validated content |
|---|---|
| Identity | ID, version, schema/engine compatibility, content digest, effective date, publication/revocation state. |
| Accountability | Named owner, reviewer identity and domain qualifications, review date, actual review record, signoff scope. A model-generated signature is invalid. |
| Applicability | Supported population, goals, geography/language, required inputs, exclusions, unknown-answer behavior and permitted alternatives. |
| Nutrition | Estimation method and limitations; physiological inputs; activity assumptions; target constraints; nutrient coverage; portion and catalog feasibility rules. |
| Adaptation | Required evidence, trend method, permitted directions and amounts, cooldowns, cumulative limits, reason codes and uncertainty behavior. |
| Exercise | Reviewed template/exercise IDs, starting-dose rules, progression evidence, equipment increments, recovery and combined workload constraints. |
| Safety/content | Screen and urgency rules, domain pause/restart mapping, ingredient/allergen checks, source compatibility and prohibited claims. |
| Validation/lifecycle | Boundary and multiweek fixtures, required evaluation version, re-review triggers, revocation effects and accountable operational owner. |

Clinical owners must specify the actual numerical values with units and population rationale. Missing values are not filled from model recall. A review date alone does not define expiry: the bundle explicitly defines when new recommendations stop and when existing domains require reassessment.

Synthetic policies are restricted to synthetic subjects in test environments. A feature flag or invitation cannot authorize real recommendations from them. Real publication requires a valid approved bundle and compatible reviewed catalogs. Policy revocation is rechecked before activation.

For the supervised pilot, **every initial numerical plan and every proposed intensifying change requires qualified review before participant visibility**. Reviewer approval is bound to the exact payload hash and relevant revisions. An `isCoach` flag does not establish professional qualification or case access. The pilot needs real authorized staff, consented review access, capacity and response expectations. Holds, protective actions and flagged cases follow the sampling/escalation protocol in [operations](09-Validation-Release-Operations.md). Removing routine human review later requires a separate evidence gate.

## 3. Deterministic controller and bounded model

The service validates intake, evaluates safety, selects applicable rules, computes permitted options, checks the combined plan and records the decision. The model may extract preferences, identify concerns, rank eligible catalog choices and explain validated results. It cannot waive a structured concern, invent food facts, choose clinical constants, alter authorizations or activate a plan.

Use a small versioned evidence registry: source URL, relevant claim, population, limitations, reviewer, applicable rule IDs and review date. Retrieval is optional; a vector database is not required for the MVP. Retrieved text and client notes remain untrusted input. A source citation must support the particular claim and population. Hallucination controls reduce risk without eliminating it. [Anthropic guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)

Pin model/prompt/tool configuration and evaluate upgrades on held-out cases. Give the provider no arbitrary SQL, shell, browsing or cross-user memory. Supply minimum necessary context. Record validated facts and reason codes rather than relying on hidden model reasoning. Render numerical explanations from validated fields; use approved template wording when generated wording conflicts.

## 4. Inputs required for actual adaptation

Initial personalized calorie/macro targets require the selected policy's measurements and other variables, with explicit units. Do not infer physiological variables from the existing `gender` string, name or appearance. When a required input is absent, keep personalized nutrition pending or use an explicitly reviewed alternative. Independently permitted education or training can remain available.

Weekly review uses the shipped structured check-in: comparable measurements when needed, plan-following self-report, completeness, departures/barriers, recovery, hunger/energy, sessions and changed symptoms/circumstances. Full daily food tracking is deferred. A reviewed rule may support bounded adjustment from this evidence without reconstructing exact intake or expenditure. If the chosen method requires quantified daily intake, collect it explicitly or do not use that method.

Preserve `not reported`, `not tracked` and `not scheduled`. Self-reported compliance, meal checkoffs, external-tracker summaries, photo estimates and measured quantities have different evidential value. Confirmation does not transform an estimate into a measurement. Do not conclude nonadherence or prescribe restriction from missing logs.

The completed adaptive MVP must demonstrate an eligible nutrition `ADJUST` trajectory using inputs the shipped UI actually collects. A release capable only of holding because required observations are absent is an earlier feasibility preview.

## 5. Coordinated weekly decisions

`HOLD`, `SIMPLIFY`, `ADJUST`, `CLARIFY` and `PAUSE_REFER` are meaningful outcomes. Review cadence does not require a numerical change. Nutrition, cardio and resistance proposals share the same accepted baseline and joint validator; never create an invented conversion between calorie restriction and lifting workload.

Material prescription changes, including simplifications, use `ROUTINE` and the single accepted adjustment slot per canonical window. `TARGET_PRESERVING` applies only to validated equivalent changes; `PROTECTIVE` is assigned by reviewed deterministic policy and cannot increase restriction or exertion. Those labels cannot bypass cumulative constraints. [Contracts](05-API-and-State-Contracts.md) define acceptance, revisions and slot invariants.

Examples: sparse measurements lead to hold/clarification; schedule barriers can justify simplification; sufficient goal/recovery evidence may justify a bounded change. New concerns can pause relevant recommendations. Do not diagnose a physiological cause from ambiguous trends, reward rapid weight loss despite worsening recovery, or suggest compensatory fasting/exercise.

## 6. Practical meal and training content

Macro and meal modes represent one nutrition prescription. Meal mode uses reviewed recipes, practical portion ranges, compatible ingredients, repeatable meals and checked swaps. Include budget, food access, cultural preferences, preparation time and storage constraints. Grocery quantities distinguish purchase amounts from consumed portions and recipe servings.

Food records preserve source ID/version, ingredient/allergen evidence, raw/cooked state, units and nutrient missingness. Required nutrient gaps fail the relevant adequacy check; matching macros alone does not establish a complete diet. USDA distinguishes energy-calculation methods, so rounded food records need justified source-aware tolerances rather than unconditional exact `4P + 4C + 9F` equality. [USDA documentation](https://fdc.nal.usda.gov/Foundation_Foods_Documentation/)

Never guarantee allergy safety from a database match; current ingredients and cross-contact conditions may require verification. Every swap reruns relevant constraints. When no feasible meal fits, explain the limitation rather than ignoring an allergy or inventing nutrients.

Training uses stable reviewed exercises, understandable demonstrations, appropriate equipment alternatives and session-level evidence. Start and progress under the approved beginner protocol; retain familiar practice when suitable. ACSM's 2026 healthy-adult summary supports individualization and accessible resistance training, without making complex techniques necessary defaults. It does not validate Steadfast's algorithm. [ACSM summary](https://acsm.org/resistance-training-guidelines-update-2026/)

No autonomous rehabilitation, pain diagnosis, unvalidated technique assessment or instructions to push through concerning symptoms. Cardio guidance follows the same goal, recovery and safety checks as strength and nutrition.

## 7. Behavior and evaluation

Avoid moral food labels, punitive streaks, body shaming, “earning” food and compulsive logging incentives. Offer practical portions without constantly displaying numbers when the user prefers. This is a presentation choice, not eating-disorder treatment. NIMH notes that eating disorders occur across body weights; behavioral concerns cannot be dismissed by a body-size screen. [NIMH](https://www.nimh.nih.gov/health/publications/eating-disorders)

Evaluate harmful false acceptance and inappropriate refusal separately. Include allergy errors, unsupported numerical changes, missing-data misuse, cumulative intensification, symptom response, explanation consistency and plan invalidation. Mandatory longitudinal cases include noisy weights, missed logs, schedule disruption, worsening recovery despite weight loss, new allergy before acceptance, exercise pain, duplicated/revised check-ins and a valid bounded adjustment.

Compare the model-assisted experience against a strong static/rules baseline. Real users must demonstrate comprehension and feasible first actions; measure burden and distress alongside goal outcomes. Simulated reviewers and passing fixtures establish neither clinical approval nor superiority to a qualified coach.
