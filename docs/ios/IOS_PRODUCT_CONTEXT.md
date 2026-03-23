# IOS_PRODUCT_CONTEXT.md
> Steadfast iOS — Product Context & Source of Truth
> Generated: 2026-03-22 | Derived from codebase, not guessed.

---

## What Steadfast Is

Steadfast is a B2B SaaS fitness coaching platform. Coaches run their practice on it; clients consume the service through it. There is no free consumer product — every client must be explicitly connected to a coach.

The web app is the operational backbone. The iOS app is a companion surface, primarily for **clients** (consuming plans, checking in, messaging) with potential for a **coach mobile lite** view in future phases.

---

## User Roles

### 1. Coach (`Role.COACH`)
- Creates and manages their practice
- Has a public marketplace profile (`CoachProfile`) with a unique slug
- Manages a client roster via `CoachClient` join table
- Creates/publishes meal plans and training programs per client per week
- Reviews client check-ins and sends feedback via messages
- Manages leads through a CRM pipeline (`CoachingRequest`)
- Configures intake questionnaires (`IntakeFormTemplate`)
- Uploads PDF documents for clients to sign (`CoachDocument`, `IntakePacket`)
- Has granular SMS/email notification preferences
- May be part of a `Team` with a team owner

### 2. Client (`Role.CLIENT`)
- Assigned to exactly one coach at a time (via `CoachClient`)
- Follows a weekly rhythm: view plans → submit check-in → receive coach feedback
- Submits weekly check-ins (weight, body fat%, diet score, energy score, photos, custom questions)
- Views their meal plan (read-only) and training program (read-only)
- Can message their coach (bi-directional, week-scoped)
- May log daily adherence (meal-by-meal tracking + workout completion)
- Has intake questionnaire flow (new pipeline: `IntakePacket`) or legacy (`OnboardingResponse`)
- Can browse and save coach profiles on the marketplace (`/coaches`)
- Can switch to Coach role if they apply (`isCoach` flag, `BecomeCoachForm`)

### 3. No Admin Role (confirmed)
No admin-specific role exists in the schema. `Role` enum only has `COACH` and `CLIENT`.

### 4. Team Members
Coaches can belong to a `Team`. `teamRole` is a free-form string — not an enum. Team features appear to be in `components/coach/TeamSection.tsx`.

---

## Role-Based Access Summary

| Area | Coach can | Client can |
|------|-----------|------------|
| Client roster | Read/write all | Read own data only |
| Meal plans | Create, edit, publish/draft | View published only |
| Training programs | Create, edit, publish/draft | View published only |
| Check-ins | Mark as reviewed | Submit, update, add photos |
| Messages | Send to client | Send to coach |
| Intake responses | Edit (via review page) | Submit via intake flow |
| Coach profile | Edit | View (public) |
| Leads pipeline | Full CRM | None |
| Adherence | Enable per-client | Log daily |
| Templates | Create/edit globally | None |
| Marketplace | Manage their listing | Browse/save coaches |

---

## Core Domain Objects

| Model | Purpose |
|-------|---------|
| `User` | Single user that can be coach, client, or both (`isCoach` / `isClient` flags + `activeRole`) |
| `CoachClient` | Many-to-many join, one record per coach-client pair. Holds `coachNotes`, schedule overrides, adherence flag |
| `CoachProfile` | Marketplace profile, one per coach: bio, pricing, slug, specialties, publish status |
| `CoachingRequest` | Lead/prospect record. Has `consultationStage` pipeline. Links to `IntakePacket` |
| `CheckIn` | Weekly client submission. `weekOf` + `clientId` is the primary key pattern. Statuses: `SUBMITTED` → `REVIEWED` |
| `MealPlan` | Client + `weekOf` scoped. Status: `DRAFT` → `PUBLISHED`. Only published plan is shown to client |
| `MealPlanItem` | Line items within a meal plan: food, meal name, macros, quantity |
| `MacroTarget` | Calorie/protein/carb/fat targets per client per week |
| `TrainingProgram` | Client + `weekOf` scoped. Status: `DRAFT` → `PUBLISHED`. Has `TrainingDay[]` and optional cardio |
| `TrainingTemplate` | Coach-owned reusable workout structure. Applied to create a `TrainingProgram` for a client |
| `Message` | Bi-directional coach ↔ client messages. Scoped to `weekOf` |
| `IntakePacket` | New intake pipeline: self-describing JSON `formAnswers`, optional `coachNotes`, linked via `CoachingRequest` |
| `IntakeFormTemplate` | Coach's custom intake form definition (`sections: Json`) |
| `ClientIntake` (legacy) | Legacy intake: fixed structured fields (bodyweight, height, age, goals, diet, etc.) |
| `OnboardingResponse` (legacy) | Client answers to legacy `OnboardingForm` |
| `MealPlanUpload` | PDF/image upload for AI-assisted meal plan import |
| `WorkoutImport` | PDF/image upload for AI-assisted training plan import |
| `CoachDocument` | Coach-created or uploaded form documents (type: `TEXT` or `FILE`) |
| `DailyAdherence` | Day-level meal eat/skip log + workout completion flag |
| `Testimonial` | Client review of coach (1–5 stars, optional text, optional photos) |
| `ExerciseResult` | Client-logged exercise performance data |

---

## Week-Scoped Data Model

**Critical iOS architectural constraint.** Most data is keyed by `clientId + weekOf`:
- `CheckIn.weekOf` — ISO date of the Monday (or period start) of the current check-in window
- `MealPlan.weekOf` — same pattern
- `TrainingProgram.weekOf` — same pattern
- `Message.weekOf` — same pattern
- `MacroTarget.weekOf` — same pattern

The current "week" is derived from the **client's timezone** + **coach's cadence schedule** (not a fixed calendar week). A client's check-in schedule is defined by `CadenceConfig` (custom weekly/biweekly/monthly cadence with specific days). The effective cadence is: `CoachClient.cadenceConfig || CoachProfile.cadenceConfig || User.checkInDaysOfWeek`.

The check-in status is computed dynamically:
- `due` — cadence day has arrived, no submission yet this period
- `overdue` — past due by more than 0 days with no submission
- `submitted` — submitted this period, not yet reviewed
- `reviewed` — coach has marked this period reviewed
- `upcoming` — next due date is in the future

---

## Draft / Published Workflow (Plans)

Both `MealPlan` and `TrainingProgram` follow a draft/publish workflow:
- Coach creates content in `DRAFT` status → saves iteratively
- Coach explicitly clicks "Publish" → status becomes `PUBLISHED`, `publishedAt` is set
- Client **only sees** the current `PUBLISHED` plan for their week
- There can be multiple draft versions, but only one published per `clientId + weekOf`

**iOS implication:** Never show draft plans to clients. Never assume a plan exists — empty state is common for new clients.

---

## Main Client Flows

1. **Onboarding / First access**
   - New client (from marketplace or invite) lands at `/client`
   - If intake pending: banner prompts them to `/client/intake`
   - Intake is paginated sections of custom coach questions
   - After intake: dashboard is fully available

2. **Weekly rhythm**
   - View meal plan at `/client/meal-plan`
   - View training program at `/client/training`
   - Log today's adherence (optional, if enabled by coach)
   - Submit weekly check-in at `/client/check-in`
   - Receive notification when coach publishes new plan
   - Receive notification when coach reviews check-in
   - View messages at `/client/messages/[weekOf]`

3. **Profile & settings**
   - `/client/profile` — bio, fitness goals
   - `/client/settings` — notifications, timezone, SMS opt-in

---

## Main Coach Flows

1. **Lead management** (`/coach/leads`)
   - Leads arrive from marketplace (`CoachingRequest`) or added manually
   - Pipeline stages: `PENDING → CONTACTED → CALL_SCHEDULED → ACCEPTED / DECLINED`
   - Can schedule consultation, send intake, send documents
   - Accepting a lead creates `CoachClient` and optionally sends client sign-up invite

2. **Client management** (`/coach/clients/[clientId]`)
   - View client snapshot: weight, check-in history, intake summary, messages
   - Edit/publish meal plan and training program
   - Review submitted check-ins
   - Send messages / coach feedback

3. **Templates** (`/coach/templates`)
   - Create meal plan snippets (`PlanSnippet`)
   - Create training templates (`TrainingTemplate`)
   - Create reusable onboarding forms (`OnboardingForm`)
   - Create check-in templates (`CheckInTemplate`)

4. **Marketplace profile** (`/coach/marketplace/profile`)
   - Edit `CoachProfile`: bio, pricing, specialties, photos, portfolio items
   - Manage testimonials (flag/hide)
   - Publish/unpublish profile

5. **Settings** (`/coach/settings`)
   - Check-in form default customization
   - Schedule/cadence configuration
   - Email/SMS notification preferences
   - Team management

---

## Shared Product Rules

1. **Week-first data model.** Data lives at `clientId + weekOf`. The client's timezone determines their "today".
2. **Coach is always the authority.** Backend validates coach identity on every mutation affecting client data.
3. **Published plans are immutable to clients.** Clients view only, never edit plans.
4. **Check-ins flow one-way.** Client submits → Coach reviews. No back-and-forth editing.
5. **Messages are per-week.** Each message references a `weekOf`. Conversation history is paginated by week.
6. **One coach per client.** `CoachClient` is unique on `[coachId, clientId]`. A client can only have one active coach.
7. **Roles are additive.** A user can be both a coach and a client (`isCoach` + `isClient` both true). They switch via "Switch to Coach"/"Switch to Client" toggle.
8. **Notifications are SMS + Email.** Both channels have per-type opt-in flags. No push notifications (yet — iOS will need a firebase/APNs integration).
9. **Intake is optional.** Clients can be active without completing intake. Coaches can fill manual intake notes on the client detail page.
10. **Adherence is coach-enabled per client.** `CoachClient.adherenceEnabled` must be `true` before the client can log daily adherence.

---

## Important Terminology

| Term | Meaning |
|------|---------|
| Check-In | Weekly client submission with metrics (weight, compliance, energy, photos, notes) |
| Meal Plan | Structured weekly nutrition plan created by coach. Contains meals with food items and macros |
| Training Program | Weekly training plan. Has Training Days with Exercises and Blocks |
| Training Template | Reusable training structure (coach-owned, not client-specific) |
| Intake | Client questionnaire collecting baseline stats and goals. Two pipelines: new (`IntakePacket`) and legacy |
| Lead | A prospect in the coach's CRM pipeline (`CoachingRequest`) |
| Plan Extras | JSON blob on `MealPlan` containing rules, cardio, hydration, supplements — shown as "coach rules" to client |
| Cadence | The check-in schedule. Can be weekly (specific days), biweekly, monthly |
| Adherence | Daily meal compliance logging (did you eat each meal yes/no) + workout completed |
| Review | Coach viewing and marking a check-in as `REVIEWED` |
| Publish | Making a meal plan or training program visible to the client |
| Draft | Plan in progress, not visible to client |
| Snippet | A reusable partial meal plan the coach can quickly apply |
| Slug | The URL-safe identifier in the coach's public profile URL (`/coaches/slug`) |

---

## Backend as Security Boundary

- All data mutations happen via Next.js Server Actions (not REST calls from client)
- Coach identity verified server-side on every mutation via `verifyCoachAccessToClient()`
- Client gets their own data via `getCurrentDbUser()` — never receives another client's data
- **iOS will need its own API layer.** Server Actions are not callable from native clients
- Clerk handles auth (`clerkId` on User). iOS must use Clerk's native SDK for auth tokens

---

## Must Preserve in iOS

1. Week-scoped data model and cadence-aware "current week" logic
2. Coach-as-authoritative-entity pattern (never allow client to mutate plan data)
3. SUBMITTED → REVIEWED check-in state machine (one direction)
4. DRAFT → PUBLISHED meal plan state machine (coach-only transition)
5. Single coach per client constraint
6. Role switching (coach users who also have a client dashboard)
7. Adherence as opt-in per client (check `adherenceEnabled` before rendering adherence UI)
8. Exact terminology used throughout the app (see table above)

---

## Needs Confirmation

- [ ] Will iOS target coaches, clients, or both?
- [ ] Is there a billing/subscription model? (Not found in schema — no `Subscription`, `Plan`, or `Stripe` model)
- [ ] Push notification strategy for iOS (no APNs integration found in web codebase)
- [ ] Deeplink scheme for check-in reminders, plan updates
- [ ] Offline/cache strategy for meal plan and training program viewing
- [ ] Will iOS support the full coach experience or just a read-only coach lite view?
- [ ] Team features priority for iOS
- [ ] Document signing flow (PDF upload + signature) — fully web-based currently
