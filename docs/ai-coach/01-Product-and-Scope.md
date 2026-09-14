# Steadfast AI Coach: product requirements

Status: proposed implementation specification after cross-functional review. This pack replaces the earlier AI Coach plans. It does not certify safety or establish superiority to a qualified coach.

## Product promise

Help an eligible beginner complete a realistic week of eating and training, then understand whether to keep, simplify or adjust the plan. The useful product is the continuing coaching process: feasible actions, trustworthy records, measured adaptation and understandable reasons.

The initial audience is adults starting or returning to general fitness, within the reviewed eligibility policy and supported launch geography. Do not infer suitability from age alone. A qualified reviewer must define the supported population; no arbitrary universal upper-age cutoff is specified here. Users needing clinical nutrition, rehabilitation or unsupported care receive a scoped explanation and appropriate next step.

The first complete MVP includes **both macro and curated full-meal planning**, plus training, cardio and weekly review. Build macro mode first internally, but do not describe that intermediate milestone as completion of the user's full request.

## Requirements

| ID | Requirement | Observable completion |
|---|---|---|
| PR-01 | Explicit AI enrollment and confirmed intake | An eligible client chooses AI, understands its limits and confirms structured answers before generation. No fabricated human coach account. |
| PR-02 | One coordinated starting plan | Nutrition, strength and cardio fit the user's supported goal, schedule, experience and resources; conflicting recommendations are rejected. |
| PR-03 | Macro mode | A clear target/range presentation and practical guidance; one source of truth for all nutritional values. |
| PR-04 | Curated meal mode | A usable week with portions, preparation guidance, checked totals, grocery quantities and allowed substitutions from a versioned catalog. |
| PR-05 | Beginner training | Stable exercises, demonstrated instructions, prescribed sets/repetitions/effort or duration, rest and equipment alternatives from reviewed templates. |
| PR-06 | Low-burden evidence collection | A brief weekly check-in and simple session results; missing and uncertain observations remain explicit. Photos and detailed food logging are optional later modules. |
| PR-07 | Responsible weekly adaptation | HOLD, SIMPLIFY, ADJUST, CLARIFY or PAUSE_REFER with an understandable reason. At most one accepted ROUTINE prescription change per canonical review window; target-preserving exceptions are validated and safety restrictions apply immediately. |
| PR-08 | Deliberate activation | The user sees changes and accepts a valid proposal; stale, unsafe, duplicate or unauthorized proposals cannot activate. |
| PR-09 | Honest failure handling | Saved intake survives retries; pending/failed/paused states explain what happens next. An older plan is offered only where still allowed by the current safety disposition. |
| PR-10 | Human-coach continuity | A client can request an explicit provider transition; private history is shared only within a valid relationship and its consent scope. |
| PR-11 | Privacy and control | Pause, export, withdraw optional processing permission and delete without losing control of sensitive records. New processing stops on deactivation. |
| PR-12 | Accessible web and shared contracts | Existing web styling is preserved; accessible UI and versioned backend contracts support a separate native client without duplicating decision logic. |

## What the plan adapts to

Preferences include food budget, shopping/cooking access, allergies and intolerances, cultural choices, schedule, desired tracking intensity, available equipment and exercise familiarity. These are constraints, not decorative text in a prompt. If the catalog cannot satisfy them, explain the limitation or ask for a supported alternative. Do not quietly substitute a conflicting food or invent nutritional adequacy.

Outcome evidence includes user-confirmed measurements where appropriate, consistent time windows, session results, self-reported execution, recovery, hunger and practical barriers. Each decision declares the evidence it needs. The system can simplify cooking or scheduling without pretending it knows energy expenditure from an incomplete log. Refusing a weight entry limits weight-dependent adjustment; it does not justify shame, fabricated measurements or abandoning all useful support.

No mandatory progress photos, daily weigh-ins, streaks or food camera. For users who prefer fewer numbers, offer a presentation with portions and practical actions; do not conceal data collection. If inputs required for a personalized prescription are absent, provide an appropriate supported starter pathway or ask for clarification rather than generate a false target.

## Weekly behavior

1. Ask about changed health concerns and what actually happened during the review window.
2. Check whether the evidence is sufficient for each contemplated decision.
3. Evaluate nutrition, cardio and training together against reviewed rules. Do not create a homemade exchange rate between calories and lifting workload.
4. Prefer a stable plan when progress and recovery are acceptable. Address feasibility before increasing demands.
5. Explain one coherent next step. Show exact material changes before acceptance.
6. Apply new safety restrictions immediately; ordinary progression waits for valid user acceptance.

Example: “I missed two sessions because shifts changed” can produce a shorter schedule. It should not automatically produce fewer calories or more cardio. A weight fluctuation with sparse data can produce HOLD or CLARIFY. A new health concern can restrict affected recommendations and invalidate an older proposal.

## Deliberate exclusions

The first release excludes open-ended health chat, diagnosis, medication or supplement prescribing, eating-disorder treatment, rehabilitation, pregnancy/lactation programs, competition prep, arbitrary recipe import, body-fat estimation from photos, wearable-driven energy prescriptions and automatic research ingestion. These exclusions define this product's supported capabilities; they are not claims that everyone outside them cannot exercise.

Photo/barcode food logging, wearables, advanced meal variety, coach copilots and new native UI are later modules. A future food photo is an estimate requiring confirmation and provenance, never measured intake by default. Human referrals do not imply a staffed clinical service or automatic access to health records.

## Success and boundaries

Evaluate comprehension, feasibility, completion of chosen actions, appropriate holds and refusals, reported harm, retention and service cost separately. A single engagement or weight-loss score can hide harmful behavior. Use real participant testing and qualified policy review before live prescriptions. Compare against a strong starter program and rules-based baseline before making performance claims.

Detailed implementation is in [architecture](04-Architecture-and-Data.md), [contracts](05-API-and-State-Contracts.md), [coaching policy](06-Coaching-Policy-and-AI.md) and [backlog](08-Implementation-Backlog.md).
