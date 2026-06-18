# Bug: Agent Spec × AG-UI adapter breaks multi-turn conversations when server tools are used

**Affected package:** `ag-ui-agent-spec` (the `ag_ui_agentspec` adapter, `ag-ui-protocol/ag-ui` → `integrations/agent-spec/python`), `langgraph` runtime.
**Stack:** `pyagentspec 26.2.0.dev6`, langgraph runtime, OpenAI via `langchain-openai`; consumed by a CopilotKit V2 frontend over AG-UI. Python 3.12.
**Severity:** High — any conversation that uses a server-side tool fails on the _next_ user turn. Blocks multi-turn agents and the human-in-the-loop (confirm-then-act) pattern.

## Summary

When an Agent Spec agent with `ServerTool`s runs on the LangGraph runtime behind `add_agentspec_fastapi_endpoint`, the **first** turn works. The tool calls emit a warning:

```
AG-UI tool-call correlation miss: no ToolExecutionRequest recorded for request_id='call_…';
using the raw request_id as a surrogate tool_call_id. The emitted tool result may be
orphaned because the frontend never saw this id.
```

On the **second** turn (any follow-up after a turn that called a tool), the LangGraph `model` node fails:

```
openai.BadRequestError: Error code: 400 - {'error': {'message': "Invalid parameter:
messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.",
'type': 'invalid_request_error', 'param': 'messages.[N].role'}}
```

## Root cause (analysis)

Server-side tool calls are not recorded as `ToolExecutionRequest`s, so the adapter emits the tool **result** with a _surrogate_ `tool_call_id` (the raw `request_id`) that the frontend never associated with an assistant `tool_calls` entry. The conversation history that the frontend then replays on the next turn therefore contains a `role: "tool"` message with no preceding assistant message carrying the matching `tool_calls`. OpenAI rejects that message sequence (400). The first-turn `correlation miss` warning and the second-turn 400 are the same defect observed at two points.

## Minimal reproduction

1. Define an Agent Spec `Agent` with a `ServerTool` (e.g. `recall_memory(query)`), serialize, and serve it:
   `add_agentspec_fastapi_endpoint(app, AgentSpecAgent(agent_json, runtime="langgraph", tool_registry={...}), path="/run")`.
2. Connect any AG-UI client (CopilotKit V2).
3. **Turn 1:** send a message that makes the model call the server tool → succeeds; server logs the `correlation miss` warning.
4. **Turn 2:** send any follow-up → the run fails with the OpenAI 400 above; the user gets no reply.

Observed in the Oracle × CopilotKit cookbook: turn 1 (recall + search via `search_trips`) works and is correctly personalized; replying "confirm" (turn 2) fails with the 400, so the `book_trip` (`requires_confirmation`) HITL flow can never be reached.

## Impact

- Multi-turn conversations are broken whenever a server tool is used.
- The human-in-the-loop `requires_confirmation` flow (propose → user confirms → execute) is unreachable, because confirmation is inherently a second turn.

## Suggested direction

Record a `ToolExecutionRequest` for every server-tool invocation so the emitted tool result carries the _same_ `tool_call_id` the assistant `tool_calls` entry used (and is visible to the frontend), so the replayed history is a valid `assistant(tool_calls) → tool(result)` sequence. Alternatively, reconcile tool_call_ids when reconstructing LangGraph message history from the incoming AG-UI `messages` so orphaned `tool` messages are repaired or dropped before the model call.

## Workaround (implemented)

The cookbook now applies a server-side workaround in `agent/concierge/server.py`. The
LangGraph runner is checkpointed per `thread_id` and, each turn, tries to append only
the client messages whose ids aren't already in the checkpoint
(`filter_only_new_messages`). But CopilotKit re-sends the **full** history with ids
that never match the checkpoint's, so a second copy of the
`assistant(tool_calls)`/`tool` block is appended and the merged history is invalid.

Since the client already sends the full, valid history every turn, we replace the
adapter's incremental merge with a full-history **replace**: monkey-patch
`filter_only_new_messages` to prepend a `RemoveMessage(REMOVE_ALL_MESSAGES)` and return
the client's history verbatim, so `add_messages` clears the checkpoint's copy and uses
the client's valid history. This restores multi-turn conversations **and** makes the
`book_flight` (`requires_confirmation`) HITL flow reachable (search → pick → confirm →
boarding pass all work). The adapter drives every turn — including HITL resume — through
`astream({"messages": ...})`, so the replace covers that path too.

This is a workaround, not a fix: it lives in cookbook code and reaches into a private
adapter function. Remove it once the upstream adapter records `ToolExecutionRequest`s so
the emitted tool-call ids correlate (the "Suggested direction" above). Pin to a fixed
adapter commit and re-test as the integration matures.

## Environment

- `ag-ui-agent-spec` installed from `git+https://github.com/ag-ui-protocol/ag-ui.git#subdirectory=integrations/agent-spec/python` (`[langgraph]` extra)
- `pyagentspec 26.2.0.dev6`, langgraph runtime, `langchain-openai`, Python 3.12
- Frontend: CopilotKit V2 (`0.0.0-mme-ag-ui-0-0-46-…`), `@ag-ui/client ^0.0.46`
- Model: an OpenAI chat model via `OpenAiCompatibleConfig` (key from env)
