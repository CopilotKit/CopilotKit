---
name: copilotkit-agui
description: "Use when building custom agent backends, implementing the AG-UI protocol, debugging streaming issues, or understanding how agents communicate with frontends. Covers event types, SSE transport, AbstractAgent/HttpAgent patterns, state synchronization, tool calls, and human-in-the-loop flows."
version: 1.0.0
---

# AG-UI Protocol Skill

## Overview

AG-UI (Agent-User Interaction) is CopilotKit's open event-based protocol for agent-to-UI communication. All agent-frontend interaction flows through typed events streamed over SSE (Server-Sent Events) or binary protobuf transport. Agents implement `AbstractAgent.run()` returning an RxJS `Observable<BaseEvent>`, and the client SDK handles event application, state management, and message history.

## When to Use

- Building a custom agent backend that needs to speak AG-UI
- Implementing `AbstractAgent.run()` for a new framework integration
- Debugging why events aren't reaching the frontend or arriving malformed
- Understanding event ordering (lifecycle, text, tool calls, state)
- Working with state synchronization (snapshots vs JSON Patch deltas)
- Implementing human-in-the-loop interrupt/resume flows
- Troubleshooting SSE streaming or encoding issues

## When NOT to Use

- For CopilotKit React hooks and frontend components, use `copilotkit-develop`
- For CopilotKit runtime setup and configuration, use `copilotkit-setup`
- For framework-specific integration guides (LangGraph, Mastra, CrewAI), use `copilotkit-integrations`

## Quick Reference

### Event Families

| Family | Events | Purpose |
|--------|--------|---------|
| Lifecycle | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED` | Run boundaries and progress |
| Text | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` | Streaming text messages |
| Tool Calls | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT` | Agent tool invocations |
| State | `STATE_SNAPSHOT`, `STATE_DELTA`, `MESSAGES_SNAPSHOT` | State synchronization |
| Reasoning | `REASONING_START`, `REASONING_MESSAGE_START/CONTENT/END`, `REASONING_END`, `REASONING_ENCRYPTED_VALUE` | Chain-of-thought visibility |
| Activity | `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` | Structured progress updates |
| Custom | `RAW`, `CUSTOM` | Extension points |

### Convenience Chunk Events

`TEXT_MESSAGE_CHUNK` and `TOOL_CALL_CHUNK` auto-expand into Start/Content/End triads via the client's `transformChunks` pipeline. Use these for simpler backend implementations.

### SSE Wire Format

Each event is a JSON object sent as an SSE data line:

```
data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1"}\n\n
data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}\n\n
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Hello"}\n\n
data: {"type":"TEXT_MESSAGE_END","messageId":"m1"}\n\n
data: {"type":"RUN_FINISHED","threadId":"t1","runId":"r1"}\n\n
```

### Packages

| Package | npm | Purpose |
|---------|-----|---------|
| `@ag-ui/core` | Events, types, schemas | Protocol definition |
| `@ag-ui/client` | AbstractAgent, HttpAgent, middleware, event application | Client SDK |
| `@ag-ui/encoder` | EventEncoder (SSE + protobuf) | Server-side encoding |

## Workflow: Building an AG-UI Backend

1. **Define your endpoint** -- Accept POST with `RunAgentInput` body, respond with `text/event-stream`
2. **Parse input** -- Extract `threadId`, `runId`, `messages`, `tools`, `state`, `context` from the request body
3. **Emit events in order** -- `RUN_STARTED` first, then content events, then `RUN_FINISHED` or `RUN_ERROR`
4. **Encode as SSE** -- Use `@ag-ui/encoder`'s `EventEncoder.encode()` or manually write `data: JSON\n\n`
5. **Handle tool results** -- Client sends `TOOL_CALL_RESULT` back; agent processes and continues

See `references/building-agents.md` for a complete working example.

## Key Protocol Rules

- Every run MUST start with `RUN_STARTED` and end with `RUN_FINISHED` or `RUN_ERROR`
- `TEXT_MESSAGE_CONTENT.delta` must be non-empty
- Tool call events are linked by `toolCallId`
- `STATE_DELTA` uses RFC 6902 JSON Patch operations
- Multiple sequential runs are supported -- each must complete before the next starts
- Messages accumulate across runs; state continues unless reset by `STATE_SNAPSHOT`

## References

- `references/protocol-spec.md` -- Complete event type reference with schemas and examples
- `references/building-agents.md` -- Step-by-step guide to building AG-UI backends
- `references/event-flow-diagrams.md` -- ASCII sequence diagrams for common flows
- `references/client-sdk.md` -- @ag-ui/client API reference
