# Parity Notes — OpenAI Agents SDK (Python)

How this package differs from the `langgraph-python` reference, and why. The
frontend (demo pages, routes) is the shared one; the differences are all in
the Python backend under `src/demo_agents/`.

## Backend model

- Every demo is a plain OpenAI Agents SDK `Agent` (`openai-agents`, import
  name `agents`). `src/demo_agents/registry.py` maps each agent name the
  pages use to the adapter's `OpenAIAgentsAgent` around it, and
  `agent_server.py` serves each with `add_openai_agents_fastapi_endpoint` at
  `POST /<name>`.
- The package is `demo_agents`, not `agents`: a local `agents` package would
  shadow the SDK. Its CVDIAG loggers keep their `agents.*` names because
  `_shared/cvdiag_bootstrap.py` listens on that subtree.
- The AG-UI adapter is `ag-ui-openai-agents` (PyPI, from
  ag-ui-protocol/ag-ui `integrations/openai-agents/python`). It
  translates the messages and the page's tools, runs the agent, streams the
  SDK's events as AG-UI events, puts the run's state and context in reach of
  the agent, turns approval pauses into interrupts, and closes the run with a
  `MESSAGES_SNAPSHOT` that keeps the reasoning.
- Two routes add a little on top, both subclasses of `OpenAIAgentsAgent`:
  `DocumentStreamingAgent` (shared-state-streaming) and `SchedulerAgent`
  (the interrupt cells). See their sections below.

## LLM path

- One `AsyncOpenAI` client for the process (`_common.openai_client()`),
  registered as the SDK default. It reads `OPENAI_API_KEY` and
  `OPENAI_BASE_URL`; compose points the latter at aimock.
- The SDK talks the Responses API. It sends the whole input on every model
  call (no `previous_response_id`), so aimock sees the full conversation and
  the usual `userMessage` / `toolCallId` matchers work.
- An httpx request hook copies the request's `x-aimock-*`, `x-test-id` and
  `x-diag-*` headers onto every model call and forces
  `x-aimock-context: openai-agents-python`. The headers reach the hook
  through `HeaderForwardingHTTPMiddleware`'s ContextVar, which the streaming
  body and the SDK's run task inherit.
- Tracing is off unless `OPENAI_AGENTS_TRACING=1` (the mock key cannot upload
  traces).

## Tool execution

- Backend tools are `@function_tool`s. The adapter streams each call as
  `TOOL_CALL_START/ARGS/END` and the return value as `TOOL_CALL_RESULT`.
- Page tools (`useFrontendTool`, `useHumanInTheLoop`, `useComponent`, the
  OGUI and MCP Apps tools the runtime injects) reach the agent as client
  tools. When the model calls one, the adapter's proxy ends the AG-UI run;
  the next run carries the browser's result as a tool message and the agent
  continues from the full history. The adapter drops a page tool whose name
  a backend tool already uses.
- `gen-ui-agent` and `subagents` run with `parallel_tool_calls=False`, as
  their prompts walk one step per model call.

## Shared state and agent context

- The adapter makes `RunAgentInput.state` the run's shared state. Tools read
  and change it with `shared_state()` (`.value`, `.update(...)`), and each
  change streams as a `STATE_SNAPSHOT` before the next event, so it reaches
  the page while the run is still going, in order with the tool call events.
- The adapter appends the `useAgentContext` entries to every agent's
  instructions on each model call, as `CopilotKitMiddleware` does for the
  reference, and hands the context list to tools as the SDK run context
  (`generate_a2ui` reads it there).
- `shared-state-read` and `shared-state-read-write` also show the model the
  state, as JSON, through dynamic instructions (`with_state` in
  `shared_state.py`).
- `shared-state-streaming`: `DocumentStreamingAgent` follows the
  `TOOL_CALL_ARGS` deltas of a `write_document` call and, after each one,
  sends the `document` argument's text so far as a `STATE_DELTA` on
  `/document`. The tool body commits the final text. The adapter has no
  option for this (`ag_ui_adk` has `PredictStateMapping(stream_tool_call=True)`).

## Interrupts (`gen-ui-interrupt`, `interrupt-headless`)

- `schedule_meeting` is a `@function_tool(needs_approval=True)`. The SDK
  pauses before the tool runs, and the adapter ends the AG-UI run with one
  interrupt per paused call (id = tool call id, `reason: "tool_approval"`,
  arguments in `metadata.tool_input`). The paused call stays in the
  `MESSAGES_SNAPSHOT` with no result, so the page holds it.
- The page answers `{approved: true, chosen_time, chosen_label}` or
  `{approved: false}` (cancel). The next request carries the same history
  plus that `resume` entry, and the adapter answers the open call before the
  model runs: an approved call runs its tool, a rejected one gets
  "Tool execution was not approved.". Nothing is kept on the server.
- An SDK approval is a yes or a no, so the adapter hands the tool its
  arguments only. `SchedulerAgent` keeps the request's answers in a
  ContextVar that `schedule_meeting` reads by its tool call id, to get the
  picked time.
- The adapter's costs apply: the resumed call runs outside the SDK's run
  loop, so tool guardrails and run hooks do not see it, and the server
  trusts the history it is sent, as it does for page tool results.
- The two cells are quarantined for `langgraph-python` on a react-core
  resume-path bug; `strands` runs them on react-core 1.68.2, this package on
  1.76.0.

## Sub-agents

The supervisor's three tools each run an Agents SDK sub-agent with
`Runner.run(sub_agent, task)` (one model call through the same client) and
append a delegation entry to `state.delegations`. `Agent.as_tool()` would
run them too but cannot record the delegation.

## Reasoning

`reasoning-*` and `tool-rendering-reasoning-chain` ask the Responses API for
reasoning summaries (`ModelSettings(reasoning=Reasoning(effort="low",
summary="auto"))`). The adapter streams them as `REASONING_*` events and
keeps them, with their encrypted values, in the closing `MESSAGES_SNAPSHOT`.
`OPENAI_REASONING_MODEL` picks the model (default `OPENAI_MODEL`, `gpt-6-luna`).
Every other agent runs `gpt-6-luna` with reasoning off
(`Reasoning(effort="none")`, `chat_settings()` in `_common.py`), as the
other OpenAI-backed integrations do. A different `OPENAI_MODEL` keeps the
API's default effort.

## Multimodal

The adapter turns `image` parts into `input_image` (data URLs for inline
data) and `document` parts into `input_file`, so a PDF reaches the model as a
file. As in `google-antigravity`, the page has no legacy-converter shim: the
modern parts validate as AG-UI 1.0 input.

## Declarative and open generative UI

- `a2ui-fixed-schema`: `display_flight` returns an `a2ui_operations`
  container; the route sets `injectA2UITool: false`.
- `declarative-gen-ui` / `a2ui-recovery`: backend-owned, like google-adk and
  google-antigravity. `generate_a2ui(request)` reads the catalog schema and
  sales context from the run's app context, makes its own forced
  `render_a2ui` Responses call, and runs the A2UI toolkit's validate→retry
  loop. The routes set `injectA2UITool: false`.
- `open-gen-ui*`, `mcp-apps`: the runtime injects the tools; the agent only
  calls them.
- `declarative-hashbrown` / `declarative-json-render`: tool-less agents whose
  prompts make them answer with the JSON the page's renderer parses.

## Not supported

- `cli-start`: no CLI starter template exists for the Agents SDK.

## Fixtures (`showcase/aimock/d6/openai-agents-python/`)

- Start from `ms-agent-python`'s set: same OpenAI tool-calling flow, state
  and context folded into the prompt, follow-ups keyed on `toolCallId` /
  `hasToolResult`. They inherit its 15 intentional duplicate aliases.
- `a2ui-recovery`, `gen-ui-declarative`, `declarative-hashbrown`,
  `declarative-json-render`, `gen-ui-open-advanced`,
  `threadid-frontend-tool-roundtrip` and beautiful-chat's suggestion pills
  come from `google-antigravity` (same backend-owned A2UI shape). Their
  `turnIndex` values are re-staged: aimock turns each Responses output item
  (a text message, a `function_call`) into one assistant message, which
  counts differently from antigravity's harness. `shared-state-read` is
  langgraph-python's (text only).
- `gen-ui-interrupt` / `interrupt-headless` come from `strands` (same
  prompts, same `schedule_meeting` arguments), with the cancel legs keyed on
  the adapter's rejection text (`toolResultContains: "not approved"`). Each prompt also has one confirmation
  leg per picker slot, keyed on the slot label in the tool result, so the
  reply names the time the user actually picked: this package is in the
  aimock e2e workflow, and its specs assert the picked time. The generic
  confirmation leg from strands stays last. `toolResultContains` needs a
  current aimock: 1.35.0 drops the key, so every resume matched the cancel
  leg (`docker pull ghcr.io/copilotkit/aimock:latest`).
- The scheduling legs ms-agent-python keeps in `hitl-in-chat.json` are
  dropped: `gen-ui-interrupt.json` loads first and shadows them. The page's
  own `book_call` legs for its two suggestions come from
  `google-antigravity`.
- The Playwright specs send pill prompts the D6 probes do not (prebuilt
  "Say hi" pills, agent-config "First"/"Second", shared-state-read recipe
  pills, ...). Those legs come from `google-antigravity`, re-staged on
  `hasToolResult` or this slug's assistant count. Where antigravity first
  called its `get_app_context` / `get_shared_state` tool, the reply comes
  straight away here: the context and state are already in the
  instructions.
- Playwright requests are not strict, and aimock then relaxes `turnIndex`:
  a leg whose `turnIndex` is behind the conversation beats a leg without
  one. Six ms-agent-python first legs keyed on `turnIndex: 0`
  (gen-ui-tool-based, tool-rendering's San Francisco and Tokyo legs,
  reasoning-chain's flight leg) therefore re-issued their call instead of
  letting the `toolCallId` follow-up answer; they are keyed on
  `hasToolResult: false` instead.
- No `byoc.json`: ms-agent-python's answers the hashbrown pill with a
  `render_dashboard` tool call, and aimock loads `byoc.json` before
  `declarative-hashbrown.json`. Here the BYOC agents are tool-less, as in
  `google-antigravity`.
- The a2ui-recovery pills use this slug's own prompts, mirrored in
  `harness/src/probes/scripts/d5-a2ui-recovery.ts`.

## Operational

- `deployed: false`, `docs_mode: hidden`. There is no Railway service yet, so
  the package is not in `showcase_build.yml`'s deploy matrix.
- Pins: `openai-agents==0.24.0`, `ag-ui-protocol==1.0.0`; the `@copilotkit/*`
  packages use `google-antigravity`'s 1.76.0 override
  (`scripts/showcase-canonical-pins.json`).
