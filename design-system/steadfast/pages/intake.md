# Intake Page Overrides

> **PROJECT:** Steadfast
> **Scope:** `/client/intake`, `/client/intake/[requestId]` (client-side coach-intake form),
> `app/onboarding/intake/[token]` (pre-signup intake packet)
> **Corrected:** 2026-09-13 — this file previously contained unrelated auto-generated
> marketing/lead-magnet copy (hero + ebook preview + CTA form). It described no page that
> exists in this app. Replaced with the actual intake flow below.

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/steadfast/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## What this page actually is

A single-column, coach-authored questionnaire (`ClientIntakeFormView`) that a client fills in
either before or shortly after being linked to a coach. Sections and questions are defined per
coach template (`getOrCreateDefaultTemplate`); answers are a shared draft (`ClientFormSubmission`)
that both the client and their coach can see. This is a data-collection utility screen, not a
marketing or acquisition page — there is no hero, no lead magnet, and no CTA copy to write.

## Page-Specific Rules

### Layout

- **Max width:** 672px (`max-w-2xl`), centered, single column — matches the existing page shell.
- **Sections:** rendered from the coach's template in order; no fixed hero/preview/CTA structure.
- Each section header, then its fields, in document order. No skippable "typing indicator" or
  chat-style animation — this is a form, not a conversation.

### Component rules

- Every field needs a real `<label for>` (or wrapping label) — no placeholder-only inputs.
- Back / Save-and-resume: the existing draft (`existingAnswers`) must repopulate on return;
  do not silently clear a partially completed form.
- Submit shows a loading state, then a clear success or field-level error state — never a blank
  refresh on failure.
- Follow Master's 48px minimum tap target and `font-size: max(1rem, 16px)` input rule.

### What to avoid

- Do not add a forced linear/unskippable multi-step tour where the underlying data model allows
  saving answers out of order.
- Do not add lead-generation elements (ebook previews, "Solutions by X" sections, contact-sales
  CTAs) — this screen has no acquisition purpose.

## AI Coach intake (separate page)

The AI Coach product's own intake at `/client/ai-coach/intake` is a **different** route with its
own required behavior (safety-first ordering, "Unsure" as a first-class answer, immediate
safety-disclosure processing). Do not reuse this file for it — see
`design-system/steadfast/pages/ai-coach.md` and `docs/ai-coach/07-UX-and-Human-Factors.md`.
