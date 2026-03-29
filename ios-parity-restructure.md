# Steadfast Web → iOS Parity: Navigation & Page Restructure

## Goal
Restructure the web app's navigation and page layout to match the iOS app's tab structure and navigation flow. **Colors only** — no backend changes. The backend API routes (`/app/api/*`), server actions (`/app/actions/*`), lib utilities, and database schema remain untouched.

---

## Current Web vs iOS — Gap Analysis

### Client Side

| iOS Tab | iOS Content | Current Web | Gap |
|---------|-------------|-------------|-----|
| **Home** (Tab 0) | `ClientHomeView` — status card, coach info, adherence | `/client` (page.tsx) | ✅ Exists |
| **Plan** (Tab 1) | Segmented: Meal Plan / Training Program | `/client/meal-plan`, `/client/training` (separate routes) | ❌ No unified "Plan" tab |
| **Check-In** (Tab 2) | Check-in form, history list, detail | `/client/check-in`, `/client/check-ins` | ✅ Exists as tab |
| **Messages** (Tab 3) | Chat with coach | `/client/messages/[weekStartDate]` | ❌ Not a bottom nav tab |
| **Profile** (Tab 4) | Profile + settings nested inside | `/client/profile` (tab), `/client/settings` (separate tab) | ⚠️ Settings should be inside Profile, not separate tab |

**Client Bottom Nav Change**: `[Home, Profile, Check-In, Settings]` → `[Home, Plan, Check-In, Messages, Profile]`

### Coach Side

| iOS Tab | iOS Content | Current Web | Gap |
|---------|-------------|-------------|-----|
| **Clients** (Tab 1) | Client roster with status cards | `/coach/dashboard` | ✅ Exists (same content, different label) |
| **Messages** (Tab 2) | Coach inbox → per-client threads | No dedicated page | ❌ Missing entirely |
| **More** (Tab 3) | Profile, Settings, Leads, Templates, Switch Role, Sign Out | Spread across 4 separate tabs: Leads, Profile, Templates, Settings | ❌ Should be unified "More" hub |

**Coach Bottom Nav Change**: `[Home, Leads, Profile, Templates, Settings]` → `[Clients, Messages, More]`

---

## Implementation Plan

### Phase 1: Coach Bottom Nav — 3-Tab Layout

#### 1.1 Create Coach Messages Inbox Page

**File**: `app/coach/messages/page.tsx` [NEW]

Create a new server component that:
- Fetches all coach-client relationships for the current coach
- For each client, fetches the latest message thread metadata (last message, timestamp)
- Renders a list of conversation rows (avatar + name + last message preview + time ago)
- Each row links to the existing per-client messages route

This page mimics `CoachMessagesViewV2.swift` from iOS — a list of all client conversations sorted by most recent activity.

**Data**: Use existing queries from `lib/queries/` — the messages data model already supports this. Check `app/client/messages/` for the existing message component patterns.

#### 1.2 Create Coach "More" Hub Page

**File**: `app/coach/more/page.tsx` [NEW]

A settings/navigation hub page matching `CoachMoreViewV2.swift`. Contains:
- **Profile hero card** — coach avatar, name, "Coach account" subtitle (links to `/coach/marketplace/profile`)
- **App Settings section**
  - Profile → `/coach/marketplace/profile`
  - Coach Settings → `/coach/settings`
- **Workspace section**
  - Leads Pipeline → `/coach/leads`
  - Templates → `/coach/templates`
- **Account section**
  - Switch to Client (if dual-role) → role switcher action
  - Sign Out → Clerk sign-out

This is purely a navigation hub with links — no new backend queries needed beyond fetching the user's profile photo.

#### 1.3 Update Coach Bottom Nav

**File**: `components/ui/mobile-bottom-nav.tsx` [MODIFY]

Change `coachItems` array from:
```
[Home, Leads, Profile, Templates, Settings]
```
to:
```
[Clients, Messages, More]
```

Icons:
- Clients = people icon (existing)
- Messages = chat bubble icon  
- More = three dots / ellipsis icon

Update `isActive()` logic to handle the new routes.

#### 1.4 Update Coach Desktop Nav

**File**: `components/ui/nav-bar.tsx` [MODIFY]

Change coach `navLinks` from:
```
[Leads, Coaching Profile, Templates]
```
to:
```
[Messages, More]
```
(Desktop can also link directly to Leads, Templates from sub-navigation within the "More" page)

#### 1.5 Update Coach Layout Route Label

**File**: `app/coach/layout.tsx` [MODIFY]
- No structural changes needed — the layout wrapper remains the same.

---

### Phase 2: Client Bottom Nav — 5-Tab Layout  

#### 2.1 Create Client "Plan" Tab Page

**File**: `app/client/plan/page.tsx` [NEW]

A unified plan view with segmented tabs matching `ClientPlanTabView.swift`:
- **Meal Plan** segment — renders the existing `SimpleMealPlan` component (`components/client/simple-meal-plan.tsx`)
- **Training Program** segment — renders the existing `TrainingProgram` component (`components/client/training-program.tsx`)

Server component that fetches meal plan + training data, passes to a client wrapper with segment toggle.

**File**: `components/client/plan-tab.tsx` [NEW]
Client component with a segmented control (Meal Plan | Training) that toggles between the two views.

Data fetching: Reuse the exact same queries already used by `/client/meal-plan/page.tsx` and `/client/training/page.tsx`.

#### 2.2 Create Client Messages Tab

The route `/client/messages` currently requires a `[weekStartDate]` param. Create a landing page:

**File**: `app/client/messages/page.tsx` [NEW]

A simple page that:
- Fetches the coach relationship
- If coach exists, shows the message thread (reuse existing messages component)
- If no coach, shows "No coach connected" empty state

#### 2.3 Merge Settings into Profile

Currently `/client/settings/page.tsx` is a standalone page with notification settings. In iOS, settings are accessed from within the Profile view.

**Option A (Minimal)**: Keep `/client/settings` as a route but remove it from the bottom nav. Add a "Settings" link/button inside the Profile page that navigates to `/client/settings`.

**Option B (Full merge)**: Inline the notification settings into the profile page as a collapsible section.

**Recommended**: Option A — minimal changes, no backend impact.

**File**: `app/client/profile/page.tsx` [MODIFY]
- Add a "Settings" navigation row that links to `/client/settings`
- Add other navigation rows matching iOS ProfileView: Terms of Service, Privacy Policy, Sign Out
- Add "Switch to Coach" if dual-role

#### 2.4 Update Client Bottom Nav

**File**: `components/ui/mobile-bottom-nav.tsx` [MODIFY]

Change `clientItems` array from:
```
[Home, Profile, Check-In, Settings]
```
to:
```
[Home, Plan, Check-In, Messages, Profile]
```

Icons:
- Home = house (existing)
- Plan = fork/knife or clipboard
- Check-In = clipboard with check (existing)
- Messages = chat bubble
- Profile = person (existing)

#### 2.5 Update Client Desktop Nav

**File**: `components/ui/nav-bar.tsx` [MODIFY]

Change client `navLinks` to include Plan and Messages links. Remove Settings gear icon (now nested in Profile).

---

### Phase 3: Coach Client Detail — Tabbed Layout

The iOS `ClientDetailViewV2.swift` has 4 segments: Overview, Plans, History, Settings.

The web currently has this at `app/coach/clients/[clientId]/page.tsx` which already uses `ClientDetailTabs` component (`components/coach/client-workspace/client-detail-tabs.tsx`).

**Check**: Verify the existing tab structure matches iOS segments. If it already has Overview/Plans/History/Settings tabs, no changes needed. If not, update the tab labels and content to match.

---

### Phase 4: Polish & Dark Mode Consistency

#### 4.1 Notification Settings Dark Mode Fix

**File**: `components/client/notification-settings.tsx` [MODIFY]

Replace all light-mode classes:
- `text-zinc-900` → `text-zinc-100` (label headings)
- `bg-white` on inputs → `bg-white/5` or `sf-input` class
- `border-zinc-200` → `border-white/10` (section dividers)
- `bg-zinc-50` → `bg-white/[0.03]` (disclaimer box)
- `text-red-600` → `text-red-400` (error text)
- `text-amber-600` → `text-amber-400` (unsaved indicator)
- `text-emerald-600` → `text-emerald-400` (success toast)
- `bg-zinc-900` on save button → `bg-blue-600 hover:bg-blue-500` (primary action)

#### 4.2 Client Profile Page Dark Mode

**File**: `app/client/profile/page.tsx` [MODIFY]
- Ensure all containers use dark surfaces
- Verify text colors are light

#### 4.3 Coach Settings Dark Mode

All coach components using `sf-glass-card` are already correct. Verify no remaining light-mode artifacts.

---

## Files Changed Summary

| Action | File | Description |
|--------|------|-------------|
| NEW | `app/coach/messages/page.tsx` | Coach inbox — list of client conversations |
| NEW | `app/coach/more/page.tsx` | Coach "More" hub — settings/navigation |
| NEW | `app/coach/more/layout.tsx` | Optional layout for More section |
| NEW | `app/client/plan/page.tsx` | Client Plan tab — Meal Plan + Training segments |
| NEW | `components/client/plan-tab.tsx` | Client-side segment toggle for Plan tab |
| NEW | `app/client/messages/page.tsx` | Client Messages landing page |
| MODIFY | `components/ui/mobile-bottom-nav.tsx` | Both coach (3 tabs) and client (5 tabs) bottom navs |
| MODIFY | `components/ui/nav-bar.tsx` | Desktop nav links for both roles |
| MODIFY | `app/client/profile/page.tsx` | Add Settings/Legal/SignOut nav rows |
| MODIFY | `components/client/notification-settings.tsx` | Dark mode color fixes |

## Files NOT Changed (Backend)

- `app/api/*` — All API routes unchanged
- `app/actions/*` — All server actions unchanged
- `lib/*` — All utility/query functions unchanged
- `prisma/*` — Schema unchanged
- Existing page routes remain accessible (old URLs still work)

---

## Verification

1. Coach bottom nav shows 3 tabs: Clients, Messages, More
2. Client bottom nav shows 5 tabs: Home, Plan, Check-In, Messages, Profile
3. Coach "More" page links to all existing settings/lead/profile/template pages
4. Client "Plan" tab shows segmented Meal Plan / Training
5. Client Profile page has Settings link
6. All pages render correctly in dark mode
7. `npm run build` passes with no errors
8. No backend/API changes
