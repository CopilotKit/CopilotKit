# Headless Interrupt — Spring AI (Strategy B)

## What This Demo Shows

A split-pane layout with chat on the right and an app surface on the left.
When the agent calls `schedule_meeting`, a time-picker popup appears in the
app surface (outside the chat). Picking a slot resolves the tool call, the
popup vanishes, and the agent confirms back in chat.

## How It Works (Strategy B)

Spring AI's `ChatClient` has no graph-interrupt primitive, so we adapt using
**Strategy B**: the backend agent (`InterruptAgentController`) has a scheduling
system prompt but no backend tool callbacks. The `schedule_meeting` tool is
registered entirely on the frontend via `useFrontendTool` with an async handler
that sets a `pending` state to show the external popup. The handler returns a
Promise that only resolves when the user interacts with the popup.

This is the headless variant of `gen-ui-interrupt` — same backend agent, but
the picker UI lives in the app surface instead of inline in the chat.

## Reference

- LangGraph Python (native interrupt): [`langgraph-python/src/app/demos/interrupt-headless`](../../../../../langgraph-python/src/app/demos/interrupt-headless)
- MS Agent Python (same Strategy B): [`ms-agent-python/src/app/demos/interrupt-headless`](../../../../../ms-agent-python/src/app/demos/interrupt-headless)
