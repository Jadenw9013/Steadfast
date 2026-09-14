# Macro-Only Plans — Implementation Plan

Status: **planning only, nothing implemented yet.** Written 2026-09-13 so this conversation can be cleared and a fresh session can pick this up cold. Everything a future session needs — file paths, current line anchors, schema, sequencing — is below; no need to re-derive architecture from scratch.

## 1. Feature summary

Today every client gets a **meal plan**: a coach fills in real foods (name/quantity/unit/macros) grouped into named meals ("Meal 1", "Breakfast", etc.), versioned weekly, draft → publish. This is `MealPlan` + `MealPlanItem` in Prisma, edited via `MealPlanEditorV2` (web) / `PlanWorkspaceViewModel` (iOS), rendered to the client via `SimpleMealPlan` (web) / `MealPlanView` (iOS).

New ask: some clients don't want ingredient-level detail — they just want **macro targets per meal** ("Meal 1: 500 cal / 40p / 50c / 15f"), no foods listed. Requirements from the user:

1. Coach can optionally fill in per-meal macros manually, **or** autofill them via an LLM (new — reuses the existing OpenAI integration pattern).
2. Coach can switch a client between "meal plan" mode and "macro plan" mode.
3. Client sees whichever mode the coach set — foods, or just macros.
4. Low rigidity: existing meal-plan functionality must keep working exactly as-is. Nothing about this feature should be able to break the current path.
5. Both web and iOS need this (this app has a long-standing pattern of web Server Actions and iOS REST routes duplicating logic independently — see §9, this bit matters).

## 2. Key design decisions

**Mode is stored in two places, not one:**
- `CoachClient.planMode` — persistent, coach-set default for a client (mirrors the existing `CoachClient.adherenceEnabled` boolean toggle exactly — see `app/actions/adherence.ts:40-57`). This is what the coach's UI switch actually flips.
- `MealPlan.planMode` — snapshotted onto each week's plan at creation time from the `CoachClient` default. This means a historical published plan keeps rendering the way it was published even if the coach later flips the client's default forward. It also leaves room to override a single week later without more schema work, even though v1 UI won't expose that.

**New sibling model, not a repurposed `MealPlanItem`:** add `MealMacroTarget` (mealName + 4 macro numbers, no food/quantity/unit) as a new table hanging off `MealPlan`, separate from `MealPlanItem`. Rejected alternative: cramming macro-only rows into `MealPlanItem` with blank food names — that would silently break every existing assumption that `MealPlanItem.foodName` is a real food (food-library autocomplete, day-override food matching in `resolveForDay()`, CSV/export, purge routines, etc.). A sibling table is purely additive: existing `MealPlanItem` code paths are never touched, so existing functionality cannot regress. This directly satisfies requirement 4.

**Both `items` and `macroTargets` can coexist on the same `MealPlan` row.** Switching a client's mode is just a change in which one is *displayed/edited primarily* — no data is deleted when a coach flips the switch back and forth. This is the "low rigidity" property the user asked for: reversible, non-destructive mode switching.

**Why autofill needs an LLM call, not simple aggregation:** `MealPlanItem.calories/protein/carbs/fats` default to `0` (`prisma/schema.prisma:297-300`) and in practice many existing items have never had per-item macros filled in (imported/OCR'd plans especially). Summing existing item macros would often just produce zeroes. The LLM looks at the actual foods + portions text and estimates real numbers — same value-add as the existing AI plan editor, just a different, smaller output shape.

**Day overrides are explicitly out of scope for macro-mode v1.** `resolveForDay()` in `components/client/simple-meal-plan.tsx:100-268` operates on food items and has no macro-mode analog. Flag this as a known v1 limitation in the coach UI (e.g. small note: "Day overrides aren't supported in macro mode yet") rather than trying to design that now — keeps this feature shippable in a reasonable slice.

## 3. Data model changes (Prisma)

File: `Steadfast/prisma/schema.prisma`.

```prisma
enum PlanMode {
  MEAL_PLAN
  MACROS
}

model CoachClient {
  // ...existing fields...
  planMode PlanMode @default(MEAL_PLAN)
}

model MealPlan {
  // ...existing fields...
  planMode PlanMode @default(MEAL_PLAN)

  macroTargets MealMacroTarget[]
}

model MealMacroTarget {
  id         String   @id @default(cuid())
  mealPlanId String
  mealName   String
  sortOrder  Int      @default(0)
  calories   Int      @default(0)
  protein    Int      @default(0)
  carbs      Int      @default(0)
  fats       Int      @default(0)

  mealPlan MealPlan @relation(fields: [mealPlanId], references: [id], onDelete: Cascade)

  @@index([mealPlanId])
}
```

Purely additive: one new enum, two new columns with defaults (no backfill needed — every existing row gets `MEAL_PLAN`, which is exactly current behavior), one new table. Follow the project's documented migration workflow (`Steadfast/CLAUDE.md`, "Schema change workflow" section):

```bash
# after editing schema.prisma
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# hand-create prisma/migrations/<timestamp>_add_macro_plan_mode/migration.sql from that output
npx prisma migrate deploy   # or migrate dev locally if the shadow DB cooperates
npx prisma generate
```

Sanity check after migrating: `npx prisma migrate status` should report up to date, then `npm run type-check` and `npm test -- --reporter=dot` should still be 100% green with zero code changes yet — confirms the migration itself is safe before writing any feature code.

**Don't forget the account-deletion purge.** `lib/account-deletion/purge.ts:99-103` explicitly raw-deletes `MealPlanItem` before deleting `MealPlan`, even though the FK already cascades — that's the established defensive style in this file (see the `CheckInPhoto` comment a few lines up: "cascades from CheckIn, but delete explicitly"). Add the matching line for the new table, in the same spot, same style:

```ts
await tx.$executeRaw`DELETE FROM "MealMacroTarget" WHERE "mealPlanId" IN (SELECT "id" FROM "MealPlan" WHERE "clientId" = ${userId})`;
```

This is easy to forget because it's a one-line addition to a 247-line file that isn't otherwise part of this feature — but the 2026-09-09 security review spent an entire P1 finding on exactly this class of bug (purge missing a new table's rows), so treat this as non-negotiable before calling the feature done. Re-run `tests/integration/account-deletion.test.ts` after adding it.

## 4. Backend implementation (web repo: `/Users/jadenwong/Dev/Steadfast`)

### 4.1 New LLM autofill function

New file `lib/llm/estimate-meal-macros.ts`, modeled directly on `lib/llm/modify-meal-plan.ts` (same file reuses `OPENAI_API_KEY`/`OPENAI_MODEL`, same `fetch` call shape, same `response_format: { type: "json_object" }` pattern):

- Input: `{ meals: [{ name: string, items: [{ food: string, portion: string }] }] }` — same subset shape `modifyMealPlan` already accepts as `currentPlan.meals`, so the web/iOS callers can build this from data they already have.
- System prompt: a nutrition-estimation specialist; given named meals and their foods/portions, return **one integer calorie/protein/carb/fat estimate per meal**, same order as input, no commentary.
- Output schema (new zod schema, e.g. `estimatedMealMacrosSchema` in `lib/validations/meal-plan-import.ts` or a new small file next to it): `{ meals: [{ name: string, calories: number, protein: number, carbs: number, fats: number }] }`.
- Validate the LLM's JSON response with that schema before returning, exactly like `modifyMealPlan` does with `parsedMealPlanSchema.safeParse`.

New route `app/api/mealplans/estimate-macros/route.ts`, copied structurally from `app/api/mealplans/modify-plan/route.ts:1-70`:
- `getCurrentDbUser()` + `isCoach` check.
- `consumeQuota("ai-plan", user.id, 30, 600)` — reuse the same bucket the AI plan editor already uses (no separate quota bucket needed; it's the same coach hitting OpenAI either way).
- `readBoundedBody(req, 128 * 1024)` bound, same as the sibling route.
- `privacyConsent: z.literal(true)` required in the request body — same consent gate the AI plan editor already enforces, since this also sends a client's food/plan data to OpenAI. **No new privacy-policy disclosure needed** — OpenAI is already disclosed (`app/privacy/page.tsx`, iOS `LegalDocumentView.swift:202`) from the 2026-09-09 remediation.
- `export const maxDuration = 60;` like the sibling route.

### 4.2 Shared macro-target service (new — do this to avoid repeating the web/iOS duplication mistake)

**Read this before touching any route.** `app/api/coach/clients/[clientId]/meal-plan/route.ts` already has its own independent `db.mealPlan.*` calls (verified: `select`/`items` blocks at lines ~75, ~103, ~163, ~220, ~268, ~290 — separate from `app/actions/meal-plans.ts`'s `createDraftMealPlan`/`saveDraftMealPlan`). That's the exact "duplicated behavior between web Server Actions and iOS REST endpoints" problem the 2026-09-09 review called out as the whole codebase's #1 architectural risk (finding 1 in that review — account deletion existed on web but not iOS for months because of this same pattern). Don't add a *third* independent copy of macro-target CRUD logic.

Instead, add one new file `lib/meal-plans/macro-targets.ts` exporting plain functions that both surfaces call:

```ts
export const mealMacroTargetSchema = z.object({
  mealName: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  calories: z.coerce.number().int().min(0).default(0),
  protein: z.coerce.number().int().min(0).default(0),
  carbs: z.coerce.number().int().min(0).default(0),
  fats: z.coerce.number().int().min(0).default(0),
});

// call inside the same $transaction as the items replace-all, mirrors the
// delete-then-recreate pattern in saveDraftMealPlan (meal-plans.ts:130-161)
export function macroTargetTransactionOps(mealPlanId: string, targets: z.infer<typeof mealMacroTargetSchema>[]) {
  return [
    db.mealMacroTarget.deleteMany({ where: { mealPlanId } }),
    ...targets.map((t, i) => db.mealMacroTarget.create({ data: { mealPlanId, ...t, sortOrder: i } })),
  ];
}
```

Both `app/actions/meal-plans.ts` and `app/api/coach/clients/[clientId]/meal-plan/route.ts` import `mealMacroTargetSchema` for validation and splice `macroTargetTransactionOps(...)` into their existing `db.$transaction([...])` arrays. This keeps the new feature's logic in exactly one place while leaving each surface's *existing* item-handling code completely untouched.

### 4.3 Web Server Action changes — `app/actions/meal-plans.ts`

All changes are additive optional fields — existing callers that don't pass them are unaffected:

- `createDraftSchema` (line 25): add `macroTargets: z.array(mealMacroTargetSchema).max(50).optional()`, `planMode: z.enum(["MEAL_PLAN", "MACROS"]).optional()`.
- `createDraftMealPlan` (line 34): if `copyFromPublished`, also copy the published plan's `macroTargets` and `planMode` (mirror the existing item/extras copy-forward at lines 59-86). If `planMode` isn't explicitly passed, default it to the `CoachClient.planMode` current value (read via `verifyCoachAccessToClient`'s existing lookup, or one extra `db.coachClient.findUnique` — cheap, once per draft creation).
- `saveDraftSchema` (line 106) / `saveDraftMealPlan` (line 113): add `macroTargets: z.array(mealMacroTargetSchema).max(50).optional()`. Splice `macroTargetTransactionOps` into the existing `db.$transaction([...])` array (lines 130-161) alongside the existing item delete/recreate — same transaction, so a save can't leave items and macro targets inconsistent.
- `publishMealPlan`: no changes needed — publishing already just flips `status`/`publishedAt`, mode-agnostic.

### 4.4 iOS-facing REST routes — `app/api/coach/clients/[clientId]/meal-plan/route.ts` and `.../publish/route.ts`

Same additive changes as §4.3, applied to this file's independent schemas/handlers (its own `mealPlanItemSchema`-equivalent at line 163 and line 290, its own `select`/`items` blocks at lines ~75, ~103, ~220, ~268). Add `macroTargets` to every request schema and every `select`, using the same shared `mealMacroTargetSchema` and `macroTargetTransactionOps` from §4.2. **Do this file in the same PR/commit as §4.3, and write one test that exercises both** (see §7) — this is precisely the kind of "fixed on web, forgot iOS" gap that bit account deletion before.

### 4.5 Plan-mode toggle (new — needs both a Server Action and a REST route from day one)

New shared function in `lib/meal-plans/macro-targets.ts` (or a new `lib/coach-client/plan-mode.ts`, either is fine — keep it one function either surface can call):

```ts
export async function setClientPlanModeForCoach(coachId: string, clientId: string, mode: "MEAL_PLAN" | "MACROS") {
  await db.coachClient.update({
    where: { coachId_clientId: { coachId, clientId } },
    data: { planMode: mode },
  });
}
```

- Web Server Action: new `app/actions/plan-mode.ts`, modeled exactly on `setAdherenceEnabled` (`app/actions/adherence.ts:40-57`) — same `verifyCoachAccessToClient` call, same `revalidatePath("/coach/clients/${clientId}")` + `revalidatePath("/client")`.
- iOS REST route: new `app/api/coach/clients/[clientId]/plan-mode/route.ts`, `POST { mode: "MEAL_PLAN" | "MACROS" }`, same auth/ownership checks as the sibling meal-plan route, calls the same shared function.

This is the one new toggle in the whole feature — get it right by having exactly one implementation both surfaces call, from the start, rather than retrofitting later.

### 4.6 Query/fetch sites to update (add `planMode` + `macroTargets` alongside existing `items`)

Grep for `include: { items` and `items: {` across `app/` and `lib/queries/` at implementation time to get the current complete list (it will have shifted since this plan was written); as of this writing, the sites are:
- `app/api/coach/clients/[clientId]/meal-plan/route.ts` (3 select blocks, §4.4)
- `app/api/client/meal-plan/current/route.ts` (client-facing GET, iOS)
- `app/client/page.tsx` (server-rendered client dashboard, web) — the `mealPlan` fetch feeding `SimpleMealPlan`
- `app/coach/clients/[clientId]/check-ins/[checkInId]/page.tsx` (coach review workspace feeding `MealPlanEditorV2`)
- `app/actions/meal-plans.ts` (`createDraftMealPlan`'s copy-from-published include, line 63)

Add `planMode: true` to each `select`, and `macroTargets: { orderBy: { sortOrder: "asc" } }` alongside each existing `items: { orderBy: { sortOrder: "asc" } }`. Do this as its own small commit before touching any UI, then confirm nothing broke (`npm run type-check`, existing test suite) before writing new components against the new fields.

## 5. Web UI implementation

### 5.1 Coach: mode toggle

New component `components/coach/plan-mode-toggle.tsx`, modeled on `components/coach/adherence-card.tsx` + the toggle it wraps — **do not reuse or rename `components/coach/meal-plan/macro-toggle.tsx`**, that's an unrelated existing per-item "show macro numbers while editing" visibility toggle; naming this new one similarly (e.g. anything containing bare "MacroToggle") will be confusing. Call it `PlanModeToggle` / `PlanModeSwitch`.

Wire into `app/coach/clients/[clientId]/page.tsx` near where `AdherenceCard` currently renders (line ~409-412) — same page, same visual area, calls the new `setClientPlanMode` Server Action from §4.5 in a `useTransition`, same optimistic-toggle pattern as `AdherenceToggle`.

### 5.2 Coach: macro plan editor

New component `components/coach/meal-plan/macro-plan-editor.tsx`. Rendered by `MealPlanEditorV2` (`components/coach/meal-plan/meal-plan-editor-v2.tsx`) as an **alternate branch** at the top of the component, gated on `effectivePlan.planMode === "MACROS"` — the existing `MealGroup[]`-based editor (state at lines 50-63) stays completely untouched for `MEAL_PLAN` mode; this is a sibling render path, not a rewrite.

Responsibilities of the new component:
- Local state: `MacroMealGroup[] = { mealName: string, sortOrder: number, calories, protein, carbs, fats }[]` (add this type next to `MealGroup` in `types/meal-plan.ts`).
- Add/remove/rename/reorder meal rows (mirror the add/remove-meal UX already in `meal-card.tsx`/`meal-plan-editor-v2.tsx`, just without the food-row list underneath — 4 number inputs instead).
- **"Autofill with AI" button**: enabled only when the plan already has `items` from a previous meal-plan-mode session (i.e., there's something for the LLM to look at) — call the new `POST /api/mealplans/estimate-macros` (§4.1), passing `{ privacyConsent: true, meals: <current items grouped by mealName> }`, fill the returned numbers into the local macro rows for review/edit before saving. If there are no existing items, the button is hidden/disabled and the coach just types numbers — don't block manual entry on AI availability.
- Save/Publish reuse the existing `meal-plan-actions.tsx` buttons and the existing `saveDraftMealPlan`/`publishMealPlan` calls unchanged — just pass `macroTargets` instead of (or alongside) `items` in the save payload.

### 5.3 Client: macro plan view

New component `components/client/macro-plan-view.tsx`. Rendered by `SimpleMealPlan` (`components/client/simple-meal-plan.tsx`) as an alternate branch at the top of the component (near line 466 `export function SimpleMealPlan`), gated on `mealPlan.planMode === "MACROS"`.

- Simple list: meal name + 4 macro numbers per meal, styled consistent with the existing `MealMacroBar`/`MacroSummary` sub-components already in `simple-meal-plan.tsx` (lines 316-374) — reuse those visual patterns rather than inventing new ones.
- **Reuse `toggleMealCheckoff` unchanged** — it's already keyed by `(date, mealNameSnapshot, displayOrder)`, not by food content (`app/actions/adherence.ts:112-142`), so meal check-off works identically in macro mode with zero backend changes.
- No day-override rendering in this component (see §2 — explicit v1 scope cut).

## 6. iOS implementation (`/Users/jadenwong/Dev/ios-steadfast`)

### 6.1 Models

- `steadyfast/Models/MealPlan.swift`: add `enum PlanMode: String, Codable { case mealPlan = "MEAL_PLAN", case macros = "MACROS" }`; add `var planMode: PlanMode` to `MealPlan` (with matching `CodingKeys`/decoder update, lines 74-106); add new `struct MealMacroTarget: Codable, Identifiable { let id: String; let mealPlanId: String; var mealName: String; var sortOrder: Int; var calories, protein, carbs, fats: Int }` (sibling to `MealPlanItem` at line 110, no food/quantity/unit fields); add `var macroTargets: [MealMacroTarget]?` to `MealPlan`.
- `steadyfast/Models/CoachClient.swift`: add `var planMode: PlanMode` next to the existing `var adherenceEnabled: Bool` (line 9).
- `steadyfast/Features/Coach/Plans/PlanEditorModels.swift`: `EditableMealPlan` needs an equivalent macro-mode local representation — mirror whatever shape `EditableMealPlan` already uses for `items`/meals (check this file's current structure at implementation time; it wasn't fully read for this plan, budget time to read it first).

### 6.2 API service methods

`steadyfast/Services/SteadfastAPI.swift`: add methods mirroring the existing meal-plan save/publish calls (search for the methods that call `app/api/coach/clients/[clientId]/meal-plan` and `.../publish` — same file already has `adherenceEnabled: Bool?` decoded at line 139, so the `CoachClient` decode site is already located) — extend the request/response types for `macroTargets`/`planMode`, and add one new method `setClientPlanMode(clientId:mode:)` hitting the new `POST /api/coach/clients/[clientId]/plan-mode` route from §4.5.

`steadyfast/Services/SteadfastAPI+AIPlanEditor.swift`: add a sibling method `estimateMealMacros(meals:) async throws -> [MealMacroEstimate]` calling the new `POST /api/mealplans/estimate-macros` route, modeled directly on the existing `modifyMealPlan` method in this same file (same `privacyConsent` field always sent as `true`, same request/response `Encodable`/`Decodable` pattern as `AIPlanRequest`/`AIPlanResponse` at lines 76 and 117).

### 6.3 ViewModels

- `steadyfast/Features/Coach/Plans/PlanWorkspaceViewModel.swift`: extend `saveMealDraft()`/`publishMealPlan()` (lines 89, 124) to include `macroTargets` when `mealPlan.planMode == .macros`; add an `estimateMacros()` method calling the new API service method, filling results into the editable macro rows (mirror `applyAIModifiedPlan` at line 211 structurally).
- Coach client-detail view model (wherever `adherenceEnabled`'s toggle action lives — grep `steadyfast/Features/Coach/ClientDetail/ClientDetailViewModel.swift` and `Redesign/ClientDetailViewV2.swift` at implementation time, this plan didn't pin the exact call site): add a `setPlanMode(_:)` method calling `SteadfastAPI.setClientPlanMode`.

### 6.4 Views

- New `steadyfast/Features/Coach/Plans/MacroPlanEditorView.swift`, sibling to `MealPlanEditorView.swift`, gated on `mealPlan.planMode == .macros` at whatever call site currently picks the meal editor (likely in the plan workspace tab view — grep for where `MealPlanEditorView` is instantiated).
- New `steadyfast/Features/MealPlan/MacroPlanView.swift`, sibling to `MealPlanView.swift`, same gating on the client side.
- New toggle UI next to wherever the adherence toggle lives in the coach's client-detail screen (`ClientDetailViewV2.swift` — same file referenced in §6.3).

## 7. Testing & verification checklist (gate each phase before moving to the next)

Do NOT implement this whole feature in one pass and test at the end — the user explicitly asked to test logically along the way. Suggested gates:

1. **After the migration alone** (§3, no code changes yet): `npx prisma migrate status` clean, `npm run type-check` clean, `npm test -- --reporter=dot` still 360/360 (or whatever the current count is) with zero new failures. This proves the schema change alone is inert.
2. **After §4.2–4.6 (backend, both surfaces, same commit)**: write new tests before/alongside — `tests/unit/` for `mealMacroTargetSchema` validation and `macroTargetTransactionOps`, `tests/integration/` for: create draft with macroTargets → save → publish → fetch via both the Server Action path and the REST route path → assert both return the same `macroTargets`. Explicitly test that an *existing* meal-plan-only save/publish flow (no `macroTargets` passed at all) still round-trips identically — this is the regression test that proves requirement 4. Also add the `MealMacroTarget` cleanup line to `tests/integration/account-deletion.test.ts`'s assertions.
3. **After the AI autofill route (§4.1)**: unit test the zod schema on a few shaped-but-wrong LLM outputs (mirror however `modify-meal-plan.ts`'s validation failure path is tested, if it is). Manually verify the OpenAI round-trip once against a real plan (needs `OPENAI_API_KEY` — already configured in this project's env, unlike Stripe).
4. **After web UI (§5)**: manually run both flows in the browser — toggle a test client to macro mode, add macro rows, autofill, save, publish, view as that client; toggle back to meal-plan mode and confirm the original food items are still there untouched. This is the direct verification of the "reversible, non-destructive" design goal from §2.
5. **After iOS (§6)**: `xcodebuild ... build` (Release config, matches how the 2026-09-09 session validated iOS changes) then the full test target, then manually run both modes in the simulator against a local/dev backend pointed at by `Config.Debug.xcconfig`'s commented-out `localhost:3000` line.
6. **Cross-platform parity check** (do this explicitly, it's the whole point of §4.2/4.4's warning): create a macro-mode plan on web, confirm it renders correctly in the iOS simulator; create/edit one on iOS, confirm it renders correctly on web. This is the test that would have caught the original account-deletion gap months earlier if it had existed.

## 8. Suggested implementation order

1. Prisma migration only (§3) — commit, verify, done.
2. Shared macro-target service + both save/fetch surfaces updated together (§4.2–4.6) — commit, verify with integration tests (§7.2), done. *Don't* build any UI yet; this phase should be fully testable via API/action calls alone (existing test infra already calls Server Actions and can call REST routes directly).
3. Plan-mode toggle, both surfaces (§4.5) — small, self-contained, commit, verify.
4. AI autofill route (§4.1) — commit, verify.
5. Web UI (§5) — commit, manual + automated verify.
6. iOS UI (§6) — commit, manual + automated verify.
7. Cross-platform parity pass (§7.6).

Each numbered step above is small enough to be its own commit and its own "does anything break" checkpoint, per the user's request to test logically along the way rather than big-bang the whole feature.

## 9. Known risk called out explicitly (re-read this if resuming mid-implementation)

This codebase has one recurring failure mode, identified in the 2026-09-09 security review as its single biggest architectural risk: **web Server Actions and iOS REST routes independently duplicate the same business logic**, and fixes/features land on one side and get forgotten on the other (this is exactly how account deletion, message blocking, and deactivation enforcement all shipped broken on one platform for a while). This plan's §4.2 and §4.5 are structured specifically to avoid repeating that mistake for the new macro-target and plan-mode logic — by putting the actual logic in one shared function each surface calls, rather than writing it twice. When implementing, resist the urge to inline the logic directly into the route handler "just this once" — that's exactly how the existing duplication happened originally.

## 11. Implementation status — completed 2026-09-13

All phases (§8) shipped in this pass. Commits, in order:

- `Steadfast@49f98d1` — schema migration (§3), applied to the dev DB, verified inert (type-check + full suite green with zero code changes).
- `Steadfast@cde63b6` — shared macro-target service + both surfaces + plan-mode toggle + purge fix (§4.2–4.6, §4.5). New `tests/integration/macro-plan.test.ts` (6 tests) verified against a **real local Postgres instance** (`steadfast_security_test`, `SECURITY_INTEGRATION=1`) — the first time this project's `SECURITY_INTEGRATION` integration-test gate actually ran end-to-end; all 17 real-DB integration tests (the pre-existing 11 plus these 6) passed, confirming the existing account-deletion/purge logic works against real Postgres constraints too, not just mocks.
- `Steadfast@63d313d` — AI macro-estimate endpoint (§4.1).
- `Steadfast@457f10f` — web UI (§5): `PlanModeToggle`, `MacroPlanEditor`, `MacroPlanView`.
- `ios-steadfast@2cbb635` — iOS (§6): models, API service, `PlanWorkspaceViewModel` branching, `MacroPlanEditorView`, `MacroPlanView`, plan-mode segmented control.

**Verification performed:** web — type-check, ESLint (0 errors on touched files), production `next build`, full vitest suite (369 unit + 17 real-DB integration, all passing) at every phase gate. iOS — Release and Debug `xcodebuild` both succeed, full test suite passes (23/23 functional tests; one UI performance test failed once on a simulator infrastructure crash unrelated to this change, confirmed by re-running it in isolation where it passed cleanly).

**Not verified:** actual visual appearance in a running browser or simulator with a live signed-in session. No browser-automation tool was available in this session, and exercising the iOS simulator with real Clerk auth wasn't attempted. The design was built by close pattern-matching against each platform's existing visual language (`sf-glass-card`/`sfSurfaceCard`/`planSurfaceCard`, existing color palette, existing spacing/typography scales) rather than by eyeballing a live render — **do a manual pass in both a browser and the simulator before shipping**, specifically: toggling mode back and forth with real data, the autofill flow end-to-end (needs a real `OPENAI_API_KEY`, which this project already has configured), and mobile viewport widths for the coach macro editor's 2x2 input grid.

**One live surface deliberately left untouched, with reasoning recorded:** `NutritionTabView.swift` (iOS) renders a `MacroRow`/`MealPlan` combination that looks relevant to this feature, but its data source (`ClientHomeViewModel.mealPlan`) is a permanent `nil` stub — traced and confirmed dead code from an earlier "Ultrahuman redesign" attempt, not a reachable screen. Left as-is rather than wiring macro-mode support into inert code.

**Nothing pushed to any remote.** All commits are local, matching this session's default of not pushing without being asked.

## 10. Open questions (not blocking, but worth a product decision before or during implementation)

- Should the "Autofill with AI" button be available on a *brand-new* macro-mode plan with no prior food items at all, by asking the coach to briefly describe the meal (e.g. free-text "chicken and rice lunch") instead of structured items? Out of scope for v1 per this plan (autofill only works from existing item data) — flag to the user if they want that broader capability.
- Should macro-mode plans support per-day variation at all eventually (the meal-plan-mode day-override system)? Explicitly deferred (§2) — no schema decision made either way, `MealMacroTarget` doesn't preclude adding day-scoping later if needed.
- Exact default meal names/count when a coach creates a fresh macro-mode plan with nothing to copy from (probably mirror whatever default meal-plan-mode uses, if it has one — not verified in this research pass).
