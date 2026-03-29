# Claude CLI Prompt — Steadfast iOS Parity Restructure

Use this prompt with Claude CLI (`claude`) to execute the restructure.

---

## Prompt

```
Read the file ios-parity-restructure.md for the full implementation plan. This plan restructures the Steadfast web app's navigation and pages to match the iOS app's tab structure.

CRITICAL RULES:
1. DO NOT modify any files in: app/api/*, app/actions/*, lib/*, prisma/*
2. Only change UI components, page routes, and CSS — no backend logic changes
3. Keep all existing routes working (don't delete old page files)
4. Maintain the dark-mode-only design system (bg-[#020815] base, sf-glass-card primitives, white/zinc-100 text)
5. Run `npm run build` after each phase to verify no errors

Execute the plan in order:

PHASE 1 — Coach 3-Tab Nav:
1. Create app/coach/messages/page.tsx — a server component that renders a coach inbox. Query coach-client relationships and render conversation list cards. Each card shows: client avatar (gradient ring like inbox-client-card.tsx), client name, "Latest check-in: [date]" subtitle, time-ago on the right, and a chevron. Link each row to /coach/clients/[clientId]. Use the same dark styling as components/coach/inbox/inbox-client-card.tsx. The data query should reuse getCoachClientsWithWeekStatus from lib/queries/check-ins.ts.

2. Create app/coach/more/page.tsx — a navigation hub matching the iOS "More" tab (CoachMoreViewV2.swift). Layout:
   - Profile hero card at top: coach avatar (sf-glass-card, centered photo with purple gradient ring, name below, "Coach account" subtitle)
   - "App Settings" section header → two rows: "Profile" (links to /coach/marketplace/profile), "Coach Settings" (links to /coach/settings)
   - "Workspace" section header → two rows: "Leads Pipeline" (links to /coach/leads), "Templates" (links to /coach/templates)
   - "Account" section header → "Switch to Client" row (if user.isClient, use existing RoleSwitcher logic), "Sign Out" row
   Each row is an sf-glass-card with icon, title, subtitle, and chevron. Fetch user data with getCurrentDbUser from lib/auth/roles.

3. Update components/ui/mobile-bottom-nav.tsx — replace coachItems with 3 items:
   - Clients (href: /coach/dashboard, people icon)
   - Messages (href: /coach/messages, chat bubble icon)
   - More (href: /coach/more, three-dots/ellipsis icon)

4. Update components/ui/nav-bar.tsx — change coach navLinks to: [{ href: "/coach/messages", label: "Messages" }]. Remove the separate settings gear link for coach (it's now in More). Keep the Clerk UserButton.

PHASE 2 — Client 5-Tab Nav:
5. Create app/client/plan/page.tsx — server component that fetches both meal plan data and training program data, then renders components/client/plan-tab.tsx (new client component).

6. Create components/client/plan-tab.tsx — "use client" component with a segmented control (two buttons: "Meal Plan" | "Training"). When "Meal Plan" is selected, render SimpleMealPlan. When "Training" is selected, render TrainingProgram. Match the iOS segment control style: rounded-xl bg-white/[0.04] pills, active pill has bg-white/[0.08] text-white. Look at the existing page files app/client/meal-plan/page.tsx and app/client/training/page.tsx for the exact data shape and props each component expects. The server page.tsx must fetch data for BOTH and pass them down.

7. Create app/client/messages/page.tsx — server component. Check if client has a coach (via coachClient query). If yes, render the existing messages component. If no coach, show empty state. Look at the existing app/client/messages/[weekStartDate]/page.tsx for the message component usage pattern.

8. Modify app/client/profile/page.tsx — add navigation rows below the existing profile content:
   - "Settings" row → links to /client/settings (gear icon)
   - "Terms of Service" row → links to /terms
   - "Privacy Policy" row → links to /privacy
   - "Switch to Coach" row → if user.isCoach (use RoleSwitcher)
   Each row: sf-glass-card, icon + title + chevron, hover state

9. Update components/ui/mobile-bottom-nav.tsx — replace clientItems with 5 items:
   - Home (href: /client, house icon)
   - Plan (href: /client/plan, clipboard/list icon)
   - Check-In (href: /client/check-in, clipboard-check icon, keep isCheckIn + overdue dot)
   - Messages (href: /client/messages, chat bubble icon)
   - Profile (href: /client/profile, person icon)
   Also update the hasCoach conditional logic to insert "Coaches" (/coaches) only when no coach, replacing the Plan tab position if desired.

10. Update components/ui/nav-bar.tsx — change client navLinks to include Plan and Messages. Remove the separate Settings gear icon (now in Profile). Keep "Find a Coach" and "Saved" links for clients without a coach. Keep the Check-In CTA button.

PHASE 3 — Dark Mode Fixes:
11. Fix components/client/notification-settings.tsx colors:
    - All `text-zinc-900` → `text-zinc-100`
    - All `bg-white` on inputs → `bg-white/5 text-zinc-100`
    - All `border-zinc-200` → `border-white/10`
    - `bg-zinc-50` → `bg-white/[0.03]`
    - `text-red-600` → `text-red-400`
    - `text-amber-600` → `text-amber-400`
    - `text-emerald-600` → `text-emerald-400`
    - `bg-zinc-900` on button → `bg-blue-600 hover:bg-blue-500 text-white`

VERIFICATION:
After all changes, run `npm run build` and fix any errors. Do not push or commit.
```

---

## Usage

```bash
cd /Users/jadenwong/Dev/Steadfast
cat ios-parity-restructure-prompt.md | pbcopy
# Then paste into claude CLI, or:
claude "$(cat ios-parity-restructure-prompt.md)"
```
