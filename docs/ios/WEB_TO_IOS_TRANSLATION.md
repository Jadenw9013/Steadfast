# WEB_TO_IOS_TRANSLATION.md
> Steadfast iOS — Web UX → Native iOS Translation Guide
> How to preserve product identity while building natively

---

## Translation Principles

1. **Preserve intent, not HTML.** Never copy web layout 1:1. Translate the UX goal.
2. **Dark, premium, minimal.** The web feels like a professional tool — iOS should too.
3. **Cadence-aware always.** The week-based model is a product invariant. Every screen that shows status must respect it.
4. **Coach is server authority.** Every write operation must round-trip to backend. No optimistic mutations for plan content.

---

## Navigation

### Web: Dual-role router
- Top navbar (desktop) with role links + role switcher
- Bottom nav bar (mobile): 5 coach tabs, 4–5 client tabs
- Role switching via button in top nav → redirects entire app

### iOS: TabView with role-aware tab sets
```swift
@Observable class AppState {
    var activeRole: UserRole = .client  // .coach or .client
}

TabView(selection: $selectedTab) {
    ClientHomeView().tabItem { Label("Home", systemImage: "house") }
    CheckInFormView().tabItem { Label("Check-In", systemImage: "plus.circle.fill") }
    MealPlanView().tabItem { Label("Plan", systemImage: "fork.knife") }
    TrainingView().tabItem { Label("Training", systemImage: "dumbbell") }
    ClientSettingsView().tabItem { Label("Settings", systemImage: "gearshape") }
}
```

**Coach tabs:**
```swift
TabView {
    CoachDashboardView()     // Home
    LeadsPipelineView()      // Leads
    CoachProfileEditorView() // Profile
    TemplatesView()          // Templates
    CoachSettingsView()      // Settings
}
```

**Role switcher:** A prominent element in the Settings tab or a long-press action on the user avatar. Do NOT put it in the tab bar itself — the web puts it in the top nav which doesn't exist on iOS.

---

## Dashboard Cards → Native Card Stacks

### Web pattern
2-card grid (Meal Plan + Training) with dark cards, icon badge, label, name, "Open →" arrow:
```html
<div class="grid grid-cols-2 gap-3">
  <Link href="/client/meal-plan" class="rounded-2xl border ...">...</Link>
  <Link href="/client/training" class="rounded-2xl border ...">...</Link>
</div>
```

### iOS pattern
```swift
LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
    ProgramCard(title: "Meal Plan", subtitle: "Nutrition", icon: "fork.knife",
                color: .blue, destination: MealPlanView())
    ProgramCard(title: "Workout Program", subtitle: "Training", icon: "dumbbell",
                color: .green, destination: TrainingView())
}
```

**Empty state card:** Same grid position, dashed border, muted icon + "Not yet assigned" text.

---

## Check-In Status → Status Card

### Web pattern
Server-computed cadence status drives a card component (`CheckInStatus`) that renders differently for: `none`, `submitted`, `reviewed`, `due`, `overdue`.

### iOS pattern
```swift
struct CheckInStatusCard: View {
    let status: CadenceStatus
    // Renders: full gradient CTA (none/due), amber submitted card, emerald reviewed card, red overdue banner
}
```
Key: status must come from the **API**, not computed client-side. The scheduling logic is complex (custom cadence, timezone-aware) and must stay server-authoritative.

The "overdue" state in the web renders as a pulsing alert banner above the status card. iOS equivalent: `contentTransition(.numericText())` on the status label + a pulsing `.overlay` shimmer.

---

## Filter Tabs → Segmented Controls / Filter Sheets

### Web: Leads pipeline uses custom filter pills
```html
<div class="flex gap-2">
  <button class="rounded-full px-3 py-1 ...">All</button>
  <button class="rounded-full ...">Pending</button>
  ...
</div>
```

### iOS: Segmented control for ≤4 options
```swift
Picker("Status", selection: $selectedStage) {
    ForEach(LeadStage.allCases) { stage in
        Text(stage.label).tag(stage)
    }
}
.pickerStyle(.segmented)
```

For more than 4 options (leads has 6+): use a filter sheet (`.sheet` with a list of options and checkmarks).

---

## Modals / Forms → Sheets

| Web pattern | iOS adaptation |
|------------|---------------|
| `position: fixed` centered dialog | `sheet(isPresented:)` with detent `.medium` or `.large` |
| Full-page add/edit form | `fullScreenCover(isPresented:)` or `NavigationStack` push |
| Small confirmation dialog | `confirmationDialog()` (native alert) |
| Inline expanding section (e.g. "Add notes manually") | Conditional `VStack` with animated `.transition(.opacity.combined(with: .move(edge: .top)))` |
| Toast "✓ Saved" | Inline text with `withAnimation { opacity: 0 }` after 2.5s — not a system banner |

---

## Sticky CTAs → Bottom Action Area

### Web: Primary CTAs are inline at top of sections or end of forms
### iOS: For the most critical CTA on a screen, pin to bottom

```swift
VStack {
    ScrollView { content }
    // Pinned bottom CTA
    Button("Submit Check-In") { ... }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(hex: "2563EB"))
        .foregroundColor(.white)
        .cornerRadius(16)
        .padding(.horizontal, 16)
}
.safeAreaInset(edge: .bottom) {
    checkInCTAView
}
```

This applies to: Check-In submit, Check-In review (Mark Reviewed button), Intake form (Next/Submit).

---

## Dense Admin Controls → Progressive Disclosure

### Web: Coach client detail page shows ALL sections in a long scrollable page
- Metrics, weight chart, messages, intake summary, plans editor, check-in history, danger zone — all on one page

### iOS: Break into tabs or a segmented detail view

Recommended structure for `ClientDetailView`:
```
ClientDetailView
├── Tab: Overview
│   ├── Key metrics (weight, diet, energy)
│   ├── Weight chart
│   └── Check-in status
├── Tab: Plans
│   ├── Meal plan (coach editable)
│   └── Training program (coach editable)
├── Tab: History
│   ├── Check-in list (with review navigation)
│   └── Messages thread
└── Tab: Info
    ├── Intake summary (editable)
    └── Profile / settings for this client
```

iPad: Two-column layout — client list in sidebar, tabbed detail in main area (`NavigationSplitView`).

---

## Two-Column Layouts → Stacked Sections

### Web: Some sections use a 65/35 split (content | sidebar)
```html
<div class="lg:flex lg:gap-8">
  <div class="lg:w-[65%]">main</div>
  <aside class="lg:w-[35%]">sidebar</aside>
</div>
```

### iOS: Stack vertically (iPhone), side-by-side on iPad

```swift
#if os(iOS) && horizontalSizeClass == .compact
    VStack { mainContent; sidebarContent }
#else
    HStack(alignment: .top, spacing: 24) {
        mainContent.frame(maxWidth: .infinity, alignment: .leading)
        sidebarContent.frame(width: 280)
    }
#endif
```

---

## Intake Two-Tone Row → SwiftUI Row

### Web: Label (left 40%, muted) + editable value (right 60%)
```html
<div class="flex gap-4 py-3 border-b border-white/[0.04]">
  <div class="w-[40%] text-zinc-500 text-xs">Goals</div>
  <div class="flex-1 text-zinc-100 text-sm">Run a marathon</div>
</div>
```

### iOS:
```swift
struct IntakeRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundColor(Color(hex:"71717A"))
                .frame(width: UIScreen.main.bounds.width * 0.38, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(.subheadline)
                .foregroundColor(Color(hex:"F4F4F5"))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 12)
        Divider().overlay(Color.white.opacity(0.04))
    }
}
```

---

## File/Image Upload → Native Picker

### Web: HTML `<input type="file">` for check-in photos, meal plan PDFs

### iOS:
- **Check-in photos:** `PhotosUI.PhotosPicker` (multi-select) + camera via `UIImagePickerController`
- **PDF import (coach, meal plan):** `UIDocumentPickerViewController` for file selection
- Upload to Supabase bucket via REST API call (not Next.js Server Action)
- Show upload progress inline in the form

---

## Draft/Publish Toggle → Custom Button Pair

### Web: "Save Draft" (secondary) + "Publish" (primary CTA green) button pair
Used in: check-in review message, plan publication.

### iOS:
```swift
HStack {
    Button("Save Draft") { saveDraft() }
        .buttonStyle(SecondaryButtonStyle())
    Button("Publish") { publish() }
        .buttonStyle(PrimaryButtonStyle())
}
```
- Draft saves silently (no dismiss)
- Publish triggers confirmation dialog if hasn't saved recently
- Post-publish: navigate back or show success state

---

## Metric Cards → Stat Row

### Web: Row of `MetricCard` components (border-t accent color, label, large numeric value)

### iOS:
```swift
HStack(spacing: 12) {
    MetricCell(label: "Baseline", value: "185 lbs", accentColor: .blue)
    MetricCell(label: "Current", value: "181 lbs", accentColor: .blue)
    MetricCell(label: "Change", value: "-4", accentColor: .emerald, isNegativeGood: true)
}
```

Color logic: negative weight delta = `emerald-400` (good), positive = `red-400` (bad). Same as web.

---

## Weight Chart → Swift Charts

### Web: Custom chart component (`WeightProgress`) — likely recharts or similar
### iOS: Use `Swift Charts` framework (iOS 16+)

```swift
Chart(weightHistory) { entry in
    LineMark(
        x: .value("Date", entry.date),
        y: .value("Weight", entry.weight)
    )
    .foregroundStyle(Color(hex: "3B82F6"))
}
.chartXAxis { ... }
.frame(height: 160)
.background(Color(hex: "18181B"))
.cornerRadius(16)
```

---

## Cadence/Status Badge → SwiftUI Pill

### Web: Inline `<span>` with colored dot + text
```html
<span class="bg-amber-500/20 text-amber-400">Pending</span>
```

### iOS:
```swift
StatusBadge(title: "Pending", color: .amber)
// where StatusBadge renders: Text in capsule with tinted background
```

Never use system `.badge` modifier — it's not styleable enough.

---

## Check-in History Rows → List Cells with Accent Bar

### Web: Left border `border-l-[3px]` colored by status (emerald = reviewed, blue = submitted)

### iOS:
```swift
HStack(spacing: 0) {
    Rectangle()
        .fill(isReviewed ? Color(hex: "22C55E").opacity(0.6) : Color(hex: "3B82F6").opacity(0.6))
        .frame(width: 3)
    // row content
}
.background(Color(hex: "18181B"))
.cornerRadius(12)
```

---

## Must Match Exactly

1. **Cadence status logic** — always server-computed; never calculate on-device
2. **Draft/Publish state machine** — only coaches publish; client never sees draft
3. **SUBMITTED → REVIEWED state** — unidirectional; no un-review action
4. **Week scope of messages** — messages are per `weekOf`, not a single inbox
5. **Macro totals** — displayed identically (calories, protein, carbs, fats)
6. **Testimonial one-per-coach-client** — unique constraint enforced
7. **Photo upload to Supabase** — same bucket structure and paths
8. **Intake pipeline selection** — show IntakePacket if present, fall back to legacy

---

## Must Adapt Natively (Not Copy)

1. **Navigation** — TabView + NavigationStack, not sidebar/navbar
2. **Long forms** — scrollable sections, not a single long web page
3. **Photo capture** — camera roll integration is much better on native
4. **Notifications** — must use APNs (not web SMS/email) for real-time alerts
5. **Keyboard handling** — use `safeAreaInset` for compose inputs
6. **Pull-to-refresh** — native gesture for data reload, no web equivalent
7. **Haptic feedback** — use `UIImpactFeedbackGenerator` on check-in submit, publish
8. **Offline/cached views** — meal plan and training should be readable without network

---

## Never Copy 1:1 From Web

1. **Do not port the web's HTML table layouts** — use `List` or `Grid`
2. **Do not build a web view wrapper** — this should be a fully native app
3. **Do not use web's inline Server Action calls** — all mutations need REST/GraphQL endpoints
4. **Do not hardcode week start as Monday** — week start is derived from cadence config per client
5. **Do not replicate the two-column desktop sidebar layout for iPhone** — use NavigationStack push
6. **Do not use `UITableView` default styling** — override completely with the dark design system
