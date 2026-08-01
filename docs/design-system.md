# Signal House — Design System (V2)

A minimal design system for a dark operator dashboard. This is the source
of truth for how Signal House *looks*; the tokens live in
`src/web/styles/tokens.css`, and every component style lives in
`src/web/styles/base.css` + `src/web/styles/components.css`. If you change
a visual anywhere, the token changes here first.

> Every visual decision derives from this file. If you're tempted to add a
> new color, a new radius, or a font that isn't listed here — don't. Extend
> the system, never bypass it.

---

## 1. Design personality

Signal House is a **dark operator dashboard for people who are probably
tired**. It should feel calm, dense, and honest:

- Near-black surfaces, thin borders instead of shadows. **No box-shadows
  on cards. Ever.** Borders are how we separate; shadows are how we
  apologise.
- A subtle grain overlay on the page background — depth without noise.
- Sparse accent color. Sky blue (`#38bdf8`) is the only accent and it's
  reserved for active/selected/urgent, never decoration.
- Numbers are the stars. JetBrains Mono, bold, slightly larger than you'd
  think. The dashboard's job is to tell the truth about numbers, so they
  get the good seats.
- One memorable element: the **health strip** — five cards that stagger
  into view on page load (80ms apart, 300ms ease-out). It plays once per
  load, and it respects `prefers-reduced-motion`.

## 2. Color palette

### Surfaces (dark)

| Token | Value | Usage |
|---|---|---|
| `--page-bg` | `#07080a` | Near-black page background |
| `--card-bg` | `#111318` | Card surface |
| `--card-hover` | `#1a1d24` | Card/control hover |
| `--card-border` | `#1e2128` | Card borders |
| `--divider` | `#262a33` | Subtle dividers, gridlines |

### Text

| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#f1f5f9` | Primary text |
| `--text-secondary` | `#94a3b8` | Secondary text, captions |
| `--text-muted` | `#64748b` | Muted text, metadata |
| `--text-disabled` | `#475569` | Disabled |

### Status

| Token | Value | Usage |
|---|---|---|
| `--success` | `#4ade80` | healthy / passing |
| `--warning` | `#fbbf24` | stale / partial |
| `--error` | `#f87171` | failed |
| `--info` | `#38bdf8` | informational |
| `--stale` | `#a78bfa` | stale-item flag |
| `--neutral` | `#64748b` | unavailable / unknown |

### Accent

| Token | Value |
|---|---|
| `--primary` | `#38bdf8` (sky) |
| `--subtle` | `rgba(56, 189, 248, 0.08)` |

### Rules

- ONE consistent color per status state — never multiple mappings.
- Sparse accent: only for active/selected/urgent, never decoration.
- No hex values in component code. Everything through the CSS variables.

## 3. Typography

- **Satoshi** (headings, `--font-heading`), 600–700 weight.
- **Instrument Sans** (body, `--font-body`), 400–500 weight.
- **JetBrains Mono** (numbers + code, `--font-mono`), 400–700 weight.

Fonts load via `@import` in `base.css` (Google Fonts + Fontshare);
they are runtime assets like any other.

### Scale

| Token | Size | Usage |
|---|---|---|
| caption | 12px | Metadata, badges, table cells |
| small | 14px | Secondary labels, buttons, timestamps |
| body | 16px | Default body text (minimum legible size) |
| large | 18px | Card headings, section titles |
| h3 | 24px | Subsection headings |
| h2 | 32px | Section headings |
| h1 | 40px | Page title (one per page) |

### Number formatting

- Grouped full numbers by default: `1,234,567`.
- Compact notation (`1.2M`) is reserved for chart axes and cramped cells.
- **Always** use the shared helpers in `src/shared/format.ts`
  (`formatNumber`, `formatCompact`, `formatCost`) — never local
  formatters. Tables, cards, and tooltips must agree.
- Unknown values render as `—` (em dash). **Never `0`.** The `null → "—"`
  contract is the dashboard's whole personality.

### Line height

- Body: 1.5–1.6 · Headings: 1.2

## 4. Spacing & layout

| Context | Value |
|---|---|
| Card padding | 16px |
| Card gap | 12px (grid gap 16px) |
| Section spacing | 24px |
| Content max width | 1280px |

Layout is responsive by construction: the health strip collapses to 2
columns on mobile, the headline tiles to 1, tables that need width scroll
inside their cards (see `.model-table` — the wrapper scrolls, the page
never does). Page-level horizontal overflow at ≤430px is a bug, not a
feature.

## 5. Radius

| Element | Value |
|---|---|
| Cards | 8px (`--radius-card`) |
| Buttons / inputs / tooltips | 6px (`--radius-control`) |
| Badges | pill |

## 6. Elevation & transitions

- **No box-shadows on cards.** Dropdowns only: `shadow-lg` + black/40.
- Modal backdrop: black/40 + `backdrop-blur-sm`.
- Default transition: `150ms ease-out`.
- Entrance animations via Framer Motion:

```tsx
initial={{ opacity: 0, y: 4 }}
animate={{ opacity: 1, y: 0 }}
// duration: 0.3, staggerChildren: 0.08
```

- Respect `prefers-reduced-motion: reduce` — the CSS base layer handles it.
- Health strip plays its entrance exactly once per page load.

## 7. Components

### Cards

`section.card` — the universal container: `--card-bg`, 1px
`--card-border`, 8px radius, 16px padding, 12px `margin-top` rhythm.
Headings use the `.kpi-tile__label` caption pattern or `h2` for section
titles. Cards carry an `aria-label` describing their content.

### The health strip

`.health-strip` → a grid of `.kpi-tile` cards. Each tile:

- `.kpi-tile__label` — caption with a status `.dot` (success/info/warning/
  error/neutral)
- `.big-number` — JetBrains Mono 700, the star of the show
- `.kpi-caption` — secondary context line

### Headline tiles (Agent Spend)

`.headline-tiles` → 3-col grid (1-col on mobile) of `.kpi-tile` reusing the
health-strip grammar, with `.big-number.total` (40px mono) for cost /
sessions / tokens. `.spend-subtiles` stack below: per-source tiles
(OpenCode / Hermes / Combined) in `.card.spend-tile`.

### Tables

`table.data` — the shared data table. Mono numbers, right-aligned `.num`
cells, sortable headers via `.sort-btn` + `.sort-arrow`. The by-model
table is pinned to `min-width: 480px` inside a `.model-table` wrapper with
`overflow-x: auto` — it scrolls inside the card on narrow screens instead
of poking out.

### Charts

ECharts 6, `dark` theme, transparent background, `containLabel` grid.
Cost line sky `#38bdf8`, tokens line yellow `#facc15` (the one place
yellow appears — it's the tokens color). Axis labels muted, split lines
faint `#232732`. Y-axis peaks are computed once from the first dataset and
frozen — legend toggles re-anchor axes, they never rescale the surviving
line out of context.

### States

- **Loading:** `.skeleton` blocks that reserve exact real-content
  dimensions — zero layout shift (CLS).
- **No data:** explicit `—` or a `.state-label` ("No usage telemetry yet
  …"). Never zeros.
- **Failure:** `.banner.banner--error` with `role="alert"`.
- **Interactivity:** every clickable element shows `cursor: pointer`
  (base.css covers `button`, `[role="button"]`, `label[for]`, `select`,
  `summary`). Non-semantic clickables get `role="button"`, `tabIndex`,
  and keyboard handlers — full a11y parity or not at all.

## 8. Performance

- Health strip + headline are above the fold — eager render.
- **Source Diagnostics is lazy** — never fetched or rendered until the
  operator expands the panel.
- ECharts instances are disposed on unmount and resized via
  `ResizeObserver`; no accumulated instances, no leaked observers.
- No section causes layout shift — skeletons reserve exact dimensions.
- Target: initial content render < 1.5s on LAN, interactive < 2.5s.
