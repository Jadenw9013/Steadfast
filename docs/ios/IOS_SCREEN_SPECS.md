# IOS_SCREEN_SPECS.md
> Steadfast iOS — Screen-by-Screen Specifications
> Derived from web routes and components. Grounded in codebase.

---

## Route Map Summary

### Client Routes → iOS Screens

| Web route | iOS screen name | Notes |
|-----------|----------------|-------|
| `/client` | ClientHome | Main dashboard, week status |
| `/client/check-in` | CheckInForm | Submit weekly check-in |
| `/client/check-ins` | CheckInHistory | List of all submitted check-ins |
| `/client/check-ins/[id]` | CheckInDetail | View single check-in + coach review |
| `/client/meal-plan` | MealPlan | View current published plan |
| `/client/training` | TrainingProgram | View current published training |
| `/client/messages/[weekOf]` | Messages | Coach ↔ client messaging, per week |
| `/client/intake` | IntakeForm | Multi-section intake questionnaire |
| `/client/profile` | ClientProfile | Bio, goals, photo |
| `/client/settings` | ClientSettings | Notifications, timezone, SMS |
| `/client/coach/[slug]` | CoachPublicProfile | Client's coach public page |
| `/client/saved-coaches` | SavedCoaches | Coaches client bookmarked |
| `/coaches` | CoachBrowse | Public marketplace discovery |
| `/coaches/[slug]` | CoachProfile | Public coach profile |

### Coach Routes → iOS Screens

| Web route | iOS screen name | Notes |
|-----------|----------------|-------|
| `/coach/dashboard` | CoachDashboard | Overview, client summary |
| `/coach/clients/[id]` | ClientDetail | Full client profile + data |
| `/coach/clients/[id]/check-ins/[id]` | CheckInReview | Review a single check-in |
| `/coach/leads` | LeadsPipeline | CRM pipeline of prospects |
| `/coach/marketplace/profile` | CoachProfileEditor | Edit marketplace listing |
| `/coach/templates` | Templates | Meal/training/check-in templates |
| `/coach/settings` | CoachSettings | Full settings |

---

## SCREEN 1: Client Home (`/client`)

**iOS name:** `ClientHomeView`
**Role:** Client
**Purpose:** The primary weekly status screen. Surfaces what the client needs to do and see.

**Primary CTA:** Submit Check-In (prominent blue pill or card)
**Secondary actions:** Navigate to meal plan, training program, messages, coach profile

**Sections (in order):**
1. **Header** — `Hey [firstName]` + today's date + cadence preview chip (e.g. "Every Monday")
2. **Coach badge** (top right) — avatar + "coached by [name]" pill, tappable if coach profile is published
3. **Team banner** (conditional) — if client is in a team
4. **Intake required banner** (conditional) — urgent blue CTA if intake is PENDING or IN_PROGRESS
5. **Testimonial prompt** (conditional) — if client is eligible to leave a review
6. **Check-in overdue banner** (conditional) — red alert if overdue, highest priority
7. **Check-in status card** (non-overdue) — shows due / submitted / reviewed status
8. **Your Program** — 2-card grid: Meal Plan card + Training card (or empty states)
9. **Cardio prescription strip** (conditional) — green card with cardio chips
10. **Coach Rules card** (conditional) — coach-defined rules from plan extras
11. **Today Adherence** (conditional) — meal compliance + workout checkbox
12. **Coach Feedback / Messages preview** (conditional) — truncated latest message → taps to full messages
13. **Become a Coach** promo (conditional, non-coaches only)

**Required data:**
- `User`: firstName, timezone
- `CoachClient` → coach info: name, photo, profile slug
- `CheckIn[]` (light): submittedAt, status
- Cadence config (computed from coach + client override)
- `MealPlan` (published)
- `TrainingProgram` (published, with days)
- Latest `Message` from coach
- `ClientIntake`: PENDING/IN_PROGRESS status
- Adherence: enabled flag, today's entry, today's meal names

**States:**
- **Loading:** Skeleton cards for each section
- **No coach:** Show "Connect a Coach" banner + "Browse Coaches" CTA; hide check-in and plan sections
- **No plans:** Show dashed empty state cards in the grid
- **Overdue check-in:** Overdue banner replaces normal status card (highest priority)
- **Fully set up:** All sections rendered per data

**Must match web:**
- Cadence status derivation (due / overdue / submitted / reviewed / upcoming) — complex scheduling logic, must be server-computed
- Section render order — priority order is intentional (overdue most urgent)
- Coach badge inline in header (not a separate screen section)

**Native iOS adaptations allowed:**
- Animate sections in with stagger via `.animation(.easeInOut.delay(i * 0.05))`
- `ScrollView` instead of web document scroll
- Check-in CTA as a sticky bottom area when `status === "due"` or `"overdue"` (most important action)

---

## SCREEN 2: Check-In Form (`/client/check-in`)

**iOS name:** `CheckInFormView`
**Role:** Client
**Purpose:** Submit or update a weekly check-in

**Primary CTA:** Submit Check-In
**Secondary:** Save draft (not currently supported — submission is direct), Back

**Sections (form fields in order):**
1. Weight (Float, optional)
2. Body fat % (Float, optional)
3. Diet compliance (1–10 scale)
4. Energy level (1–10 scale)
5. Notes (Text, optional, multiline)
6. Photo upload (up to N photos — `CheckInPhoto[]`)
7. Custom questions (from `CheckIn.templateSnapshot` — JSON array of coach-defined questions)

**Required data:**
- Current user ID
- Active check-in template (coach's `CheckInTemplate`, defaulted)
- Existing check-in for this period (if updating)

**States:**
- **Loading:** Spinner while fetching current period data
- **Already submitted (SUBMITTED):** Pre-fill fields; show "Update" option
- **Already reviewed (REVIEWED):** Read-only; show "Check-in has been reviewed" notice
- **Submission success:** Confirmation animation → navigate back to home

**Must match web:**
- Same field order and types
- Weight/body fat precision (Float)
- Diet + energy as integer 1–10 (not float)
- Photo upload must use Supabase storage (needs API endpoint)
- Custom questions rendered from `templateSnapshot` JSON

**Native iOS:**
- Use `Form` or custom `ScrollView` with sections
- Photo picker: `PhotosUI.PhotosPicker` for selecting existing photos; `AVFoundation` for camera
- Scale inputs (1–10): Step slider or segmented control (9 values)

---

## SCREEN 3: Meal Plan (`/client/meal-plan`)

**iOS name:** `MealPlanView`
**Role:** Client
**Purpose:** Read-only view of current published meal plan

**Primary CTA:** None (read-only)
**Secondary:** Export PDF (web has this — `ExportPdfButton`)

**Sections:**
1. Page header: week label + macro totals bar (calories, protein, carbs, fat)
2. Meals list: grouped by meal name (`mealName`), items within each meal with: food name, quantity + unit, macros
3. Coach rules / extras (if present in `planExtras`)
4. Cardio prescription (if present in `planExtras`)
5. Adherence toggles per meal (if `adherenceEnabled`) — mark each meal as eaten/skipped

**Required data:**
- `MealPlan` (published, current): id, items, planExtras
- `MacroTarget`: calories, protein, carbs, fats
- `DailyAdherence` (today, if adherence enabled)

**States:**
- **No plan:** Dashed empty card — "Your coach hasn't published a plan yet"
- **Loading:** Section skeletons
- **Adherence enabled:** Toggle per meal; workout complete checkbox at bottom

**Must match web:**
- Only published (`status === "PUBLISHED"`) plan shown
- Grouped by `mealName` (not flat list)
- Macros per item displayed

**Native iOS:**
- `List` with section grouping or custom `ScrollView`
- Macro bar: `HStack` with colored segments (protein=blue, carbs=amber, fats= emerald, calories=white)
- Adherence toggles: `Toggle` style controls

---

## SCREEN 4: Training Program (`/client/training`)

**iOS name:** `TrainingProgramView`
**Role:** Client
**Purpose:** Read-only view of current published training program

**Sections:**
1. Page header: week label + optional client notes
2. Day tabs or vertical sections: each `TrainingDay` with `dayName`
3. Per day: exercise list — name, sets × reps, intensity note, sets note
4. Blocks (special): ACTIVATION, INSTRUCTION, SUPERSET, CARDIO, OPTIONAL block types with different rendering
5. Cardio prescription strip (if `TrainingProgramCardio` present)
6. Optional: Exercise result logging (weight/reps logged by client)

**Required data:**
- `TrainingProgram` (published, current): id, days → exercises + blocks + cardio
- `ExerciseResult[]` (existing logged results for this program)

**States:**
- **No program:** Same dashed empty state
- **`__CARDIO__` day:** Special sentinel day name for cardio-only prescription — render as strip, not a regular day

**Native iOS:**
- Day navigation: horizontal scroll tab strip or `TabView(.page)` style
- Exercise rows: compact cells — name bold, sets/reps/intensity smaller text
- Block types need distinct visual treatment (SUPERSET = grouped, INSTRUCTION = info box, ACTIVATION = colored intro)

---

## SCREEN 5: Messages (`/client/messages/[weekOf]`)

**iOS name:** `MessagesView`
**Role:** Client (and Coach from their side)
**Purpose:** Coach–client bi-directional messaging, scoped to a week

**Primary CTA:** Send message
**Secondary:** Navigate to previous/next week messages, back

**Sections:**
1. Week selector / navigation (prev/next)
2. Message thread: alternating coach vs. client bubbles
3. Compose input at bottom

**Required data:**
- `Message[]` for this clientId + weekOf
- Current user ID (to distinguish coach vs. client bubbles)

**States:**
- **No messages this week:** Muted "No messages this week" empty state
- **Loading:** Skeleton bubbles
- **Sending:** Optimistic local addition, then confirmed

**Must match web:**
- Messages are week-scoped — no single infinite thread
- Week navigation must be available
- Coach's messages vs. client's messages visually distinguished

**Native iOS:**
- `ScrollView` with messages reversed (latest at bottom)
- `TextField` or `TextEditor` at bottom pinned with `safeAreaInset(edge: .bottom)`
- Keyboard avoidance handled automatically

---

## SCREEN 6: Coach Dashboard (`/coach/dashboard`)

**iOS name:** `CoachDashboardView`
**Role:** Coach
**Purpose:** Overview of coach's client roster with status indicators

**Primary CTA:** Tap client to go to their detail
**Secondary:** Add client / go to leads

**Sections:**
1. Header: coach name, date
2. Client list:
   - Each row: client avatar (gradient ring) + name + check-in status badge + last check-in date
   - Status badges: week status (submitted/reviewed/pending) + intake status
3. Empty state: "No clients yet → Go to Leads"

**Required data:**
- `CoachClient[]` with nested `client` user data
- Latest check-in status per client
- Adherence summary per client (optional, if enabled)

**Needs confirmation:** Exact data returned by coach dashboard query — audit `lib/queries/` for `getCoachDashboard` or equivalent.

**Native iOS:**
- `List` with custom row cells
- Sort order: clients with overdue check-ins first (same as web implied)

---

## SCREEN 7: Client Detail (`/coach/clients/[clientId]`)

**iOS name:** `ClientDetailView` (coach-facing)
**Role:** Coach
**Purpose:** Full view of one client's data — metrics, plans, intake, check-in history

**Sections (in order from web):**
1. **Header:** client avatar (gradient ring) + name + email + last message timestamp
2. **Action buttons:** Check-In, Import Meal Plan, Import Training (context-dependent)
3. **Key metrics row:** baseline weight, current weight, previous weight, change card, diet/energy scores
4. **Weight progress chart** (`WeightProgress` component — line chart)
5. **Messages** (latest thread with compose input — embedded)
6. **Intake questionnaire status** (if active intake: status badge + date)
7. **Plans** (`PlanTabs` component — meal plan + training tabs with editor)
8. **Intake Summary** (intake panel — editable for coach)
9. **Legacy intake** (structured old-format intake if present)
10. **Check-in History** (list of check-ins with status indicators — colored left border)
11. **Danger Zone** (remove client)

**Required data:** See page.tsx — large parallel data fetch including check-ins, adherence, exercise progress, weight delta, messages, intake packet, legacy intake.

**Native iOS:**
- This is a complex screen. Consider split-view on iPad (sidebar = client list, detail = this view)
- On iPhone: `NavigationStack` push for detail
- Tabs or sections for: Overview | Plans | Check-ins | Settings (progressive disclosure)

---

## SCREEN 8: Check-In Review (`/coach/clients/[clientId]/check-ins/[checkInId]`)

**iOS name:** `CheckInReviewView` (coach-facing)
**Role:** Coach
**Purpose:** Coach views a single submitted check-in and writes feedback

**Primary CTA:** Mark as Reviewed / Publish feedback
**Secondary:** Navigate to next/previous check-in, draft/publish message

**Sections:**
1. Check-in metrics (weight, diet, energy, body fat%)
2. Client photos (`CheckInPhoto[]`)
3. Client notes
4. Custom question responses (`customResponses` JSON)
5. Message composer (coach feedback message — draft/publish flow)
6. Weight progress sparkline
7. Mark as Reviewed button

**Must match web:**
- Feedback message has `DRAFT` vs `PUBLISHED` states
- Reviewing is coach-only action
- Published message triggers client notification (email/SMS)

---

## SCREEN 9: Leads Pipeline (`/coach/leads`)

**iOS name:** `LeadsPipelineView` (coach-facing)
**Role:** Coach
**Purpose:** CRM view of prospects at various stages

**Sections:**
1. Filter tabs / segment (All, Pending, Contacted, Call Scheduled, Accepted, Declined)
2. Lead cards: name, stage badge, source badge, date, action buttons
3. Lead detail sheet: intake answers, consultation date, intake status, actions (accept, decline, schedule, send intake)

**Required data:**
- `CoachingRequest[]` with nested intake answers, consultation meeting, prospect user

**Native iOS:**
- Segmented control or custom pill filter for stages
- Swipe actions on lead rows for quick actions (e.g., swipe to contact)
- Sheet for lead detail

---

## SCREEN 10: Intake Form (`/client/intake`)

**iOS name:** `IntakeFormView` (client-facing)
**Role:** Client
**Purpose:** Multi-section intake questionnaire sent by coach

**Sections:**
1. Progress indicator (section N of N)
2. Current section: section title + question list
3. Each question: text/multiple-choice/boolean based on type
4. Back / Next buttons
5. Final submit

**Required data:**
- `IntakeFormTemplate` (from coach) — sections and question definitions
- `IntakePacket` (existing draft answers, if resuming)

**Must match web:**
- Save progress per page (IN_PROGRESS state)
- Final submit → status becomes COMPLETED
- Questions may be required (validate before advancing)

---

## SCREEN 11: Coach Settings (`/coach/settings`)

**iOS name:** `CoachSettingsView`
**Role:** Coach
**Purpose:** Configure schedule, notifications, email, SMS, check-in form

**Sub-sections:**
- Check-In Form defaults (custom questions)
- Cadence / Schedule configuration
- Email notification toggles (per event type)
- SMS notification toggles (per event type, with opt-in phone verification)
- Team management

**Native iOS:**
- `Form` with grouped sections
- Toggle rows for each notification type

---

## SCREEN 12: Client Settings (`/client/settings`)

**iOS name:** `ClientSettingsView`
**Role:** Client
**Same pattern as coach settings but limited to:**
- Check-in reminder time
- SMS opt-in + per-event toggles
- Timezone selection
- Email notification preferences
- Profile photo

---

## SCREEN 13: Coach Public Profile (`/coaches/[slug]`)

**iOS name:** `CoachProfileView` (public)
**Role:** Any user (browsing)
**Purpose:** Public coach page — bio, specialties, testimonials, portfolio, contact/request button

**Primary CTA:** "Request Coaching" (if accepting clients)
**Secondary:** Save coach (heart/bookmark)

**Must match web:** All content is derived from `CoachProfile` + `PortfolioItem[]` + `Testimonial[]`.

---

## Empty and Loading State Rules (Global)

| State | Pattern |
|-------|---------|
| Loading data | Skeleton placeholder cards with `redacted(reason: .placeholder)` |
| No items in list | Dashed border container + icon + muted text + optional CTA |
| Network error | Inline red-border error card with retry button |
| Unauthorized | Redirect to sign-in (Clerk handles this) |
| No coach assigned | Special banner on ClientHome, hide plan/check-in sections |
| Draft plan (coach seeing unpublished) | Amber badge visible to coach, hidden from client |
