# AI Coach Page Overrides

> **PROJECT:** Steadfast
> **Scope:** `/client/ai-coach/*` routes (`start`, `intake`, `progress`, `proposals/[id]`,
> `reviews`, `reviews/[runId]`, `sessions/[sessionId]`, `settings`), plus the AI-mode states of
> the existing `/client`, `/client/plan` and `/client/check-in` routes.
> **Normative source:** `docs/ai-coach/07-UX-and-Human-Factors.md`. This file adapts that spec
> to house design-system conventions; if the two ever disagree, `07-UX-and-Human-Factors.md`
> in `docs/ai-coach/` wins and this file should be corrected to match it.

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/steadfast/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Relationship to the existing "hide macros" rule

As of T-802a, the existing human-coaching client meal view (`SimpleMealPlan`) shows a daily
totals card (calories + protein/carbs/fats) in **both** plan modes — it no longer hides macros.
It still hides version numbers and draft/published status from clients, and that narrower rule
remains scoped to the human meal view only. AI macro mode (`/client/plan` when
`ClientCoachingContext.mode === "AI"` and nutrition presentation is `MACROS`) must show its
numeric targets and permitted ranges — hiding them contradicts PR-03. Do not extend the
version-number/draft-status hiding rule to AI-mode screens.

## Shared rules across all `/client/ai-coach/*` routes

- Inherit Master's permanent dark mode, 48px minimum tap targets (56px for the page's single
  primary action), and `font-size: max(1rem, 16px)` inputs. No new visual system.
- A chatbot/conversational UI is **not** the primary navigation anywhere in this scope. Use
  structured screens with one clear primary action per screen.
- Reuse existing shared components through adapters rather than parallel implementations:
  `NavBar`, `MobileBottomNav`, shared input/card styles, and — for plan/history rendering — the
  same visual card language already used on `/client` (`sf-glass-card`, `sf-surface-card`,
  staggered fade-in). Do not invent a second visual language for AI-mode screens.
- No invented progress percentages on any pending/running state. No emojis. No moral food
  labels, streak-shaming, or "earning food" framing anywhere in this scope — see
  `docs/ai-coach/06-Coaching-Policy-and-AI.md` §7.
- Never present the AI as a human coach. Every AI-mode screen carries an explicit AI-provider
  label (reuse the existing masthead "Coach" badge pattern on `/client`, but do not reuse its
  exact copy — it must not imply a human).
- Mobile navigation for AI-mode clients: at most five destinations — Home, Plan, Check-in,
  Reviews, Profile (Settings reached through Profile) — do not add a sixth.

## Route-specific notes

| Route | Primary action | Card/section pattern to reuse |
|---|---|---|
| `/client/ai-coach/start` | Start or exit | Empty-state card pattern from `/client`'s no-coach state (icon + heading + one CTA, `sf-button-primary`, 48px min-height) |
| `/client/ai-coach/intake` | Confirm current section | Single-column form shell from `design-system/steadfast/pages/intake.md`; safety questions must offer "Unsure" as a real option, not just be skippable |
| `/client/ai-coach/progress` | None (status only) while `QUEUED`/`RUNNING`/`RETRY_WAIT`; a clear next action on `FAILED`/`CANCELED` | Status-card pattern from `/client` (`StatusCard`), relabeled for run status, not adherence |
| `/client/plan` (AI mode) | Open today's instructions | "Today's Plan" nutrition/training card pair from `/client`, extended with a domain-availability badge (`ALLOW`/`HOLD_ONLY`/`PAUSED`) |
| `/client/ai-coach/proposals/[planVersionId]` | Accept or decline | New pattern: old→new diff list, one accept/decline action pair, both ≥48px, decline never pre-selected |
| `/client/check-in` (AI mode) | Save/submit | Existing check-in form shell; replace coach-relationship-bound fields with the structured AI observation set (`NOT_REPORTED` etc. — see contracts doc 05) |
| `/client/ai-coach/reviews`, `reviews/[runId]` | Open a review / none for HOLD | List reuses `RecentCheckIns`-style collapsible row pattern; detail view states the decision, evidence used, and uncertainty in that order |
| `/client/ai-coach/sessions/[sessionId]` | Save a set / mark done | New structured exercise renderer — must not reuse `TrainingProgram`'s legacy free-text set parser (see `docs/ai-coach/03-Codebase-Audit.md` CB07 and `docs/ai-coach/07-UX-and-Human-Factors.md`) |
| `/client/ai-coach/settings` | Confirm a change | Standard settings-row pattern; timezone/pause/transition changes require an explicit confirm step before submit |

## Copy rules (binding, not just suggestions)

Use policy-safe phrasing per `docs/ai-coach/07-UX-and-Human-Factors.md` §Copy and accessibility
acceptance, e.g. prefer "We are keeping your current targets because this week's information
does not justify a change" over any automatic-adjustment promise, and "What made the plan
difficult?" over "Why were you noncompliant?". Do not praise weight decrease by default or
prescribe compensatory activity in copy.
