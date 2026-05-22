# AG-UI Protocol Specification -- Event Type Reference

Complete reference for all AG-UI event types, derived from `@ag-ui/core` Zod schemas.

## Base Event Fields

All events extend `BaseEventSchema` and share these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `EventType` (string enum) | Yes | Event type discriminator |
| `timestamp` | `number` | No | Unix timestamp (ms) when event was created |
| `rawEvent` | `any` | No | Original event data if transformed from another format |

Events use `.passthrough()` so additional fields are preserved through parsing.

---

## Lifecycle Events

### RUN_STARTED

Emitted first when an agent begins processing. Establishes the run context.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"RUN_STARTED"` | Yes | |
| `threadId` | `string` | Yes | Conversation thread ID |
| `runId` | `string` | Yes | Unique run ID |
| `parentRunId` | `string` | No | Lineage pointer for branching/time travel |
| `input` | `RunAgentInput` | No | The exact agent input payload for this run |

```json
{
  "type": "RUN_STARTED",
  "threadId": "thread-abc",
  "runId": "run-123"
}
```

### RUN_FINISHED

Emitted when an agent run completes successfully. No further events for this run after this.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"RUN_FINISHED"` | Yes | |
| `threadId` | `string` | Yes | Conversation thread ID |
| `runId` | `string` | Yes | Run ID matching `RUN_STARTED` |
| `result` | `any` | No | Output data from the run |

```json
{
  "type": "RUN_FINISHED",
  "threadId": "thread-abc",
  "runId": "run-123",
  "result": { "summary": "Task completed" }
}
```

### RUN_ERROR

Emitted when an agent encounters an unrecoverable error. Terminates the run.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"RUN_ERROR"` | Yes | |
| `message` | `string` | Yes | Error description |
| `code` | `string` | No | Error code (e.g., `"abort"`, `"timeout"`) |

```json
{
  "type": "RUN_ERROR",
  "message": "Model API rate limited",
  "code": "rate_limit"
}
```

### STEP_STARTED

Emitted when a named step/phase begins within a run. Optional but recommended for progress visibility.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"STEP_STARTED"` | Yes | |
| `stepName` | `string` | Yes | Name of the step (e.g., node name, function name) |

```json
{
  "type": "STEP_STARTED",
  "stepName": "retrieve_documents"
}
```

### STEP_FINISHED

Emitted when a named step completes. Must match a corresponding `STEP_STARTED`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"STEP_FINISHED"` | Yes | |
| `stepName` | `string` | Yes | Name of the step |

```json
{
  "type": "STEP_FINISHED",
  "stepName": "retrieve_documents"
}
```

---

## Text Message Events

### TEXT_MESSAGE_START

Begins a new streaming text message.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TEXT_MESSAGE_START"` | Yes | |
| `messageId` | `string` | Yes | Unique message ID |
| `role` | `"developer" \| "system" \| "assistant" \| "user"` | No | Defaults to `"assistant"` |
| `name` | `string` | No | Optional sender name |

```json
{
  "type": "TEXT_MESSAGE_START",
  "messageId": "msg-1",
  "role": "assistant"
}
```

### TEXT_MESSAGE_CONTENT

Delivers a chunk of text content. Multiple events build the complete message.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TEXT_MESSAGE_CONTENT"` | Yes | |
| `messageId` | `string` | Yes | Must match `TEXT_MESSAGE_START.messageId` |
| `delta` | `string` | Yes | Text chunk (must be non-empty) |

```json
{
  "type": "TEXT_MESSAGE_CONTENT",
  "messageId": "msg-1",
  "delta": "Hello, how can "
}
```

### TEXT_MESSAGE_END

Signals that a text message is complete. No more content for this `messageId`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TEXT_MESSAGE_END"` | Yes | |
| `messageId` | `string` | Yes | Must match `TEXT_MESSAGE_START.messageId` |

```json
{
  "type": "TEXT_MESSAGE_END",
  "messageId": "msg-1"
}
```

### TEXT_MESSAGE_CHUNK (Convenience)

Auto-expands into `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` via the client's `transformChunks` pipeline. Simplifies backend implementation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TEXT_MESSAGE_CHUNK"` | Yes | |
| `messageId` | `string` | No | Required on first chunk; links subsequent chunks |
| `role` | `"developer" \| "system" \| "assistant" \| "user"` | No | Role for the message |
| `delta` | `string` | No | Text content chunk |
| `name` | `string` | No | Optional sender name |

The client transformer handles lifecycle:
- First chunk with a new `messageId` emits `TEXT_MESSAGE_START`
- Each chunk with `delta` emits `TEXT_MESSAGE_CONTENT`
- `TEXT_MESSAGE_END` is emitted when the stream switches to a new `messageId` or completes

```json
{
  "type": "TEXT_MESSAGE_CHUNK",
  "messageId": "msg-1",
  "role": "assistant",
  "delta": "Hello!"
}
```

---

## Tool Call Events

### TOOL_CALL_START

Begins a new tool invocation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TOOL_CALL_START"` | Yes | |
| `toolCallId` | `string` | Yes | Unique ID for this tool call |
| `toolCallName` | `string` | Yes | Name of the tool being called |
| `parentMessageId` | `string` | No | Links tool call to a parent assistant message |

```json
{
  "type": "TOOL_CALL_START",
  "toolCallId": "tc-1",
  "toolCallName": "searchDatabase",
  "parentMessageId": "msg-1"
}
```

### TOOL_CALL_ARGS

Streams argument data for a tool call. Arguments are JSON fragments that concatenate to form the complete arguments object.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TOOL_CALL_ARGS"` | Yes | |
| `toolCallId` | `string` | Yes | Must match `TOOL_CALL_START.toolCallId` |
| `delta` | `string` | Yes | Argument JSON fragment |

```json
{
  "type": "TOOL_CALL_ARGS",
  "toolCallId": "tc-1",
  "delta": "{\"query\": \"recent orders\"}"
}
```

### TOOL_CALL_END

Signals that a tool call's arguments are complete.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TOOL_CALL_END"` | Yes | |
| `toolCallId` | `string` | Yes | Must match `TOOL_CALL_START.toolCallId` |

```json
{
  "type": "TOOL_CALL_END",
  "toolCallId": "tc-1"
}
```

### TOOL_CALL_RESULT

Delivers the result of a tool execution. Sent after the tool has been executed (typically by the client/frontend).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TOOL_CALL_RESULT"` | Yes | |
| `messageId` | `string` | Yes | Message ID for this result in conversation history |
| `toolCallId` | `string` | Yes | Must match the corresponding `TOOL_CALL_START.toolCallId` |
| `content` | `string` | Yes | Tool execution output |
| `role` | `"tool"` | No | Defaults to `"tool"` |

```json
{
  "type": "TOOL_CALL_RESULT",
  "messageId": "msg-tool-1",
  "toolCallId": "tc-1",
  "content": "{\"results\": [{\"orderId\": \"123\"}]}",
  "role": "tool"
}
```

### TOOL_CALL_CHUNK (Convenience)

Auto-expands into `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` via the client's `transformChunks` pipeline.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"TOOL_CALL_CHUNK"` | Yes | |
| `toolCallId` | `string` | No | Required on first chunk |
| `toolCallName` | `string` | No | Required on first chunk |
| `parentMessageId` | `string` | No | Links to parent message |
| `delta` | `string` | No | Argument JSON fragment |

```json
{
  "type": "TOOL_CALL_CHUNK",
  "toolCallId": "tc-1",
  "toolCallName": "searchDatabase",
  "delta": "{\"query\":"
}
```

---

## State Management Events

### STATE_SNAPSHOT

Delivers a complete replacement of the agent's state. Frontend should discard existing state and use this snapshot.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"STATE_SNAPSHOT"` | Yes | |
| `snapshot` | `any` | Yes | Complete state object |

```json
{
  "type": "STATE_SNAPSHOT",
  "snapshot": {
    "documents": [],
    "currentStep": "planning",
    "progress": 0
  }
}
```

### STATE_DELTA

Delivers incremental state updates as RFC 6902 JSON Patch operations. Applied to current state using `fast-json-patch`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"STATE_DELTA"` | Yes | |
| `delta` | `Array<JsonPatchOp>` | Yes | Array of JSON Patch operations |

JSON Patch operations:
- `{ "op": "add", "path": "/key", "value": ... }`
- `{ "op": "replace", "path": "/key", "value": ... }`
- `{ "op": "remove", "path": "/key" }`
- `{ "op": "move", "path": "/to", "from": "/from" }`
- `{ "op": "copy", "path": "/to", "from": "/from" }`
- `{ "op": "test", "path": "/key", "value": ... }`

```json
{
  "type": "STATE_DELTA",
  "delta": [
    { "op": "replace", "path": "/currentStep", "value": "executing" },
    { "op": "replace", "path": "/progress", "value": 0.5 }
  ]
}
```

### MESSAGES_SNAPSHOT

Delivers a complete snapshot of the conversation message history. Uses edit-based merge: existing messages present in the snapshot are replaced, activity messages are preserved, messages not in the snapshot are removed, and new messages from the snapshot are appended.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"MESSAGES_SNAPSHOT"` | Yes | |
| `messages` | `Message[]` | Yes | Array of message objects |

```json
{
  "type": "MESSAGES_SNAPSHOT",
  "messages": [
    { "id": "m1", "role": "user", "content": "Hello" },
    { "id": "m2", "role": "assistant", "content": "Hi there!" }
  ]
}
```

---

## Activity Events

### ACTIVITY_SNAPSHOT

Delivers a complete snapshot of an activity (structured progress update displayed between chat messages).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"ACTIVITY_SNAPSHOT"` | Yes | |
| `messageId` | `string` | Yes | Activity message ID |
| `activityType` | `string` | Yes | Discriminator (e.g., `"PLAN"`, `"SEARCH"`, `"CODE"`) |
| `content` | `Record<string, any>` | Yes | Structured activity data |
| `replace` | `boolean` | No | Defaults to `true`. If `false`, ignored when message exists |

```json
{
  "type": "ACTIVITY_SNAPSHOT",
  "messageId": "activity-1",
  "activityType": "SEARCH",
  "content": {
    "query": "CopilotKit setup",
    "results": [],
    "status": "searching"
  }
}
```

### ACTIVITY_DELTA

Applies JSON Patch updates to an existing activity message's content.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"ACTIVITY_DELTA"` | Yes | |
| `messageId` | `string` | Yes | Must match an existing activity message |
| `activityType` | `string` | Yes | Activity discriminator |
| `patch` | `Array<JsonPatchOp>` | Yes | RFC 6902 JSON Patch operations |

```json
{
  "type": "ACTIVITY_DELTA",
  "messageId": "activity-1",
  "activityType": "SEARCH",
  "patch": [
    { "op": "replace", "path": "/status", "value": "complete" },
    { "op": "add", "path": "/results/0", "value": { "title": "Getting Started" } }
  ]
}
```

---

## Reasoning Events

### REASONING_START

Marks the beginning of a reasoning process (chain-of-thought).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_START"` | Yes | |
| `messageId` | `string` | Yes | Reasoning context ID |

```json
{
  "type": "REASONING_START",
  "messageId": "reasoning-1"
}
```

### REASONING_MESSAGE_START

Begins a streaming reasoning message (visible portion of chain-of-thought).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_MESSAGE_START"` | Yes | |
| `messageId` | `string` | Yes | Message ID |
| `role` | `"reasoning"` | Yes | Always `"reasoning"` |

```json
{
  "type": "REASONING_MESSAGE_START",
  "messageId": "reasoning-msg-1",
  "role": "reasoning"
}
```

### REASONING_MESSAGE_CONTENT

Delivers a chunk of reasoning text.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_MESSAGE_CONTENT"` | Yes | |
| `messageId` | `string` | Yes | Must match `REASONING_MESSAGE_START.messageId` |
| `delta` | `string` | Yes | Reasoning text chunk (must be non-empty) |

```json
{
  "type": "REASONING_MESSAGE_CONTENT",
  "messageId": "reasoning-msg-1",
  "delta": "Let me think about this..."
}
```

### REASONING_MESSAGE_END

Signals a reasoning message is complete.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_MESSAGE_END"` | Yes | |
| `messageId` | `string` | Yes | Must match `REASONING_MESSAGE_START.messageId` |

```json
{
  "type": "REASONING_MESSAGE_END",
  "messageId": "reasoning-msg-1"
}
```

### REASONING_MESSAGE_CHUNK (Convenience)

Auto-expands into `REASONING_MESSAGE_START` / `CONTENT` / `END` via client transformer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_MESSAGE_CHUNK"` | Yes | |
| `messageId` | `string` | No | Required on first chunk |
| `delta` | `string` | No | Reasoning text chunk |

```json
{
  "type": "REASONING_MESSAGE_CHUNK",
  "messageId": "reasoning-msg-1",
  "delta": "Analyzing the request..."
}
```

### REASONING_END

Marks the end of a reasoning process.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_END"` | Yes | |
| `messageId` | `string` | Yes | Must match `REASONING_START.messageId` |

```json
{
  "type": "REASONING_END",
  "messageId": "reasoning-1"
}
```

### REASONING_ENCRYPTED_VALUE

Attaches encrypted chain-of-thought to a message or tool call. Used for zero-data-retention (ZDR) scenarios where reasoning must be preserved across turns but not exposed to the client.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"REASONING_ENCRYPTED_VALUE"` | Yes | |
| `subtype` | `"message" \| "tool-call"` | Yes | Entity type this reasoning belongs to |
| `entityId` | `string` | Yes | ID of the message or tool call |
| `encryptedValue` | `string` | Yes | Opaque encrypted content blob |

```json
{
  "type": "REASONING_ENCRYPTED_VALUE",
  "subtype": "message",
  "entityId": "msg-1",
  "encryptedValue": "eyJhbGciOiJSU0..."
}
```

---

## Custom / Extension Events

### RAW

Passthrough container for events from external systems.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"RAW"` | Yes | |
| `event` | `any` | Yes | Original event data |
| `source` | `string` | No | Source system identifier |

```json
{
  "type": "RAW",
  "event": { "vendor_type": "langchain_event", "data": {} },
  "source": "langchain"
}
```

### CUSTOM

Application-specific extension events with named semantics.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"CUSTOM"` | Yes | |
| `name` | `string` | Yes | Custom event name |
| `value` | `any` | Yes | Event payload |

```json
{
  "type": "CUSTOM",
  "name": "citation",
  "value": { "url": "https://example.com", "title": "Reference" }
}
```

---

## Deprecated Events (Remove in 1.0.0)

These THINKING events are replaced by REASONING events:

| Deprecated | Replacement |
|------------|-------------|
| `THINKING_START` | `REASONING_START` |
| `THINKING_END` | `REASONING_END` |
| `THINKING_TEXT_MESSAGE_START` | `REASONING_MESSAGE_START` |
| `THINKING_TEXT_MESSAGE_CONTENT` | `REASONING_MESSAGE_CONTENT` |
| `THINKING_TEXT_MESSAGE_END` | `REASONING_MESSAGE_END` |

The client SDK includes `BackwardCompatibility_0_0_45` middleware that auto-converts these.

---

## Transport Encoding

### SSE (Server-Sent Events)

Default transport. Content-Type: `text/event-stream`.

Each event is encoded as:
```
data: <JSON>\n\n
```

The `@ag-ui/encoder` `EventEncoder` class produces this format:

```typescript
import { EventEncoder } from "@ag-ui/encoder";

const encoder = new EventEncoder();
const sseString = encoder.encode(event); // "data: {...}\n\n"
```

### Binary (Protobuf)

Optional binary transport using `@ag-ui/proto`. Content-Type: `application/x-ag-ui`.

Each message is length-prefixed: 4-byte big-endian uint32 length header followed by protobuf-encoded message bytes.

The `EventEncoder` auto-detects format from the `Accept` header:

```typescript
const encoder = new EventEncoder({ accept: req.headers.accept });
encoder.getContentType(); // "text/event-stream" or "application/x-ag-ui"
encoder.encodeBinary(event); // Uint8Array (SSE bytes or protobuf)
```

---

## Type Definitions (RunAgentInput)

The input payload sent to the agent on each run:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `threadId` | `string` | Yes | Conversation thread ID |
| `runId` | `string` | Yes | Unique run ID |
| `parentRunId` | `string` | No | Parent run for branching |
| `state` | `any` | Yes | Current state |
| `messages` | `Message[]` | Yes | Conversation history |
| `tools` | `Tool[]` | Yes | Available tools |
| `context` | `Context[]` | Yes | Additional context |
| `forwardedProps` | `any` | Yes | Pass-through properties |

### Message Types

Messages are discriminated by `role`:

| Role | Fields | Description |
|------|--------|-------------|
| `developer` | `id`, `role`, `content`, `name?`, `encryptedValue?` | Developer/system instructions |
| `system` | `id`, `role`, `content`, `name?`, `encryptedValue?` | System messages |
| `assistant` | `id`, `role`, `content?`, `toolCalls?`, `name?`, `encryptedValue?` | Agent responses |
| `user` | `id`, `role`, `content` (string or `InputContent[]`), `name?` | User messages (supports multimodal) |
| `tool` | `id`, `role`, `content`, `toolCallId`, `error?`, `encryptedValue?` | Tool results |
| `activity` | `id`, `role`, `activityType`, `content` (Record) | Activity progress |
| `reasoning` | `id`, `role`, `content`, `encryptedValue?` | Reasoning/thinking content |

### Tool Definition

```typescript
interface Tool {
  name: string;          // Tool name
  description: string;   // Human-readable description
  parameters: any;       // JSON Schema for parameters
}
```

### InputContent (Multimodal)

User messages can contain mixed content:

- `TextInputContent`: `{ type: "text", text: string }`
- `BinaryInputContent`: `{ type: "binary", mimeType: string, id?: string, url?: string, data?: string, filename?: string }` (requires at least one of `id`, `url`, or `data`)
