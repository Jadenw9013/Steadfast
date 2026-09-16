# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Design System
This project uses the ui-ux-pro-max skill (installed at `.claude/skills/ui-ux-pro-max/`).
Before ANY UI changes:
1. Check `design-system/steadfast/pages/[page-name].md` if it exists
2. Fall back to `design-system/steadfast/MASTER.md`
Page overrides take priority over MASTER.

`design-system/steadfast/MASTER.md` is the single source of truth (an earlier duplicate at `docs/design-system/MASTER.md` was removed — nothing referenced it and it had drifted). The design system is the source of truth for colors, spacing,
typography, component patterns, and page-specific layout rules.
Never deviate from it without explicit instruction. Page overrides must describe this app's actual pages — `intake.md` and `client-dashboard.md` previously contained unrelated auto-generated marketing/lead-gen page content and have been corrected.

## AI Coach

The 14-document AI Coach company review and implementation pack lives at `docs/ai-coach/` (`00-Start-Here.md` reading order). It is the authoritative feature brief for the AI coaching product — read it before touching `lib/ai-coach/`, `lib/coaching/`, or any `/client/ai-coach/*` route. It supersedes any older `Steadfast-AI-Coach-*.md` plans. `design-system/steadfast/pages/ai-coach.md` holds the AI Coach route/page design overrides; the existing "hide macros" rule in the human coaching view does not apply to AI macro mode, which must show its targets.

**Before doing any AI Coach work, read `docs/ai-coach/14-Handoff-Status.md` first.** It's a living status snapshot (not part of the original 00-13 pack) recording the latest built/verified work across web and iOS, historical checkpoints, unfinished release gates, and the standing conventions/gotchas to keep following. The current V01–V20 evidence matrix is `docs/ai-coach/evidence/2026-09-14-engineering-release-status.md`; synthetic test passes are not live clinical or App Store approval. Update it whenever a slice lands or the plan changes.

## Skills Available
- **steadfast-patterns** — READ THIS for every Steadfast task (imports, auth, CoachClient, server actions, styling rules)
- **ui-ux-pro-max** — design intelligence, auto-activates for UI work
- **nextjs16-skills** — Next.js 16 App Router patterns and facts
- **prisma7-skills** — Prisma 7 breaking changes and migration patterns
- **clerk-nextjs-skills** — Clerk auth for Next.js 16 (proxy.ts, session claims)
- **skill-security-auditor** — run before shipping auth/billing code
- **context7 MCP** — live library docs (use before version-specific APIs)
- **playwright MCP** — E2E browser testing

## When to use each skill
- Any Steadfast code → **steadfast-patterns** (always)
- UI work → **ui-ux-pro-max** auto-activates + read MASTER.md
- Next.js specific → **nextjs16-skills**
- Prisma migrations or schema changes → **prisma7-skills**
- Clerk / auth changes → **clerk-nextjs-skills**
- Before billing/auth launch → **skill-security-auditor**
- Unknown library API → **context7 MCP**

## Documentation
Use Context7 MCP to look up live documentation for Next.js, Prisma,
Tailwind CSS v4, and Clerk before implementing features that use
these libraries. Do not rely on training data for version-specific APIs.

## Testing
Playwright MCP is available for browser testing.
E2E tests live in tests/e2e/
Run: npx playwright test

## Constraints (always apply)
- Permanent dark mode — never add light mode conditionals
- Prisma client imports from @/app/generated/prisma/client
- Use explicit select on CoachClient queries (never include without select)
- pnpm for package management (not npm or yarn)
- Do not use prisma db push — always use prisma migrate dev
- font-size: max(1rem, 16px) on all inputs
- Minimum 48px tap targets

## Project Overview

Cross-platform web + PWA coaching platform (MVP). Clients submit weekly check-ins (metrics + photos); coaches review via an inbox, leave feedback, and publish updated macro targets + meal plans versioned by week.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript + React 19
- **Auth:** Clerk v6 (coach/client roles via `publicMetadata`, JWT session claims)
- **DB:** Postgres (Neon) + Prisma v7 + `@prisma/adapter-pg` (output: `app/generated/prisma`)
- **Storage:** Supabase Storage (private bucket, server-signed URLs)
- **Styling:** Tailwind CSS v4 (via `@tailwindcss/postcss` plugin)
- **Forms:** React Hook Form + Zod v4
- **Deploy:** Vercel

## Commands

```bash
pnpm dev                 # Start dev server (http://localhost:3000)
pnpm build               # Production build (Turbopack)
pnpm lint                # Run ESLint
pnpm exec prisma studio  # Visual DB browser
pnpm exec prisma db seed # Seed coach-client relationships
pnpm test                # Vitest unit + smoke tests (tests/unit/, tests/smoke/)
pnpm exec playwright test # Playwright end-to-end tests (tests/e2e/)
```

pnpm is the only supported package manager (`package.json` pins it via `packageManager`). Never run `npm install`, `npm run *`, or `yarn *` in this repo — a stray `npm install` previously committed a `package-lock.json` alongside `pnpm-lock.yaml`; that file is now gitignored and must not return.

Vitest (25+ unit-test files under `tests/unit/`, a smoke suite under `tests/smoke/`) and two Postgres-backed integration tests under `tests/integration/` (opt-in via `SECURITY_INTEGRATION=1`, require an isolated local database) are already configured — do not claim no test runner exists. Playwright is configured for `tests/e2e/` but currently has minimal coverage (unauthenticated smoke checks only); it is not a substitute for the missing unit/integration coverage on a change.

### Schema change workflow

Migration files under `prisma/migrations/` plus the migration ledger (`_prisma_migrations` table) are the release source of truth. Do not use `prisma db push` or hand-run ad-hoc SQL against a real environment as the normal workflow.

`prisma migrate dev` needs a working shadow database and has known issues against this project's Neon setup — prefer the diff workflow below for schema changes made against this codebase:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate migration SQL from a live DB diff (avoids the Neon shadow-DB issue):
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# 3. Review the generated SQL, then create prisma/migrations/<timestamp>_<name>/migration.sql with it
# 4. Apply against an isolated dev/test datasource first, then the target environment:
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

`prisma migrate dev` remains fine for a fresh local database with no Neon shadow-DB constraint (e.g. a disposable local Postgres used only for `SECURITY_INTEGRATION=1` tests). Never run migration commands against a real/production datasource outside the recorded deployment workflow, and never guess or backfill ambiguous data as part of a migration — see `docs/ai-coach/04-Architecture-and-Data.md` §7 for the backfill/consent constraints that apply to the AI Coach work specifically.

## Architecture

### Routing & Auth

- **Auth middleware:** `proxy.ts` at project root (Next.js 16 convention, replaces `middleware.ts`). Uses `clerkMiddleware()` — protects all routes except `/`, `/sign-in`, `/sign-up`, `/api/webhooks`.
- **Role gating:** Not in middleware. Each route's Server Component calls `getCurrentDbUser()` and checks `activeRole`. Coach layout redirects non-coaches to `/client`; client pages verify client role.
- **Roles:** Clerk `publicMetadata.role` synced via webhook → DB `User.activeRole`. Users can have both `isCoach` + `isClient` flags and switch via `setActiveRole()` action.
- **Path alias:** `@/*` maps to the project root.

### Data Layer

- **Prisma config:** `prisma.config.ts` loads `.env.local` via dotenv. Schema at `prisma/schema.prisma`, generated client at `app/generated/prisma/`. Import `PrismaClient` from `@/app/generated/prisma/client` and enums from `@/app/generated/prisma/enums`.
- **DB singleton:** `lib/db.ts` — PrismaClient with PrismaPg adapter. Single instance cached on `globalThis` in dev.
- **Query functions:** `lib/queries/` — server-only data fetching, called from Server Components. Each returns typed Prisma results.
- **Server Actions:** `app/actions/` — mutations with Zod validation. All actions verify auth + role + relationship ownership before mutating.
- **Authorization pattern:** Coach endpoints call `verifyCoachAccessToClient(clientId)` which checks `CoachClient` assignment table. Throws if unauthorized.

### Week-based data model

All data is scoped by `weekOf` (DateTime), canonicalized to Monday midnight UTC via `normalizeToMonday()` in `lib/utils/date.ts`. Check-ins, macros, meal plans, and messages are all keyed by `(clientId, weekOf)`.

### Key data flows

**Check-in submission:** Client form → `createSignedUploadUrls()` → browser uploads photos directly to Supabase → `createCheckIn()` server action creates CheckIn + CheckInPhoto records.

**Coach review workspace** (`/coach/clients/[clientId]/review/[weekStartDate]`): Server Component fetches check-in, macros, draft/published meal plans, messages, and food library in parallel. Renders 2-column layout — left: check-in summary + macro editor + messages; right: meal plan editor.

**Meal plan editor (V2):** `MealPlanEditorV2` owns state as `MealGroup[]` (grouped by meal name). On save, `flattenMeals()` converts back to flat items array for the existing `saveDraftMealPlan` action. Macros are coach-only (toggle hidden by default). The action itself holds no lifecycle logic: `lib/meal-plans/drafts.ts` is the single source of truth for draft create/save/fork and `lib/meal-plans/publish.ts` for the DRAFT→PUBLISHED transition, both shared verbatim with the iOS-facing REST routes under `app/api/coach/clients/[clientId]/meal-plan/` — put changes there, never in one transport. Caveat: the OCR import path at `app/api/mealplans/import-plan/` is a known third `MealPlan` writer that bypasses both services (tracked as T-730), so grep for other writers before assuming a lifecycle change is complete.

**Client view:** `SimpleMealPlan` shows food + portions only — no macros, no version numbers, no draft/published status.

### Component organization

- `components/coach/inbox/` — dashboard inbox (filter bar + client cards)
- `components/coach/meal-plan/` — V2 meal plan editor tree (editor → meal cards → food rows → portion editor, food search dropdown)
- `components/coach/review/` — check-in summary for review workspace
- `components/client/` — client-facing components (simple meal plan, connect coach banner)
- `components/messages/` — chat thread (used by both roles)
- `components/check-in/` — check-in form + photo upload
- `components/ui/` — shared nav bar, role switcher

### Supabase Storage

Photos uploaded via server-signed URLs (1hr TTL). Service-role key stays server-side only (`lib/supabase/server.ts`). Download URLs generated server-side on demand with 1hr TTL. Image domains configured in `next.config.ts` for Next.js Image optimization.

### Webhook

`/api/webhooks/clerk` syncs Clerk users to the DB using `verifyWebhook` from `@clerk/nextjs/webhooks` (requires `NextRequest`). Must remain a public route.

## Security Rules

- NEVER hardcode secrets. Use environment variables only.
- Do not print or log secret env vars.
- Supabase service role key: server-side only (Server Components, Route Handlers, Server Actions).
- All coach endpoints verify the CoachClient assignment before exposing client data.
- Photo uploads use signed URLs — the service key never reaches the browser.

## AI Orchestration (Ruflo / Claude Flow)

Ruflo v3.5.14 is configured for this repo via `.claude/` and `.claude-flow/`.

### Available specialist agents (use with `@` mentions)

| Agent | Role |
|-------|------|
| `@backend-dev` | Server actions, Prisma, API routes, auth patterns |
| `@frontend-dev` | Next.js UI, Tailwind, React Hook Form, component patterns |
| `@security-qa` | Auth audit, secret scan, injection checks, release gate |
| `@product-lead` | Feature scoping, user flow decisions |
| `@product-designer` | UX critique, accessibility, mobile-first layout |
| `@release-manager` | Build, lint, release-check, deploy readiness |

### MCP server

The Ruflo MCP server is wired in `.mcp.json`. Start it with:

```bash
claude-flow mcp start    # starts MCP server on port 3001
```

Claude Code will auto-connect via the project `.mcp.json` when you open this repo.

### Swarm orchestration

```bash
claude-flow swarm init                    # initialize swarm
claude-flow swarm start --topology mesh   # start mesh swarm (up to 5 agents)
claude-flow memory init                   # initialize shared memory store
claude-flow daemon start                  # background workers
```

### Skills

8 built-in skills in `.claude/skills/`:
`hooks-automation`, `pair-programming`, `skill-builder`, `sparc-methodology`,
`stream-chain`, `swarm-advanced`, `swarm-orchestration`, `verification-quality`

### Config files

| File | Purpose |
|------|---------|
| `.claude/settings.json` | Hooks, permissions, model prefs, agent team config |
| `.claude/agents/*.md` | Specialist agent definitions |
| `.claude/commands/*.md` | Slash command definitions |
| `.claude-flow/config.yaml` | Swarm/memory/MCP runtime config |
| `.mcp.json` | MCP server connection (project-scoped) |

> `.claude-flow/data/`, `logs/`, `sessions/` are gitignored (runtime only).
> `.claude/settings.local.json` is gitignored (per-user overrides).

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
