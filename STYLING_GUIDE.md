# Steadfast — iOS Styling Guide for Web Implementation

> **Purpose**: This document is the canonical reference for replicating the Steadfast iOS design system in the web app. Every hex value, opacity, spacing token, and card treatment is extracted directly from the Swift source. Use this for 1:1 visual parity.
>
> **Design Philosophy**: Premium dark iOS — pure black backgrounds, cool atmospheric surfaces, layered glass effects with blue/indigo/purple accents. Inspired by Ultrahuman's fitness dashboard aesthetic.

---

## 1. Color Palette

### Backgrounds

| Token | Hex | Usage |
|-------|-----|-------|
| `sfBackground` | `#000000` | Page background — pure black |
| `sfBackgroundRaised` | `#08080A` | Slightly raised surfaces |
| `sfBackgroundSoft` | `#111114` | Soft background behind sections |
| `sfSurface` | `#1A1A1A` | Standard card surface |
| `sfSurfaceElevated` | `#222222` | Elevated card surface |
| `sfForeground` | `#FFFFFF` | Maximum contrast foreground |

### CSS Variables

```css
:root {
  --sf-background: #000000;
  --sf-background-raised: #08080A;
  --sf-background-soft: #111114;
  --sf-surface: #1A1A1A;
  --sf-surface-elevated: #222222;
  --sf-foreground: #FFFFFF;
}
```

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `sfBorder` | `rgba(255,255,255, 0.08)` | Standard card border |
| `sfBorderSubtle` | `rgba(255,255,255, 0.05)` | Very subtle separators |
| `sfBorderHover` | `rgba(59,91,219, 0.25)` | Interactive hover state |
| `sfGlassBorder` | `rgba(255,255,255, 0.12)` | Glass card border |
| `sfGlassBorderAccent` | `rgba(59,91,219, 0.30)` | Focused/active glass border |

```css
:root {
  --sf-border: rgba(255,255,255, 0.08);
  --sf-border-subtle: rgba(255,255,255, 0.05);
  --sf-border-hover: rgba(59,91,219, 0.25);
  --sf-glass-border: rgba(255,255,255, 0.12);
  --sf-glass-border-accent: rgba(59,91,219, 0.30);
}
```

### Primary Accent (Indigo/Blue)

| Token | Hex | Usage |
|-------|-----|-------|
| `sfAccent` | `#3B5BDB` | Primary CTA color, active states |
| `sfAccentLight` | `#5B7CFA` | Lighter accent for text links, secondary highlights |
| `sfAccentLighter` | `#90A7FF` | Very light accent, disabled states |
| `sfAmberDeep` | `#223B8F` | Deep blue for gradient endpoints |

```css
:root {
  --sf-accent: #3B5BDB;
  --sf-accent-light: #5B7CFA;
  --sf-accent-lighter: #90A7FF;
  --sf-accent-deep: #223B8F;
}
```

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `sfSuccess` | `#22C55E` | Success states only |
| `sfSuccessLight` | `#4ADE80` | Light success text |
| `sfDanger` | `#EF4444` | Errors, destructive actions |
| `sfTeal` | `#2DD4BF` | Accent highlights, divider glow |
| `sfPurple` | `#A5B4FC` | Supplemental info |
| `sfIndigo` | `#6366F1` | Deep accent, avatar rings |
| `sfAmber` | `#7C83FD` | Warning (cool-toned, NOT traditional amber) |
| `sfAmberMuted` | `#5FA8D3` | Muted info/needs-attention |

```css
:root {
  --sf-success: #22C55E;
  --sf-success-light: #4ADE80;
  --sf-danger: #EF4444;
  --sf-teal: #2DD4BF;
  --sf-purple: #A5B4FC;
  --sf-indigo: #6366F1;
  --sf-amber: #7C83FD;       /* Note: purple-ish, NOT yellow */
  --sf-amber-muted: #5FA8D3;
}
```

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `sfTextPrimary` | `#FFFFFF` | Headings, primary text |
| `sfTextSecondary` | `#C2C7D0` | Descriptions, secondary labels |
| `sfMuted` | `#AEB5C2` | Timestamps, hints, disabled |

```css
:root {
  --sf-text-primary: #FFFFFF;
  --sf-text-secondary: #C2C7D0;
  --sf-muted: #AEB5C2;
}
```

### Glass Surfaces

| Token | Value | Usage |
|-------|-------|-------|
| `sfGlassBackground` | `rgba(255,255,255, 0.07)` | Glass fill base |
| `sfGlassScrim` | `rgba(0,0,0, 0.18)` | Dark scrim overlay on glass |
| `sfGlassSheen` | `rgba(255,255,255, 0.055)` | Top-left sheen |
| `sfGlassGlow` | `rgba(255,255,255, 0.14)` | Active glow |
| `sfGlassSelected` | `rgba(59,91,219, 0.15)` | Selected glass state |
| `sfGlassHover` | `rgba(255,255,255, 0.10)` | Hover glass state |

```css
:root {
  --sf-glass-bg: rgba(255,255,255, 0.07);
  --sf-glass-scrim: rgba(0,0,0, 0.18);
  --sf-glass-sheen: rgba(255,255,255, 0.055);
  --sf-glass-glow: rgba(255,255,255, 0.14);
  --sf-glass-selected: rgba(59,91,219, 0.15);
  --sf-glass-hover: rgba(255,255,255, 0.10);
}
```

### Atmospheric Tints (Hero Card Backgrounds)

| Token | Hex | Usage |
|-------|-----|-------|
| `sfAtmosphereGreen` | `#102521` | Success/green hero cards |
| `sfAtmosphereBlue` | `#111B2D` | Blue hero cards, default atmosphere |
| `sfAtmospherePurple` | `#23182F` | Purple hero cards |
| `sfAtmosphereWarm` | `#141C2B` | Warm/neutral cards |
| `sfAtmosphereTop` | `#03060E` | Near-black gradient start |
| `sfAtmosphereAccent` | `rgba(59,91,219, 0.06)` | Subtle accent tint |

---

## 2. Gradients

### Background Gradient (AppBackdrop — every page uses this)

```css
.app-backdrop {
  position: fixed;
  inset: 0;
  background:
    /* Base atmospheric gradient */
    linear-gradient(to bottom, #070708, #020203, #09090B);
  z-index: 0;
}

/* Accent radial glow — top right */
.app-backdrop::before {
  content: '';
  position: absolute;
  top: -120px;
  right: -40px;
  width: 640px;
  height: 640px;
  background: radial-gradient(circle, rgba(59,91,219, 0.18) 0%, transparent 100%);
  pointer-events: none;
}

/* White radial glow — top left */
.app-backdrop::after {
  content: '';
  position: absolute;
  top: -40px;
  left: -70px;
  width: 440px;
  height: 440px;
  background: radial-gradient(circle, rgba(255,255,255, 0.08) 0%, transparent 100%);
  pointer-events: none;
}
```

### Primary Accent Gradient (Buttons)

```css
.sf-accent-gradient {
  background: linear-gradient(to right, #223B8F, #5B7CFA, #223B8F);
}
```

### Hero Gradient (Page Headers)

```css
.sf-hero-gradient {
  background: linear-gradient(to bottom, #06101E, #000000);
}
```

### Card Accent Edge (Top Glow Line)

```css
.sf-card-accent-edge {
  background: linear-gradient(to right, transparent, rgba(91,124,250, 0.32), transparent);
  height: 1px;
}
```

### Divider Glow (Section Separators)

```css
.sf-divider-glow {
  background: linear-gradient(
    to right,
    transparent,
    rgba(45,212,191, 0.08),
    rgba(91,124,250, 0.18),
    rgba(45,212,191, 0.08),
    transparent
  );
  height: 1px;
}
```

### Flow Palette System (Gradient Cards Based on Position)

Cards use a position-based palette for visual variety. Given the item's index and the total count, select from these 5 palettes:

| Index | Highlight | Mid | Edge |
|-------|-----------|-----|------|
| 0 | `#8B5CF6` | `#4C1D95` | `#160B24` |
| 1 | `#6366F1` | `#312E81` | `#101126` |
| 2 | `#3B82F6` | `#1E3A8A` | `#0B1120` |
| 3 | `#0891B2` | `#155E75` | `#08161D` |
| 4 | `#10B981` | `#065F46` | `#071A18` |

**Interpolation**: `paletteIndex = round((index / (totalCount - 1)) * 4)`

---

## 3. Typography

### Font Families

| iOS Font | Web Equivalent | Usage |
|----------|---------------|-------|
| SF Rounded (`.design(.rounded)`) | `'Chakra Petch', system-ui` | Display headings |
| SF Pro (`.design(.default)`) | `'Sora', 'Inter', system-ui` | Body text |
| SF Mono (`.design(.monospaced)`) | `'Geist Mono', 'JetBrains Mono', monospace` | Mono text |

### Type Scale

| Role | Size | Weight | Letter-spacing | CSS Class |
|------|------|--------|----------------|-----------|
| Display | 36px | 700 | 0 | `.sf-display` |
| Headline Large | 28px | 700 | 0 | `.sf-headline-large` |
| Headline | 22px | 600 | 0 | `.sf-headline` |
| Title | 18px | 600 | 0 | `.sf-title` |
| Subheadline | 15px | 500 | 0 | `.sf-subheadline` |
| Body | 15px | 400 | 0 | `.sf-body` |
| Caption | 14px | 400 | 0 | `.sf-caption` |
| Caption Bold | 14px | 600 | 0 | `.sf-caption-bold` |
| Mini | 12px | 500 | 0 | `.sf-mini` |
| Section Label | 10–11px | 700–900 | 1.2–1.6px | `.sf-section-label` |
| Input Text | 16px | 400 | 0 | `.sf-input` (minimum to prevent iOS zoom) |

### Section Labels (Used Everywhere)

```css
.sf-section-label {
  font-size: 10px;
  font-weight: 800;  /* .black in iOS */
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: rgba(255,255,255, 0.38);
}
```

---

## 4. Spacing & Layout Tokens

### Spacing Scale

| Token | Value | CSS Variable | Usage |
|-------|-------|-------------|-------|
| `xs` | 4px | `--sp-xs` | Icon gaps, tight spacing |
| `sm` | 8px | `--sp-sm` | Inner gaps, badge padding |
| `md` | 16px | `--sp-md` | Standard insets, list row gaps |
| `lg` | 24px | `--sp-lg` | Section headers to content |
| `xl` | 32px | `--sp-xl` | Hero spacing |
| `xxl` | 48px | `--sp-xxl` | Empty state vertical padding |
| `pagePadding` | 16px | `--sp-page` | Horizontal page inset |
| `cardPadding` | 20px | `--sp-card` | Card inner padding |
| `sectionGap` | 24px | `--sp-section` | Between sections |
| `rowPadding` | 12px | `--sp-row` | List row vertical padding |

### Corner Radius Scale

| Token | Value | CSS Variable | Usage |
|-------|-------|-------------|-------|
| `card` | 16px | `--radius-card` | Cards, containers |
| `button` | 12px | `--radius-button` | Buttons |
| `input` | 12px | `--radius-input` | Input fields |
| `icon` | 8px | `--radius-icon` | Icon containers |
| `chip` | 6px | `--radius-chip` | Small chips |
| Badges/Pills | 9999px | `border-radius: 9999px` | Always capsule-shaped |

```css
:root {
  --sp-xs: 4px;   --sp-sm: 8px;   --sp-md: 16px;
  --sp-lg: 24px;  --sp-xl: 32px;  --sp-xxl: 48px;
  --sp-page: 16px; --sp-card: 20px; --sp-section: 24px; --sp-row: 12px;

  --radius-card: 16px;   --radius-button: 12px;
  --radius-input: 12px;  --radius-icon: 8px;  --radius-chip: 6px;
}
```

### Max Content Width (Coach Pages)

```css
.coach-page-content { max-width: 860px; margin: 0 auto; }
```

---

## 5. Card System

### 5a. Glass Card (`.glassCard()` / `.appCard()`)

The primary card treatment. Uses backdrop-filter for real glass blur on iOS; approximated with layered fills on web.

```css
.sf-glass-card {
  padding: 20px;
  border-radius: 16px;
  position: relative;

  /* Layer 1: Ultra-thin material (glass blur) */
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);

  /* Layer 2: Dark scrim */
  background:
    linear-gradient(135deg,
      rgba(255,255,255, 0.055),  /* sheen top-left */
      rgba(59,91,219, 0.08),     /* tint mid (when tint = accent) */
      rgba(255,255,255, 0.025),  /* subtle mid */
      transparent                 /* fade bottom-right */
    ),
    rgba(0,0,0, 0.18);           /* scrim base */

  /* Layer 3: Top-to-bottom lighting gradient */
  /* Applied as pseudo-element or additional background layer */

  /* Border */
  border: 1px solid rgba(255,255,255, 0.12);

  /* Top accent edge glow (partial stroke visible only top 10px) */
  /* Use pseudo-element with gradient stroke + mask */

  /* Shadow */
  box-shadow:
    0 8px 16px rgba(0,0,0, 0.12),
    0 1px 3px rgba(0,0,0, 0.05);
}
```

### 5b. Surface Card (`.sfSurfaceCard()`)

The universal dark surface card with atmospheric gradient + radial glow. Used on all client-facing and coach pages.

```css
.sf-surface-card {
  padding: 18px;
  border-radius: 26px;
  position: relative;
  overflow: hidden;

  /* Atmospheric gradient background */
  background: linear-gradient(
    to bottom left,
    rgba(var(--atmosphere-rgb), 0.12),  /* tinted top */
    rgba(0,0,0, 0.92)                   /* near-black bottom */
  );

  /* Radial glow overlay */
  /* Use pseudo-element for the radial highlight glow */
  border: 1px solid rgba(255,255,255, 0.08);
}

.sf-surface-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(
    circle at top center,
    rgba(var(--highlight-rgb), 0.15) 0%,
    transparent 260px
  );
  pointer-events: none;
}

/* Default blue palette (flowIndex:2, totalCount:5) */
.sf-surface-card { --atmosphere-rgb: 30,58,138;  --highlight-rgb: 59,130,246; }

/* Status variants */
.sf-surface-card.reviewed { --atmosphere-rgb: 5,150,105;  --highlight-rgb: 16,37,33; }
.sf-surface-card.overdue  { --atmosphere-rgb: 153,27,27;  --highlight-rgb: 248,113,113; }
.sf-surface-card.due      { --atmosphere-rgb: 180,83,9;   --highlight-rgb: 251,191,36; }
```

### 5c. Clean Profile Card (Client Profile, Instagram-style)

Minimal card used in the client Profile view.

```css
.sf-clean-card {
  padding: 18px;
  border-radius: 20px;
  background: rgba(255,255,255, 0.04);
  border: 0.5px solid rgba(255,255,255, 0.06);
}
```

### 5d. UHCard (Ultrahuman-Style Section Card)

Has an embedded section label badge in the top-left corner.

```css
.sf-uh-card {
  /* Same glass treatment as .sf-glass-card */
  padding: 20px;
  border-radius: 16px;
  position: relative;
}

/* Section label badge inside the card */
.sf-uh-card .section-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--sf-text-secondary);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255, 0.08);
  border-radius: 9999px;
}

/* Optional atmosphere tint overlay */
.sf-uh-card.atmosphere-green::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(16,37,33, 0.18), transparent);
  pointer-events: none;
}
```

### 5e. Stat Card (Metrics)

```css
.sf-stat-card {
  padding: 20px;
  border-radius: 16px;
  background: var(--sf-surface);
  border: 1px solid var(--sf-border);
  flex: 1;
}

.sf-stat-card .value {
  font-size: 24px;
  font-weight: 700;
  color: var(--sf-text-primary);
  line-height: 1;
}

.sf-stat-card .label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--sf-muted);
  margin-top: 4px;
}
```

### 5f. Info Card

```css
.sf-info-card {
  /* Same as .sf-glass-card with appCard treatment */
  padding: 16px 20px;
}

.sf-info-card .label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--sf-muted);
}

.sf-info-card .value {
  font-size: 20px;
  font-weight: 700;
  color: var(--sf-text-primary);
  margin-top: 6px;
}
```

---

## 6. Badge System (`SFBadge`)

### Badge Styling

```css
.sf-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 9999px;
  white-space: nowrap;
}
```

### Semantic Variants

| Semantic | Text Color | Background | States |
|----------|-----------|------------|--------|
| `success` | `#34D399` | `rgba(52,211,153, 0.10)` | reviewed, active, accepted, completed, published, forms_signed |
| `warning` | `#7C83FD` | `rgba(124,131,253, 0.12)` | submitted, pending, draft, intake_submitted |
| `danger` | `#F87171` | `rgba(248,113,113, 0.12)` | overdue, declined, rejected |
| `info` | `#C2C7D0` | `#1A1A1A` | due, contacted, in_progress, call_scheduled |
| `neutral` | `#A1A1AA` | `#27272A` | upcoming, unknown |
| `stage` | `#22D3EE` | `rgba(34,211,238, 0.10)` | consultation_scheduled, intake_sent, forms_sent |
| `purple` | `#A78BFA` | `rgba(167,139,250, 0.10)` | intake-related, supplemental |

```css
.sf-badge.success  { color: #34D399; background: rgba(52,211,153, 0.10); }
.sf-badge.warning  { color: #7C83FD; background: rgba(124,131,253, 0.12); }
.sf-badge.danger   { color: #F87171; background: rgba(248,113,113, 0.12); }
.sf-badge.info     { color: #C2C7D0; background: #1A1A1A; }
.sf-badge.neutral  { color: #A1A1AA; background: #27272A; }
.sf-badge.stage    { color: #22D3EE; background: rgba(34,211,238, 0.10); }
.sf-badge.purple   { color: #A78BFA; background: rgba(167,139,250, 0.10); }
```

### Status → Label Mapping

| Raw Status | Display Label |
|-----------|--------------|
| `overdue` | Overdue |
| `submitted` | Submitted |
| `reviewed` | Reviewed |
| `due` | Due Today |
| `upcoming` | Upcoming |
| `published` | Published |
| `draft` | Draft |
| `pending` | Pending |
| `contacted` | Contacted |
| `call_scheduled` | Call Scheduled |
| `active` / `accepted` | Active |
| `declined` / `rejected` | Inactive |
| `in_progress` | In Progress |
| `completed` | Completed |
| `consultation_scheduled` | Consultation |
| `intake_sent` | Intake Sent |
| `intake_submitted` | Intake Received |
| `forms_signed` | Signed |
| `forms_sent` | Forms Sent |

---

## 7. Button System

### Primary Button (`.sfPrimary` / `SFActionButton` `.primary`)

```css
.sf-btn-primary {
  font-size: 15px;
  font-weight: 600;
  color: #FFFFFF;
  padding: 15px 16px;
  border-radius: 12px;
  width: 100%;
  border: 1px solid rgba(59,91,219, 0.65);
  background: linear-gradient(to right, #223B8F, #3B5BDB, #223B8F);
  box-shadow: 0 8px 12px rgba(59,91,219, 0.28);
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.sf-btn-primary:active {
  transform: scale(0.97);
  opacity: 0.9;
}
```

### Pill Primary Button (`.sfPrimary` ButtonStyle — capsule variant)

```css
.sf-btn-primary-pill {
  font-size: 16px;
  font-weight: 600;
  color: #FFFFFF;
  padding: 14px 24px;
  border-radius: 9999px;
  background: linear-gradient(to right, #223B8F, #5B7CFA, #223B8F);
  border: 1px solid rgba(91,124,250, 0.3);
  box-shadow: 0 4px 12px rgba(59,91,219, 0.4);
  transition: transform 0.15s ease, opacity 0.15s ease;
}
```

### Secondary Button

```css
.sf-btn-secondary {
  font-size: 15px;
  font-weight: 600;
  color: #5B7CFA;
  padding: 12px 16px;
  border-radius: 12px;
  width: 100%;
  backdrop-filter: blur(12px);
  background: rgba(0,0,0, 0.18);
  border: 1px solid rgba(255,255,255, 0.12);
}
```

### Destructive Button

```css
.sf-btn-destructive {
  font-size: 15px;
  font-weight: 600;
  color: #F87171;
  padding: 15px 16px;
  border-radius: 12px;
  width: 100%;
  backdrop-filter: blur(12px);
  background: rgba(0,0,0, 0.18);
  border: 1px solid rgba(248,113,113, 0.25);
}
```

### Sign-Out Button (Special)

```css
.sf-btn-signout {
  font-size: 15px;
  font-weight: 600;
  color: #F87171;
  padding: 14px;
  width: 100%;
  text-align: center;
  border-radius: 18px;
  background: rgba(248,113,113, 0.06);
  border: 1px solid rgba(248,113,113, 0.12);
}
```

### Role Switch Button (Special — Purple)

```css
.sf-btn-role-switch {
  padding: 16px;
  border-radius: 20px;
  background: rgba(167,139,250, 0.06);
  border: 1px solid rgba(167,139,250, 0.14);
}

.sf-btn-role-switch .icon { color: #A78BFA; }
.sf-btn-role-switch .title { color: #FFFFFF; font-weight: 600; }
.sf-btn-role-switch .subtitle { color: rgba(255,255,255, 0.44); font-size: 12px; }
```

---

## 8. Input Fields

### Text Input

```css
.sf-input {
  min-height: 48px;
  padding: 0 14px;
  font-size: 16px; /* MUST be 16px — prevents iOS zoom */
  color: var(--sf-text-primary);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  background: rgba(0,0,0, 0.18);
  border: 1px solid var(--sf-glass-border);
  transition: border-color 0.15s ease;
}

.sf-input:focus {
  border-color: rgba(59,91,219, 0.9);
  outline: none;
}

.sf-input.error {
  border-color: rgba(248,113,113, 0.7);
}

.sf-input-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--sf-muted);
  letter-spacing: 0.3px;
  margin-bottom: 6px;
}

.sf-input-error {
  font-size: 12px;
  color: #F87171;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}
```

### Text Area

```css
.sf-textarea {
  min-height: 80px;
  max-height: 200px;
  padding: 12px 14px;
  font-size: 16px;
  color: var(--sf-text-primary);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  background: rgba(0,0,0, 0.18);
  border: 1px solid var(--sf-glass-border);
  resize: vertical;
}

.sf-textarea::placeholder {
  color: #52525B;
}
```

### Dropdown/Menu Picker

```css
.sf-select {
  min-height: 48px;
  padding: 0 14px;
  font-size: 16px;
  color: var(--sf-text-primary);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  background: rgba(0,0,0, 0.18);
  border: 1px solid var(--sf-glass-border);
  appearance: none;
}
```

---

## 9. Avatar Component

### Gradient Avatar Ring

```css
.sf-avatar {
  position: relative;
  width: 44px;  /* default size — also 60px, 80px, 96px variants */
  height: 44px;
  border-radius: 9999px;
}

/* Ring gradient: indigo → violet */
.sf-avatar .ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 2px solid transparent;
  background: linear-gradient(135deg, #6366F1, #8B5CF6) border-box;
  -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
}

/* Initials fallback */
.sf-avatar .initials {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #27272A;
  border-radius: 9999px;
  font-size: 14px; /* size * 0.33 */
  font-weight: 700;
  color: #FFFFFF;
}

/* Photo */
.sf-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 9999px;
}
```

### Avatar Sizes

| Context | Size |
|---------|------|
| Client list row | 44px |
| Coach inbox row | 46px |
| Client detail hero | 60px |
| Client profile hero | 80px |
| Edit profile | 96px |

---

## 10. Loading State

### SteadfastLoadingView (Full-Page)

```css
.sf-loading-view {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #070C18;
  z-index: 999;
  gap: 32px;
}

.sf-loading-view .logo {
  width: 64px;
  height: 64px;
  animation: pulse-logo 1.6s ease-in-out infinite alternate;
}

.sf-loading-view .wordmark {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 3.5px;
  color: rgba(255,255,255, 0.7);
}

.sf-loading-view .progress-bar {
  width: 200px;
  height: 3px;
  background: rgba(255,255,255, 0.06);
  border-radius: 9999px;
  overflow: hidden;
  position: relative;
}

.sf-loading-view .progress-bar .indicator {
  width: 35%;
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(to right,
    rgba(59,130,246, 0),
    #3B82F6,
    #8B5CF6,
    rgba(139,92,246, 0)
  );
  animation: slide-bar 1.2s linear infinite;
}

.sf-loading-view .message {
  font-size: 13px;
  font-weight: 500;
  color: rgba(255,255,255, 0.35);
}

@keyframes pulse-logo { from { opacity: 0.6; } to { opacity: 1; } }
@keyframes slide-bar { from { transform: translateX(-100%); } to { transform: translateX(190%); } }
```

---

## 11. Empty State

```css
.sf-empty-state {
  padding: 48px 20px;
  text-align: center;
  border: 1px dashed rgba(63,63,70, 0.6);  /* zinc-700/60 */
  border-radius: 16px;
}

.sf-empty-state .icon {
  font-size: 28px;
  font-weight: 300;
  color: rgba(174,181,194, 0.6);  /* sfMuted at 60% */
  margin-bottom: 16px;
}

.sf-empty-state .title {
  font-size: 15px;
  font-weight: 400;
  color: var(--sf-muted);
}

.sf-empty-state .subtitle {
  font-size: 14px;
  color: rgba(174,181,194, 0.6);
  margin-top: 4px;
}

.sf-empty-state .cta {
  font-size: 14px;
  font-weight: 600;
  color: var(--sf-accent-light);
  margin-top: 16px;
  background: none;
  border: none;
  cursor: pointer;
}
```

---

## 12. Section Container & Dividers

### Section Label Header

```css
.sf-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sf-section-header .icon {
  font-size: 10px;
  font-weight: 600;
  color: rgba(194,199,208, 0.85);
}

.sf-section-header .label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: rgba(194,199,208, 0.92);
}

.sf-section-header .action {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255, 0.88);
  margin-left: auto;
}
```

### Glow Divider

```css
.sf-glow-divider {
  height: 1px;
  background: linear-gradient(
    to right,
    transparent,
    rgba(45,212,191, 0.08),
    rgba(91,124,250, 0.18),
    rgba(45,212,191, 0.08),
    transparent
  );
}
```

### Simple Divider

```css
.sf-divider {
  height: 1px;
  background: rgba(255,255,255, 0.04);
}
```

---

## 13. Shadows

### Primary Button Shadow

```css
.shadow-primary {
  box-shadow: 0 4px 8px rgba(59,91,219, 0.30);
}
```

### Floating Area Shadow (Sticky Bottom Bars)

```css
.shadow-floating {
  box-shadow: 0 -4px 20px rgba(0,0,0, 0.40);
}
```

### Card Shadow (Glass Cards)

```css
.shadow-card {
  box-shadow:
    0 8px 16px rgba(0,0,0, 0.12),
    0 1px 3px rgba(0,0,0, 0.05);
}
```

---

## 14. Macro Bar (Nutrition Display)

```css
.sf-macro-bar {
  display: flex;
  height: 5px;
  gap: 2px;
  border-radius: 9999px;
  overflow: hidden;
}

.sf-macro-bar .protein { background: #5B7CFA; flex: var(--protein-ratio); }
.sf-macro-bar .carbs   { background: #7C83FD; flex: var(--carbs-ratio); }
.sf-macro-bar .fats    { background: #34D399; flex: var(--fats-ratio); }

/* Macro label colors */
.macro-label.protein { color: #5B7CFA; }
.macro-label.carbs   { color: #7C83FD; }
.macro-label.fats    { color: #34D399; }
.macro-label.cals    { color: #FFFFFF; }
```

---

## 15. Accessibility Requirements

| Rule | Implementation |
|------|---------------|
| Min tap target | 48px height on all interactive elements |
| Input font size | 16px minimum (prevents iOS keyboard zoom) |
| Labels on icons | `aria-label` on icon-only buttons |
| Color + text | All badges use both text label AND color |
| Heading semantics | Section labels use `role="heading"` |

---

## 16. Quick Reference — Complete CSS Variables Block

```css
:root {
  /* Backgrounds */
  --sf-bg: #000000;
  --sf-bg-raised: #08080A;
  --sf-bg-soft: #111114;
  --sf-surface: #1A1A1A;
  --sf-surface-elevated: #222222;

  /* Accents */
  --sf-accent: #3B5BDB;
  --sf-accent-light: #5B7CFA;
  --sf-accent-lighter: #90A7FF;
  --sf-accent-deep: #223B8F;

  /* Semantic */
  --sf-success: #22C55E;
  --sf-success-light: #4ADE80;
  --sf-danger: #EF4444;
  --sf-danger-light: #F87171;
  --sf-warning: #7C83FD;
  --sf-teal: #2DD4BF;
  --sf-purple: #A5B4FC;
  --sf-indigo: #6366F1;
  --sf-violet: #A78BFA;
  --sf-cyan: #22D3EE;
  --sf-amber-warm: #FBBF24;

  /* Text */
  --sf-text: #FFFFFF;
  --sf-text-secondary: #C2C7D0;
  --sf-muted: #AEB5C2;

  /* Borders */
  --sf-border: rgba(255,255,255, 0.08);
  --sf-border-subtle: rgba(255,255,255, 0.05);
  --sf-glass-border: rgba(255,255,255, 0.12);
  --sf-glass-border-accent: rgba(59,91,219, 0.30);

  /* Glass */
  --sf-glass-scrim: rgba(0,0,0, 0.18);
  --sf-glass-sheen: rgba(255,255,255, 0.055);

  /* Atmosphere */
  --sf-atm-green: #102521;
  --sf-atm-blue: #111B2D;
  --sf-atm-purple: #23182F;
  --sf-atm-warm: #141C2B;

  /* Spacing */
  --sp-xs: 4px;  --sp-sm: 8px;  --sp-md: 16px;
  --sp-lg: 24px; --sp-xl: 32px; --sp-xxl: 48px;
  --sp-page: 16px; --sp-card: 20px; --sp-section: 24px; --sp-row: 12px;

  /* Radius */
  --r-card: 16px; --r-button: 12px; --r-input: 12px;
  --r-icon: 8px;  --r-chip: 6px;   --r-pill: 9999px;
}
```
