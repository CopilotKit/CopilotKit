# Agent Design System

A small Next.js demo of the four ways to put a CopilotKit agent inside _your_ design system. Built as the working surface for the "Designing agents with your own design system" tutorial.

Everything is driven by CSS variables, so the whole app — chat included — reskins from one token set. The `/chat-ui` page shows the same chat rendered in two different design systems side by side, so you can see what customization actually buys you.

## Patterns

Each route is one pattern, and most have their own variant/mode tabs in the header.

| Route          | What it shows                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | Overview of the four patterns.                                                                                                                                                                                                    |
| `/chat-ui`     | Three ways to skin the chat: **CSS classes**, **replace one sub-component**, or go **headless** (`useAgent` + your own components). Also renders the chat in two design systems (app-themed vs. a warm serif theme) side by side. |
| `/controlled`  | Your component, the agent fills the props. `useComponent` renders a card inline in the chat; `useFrontendTool` pins one to an in-app side panel. Toggle: **In chat** / **In chat + In app**.                                      |
| `/declarative` | The agent emits a small JSON layout, your app renders it from a component catalog (`src/a2ui`). Same layout renders in the chat or in a full-width canvas. Toggle: **in-chat** / **split**.                                       |
| `/open`        | The agent generates the UI itself. **Open Gen UI** streams raw HTML/CSS/JS into a sandboxed iframe; **MCP Apps** lets an external MCP server (Excalidraw) supply tool UI that renders automatically. Toggle between the two.      |

## Run it

```bash
cp .env.example .env.local        # add your OPENAI_API_KEY for the Next side
cp .env.example agent/.env        # same key, read by the Python agent
pnpm install                      # also runs `uv sync` in agent/ via postinstall
pnpm dev                          # boots Next (3000) + Python agent (8123)
```

`pnpm dev` uses `concurrently` to run `next dev` and `uv run uvicorn main:app --port 8123 --reload` side by side. Web logs are prefixed `web`, agent logs `agent`. Killing either one stops the other.

Open <http://localhost:3000> and walk the four patterns from the top nav.

Only `OPENAI_API_KEY` is required. `DECLARATIVE_AGENT_URL` (Python agent) and `MCP_APPS_SERVER_URL` (MCP server) have working defaults — see `.env.example`.

## Agents

All agents live in `src/app/api/copilotkit/[[...path]]/route.ts`, wired into a single `CopilotRuntime` (`@copilotkit/runtime/v2`). The model is `openai/gpt-5` via `BuiltInAgent` (uses `OPENAI_API_KEY`).

| Agent (`agentId`)    | Backing                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` / `chatui` | `BuiltInAgent` — chat-UI assistant; renders a weather card via a frontend tool.                                                                      |
| `controlled`         | `BuiltInAgent` — drives the `showStock` / `pinStock` / `clearWorkspace` frontend tools.                                                              |
| `declarative`        | `HttpAgent` proxying the Python LangGraph agent (`agent/main.py`) over HTTP/SSE; it emits A2UI operations that the runtime forwards to the renderer. |
| `open`               | `BuiltInAgent` + `openGenerativeUI` middleware — streams HTML/CSS/JS to a sandboxed iframe.                                                          |
| `mcpapps`            | `BuiltInAgent` + `MCPAppsMiddleware` — calls Excalidraw MCP tools whose UI renders in the chat.                                                      |

## Stack

- Next.js 16 (App Router, `src` layout)
- CopilotKit v2: `@copilotkit/react-core/v2`, `@copilotkit/react-ui`, `@copilotkit/runtime/v2`, `@copilotkit/a2ui-renderer`
- AG-UI: `@ag-ui/client` (`HttpAgent`), `@ag-ui/mcp-apps-middleware` (MCP Apps)
- Python LangGraph agent in `agent/`, served by uvicorn on `8123`
- Recharts for the `StockCard` sparkline + `PortfolioBar`
- Tailwind v4, with everything driven by CSS variables under a `data-theme` attribute on `<html>`

## How the theming works

`src/app/globals.css` defines the design tokens. `<html>` is set to `data-theme="copilotkit"` (in `layout.tsx`), and every component reads the CSS vars — so the tokens reskin the whole app.

The chat is themed through CopilotKit's v2 token layer: each primitive renders a `[data-copilotkit]` element reading a shadcn-style token set, so a single scoped block (e.g. `.ads-chat-themed [data-copilotkit] { … }`) re-skins the whole chat with no slot hacks. The warm "second design system" on `/chat-ui` is the same idea under `.ads-warm`, plus a few slot `className` touches for structure the token layer can't express.

## Layout

```
src/
├── app/
│   ├── api/copilotkit/[[...path]]/route.ts   CopilotRuntime + all agents
│   ├── chat-ui/page.tsx                       CSS / sub-component / headless
│   ├── controlled/page.tsx                    useComponent + useFrontendTool
│   ├── declarative/page.tsx                   A2UI layout schema → catalog
│   ├── open/page.tsx                          Open Gen UI + MCP Apps
│   ├── layout.tsx                             Providers + fonts, data-theme="copilotkit"
│   ├── globals.css                            Design tokens + chat theming scopes
│   └── page.tsx                               Overview
├── components/
│   ├── SiteNav.tsx
│   ├── Providers.tsx                          <CopilotKitProvider /> wrapper
│   ├── Split.tsx                              resizable split panel
│   ├── StockCard.tsx
│   └── PortfolioBar.tsx
├── a2ui/
│   ├── catalog.ts                             component catalog the agent composes
│   ├── definitions.ts
│   ├── renderers.tsx                          maps A2UI nodes → your components
│   ├── MirrorRenderer.tsx
│   ├── SurfaceCanvas.tsx                      full-width side-panel canvas
│   └── surface-bus.ts
└── lib/
    ├── stocks.ts                              sample data
    └── sandbox-bus.ts
```
