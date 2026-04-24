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

## Ported demos (Wave 3 — this update)

Five demos that previously required dedicated per-demo backend work have
all been shipped in this wave. Each runs against its own CrewAI crew
mounted at a distinct path on the FastAPI agent server
(`src/agent_server.py`), leaving the shared `LatestAiDevelopment` crew
on `/` untouched. The Next.js side uses per-demo runtime routes with
`HttpAgent` URLs pointing at the dedicated backend paths.

| Demo                | Kind          | Crew module                         | Backend path         |
| ------------------- | ------------- | ----------------------------------- | -------------------- |
| declarative-gen-ui  | A2UI Dynamic  | `agents/declarative_gen_ui.py`      | `/declarative-gen-ui` |
| a2ui-fixed-schema   | A2UI Fixed    | `agents/a2ui_fixed.py`              | `/a2ui-fixed-schema` |
| byoc-hashbrown      | BYOC JSON     | `agents/byoc_hashbrown_agent.py`    | `/byoc-hashbrown`    |
| byoc-json-render    | BYOC JSON     | `agents/byoc_json_render_agent.py`  | `/byoc-json-render`  |
| beautiful-chat      | Flagship      | `agents/beautiful_chat.py`          | `/beautiful-chat`    |

### Wave 3 implementation notes

**System-prompt control.** `ag-ui-crewai.crews.ChatWithCrewFlow` runs
`crewai.cli.crew_chat.build_system_message(crew_chat_inputs)` on
construction, which wraps any crew description in fixed "CrewAI platform"
boilerplate that instructs the LLM to introduce itself and ask for
clarifying inputs. For the A2UI demos we use
`_chat_flow_helpers.preseed_system_prompt` to install a tuned
`crew_description` into `_CREW_INPUTS_CACHE` (also skipping the
secondary AI description calls). For BYOC demos that must emit pure
JSON, we additionally patch `ChatWithCrewFlow.__init__` via
`_chat_flow_helpers.install_custom_system_message` so our full system
prompt replaces the composed one, fully bypassing the CrewAI platform
wrapper.

**BYOC wire format.** Both BYOC demos emit the schema shape directly
(NOT the XML-style `<ui>...</ui>` DSL used internally by hashbrown when
hashbrown itself drives the LLM). Hashbrown's `useJsonParser(content,
kit.schema)` consumes the schema shape at runtime; the XML DSL is the
authoring syntax that hashbrown compiles into that schema when its own
LLM adapters are wired up.

**byoc-json-render frontend hardening (from PR #4271).** Two fixes are
rolled into the ported frontend:

1. `registry.tsx` forwards `children` through the `MetricCard` wrapper
   so multi-component dashboards (a MetricCard with a nested BarChart)
   render as a wrapped block rather than dropping the chart.
2. `json-render-renderer.tsx` wraps `<Renderer />` in `<JSONUIProvider>`
   so the StateProvider / VisibilityProvider / ActionProvider /
   ValidationProvider contexts the ElementRenderer requires are
   available — without this wrap, clicking a suggestion crashes with
   "useVisibility must be used within a VisibilityProvider".

**beautiful-chat deviations.** Two deviations from the LangGraph
reference, both rooted in the CrewAI / `ag-ui-crewai` primitive set:

1. **No MCP Apps leg.** `ag-ui-crewai` has no MCP SSE multiplexer;
   CrewAI crews use Pydantic `BaseTool` lists. The Excalidraw MCP
   suggestion pill is removed from
   `hooks/use-example-suggestions.tsx`. The rest of the cell (A2UI
   fixed + dynamic, Open Generative UI, shared-state todos via a
   `manage_todos` tool) ports cleanly.
2. **Simplified shared-state todos.** LangGraph's `manage_todos`
   returns a `Command(update={...})` that patches graph state; CrewAI
   has no equivalent primitive. The CrewAI `ManageTodosTool` returns
   the new list as a JSON tool result which the frontend consumes via
   its existing `useCoAgent` wiring.

### `cli-start` — **not a page-level demo**

Manifest-only entry describing the `npx copilotkit@latest init` command.
Already covered implicitly by the root manifest.

## Summary counts

- **Total LangGraph-Python demos:** 37
- **Existing CrewAI-Crews demos (pre-parity):** 10
- **Wave 1 ports (PR #4262 first push):** 18
- **Wave 2 ports:** 3 (`auth`, `voice`, `multimodal`)
- **Wave 2 backend fix:** `agent-config` now end-to-end
- **Wave 3 ports (this update):** 5 (`declarative-gen-ui`,
  `a2ui-fixed-schema`, `byoc-hashbrown`, `byoc-json-render`,
  `beautiful-chat`)
- **Skipped (architectural):** 3 (`gen-ui-interrupt`,
  `interrupt-headless`, `mcp-apps`)
- **Not applicable:** `cli-start`

Only the three architectural-skips remain out of the LangGraph-Python
demo set.
