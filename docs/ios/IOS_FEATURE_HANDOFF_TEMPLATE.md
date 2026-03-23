# IOS_FEATURE_HANDOFF_TEMPLATE.md
> Steadfast iOS — Reusable Feature Handoff Template
> Copy this template for every new feature handoff. Fill all sections.

---

## [FEATURE NAME]

> **One-line summary:** What this feature does and why it matters.

---

## Goal

Describe the user-facing outcome. Be specific.

Example: "Allow clients to submit their weekly check-in from the iOS app with weight, photos, and compliance scores."

---

## User Role(s)

- [ ] Client
- [ ] Coach
- [ ] Both

---

## Business Importance

Why does this exist? What breaks if it's missing?

Example: "Check-in submission is the core weekly ritual. Without it, coaches can't track progress and the platform has no value."

---

## Existing Backend / Data Model

List the relevant Prisma models and their key fields.

```
Model: CheckIn
  - id: String (cuid)
  - clientId: String → User.id
  - weekOf: DateTime (period start, UTC)
  - weight: Float?
  - bodyFatPct: Float?
  - dietCompliance: Int? (1-10)
  - energyLevel: Int? (1-10)
  - notes: String? (Text)
  - status: CheckInStatus (SUBMITTED | REVIEWED)
  - templateId: String? → CheckInTemplate.id
  - templateSnapshot: Json? (frozen copy of questions at submit time)
  - customResponses: Json? (answers to custom questions)
  - photos: CheckInPhoto[]
  - periodStartDate: String ("YYYY-MM-DD")
  - periodEndDate: String ("YYYY-MM-DD")
  - timezone: String
```

Also list related models, enums, and foreign key constraints.

---

## Existing Web Behavior

Describe exactly what the web does. Reference specific files if known.

Example:
- **Route:** `/client/check-in`
- **Component:** `app/check-in/page.tsx` (or equivalent)
- **Server Action:** `app/actions/check-in.ts` → `submitCheckIn()`
- **Behavior:**
  1. Client opens check-in page; existing check-in for this period is fetched
  2. Fields pre-filled if a check-in exists (update flow)
  3. On submit: upserts `CheckIn` record, creates `CheckInPhoto` records, triggers notification
  4. Confirmation shown inline, client returns to dashboard

```
Confirmed behavior: ✓
Inferred: [ ] List any assumptions made above
```

---

## iOS Target Experience

Describe what the native experience should feel like.

Example:
- Full-screen form with sections: Weight → Body Metrics → Compliance → Photos → Notes → Custom Questions
- Bottom-pinned "Submit Check-In" button (blue, 56pt height)
- Photo picker: camera or photo library, up to [N] photos
- Submission triggers haptic feedback + success animation
- After submission: navigate back to ClientHome with updated status

---

## Must-Match Behavior

List behaviors that **must be identical** to web, no exceptions.

1. Weight is optional (Float, can be null)
2. `dietCompliance` and `energyLevel` are integers 1–10
3. `templateSnapshot` is stored at submit time (frozen copy of template questions)
4. Update allowed if this period's check-in already exists (SUBMITTED status)
5. Cannot update if check-in is already REVIEWED
6. `periodStartDate` and `periodEndDate` must use server-computed values, not device dates

---

## Allowed Native Adaptations

List what can differ from web.

1. Layout: vertical form sections instead of web's page-width form
2. Photo capture: camera integration is better on native — support direct camera capture
3. Scale inputs (1–10): segmented picker or custom slider instead of web's dropdown/steppers
4. Haptic feedback on successful submission
5. Offline draft: optionally cache form data locally for resume (web doesn't support this)

---

## API / Backend Contracts

> ⚠️ Web uses Next.js Server Actions — these are **not callable** from native clients. iOS needs dedicated API endpoints.

### Endpoints needed:

```
GET  /api/checkins/current?clientId={id}
     → Returns: current period check-in if exists, or null + period dates

POST /api/checkins
     Body: { clientId, weekOf, weight?, bodyFatPct?, dietCompliance?, energyLevel?, notes?, customResponses? }
     → Returns: { checkIn: CheckIn }

PUT  /api/checkins/{id}
     Body: same fields (partial update)
     → Returns: { checkIn: CheckIn }

POST /api/checkins/{id}/photos
     Body: multipart/form-data with image files
     → Returns: { photos: CheckInPhoto[] }
```

Auth: Bearer token (Clerk JWT) — every endpoint validates coach/client identity server-side.

---

## Validation Rules

List all validation rules enforced server-side.

| Field | Rule |
|-------|------|
| `weight` | Float, positive, optional |
| `bodyFatPct` | Float, 0–100, optional |
| `dietCompliance` | Int, 1–10, optional |
| `energyLevel` | Int, 1–10, optional |
| `notes` | String, max 10,000 chars |
| `weekOf` | Must match server-computed period start; not free-form |
| `clientId` | Must match authenticated user's ID (Clerk JWT sub) |
| Update allowed | Only if status === "SUBMITTED" |

---

## Permissions / Auth Rules

- Only the authenticated **client** can submit or update their own check-in
- **Coach** can view check-ins for their clients only
- **Coach** can mark a check-in as REVIEWED only
- `verifyCoachAccessToClient(clientId)` must be called server-side on all coach operations

---

## Edge Cases

List known edge cases that must be handled.

1. **Multiple submissions in same period:** Upsert, not insert — use `periodStartDate` as deduplication key
2. **Check-in period spans midnight in client timezone:** Use `timezone` field from User; all dates are timezone-aware
3. **Template deleted after submission:** `templateSnapshot` preserves the question text — never join back to deleted template
4. **Photo upload fails mid-submission:** Check-in is saved without photos; photos can be added afterward
5. **Coach changes cadence mid-week:** Does not affect current in-progress period; only affects next period
6. **No template assigned:** Submit check-in with only standard fields (weight, compliance, etc.)
7. **Already reviewed:** Show read-only view with coach review note

---

## Loading / Empty / Error / Success States

| State | Display |
|-------|---------|
| Loading form data | Skeleton placeholders for all fields |
| No coach / no intake period | Explain why check-in is unavailable |
| Success | Inline confirmation animation → auto-navigate to home after 1.5s |
| Error (server) | Red banner with error message + retry |
| Already reviewed | Read-only view with "Reviewed by your coach" notice |
| Submit in progress | Button turns to spinner; form disabled |

---

## Analytics / Events

> Needs confirmation: No analytics system found in current codebase (no Segment, Amplitude, etc.)

Add these events if analytics is added:
- `checkin_started` — when form opens
- `checkin_submitted` — on success
- `checkin_updated` — on update of existing
- `photo_added` — when photo is attached

---

## Acceptance Criteria

- [ ] Client can open check-in form from the iOS app
- [ ] All standard fields (weight, diet, energy, notes) save correctly
- [ ] Custom template questions render and save correctly
- [ ] Photo upload stores images in correct Supabase bucket and creates `CheckInPhoto` records
- [ ] Updating an existing SUBMITTED check-in works (upsert)
- [ ] REVIEWED check-ins are read-only
- [ ] Client timezone is respected for period calculation
- [ ] Submission triggers appropriate server-side notification (email/SMS) to coach
- [ ] Success state is shown after submit
- [ ] Network error shows recoverable error state

---

## Files Likely Affected (iOS — new)

```
iOS/Features/CheckIn/
  CheckInFormView.swift
  CheckInFormViewModel.swift
  CheckInAPIService.swift
  Models/CheckIn.swift
  Models/CheckInPhoto.swift
  Components/ComplianceScalePicker.swift
  Components/CheckInPhotoRow.swift
```

---

## Open Questions / Needs Confirmation

- [ ] What is the maximum number of photos per check-in? (not found in web validation)
- [ ] Does iOS submission need to trigger real-time push notification to coach? (APNs not configured on web)
- [ ] Should iOS support offline draft (cache form before submit)?
- [ ] Are there file size limits on photo uploads?
- [ ] Does the iOS app need to support custom check-in templates that coaches create?

---

*Confidence: Confirmed from codebase: field types, status machine, validation, period logic. Inferred: exact photo count limit, exact API endpoint paths (need to be built).*
