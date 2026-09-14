# Client Dashboard Page Overrides

> **PROJECT:** Steadfast
> **Scope:** `/client` (`app/client/page.tsx`)
> **Corrected:** 2026-09-13 — this file previously described a B2B corporate marketing homepage
> ("Solutions by Industry", "Client Logos", "Contact Sales", navy/grey corporate palette). That
> is not this app. Replaced with the actual client dashboard below.

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/steadfast/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## What this page actually is

A single-column, mobile-first "today" screen for a signed-in client. It is mode-aware:

- **No coach assigned:** focused empty state — "Find Your Coach" CTA, prior check-in history if
  any, optional "Become a Coach" prompt. No dashboard chrome.
- **Coach assigned:** masthead, pending-intake banner (if applicable), a primary status card
  (on-track / due / overdue + streak), "Today's Plan" nutrition + training cards with progress
  bars, an optional cardio-prescription strip, coach guidance/support text, a weight-progress
  chart, today's adherence checklist, recent check-ins (collapsible), and the latest coach
  message/check-in preview.

This is the same route the AI Coach product's `ClientCoachingContext` will need to render for
`mode: "AI"` and `mode: "NONE"` clients (see `docs/ai-coach/07-UX-and-Human-Factors.md`) — the
mode-aware pattern already used for the no-coach state extends naturally; it does not need a
separate route.

## Page-Specific Rules

### Layout

- **Max width:** none imposed here beyond the shared app shell — single column, stacked sections,
  mobile-first (this screen is designed at 375px width first, per Master).
- **Sections in order:** masthead → pending-action banner → primary status card → today's
  plan cards → cardio strip → guidance/support → weight chart → today's adherence →
  recent check-ins → latest message → secondary CTAs (e.g. become-a-coach).

### Visual language

- Glass/surface cards (`sf-glass-card`, `sf-surface-card`), rounded-2xl, low-opacity white
  borders (`border-white/[0.08]`), staggered `animate-fade-in` entrance per section
  (40–200ms delays) — reuse these existing utility classes rather than introducing new card
  styles for new sections (including future AI Coach sections on this same route).
- Status colors: emerald for on-track/nutrition, blue for training, green for cardio, amber for
  an unfavorable weight-trend badge — keep new status-like elements within this existing palette
  rather than introducing new semantic colors.

### Component rules

- Every actionable card is a `<Link>` with `focus-visible:ring` and a minimum touch target per
  Master (48px generally, 56px for the single primary CTA in the no-coach state).
- Numeric displays (weight, adherence) use `tabular-nums` for stable layout on update.
- Do not add corporate marketing sections (client logos, contact-sales, solutions-by-industry) —
  this is a returning-user utility screen, not an acquisition page.

## AI Coach considerations

When `ClientCoachingContext.mode === "AI"`, this route must show an explicit AI-provider label
(never a fabricated human coach), and the "next action" card must resolve to whichever of
finish-intake / review-proposal / use-today's-plan / check-in / resolve-restriction applies —
see `docs/ai-coach/07-UX-and-Human-Factors.md` §Navigation and screens. Do not duplicate this
dashboard as a separate AI-only page.
