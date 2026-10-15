# Steadfast Coach Platform — CONTEXT.md

> **Purpose**: This document provides full technical and product context for AI planners and engineers implementing new features. Read this before making any changes.

---

## 1. Product Overview

**Steadfast** is a B2B SaaS coaching platform connecting fitness coaches with their clients. It is a private, invite-only app — not a consumer marketplace. Coaches manage clients; clients access their personalized plans, check-ins, and messaging.

### Core User Journeys

| Role | Primary Actions |
|---|---|
| **Coach** | Manage clients, assign meal/training plans, review check-ins, message clients, manage marketplace profile, invite leads |
| **Client** | Submit weekly check-ins, view meal/training plans, message coach, log workouts, view progress |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, Turbopack in dev) |
| **Language** | TypeScript (strict) |
| **Styling** | Tailwind CSS v4 (`@import "tailwindcss"` syntax) |
| **Auth** | Clerk (JIT user creation via webhook + fallback in `getCurrentDbUser`) |
| **Database** | PostgreSQL via Neon (serverless) |
| **ORM** | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| **Storage** | Supabase Storage (photos, uploads, PDFs) |
| **Email** | Resend (transactional emails) |
| **SMS** | Twilio (opt-in notifications) |
| **LLM** | OpenAI (meal plan parsing, workout plan parsing) |
| **Deployment** | Vercel (Pro decided in G05/T-590, must be confirmed on the dashboard before the T-503 `vercel.json` ships — was Hobby, 1 cron/day; three crons now registered) |
| **Fonts** | Sora (body), Chakra Petch (headings), Geist Mono (code) |

### Critical Config Notes
- **Prisma client is generated to `app/generated/prisma/`** — import always from `@/app/generated/prisma/client`, never `@prisma/client`
- **`@prisma/adapter-pg`** is used — avoid `include` without explicit `select` on models with `Int[]` or `Json?` fields (`checkInDaysOfWeek`, `cadenceConfig`, `checkInDaysOfWeekOverride`) as they can cause P2022 errors in Turbopack dev mode
- **No middleware.ts** — auth is enforced in each layout/page directly via `getCurrentDbUser()`
- **Dark mode is permanent** — `ThemeProvider` always returns `"dark"`, no toggle

---

## 3. Directory Structure

```
app/
├── (root)/           # Landing page, about, privacy, terms
├── coach/            # Coach dashboard and all coach-facing pages
│   ├── dashboard/
│   ├── clients/[clientId]/   # Per-client management (check-ins, plans, messages)
│   ├── check-ins/            # Coach check-in review queue
│   ├── leads/                # Coaching request leads management
│   ├── marketplace/profile/  # Coach public profile editor
│   ├── onboarding/           # New coach setup flow
│   ├── settings/             # Coach settings (check-in form, notifications, etc.)
│   └── templates/            # Reusable training program templates
├── client/           # Client dashboard and all client-facing pages
│   ├── check-in/             # Submit a new check-in
│   ├── check-ins/[checkInId] # View a specific check-in
│   ├── meal-plan/            # View current meal plan
│   ├── training/             # View and log training program
│   ├── messages/[weekOf]     # Weekly coach messages
│   ├── profile/              # Client profile settings
│   └── settings/             # Notification preferences
├── coaches/          # Public marketplace (discovery + coach profile pages)
│   ├── page.tsx              # Coach directory
│   └── [slug]/page.tsx       # Individual coach public profile
├── onboarding/       # Post-signup onboarding questionnaire (gated)
├── invite/[token]/   # Client invitation accept flow
├── check-in/new/     # Quick check-in entry (also accessible from push notifications)
├── actions/          # All Next.js Server Actions (28 files)
├── api/              # API routes (webhooks, cron jobs, file upload)
└── generated/prisma/ # Prisma-generated client (DO NOT EDIT)

components/
├── coach/            # Coach-specific components (inbox, review, clients, etc.)
├── client/           # Client-specific components (check-in, training, meal plan, etc.)
├── coaches/          # Public marketplace components
├── ui/               # Shared design system components (NavBar, Button, etc.)
├── charts/           # Recharts-based weight/progress charts
├── messages/         # Shared messaging components
├── profile/          # Profile photo components
└── public/           # Public-facing shared components

lib/
├── auth/             # getCurrentDbUser(), checkRole()
├── db.ts             # Prisma singleton (lazy Proxy pattern)
├── queries/          # Read-only DB query functions (30+ files)
├── actions/          # (Server actions are in app/actions/, not here)
├── email/            # Resend email templates and sender
├── sms/              # Twilio SMS helpers
├── llm/              # OpenAI meal plan + workout parsers
├── scheduling/       # Cadence engine (CadenceConfig, check-in scheduling logic)
├── supabase/         # Storage helpers for Supabase buckets
├── utils/            # date, currency, string utils
└── validations/      # Zod schemas for form/action validation
```

---

## 4. Authentication & Authorization

### Auth Pattern
```typescript
// All protected pages/layouts call this first:
const user = await getCurrentDbUser();
// - Reads Clerk session (auth())
// - Looks up DB user by clerkId
// - JIT creates user if webhook hasn't fired yet
// - Throws "Not authenticated" if no Clerk session
```

### Role System
- Users have `activeRole: Role ("COACH" | "CLIENT")`
- `isCoach: Boolean` and `isClient: Boolean` flags (a user can be both)
- Role switch available to dual-role users
- Coach layouts redirect clients, client layouts redirect coaches

### Route Protection
```
/coach/*    → enforced in app/coach/layout.tsx (checks activeRole === "COACH")
/client/*   → enforced in app/client/layout.tsx (checks activeRole === "CLIENT")
/coaches/*  → PUBLIC (unauthenticated)
```

---

## 5. Data Models (Key Relationships)

### Core Hierarchy
```
User (coach) ──────── CoachClient ──────── User (client)
                          │
              ┌───────────┼───────────────────┐
          CheckIn      MealPlan         TrainingProgram
          Message      MacroTarget      ExerciseResult
```

### Important Models

**`User`** — single table for both coaches and clients
- `activeRole`: current active role (COACH | CLIENT)
- `isCoach` / `isClient`: capability flags
- `checkInDaysOfWeek Int[]`: legacy weekly check-in schedule (0=Sun..6=Sat)
- `cadenceConfig Json?`: new flexible cadence config (overrides `checkInDaysOfWeek` when set)
- `profilePhotoPath`: Supabase storage path for avatar
- Full SMS notification preferences (12 boolean flags + time settings)
- Full email notification preferences (6 boolean flags)

**`CoachClient`** — coach-client assignment
- `unique([coachId, clientId])` — one assignment per pair
- `cadenceConfig Json?`: per-client cadence override (null = use coach default)
- `checkInDaysOfWeekOverride Int[]`: legacy per-client days override
- `adherenceEnabled Boolean`: whether daily adherence tracking is active for this client
- `sortOrder Int`: coach inbox drag-and-drop order
- `coachNotes`: private coach notes

**`CheckIn`** — weekly client progress submission
- `weekOf DateTime`: normalized to Monday (UTC midnight)
- `status: CheckInStatus (SUBMITTED | REVIEWED)`
- `isPrimary Boolean`: only one primary check-in per period
- `localDate`, `timezone`, `periodStartDate`, `periodEndDate`: cadence-aware scheduling fields
- `templateId?`, `templateSnapshot Json?`, `customResponses Json?`: custom check-in form support
- Photos stored in `CheckInPhoto` (paths → Supabase)

**`MealPlan`** — coach-created nutrition plan for a client
- `weekOf`: scoped to a week
- `status: DRAFT | PUBLISHED`
- `planExtras Json?`: additional plan metadata (macros summary, notes)
- Items in `MealPlanItem` (food, quantity, macros per item)
- Coach also manually sets `MacroTarget` (separate model, daily targets)

**`TrainingProgram`** — client's published workout program
- Created from `TrainingTemplate` (coach-owned reusable template) or directly
- Has `TrainingDay[]` → `TrainingProgramBlock[]`
- `BlockType` enum: `EXERCISE | ACTIVATION | INSTRUCTION | SUPERSET | CARDIO | OPTIONAL`
- Special day `__CARDIO__` stores cardio prescription
- `ExerciseResult` stores per-week per-exercise logged sets (weight + reps)

**`Message`** — coach-client messaging
- Scoped to `clientId + weekOf` (weekly threads)
- `senderId` distinguishes coach vs client messages

**`CoachProfile`** — public marketplace profile
- `slug`: unique URL path (`/coaches/{slug}`)
- `isPublished Boolean`: controls marketplace visibility
- Linked from `User` via `coachProfile` relation

**`Testimonial`** — public reviews
- Only shown if `reviewText` is not null/empty OR has images (star-only excluded from display)

**`CoachingRequest`** — marketplace lead form submission
- Prospect's `phoneNumber` (not email) + message to coach
- Status flow: lead management in `/coach/leads/`

**`ClientInvite`** — coach-initiated client invitation
- Token-based invite link (`/invite/{token}`)
- Prevents duplicate coach assignments

**`ExerciseResult`** — per-set workout logging
- Key: `clientId + exerciseName + programDay + weekOf`
- Multi-set exercises saved as separate rows: `"Incline Press [Set 1]"`, `"Incline Press [Set 2]"`, etc.
- Single-set exercises use no suffix (backwards compatible)
- `previousWeek` results shown inline to client for progressive overload reference

**`OnboardingForm` + `OnboardingResponse`** — coach onboarding questionnaire
- Coach creates one form; clients must complete it before accessing the dashboard
- Enforced in `app/client/layout.tsx`

**`DailyAdherence`** — daily meal + workout completion tracking
- Enabled per-client by coach (`CoachClient.adherenceEnabled`)
- `meals Json[]`, `workoutCompleted Boolean`

---

## 6. Scheduling & Cadence System

The cadence system controls when clients are expected to submit check-ins.

### Config Format
```typescript
type CadenceConfig = {
  type: "weekly_days" | "every_n_days" | "specific_dates";
  days?: number[];          // 0=Sun..6=Sat (for weekly_days)
  intervalDays?: number;    // (for every_n_days)
  dates?: string[];         // "YYYY-MM-DD" list (for specific_dates)
};
```

### Priority Chain (highest to lowest)
1. `CoachClient.cadenceConfig` — per-client override
2. `User (coach).cadenceConfig` — coach default
3. `User (coach).checkInDaysOfWeek Int[]` — legacy fallback

### Key Library: `lib/scheduling/cadence.ts`
- `parseCadenceConfig()` — parses and validates JSON config
- `getEffectiveCadence()` — resolves the priority chain
- `getClientCadenceStatus()` — returns `"ok" | "due" | "overdue"` + human label
- `getCadencePreview()` — returns display string like "Every Monday"
- `cadenceFromLegacyDays()` — converts `Int[]` to `CadenceConfig`

---

## 7. Server Actions (app/actions/)

All mutations happen exclusively through Server Actions. Key actions:

| File | Responsibilities |
|---|---|
| `check-in.ts` | Submit, update, delete check-ins; mark as reviewed |
| `meal-plans.ts` | Create, update, publish, delete meal plans; copy/paste |
| `training-programs.ts` | Create, update, publish training programs |
| `exercise-results.ts` | Save per-set workout logs |
| `messages.ts` | Send coach/client messages |
| `coaching-requests.ts` | Submit lead form, accept/decline requests, send invites |
| `client-invites.ts` | Create/accept invitation tokens |
| `marketplace.ts` | Update coach profile, publish/unpublish |
| `adherence.ts` | Toggle exercise completion, log daily adherence |
| `notification-preferences.ts` | Update email/SMS preferences |
| `testimonials.ts` | Submit, update, delete testimonials |
| `onboarding-forms.ts` | Create/update coach onboarding questionnaire |
| `client-intake.ts` | Create/update client intake questionnaire answers |
| `roles.ts` | Switch active role (coach ↔ client) |
| `profile-photo.ts` | Upload/delete profile photo via Supabase |

---

## 8. API Routes (app/api/)

| Route | Purpose |
|---|---|
| `POST /api/webhooks/clerk` | Sync Clerk user events to DB (create/update/delete) |
| `GET/POST /api/cron/checkin-reminders` | Daily cron at 7PM UTC — sends check-in reminder emails/SMS |
| `POST /api/mealplans/upload-url` | Presigned URL for meal plan PDF/image upload |
| `POST /api/mealplans/parse` | OCR + LLM parse uploaded meal plan |
| `POST /api/mealplans/draft` | Save parsed draft |
| `POST /api/workout-import/upload-url` | Presigned URL for workout plan upload |
| `POST /api/workout-import/parse` | Parse workout plan text into structured JSON |
| `POST /api/workout-import/draft` | Save workout import draft |
| `POST /api/workout-import/import` | Import draft into TrainingProgram |
| `GET/PUT /api/training-programs/[programId]/export` | Export training program data |
| `POST /api/profile-photo` | Upload profile photo |
| `POST /api/portfolio-media` | Upload portfolio photos for coach marketplace |
| `POST /api/testimonial-image-upload` | Upload testimonial images |
| `POST /api/checkins/[checkInId]/photos` | Upload check-in progress photos |
| `GET /api/clients/[clientId]/weight-history` | Weight chart data for coach view |

---

## 9. Storage (Supabase)

### Buckets
| Bucket | Contents |
|---|---|
| `check-in-photos` | Client check-in progress photos |
| `meal-plan-uploads` | Coach-uploaded meal plan PDFs/images (also used for workout imports) |
| `profile-photos` | User profile avatars |
| `portfolio-media` | Coach marketplace portfolio images |
| `testimonial-images` | Client testimonial photos |

### Path Convention
- Profile photos: `{userId}/avatar.{ext}`
- Check-in photos: `{checkInId}/{timestamp}.{ext}`
- Signed URLs (short-lived) used for display — never store public URLs in DB, store paths

---

## 10. Key Design Patterns

### Database Access
```typescript
// ALWAYS use explicit select when fetching CoachClient to avoid PrismaPg array issues
const coachClient = await db.coachClient.findFirst({
  where: { clientId: user.id },
  select: { id: true, coachId: true, cadenceConfig: true }, // explicit, never include *
});

// Prisma client singleton — import db from "@/lib/db"
// Client is generated at app/generated/prisma/ not node_modules
import { db } from "@/lib/db";
```

### Date Handling
- `weekOf` is always **Monday UTC midnight** — use `normalizeToMonday(date)` from `lib/utils/date`
- `localDate` is a `"YYYY-MM-DD"` string in the client's local timezone
- Never rely on JS `new Date()` for timezone-aware logic — use `dayjs` with timezone plugin

### Image Components
- Always provide `width` and `height` to `next/image` for static images
- Check-in and portfolio photos use `fill` with a positioned parent container

### Auth Pattern
```typescript
// Every protected page:
const user = await getCurrentDbUser(); // throws if not authed
if (user.activeRole !== "CLIENT") redirect("/coach/dashboard");
```

### Permanent Dark Mode
- `ThemeProvider` always returns `{ theme: "dark", toggleTheme: () => {} }`
- `html` element always has `class="dark"`
- No light mode support — don't add theme conditionals

### Mobile Readability
- `html { font-size: 112.5% }` on screens ≤ 640px (bumps rem scale to ~18px base)
- Minimum `text-xs` for all labels — no `text-[10px]` or `text-[11px]` hardcoded px classes allowed
- Inputs must use `font-size: max(1rem, 16px)` to prevent iOS auto-zoom

---

## 11. Multi-Set Workout Logging

When clients log workout sets, each set is a separate `ExerciseResult` row:

```
Exercise: "Incline Press", Sets: 3
→ DB rows:
  "Incline Press [Set 1]", weight: 185, reps: 6
  "Incline Press [Set 2]", weight: 185, reps: 5
  "Incline Press [Set 3]", weight: 180, reps: 6
```

- Set count is parsed from the plan text: `parseSetCount(details)` in `training-program.tsx`
- Regex handles variants: `"3 sets"`, `"2 working sets"`, `"4 warmup sets"`
- Single-set exercises use no suffix for backwards compat with old data
- `ExerciseProgressInput` component manages per-set state and auto-saves on blur

---

## 12. Coach Inbox & Client Management

### Client List (`/coach/dashboard`)
- Clients displayed as draggable cards
- `CoachClient.sortOrder` persists drag order
- Whole card is the drag target (no separate grip handle)
- Drop indicator: glowing blue gradient line between cards

### Check-in Review Flow
1. Coach sees pending check-ins in their inbox
2. Opens `CheckInSummary` component with metrics, photos, custom responses
3. Photos open in `PhotoLightbox` (full-screen with swipe/keyboard nav)
4. Coach marks as reviewed → `status: REVIEWED` on `CheckIn`
5. Coach messages client via weekly thread (scoped by `clientId + weekOf`)

---

## 13. Marketplace (Public Discovery)

- `/coaches` — public directory, no auth required
- `/coaches/[slug]` — individual coach profile
- Only published profiles (`CoachProfile.isPublished = true`) are discoverable
- Testimonials shown only if they have `reviewText` (text body) OR `images` — star-only ratings excluded
- `RequestForm` on profile page sends lead with phone number (not email)
- Prospect data lands in `CoachingRequest` table, visible in `/coach/leads/`

---

## 14. Notification System

### Email (via Resend)
- Coach notifications: new check-in, new message, new lead, meal plan interest
- Client notifications: check-in reminder, meal plan published
- All email preferences per-user, togglable in settings

### SMS (via Twilio)
- Opt-in only (`smsOptIn: true` required)
- Granular per-type preferences (12 types)
- Client: check-in reminders, coach messages, check-in feedback
- Coach: new client check-ins, missed check-in alerts, new client signups, client messages
- Daily cron (`/api/cron/checkin-reminders`) runs at 7PM UTC; two more crons registered as of T-503 (see `ARCHITECTURE.md` §Cron Jobs) — no longer Hobby's once/day limit

---

## 15. Known Gotchas & Constraints

1. **Vercel plan**: Hobby (1 cron/day minimum cadence). All three crons are daily: `0 19 * * *` (checkin-reminders), `5 4 * * *` (ai-coach-executor), `0 4 * * *` (purge-deleted-accounts) — see `ARCHITECTURE.md` §Cron Jobs
2. **Prisma adapter**: `@prisma/adapter-pg` with `Int[]` / `Json?` fields can cause P2022 in Turbopack dev. Always use explicit `select` on `CoachClient` and `User` queries that might fetch array columns
3. **Schema drift**: After editing `schema.prisma`, always run `npx prisma migrate dev` (not `db push`) to create a migration file for the production DB
4. **Prisma client location**: Generated at `app/generated/prisma/` — after schema changes, run `npx prisma generate` and restart dev server
5. **Check-in `weekOf`**: Must always be Monday UTC. Use `normalizeToMonday()` before any `weekOf` lookup or create
6. **Messages are week-scoped**: `Message.weekOf` links messages to a week's check-in thread. Not a global chat — queried by `(clientId, weekOf)`
7. **No global state / context providers** except `ThemeProvider`. All data is server-rendered and passed as props
8. **Role switches**: A user can be both coach and client. `user.activeRole` is the current view. Always check both `isCoach` and `isClient` flags for capability checks, not just `activeRole`
9. **`db` is a Proxy**: The `db` export from `lib/db.ts` is a lazy Proxy — the actual PrismaClient initializes on first property access, not on import

---

## 16. Adding New Features — Checklist

Before implementing any new feature:
- [ ] Check if the relevant data model already exists in `prisma/schema.prisma`
- [ ] If adding a new model or field, create a migration: `npx prisma migrate dev --name describe-change`
- [ ] Add server action in `app/actions/` with Zod validation
- [ ] Add query function in `lib/queries/` (keep reads separate from actions)
- [ ] Coach-facing routes go in `app/coach/`, client-facing in `app/client/`
- [ ] Use `getCurrentDbUser()` at the top of every protected server component
- [ ] Never expose raw DB objects to client components — extract only the fields needed
- [ ] Always use `revalidatePath()` in server actions after mutations
- [ ] If touching `CoachClient`, use explicit `select` (not `include` without select)
- [ ] All new text labels on mobile must use at minimum `text-xs` (no hardcoded `text-[10px]`)
