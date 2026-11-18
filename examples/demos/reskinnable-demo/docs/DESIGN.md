# Northwind Finance — the banking skin's design system ("Aurora")

> Scope: this documents the **`banking` skin** (`src/skins/banking/`), one of the
> four skins this app ships — not the whole app. See the demo's `CLAUDE.md` for the
> shell / skin architecture, the inset frame, and the theming contract.

A premium, airy, light-theme fintech aesthetic for the banking skin. It is a
**visual layer**: it styles the skin without changing logic, data flow, REST
calls, the CopilotKit provider/runtime, HITL approval flows, or the teachable
policy-exception gate.

It is token-driven and follows the app's theming contract: the **shell owns the
token vocabulary** — the token _names_ are declared in
[`src/app/globals.css`](../src/app/globals.css) and surfaced to Tailwind v4 via
`@theme inline`, so utilities like `bg-surface`, `text-ink-muted`,
`from-brand-violet`, `ring-brand`, `bg-positive` resolve everywhere — while each
**skin owns the token values** in its `.theme-<id>` block. Banking's live in
[`src/skins/banking/theme.css`](../src/skins/banking/theme.css), scoped under
`.theme-banking`. The values below are the banking skin's Aurora palette.

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
- `.glass-surface` — translucent surface + backdrop blur (the icon rail, cards).
- `.section-heading` — medium-weight violet/indigo section title.

## Layout

The shared chat panel and the skin selector are owned by the **shell**, not the
banking skin. The shell renders this chrome inside its own inset **app card** (see
the demo's `CLAUDE.md` § "The inset frame"), so the skin supplies only what sits
within that card — and roots it at `h-full`, since the card, not the viewport, is
the bound.

- **Floating icon rail** (`src/skins/banking/layout.tsx`) — ~72px, white glass,
  rounded, soft-shadowed, detached from the card edge, sitting on the RIGHT
  because the shell's assistant column defaults to the left. Brand mark at top; nav icons
  (Cards / Dashboard / Charges / Team) with a violet **gradient active state**.
  Role gating and the `useAgentContext` page readable are unchanged.
- **Dashboard** (`src/skins/banking/pages/dashboard.tsx`, at `/banking/dashboard`)
  — two columns on a lavender canvas:
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

`src/skins/banking/components/statistics-chart.tsx` is a **hand-rolled inline SVG** area+line
sparkline — no charting dependency. It takes a numeric series (derived from real
transaction data, bucketed by month; falls back to representative seeded points
when there isn't enough data), draws a violet→indigo gradient stroke over a soft
gradient area fill, emphasizes the latest point, and labels the axis with the
final point highlighted in violet. It includes an `aria-label` and an
`sr-only` numeric summary.

## Credit-card visual

`src/skins/banking/components/card-visual.tsx` exports `GradientCreditCard` (the vivid violet
gradient face: EMV chip, masked `•••• •••• •••• last4`, holder, valid-thru, and a
brand mark) plus `VisaWordmark` and the overlapping-circles `MastercardMark`. A
`subtle` variant renders the dimmed card that peeks behind the active one.

## CopilotKit chat theming

The chat panel itself is the **shell's** custom `ChatPanel`
(`src/shell/chat/`), not a banking component — but its CopilotKit-internal
styling still picks up the active skin's palette **via CSS only**. The v2 chat
scopes its shadcn-style tokens to `[data-copilotkit]`; `globals.css` re-points
`--primary` / `--primary-foreground` / `--ring` on that selector (and its dark
variant) to the brand color, so the send button, focus rings, and links match
whichever skin is active. This is additive and degrades gracefully if the SDK's
internals change.

## Accessibility

- Focus-visible rings (`ring-brand` with offset) on buttons, tabs, inputs, menu
  items, and the help/nav controls.
- Semantic `<button>` / `<nav>` / `aria-current="page"` on the active nav item;
  `aria-label`s on icon-only controls; `role="img"` + `aria-label` on the chart.
- Color pairings (ink on surface, brand-foreground on gradient, positive/negative
  on their soft backgrounds) target legible contrast in both themes.
