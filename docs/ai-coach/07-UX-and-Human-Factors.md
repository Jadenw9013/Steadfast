# UX and human factors implementation specification

Status: proposed product behavior from simulated frontend, design, human factors and beginner reviews. Source inspection occurred; rendered accessibility checks and real user testing have not. Contract names follow [05-API-and-State-Contracts.md](05-API-and-State-Contracts.md); clinical decisions follow [06-Coaching-Policy-and-AI.md](06-Coaching-Policy-and-AI.md).

## Experience principles

The client should understand what to do today, why the plan fits their life, and what the weekly review decided. Use structured tasks and understandable explanations. A chatbot is not the primary navigation. “Keep this plan” is a useful outcome when it is justified.

Honor the current permanent dark design, custom components, 48px minimum targets, 56px primary mobile actions and 16px input text. F00 first repairs contradictory design instructions: current intake/dashboard overrides describe unrelated marketing pages, and older role docs conflict with these rules. Add `design-system/steadfast/pages/ai-coach.md` for the behavior below. Scope the old “hide macros” rule to the existing human meal view; the requested AI macro mode must show its targets. This does not require a broad visual redesign.

## Navigation and screens

The following are proposed web routes unless marked existing. Keep existing human deep links working. `ClientCoachingContext` selects the experience; AI clients remain clients, with an explicit AI provider label. No fabricated human account or misleading live-coach presence.

| Route | Main task and fields | Actions and required states |
|---|---|---|
| `/client` — existing | Mode-aware home: next action, accepted plan shortcut, next review, recent review. NONE offers AI or human coaching; HUMAN preserves existing workflow. | One primary action: finish intake, review proposal, use today's plan, check in, or resolve a restriction. Handle unresolved provider assignment explicitly. |
| `/client/ai-coach/start` | Explain supported service, invited access and data use; eligibility entry. | Start or exit. Explain unsupported scope before collecting unnecessary details. Do not imply continuous monitoring. |
| `/client/ai-coach/intake` | Eligibility/safety first; goal, required baseline inputs, units, practical food/training constraints, tracking preference; review answers. | Back, save/resume, edit and confirm. Required safety answers include “Unsure”; omission is not a negative answer. Missing calculation inputs leave personalized nutrition pending or use an approved alternative. |
| `/client/ai-coach/progress` | Real `QUEUED`, `RUNNING`, `RETRY_WAIT` state and saved confirmation; reviewer status when applicable. | Leave and return; retry only where allowed. No invented progress percentages. During pilot review show status without unapproved numerical proposals. FAILED offers a clear next action; CANCELED explains whether context changed. |
| `/client/plan` — existing | `ClientPlanViewV1`: Nutrition and Training, provider, current availability. Nutrition uses MACROS or MEALS over one underlying target. Training includes strength and cardio independently of meals. | Open instructions, use validated swaps, change representation, view history. Distinguish no plan, preparing plan and paused domain. Never select an AI plan by latest timestamp. |
| `/client/ai-coach/proposals/[planVersionId]` | Initial or changed plan, practical weekly burden, key assumptions, old→new differences and reason. | Accept, decline or edit practical preferences. Surface only reviewer-approved proposals where approval is required. Stale acceptance explains that the proposal needs updating; user acceptance cannot override safety restrictions. |
| `/client/check-in` — existing | HUMAN keeps coach-compatible flow; AI receives structured weekly wellbeing, recovery, plan-following, barriers and relevant observations. | Save/resume, “Not measured,” review and submit. Optional photos are not part of the AI MVP requirement. Submitting twice uses the same idempotent operation. |
| `/client/ai-coach/reviews/[runId]` | `HOLD`, `SIMPLIFY`, `ADJUST`, `CLARIFY` or `PAUSE_REFER`; evidence used, uncertainty and next action. | HOLD needs no acceptance. Material SIMPLIFY/ADJUST links to a proposal. CLARIFY asks consequential questions. PAUSE_REFER explains current domain availability and approved support guidance. |
| `/client/ai-coach/sessions/[sessionId]` | Accepted program session, structured exercise instructions, sets/reps/rest, units, effort and pain/concern reporting. | Save sets, report partial/not done, finish. Bodyweight work needs no invented positive external load. Failed writes retain inputs and show retry. |
| `/client/ai-coach/settings` | Food/schedule preferences, numerical visibility, reminders, display timezone, pause/resume and provider transition. | Explain changes before confirmation. Pilot review timezone is fixed; changing travel/display timezone cannot reset the review window. Switching to human coaching requires a clear responsibility transition and separate history-sharing choice. |

Continue using `/client/profile` for account settings. Retain human Messages where authorized; AI reviews must not masquerade as human messages. Do not add more than five mobile navigation destinations: Home, Plan, Check-in, Reviews, Profile for AI mode is the proposed mapping, with settings reached through Profile. A review-list landing view can live at `/client/ai-coach/reviews`; it uses the same run-result records.

## Intake and minimum logging

Collect allergies separately from dislikes/intolerances; an empty free-text restriction field does not establish safety. Ask cooking/storage access, budget, food familiarity, available session time, equipment and training experience because these change plan feasibility. Explain why sensitive inputs are needed. Do not infer a physiological calculation input from gender identity. Save authenticated drafts server-side; label “Saved” only after acknowledgment. Do not silently persist health answers in browser local storage.

The weekly UI must support the evidence used by the shipped controller:

| Observation | Minimal input | Allowed interpretation |
|---|---|---|
| Plan following | Clear self-report of frequency, exceptions and how complete the report is | Feasibility/adherence evidence of stated quality; never measured intake or calculated expenditure |
| Recovery/context | Energy, tolerated effort, sleep/recovery concerns, changed circumstances | Context for reviewed hold, simplification or safety rules; not a compliance score |
| Weight trend, where relevant | Optional dated measurement with units and comparable-condition context | Only policy-qualified trends support a change; missing data stays unknown |
| Strength session | Stable exercise/session IDs, sets/reps, external-load or bodyweight semantics, units, reported effort and concerns | Comparable performance and tolerance; no inferred technique assessment |
| Cardio | Planned session status and reported duration/effort where required | Observed completion/context; no automatic calorie compensation |

A full food diary is deferred. Users already tracking can provide optional summaries; do not secretly require an unbuilt tracker. Approved policy determines when trends, plan-following reports and recovery suffice for bounded energy changes. Inadequate evidence leads to HOLD, CLARIFY or practical simplification. A complete MVP must demonstrate an eligible nutrition adjustment using inputs available in this interface.

Use distinct `NOT_REPORTED`, `REPORTED_COMPLETE`, `REPORTED_PARTIAL`, `REPORTED_NOT_DONE` and `NOT_SCHEDULED` observations as defined by the contracts. Rest days and missing logs must not become failure scores. Weight/photos are not universal daily obligations.

## Plan use, changes and safety

Meal mode prioritizes practical foods/portions; macro mode explains targets and permitted tolerance. Switching representation retains the same prescription. A validated target-preserving swap can be lightweight and audited; material prescription changes, including simplifications, require proposal acceptance and the shared routine-change allowance. Protective action is assigned by policy, never by UI convenience.

Provide the meal week's grocery quantities inside Nutrition, distinguishing purchase quantities from consumed portions. Weekly review shows the actual observation dates; those dates are distinct from the current window in which a proposed change can activate.

Show active and proposed plans distinctly. Explain “what changed, why, and what to do next” without exposing model prompts or internal version jargon. Preserve accepted history with dates and a readable reason.

Technical failure can leave an eligible last accepted plan usable. New safety information can pause nutrition, strength or cardio immediately. Render current `ALLOW`, `HOLD_ONLY` or `PAUSED` permissions; historical instructions must not look like today's recommendation after restriction. Show approved urgent guidance promptly without suggesting staff are watching continuously. A pilot reviewer queue is real infrastructure; only promise the service actually staffed.

## Copy and accessibility acceptance

Prefer “We are keeping your current targets because this week's information does not justify a change” over automatic promises of weekly adjustment. Prefer “What made the plan difficult?” over “Why were you noncompliant?” Do not praise weight decrease by default, label foods morally, prescribe compensatory activity or punish missed logging. Offer numerical-visibility preferences; hiding numbers is not treatment for eating concerns.

F07 repairs existing misleading adherence/streak labels, invisible check-in overwrite confirmation, silent failed checkoffs and bodyweight logging. Reuse `NavBar`, `MobileBottomNav`, shared input/card styles and human renderers through explicit adapters. AI exercises must not use `TrainingProgram`'s legacy free-text set parser; build the structured renderer. See [03-Codebase-Audit.md](03-Codebase-Audit.md) for verified evidence.

Before completion, verify:

- Associated visible labels, announced errors/success, keyboard focus and complete tab semantics; charts have readable text equivalents.
- Targets meet project sizing; 200% zoom, narrow screens and soft keyboards do not hide fields or actions; reduced-motion preferences work.
- Reload/navigation preserves server-confirmed drafts and durable job status. Transient/offline failure preserves current inputs but never falsely claims durability.
- Accepted/proposed/stale/declined/restricted states remain understandable; missing measurements and skipped optional fields do not block unrelated tasks.
- Macro-only clients without human assignments see nutrition, strength and cardio; no meal-plan dependency hides activity.
- A real beginner can explain today's task, a HOLD decision and an accepted change. Moderated tasks and evidence requirements are in [09-Validation-Release-Operations.md](09-Validation-Release-Operations.md). These criteria are specified, not claimed passing.
