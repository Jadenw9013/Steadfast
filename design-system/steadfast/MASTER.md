# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Steadfast
**Generated:** 2026-03-22
**Category:** B2B SaaS · Fitness Coaching Platform
**Mode:** Dark mode only (permanently)

---

## 🔒 Locked Constraints (never change)

| Constraint | Value |
|-----------|-------|
| Color mode | Dark only — no light mode |
| Heading font | `Chakra Petch` |
| Body font | `Sora` |
| Mono font | `Geist Mono` |
| Primary CTA color | `blue-600` (#2563EB) |
| CTA hover | `blue-500` (#3B82F6) |
| CSS framework | Tailwind v4 |
| Min tap target | 48px (`min-h-[48px]` or `min-h-[56px]` for primary) |
| Input font size | `font-size: max(1rem, 16px)` — prevents iOS zoom |

---

## Color Palette

### Core Backgrounds

| Role | Tailwind | Hex | Notes |
|------|----------|-----|-------|
| Page background | `bg-[#0a0f1e]` | `#0A0F1E` | Deep navy — primary canvas |
| Surface / Card | `bg-zinc-900/80` | `#18181Bcc` | Frosted card surface |
| Elevated surface | `bg-zinc-900` | `#18181B` | Modals, dropdowns |
| Subtle surface | `bg-zinc-800/30` | `#27272Acc` | Input backgrounds, code blocks |

### Borders

| Role | Tailwind | Notes |
|------|----------|-------|
| Default border | `border-white/[0.08]` | Ultra-subtle card edges |
| Hover border | `border-white/[0.15]` | Interactive elements on hover |
| Focus border | `border-blue-500/50` | Form inputs on focus |
| Divider | `border-white/[0.04]` | Row separators within cards |

### Text

| Role | Tailwind | Hex |
|------|----------|-----|
| Primary text | `text-zinc-100` | `#F4F4F5` |
| Secondary text | `text-zinc-400` | `#A1A1AA` |
| Muted text | `text-zinc-500` | `#71717A` |
| Placeholder | `text-zinc-600` | `#52525B` |
| Inverse (on light) | `text-zinc-900` | `#18181B` |

### Semantic/Accent Colors (creative freedom)

| Role | Tailwind | Usage |
|------|----------|-------|
| CTA primary | `bg-blue-600` → hover `bg-blue-500` | Main actions |
| Success | `text-emerald-400`, `bg-emerald-500/10` | Confirmed states |
| Warning | `text-amber-400`, `bg-amber-500/10` | Attention needed |
| Danger | `text-red-400`, `bg-red-500/10` | Errors, destructive |
| Info/secondary | `text-violet-400`, `bg-violet-500/10` | Supplemental tags |
| Neutral badge | `text-zinc-400`, `bg-zinc-800` | Inactive/historical |
| Cyan accent | `text-cyan-400`, `bg-cyan-500/10` | Pipeline stages, status |

---

## Typography

### Font Loading

```css
@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Sora:wght@300;400;500;600;700&display=swap');
/* Geist Mono: from vercel.com/font or via next/font/local */
```

### Scale

| Token | Class | Size | Weight | Font |
|-------|-------|------|--------|------|
| Display | `text-4xl font-bold tracking-tight` | 36px | 700 | Chakra Petch |
| H1 | `text-3xl font-semibold tracking-tight` | 30px | 600 | Chakra Petch |
| H2 | `text-xl font-bold` | 20px | 700 | Chakra Petch |
| H3 | `text-base font-semibold` | 16px | 600 | Chakra Petch |
| Label/caps | `text-xs font-semibold uppercase tracking-widest` | 12px | 600 | Sora |
| Body | `text-base leading-relaxed` | 16px | 400 | Sora |
| Body sm | `text-sm leading-relaxed` | 14px | 400 | Sora |
| Caption | `text-xs` | 12px | 400 | Sora |
| Code | `font-mono text-sm` | 14px | 400 | Geist Mono |

### Rules

- Line height body: `leading-relaxed` (1.625)
- Line length: max 65–75 chars (`max-w-prose` or `max-w-2xl`)
- Never use system font stack for headings or body

---

## Spacing

| Token | Value | Tailwind |
|-------|-------|----------|
| xs | 4px | `gap-1`, `p-1` |
| sm | 8px | `gap-2`, `p-2` |
| md | 16px | `gap-4`, `p-4` |
| lg | 24px | `gap-6`, `p-6` |
| xl | 32px | `gap-8`, `p-8` |
| 2xl | 48px | `gap-12`, `py-12` |
| 3xl | 64px | `gap-16`, `py-16` |

---

## Components

### Buttons

```html
<!-- Primary CTA -->
<button class="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white
               transition-all hover:bg-blue-500 active:scale-[0.97]
               focus-visible:outline-none focus-visible:ring-2
               focus-visible:ring-blue-500 focus-visible:ring-offset-2
               disabled:opacity-50 disabled:cursor-not-allowed"
        style="min-height: 48px;">
  Action
</button>

<!-- Secondary / Ghost -->
<button class="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold
               text-zinc-300 transition-all hover:border-zinc-500 hover:text-zinc-100
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
        style="min-height: 48px;">
  Cancel
</button>

<!-- Destructive -->
<button class="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-sm
               font-semibold text-red-400 transition-all hover:bg-red-500/20"
        style="min-height: 48px;">
  Delete
</button>
```

### Cards

```html
<!-- Default card -->
<div class="rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-6">
  ...
</div>

<!-- Interactive card (clickable) -->
<div class="rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-6 cursor-pointer
            transition-all duration-200 hover:border-white/[0.15] hover:bg-zinc-800/60">
  ...
</div>

<!-- Highlighted / featured card -->
<div class="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-6">
  ...
</div>
```

### Inputs

```html
<input
  class="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/30 px-4 py-3
         text-zinc-100 placeholder-zinc-600
         focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none
         transition-colors"
  style="font-size: max(1rem, 16px); min-height: 48px;"
/>

<textarea
  class="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/30 px-4 py-3
         text-zinc-100 placeholder-zinc-600
         focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none
         transition-colors resize-y"
  style="font-size: max(1rem, 16px);"
/>
```

### Badges / Pills

```html
<!-- Status pill — emerald -->
<span class="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-0.5
             text-xs font-semibold text-emerald-400">Active</span>

<!-- Status pill — amber -->
<span class="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-0.5
             text-xs font-semibold text-amber-400">Pending</span>

<!-- Stage tag — cyan -->
<span class="inline-flex items-center rounded-md bg-cyan-500/10 px-2 py-0.5
             text-xs font-semibold text-cyan-400">Intake Sent</span>

<!-- Neutral muted -->
<span class="inline-flex items-center rounded-md bg-zinc-800 px-2 py-0.5
             text-xs font-semibold text-zinc-400">Inactive</span>
```

### Section Headers (caps label style)

```html
<h2 class="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">
  Section Title
</h2>
```

### Modals / Dialogs

```html
<!-- Overlay -->
<div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />

<!-- Dialog -->
<div class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2
            rounded-2xl border border-white/[0.08] bg-zinc-900 p-6 shadow-2xl">
  ...
</div>
```

### Alerts / Toasts

```html
<!-- Success -->
<div class="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-3
            text-sm text-emerald-400">...</div>

<!-- Warning -->
<div class="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4
            text-sm text-amber-300">...</div>

<!-- Error -->
<div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-3
            text-sm text-red-400" role="alert">...</div>
```

---

## Layout

### Page Containers

```html
<!-- Narrow — forms, documents -->
<div class="mx-auto max-w-2xl px-4">...</div>

<!-- Standard — most pages -->
<div class="mx-auto max-w-4xl px-4">...</div>

<!-- Wide — two-column dashboards -->
<div class="mx-auto max-w-6xl px-4">...</div>
```

### Sticky Header Pattern

```html
<div class="sticky top-0 z-10 border-b border-white/[0.06]
            bg-[#0a0f1e]/90 backdrop-blur px-4 py-3">
  ...
</div>
```

### Two-Column with Sticky Sidebar

```html
<div class="lg:flex lg:gap-8">
  <div class="lg:w-[65%] min-w-0"><!-- Main content --></div>
  <aside class="hidden lg:block lg:w-[35%]">
    <div class="sticky top-24 rounded-2xl border border-white/[0.08]
                bg-zinc-900/80 p-6">
      <!-- Sidebar content -->
    </div>
  </aside>
</div>
```

### Z-Index Scale

| Level | Value | Usage |
|-------|-------|-------|
| Base | `z-0` | Normal content |
| Raised | `z-10` | Sticky headers |
| Dropdown | `z-20` | Floating menus |
| Overlay | `z-30` | Sheet backgrounds |
| Modal | `z-50` | Dialogs |

---

## Animation

| Use case | Duration | Easing | Tailwind |
|----------|----------|--------|----------|
| Color/opacity | 150ms | ease | `transition-colors duration-150` |
| All properties | 200ms | ease | `transition-all duration-200` |
| Layout (hover lift) | 150ms | ease-out | `transition-transform duration-150` |
| Shadow | 200ms | ease | `transition-shadow duration-200` |
| Page transitions | 300ms | ease-in-out | — |

**Rules:**
- Use `transform` and `opacity` only — never animate `width`, `height`, `padding`
- Always add `@media (prefers-reduced-motion: reduce) { * { transition: none; } }` globally
- Hover lifts: max `translateY(-2px)` — never `scale()` on cards (causes layout shift)

---

## Shadows (dark mode)

| Level | Value |
|-------|-------|
| Subtle | `shadow-sm` → `0 1px 2px rgba(0,0,0,0.3)` |
| Card | `shadow-md` → `0 4px 6px rgba(0,0,0,0.4)` |
| Elevated | `shadow-lg` → `0 10px 15px rgba(0,0,0,0.4)` |
| Modal | `shadow-2xl` → `0 25px 50px rgba(0,0,0,0.6)` |
| Glow (CTA) | `shadow-[0_0_20px_rgba(37,99,235,0.3)]` |

---

## Style Guidelines

**Personality:** Premium · Calm · Trustworthy · Professional  
**Visual language:** Clean document-style UIs. Data is readable at a glance. No clutter.  
**Motion voice:** Purposeful and restrained — interactions confirm without surprising.

### This platform does NOT use:
- ❌ Glassmorphism (too trendy — use solid dark surfaces instead)
- ❌ AI purple/pink gradients (off-brand)
- ❌ Playful/loud colors
- ❌ Emojis as icons — use SVG (Lucide / Heroicons)
- ❌ Light mode
- ❌ Scale transforms on cards (layout shift)
- ❌ Instant state changes — always transition (150–300ms)
- ❌ Low-contrast muted text below 4.5:1

---

## Accessibility Checklist

- [ ] All interactive elements have `cursor-pointer`
- [ ] Focus rings: `focus-visible:ring-2 focus-visible:ring-blue-500`
- [ ] `aria-label` on icon-only buttons
- [ ] `role="alert"` + `aria-live="polite"` on dynamic status
- [ ] Inputs have visible `<label>` or `aria-label`
- [ ] Tap targets ≥ 48px (`min-h-[48px]`)
- [ ] Input `font-size: max(1rem, 16px)` to prevent iOS zoom
- [ ] Color never the sole indicator (pair with icon/text)
- [ ] `prefers-reduced-motion` respected globally

---

## Pre-Delivery Checklist

Before delivering any UI code:

- [ ] Dark background only (`bg-[#0a0f1e]` or `bg-zinc-900/80` for cards)
- [ ] Fonts: Chakra Petch (headings), Sora (body), Geist Mono (code)
- [ ] CTA uses `blue-600` / `blue-500` hover
- [ ] All inputs have `font-size: max(1rem, 16px)` and `min-height: 48px`
- [ ] Primary buttons `min-height: 48px`, primary actions `min-height: 56px`
- [ ] No emojis as icons
- [ ] `cursor-pointer` on all clickable elements
- [ ] Transitions on all interactive states (150–300ms)
- [ ] Focus states visible (`focus-visible:ring-2`)
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile
