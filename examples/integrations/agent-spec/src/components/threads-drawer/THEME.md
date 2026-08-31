# Threads Panel — Design Notes (agent-spec)

These are agent-spec's **bespoke** copies of the threads panel. They are no
longer a shared/tokenized base component — they are styled to read as one
product with agent-spec's chat surface from `@copilotkit/react-core/v2`.

## Design source of truth

All surfaces, borders, radii, and type ramps are lifted from CopilotKit's V2
design system: `@copilotkit/react-core/src/v2/styles/globals.css` plus the chat
components (`CopilotModalHeader`, `CopilotChatSuggestionPill`,
`CopilotChatInput`, `CopilotSidebarView`). The tokens are mirrored verbatim into
`src/app/globals.css`:

| Token                                  | Value (V2 light)                | Role in the panel                                                                                                                       |
| -------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--card` / `--background`              | `oklch(1 0 0)` (white)          | Panel + card surfaces                                                                                                                   |
| `--foreground`                         | `oklch(0.145 0 0)`              | Titles, thread titles, dialog text                                                                                                      |
| `--muted` / `--secondary` / `--accent` | `oklch(0.97 0 0)`               | Hover/active surfaces, segment track, archived chip, code well                                                                          |
| `--muted-foreground`                   | `oklch(0.556 0 0)`              | Meta text, idle icons, descriptions, placeholders                                                                                       |
| `--border` / `--input`                 | `oklch(0.922 0 0)`              | All hairline borders                                                                                                                    |
| `--primary`                            | `oklch(0.205 0 0)` (near-black) | New-thread pill, selected accent, primary CTA — the V2 sidebar's primary buttons are charcoal/black, **not** a brand accent             |
| `--primary-foreground`                 | `oklch(0.985 0 0)`              | Primary button text                                                                                                                     |
| `--destructive`                        | `oklch(0.577 0.245 27.325)`     | Delete hover                                                                                                                            |
| `--ring`                               | `oklch(0.708 0 0)`              | Focus rings (2px box-shadow)                                                                                                            |
| `--radius`                             | `0.625rem` (+ sm/md/lg/xl)      | Rectangular controls; icon buttons / pills / segments use `999px` to echo the sidebar's close button, suggestion pills, and send button |

## Forced light

agent-spec's chat surface is always light regardless of OS color scheme. The
panel must match it, so `src/app/globals.css` re-pins `--foreground` and
`--background` to the V2 light values on `.threadsLayout` (the layout wrapper)
and on `body > [role="presentation"]` (the confirm dialog renders in a portal on
`<body>`). The dark-mode `@media (prefers-color-scheme: dark)` block only flips
the bare page `--background`/`--foreground`; the panel overrides win because
they are scoped to the layout/portal roots.

## Typography

Geist (the app font, via `--font-body` / `--font-code`). Sizes/weights track the
sidebar: header title `1rem / 500 / tracking-tight`, thread titles
`0.8125rem / 500`, meta `0.6875rem`, all medium-weight — no heavy `700`s.

Edit these files freely; they are agent-spec-owned and not shared with other
examples.
