---
name: migrating-or-creating-integration-demo
description: Use when migrating an existing CopilotKit integration demo in examples/integrations/ to match the north star, or when creating a brand-new integration demo from scratch where no prior demo exists.
---

# CopilotKit Integration Demo: Migrate or Create

## North Star

`examples/integrations/langgraph-python` — every demo must match its structure, UI, and features. The only thing that differs per demo is the agent runtime and connection class.

**AG-UI integration references:** `/Users/ran/Desktop/ag-ui/integrations/<runtime-id>/`

---

## Migrate vs. Create?

**Migrating** (existing demo): Follow all steps. In Step 6, start from the old agent code.

**Creating from scratch** (no prior demo): Follow all steps. In Step 6, build the agent fresh using the AG-UI integration reference at `/Users/ran/Desktop/ag-ui/integrations/<runtime-id>/` as a guide for how that runtime connects to CopilotKit.

---

## Step 1 — Understand What the North Star Frontend Uses

The north star frontend registers these features — start by including ALL of them in every demo:

| Feature                                       | Where it's registered                                                 | What it needs from the agent                                    |
| --------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Controlled Generative UI** (pie/bar charts) | `useComponent` in `use-generative-ui-examples.tsx`                    | `query_data` tool returning chart data                          |
| **Human-in-the-Loop** (meeting time picker)   | `useHumanInTheLoop` in `use-generative-ui-examples.tsx`               | Nothing — frontend-only tool                                    |
| **Backend Tool Rendering**                    | `useDefaultRenderTool` in `use-generative-ui-examples.tsx`            | Any backend tool (e.g. `get_weather`)                           |
| **A2UI Declarative Form**                     | `a2ui: { injectA2UITool: true }` in `route.ts`                        | `generate_form` tool returning A2UI operations                  |
| **MCP (Excalidraw)**                          | `mcpApps` config in `route.ts`                                        | Nothing — external MCP server                                   |
| **Frontend Tools** (theme toggle)             | `useFrontendTool` in `use-generative-ui-examples.tsx`                 | Nothing — frontend-only tool                                    |
| **Shared State** (todo canvas)                | `useAgent` in `example-canvas/`, `enableAppMode` in `example-layout/` | Agent state with `{ todos }` + `manage_todos`/`get_todos` tools |

**Only remove features that are proven not to work with the runtime.** For example, Mastra does not support shared state (no bidirectional state sync), so the todo canvas and related layout tools must be removed.

---

## Step 2 — Align Root Files

Copy these 1:1 from the north star, then patch:

- **`package.json`** — patch `"name"` only. Keep turbo, concurrently, pnpm@9, esbuild override.
- **`pnpm-workspace.yaml`** — 1:1 (`apps/app` + `apps/agent`)
- **`turbo.json`** — 1:1
- **`.env.example`** — 1:1 (`OPENAI_API_KEY=`), add any extra keys the runtime needs (e.g. `MASTRA_URL`)
- **`.gitignore`** — 1:1, add runtime-specific ignores (e.g. `.mastra/` for Mastra)

**For migrations:** delete old flat-structure files — root-level `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `public/`, `src/`, and the root `agent/` folder. **Delete the old `pnpm-lock.yaml`** — it will be stale and cause broken lockfile warnings. Run `pnpm install` to regenerate.

---

## Step 3 — Create Folder Structure

```
apps/
  app/     <- Next.js frontend
  agent/   <- Agent backend
```

---

## Step 4 — Copy `apps/app/` from North Star

```bash
cp -r examples/integrations/langgraph-python/apps/app \
       examples/integrations/<demo-name>/apps/app
```

Full copy, no changes yet.

---

## Step 5 — Update Agent Connection in `route.ts`

**File:** `apps/app/src/app/api/copilotkit/route.ts`

Replace only the agent instantiation. Keep everything else (MCP config, a2ui, ExperimentalEmptyAdapter) identical.

```typescript
// North star default (LangGraph Cloud):
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
const defaultAgent = new LangGraphAgent({ ... });
// agents: { default: defaultAgent },

// FastAPI / LangGraph HTTP:
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
const defaultAgent = new LangGraphHttpAgent({ url: "..." });
// agents: { default: defaultAgent },

// Mastra (remote, via MastraClient):
import { MastraAgent } from "@ag-ui/mastra";
import { MastraClient } from "@mastra/client-js";
const mastraClient = new MastraClient({ baseUrl: process.env.MASTRA_URL || "http://localhost:4111" });
const agents = await MastraAgent.getRemoteAgents({ mastraClient, resourceId: "default" });
// agents: agents,
```

Update `apps/app/package.json` dependencies to match the runtime:

- **Mastra**: add `@ag-ui/mastra` and `@mastra/client-js`, keep `@ag-ui/a2ui-middleware` and `@ag-ui/mcp-apps-middleware`
- **LangGraph**: keep `@copilotkit/runtime` (includes LangGraph imports)

`layout.tsx` needs no changes.

---

## Step 6 — Create `apps/agent/`

The agent must expose the same tools as the north star:

| Tool                         | What it provides                             | Notes                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query_data`                 | Returns financial CSV data for charts        | **Inline the data** — bundlers (e.g. Mastra's `.mastra/output/`) don't copy non-TS files                                                                                |
| `generate_form`              | Returns A2UI operations for declarative form | Must return an **array/object, NOT `JSON.stringify()`** — the AG-UI layer stringifies tool results, so pre-stringifying causes double-encoding that breaks A2UI parsing |
| `get_weather` (or similar)   | Backend tool for backend-tool-rendering demo | Any tool that makes an external call works                                                                                                                              |
| `manage_todos` + `get_todos` | Shared state management                      | **Only if runtime supports bidirectional state sync**                                                                                                                   |

### Agent `package.json`

Required for Turborepo workspace discovery:

```json
{
  "name": "@repo/agent",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "<command to start the agent server>"
  }
}
```

**Do NOT add a `postinstall` script that runs `npm install`** — pnpm workspaces install all workspace deps from the root. A `postinstall: "npm install"` creates an infinite recursion loop.

### Runtime-specific dev commands

- **LangGraph Cloud**: `npx @langchain/langgraph-cli dev --port 8123 --no-browser`
- **FastAPI**: `uv run main.py`
- **Mastra**: `mastra dev` (port is configured in `src/mastra/index.ts` via `server.port`, NOT via CLI flag)

### Environment variables

The agent process runs from `apps/agent/`, not the monorepo root. It won't see the root `.env` by default.

- **LangGraph**: `langgraph.json` has `"env": "../../.env"` pointing to root
- **Mastra**: use `mastra dev --env ../../.env` in the dev script
- **FastAPI**: use `python-dotenv` with explicit path, or symlink

### Mastra-specific: directory convention

Mastra expects `src/mastra/index.ts` as the entry point. Standard layout:

```
apps/agent/
  package.json
  src/mastra/
    index.ts          <- Mastra instance (agents, storage, logger, server config)
    agents/index.ts   <- Agent definitions
    tools/            <- Tool definitions (one file per tool)
```

### Mastra-specific: tool return values

Mastra's AG-UI integration stringifies tool results via `JSON.stringify(streamPart.result)`. If your tool already returns a string (e.g. `JSON.stringify(data)`), it gets **double-stringified** and downstream parsers (like A2UI middleware) can't parse it. Always return objects/arrays from tools, never pre-stringified JSON.

---

## Step 7 — Remove Unsupported Features from Frontend

Only remove features that are **proven not to work** with the target runtime. For each removed feature:

1. Remove its hook/component registration in `apps/app/src/hooks/use-generative-ui-examples.tsx`
2. Remove its suggestion from `apps/app/src/hooks/use-example-suggestions.tsx`
3. If removing **shared state**: remove `ExampleCanvas` from `page.tsx`, remove `enableAppMode`/`enableChatMode` frontend tools and `ModeToggle` from `example-layout/index.tsx`, simplify layout to chat-only

### Known runtime limitations

| Runtime       | Unsupported features                             |
| ------------- | ------------------------------------------------ |
| **Mastra**    | `shared_state` (no bidirectional state sync yet) |
| **LangGraph** | All features supported                           |

---

## Step 8 — Deviation Check (required)

After implementation, systematically diff every file against the north star. This catches subtle bugs that are easy to miss (e.g. a missing `ToolMessage` in a tool return that worked with an older library version but crashes with the current one).

### How to run

1. **Diff root files:**

   ```bash
   NS=examples/integrations/langgraph-python
   DEMO=examples/integrations/<demo-name>
   for f in package.json turbo.json pnpm-workspace.yaml .gitignore .env.example; do
     diff "$NS/$f" "$DEMO/$f"
   done
   ```

2. **Diff all `apps/app/` files** — every file should be identical to the north star EXCEPT `route.ts` and `package.json` (runtime-specific deps). If any other file differs, it's a bug unless you removed a feature in Step 7.

3. **Diff agent tools against north star equivalents** — for each tool in the north star agent (`todos.py`, `query.py`, `form.py`), verify the demo's equivalent:
   - Same tool names and signatures
   - Same return value structure (e.g. `ToolMessage` included in `Command.update`)
   - Same data shape (e.g. `query_data` returns the same CSV fields)

4. **For each deviation found**, decide:
   - **Intentional** (runtime-specific): document why in a comment
   - **Bug**: fix it

### What this catches

- Missing `ToolMessage` in tool returns (crashes with newer langgraph)
- Stale dependency pins (e.g. `ag-ui-langgraph==0.0.22` when `copilotkit` needs `>=0.0.24`)
- Removed imports or unused leftover code
- Subtle differences in tool behavior between runtimes

---

## Verification

1. `pnpm install` — no errors (delete old `pnpm-lock.yaml` first if migrating)
2. `cp .env.example .env` -> set `OPENAI_API_KEY` (and runtime-specific keys)
3. `pnpm dev` — Next.js on 3000, agent starts on its port
4. UI loads with chat sidebar
5. Test each suggestion chip:
   - Pie/Bar chart: agent calls `query_data`, chart renders in chat
   - Schedule meeting: time picker appears, user can respond
   - Event registration: A2UI form renders in chat
   - Excalidraw: MCP app opens
   - Toggle dark mode: theme switches
   - Task manager (if shared state supported): todos appear in canvas

---

## Common Pitfalls

- **`pnpm-workspace.yaml` missing** — Turbo won't discover workspace packages
- **Old `pnpm-lock.yaml` from flat structure** — Delete it. The lockfile format doesn't match the new monorepo layout and causes "broken lockfile" errors
- **`postinstall: "npm install"` in agent package.json** — Infinite recursion. pnpm workspaces handle this from root
- **`mastra dev --port`** — Not a valid flag. Configure port in `src/mastra/index.ts` `server.port` instead
- **Filesystem reads in Mastra tools** — Mastra bundles to `.mastra/output/`. Non-TS files (CSV, JSON) aren't copied. Inline data directly in TypeScript
- **`JSON.stringify()` in Mastra tool returns** — Double-stringification breaks A2UI and other parsers. Return objects/arrays, let the AG-UI layer serialize
- **Agent can't read `.env`** — Agent runs from `apps/agent/`, not root. Use `--env ../../.env` (Mastra) or `"env": "../../.env"` (LangGraph) to point to root
- **Agent name mismatch** — For LangGraph Cloud, `graphId` in `route.ts` must match `langgraph.json`. For Mastra, agent IDs from `getRemoteAgents` must exist on the Mastra server
