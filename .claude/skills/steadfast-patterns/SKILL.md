---
name: steadfast-patterns
description: >
  Use this skill for ALL development on the Steadfast codebase.
  Contains Steadfast-specific patterns, constraints, and conventions
  that must be followed on every task. Read this before writing
  any code for Steadfast.
---

# Steadfast Patterns Skill

## Critical Import Rules
- Prisma client: ALWAYS from `@/app/generated/prisma/client`
  NEVER from `@prisma/client`
- DB singleton: `import { db } from "@/lib/db"`
- Auth: `import { getCurrentDbUser } from "@/lib/auth/roles"`

## Auth Pattern
Every protected server component must start with:
```ts
const user = await getCurrentDbUser()
if (user.activeRole !== "COACH") redirect("/client/dashboard")
```

## CoachClient Query Rule
ALWAYS use explicit `select` on CoachClient queries.
NEVER use `include` without `select` on CoachClient.
Reason: `Int[]` and `Json?` fields cause P2022 in Turbopack.

**Correct:**
```ts
const cc = await db.coachClient.findFirst({
  where: { clientId: user.id },
  select: { id: true, coachId: true, cadenceConfig: true }
})
```

**Wrong:**
```ts
const cc = await db.coachClient.findFirst({
  where: { clientId: user.id },
  include: { coach: true } // NEVER do this
})
```

## Server Action Pattern
Every server action must:
1. Have `"use server"` at top
2. Validate input with Zod before anything else
3. Call `getCurrentDbUser()` to verify auth
4. Check user role (`isCoach` / `isClient`)
5. Call `revalidatePath()` after any mutation
6. Return `{ success: true }` or `{ success: false, message: string }`
7. Never expose raw DB errors in return values

## Route Structure
- Coach routes: `app/coach/` — protected in `app/coach/layout.tsx`
- Client routes: `app/client/` — protected in `app/client/layout.tsx`
- Public routes: `app/coaches/`, `app/onboarding/`
- Server actions: ALL in `app/actions/`
- Read queries: ALL in `lib/queries/`

## Database Rules
- NEVER use `prisma db push` — always `prisma migrate dev`
- NEVER use `prisma migrate dev` on Neon in CI — use `db execute`
- After schema changes: `npx prisma generate` + restart dev server
- `weekOf` fields: ALWAYS Monday UTC midnight (use `normalizeToMonday`)

## Zod v4 + Prisma JSON Gotchas
- `z.record(z.unknown())` is INVALID in Zod v4 — use `z.record(z.string(), z.unknown())`
- Zod v4 `z.record()` inferred type includes `symbol` keys which Prisma `InputJsonValue` rejects
- Fix: `JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue` at the Prisma boundary
- Import `Prisma` namespace: `import type { Prisma } from "@/app/generated/prisma/client"`

## Styling Rules
- Dark mode only — `html` always has `class="dark"`; NEVER add `dark:` conditional classes
- Tailwind v4: `@import "tailwindcss"` syntax
- NEVER `@tailwind base/components/utilities` (v3 syntax)
- `font-size: max(1rem, 16px)` on ALL `<input>` and `<textarea>` (iOS zoom prevention)
- Minimum 48px tap targets, 56px primary mobile CTAs
- No emojis — SVG icons only (Heroicons / Lucide inline SVG)
- Design system is source of truth — read `design-system/steadfast/MASTER.md` before any UI work

## Package Manager
- `pnpm` ONLY — never `npm install` or `yarn add`
- Check `package.json` before adding any new dependency

## Release Gates (run before every completion)
```bash
pnpm run build
pnpm run lint
npx prisma validate  # if schema changed
```
