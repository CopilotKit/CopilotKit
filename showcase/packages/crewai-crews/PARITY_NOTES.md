# CrewAI (Crews) — Parity Notes vs LangGraph Python

This document tracks which LangGraph-Python demos have been ported to
CrewAI Crews, which have been intentionally skipped, and why.

## Architecture

Unlike LangGraph-Python, where each demo can point at its own graph
(`langgraph.json` maps agent names → graph modules), CrewAI Crews in this
showcase uses a **single shared `LatestAiDevelopment` crew** registered at
the FastAPI agent server (`src/agent_server.py`) and fronted by
`ag_ui_crewai.endpoint.add_crewai_crew_fastapi_endpoint`.

The Next.js CopilotKit runtime registers **multiple agent names** but they
all resolve to the same underlying crew via `HttpAgent`. This is an
intentional constraint of the CrewAI runtime primitive — a crew is a
pre-assembled set of agents + tasks, not a graph whose nodes are
swappable per request.

Ported demos therefore fall into two categories:

1. **Frontend-first demos** — use `useFrontendTool`, `useRenderTool`,
   `useAgentContext`, `useConfigureSuggestions`, `useComponent`,
   `useHumanInTheLoop`, slot overrides, CSS theming, or chrome variants.
   These run against the shared crew without any backend change.
2. **Backend-tool demos** — rely on the tools already registered on the
   shared crew (`get_weather`, `search_flights`, `query_data`,
   `schedule_meeting`, `generate_a2ui`). These are ported verbatim.

## Ported demos (newly added in this PR)

| Demo                            | Kind              | Notes                                                 |
| ------------------------------- | ----------------- | ----------------------------------------------------- |
| prebuilt-sidebar                | Chrome            | `<CopilotSidebar />` against shared crew              |
| prebuilt-popup                  | Chrome            | `<CopilotPopup />` against shared crew                |
| chat-slots                      | Chrome            | Slot overrides on `<CopilotChat />`                   |
| chat-customization-css          | Chrome            | CSS custom-properties theming                         |
| headless-simple                 | Chrome / Headless | `useAgent` + `useComponent`                           |
| headless-complete               | Chrome / Headless | Full headless implementation                          |
| agentic-chat-reasoning          | Reasoning         | Uses the shared crew; reasoning tokens if model emits |
| reasoning-default-render        | Reasoning         | Default CopilotChatReasoningMessage                   |
| tool-rendering-default-catchall | Rendering         | Out-of-the-box default renderer                       |
| tool-rendering-custom-catchall  | Rendering         | Custom wildcard renderer                              |
| tool-rendering-reasoning-chain  | Rendering         | Sequential tool calls + reasoning                     |
| frontend-tools                  | Frontend tools    | `useFrontendTool` for background change               |
| frontend-tools-async            | Frontend tools    | Async `useFrontendTool` handler                       |
| hitl-in-app                     | HITL              | `useFrontendTool` + app-level modal                   |
| readonly-state-agent-context    | Context           | `useAgentContext`                                     |
| agent-config                    | Context           | Typed config object via `useAgentContext`             |
| open-gen-ui                     | Generative UI     | Fully open-ended gen UI, frontend-only                |
| open-gen-ui-advanced            | Generative UI     | Sandbox functions inside iframe                       |

## Skipped demos — architectural reasons

### `gen-ui-interrupt` — **skipped**

Uses LangGraph's native `interrupt()` primitive and the v1
`useLangGraphInterrupt` hook, which depend on graph-level state suspension
and a resume endpoint that LangGraph Platform exposes. CrewAI has no
equivalent primitive exposed over AG-UI today — a crew task cannot be
paused and resumed with out-of-band user input mid-execution. The existing
`hitl` demo (which this showcase keeps as `hitl-in-chat`) covers the
human-in-the-loop UX via `useHumanInTheLoop`, which is a frontend-tool
round-trip and works across runtimes.

### `interrupt-headless` — **skipped**

Same reason as `gen-ui-interrupt` — LangGraph-interrupt-specific.

### `mcp-apps` — **skipped**

Requires LangGraph `MCPAppsMiddleware` and `create_agent` + MCP SSE
client wiring at the graph level. CrewAI's tool registration is a
Pydantic-schema `BaseTool` list on `Agent`, not an MCP client
multiplexer. No equivalent primitive in `ag-ui-crewai` at the time of
writing; porting would require first-class MCP support in CrewAI upstream.

### `beautiful-chat` — **skipped for this blitz**

The LangGraph-Python reference assembles a large A2UI catalog +
open-gen-ui + MCP apps combined-runtime. This requires a dedicated
`/api/copilotkit-beautiful-chat` route with `injectA2UITool: false` and
OpenGenerativeUI enabled, plus a backend `beautiful_chat` crew that
emits ingredient tool calls matching the frontend catalog. That's a
full day of backend crew design. The existing 8-demo parity already
exposes the underlying primitives (`gen-ui-tool-based`, `gen-ui-agent`,
`shared-state-*`) individually.

### `voice` — **skipped for this blitz**

Requires a dedicated `/api/copilotkit-voice` route with the
`@copilotkit/voice` speech-to-text transcription endpoint. Porting is
mostly-plumbing but requires hooking up a Python speech backend and is
not part of minimal parity.

### `multimodal` — **skipped for this blitz**

Requires a vision-capable agent and attachment pipeline. Doable but
requires a second crew tuned for vision inputs plus a dedicated
`/api/copilotkit-multimodal` route.

### `auth` — **skipped for this blitz**

Requires runtime `onRequest` hook plumbing and is orthogonal to agent
primitives; it exercises the runtime's auth gate. Uncontroversial to
port later.

### `byoc-hashbrown`, `byoc-json-render` — **skipped for this blitz**

BYOC (bring-your-own-catalog) demos require a dedicated runtime endpoint
that pipes a secondary LLM to render JSON structured output. The existing
shared crew's `generate_a2ui` tool covers the CrewAI-native equivalent
(A2UI v0.9), which is preferable for CrewAI users.

### `declarative-gen-ui`, `a2ui-fixed-schema` — **skipped for this blitz**

Both demos lean on A2UI rendering, and both require a dedicated runtime
endpoint with `a2ui.injectA2UITool: false` because the backend agent
owns its own render tool. CrewAI has a `GenerateA2uiTool` already, so
conceptually portable — but each demo needs its own tuned crew, so we
defer to a follow-up PR.

### `cli-start` — **not a page-level demo**

Manifest-only entry describing the `npx copilotkit@latest init` command.
Already covered implicitly by the root manifest.

## Summary counts

- **Total LangGraph-Python demos:** 37
- **Existing CrewAI-Crews demos (before this PR):** 10 (8 base + `shared-state-read` + `shared-state-write`)
- **Newly ported in this PR:** 18
- **Skipped (architectural):** 3 (`gen-ui-interrupt`, `interrupt-headless`, `mcp-apps`)
- **Deferred (follow-up PRs):** 7 (`beautiful-chat`, `voice`, `multimodal`, `auth`, `byoc-hashbrown`, `byoc-json-render`, `declarative-gen-ui`, `a2ui-fixed-schema`)
- **Not applicable:** `cli-start`

CrewAI Crews covers ~76% of the LangGraph-Python feature matrix after
this PR. Full parity on the deferred demos requires dedicated runtime
endpoints and tuned crews per demo.
