# Business model, pilot, and commercial decisions

Status: proposed strategy and evaluation design, informed by simulated company-role reviews. No customer interviews, paid experiments, professional signoff, or comparative outcome study occurred in this planning session. The [API and state contracts](05-API-and-State-Contracts.md) govern implementation; the [open-decision register](13-Sources-and-Open-Decisions.md) records outstanding owners and gates.

## Customer and promise

Start with eligible adults beginning or returning to general fitness who want practical guidance and prefer self-guided support to hiring a coach. Their problem is deciding what to eat, how to train, and what to do when an ordinary week goes badly.

Proposed promise: **“A meal or macro plan and a training routine that fit your life, with a weekly review that helps you keep going.”** Test whether the actual experience delivers this value. Do not promise guaranteed results, clinical care, continuous monitoring, or superiority to qualified coaches.

The first supported audience must match reviewed population, food-content, language, and jurisdiction coverage. An English-language US pilot is an operational proposal, not legal clearance for every state. Configure permitted jurisdictions explicitly after appropriate review; live enrollment defaults closed. Collect only location detail needed for eligibility and appropriate guidance, without requiring precise geolocation.

## Competitive positioning

These are current published capabilities checked September 13, 2026, not independent benchmarks or hands-on app findings.

| Product | Published capability | Implication |
|---|---|---|
| Cal AI | Photo, barcode, and text food logging. | A meal camera alone is not differentiation. [Official site](https://www.calai.app/) |
| Fitbod | Personalized strength workouts incorporating goals, equipment, progression, and recovery. | Workout generation and beginner guidance are established expectations. [Official site](https://fitbod.me/) |
| MacroFactor Nutrition | Adaptive macro guidance and food logging, including photos. | Weekly nutrition adjustments already exist. [Official nutrition page](https://macrofactor.com/macrofactor/) |
| MacroFactor Workouts | Structured programs, training logs, rule-based progression, and connection with its nutrition app. | Neither rules-based coaching nor a nutrition/workout ecosystem is unique. [Official workouts page](https://macrofactor.com/workouts/) |

Steadfast's differentiation hypothesis is beginner execution: affordable familiar meals, manageable preparation, understandable exercise instruction, coordinated weekly decisions, and user-controlled continuity into human coaching. Demonstrate these benefits through task completion and longitudinal use. Curated content, tested policies, reliable history, and consented outcome learning can become advantages; their existence alone does not establish a competitive moat.

## Scope and repeated value

Build the macro, training, and review loop first internally. The complete requested MVP still includes curated meal planning. A bounded catalog must support checked portions, practical substitutions, and declared coverage; unrestricted recipe generation is deferred.

Weekly review supports `HOLD`, `SIMPLIFY`, `ADJUST`, `CLARIFY`, and `PAUSE_REFER`. A valuable review explains what is known, what remains uncertain, the decision, and one feasible next step. It need not change numbers. Test willingness to pay for ordinary hold weeks rather than demonstrations that constantly intensify the plan.

Minimal structured weekly observations are the baseline. Each approved adjustment method declares its evidence needs. Add optional daily nutritional summaries only if the chosen method needs them; a complete food tracker is deferred. Never claim measured intake or learned expenditure from meal checkoffs. Initial personalization requires the approved method's inputs or a reviewed alternative.

Before declaring the adaptive MVP complete, demonstrate a justified nutrition `ADJUST` sequence using inputs the shipped UI collects. Otherwise describe the release accurately as an initial-plan and weekly-support preview.

Defer photo logging, wearables, general health chat, supplements, competition preparation, retailer checkout, and new native UI implementation. Preserve shared backend contracts for native clients. Keep the human-coaching product usable, with explicit provider transitions and consent-bound history sharing.

## Pilot service and staffing

Begin with invited or sponsored access through server-owned AI entitlements. Existing code bills coaches through `CoachSubscription`; that is not an AI-client subscription. Paid client checkout is a later slice, **P01**, after feasibility learning and commercial terms are specified.

**L01 requires actual qualified reviewers and operating capacity.** Review policy/catalog versions before use. During the supervised pilot, every initial numerical plan and proposed intensifying change needs qualified approval before participant visibility. Approval binds to the exact payload and relevant revisions. Sample holds/protective cases and handle flagged cases under the defined policy. Implement the reviewer queue in **A11**; a generic `isCoach` flag does not grant review authority.

A possible feasibility cohort is 20–30 participants over eight weeks, subject to staffing. This is a planning example, not a statistically powered efficacy study. Set enrollment capacity from review workload:

`weekly review capacity = available reviewer minutes / measured minutes per case`

Reserve capacity for flagged cases, revisions, support, and absence coverage. Pause enrollment when queues exceed the service's declared response window. Distinguish app support, protocol review, and individual clinical care. If appropriate care is not staffed, use the approved outside-referral pathway; do not imply someone is monitoring the case or automatically share it with marketplace coaches.

Removing routine human review for broader self-service requires a separate evidence and release decision. It must not happen through an undocumented staffing cut.

## Measurement and stop conditions

| Question | Measure and denominator | Owner |
|---|---|---|
| Can beginners start? | Intake completion, plan acceptance, first useful action; report all invited and eligible starters separately. | Product lead |
| Is the plan usable? | Observed task success, comprehension, burden, and reasons for abandonment. | UX/research lead |
| Does review help? | Perceived feasibility, understanding of decisions, and completion of user-chosen actions among all enrolled and responding participants. | Product/evaluation leads |
| Is guidance appropriate? | Adjudicated unsafe output, inappropriate refusal, distress/recovery concerns, and policy violations per reviewed recommendation and participant. | Qualified policy reviewer |
| Can it operate? | Review delay, failed runs, support/review minutes, cost per participant-week, and cancellation friction. | Engineering/operations lead |

Report missing responses and loss to follow-up; do not turn missing logs into nonadherence. Track safety separately from retention and goal outcomes. Compare the agent experience with a strong static starter plan and ordinary reminders before claiming added benefit.

Pause affected automation for unauthorized disclosure, bypassed safety/reviewer gates, unsupported numerical recommendations, or a credible serious harm signal requiring investigation. Preserve approved safety responses and appropriate history access. Resume through the [release process](09-Validation-Release-Operations.md), with root-cause correction and relevant reevaluation. Prespecify other cohort thresholds before enrollment instead of choosing favorable cutoffs afterward.

## Economics and paid launch

Calculate actual service costs, including retries and human labor:

`net revenue = collections − refunds − remitted taxes − payment/store fees`

`variable contribution = net revenue − model/image costs − variable infrastructure/messaging − support labor − reviewer labor`

`reviewer cost = cases × mean minutes per case × loaded hourly rate / 60`

Illustration only: $20 net revenue with $2 technical costs, $3 support, and $4 review labor leaves $11 contribution, or 55%. If review labor becomes $8, contribution falls to $7, or 35%. These are invented sensitivity inputs, not recommended pricing or vendor quotes. Fixed engineering, content, legal, and acquisition costs remain additional.

The CEO owns pricing and enrollment budget; the qualified reviewer owns policy applicability; operations owns staffing and response windows; engineering owns entitlement enforcement and release controls. Before P01, specify SKU/channel, cancellation/refund terms, grace period, safety-pause behavior, and access after human transfer. Measure actual willingness to pay, cohort contribution, and acquisition payback. Keep health details outside marketing analytics and avoid urgency-based referrals, punitive streaks, and cancellation friction as growth tactics.
