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

Ported demos therefore fall into three categories:

1. **Frontend-first demos** — use `useFrontendTool`, `useRenderTool`,
   `useAgentContext`, `useConfigureSuggestions`, `useComponent`,
   `useHumanInTheLoop`, slot overrides, CSS theming, or chrome variants.
   These run against the shared crew without any backend change.
2. **Backend-tool demos** — rely on the tools already registered on the
   shared crew (`get_weather`, `search_flights`, `query_data`,
   `schedule_meeting`, `generate_a2ui`). These are ported verbatim.
3. **Runtime-layer demos** — exercise features of the Next.js CopilotKit
   runtime (auth via `onRequest`, voice via `TranscriptionService`,
   multimodal attachments). The shared crew is reused; per-demo behavior
   lives entirely in the runtime route module.

## Ported demos (Wave 1 — 18 demos)

| Demo                            | Kind              | Notes                                                  |
| ------------------------------- | ----------------- | ------------------------------------------------------ |
| prebuilt-sidebar                | Chrome            | `<CopilotSidebar />` against shared crew               |
| prebuilt-popup                  | Chrome            | `<CopilotPopup />` against shared crew                 |
| chat-slots                      | Chrome            | Slot overrides on `<CopilotChat />`                    |
| chat-customization-css          | Chrome            | CSS custom-properties theming                          |
| headless-simple                 | Chrome / Headless | `useAgent` + `useComponent`                            |
| headless-complete               | Chrome / Headless | Full headless implementation                           |
| agentic-chat-reasoning          | Reasoning         | Uses the shared crew; reasoning tokens if model emits  |
| reasoning-default-render        | Reasoning         | Default CopilotChatReasoningMessage                    |
| tool-rendering-default-catchall | Rendering         | Out-of-the-box default renderer                        |
| tool-rendering-custom-catchall  | Rendering         | Custom wildcard renderer                               |
| tool-rendering-reasoning-chain  | Rendering         | Sequential tool calls + reasoning                      |
| frontend-tools                  | Frontend tools    | `useFrontendTool` for background change                |
| frontend-tools-async            | Frontend tools    | Async `useFrontendTool` handler                        |
| hitl-in-app                     | HITL              | `useFrontendTool` + app-level modal                    |
| readonly-state-agent-context    | Context           | `useAgentContext`                                      |
| agent-config                    | Context           | Typed config object via `useAgentContext` (see Wave 2) |
| open-gen-ui                     | Generative UI     | Fully open-ended gen UI, frontend-only                 |
| open-gen-ui-advanced            | Generative UI     | Sandbox functions inside iframe                        |

## Ported demos (Wave 2 — this PR)

| Demo       | Kind    | Notes                                                    |
| ---------- | ------- | -------------------------------------------------------- |
| auth       | Runtime | Bearer-token gate via V2 `onRequest` hook                |
| voice      | Runtime | `TranscriptionServiceOpenAI` mounted on per-demo runtime |
| multimodal | Runtime | Image + PDF uploads via `AttachmentsConfig`              |

## Wave 2 fix: `agent-config` backend wiring

Wave 1 shipped `agent-config` with the frontend forwarding
`tone`/`expertise`/`responseLength` via `<CopilotKitProvider properties>`,
but the CrewAI side ignored them: the upstream
`ag_ui_crewai.endpoint.crewai_prepare_inputs` helper threads only
`state` / `messages` / `tools` into `ChatWithCrewFlow` and drops
`forwardedProps` on the floor.

Wave 2 fixes this end-to-end with a small FastAPI middleware in
`src/agent_server.py` (`ForwardedPropsMiddleware`) that:

1. Intercepts POSTs to the crew endpoint.
2. Parses the JSON body and checks for `forwardedProps.tone` /
   `expertise` / `responseLength`.
3. When present, composes a plain-English style guide
   (`_build_agent_config_guidance`) matching the three-axis rulebook
   used by the LangGraph-Python reference (`agent_config_agent.py`).
4. Splices the guidance + raw enums into `state.inputs`.
5. Replays the rewritten body into the ASGI `receive` queue so the
   downstream `ag_ui_crewai` handler sees the mutated body verbatim.

The middleware only mutates bodies that carry agent-config props, so
every other demo's request bytes pass through byte-identical. The crew
chat flow already appends `state["inputs"]` to its system prompt
(`system_message += "\n\nCurrent inputs: " + json.dumps(inputs)`) —
which means the agent now sees the style rules on every turn and the
response style changes as the user flips the selectors.

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

## Still deferred to a follow-up PR (architectural work)

The five demos below need a **dedicated per-demo backend crew or
structured-output pipeline** — not just a route wiring change. They are
genuinely architectural work, not cosmetic facades.

### `beautiful-chat` — **deferred**

The LangGraph-Python reference assembles a combined runtime with A2UI
(dynamic + fixed schema), Open Generative UI, and MCP Apps — plus a
custom `beautiful_chat` graph that emits ingredient tool calls matching
the frontend catalog. Porting to CrewAI needs:

1. A bespoke `beautiful_chat` crew (~5 agents, curated system prompts,
   tools that emit the ingredient tool-calls the frontend catalog
   expects).
2. A combined runtime endpoint on the Next.js side (`openGenerativeUI:
true`, `a2ui.injectA2UITool: false`, `mcpApps.servers`). MCP Apps
   still has no CrewAI backend wiring (see `mcp-apps` above), so even a
   partial port would be an A2UI + OGUI duet without the MCP leg.

### `byoc-hashbrown`, `byoc-json-render` — **deferred**

BYOC (bring-your-own-catalog) demos require an agent whose system
prompt is tuned to emit structured JSON matching the catalog schema
(`@hashbrownai/react` / `@json-render/react` respectively). The shared
CrewAI crew emits A2UI via `GenerateA2uiTool` — the native CrewAI
structured-output surface — and does NOT emit hashbrown- or
json-render-shaped JSON. Porting needs per-demo crews with catalog-aware
system prompts; the two catalogs are proprietary to their respective
libraries and not interchangeable with A2UI.

### `declarative-gen-ui`, `a2ui-fixed-schema` — **deferred**

Both demos lean on A2UI rendering with `injectA2UITool: false` — the
backend agent owns its own render tool. The shared CrewAI crew has
`GenerateA2uiTool` (which could serve the dynamic case) but no fixed-
schema counterpart; porting requires per-demo crews with tuned prompts.
The existing `open-gen-ui` demos cover the open-ended A2UI surface.

### `cli-start` — **not a page-level demo**

Manifest-only entry describing the `npx copilotkit@latest init` command.
Already covered implicitly by the root manifest.

## Summary counts

- **Total LangGraph-Python demos:** 37
- **Existing CrewAI-Crews demos (pre-parity):** 10
- **Wave 1 ports (PR #4262 first push):** 18
- **Wave 2 ports (this update):** 3 (`auth`, `voice`, `multimodal`)
- **Wave 2 backend fix:** `agent-config` now end-to-end
- **Skipped (architectural):** 3 (`gen-ui-interrupt`, `interrupt-headless`, `mcp-apps`)
- **Deferred (per-demo backend work required):** 5 (`beautiful-chat`,
  `byoc-hashbrown`, `byoc-json-render`, `declarative-gen-ui`,
  `a2ui-fixed-schema`)
- **Not applicable:** `cli-start`

CrewAI Crews covers ~84% of the LangGraph-Python feature matrix after
Wave 2. Full parity on the five deferred demos requires dedicated
per-demo crews (backend design work, not plumbing) and is tracked as
follow-up work.
