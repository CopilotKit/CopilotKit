# Shared State Streaming — Spring AI

Per-token state streaming for Spring AI. The agent defines a `write_document`
tool; as the LLM streams the tool-call arguments, the controller extracts the
growing `content` value and emits `STATE_SNAPSHOT` events. The frontend's
`useAgent({ updates: [OnStateChanged] })` subscription re-renders the document
panel on each snapshot, producing live per-token updates.

## How It Works

1. `ChatClient.stream()` runs with `internalToolExecutionEnabled=false` and a
   registered `write_document` tool callback. The model sees the tool and
   generates a tool call.

2. Each streaming chunk that carries tool-call data for `write_document` has
   accumulated arguments (e.g. `{"content": "Once upon a ti`). The controller
   parses the partial JSON to extract the growing content string.

3. On each increment, a `STATE_SNAPSHOT` is emitted with the updated
   `state.document`. The CopilotKit runtime merges this into agent state and
   the frontend re-renders.

4. After streaming completes, the controller emits the tool-call envelope
   events (start/args/end/result) and a final state snapshot.

## Reference

The LangGraph Python reference uses `StateStreamingMiddleware` for the same
effect — see `showcase/integrations/langgraph-python/src/agents/shared_state_streaming.py`.
