# IOS_UI_SYSTEM.md
> Steadfast iOS — Design System & Native Translation Reference
> Derived from: `design-system/steadfast/MASTER.md` + component audit

---

## Brand Feel

- **Dark only.** No light mode exists or is planned. The entire product is permanently dark.
- **Navy-first.** Page background is deep navy (`#0A0F1E`), not black. Cards sit on top as slightly elevated surfaces.
- **Premium but functional.** No gradients everywhere — reserved for emphasis (avatars, hero sections). Most UI is muted zinc tones with subtle blue accents.
- **Dense but readable.** Information-dense for coaches; simpler, single-focus for clients.
- **Motion is subtle.** Fade-ins on sections (`animate-fade-in`), hover translations (≤2px), scale on press (`active:scale-[0.97]`). Not playful.

---

## Color System

All colors are derived from the codebase. Use these as design tokens in iOS.

### Background Tokens

| Token name | Web value | SwiftUI equivalent |
|------------ |-----------|-------------------|
| `colorPageBg` | `#0A0F1E` | `Color(hex: "0A0F1E")` |
| `colorSurface` | `#18181B` at 0.8 opacity | `Color(hex: "18181B").opacity(0.8)` |
| `colorSurfaceElevated` | `#18181B` | `Color(hex: "18181B")` |
| `colorSurfaceSubtle` | `#27272A` at 0.3 opacity | `Color(hex: "27272A").opacity(0.3)` |
| `colorCardDeep` | `#0a1224` | `Color(hex: "0a1224")` — used on client plan cards |
| `colorNavBg` | `#020815` at 0.9 opacity | Approx black-navy transparent |

### Border Tokens

| Token name | Web value | Usage |
|------------ |-----------|-------|
| `borderDefault` | `rgba(255,255,255,0.08)` | Card edges |
| `borderHover` | `rgba(255,255,255,0.15)` | Interactive hover |
| `borderFocus` | `rgba(59,130,246,0.5)` | Input focus ring |
| `borderDivider` | `rgba(255,255,255,0.04)` | Row separators within cards |
| `borderSubtle` | `zinc-800` = `#27272A` | Section containers, intake rows |

### Text Tokens

| Token name | Web class | Hex |
|------------ |-----------|-----|
| `textPrimary` | `text-zinc-100` | `#F4F4F5` |
| `textSecondary` | `text-zinc-400` | `#A1A1AA` |
| `textMuted` | `text-zinc-500` | `#71717A` |
| `textPlaceholder` | `text-zinc-600` | `#52525B` |

### Semantic Colors

| Semantic | Background | Text | Usage |
|----------|-----------|------|-------|
| Primary CTA | `#2563EB` (blue-600) → hover `#3B82F6` | white | Main actions |
| Success | `rgba(16,185,129,0.1)` | `#34D399` (emerald-400) | Reviewed, completed |
| Warning | `rgba(245,158,11,0.1)` | `#FBBF24` (amber-400) | Pending, submitted |
| Danger | `rgba(239,68,68,0.1)` | `#F87171` (red-400) | Errors, destructive |
| Info/violet | `rgba(139,92,246,0.1)` | `#A78BFA` (violet-400) | Tags, supplemental |
| Cyan/stage | `rgba(6,182,212,0.1)` | `#22D3EE` (cyan-400) | Pipeline stages |
| Neutral badge | `#27272A` (zinc-800) | `#A1A1AA` (zinc-400) | Inactive badges |
| Green/cardio | `rgba(34,197,94,0.05)` + border `rgba(34,197,94,0.2)` | `#86EFAC` (green-300) | Cardio prescription |

### Gradient Accents (used sparingly)

```
Avatar ring gradient: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #06b6d4 100%)
Check-in CTA (blue): linear-gradient(135deg, #1d4ed8 0%, #2563eb 60%, #3b82f6 100%)
Header overdue banner: radial or linear red gradient variants
```

---

## Typography

**Note:** The web app uses custom fonts loaded from Google Fonts. For iOS, use system fonts that match the weight/feeling, or embed custom fonts.

| Role | Web font | Recommended iOS | Weight |
|------|----------|-----------------|--------|
| Headings / Display | Chakra Petch | SF Pro Rounded Bold or embed Chakra Petch | 600–700 |
| Body / UI | Sora | SF Pro Text or embed Sora | 300–600 |
| Monospace / code | Geist Mono | SF Mono or embed Geist Mono | 400 |

**Embedding custom fonts (recommended for brand fidelity):** Add `ChakraPetch.ttf`, `Sora.ttf` to the iOS bundle.

### Type Scale

| Role | Web | Size | Weight | SwiftUI |
|------|-----|------|--------|---------|
| Display | `text-4xl font-bold tracking-tight` | 36pt | 700 | `.largeTitle.bold()` |
| H1 | `text-3xl font-semibold tracking-tight` | 30pt | 600 | `.title.semibold()` |
| H2 | `text-xl font-bold` | 20pt | 700 | `.title2.bold()` |
| H3 | `text-base font-semibold` | 16pt | 600 | `.headline` |
| Section label (caps) | `text-xs font-semibold uppercase tracking-widest` | 11pt | 600 | `.caption.uppercased()` + letter-spacing |
| Body | `text-base leading-relaxed` | 16pt | 400 | `.body` |
| Body sm | `text-sm leading-relaxed` | 14pt | 400 | `.subheadline` |
| Caption | `text-xs` | 12pt | 400 | `.caption` |

**Input font size rule:** Always `≥ 16pt` to prevent iOS zoom. Web does `font-size: max(1rem, 16px)`.

---

## Spacing

Derived from Tailwind spacing scale. Use 4pt grid.

| Token | Value |
|-------|-------|
| xs | 4pt |
| sm | 8pt |
| md | 16pt |
| lg | 24pt |
| xl | 32pt |
| 2xl | 48pt |
| Page horizontal padding | 16–20pt |
| Card inner padding | 20–24pt |
| Section gap | 24pt |
| Item row vertical padding | 12pt |

---

## Border Radius

| Role | Web | iOS |
|------|-----|-----|
| Cards, containers | `rounded-2xl` = 16pt | `cornerRadius(16)` |
| Buttons primary | `rounded-xl` = 12pt | `cornerRadius(12)` |
| Inputs | `rounded-xl` = 12pt | `cornerRadius(12)` |
| Badges/pills | `rounded-full` | `.capsule` |
| Icon containers | `rounded-lg` = 8pt | `cornerRadius(8)` |
| Small chips | `rounded-md` = 6pt | `cornerRadius(6)` |

---

## Elevation / Shadow

Dark-mode shadows are very subtle — they don't show on dark surfaces. Reserve shadows for floating elements.

| Role | Web | iOS |
|------|-----|-----|
| Cards (default) | No shadow — border only | No shadow, use background contrast |
| Interactive card hover | `hover:shadow-lg` | N/A (tap state = background opacity change) |
| Primary CTA button | `shadow-md` | `.shadow(color: .blue.opacity(0.3), radius: 8)` |
| Floating action area | `shadow-2xl` | `.shadow(radius: 20, y: -4)` |

---

## Button Hierarchy

### Primary CTA
```swift
// Blue, fills minimum 48pt height
Button("Publish") { ... }
  .buttonStyle(.borderedProminent)
  .tint(Color(hex: "2563EB"))
  .controlSize(.large)
  .cornerRadius(12)
```
- Web: `bg-blue-600 hover:bg-blue-500 active:scale-[0.97]`
- iOS: `.scaleEffect(isPressed ? 0.97 : 1)` on press
- **Disabled:** 50% opacity, not interactive

### Secondary / Ghost
```swift
Button("Cancel") { ... }
  .buttonStyle(.bordered)
  .tint(Color(hex: "52525B")) // zinc-600
  .cornerRadius(12)
```
- Web: `border-zinc-700 text-zinc-300 hover:border-zinc-500`

### Destructive
- Web: `border-red-500/30 bg-red-500/10 text-red-400`
- iOS: `.buttonStyle(.bordered).tint(.red)` or custom

### Minimum tap target: 48pt height / 48pt width (web rule already enforced)

---

## Form Patterns

- Background: `colorSurfaceSubtle` (`#27272A` at 30% opacity)
- Border: `borderDefault` at rest → `borderFocus` (blue) on focus
- Text: `textPrimary` (`#F4F4F5`)
- Placeholder: `textPlaceholder` (`#52525B`)
- Input min height: 48pt
- Textarea min height: 48pt, resizable

### SwiftUI equivalents:
- `TextField` with custom `TextFieldStyle`
- `TextEditor` for multiline
- No system `.rounded` style — use custom background + overlay border

---

## Card Patterns

### Default card
```swift
VStack { content }
  .padding(20)
  .background(Color(hex: "18181B").opacity(0.8))
  .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.08), lineWidth: 1))
  .cornerRadius(16)
```

### Interactive card (navigable)
Same as default + `.contentShape(Rectangle())` + `.hoverEffect()` on iPadOS, press state: `.background(Color.white.opacity(0.04))`.

### Deep navy card (client plan cards)
Background: `#0a1224` instead of `#18181B`.

### Highlighted card (featured / CTA)
Border: `rgba(59,130,246,0.2)` blue tint; background: `rgba(59,130,246,0.05)`.

### Two-tone row (intake fields)
Left column (38% width): label text muted zinc-500; right column: value or textarea.
Divider between rows: `rgba(255,255,255,0.04)` hairline.

---

## Status Badges / Chips

Do not use native iOS `.badge` — build custom pills.

```swift
// Example: Emerald "Active" badge
Text("Active")
  .font(.caption.bold())
  .foregroundColor(Color(hex: "34D399"))
  .padding(.horizontal, 10).padding(.vertical, 4)
  .background(Color(hex: "10B981").opacity(0.1))
  .clipShape(Capsule())
```

| Status | Background | Text color |
|--------|-----------|-----------|
| Active / Reviewed | emerald-500/10 | emerald-400 |
| Submitted / Pending | amber-500/10 | amber-400 |
| Sent / In Progress | blue-500/20 | blue-400 |
| Inactive / Historical | zinc-800 | zinc-400 |
| Declined / Error | red-500/10 | red-400 |
| Stage / Pipeline | cyan-500/10 | cyan-400 |

### Status dot pattern (small inline indicator)
`Circle().frame(width: 6, height: 6).fill(Color(hex: "34D399"))` + label text.

---

## Modal / Sheet Patterns

| Web pattern | iOS equivalent |
|------------|---------------|
| Centered dialog overlay | `.sheet(isPresented:)` (detent: `.medium` or `.large`) |
| Full-screen form | `.fullScreenCover(isPresented:)` |
| Confirmation / destructive action | `.confirmationDialog()` |
| Inline tooltip/note | `popover` on iPad, bottom sheet info on iPhone |
| Drawer (side) | Not used on web; use sheet on iOS |

**Web backdrop:** `bg-black/70 backdrop-blur-sm`
**iOS equivalent:** Sheet system handles dimming automatically.

---

## Navigation Patterns

### Web navigation structure
- **Top navbar** (desktop): `NavBar` component — logo, nav links for coach, coach/client role badge, `UserButton` (Clerk)
- **Mobile bottom nav:** `MobileBottomNav` component — 5 tabs for coach, 4-5 tabs for client

### Coach bottom tabs (web mobile)
1. Home (`/coach/dashboard`)
2. Leads (`/coach/leads`)
3. Profile (`/coach/marketplace/profile`)
4. Templates (`/coach/templates`)
5. Settings (`/coach/settings`)

### Client bottom tabs (web mobile)
With coach:
1. Home (`/client`)
2. Profile (`/client/profile`)
3. **Check-In** (center floating pill button — blue square-rounded)
4. Settings (`/client/settings`)

Without coach:
1. Home, 2. Coaches (browse marketplace), 3. Profile, 4. Check-In, 5. Settings

### iOS native equivalent
Use `TabView` with `tabItem` for main navigation. The Check-In tab for clients should use a prominent styled tab button (not default system style) — the web version renders it as a floating blue pill.

---

## Section Headers

The "all-caps muted label" pattern is used extensively:
```swift
Text("INTAKE SUMMARY")
  .font(.system(size: 11, weight: .semibold))
  .tracking(2)
  .foregroundColor(Color(hex: "71717A"))
  .textCase(.uppercase)
```

---

## Feedback States

### Loading
- Web uses skeleton screens or a subtle spinner
- iOS: `ProgressView()` inline, or `redacted(reason: .placeholder)` on card skeletons
- Never block the entire screen for progressive loads

### Empty State
Pattern: dashed border card + icon + muted text + optional CTA link/button
```
border-dashed border-zinc-700/60
padding: 32pt vertical, 20pt horizontal
text-center
p1: "No [thing] yet." (zinc-400, 14pt)
p2: optional explanation (zinc-600, 12pt)
CTA: link-style button (blue-400)
```

### Error State
- Red-bordered card: `border-red-500/20 bg-red-500/10 text-red-400`
- iOS: `.alert()` for critical errors; inline red banner for recoverable

### Success Feedback
- "✓ Saved" text appears inline (not toast) — 2.5s then disappears
- iOS: same inline pattern preferred; `withAnimation` on opacity

---

## Accessibility

Rules derived from web codebase:
- Minimum tap target: **48pt** (as enforced by `min-h-[48px]` throughout)
- All form inputs: **≥ 16pt font** (iOS zoom prevention)
- Interactive elements have `aria-label` equivalents → use `.accessibilityLabel()` on iOS
- `role="status" aria-live="polite"` for save indicators → iOS: `AccessibilityTraits.updatesFrequently`
- All section headings are semantically marked → use `.accessibilityHeading()` on iOS
- Color is never the only differentiator — always paired with text or icon

---

## Do Not Do List

1. **Do not use light mode** — the entire brand is dark-only. No adaptive colors.
2. **Do not use system list separator style** — use custom dividers matching `rgba(255,255,255,0.04)`.
3. **Do not use `.tint(. accentColor)`** without overriding accent to `blue-600` (`#2563EB`).
4. **Do not use `UITableView`-style grouped sections** — use custom cards.
5. **Do not use iOS stock form sheet background** — override with `colorPageBg`.
6. **Do not use SF Symbols as-is for primary icons** — web uses custom SVG stroke icons (Lucide-style, `strokeWidth: 2`). Use matching SF Symbols or custom icons.
7. **Do not use system blue** — use exact `#2563EB` for primary CTAs.
8. **Do not show draft plans to clients** — only `PUBLISHED` plans are client-visible.
9. **Do not rely on screen height for week calculation** — always use server-provided week data.
10. **Do not assume one role** — handle coach+client dual-role users with role-switching UI.
