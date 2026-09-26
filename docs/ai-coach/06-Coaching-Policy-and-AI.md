# Coaching policy, evidence and AI responsibilities

This is an implementation specification, not clinical approval. It implements PR-01–09 through slices A03–A12. [API and state contracts](05-API-and-State-Contracts.md) own the canonical types; [release operations](09-Validation-Release-Operations.md) own deployment gates. Numerical clinical parameters must come from actual qualified review, not this document or a coding model.

## 1. Supported scope and useful limits

Support adult beginners pursuing general fitness and goals covered by the approved policy. Do not invent an upper-age cutoff, infer suitability from body size, or reject every stable chronic condition. Assess the requested action against explicit scope, reported symptoms and relevant restrictions. Clinical nutrition, eating-disorder treatment, pregnancy/lactation programming, rehabilitation and rapid weight manipulation are outside autonomous MVP capability.

NIDDK limits its Body Weight Planner to adults outside pregnancy/breastfeeding; its calculator limits do not establish a universal safe prescription for Steadfast. [NIDDK planner](https://www.niddk.nih.gov/bwp)

Keep three decisions separate:

| Layer                | Contract                                                     | Purpose                                                  |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Safety disposition   | `CLEAR / CLARIFY / RESTRICTED / REFER / URGENT`              | Determines the appropriate response and support pathway. |
| Domain permission    | Nutrition, strength and cardio: `ALLOW / HOLD_ONLY / PAUSED` | Determines which recommendations may remain actionable.  |
| Evidence sufficiency | Rule-specific required observations and reasons              | Determines whether a particular change is justified.     |

An unchanged plan can remain available after a technical failure only while current domain permissions allow it. New safety information can invalidate a proposal and pause affected daily recommendations immediately. Do not wait for a weekly model job. History remains distinguishable from current advice. Urgent responses use reviewed location-appropriate guidance and never imply continuous monitoring.

## 2. Executable policy bundle

Build the loader, validators and synthetic fixtures before real policy content is ready. An approved bundle must contain:

| Group                | Required fields or equivalent validated content                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity             | ID, version, schema/engine compatibility, content digest, effective date, publication/revocation state.                                                      |
| Accountability       | Named owner, reviewer identity and domain qualifications, review date, actual review record, signoff scope. A model-generated signature is invalid.          |
| Applicability        | Supported population, goals, geography/language, required inputs, exclusions, unknown-answer behavior and permitted alternatives.                            |
| Nutrition            | Estimation method and limitations; physiological inputs; activity assumptions; target constraints; nutrient coverage; portion and catalog feasibility rules. |
| Adaptation           | Required evidence, trend method, permitted directions and amounts, cooldowns, cumulative limits, reason codes and uncertainty behavior.                      |
| Exercise             | Reviewed template/exercise IDs, starting-dose rules, progression evidence, equipment increments, recovery and combined workload constraints.                 |
| Safety/content       | Screen and urgency rules, domain pause/restart mapping, ingredient/allergen checks, source compatibility and prohibited claims.                              |
| Validation/lifecycle | Boundary and multiweek fixtures, required evaluation version, re-review triggers, revocation effects and accountable operational owner.                      |

Clinical owners must specify the actual numerical values with units and population rationale. Missing values are not filled from model recall. A review date alone does not define expiry: the bundle explicitly defines when new recommendations stop and when existing domains require reassessment.

Synthetic policies are restricted to synthetic subjects in test environments. A feature flag or invitation cannot authorize real recommendations from them. Real publication requires a valid approved bundle and compatible reviewed catalogs. Policy revocation is rechecked before activation.

V1 uses **bounded autonomous coaching**, not mandatory per-client human review. A professionally reviewed and versioned policy bundle, curated food/exercise catalogs, contraindication/escalation rules and compact evidence registry are prerequisites for live use. For an in-scope client, deterministic server gates calculate targets, enforce restrictions and limits, establish evidence sufficiency, validate the complete result and choose exactly one outcome: `APPROVE_AUTOMATICALLY`, `HOLD`, `FOCUSED_CLARIFICATION`, or `PAUSE_REFER`. Higher-risk, out-of-scope, safety-ambiguous or insufficiently evidenced cases never activate a plan and receive the applicable hold, focused clarification or pause/refer path with a full audit record. Reviewer operations remain available for policy governance, incident review and any future explicit exception policy; they are not a default visibility gate.

## 3. Deterministic controller and bounded model

The service validates intake, evaluates safety, selects applicable rules, computes permitted options, checks the combined plan and records the decision. The model may interpret current-client language, extract preferences or concerns, rank already-eligible catalog choices, ask a focused clarification and explain validated results. It cannot decide authority, access across clients, policy applicability, clinical constants, food facts, contraindications, escalation, evidence sufficiency, constraint bypasses, plan activation or urgent-health/clinical disposition. It has no browser, scraper, arbitrary retrieval, shell, SQL or cross-client memory capability.

Use a compact, versioned evidence registry: source URL, relevant claim, population, limitations, professional reviewer, applicable rule IDs and review date. V1 has no RAG/vector database, live web research, browsing or scraping. Client notes and model output remain untrusted input. A source citation must support the particular claim and population. Hallucination controls reduce risk without eliminating it. [Anthropic guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)

Pin model/prompt/tool configuration and evaluate upgrades on held-out cases. Give the provider no arbitrary SQL, shell, browsing or cross-user memory. Supply minimum necessary context. Record validated facts and reason codes rather than relying on hidden model reasoning. Render numerical explanations from validated fields; use approved template wording when generated wording conflicts. (T-996) The bounded model is called directly against Anthropic's Messages API — a packet-pinned model ID and effort level, structured JSON output only, no tools — rather than through an invented gateway contract; zero-data-retention and no-training are organization-level attestations recorded against a signed record, not per-request flags the code sends. (T-2006/T-2030) The model may also write up to two short sentences of bounded explanation/clarification prose; every sentence is validated server-side against the same validated numeric fields, plan display names and outcome before a client ever sees it, and any rejected sentence falls back to the approved template wording exactly as this document already required — the wording never leaves the server unvalidated.

## 4. Inputs required for actual adaptation

Initial personalized calorie/macro targets require the selected policy's measurements and other variables, with explicit units. Do not infer physiological variables from the existing `gender` string, name or appearance. When a required input is absent, keep personalized nutrition pending or use an explicitly reviewed alternative. Independently permitted education or training can remain available.

Weekly review uses the shipped structured check-in: comparable measurements when needed, plan-following self-report, completeness, departures/barriers, recovery, hunger/energy, sessions and changed symptoms/circumstances. Full daily food tracking is deferred. A reviewed rule may support bounded adjustment from this evidence without reconstructing exact intake or expenditure. If the chosen method requires quantified daily intake, collect it explicitly or do not use that method.

Preserve `not reported`, `not tracked` and `not scheduled`. Self-reported compliance, meal checkoffs, external-tracker summaries, photo estimates and measured quantities have different evidential value. Confirmation does not transform an estimate into a measurement. Do not conclude nonadherence or prescribe restriction from missing logs.

The completed adaptive MVP must demonstrate an eligible nutrition `ADJUST` trajectory using inputs the shipped UI actually collects. A release capable only of holding because required observations are absent is an earlier feasibility preview.

The deterministic prescription engine (`lib/ai-coach/prescription/`) is the sole producer of personalized nutrition targets. Neither language models nor client-side heuristics may invent, modify, or output target numbers. All policy parameters required by the prescription engine are governed by reviewed artifact bundles. Checked-in artifacts without qualified professional sign-off carry the explicit `DRAFT_UNSIGNED` review decision (`lib/ai-coach/artifacts/schema.ts`), which is refused by artifact loaders (`ARTIFACT_UNSIGNED_DRAFT`), repository publication, and live-launch validators, mathematically preventing unreviewed clinical parameters from ever reaching client devices.

**2026-09-26 (T-2033):** `composeInitialPlan` (`lib/ai-coach/initial-plan.ts`) is now prescription-first for a v2-confirmed intake: it calls the engine before composing any catalog meals, and `composeMealsToPrescription` verifies a composed day against the prescription (never invents portions that miss it). A v1 intake still uses the legacy fixture-scaled composer byte-for-byte. The autonomy gate (`lib/ai-coach/autonomy/gate.ts`) now has a `TARGET_AND_LIMITS`-stage check that makes `APPROVE_AUTOMATICALLY` unreachable whenever a goal requires an energy target and the engine did not produce one — closing the prior gap where a candidate with `nutrition: null` could be approved simply because NUTRITION was absent from the requested domains. `weekly-controller.ts`'s fixture nutrition-adjustment step now refuses (HOLD `WEEKLY_POLICY_PARAMETERS_UNAVAILABLE`) rather than scaling a `REVIEWED_PRESCRIPTION_V1` target by a fixture constant; T-2007 replaces the guard with real bundle parameters.

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
