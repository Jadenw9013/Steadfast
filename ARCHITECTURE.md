# Steadfast Web — Project Architecture & Context

> **Last updated:** 2026-04-08  
> **Purpose:** Reference document for AI tools, code reviews, and onboarding. Describes the project structure, tech stack, conventions, and data flow for the Next.js web application.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Framework** | Next.js (App Router) | 16.1 |
| **Language** | TypeScript | 5.x |
| **UI** | React | 19.2 |
| **Styling** | Tailwind CSS v4 | via `@tailwindcss/postcss` |
| **Auth** | Clerk (`@clerk/nextjs`) | v6 |
| **Database** | PostgreSQL (Neon) | Pooled connections |
| **ORM** | Prisma | v7 with `@prisma/adapter-pg` |
| **Storage** | Supabase (private buckets) | Server-signed URLs |
| **Forms** | React Hook Form + Zod v4 | — |
| **Charts** | Recharts | v3 |
| **Email** | Resend | v6 |
| **SMS** | Twilio | v5 |
| **Push** | APNs (server-side via `jsonwebtoken`) | Token-based |
| **AI / OCR** | Google Cloud Vision + OpenAI | Server-side only |
| **PDF** | `@react-pdf/renderer` | v4 |
| **Drag & Drop** | `@dnd-kit` | v6/v10 |
| **Deploy** | Vercel | Production |
| **Analytics** | Vercel Analytics + Speed Insights | — |
| **Testing** | Vitest (unit/smoke) + Playwright (e2e) | — |

---

## Build & Dev

```bash
npm run dev              # Start dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint
npm run test             # Vitest (unit)
npm run test:smoke       # Smoke tests (SMOKE=1)
npm run release-check    # Full pre-deploy gate (release.sh)
```

### Schema Change Workflow

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate migration SQL from live DB diff:
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# 3. Create migration dir + SQL file under prisma/migrations/
# 4. Apply:
npx prisma migrate deploy
npx prisma generate
```

> **Note:** `prisma migrate dev` may fail due to Neon shadow database issues. Use the diff approach above.

---

## Project Structure

```
Steadfast/
├── proxy.ts                           # Auth middleware (Next.js 16 convention, replaces middleware.ts)
├── next.config.ts                     # Next.js config (Supabase image domains)
├── vercel.json                        # Cron job definitions
├── release.sh                         # Pre-deploy release gate script
├── prisma.config.ts                   # Prisma env loader (dotenv → .env.local)
├── package.json                       # Dependencies & scripts
├── tsconfig.json                      # TypeScript config (@/* path alias)
├── vitest.config.ts                   # Test runner config
├── eslint.config.mjs                  # ESLint config
├── postcss.config.mjs                 # PostCSS → Tailwind v4
│
├── prisma/
│   ├── schema.prisma                  # Data model (~1095 lines, 40+ models)
│   ├── seed.ts                        # DB seeder
│   └── migrations/                    # SQL migration history
│
├── app/                               # Next.js App Router
│   ├── layout.tsx                     # Root layout (ClerkProvider, fonts, Footer, Analytics)
│   ├── page.tsx                       # Landing page (public)
│   ├── globals.css                    # Global styles + Tailwind v4 theme
│   ├── loading.tsx                    # Root loading state
│   │
│   ├── sign-in/[[...sign-in]]/        # Clerk sign-in page
│   ├── sign-up/[[...sign-up]]/        # Clerk sign-up page
│   ├── dashboard/                     # Auth'd redirect router (→ /coach or /client)
│   ├── account-deletion-pending/      # Deactivated account holding page
│   │
│   ├── coach/                         # ── Coach routes (layout: NavBar + MobileBottomNav) ──
│   │   ├── layout.tsx                 # Role gate (redirects non-coaches → /client)
│   │   ├── dashboard/                 # Coach dashboard (client roster overview)
│   │   ├── clients/
│   │   │   ├── page.tsx               # Client list
│   │   │   ├── invite/                # Invite client flow
│   │   │   └── [clientId]/
│   │   │       ├── page.tsx           # Client detail workspace
│   │   │       ├── messages/          # Coach ↔ Client DM thread
│   │   │       ├── import/            # Meal plan import (OCR → AI → draft)
│   │   │       ├── import-training/   # Workout import (OCR → AI → draft)
│   │   │       └── review/[weekStartDate]/  # Weekly check-in review workspace
│   │   ├── leads/
│   │   │   ├── page.tsx               # Leads pipeline board
│   │   │   └── [requestId]/           # Lead detail + actions + intake review
│   │   ├── messages/                  # Coach inbox (all client threads)
│   │   ├── marketplace/profile/       # Coach marketplace profile editor
│   │   ├── templates/
│   │   │   ├── page.tsx               # Template library hub
│   │   │   ├── meal-plans/            # Meal plan templates
│   │   │   ├── workouts/              # Workout templates
│   │   │   ├── import/                # Template import
│   │   │   ├── [templateId]/          # Template detail/editor
│   │   │   └── onboarding/            # Onboarding templates (intake, documents)
│   │   ├── settings/
│   │   │   ├── page.tsx               # Coach settings
│   │   │   └── check-in-form/         # Check-in template builder
│   │   ├── more/                      # More hub (profile, settings, legal links)
│   │   └── onboarding/                # Coach first-time setup
│   │
│   ├── client/                        # ── Client routes (layout: NavBar + MobileBottomNav) ──
│   │   ├── layout.tsx                 # Role gate + onboarding enforcement
│   │   ├── page.tsx                   # Client home dashboard
│   │   ├── plan/                      # Plan tab (meal plan + training toggle)
│   │   ├── meal-plan/                 # Meal plan detail view
│   │   ├── training/                  # Training program detail view
│   │   ├── check-in/                  # Check-in submission form
│   │   ├── check-ins/                 # Check-in history
│   │   ├── messages/                  # Client ↔ Coach DM thread
│   │   ├── profile/                   # Client profile editor
│   │   ├── settings/                  # Client settings (notifications, danger zone)
│   │   ├── intake/                    # Client intake questionnaire
│   │   ├── coach/                     # Client's view of their coach
│   │   └── saved-coaches/             # Saved coaches from marketplace
│   │
│   ├── coaches/                       # ── Public marketplace ──
│   │   ├── page.tsx                   # Browse coaches (public, filterable)
│   │   └── [slug]/
│   │       ├── page.tsx               # Public coach profile page
│   │       └── request/               # Coaching request form
│   │
│   ├── onboarding/                    # ── Onboarding flows ──
│   │   ├── page.tsx                   # Client onboarding questionnaire
│   │   ├── intake/[token]/            # Token-gated intake packet
│   │   └── sign/[token]/              # Document signature flow
│   │
│   ├── invite/
│   │   ├── [token]/                   # Client invite acceptance
│   │   └── team/[token]/              # Team invite acceptance
│   │
│   ├── actions/                       # ── Server Actions (34 files) ──
│   │   ├── account-deletion.ts        # Account deletion request/cancel
│   │   ├── adherence.ts               # Daily meal/workout tracking
│   │   ├── check-in.ts                # Check-in CRUD
│   │   ├── check-in-templates.ts      # Custom check-in form templates
│   │   ├── coaching-requests.ts       # Leads pipeline mutations (~39KB, largest action file)
│   │   ├── intake.ts                  # Intake packet CRUD + submission
│   │   ├── meal-plans.ts              # Meal plan save/publish/duplicate
│   │   ├── messages.ts                # Send/edit/delete messages
│   │   ├── marketplace.ts             # Coach profile publish/update
│   │   ├── training-programs.ts       # Training program save/publish
│   │   ├── training-templates.ts      # Training template CRUD
│   │   ├── teams.ts                   # Team management
│   │   ├── testimonials.ts            # Review submission/moderation
│   │   ├── notification-preferences.ts # SMS/email/push settings
│   │   ├── signature.ts               # Document e-signatures
│   │   ├── ... (20 more)              # See full listing in app/actions/
│   │
│   ├── api/                           # ── API Routes (83 route files) ──
│   │   ├── me/                        # User identity & preferences
│   │   ├── client/                    # Client-facing REST (home, checkin, meal-plan, training)
│   │   ├── coach/                     # Coach-facing REST (clients, leads, templates, profile)
│   │   ├── messages/                  # Messaging REST
│   │   ├── mealplans/                 # Meal plan import pipeline (upload, OCR, parse, draft)
│   │   ├── workout-import/            # Workout import pipeline
│   │   ├── intake/                    # Intake packet API
│   │   ├── public/                    # Unauthenticated marketplace API
│   │   ├── webhooks/clerk/            # Clerk user sync webhook
│   │   ├── cron/                      # Vercel cron jobs
│   │   │   ├── checkin-reminders/     # Daily reminder dispatch (19:00 UTC)
│   │   │   └── purge-deleted-accounts/ # Account deletion purge
│   │   └── dev/                       # Dev-only test endpoints (SMS smoke)
│   │
│   ├── generated/prisma/             # Auto-generated Prisma client
│   │
│   ├── about/                        # About page
│   ├── privacy/                      # Privacy policy
│   ├── terms/                        # Terms of service
│   └── sms-policy/                   # SMS/messaging policy
│
├── components/                        # ── React Components ──
│   ├── ui/                            # Shared UI primitives
│   │   ├── nav-bar.tsx                # Top navigation bar (role-aware)
│   │   ├── mobile-bottom-nav.tsx      # Mobile bottom tab bar
│   │   ├── role-switcher.tsx          # Coach ↔ Client role toggle
│   │   ├── sf-surface-card.tsx        # Glass surface card component
│   │   ├── sf-glass-card.tsx          # Frosted glass card
│   │   ├── sf-section-label.tsx       # Section label component
│   │   ├── export-pdf-button.tsx      # PDF export trigger
│   │   ├── theme-provider.tsx         # Theme context provider
│   │   ├── reveal.tsx                 # Scroll-reveal animation wrapper
│   │   ├── toggle.tsx                 # Toggle switch
│   │   ├── weight-sparkline.tsx       # Inline weight sparkline
│   │   ├── TeamBadge.tsx              # Team badge display
│   │   └── landing-theme-toggle.tsx   # Landing page theme toggle
│   │
│   ├── coach/                         # Coach-specific components
│   │   ├── meal-plan/                 # V2 meal plan editor tree
│   │   │   ├── meal-plan-editor-v2.tsx # Main editor (MealGroup[] state)
│   │   │   ├── meal-card.tsx           # Individual meal section
│   │   │   ├── food-row.tsx            # Food item row with inline editing
│   │   │   ├── food-search-dropdown.tsx # Food library autocomplete
│   │   │   ├── portion-editor.tsx      # Quantity/unit editor
│   │   │   ├── macro-toggle.tsx        # Show/hide macro columns
│   │   │   ├── meal-plan-actions.tsx   # Save/publish/duplicate actions
│   │   │   ├── ai-plan-assistant.tsx   # AI plan modification chat
│   │   │   ├── ai-thinking-animation.tsx # AI loading animation
│   │   │   └── plan-extras-display.tsx # Supplements/day overrides/rules
│   │   ├── meal-plan-import/          # OCR import flow
│   │   │   ├── import-flow.tsx         # Multi-step import wizard
│   │   │   ├── upload-step.tsx         # File upload step
│   │   │   ├── paste-text-step.tsx     # Text paste alternative
│   │   │   ├── processing-indicator.tsx # OCR processing state
│   │   │   └── draft-review.tsx        # AI draft review/edit
│   │   ├── training/                  # Training program components
│   │   │   ├── training-program-editor.tsx # Full program editor
│   │   │   ├── training-day-card.tsx   # Individual day editor
│   │   │   ├── block-card.tsx          # Exercise block card
│   │   │   ├── training-program-actions.tsx # Save/publish actions
│   │   │   ├── template-editor.tsx     # Template editor
│   │   │   └── create-template-button.tsx # Create template trigger
│   │   ├── training-import/           # Workout import flow (mirrors meal-plan-import)
│   │   ├── review/                    # Check-in review components
│   │   │   ├── check-in-summary.tsx   # Check-in metrics display
│   │   │   ├── mark-reviewed-button.tsx # Mark as reviewed action
│   │   │   └── photo-lightbox.tsx     # Full-screen photo viewer
│   │   ├── inbox/                     # Dashboard inbox
│   │   │   ├── coach-inbox.tsx        # Inbox list with filters
│   │   │   └── inbox-client-card.tsx  # Client status card
│   │   ├── marketplace/               # Marketplace profile components
│   │   │   ├── profile-form.tsx       # Coach profile editor form
│   │   │   ├── portfolio-manager.tsx  # Portfolio CRUD
│   │   │   ├── marketplace-stats.tsx  # Profile analytics
│   │   │   ├── profile-completion.tsx # Completion checklist
│   │   │   ├── visibility-guide.tsx   # Publishing guide
│   │   │   ├── share-link-card.tsx    # Shareable profile link
│   │   │   └── share-profile-button.tsx # Share CTA
│   │   ├── intake/                    # Coach intake review components
│   │   ├── client-workspace/          # Client detail tabs
│   │   ├── clients/                   # Client list components
│   │   ├── settings/                  # Coach settings components
│   │   ├── onboarding/                # Coach onboarding editor
│   │   └── ... (misc: add-lead, cadence-editor, coach-notes, etc.)
│   │
│   ├── client/                        # Client-specific components
│   │   ├── plan-tab.tsx               # Plan view (meal plan + training toggle)
│   │   ├── simple-meal-plan.tsx       # Read-only meal plan (no macros)
│   │   ├── training-program.tsx       # Read-only training program
│   │   ├── today-adherence.tsx        # Daily meal/workout check-offs
│   │   ├── status-card.tsx            # Check-in status card
│   │   ├── recent-check-ins.tsx       # Check-in history list
│   │   ├── weight-trend-chart.tsx     # Weight history chart
│   │   ├── my-requests-card.tsx       # Marketplace request status
│   │   ├── testimonial-prompt.tsx     # Testimonial request prompt
│   │   ├── testimonial-form.tsx       # Review submission form
│   │   ├── notification-settings.tsx  # Notification preferences
│   │   ├── intake/                    # Client intake form components
│   │   ├── onboarding/                # Client onboarding questionnaire
│   │   └── ... (misc: leave-coach, delete-check-in, etc.)
│   │
│   ├── coaches/                       # Marketplace components
│   │   ├── request-form.tsx           # Coaching request submission form
│   │   └── waitlist-form.tsx          # Waitlist form
│   │
│   ├── public/                        # Public-facing components
│   │   ├── coach-filters.tsx          # Marketplace filter bar
│   │   ├── rating-summary.tsx         # Star rating display
│   │   ├── testimonial-card.tsx       # Testimonial display card
│   │   └── save-coach-button.tsx      # Save/bookmark coach
│   │
│   ├── messages/                      # Shared messaging
│   │   └── message-thread.tsx         # Chat thread (used by both roles)
│   │
│   ├── charts/                        # Chart components
│   ├── check-in/                      # Check-in form components
│   ├── profile/                       # Profile photo/banner upload
│   ├── shared/                        # Shared components
│   │   └── delete-account-section.tsx # Account deletion UI
│   └── footer.tsx                     # Site footer
│
├── lib/                               # ── Server-side Libraries ──
│   ├── db.ts                          # Prisma client singleton (PrismaPg adapter + Proxy)
│   ├── auth/
│   │   └── roles.ts                   # getCurrentDbUser(), checkRole(), JIT user creation
│   ├── queries/                       # Server-only data fetching (20 files)
│   │   ├── meal-plans.ts              # Meal plan queries
│   │   ├── training-programs.ts       # Training program queries
│   │   ├── check-ins.ts               # Check-in queries
│   │   ├── messages.ts                # Message queries
│   │   ├── marketplace.ts             # Coach marketplace listings
│   │   ├── testimonials.ts            # Testimonial queries
│   │   ├── adherence.ts               # Daily adherence queries
│   │   ├── intake.ts                  # Intake packet queries
│   │   └── ... (12 more)
│   ├── ocr/
│   │   └── google-vision.ts           # Google Cloud Vision OCR extraction
│   ├── llm/
│   │   ├── parse-meal-plan.ts         # OpenAI: raw text → structured meal plan JSON
│   │   ├── parse-workout-plan.ts      # OpenAI: raw text → structured workout JSON
│   │   └── modify-meal-plan.ts        # OpenAI: AI plan modification assistant
│   ├── supabase/
│   │   ├── server.ts                  # Supabase client (service role, server-only)
│   │   ├── storage.ts                 # Generic storage helpers
│   │   ├── meal-plan-storage.ts       # Meal plan file storage
│   │   ├── workout-storage.ts         # Workout file storage
│   │   ├── profile-photo-storage.ts   # Profile photo signed URLs
│   │   ├── portfolio-storage.ts       # Portfolio media storage
│   │   ├── testimonial-storage.ts     # Testimonial image storage
│   │   └── document-storage.ts        # Coach document storage
│   ├── email/
│   │   ├── sendEmail.ts               # Resend email client
│   │   └── templates.ts               # Email templates (welcome, check-in reminder, etc.)
│   ├── sms/
│   │   ├── sendSms.ts                 # Twilio SMS client
│   │   ├── notify.ts                  # Multi-channel notification dispatcher
│   │   └── templates.ts               # SMS templates
│   ├── notifications/
│   │   ├── apns.ts                    # APNs JWT + HTTP/2 push sender
│   │   └── push.ts                    # Push notification orchestrator
│   ├── pdf/
│   │   ├── meal-plan-pdf.tsx          # Meal plan PDF renderer
│   │   └── training-program-pdf.tsx   # Training program PDF renderer
│   ├── scheduling/
│   │   ├── cadence.ts                 # Check-in cadence logic
│   │   └── periods.ts                 # Schedule period calculations
│   ├── account-deletion/
│   │   └── purge.ts                   # FK-safe account data purge logic
│   ├── validations/                   # Zod schemas (7 files)
│   ├── utils/
│   │   ├── date.ts                    # normalizeToMonday(), date helpers
│   │   ├── diff-meal-plan.ts          # Meal plan diff engine
│   │   └── zip-lookup.ts              # ZIP code → city/state lookup
│   ├── hooks/
│   │   └── useProfilePhoto.ts         # Client hook for profile photo URL
│   ├── status.ts                      # Check-in status computation
│   ├── plan-clipboard.ts              # Plan copy/paste utilities
│   └── intake-form-defaults.ts        # Default intake form question config
│
├── types/                             # ── TypeScript Type Definitions ──
│   ├── globals.d.ts                   # Clerk session claim types (Roles)
│   ├── meal-plan.ts                   # MealPlanItem, MealGroup interfaces
│   ├── meal-plan-extras.ts            # PlanExtras, DayOverride, Supplement types
│   ├── training.ts                    # Training type extensions
│   └── team.ts                        # Team interfaces
│
├── design-system/steadfast/           # Design system documentation (MASTER.md + page overrides)
├── tests/
│   ├── unit/                          # Vitest unit tests
│   ├── smoke/                         # Smoke tests (SMOKE=1)
│   └── e2e/                           # Playwright E2E tests
│
├── public/brand/                      # Brand assets (logo, icons)
├── scripts/                           # Utility scripts
├── docs/                              # Additional documentation
│
├── CLAUDE.md                          # AI assistant context & constraints
├── STYLING_GUIDE.md                   # CSS/design conventions
└── README.md                          # Project overview & setup
```

---

## Architecture

### App Entry & Routing

```
proxy.ts (Clerk middleware — protects all routes except public)
  └── app/layout.tsx (ClerkProvider, fonts, Footer, Analytics)
        ├── / (page.tsx)                  → Public landing page
        ├── /sign-in, /sign-up            → Clerk auth pages
        ├── /coaches, /coaches/[slug]     → Public marketplace (no auth required)
        ├── /dashboard                    → Auth redirect router (→ /coach or /client)
        ├── /account-deletion-pending     → Deactivated user holding page
        │
        ├── /coach/* (layout.tsx)         → Coach shell (NavBar + MobileBottomNav)
        │     ├── Role gate: redirects non-coaches → /client
        │     └── Deactivation gate: redirects → /account-deletion-pending
        │
        └── /client/* (layout.tsx)        → Client shell (NavBar + MobileBottomNav)
              ├── Role gate: redirects non-clients → /coach/dashboard
              ├── Deactivation gate: redirects → /account-deletion-pending
              └── Onboarding gate: redirects to /onboarding if questionnaire incomplete
```

### Two Roles, One App

The app serves two distinct user roles from one codebase:

**Coach** (top-level nav: Dashboard → Clients → Leads → Messages → Templates → More):
- Client management, check-in review, meal plan & training program editing
- Leads pipeline (marketplace requests + external leads)
- Template library (meal plans, workouts, intake forms, documents)
- Marketplace profile management
- AI-assisted plan import (OCR → LLM → draft)

**Client** (top-level nav: Home → Plan → Check-In → Messages → Profile):
- Weekly check-in submission with photos
- View current meal plan & training program
- Daily adherence tracking (meal/workout check-offs)
- Exercise progress logging (reps/weight)
- Browse coaches marketplace (when no coach assigned)

Role switching: `setActiveRole()` server action → updates `User.activeRole` → client revalidates.

### Data Layer

```
lib/db.ts (Prisma singleton)
├── PrismaPg adapter (pooled Neon connections)
├── Lazy-initialized via Proxy pattern
└── Cached on globalThis in dev (prevents hot-reload connection leaks)

lib/auth/roles.ts
├── getCurrentDbUser() — auth + DB lookup + JIT user creation
├── checkRole() — Clerk session claim check
└── JIT: if webhook hasn't synced yet, creates user from Clerk data

lib/queries/ (20 server-only query files)
├── Called from Server Components (SSR)
├── Return typed Prisma results with explicit select
└── Never exposed to client-side code

app/actions/ (34 server action files)
├── "use server" mutations with Zod validation
├── All verify auth + role + relationship ownership
└── Coach endpoints call verifyCoachAccessToClient(clientId)
```

### Week-Based Data Model

All core data is scoped by `weekOf` (DateTime), canonicalized to **Monday midnight UTC** via `normalizeToMonday()` in `lib/utils/date.ts`. Check-ins, macro targets, meal plans, training programs, and messages are all keyed by `(clientId, weekOf)`.

### State Management

- **Server Components** (default): Data fetched at request time via `lib/queries/`, no client-side state needed
- **Client Components** (`"use client"`): Local state via `useState` / `useReducer` for interactive editors
- **Forms**: React Hook Form with Zod resolvers
- **Mutations**: Server Actions invoked from client components, triggering `revalidatePath()`

### Key Data Flows

**Check-in submission:**
1. Client fills form → `createSignedUploadUrls()` generates Supabase signed URLs
2. Browser uploads photos directly to Supabase (service key never reaches client)
3. `createCheckIn()` server action creates CheckIn + CheckInPhoto records
4. Coach inbox auto-updates on next page load

**Meal plan import (OCR → AI → draft):**
1. File uploaded to private Supabase bucket via signed URL
2. Server calls Google Cloud Vision OCR → extracts text
3. OpenAI structures text into JSON (meal plan or training program)
4. Schema validation + normalization
5. Draft created in DB → coach reviews and publishes

**AI plan assistant:**
1. Coach describes desired changes in natural language
2. `modify-meal-plan.ts` sends current plan + instructions to OpenAI
3. Returns diffed changes for coach review
4. Coach accepts/rejects individual modifications

**Leads pipeline:**
1. Prospect submits coaching request via marketplace (or coach adds external lead)
2. Coach manages through stages: Pending → Contacted → Call Scheduled → Accepted
3. Intake packet sent (token-gated, no login required)
4. Prospect signs documents + completes intake → converted to client

---

## Data Model (Prisma Schema — 40+ models)

### Core Entities

| Model | Purpose |
|---|---|
| `User` | All users (coaches + clients). Contains role flags, notification preferences, APNs token |
| `CoachClient` | Many-to-many coach↔client assignment. Carries per-client overrides (cadence, adherence, notes) |

### Check-Ins & Progress

| Model | Purpose |
|---|---|
| `CheckIn` | Weekly client submission (weight, body fat, compliance, notes, custom responses) |
| `CheckInPhoto` | Progress photos (Supabase storage paths) |
| `CheckInTemplate` | Custom check-in forms with configurable questions (JSON) |
| `MacroTarget` | Weekly macro targets set by coach (calories, protein, carbs, fats) |
| `DailyAdherence` | Daily tracking container (date-keyed) |
| `DailyMealCheckoff` | Individual meal completion tracking |
| `ExerciseCheckoff` | Individual exercise completion tracking |
| `ExerciseResult` | Set-by-set weight/rep logging |

### Meal Plans

| Model | Purpose |
|---|---|
| `MealPlan` | Week-scoped plan with DRAFT/PUBLISHED status + planExtras (JSON) |
| `MealPlanItem` | Individual food items within a plan (name, quantity, macros) |
| `MealPlanUpload` | File upload tracking for OCR import pipeline |
| `MealPlanDraft` | AI-parsed draft (extracted text + structured JSON) |
| `FoodLibraryItem` | Coach's personal food library for autocomplete |
| `PlanSnippet` | Reusable plan sections (supplements, day overrides, rules) |

### Training

| Model | Purpose |
|---|---|
| `TrainingProgram` | Client-specific, week-scoped program (DRAFT/PUBLISHED) |
| `TrainingDay` | Named day within a program |
| `TrainingExercise` | Exercise within a day (sets, reps, intensity, notes) |
| `TrainingProgramBlock` | Structured block (EXERCISE, ACTIVATION, SUPERSET, CARDIO, etc.) |
| `TrainingProgramCardio` | Program-level cardio prescription |
| `TrainingTemplate` | Reusable coach-owned template (mirrors program structure) |
| `WorkoutImport` / `WorkoutImportDraft` | Import pipeline (mirrors meal plan import) |

### Marketplace & Leads

| Model | Purpose |
|---|---|
| `CoachProfile` | Public marketplace profile (slug, bio, specialties, pricing, location) |
| `CoachingRequest` | Lead/prospect through the pipeline (9-stage `ConsultationStage`) |
| `ConsultationMeeting` | Scheduled consultation details |
| `ClientInvite` | Direct invite tokens (email-based) |
| `PortfolioItem` | Coach portfolio entries (before/after, case studies) |
| `Testimonial` | Client reviews (1-5 stars, text, up to 4 images) |
| `SavedCoach` | Client bookmarks |

### Onboarding & Intake

| Model | Purpose |
|---|---|
| `OnboardingForm` | Coach-defined onboarding questionnaire (JSON questions) |
| `OnboardingResponse` | Client's answers to onboarding form |
| `ClientIntake` | Structured health/fitness intake (specific fields, not JSON) |
| `IntakeFormTemplate` | Customizable intake form template per coach |
| `IntakePacket` | Token-gated intake bundle (form + documents for leads) |
| `IntakePacketDocument` | Documents included in an intake packet |
| `CoachDocument` | Coach-owned documents (text or file) |
| `ClientFormSubmission` | Form answers within intake flow |
| `ClientFormSignature` / `DocumentSignature` | E-signature records |

### Teams & Settings

| Model | Purpose |
|---|---|
| `Team` | Coaching team/org |
| `TeamInvite` | Team invite tokens |
| `CoachSettings` | Coach preferences (auto-accept, consultation required, etc.) |

### System

| Model | Purpose |
|---|---|
| `NotificationLog` | Deduplication log for check-in reminders |
| `Message` | Coach↔Client DM messages (keyed by clientId + weekOf) |
| `AccountDeletionRequest` | GDPR-compliant deletion with 30-day grace period |

---

## API Surface (REST — iOS & external consumption)

### Client-facing (`/api/client/`)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/me` | Current user profile |
| POST | `/api/me/role` | Switch active role |
| POST | `/api/me/push-token` | Register APNs token |
| DELETE | `/api/me/push-token` | Unregister APNs token |
| GET/PUT | `/api/me/notifications` | Notification preferences |
| GET | `/api/client/home` | Client home dashboard data |
| GET | `/api/client/meal-plan/current` | Active published meal plan |
| GET | `/api/client/training/current` | Active published training program |
| GET/POST | `/api/client/checkin` | Check-in submission |
| GET | `/api/client/checkins` | Check-in history |
| GET/PUT | `/api/client/profile` | Profile read/update |
| GET | `/api/client/coach-photo` | Coach profile photo URL |
| GET/PUT | `/api/client/settings/notifications` | Client notification settings |
| GET/POST | `/api/client/adherence/*` | Daily adherence (today, meal, workout) |
| POST | `/api/client/training/results` | Exercise progress logging |

### Coach-facing (`/api/coach/`)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/coach/clients` | Client roster |
| GET/DELETE | `/api/coach/clients/[clientId]` | Client detail / remove |
| GET/PUT | `/api/coach/clients/[clientId]/meal-plan` | Client meal plan CRUD |
| POST | `/api/coach/clients/[clientId]/meal-plan/publish` | Publish meal plan |
| GET/PUT | `/api/coach/clients/[clientId]/training` | Client training program CRUD |
| POST | `/api/coach/clients/[clientId]/training/publish` | Publish training program |
| GET | `/api/coach/clients/[clientId]/intake` | Client intake data |
| GET | `/api/coach/clients/[clientId]/messages` | Client message thread |
| GET | `/api/coach/clients/[clientId]/checkins/[id]` | Specific check-in detail |
| GET/POST | `/api/coach/leads` | Leads pipeline |
| GET/PUT | `/api/coach/leads/[leadId]` | Lead detail / update |
| POST | `/api/coach/leads/[leadId]/stage` | Advance lead stage |
| POST | `/api/coach/leads/[leadId]/activate` | Convert lead to client |
| POST | `/api/coach/leads/[leadId]/bypass-activate` | Direct activation (skip intake) |
| GET | `/api/coach/leads/[leadId]/intake` | Lead intake data |
| GET/PUT | `/api/coach/profile` | Coach profile CRUD |
| POST | `/api/coach/profile-photo` | Upload coach photo |
| GET/PUT | `/api/coach/settings/notifications` | Coach notification settings |
| GET | `/api/coach/marketplace/stats` | Marketplace analytics |
| GET/POST/PUT/DELETE | `/api/coach/templates/*` | Template CRUD |
| POST | `/api/coach/templates/[id]/apply` | Apply template to client |
| GET/POST | `/api/coach/documents/*` | Document library CRUD |

### Shared & Public

| Method | Endpoint | Purpose |
|---|---|---|
| GET/POST | `/api/messages` | DM thread messages |
| DELETE | `/api/messages/[messageId]` | Delete message |
| GET | `/api/messages/weeks` | Available message weeks |
| POST | `/api/actions/account-deletion` | Request account deletion |
| POST | `/api/actions/account-deletion/cancel` | Cancel deletion |
| GET | `/api/public/coaches` | Public coach listings (marketplace) |
| GET | `/api/public/coaches/[slug]` | Public coach profile |
| POST | `/api/public/coaching-request` | Submit coaching request (no auth required) |
| POST | `/api/webhooks/clerk` | Clerk user sync webhook |
| GET | `/api/cron/checkin-reminders` | Cron: daily reminder dispatch |
| GET | `/api/cron/purge-deleted-accounts` | Cron: account purge execution |

### Import Pipeline

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/mealplans/upload-url` | Generate signed upload URL |
| POST | `/api/mealplans/parse` | OCR → text extraction |
| POST | `/api/mealplans/parse-text` | Text → AI structured JSON |
| POST | `/api/mealplans/import-plan` | Finalize import into meal plan |
| POST | `/api/mealplans/modify-plan` | AI plan modification |
| GET | `/api/mealplans/draft` | Get meal plan draft |
| GET | `/api/mealplans/[id]/export` | Export meal plan as PDF |
| POST | `/api/workout-import/upload-url` | Workout signed upload URL |
| POST | `/api/workout-import/parse` | Workout OCR extraction |
| POST | `/api/workout-import/parse-text` | Workout AI structuring |
| POST | `/api/workout-import/import` | Finalize workout import |
| GET | `/api/workout-import/draft` | Get workout draft |
| GET | `/api/training-programs/[id]/export` | Export training program PDF |

---

## External Services

| Service | Usage | Keys |
|---|---|---|
| **Clerk** | Authentication (sign-in/up, JWT sessions, webhooks) | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` |
| **Neon (PostgreSQL)** | Primary database | `DATABASE_URL` |
| **Supabase** | File storage (photos, documents, imports) | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| **Google Cloud Vision** | OCR text extraction from meal plan images/PDFs | `GOOGLE_CLOUD_VISION_API_KEY` |
| **OpenAI** | Meal plan/workout structuring, AI plan assistant | `OPENAI_API_KEY` |
| **Twilio** | SMS notifications | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` |
| **Resend** | Transactional email | `RESEND_API_KEY` |
| **Vercel** | Hosting, cron jobs, analytics | Managed via Vercel dashboard |
| **APNs** | iOS push notifications | `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_AUTH_KEY` (P8) |

> **Security:** Service-role keys, API secrets, and AI keys live server-side only. The only `NEXT_PUBLIC_*` keys are Clerk's publishable key and Supabase's public URL. No secrets in client code.

---

## Key Conventions

### Permanent Dark Mode
- No light-mode conditionals — always `dark` class on `<html>`
- Background: pure black (`bg-black`)
- Typography: white text, Sora (body) + Chakra Petch (headings) + Geist Mono (code)

### Design System
- Design tokens documented in `design-system/steadfast/MASTER.md`
- Page-specific overrides in `design-system/steadfast/pages/`
- Custom CSS components in `globals.css` (~52KB, extensive)
- Glass cards: `sf-surface-card`, `sf-glass-card` components
- Accent: Orange/ember palette

### Prisma Patterns
- Import `PrismaClient` from `@/app/generated/prisma/client`
- Import enums from `@/app/generated/prisma/enums`
- **Always use explicit `select:`** on CoachClient queries (never `include` without `select` — Neon adapter crashes on `Int[]/Json` columns)
- DB singleton via Proxy in `lib/db.ts`

### Auth Pattern
- All protected pages call `getCurrentDbUser()` → returns full User record
- Coach actions call `verifyCoachAccessToClient(clientId)` → checks CoachClient table
- JIT user creation if Clerk webhook hasn't synced yet
- Roles stored in both Clerk `publicMetadata` and DB `User.activeRole`

### Server Actions
- All in `app/actions/` with `"use server"` directive
- Zod validation on all inputs
- Auth + role + ownership verification before any mutation
- Return typed results (not throwing — caller handles)

### Release Discipline
- `release.sh` runs: build → lint → localhost check → test key scan → console.log audit → Prisma include audit
- Failing checks block deploy
- Vercel auto-deploys from `main` branch

### Font Size
- All inputs: `font-size: max(1rem, 16px)` (prevents iOS zoom)
- Minimum 48px tap targets for interactive elements

---

## Cron Jobs

| Schedule | Endpoint | Purpose |
|---|---|---|
| Daily 19:00 UTC | `/api/cron/checkin-reminders` | Sends check-in reminders (email, SMS, push) based on cadence config |
| On-demand | `/api/cron/purge-deleted-accounts` | Purges accounts past 30-day grace period (FK-safe deletion order) |

---

## Testing

| Layer | Tool | Location |
|---|---|---|
| Unit | Vitest | `tests/unit/` |
| Smoke | Vitest (SMOKE=1) | `tests/smoke/` |
| E2E | Playwright | `tests/e2e/` |

```bash
npm run test              # Unit tests
npm run test:smoke        # Smoke tests
npx playwright test       # E2E tests
```
