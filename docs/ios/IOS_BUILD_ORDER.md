# IOS_BUILD_ORDER.md
> Steadfast iOS — Recommended Build Sequence for MVP
> Prioritizes: client value, backend stability, coach leverage

---

## Build Philosophy

1. **Client app first.** The client-facing screens are simpler, more defined, and cover the core value proposition.
2. **Read before write.** Build view-only screens first (meal plan, training) — they require only GET endpoints. Add mutations (check-in, messages) after.
3. **Auth + navigation skeleton blocks everything.** Do this first, unconditionally.
4. **Coach app is phase 2.** Coach operations (plan editing, lead management) require complex mutations and should follow once client app is stable.
5. **Backend stability prerequisite.** REST API endpoints must be built before iOS screens that need them. The existing Next.js Server Actions are not usable from native.

---

## Phase 0 — Foundation (Blocks Everything Else)

> Must complete before any feature work. Parallel with backend API setup.

### 0.1 Auth — Clerk Native SDK
- [ ] Integrate `clerk-ios` SDK
- [ ] Sign-in / Sign-up screens (email+password, OAuth if applicable)
- [ ] JWT token retrieval and storage (Keychain)
- [ ] Auth state management (`AppState.isAuthenticated`, `AppState.activeRole`)
- [ ] Role detection from Clerk session claims (`isCoach`, `isClient`, `activeRole`)
- [ ] Session refresh + token expiry handling

**Backend dependency:** None — Clerk handles this directly.

### 0.2 App Shell
- [ ] `TabView` with role-aware tab sets (client tabs vs. coach tabs)
- [ ] `NavigationStack` roots for each tab
- [ ] Role switcher UI (coach→client / client→coach)
- [ ] Design tokens: colors, typography, spacing (from `IOS_UI_SYSTEM.md`)
- [ ] Base `APIService` class with auth header injection
- [ ] Global error handling + network error states
- [ ] Safe area insets + dark background applied globally

**Backend dependency:** None.

---

## Phase 1 — Client App Core (MVP)

Build in this order. Each item depends on the prior.

### 1.1 Client Home Screen
**Screens:** `ClientHomeView`
**Backend endpoints needed:**
```
GET /api/client/home
→ Returns: user, coachAssignment, weekStatus, cadenceResult, mealPlan (brief), trainingProgram (brief), latestMessage, pendingIntake, adherenceEnabled
```
**Key logic:** Server must return pre-computed `cadenceResult` (due/overdue/submitted/reviewed). Never compute on device.

**Build:** Static layout first → wire API → animate sections.

---

### 1.2 Meal Plan (Read Only)
**Screens:** `MealPlanView`
**Backend endpoints needed:**
```
GET /api/client/meal-plan/current
→ Returns: MealPlan (published) with MealPlanItem[], MacroTarget, planExtras
```
**Key logic:** Only show `PUBLISHED` plans. Group items by `mealName`.

---

### 1.3 Training Program (Read Only)
**Screens:** `TrainingProgramView`
**Backend endpoints needed:**
```
GET /api/client/training/current
→ Returns: TrainingProgram (published) with TrainingDay[], exercises, blocks, cardio
```
**Key logic:** Handle `__CARDIO__` sentinel day name as special cardio strip. Multiple block types (EXERCISE, SUPERSET, ACTIVATION, INSTRUCTION, CARDIO, OPTIONAL).

---

### 1.4 Check-In Form (Submit + Update)
**Screens:** `CheckInFormView`, `CheckInSuccessState`
**Backend endpoints needed:**
```
GET  /api/client/checkin/current     → current period check-in (if exists) + period dates
POST /api/client/checkin             → submit new check-in
PUT  /api/client/checkin/{id}        → update existing SUBMITTED check-in
POST /api/client/checkin/{id}/photos → upload photo(s)
```
**Key logic:** Upsert by period. Read-only if REVIEWED. Template questions from snapshot.

**Photo upload:** Clients upload photos to Supabase — backend returns signed upload URLs or handles via API.

---

### 1.5 Check-In History
**Screens:** `CheckInHistoryView`, `CheckInDetailView` (read-only client view)
**Backend endpoints needed:**
```
GET /api/client/checkins          → paginated list
GET /api/client/checkins/{id}     → single check-in detail
```

---

### 1.6 Messages
**Screens:** `MessagesView` (client-coach bi-directional)
**Backend endpoints needed:**
```
GET  /api/messages?clientId={id}&weekOf={date}   → message thread for week
POST /api/messages                               → send message
GET  /api/messages/weeks?clientId={id}           → available weeks (for pagination)
```
**Key logic:** Week-scoped. Not a single inbox. Week navigation required.

---

### 1.7 Client Profile + Settings
**Screens:** `ClientProfileView`, `ClientSettingsView`
**Backend endpoints needed:**
```
GET  /api/client/profile              → User fields
PUT  /api/client/profile              → update bio, fitness goal
GET  /api/client/settings/notifications
PUT  /api/client/settings/notifications → toggle per notification type
POST /api/client/profile/photo         → upload profile photo
```

---

### 1.8 Intake Form
**Screens:** `IntakeFormView` (multi-page)
**Backend endpoints needed:**
```
GET  /api/intake/current              → IntakePacket with formAnswers (draft if IN_PROGRESS)
PUT  /api/intake/{id}/answers         → save progress (per page)
POST /api/intake/{id}/submit          → finalize (status → COMPLETED)
```
**Key logic:** Progress saved per section. Resume from last page. Required field validation before advancing.

---

## Phase 2 — Coach App Core

Build only after Phase 1 client app is stable and API patterns are established.

### 2.1 Coach Dashboard
**Screens:** `CoachDashboardView`
```
GET /api/coach/clients → list with latest check-in status per client
```

### 2.2 Client Detail (Coach View)
**Screens:** `ClientDetailView` with tabbed sections
```
GET /api/coach/clients/{id}                    → full client snapshot
GET /api/coach/clients/{id}/checkins           → check-in history
GET /api/coach/clients/{id}/intake             → intake summary
GET /api/coach/clients/{id}/meal-plan/current  → current plan (all statuses visible to coach)
GET /api/coach/clients/{id}/training/current   → current training
```

### 2.3 Check-In Review (Coach)
**Screens:** `CheckInReviewView`
```
GET  /api/coach/clients/{clientId}/checkins/{id}       → check-in detail
PUT  /api/coach/clients/{clientId}/checkins/{id}/review → mark as reviewed
POST /api/messages                                      → publish feedback message
```

### 2.4 Meal Plan Editor (Coach) — High Complexity
**Screens:** `MealPlanEditorView`
- Edit/add/remove items inline
- Publish draft
- Import from PDF (uses OCR/LLM pipeline — needs special API)

```
GET  /api/coach/clients/{id}/meal-plan
POST /api/coach/clients/{id}/meal-plan/items
PUT  /api/coach/clients/{id}/meal-plan/items/{itemId}
DELETE /api/coach/clients/{id}/meal-plan/items/{itemId}
POST /api/coach/clients/{id}/meal-plan/publish
```

### 2.5 Training Program Editor (Coach) — High Complexity
Same pattern as meal plan editor.

### 2.6 Leads Pipeline
**Screens:** `LeadsPipelineView`, `LeadDetailSheet`
```
GET /api/coach/leads
PUT /api/coach/leads/{id}/stage    → advance stage
POST /api/coach/leads              → add manual lead
```

### 2.7 Coach Profile Editor
**Screens:** `CoachProfileEditorView`

### 2.8 Templates
**Screens:** `TemplatesView` — training templates, check-in templates, snippets

---

## Phase 3 — Nice To Have (Post-MVP)

- Daily adherence logging (requires coach to have enabled it per client)
- PDF export of meal plan / training
- Marketplace browsing (`/coaches`)
- Testimonial submission
- Document signing flow (complex — defer)
- Team features
- Exercise result logging
- Coach notifications (requires APNs integration)

---

## Backend API Stability Prerequisites

Before each phase, these backend pieces must be stable:

| iOS Phase | Required backend API work |
|-----------|---------------------------|
| Phase 0 | Clerk webhook for user provisioning; JWT validation middleware |
| Phase 1.1 | `/api/client/home` aggregate endpoint |
| Phase 1.2–1.3 | Meal plan + training read endpoints |
| Phase 1.4 | Check-in upsert + photo upload with Supabase |
| Phase 1.6 | Message thread read + write |
| Phase 1.8 | Intake packet read + answer save + submit |
| Phase 2.1–2.2 | Coach client list + client detail aggregate |
| Phase 2.3 | Check-in review mutation |
| Phase 2.4–2.5 | Plan item CRUD + publish |

---

## Highest-Leverage Screens for MVP Launch

If you can only ship 5 screens, ship these:

| Priority | Screen | Why |
|----------|--------|-----|
| 1 | ClientHome | Core weekly status; motivates engagement |
| 2 | CheckInForm | Core action; coaches need client submissions |
| 3 | MealPlan | Daily reference; clients open it multiple times/day |
| 4 | TrainingProgram | Same daily-reference value as meal plan |
| 5 | Messages | Coach feedback delivery; closes the weekly loop |

These 5 cover the complete client weekly workflow. Everything else is enhancement.

---

## Architecture Recommendations for iOS

```
iOS App
├── Core/
│   ├── APIClient.swift          // Authenticated HTTP client
│   ├── AuthManager.swift        // Clerk session + token management
│   ├── AppState.swift           // @Observable global: role, user, auth state
│   └── DesignTokens.swift       // Color, typography, spacing constants
├── Features/
│   ├── Home/
│   ├── CheckIn/
│   ├── MealPlan/
│   ├── Training/
│   ├── Messages/
│   ├── Intake/
│   ├── Profile/
│   ├── Coach/
│   │   ├── Dashboard/
│   │   ├── ClientDetail/
│   │   ├── Leads/
│   │   └── Templates/
│   └── Settings/
├── Models/
│   ├── User.swift
│   ├── CheckIn.swift
│   ├── MealPlan.swift
│   ├── TrainingProgram.swift
│   ├── Message.swift
│   └── ...
└── Components/
    ├── StatusBadge.swift
    ├── MetricCard.swift
    ├── ProgramCard.swift
    ├── CheckInHistoryRow.swift
    └── ...
```

Use `@Observable` (iOS 17+) or `ObservableObject` (iOS 16 compat) for view models.
Use `async/await` throughout. No Combine chains.
Use `Swift Charts` for weight progress (iOS 16+).
Minimum deployment target: **iOS 16** (required for Swift Charts; iOS 17 for `@Observable`).
