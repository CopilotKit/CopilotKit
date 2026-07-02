# Hermes AG-UI adapter

Exposes the Hermes `AIAgent` over the [AG-UI protocol](https://docs.ag-ui.com/)
as an HTTP/SSE server, so AG-UI clients (e.g. CopilotKit's `HttpAgent`) can
drive Hermes. Sibling to `acp_adapter/`; targets AG-UI events instead of ACP.

## What works

- **Messages input** — the full AG-UI message list is rebuilt into Hermes
  conversation history each run (AG-UI is stateless per run).
- **Streaming** — assistant text and provider reasoning stream as
  `TEXT_MESSAGE_*` / `REASONING_MESSAGE_*` events; tool calls as `TOOL_CALL_*`.
- **Frontend (client-executed) tools** — tools sent in `RunAgentInput.tools`
  are advertised to the model but never run server-side. When the model calls
  one, the run emits the tool call and finishes; the client executes it and
  starts a new run with the result appended. See the core seam below.
- **Mixed server + frontend tool calls in one turn** — server-side tools in the
  batch execute (results streamed); frontend tools are handed back. Proven in
  `tests/agui_adapter/test_e2e_aimock.py::test_mixed_server_and_frontend_tool_calls`.
- **Frontend context** — `RunAgentInput.context[]` is injected as a read-only
  system message (never merged into the user message, to keep fixture matching
  deterministic).
- **Forwarded props (agent config)** — `RunAgentInput.forwarded_props` (typed
  props from CopilotKit's `useAgentContext`, e.g. `{tone, expertise}`) is
  rendered and injected as its own read-only system message per run.
- **Inbound shared state** — `RunAgentInput.state` is rendered as a
  `Current shared state: <json>` system message so the agent can read state the
  frontend set via `agent.setState` (shared-state-read / readonly-state).
- **Outbound shared state (state-writer tools)** — server-executed tools that
  mutate shared UI state and emit a `StateSnapshotEvent` after each call, so the
  frontend's `useAgent`/`useCoAgent` re-renders. See below.

## Shared-state write (`StateSnapshotEvent`)

CopilotKit shared-state demos need the agent to (a) SEE inbound state (done via
the system-message injection above) and (b) EMIT state updates when it mutates
state. Hermes has no first-class shared-state store, so the adapter provides one
per run:

1. **Seed.** A run-scoped `session.RunState` is seeded from inbound
   `RunAgentInput.state`, so every emitted snapshot carries UI-set keys (e.g.
   `preferences`) alongside agent-written keys (e.g. `notes`).
2. **Declare.** The frontend declares which server-executed tools write which
   state key via `forwarded_props["stateWriterTools"]` — a list (or name→decl
   map) of `{name, stateKey, arg?, mode?, description?, parameters?}`. `arg`
   picks which tool argument carries the value (omit → merge the whole args
   dict); `mode` is `"replace"` (default) or `"append"` (list slots). This keeps
   the tool→state-key mapping per-run and demo-specific, with no core changes.
3. **Write.** Each declared tool is registered with a server-side handler
   (mirroring the frontend-tool registration pattern, but it does NOT interrupt)
   that merges the call's args into the `RunState` and returns a confirmation —
   so the model reads the result and continues its turn normally.
4. **Emit.** After the run, the server emits, for each state-writer tool call
   (in message order), the normal `TOOL_CALL_*` + `TOOL_CALL_RESULT` events
   followed by a `StateSnapshotEvent` carrying the full merged state as of that
   call. Multiple calls (e.g. `set_steps` walking a plan) emit one snapshot
   each, in order.

Demo mapping:

| demo | tool | declaration |
|------|------|-------------|
| `shared_state_read_write` | `set_notes(notes)` | `{stateKey:"notes", arg:"notes"}` |
| `gen_ui_agent` | `set_steps(steps)` | `{stateKey:"steps", arg:"steps"}` |
| `shared_state_streaming` | `write_document(document)` | `{stateKey:"document", arg:"document"}` |
| `subagents` | `research/writing/critique_agent` | `{stateKey:"delegations", mode:"append"}` (partial — see below) |

`StateDeltaEvent` (JSON-Patch) is intentionally not emitted; a full snapshot per
call is simpler and deterministic, and CopilotKit re-renders identically from a
snapshot.

### Known limitations

- **`shared_state_streaming` per-token streaming** is NOT replicated. The
  langgraph demo streams the `document` arg token-by-token into state while the
  tool call is still streaming (`StateStreamingMiddleware`). This adapter emits
  the snapshot only *after* the tool call completes (tool events are derived
  post-hoc from the returned messages, which is how the whole adapter works).
  The end state is correct; the live token-by-token growth is not. Closing that
  gap would require intercepting tool-arg deltas during streaming — a larger
  change to the streaming path.
- **`subagents` delegation entries** append to `delegations`, but the langgraph
  demo builds a *typed* `Delegation` object (`{id, sub_agent, task, status,
  result}`) where `result` is the sub-agent's output — data the supervisor's
  tool call arguments don't contain (the result is computed inside the tool).
  The declarative `mode:"append"` appends the raw call args, so it captures
  `task`/`sub_agent` if the model passes them, but not the computed `result`.
  Fully matching that demo needs a custom handler (a code-level state-writer),
  not a declarative mapping.
- **Multimodal image passthrough** — image blocks in a user message
  (`image` / `image_url` / `input_image`) pass through as OpenAI-style content
  parts (`[{type:"text",…},{type:"image_url",…}]`); pure-text messages stay a
  plain string.

## Architecture

```
POST /  (RunAgentInput JSON)
  -> translate.prepare_run(messages, context)   # AG-UI -> Hermes history
  -> session.build_run_agent(...)               # merge frontend + state-writer tool schemas; register handlers
  -> AIAgent.run_conversation(...) on a worker thread   # (state-writer tools mutate the run-scoped RunState)
        text/reasoning -> events.AGUIEventBridge -> asyncio.Queue -> SSE frames (live)
        tool events    -> derived from the returned messages (real model ids)
        state snapshot -> StateSnapshotEvent after each state-writer tool call (from RunState)
  RUN_STARTED ... RUN_FINISHED | RUN_ERROR
```

**No Hermes core changes.** Frontend tools use mechanisms Hermes already
exposes:

- **Frontend tool = interrupt handler.** Each frontend tool name is registered
  (in the adapter) with a handler that calls `agent.interrupt()` and returns a
  placeholder. When the model calls it, the tool loop unwinds at its next
  top-of-loop interrupt check instead of making another model call. The adapter
  then reads the returned messages and emits the frontend tool call (real id,
  no result); the client executes it and starts a new run with the result.
- **Mixed server + frontend batches are deterministic** because a batch
  containing a frontend tool is never all-parallel-safe, so Hermes runs it
  sequentially (`_should_parallelize_tool_batch`) — the server tools finish and
  append their results before the frontend tool's handler interrupts.
- **Resume** (history tail is a tool result, no new user turn) is handled by
  `resume_shim.py`, a narrow runtime wrapper around `build_turn_context` that
  drops the synthetic trailing user turn — but ONLY while an AG-UI resume flag
  is set (a pure pass-through otherwise). This keeps Hermes core files
  untouched. (A ~15-line gated `continue_from_history` core flag would be the
  cleaner alternative if upstreaming is ever preferred.)

## Running

```bash
pip install -e '.[agui]'
OPENAI_BASE_URL=... OPENAI_API_KEY=... HERMES_AGUI_MODEL=gpt-4o hermes-agui
# or: python -m agui_adapter   (PORT, HERMES_AGUI_HOST, HERMES_AGUI_PROVIDER, HERMES_AGUI_TOOLSETS)
```

Point an AG-UI client at `http://127.0.0.1:8000/`.

## Tests

- `tests/agui_adapter/test_events.py`, `test_translate.py` — pure unit tests.
- `tests/agui_adapter/test_e2e_aimock.py` — end-to-end against a real
  [`@copilotkit/aimock`](https://www.npmjs.com/package/@copilotkit/aimock)
  fixture server (installed under `tests/agui_adapter/.aimock`, gitignored).
  Requires Node.js.

```bash
pip install -e '.[agui]' && pip install pytest pytest-asyncio
python -m pytest tests/agui_adapter/ -q
```
