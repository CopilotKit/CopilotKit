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
| reasoning-custom                | Reasoning         | Uses the shared crew; reasoning tokens if model emits  |
| reasoning-default               | Reasoning         | Default CopilotChatReasoningMessage                    |
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

| Demo               | Kind         | Crew module                        | Backend path          |
| ------------------ | ------------ | ---------------------------------- | --------------------- |
| declarative-gen-ui | A2UI Dynamic | `agents/declarative_gen_ui.py`     | `/declarative-gen-ui` |
| a2ui-fixed-schema  | A2UI Fixed   | `agents/a2ui_fixed.py`             | `/a2ui-fixed-schema`  |
| byoc-hashbrown     | BYOC JSON    | `agents/byoc_hashbrown_agent.py`   | `/byoc-hashbrown`     |
| byoc-json-render   | BYOC JSON    | `agents/byoc_json_render_agent.py` | `/byoc-json-render`   |
| beautiful-chat     | Flagship     | `agents/beautiful_chat.py`         | `/beautiful-chat`     |

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

## Reasoning demos — framework-bridge limitation (no `REASONING_MESSAGE_*`)

### Affected cells

- `reasoning-custom`
- `reasoning-default`
- `tool-rendering-reasoning-chain`

All three are registered in `src/app/api/copilotkit/route.ts` as agent
names that resolve to the **shared `LatestAiDevelopment` crew** via
`HttpAgent` pointed at `/` (the FastAPI `add_crewai_crew_fastapi_endpoint`
mount). There is no dedicated reasoning agent module — these cells reuse
the shared crew, exactly like the other frontend-first ports.

The Wave-1 table above lists these as ported with the caveat "reasoning
tokens if model emits." That caveat is structurally incorrect: the
CrewAI AG-UI bridge **cannot emit reasoning to AG-UI at all**, regardless
of model. This section documents why and what a real fix requires.

### What backs the reasoning cells

The frontend is correct and matches the LangGraph-Python gold standard:
`tool-rendering-reasoning-chain/page.tsx` (and the `reasoning-*` pages)
wire a `reasoningMessage` slot that renders the custom `ReasoningBlock`.
That slot only paints when the agent streams AG-UI `REASONING_MESSAGE_*`
events with `role: "reasoning"`. The demo is built right — the events
never arrive.

### Why the bridge can't emit `REASONING_MESSAGE_*` (or anything reasoning)

The request flows entirely through `ag-ui-crewai` (pinned
`>=0.2.0,<0.3.0`; verified against the installed `0.2.0`):

1. `ag_ui_crewai.crews.ChatWithCrewFlow.chat()` runs the chat LLM via
   `litellm.acompletion(model=self.crew.chat_llm, ..., stream=True)`.
   The shared crew's `chat_llm` is **`gpt-4o`** (`src/agents/crew.py`),
   a non-reasoning chat-completions model that emits no
   `reasoning_content` in the first place.
2. The stream is consumed by `ag_ui_crewai.sdk.copilotkit_stream` →
   `_copilotkit_stream_custom_stream_wrapper`. That loop reads **only**
   `chunk.choices[0].delta.content` (→ `TEXT_MESSAGE_CHUNK`) and
   `chunk.choices[0].delta.tool_calls` (→ `TOOL_CALL_CHUNK`). It never
   inspects `delta.reasoning_content`.
3. The bridge's entire event vocabulary (`ag_ui_crewai/events.py`) is
   four bridged types — `TextMessageChunkEvent`, `ToolCallChunkEvent`,
   `CustomEvent`, `StateSnapshotEvent`. The FastAPI endpoint
   (`ag_ui_crewai/endpoint.py`) registers AG-UI forwarding listeners for
   exactly those four. **There is no reasoning event in the bridge** —
   not `REASONING_MESSAGE_*` (the channel `@ag-ui/client` renders), and
   not `THINKING_*` (which `@ag-ui/client` drops anyway). Nothing
   reasoning-shaped is produced or forwarded.

So even pointing the crew at a reasoning-capable model would not light
up the slot: the bridge discards `reasoning_content` before it can
become an AG-UI event.

### Why the agno / claude-sdk-python custom-synth pattern does NOT port here

Other non-Responses-API integrations (`agno/src/agent_server.py`,
`claude-sdk-python/src/agents/reasoning_agent.py`) DO emit
`REASONING_MESSAGE_*`. Their PRIMARY path reads the model's native
reasoning channel — agno reads `RunContentEvent.reasoning_content`;
claude-sdk-python reads Anthropic's Messages-API `thinking_delta` — and
re-emits it as reasoning-role events. Only as a FALLBACK (when no native
reasoning channel is present) do they buffer the assistant text, parse a
`<reasoning>…</reasoning>` span, and re-emit that. Both paths work there
because **those integrations own their entire agent-server endpoint** —
they hand-write the async generator that yields the AG-UI event stream,
so they control native-channel forwarding, buffering, and emission.

crewai-crews owns no such loop. The whole request lifecycle —
the litellm stream, the chunk→event translation, the crewai event bus,
the SSE encoder, kickoff/teardown — lives inside
`add_crewai_crew_fastapi_endpoint`. The showcase's only sanctioned
extension points are preseeding the system prompt
(`_chat_flow_helpers.preseed_system_prompt`) and monkey-patching
`ChatWithCrewFlow.__init__` (`install_custom_system_message`). Neither
touches the streaming path. Synthesizing reasoning would require forking
or monkey-patching `copilotkit_stream` itself — the chunk-by-chunk heart
of the bridge that never buffers a full assistant message — which is a
framework fork, brittle across `ag-ui-crewai` releases, and exactly the
kind of demo-hack this repo prohibits. There is no clean, supported
synth seam for crewai-crews.

### What a real fix requires (upstream `ag-ui-crewai`)

A first-class fix belongs in the bridge, not the showcase:

1. Add a `BridgedReasoningMessageChunkEvent` (mapping to AG-UI
   `REASONING_MESSAGE_*`, `role: "reasoning"`) to
   `ag_ui_crewai/events.py`, and register a forwarding listener in
   `endpoint.py`.
2. In `copilotkit_stream._copilotkit_stream_custom_stream_wrapper`, read
   `chunk.choices[0].delta.reasoning_content` (the litellm
   chat-completions reasoning field) and emit the new reasoning chunk
   event, mirroring the existing `content` / `tool_calls` handling.
3. Point the reasoning cells' crew at a reasoning-capable chat-completions
   model whose litellm adapter populates `reasoning_content` (e.g. a
   DeepSeek-R1-class or o-series-via-litellm model), or wire a dedicated
   reasoning crew on its own mount the way Wave 3 added dedicated crews.

Until `ag-ui-crewai` surfaces reasoning, the three reasoning cells render
the assistant answer and any tool cards correctly, but the
`reasoningMessage` slot stays empty — the chain-of-thought channel is a
bridge-level dead end on CrewAI today. The cells are intentionally left
in place (frontend is parity-correct) rather than weakened or removed.
