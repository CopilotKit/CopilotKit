# Generative UI (Interrupt) — Spring AI (Strategy B)

## What This Demo Shows

An agent triggers a time-picker card inline in the chat. The user picks a slot
or cancels, and the agent confirms the outcome. This produces the same UX as
the LangGraph version's `interrupt()` / `useInterrupt` flow.

## How It Works (Strategy B)

Spring AI's `ChatClient` has no graph-interrupt primitive, so we adapt using
**Strategy B**: the backend agent (`InterruptAgentController`) has a scheduling
system prompt that tells the LLM to call `schedule_meeting`, but registers
**no backend tool callbacks**. The `schedule_meeting` tool is registered
entirely on the frontend via `useFrontendTool` with an async handler that
renders a `TimePickerCard` and returns a Promise that only resolves once the
user picks a slot or cancels.

The existing `StreamingToolAgent` handles frontend-only tool calls correctly:
Phase 1 (streaming) detects the tool call, classifies it as a frontend tool,
and emits `TOOL_CALL_START/ARGS/END` events without a result. The CopilotKit
runtime then routes the tool call to the frontend handler.

## Reference

- LangGraph Python (native interrupt): [`langgraph-python/src/app/demos/gen-ui-interrupt`](../../../../../langgraph-python/src/app/demos/gen-ui-interrupt)
- MS Agent Python (same Strategy B): [`ms-agent-python/src/app/demos/gen-ui-interrupt`](../../../../../ms-agent-python/src/app/demos/gen-ui-interrupt)
