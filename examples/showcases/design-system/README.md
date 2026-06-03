# Agent Design System

A small Next.js demo that shows the four ways to put a CopilotKit agent inside _your_ design system. Built as the working surface for the "Designing agents with your own design system" tutorial.

Four routes, two themes (Anthropic-ish warm vs Linear-ish cool), one toggle. Everything reskins from the same CSS variables.

## Routes

| Route          | What it shows                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `/`            | Overview of the four patterns.                                                                  |
| `/chat-ui`     | Chat customization. CSS variables, custom sub-components, and a pointer at headless `useAgent`. |
| `/controlled`  | `useFrontendTool` with `render` (in-chat) and with `handler` (in-app workspace).                |
| `/declarative` | A tiny layout catalog the agent composes from. Same catalog renders in chat or in a canvas.     |
| `/open`        | The agent emits ad-hoc HTML, rendered into a sandboxed surface using the design tokens.         |

## Run it

```bash
cp .env.example .env.local        # add your OPENAI_API_KEY for the Next side
cp .env.example agent/.env        # same key, read by the Python agent
pnpm install                      # also runs `uv sync` in agent/ via postinstall
pnpm dev                          # boots Next (3000) + Python agent (8123)
```

`pnpm dev` uses `concurrently` to run `next dev` and `uv run uvicorn main:app --port 8123 --reload` side by side. Web logs are prefixed `web`, agent logs `agent`. Killing either one stops the other.

Open <http://localhost:3000> and flip the theme toggle in the top nav.

## Stack

- Next.js 16 (App Router, src layout)
- CopilotKit (`@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/runtime`)
- OpenAI adapter (uses `OPENAI_API_KEY`, defaults to `gpt-4o-mini`)
- Recharts for the sparkline + bar chart
- Tailwind v4, with everything driven by CSS variables under a `data-theme` attribute on `<html>`

## How the themes work

Two theme stanzas live in `src/app/globals.css`:

```css
:root, [data-theme="anthropic"] { --bg, --ink, --accent, ... }
[data-theme="linear"]            { --bg, --ink, --accent, ... }
```

A `ThemeProvider` (`src/components/ThemeProvider.tsx`) writes `data-theme="..."` onto `<html>` and persists the choice to localStorage. Every component reads from the CSS vars, so flipping the attribute reskins the whole app, chat included.

## Layout

```
src/
├── app/
│   ├── api/copilotkit/route.ts    CopilotRuntime + OpenAI adapter
│   ├── chat-ui/page.tsx
│   ├── controlled/page.tsx
│   ├── declarative/page.tsx
│   ├── open/page.tsx
│   ├── layout.tsx                 Providers + ThemeProvider + fonts
│   ├── globals.css                Theme tokens
│   └── page.tsx                   Overview
├── components/
│   ├── ThemeProvider.tsx
│   ├── SiteNav.tsx
│   ├── Providers.tsx              <CopilotKit /> wrapper
│   ├── StockCard.tsx
│   └── PortfolioBar.tsx
├── declarative/
│   ├── types.ts                   Layout catalog
│   └── Renderer.tsx               Resolves layout nodes to components
└── lib/
    └── stocks.ts                  Sample data
```
