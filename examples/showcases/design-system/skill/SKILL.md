---
name: agent-design-system
description: Scaffold a CopilotKit chat + generative UI setup inside an existing Next.js app. Asks the user which chat customization (CSS / slots / headless), which gen UI patterns (controlled / declarative / open ended), copies the matching templates from this skill folder, installs deps, prints the run command.
metadata:
  type: scaffold
---

# Agent Design System scaffold

You are scaffolding a CopilotKit-based chat + generative UI setup
inside the user's existing Next.js app. Ask the user what they want,
copy templates from `<skill-dir>/templates/`, install deps, print the
run command.

## Hard rules

1. Templates live next to this `SKILL.md` under `templates/`. Use
   Read to load them. Do not fetch from the network.
2. Confirm the user is on Next.js App Router before stamping. If
   they're on Vite / Astro / anything else, abort with a clear
   message — the patterns transfer but the file layout does not.
3. No partial output. If a step fails, roll back what you wrote and
   tell the user. Half-finished setups are worse than no setup.
4. Detect the user's package manager from lockfile presence
   (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` → bun,
   else npm).

## Procedure

### Step 1 — Confirm the host project

Run `find . -maxdepth 3 -name "next.config.*"`. If it returns nothing,
ask where the Next.js app lives. If still nothing, abort.

### Step 2 — Interview

Ask via `AskUserQuestion`. Four questions, in this order.

**Q1 — Chat UI customization**

- CSS classes (fastest)
- Replace a slot (one piece swapped, rest default)
- Headless (full custom on `useAgent` + `useCopilotKit`)
- All three (show them as tabs in one page)
- None

**Q2 — Generative UI patterns** (multiSelect)

- Controlled (`useComponent` + `useFrontendTool`)
- Declarative (A2UI; ships a Python LangGraph backend)
- Open Generative UI (sandboxed iframe in chat)
- MCP Apps (external MCP server, UI renders in chat)

**Q3 — Demo content** (single-select)

- Stocks (six tickers + StockCard, default)
- Weather (cities + WeatherCard)
- Bring my own (prompt for a name + one-line description; stub a card)

**Q4 — Model** (single-select)

- OpenAI gpt-5 (default)
- Anthropic claude-sonnet-4.5
- Google gemini-2.5-pro

### Step 3 — Install dependencies

```bash
<pm> add @copilotkit/react-core @copilotkit/react-ui \
  @copilotkit/runtime @copilotkit/a2ui-renderer @ag-ui/client \
  zod recharts lucide-react react-markdown
```

If MCP Apps was picked: also add `@ag-ui/mcp-apps-middleware`.

### Step 4 — Copy frontend templates

Read each template, substitute placeholders, write to the user's
project. Placeholder table:

| Placeholder      | Replacement                                               |
| ---------------- | --------------------------------------------------------- |
| `__MODEL__`      | model id from Q4, e.g. `openai/gpt-5`                     |
| `__DEMO_NAME__`  | demo name from Q3 (`stocks`, `weather`, or user-supplied) |
| `__DEMO_CARD__`  | card component name (`StockCard`, `WeatherCard`, …)       |
| `__CATALOG_ID__` | `copilotkit://<demo-name>-catalog`                        |

Files to copy, per pick:

| Pick                      | Template files                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat UI · any combination | `templates/chat-ui.page.tsx` → `app/chat-ui/page.tsx`. Always: `templates/globals.css` tokens merged into the user's `app/globals.css`.                                        |
| Controlled                | `templates/controlled.page.tsx` → `app/controlled/page.tsx`. `templates/StockCard.tsx` (or weather card) → `components/`. `templates/stocks.ts` → `lib/`.                      |
| Declarative               | `templates/declarative.page.tsx` → `app/declarative/page.tsx`. Entire `templates/a2ui/` → `app/../a2ui/`. Also see Step 5 for the Python agent.                                |
| Open Gen UI               | edit `templates/Providers.tsx` to include `openGenerativeUI` + `sandboxFunctions`. Stamp `templates/open.page.tsx` → `app/open/page.tsx`. `templates/sandbox-bus.ts` → `lib/`. |
| MCP Apps                  | extend `templates/api-route.ts` with the `MCPAppsMiddleware` block. Stamp the MCP variant into `app/open/page.tsx`.                                                            |

Always stamp:

- `templates/Providers.tsx` → `components/Providers.tsx` (comment out
  the sections the user did not pick).
- `templates/api-route.ts` → `app/api/copilotkit/[[...path]]/route.ts`
  (comment out the agent blocks the user did not pick).
- `templates/SiteNav.tsx` → `components/SiteNav.tsx` (trim the nav
  links to match the user's picks).

### Step 5 — Python agent (only if Declarative)

Stamp the `agent/` folder verbatim:

| Source                                | Destination                                          |
| ------------------------------------- | ---------------------------------------------------- |
| `templates/agent/pyproject.toml`      | `agent/pyproject.toml`                               |
| `templates/agent/main.py`             | `agent/main.py`                                      |
| `templates/agent/src/catalog.py`      | `agent/src/catalog.py` (substitute `__CATALOG_ID__`) |
| `templates/agent/src/stocks_agent.py` | `agent/src/<demo>_agent.py`                          |

Tell the user:

```
cd agent
echo "OPENAI_API_KEY=sk-..." > .env
uv sync
uv run uvicorn main:app --port 8123 --reload
```

### Step 6 — Final output

Print exactly this block, filling the bracketed parts:

```
✓ Wrote <N> files
✓ Installed <N> packages

Run the frontend:
  <pm> dev

[if Declarative]
Run the Python agent (separate terminal):
  cd agent && uv run uvicorn main:app --port 8123 --reload

Open http://localhost:3000/<first-page-the-user-picked>
```

## Anti-patterns to avoid

- Do not generate code from scratch. Read template files. They are
  battle-tested and contain workarounds for gotchas documented in
  the source repo's `analysis.md`.
- Do not wrap A2UI component props in a `props: {}` object. A2UI
  v0.9 puts props at the top level. The Python templates already
  emit them correctly.
- Do not register a custom `renderActivityMessages` for
  `"a2ui-surface"` if the user didn't ask for both in-chat AND in-app
  rendering. The built-in renderer is enough for chat-only.
- Do not use `BuiltInAgent` with the classic config for A2UI. The
  middleware only intercepts tool results from external agents
  (HttpAgent) or from `type: "tanstack"` factories. Classic
  BuiltInAgent silently skips it.

## When you're done

Tell the user where to read more:

- `analysis.md` in the source repo — the gotchas this scaffold avoids
- `BLOG.md` in the source repo — the patterns explained end to end
