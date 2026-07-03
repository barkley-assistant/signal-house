# Signal House Design System

A minimal dashboard design system so implementation stays coherent across developers. Spacing, typography, color, borders, and component rules.

> Every visual decision in every other issue derives from here. Do not start any other frontend work before this is documented.

---

## 1. Color Palette

Tailwind CSS v4 extension, dark theme only — Signal House is an operator dashboard.

### Surface hierarchy (dark)

| Token        | Value     | Usage              |
| ------------ | --------- | ------------------ |
| `page-bg`    | `#07080a` | Near-black page    |
| `card-bg`    | `#111318` | Dark card surface  |
| `card-hover` | `#1a1d24` | Hover state        |
| `card-border`| `#1e2128` | Card borders       |
| `divider`    | `#262a33` | Subtle dividers    |

### Text hierarchy

| Token            | Value     | Usage                      |
| ---------------- | --------- | -------------------------- |
| `text-primary`   | `#f1f5f9` | Primary text               |
| `text-secondary` | `#94a3b8` | Secondary text             |
| `text-muted`     | `#64748b` | Muted text                 |
| `text-disabled`  | `#475569` | Disabled text              |

### Status colors

| Token     | Value     | Tailwind ref |
| --------- | --------- | ------------ |
| `success` | `#4ade80` | green-400    |
| `warning` | `#fbbf24` | amber-400    |
| `error`   | `#f87171` | red-400      |
| `info`    | `#38bdf8` | sky-400      |
| `stale`   | `#a78bfa` | violet-400   |
| `neutral` | `#64748b` | slate-500    |

### Accent

| Token    | Value                          |
| -------- | ------------------------------ |
| `primary`| `#38bdf8` (sky-400)           |
| `subtle` | `rgba(56, 189, 248, 0.08)`    |

Register these in `tailwind.config.ts` or `globals.css` `@theme` block (Tailwind v4).

### Rules

- ONE consistent color assignment per status state (never multiple mappings).
- Sparse accent color: only for active/selected/urgent, never decoration.
- No hex values in component code — all through Tailwind utilities.

---

## 1b. Background Depth

Avoid flat solid backgrounds. The page background should have subtle depth. Apply a near-black base with an extremely subtle noise/grain texture overlay:

```css
body {
  background: #07080a;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='0.015'/></svg>");
  pointer-events: none;
  z-index: -1;
}
```

Card surfaces use a slightly lighter tone with a thin border rather than shadows for separation. **Do NOT use box-shadows on cards.**

---

## 2. Typography

Fonts are loaded via `next/font` in `app/layout.tsx` (handled by #154):

```ts
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import localFont from 'next/font/local'

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})
const satoshi = localFont({
  src: './fonts/Satoshi-Variable.woff2',
  variable: '--font-heading',
})
```

### CSS variable references

| Role          | Variable            | Font            |
| ------------- | ------------------- | --------------- |
| Headings      | `--font-heading`    | Satoshi         |
| Body          | `--font-body`       | Instrument Sans |
| Data/numbers  | `--font-mono`       | JetBrains Mono  |

### Scale

Per frontend guidelines — dramatic jumps, not timid increments:

| Token     | Size  | Usage                                    |
| --------- | ----- | ---------------------------------------- |
| `caption` | 12px  | Metadata, badges                         |
| `small`   | 14px  | Timestamps, secondary labels             |
| `body`    | 16px  | Default body text (minimum legible size) |
| `large`   | 18px  | Card headings, section titles            |
| `h3`      | 24px  | Subsection headings (1.5x jump)          |
| `h2`      | 32px  | Section headings (2x jump)               |
| `h1`      | 40px  | Page title (only one per page, 2.5x)     |

### Weights

- Headings: 600–700
- Body: 400
- Metric values: 700 (monospace condensed)

### Number formatting

- Dashboard values use grouped full numbers by default, for example `1,234,567`.
- Compact notation, such as `1.2M`, is reserved for cramped chart axes or similarly tight spaces.
- Use the shared number-formatting utility rather than local component helpers, so tables, cards, and tooltips stay consistent.

### Line height

- Body: 1.5–1.6
- Headings: 1.2

---

## 3. Spacing

Use the Tailwind scale — no custom values.

| Context       | Token   | Value   |
| ------------- | ------- | ------- |
| Section spacing | `p-6` | 24px  |
| Card padding  | `p-4`   | 16px    |
| Card gap      | `gap-3` | 12px    |
| Grid gap      | `gap-4` | 16px    |
| Content max   | —       | 1280px  |

---

## 4. Border Radius

| Element   | Token          | Value |
| --------- | -------------- | ----- |
| Cards     | `rounded-lg`   | 8px   |
| Badges    | `rounded-full` | —     |
| Buttons   | `rounded-md`   | 6px   |
| Inputs    | `rounded-md`   | 6px   |
| Tooltips  | `rounded-md`   | 6px   |

---

## 5. Shadows and Elevation

- **No box-shadows on cards** (use borders instead).
- Shadows only for:
  - Dropdown: `shadow-lg` + `rgba(0,0,0,0.4)`
  - Modal backdrop: `bg-black/40 backdrop-blur-sm`
  - Hover lift: `translateY(-1px)`

---

## 6. Transitions

### Default

`transition-all duration-150 ease-out` (Tailwind, framework-agnostic)

### Entrance animations

Framer Motion `motion.div`:

```ts
initial={{ opacity: 0, y: 4 }}
animate={{ opacity: 1, y: 0 }}
// duration: 0.3
```

Staggered at 80ms between items.

### Reduced motion

Respect `prefers-reduced-motion: reduce`.

### Staggered list pattern

```tsx
import { motion } from 'framer-motion'

const container = {
  animate: { transition: { staggerChildren: 0.08 } },
}

const item = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
}

// Usage:
<motion.div variants={container} initial="initial" animate="animate">
  {items.map(item => (
    <motion.div key={item.id} variants={item}>
      ...
    </motion.div>
  ))}
</motion.div>
```

---

## 7. shadcn/ui Theming (`globals.css`)

shadcn/ui uses CSS variables for theming. These override the defaults after `npx shadcn@latest init`:

```css
/* Dark theme overrides for Signal House */
:root {
  --background: #07080a;
  --foreground: #f1f5f9;
  --card: #111318;
  --card-foreground: #f1f5f9;
  --border: #1e2128;
  --primary: #38bdf8;
  --primary-foreground: #07080a;
  --secondary: #1a1d24;
  --secondary-foreground: #94a3b8;
  --muted: #1a1d24;
  --muted-foreground: #64748b;
  --accent: rgba(56, 189, 248, 0.08);
  --accent-foreground: #38bdf8;
  --destructive: #f87171;
  --destructive-foreground: #07080a;
  --ring: #38bdf8;
  --radius: 0.5rem;
}
```

---

## 8. Performance Guidelines

- Health summary cards and status strip are above the fold — eager render.
- Attention queue and model usage sections are below the fold — use `next/dynamic` with `ssr: false` for non-critical sections.
- The source diagnostics panel must be lazy — never fetch or render it until the user expands it.
- Trend charts should use ECharts' `notMerge` option on updates to prevent memory leaks from accumulated chart instances.
- No section should cause layout shift (CLS > 0) — all state placeholders (skeletons) must reserve exact real-content dimensions.
- Target: initial content render within 1.5s on LAN, interactive within 2.5s.

---

## 9. One Memorable Element

Every page needs one unforgettable design choice. For Signal House this is the **animated health summary strip** — five cards that pulse-stagger into view on page load (80ms delay between each card, 300ms ease-out entrance, implemented via Framer Motion). This is the first thing the user sees and it should feel alive, not static.

- The animation must respect `prefers-reduced-motion: reduce`.
- Only play once per page load (not on every refresh).

---

## 10. Clickable Elements

**Rule: every clickable element must show `cursor: pointer` on hover.** Tailwind CSS v4 preflight does not add `cursor: pointer` to `<button>` elements — the browser default is `cursor: default`, which makes interactive controls feel broken. This applies regardless of how the element is implemented.

### Pattern A — shadcn/ui `<Button>` component

The base `Button` component (`frontend/src/components/ui/button.tsx`) already includes `cursor-pointer` in its `buttonVariants` cva base class. Any new variant or size added to `buttonVariants` inherits the cursor for free. Prefer `<Button>` whenever possible so this stays automatic.

### Pattern B — native `<button>` elements

For raw `<button type="button">` elements used outside the `<Button>` component (dismiss controls, expand/collapse toggles, day-pickers, status pills, etc.) add `cursor-pointer` explicitly to the className:

```tsx
<button
  type="button"
  onClick={handleDismiss}
  className="cursor-pointer rounded px-2 py-1 text-xs ..."
>
  Dismiss
</button>
```

Native buttons in this codebase that already follow Pattern B include the error/stale banner dismiss buttons in `app/page.tsx`, the source-health chevron toggle, the model-usage expand/collapse button, and the daily-token-usage day selector buttons.

### Pattern C — non-semantic clickable elements (div / span with onClick)

For `<div>` or `<span>` used as buttons, `cursor-pointer` alone is not enough — full a11y parity with `<button>` is required:

1. `cursor-pointer` in the className (signals interactivity to pointer users).
2. `role="button"` (announces the element to assistive tech).
3. `tabIndex={0}` (makes it focusable via keyboard).
4. `onKeyDown` handler for `Enter` and `Space` (provides keyboard activation).
5. An `aria-label` or visible text (provides an accessible name).

Example — already in use in `AttentionRow.tsx`, `ModelUsageRankList.tsx`, and the page.tsx attention queue:

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={onToggle}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }}
  className="cursor-pointer rounded-lg border ..."
  aria-label="Toggle details"
>
  ...
</div>
```

### Anti-patterns

- **Do NOT** add `cursor-pointer` to non-interactive cards or display-only containers. It is a strong affordance that promises a click action — using it on a static card misleads users.
- **Do NOT** rely on the browser default for `<button>`. Always add `cursor-pointer` to raw native buttons (Pattern B) or use the `<Button>` component (Pattern A).
- **Do NOT** use `<div onClick>` without Pattern C's full a11y treatment. A click handler alone is not an accessible button.
