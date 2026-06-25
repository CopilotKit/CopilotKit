# Northwind Finance — Design System ("Aurora")

A premium, airy, light-theme fintech aesthetic for the banking demo. This is a
**visual layer**: it restyles the existing app without changing logic, data
flow, REST calls, the CopilotKit provider/runtime, HITL approval flows, the
threads drawer, auth/role gating, or the teachable policy-exception gate.

The system is token-driven. Tokens live in
[`src/app/globals.css`](../src/app/globals.css) as CSS custom properties,
surfaced to Tailwind v4 via `@theme inline` so utilities like `bg-surface`,
`text-ink-muted`, `from-brand-violet`, `ring-brand`, `bg-positive` resolve
everywhere. Both **light** (the primary showcase mode) and **dark** are fully
supported via the class-based `.light` / `.dark` toggle on `<html>`.

## Design language

- **Mood** — premium, airy, modern. Generous whitespace, soft layered shadows,
  large radii, glassmorphism-lite surfaces.
- **Canvas** — a soft lavender/lilac page background; content floats above it on
  white glass cards.
- **Primary** — a violet→indigo gradient (`#7C5CFC` → `#5B3DF5`), reused on the
  primary button, the active nav icon, the credit-card face, progress bars, and
  CTAs (`.brand-gradient`).
- **Semantics** — income/positive is emerald green with an up-and-right arrow;
  expense/negative is rose/red with a down-and-right arrow.
- **Typography** — Inter (loaded via `next/font/google`, exposed as
  `--font-inter` → `--font-sans`). Very large bold balance numbers, small
  muted-grey labels, medium-weight violet section headings (`.section-heading`).
- **Shape** — cards ~22px radius (`rounded-2xl` / `--radius`), buttons fully
  rounded pills (`rounded-full`), inputs/menus ~12–16px.

## Color tokens

All colors are HSL triplets behind `hsl(var(--token))`, exposed as Tailwind
colors (`brand`, `brand-violet`, `brand-indigo`, `brand-soft`, `surface`,
`surface-muted`, `canvas`, `ink`, `ink-muted`, `positive`, `positive-soft`,
`negative`, `negative-soft`, `hairline`).

| Token               | Light         | Dark          | Role                                    |
| ------------------- | ------------- | ------------- | --------------------------------------- |
| `--canvas`          | `255 60% 97%` | `252 30% 7%`  | App background (lavender / deep indigo) |
| `--surface`         | `0 0% 100%`   | `252 24% 11%` | Cards, sidebar, menus                   |
| `--surface-muted`   | `252 40% 98%` | `252 22% 14%` | Row hover, inset blocks                 |
| `--ink`             | `252 30% 14%` | `250 30% 96%` | Primary text / headings                 |
| `--ink-muted`       | `250 12% 46%` | `250 12% 66%` | Secondary / label text                  |
| `--hairline`        | `252 30% 92%` | `252 20% 22%` | Borders / dividers                      |
| `--brand`/`-violet` | `252 83% 67%` | (shared)      | Primary violet                          |
| `--brand-indigo`    | `248 84% 60%` | (shared)      | Gradient end / heading color            |
| `--brand-soft`      | `252 90% 96%` | `252 50% 18%` | Lilac chips, hover wash, avatar bg      |
| `--positive`        | `152 62% 40%` | `152 56% 50%` | Income / available credit               |
| `--positive-soft`   | `152 70% 95%` | `152 40% 16%` | Income chip background                  |
| `--negative`        | `349 78% 56%` | `349 80% 64%` | Expense / destructive                   |
| `--negative-soft`   | `349 90% 96%` | `349 40% 18%` | Expense chip background                 |

## Radius, shadow, font scale

| Token           | Value                                          |
| --------------- | ---------------------------------------------- |
| `--radius` (lg) | `1.375rem` (~22px) — card baseline             |
| `radius-xl/2xl` | `+6px` / `+12px` — sidebar, hero panels        |
| `radius-md/sm`  | `-6px` / `-10px`                               |
| `--shadow-soft` | resting card shadow (low, violet-tinted)       |
| `--shadow-lift` | hover / floating panels / menus                |
| `--shadow-glow` | violet glow under gradient CTAs                |
| `--font-sans`   | `var(--font-inter), ui-sans-serif, system-ui…` |

## Helper classes (in `@layer components`)

- `.brand-gradient` — the 135° violet→indigo gradient (buttons, card, CTAs).
- `.brand-text-gradient` — same gradient clipped to text.
- `.glass-surface` — translucent surface + backdrop blur (floating sidebar, cards).
- `.section-heading` — medium-weight violet/indigo section title.

## Layout

- **Floating icon rail** (`src/components/layout.tsx`) — ~72px, white glass,
  rounded, soft-shadowed, detached from the screen edge. Brand mark at top; nav
  icons (Dashboard / Credit Cards / Team) with a violet **gradient active
  state**; theme toggle, user switcher, and a help "?" pinned at the bottom.
  Role gating (Team only for admins) and the `useAgentContext` page readable are
  unchanged.
- **Dashboard** (`src/app/dashboard/page.tsx`, mirrored by `/cards`) — two
  columns on a lavender canvas:
  - **Left**: "My Cards" (dashed add-card tile + a vivid gradient credit card,
    with a second card peeking behind) and "Recent Transactions" with a
    "View All" link, **underline** ALL / INCOME / EXPENSES tabs, a "TODAY"
    chip, and transaction rows (circular tinted badge + title + subtitle +
    colored amount).
  - **Right rail**: a tall rounded panel — **Balance** (large bold) + masked
    card number; an Income / Expenses split with colored arrows; a divider;
    **Last Payment Details**; a **Statistics** sparkline; and a gradient pill
    **New Transaction →** CTA.

## Statistics chart

`src/components/statistics-chart.tsx` is a **hand-rolled inline SVG** area+line
sparkline — no charting dependency. It takes a numeric series (derived from real
transaction data, bucketed by month; falls back to representative seeded points
when there isn't enough data), draws a violet→indigo gradient stroke over a soft
gradient area fill, emphasizes the latest point, and labels the axis with the
final point highlighted in violet. It includes an `aria-label` and an
`sr-only` numeric summary.

## Credit-card visual

`src/components/card-visual.tsx` exports `GradientCreditCard` (the vivid violet
gradient face: EMV chip, masked `•••• •••• •••• last4`, holder, valid-thru, and a
brand mark) plus `VisaWordmark` and the overlapping-circles `MastercardMark`. A
`subtle` variant renders the dimmed card that peeks behind the active one.

## CopilotKit chat popup

The embedded `CopilotPopup` is themed **via CSS only** — no component props
were changed. The v2 chat scopes its shadcn-style tokens to `[data-copilotkit]`;
`globals.css` re-points `--primary` / `--primary-foreground` / `--ring` on that
selector (and its dark variant) to the brand violet, so the send button, focus
rings, and links match. This is additive and degrades gracefully if the SDK's
internals change. All chat wiring (provider, threads, suggestions, HITL) is
untouched.

## Accessibility

- Focus-visible rings (`ring-brand` with offset) on buttons, tabs, inputs, menu
  items, and the help/nav controls.
- Semantic `<button>` / `<nav>` / `aria-current="page"` on the active nav item;
  `aria-label`s on icon-only controls; `role="img"` + `aria-label` on the chart.
- Color pairings (ink on surface, brand-foreground on gradient, positive/negative
  on their soft backgrounds) target legible contrast in both themes.
