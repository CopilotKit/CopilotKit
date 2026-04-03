# Building AG-UI Agent Backends

Step-by-step guide to building an agent backend that speaks the AG-UI protocol.

## Architecture

```
Client (Browser)                    Agent Backend (Server)
  HttpAgent                           HTTP Endpoint
     |                                     |
     |-- POST /agent (RunAgentInput) ----->|
     |                                     |
     |<---- SSE: RUN_STARTED -------------|
     |<---- SSE: TEXT_MESSAGE_START -------|
     |<---- SSE: TEXT_MESSAGE_CONTENT -----|
     |<---- SSE: TEXT_MESSAGE_CONTENT -----|
     |<---- SSE: TEXT_MESSAGE_END ---------|
     |<---- SSE: RUN_FINISHED ------------|
```

The agent receives a POST request with `RunAgentInput` (JSON body containing `threadId`, `runId`, `messages`, `tools`, `state`, `context`, `forwardedProps`), and responds with a stream of SSE-encoded events.

## Step 1: Extend AbstractAgent (TypeScript In-Process)

For agents that run in the same process as the client (e.g., testing, serverless):

```typescript
import { AbstractAgent } from "@ag-ui/client";
import { RunAgentInput, BaseEvent, EventType } from "@ag-ui/core";
import { Observable } from "rxjs";

class MyAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const { threadId, runId, messages } = input;

      // 1. Always start with RUN_STARTED
      observer.next({
        type: EventType.RUN_STARTED,
        threadId,
        runId,
      });

      // 2. Emit content events
      const messageId = `msg-${Date.now()}`;

      observer.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      });

      // Stream text in chunks
      const response = "Hello! I received your message.";
      for (const char of response) {
        observer.next({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: char,
        });
      }

      observer.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      });

      // 3. Always end with RUN_FINISHED or RUN_ERROR
      observer.next({
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
      });

      observer.complete();
    });
  }
}
```

## Step 2: Constructing Events

Emit events as plain objects with the `type` field set to the appropriate `EventType` enum value:

```typescript
import { EventType } from "@ag-ui/core";

// Events are plain objects — no factory functions needed
const event = {
  type: EventType.TEXT_MESSAGE_CONTENT,
  messageId: "msg-1",
  delta: "Hello",
};
```

The event schemas are defined as Zod types in `@ag-ui/core` (e.g., `TextMessageContentEventSchema`) and can be used for validation if needed, but emitting plain objects is the standard pattern.

## Step 3: Expose as HTTP SSE Endpoint

For a standalone HTTP agent backend:

```typescript
import { EventEncoder } from "@ag-ui/encoder";
import { RunAgentInput, EventType } from "@ag-ui/core";

// Express example
app.post("/agent", async (req, res) => {
  const input: RunAgentInput = req.body;
  const encoder = new EventEncoder({ accept: req.headers.accept });

  // Set SSE headers
  res.setHeader("Content-Type", encoder.getContentType());
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");

  // Helper to emit events
  const emit = (event: any) => {
    res.write(encoder.encode(event));
  };

  try {
    // 1. RUN_STARTED
    emit({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    });

    // 2. Process messages and generate response
    const messageId = `msg-${Date.now()}`;

    emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    });

    // Stream response chunks (e.g., from LLM)
    for await (const chunk of generateResponse(input)) {
      emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: chunk,
      });
    }

    emit({
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    });

    // 3. RUN_FINISHED
    emit({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    });
  } catch (error) {
    emit({
      type: EventType.RUN_ERROR,
      message: error.message,
      code: "internal_error",
    });
  }

  res.end();
});
```

## Step 4: Handle Tool Calls

When your agent needs the frontend to execute a tool:

```typescript
// Agent emits tool call events
emit({
  type: EventType.TOOL_CALL_START,
  toolCallId: "tc-1",
  toolCallName: "getUserLocation",
  parentMessageId: messageId,  // Optional: link to parent message
});

emit({
  type: EventType.TOOL_CALL_ARGS,
  toolCallId: "tc-1",
  delta: JSON.stringify({ userId: "user-123" }),
});

emit({
  type: EventType.TOOL_CALL_END,
  toolCallId: "tc-1",
});

// The client executes the tool and sends the result
// In CopilotKit, this happens via useFrontendTool hook
// The result arrives as a TOOL_CALL_RESULT in the next run's messages:
// { role: "tool", toolCallId: "tc-1", content: "{\"lat\": 40.7, \"lng\": -74.0}" }
```

**Tool call flow:** The agent emits `TOOL_CALL_START/ARGS/END`, then typically emits `RUN_FINISHED`. The client executes the tool, adds the result to messages, and starts a new run. The agent sees the tool result in `input.messages` and continues.

## Step 5: Emit State Updates

Synchronize agent state with the frontend:

```typescript
// Full state snapshot (replaces all client state)
emit({
  type: EventType.STATE_SNAPSHOT,
  snapshot: {
    plan: ["Step 1: Research", "Step 2: Draft", "Step 3: Review"],
    currentStep: 0,
    progress: 0,
  },
});

// Incremental updates via JSON Patch (RFC 6902)
emit({
  type: EventType.STATE_DELTA,
  delta: [
    { op: "replace", path: "/currentStep", value: 1 },
    { op: "replace", path: "/progress", value: 0.33 },
  ],
});
```

## Step 6: Emit Activity Updates

For structured progress that appears between chat messages:

```typescript
// Create activity
emit({
  type: EventType.ACTIVITY_SNAPSHOT,
  messageId: "activity-search",
  activityType: "SEARCH",
  content: {
    query: "CopilotKit documentation",
    results: [],
    status: "in_progress",
  },
});

// Update activity incrementally
emit({
  type: EventType.ACTIVITY_DELTA,
  messageId: "activity-search",
  activityType: "SEARCH",
  patch: [
    { op: "replace", path: "/status", value: "complete" },
    { op: "add", path: "/results/-", value: { title: "Getting Started", url: "..." } },
  ],
});
```

## Step 7: Report Steps (Optional)

Show granular progress within a run:

```typescript
emit({ type: EventType.STEP_STARTED, stepName: "planning" });
// ... do planning work, emit text/tool events ...
emit({ type: EventType.STEP_FINISHED, stepName: "planning" });

emit({ type: EventType.STEP_STARTED, stepName: "execution" });
// ... do execution work ...
emit({ type: EventType.STEP_FINISHED, stepName: "execution" });
```

## Complete Working Example

A minimal but complete agent that echoes messages and handles tools:

```typescript
import express from "express";
import { EventEncoder } from "@ag-ui/encoder";
import { RunAgentInput, EventType } from "@ag-ui/core";

const app = express();
app.use(express.json());

app.post("/agent", async (req, res) => {
  const input: RunAgentInput = req.body;
  const encoder = new EventEncoder({ accept: req.headers.accept });

  res.setHeader("Content-Type", encoder.getContentType());
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const emit = (event: any) => res.write(encoder.encode(event));

  // RUN_STARTED
  emit({
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
  });

  // Check if last message has a tool result we need to process
  const lastMessage = input.messages[input.messages.length - 1];
  const isToolResult = lastMessage?.role === "tool";

  if (isToolResult) {
    // Continue after tool execution
    const msgId = `msg-${Date.now()}`;
    emit({ type: EventType.TEXT_MESSAGE_START, messageId: msgId, role: "assistant" });
    emit({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: msgId,
      delta: `Tool returned: ${lastMessage.content}`,
    });
    emit({ type: EventType.TEXT_MESSAGE_END, messageId: msgId });
  } else {
    // Check if any tools are available
    const hasTools = input.tools.length > 0;
    const userMessage = input.messages.filter((m) => m.role === "user").pop();

    if (hasTools && userMessage) {
      // Demonstrate tool calling
      const tool = input.tools[0];
      emit({
        type: EventType.TOOL_CALL_START,
        toolCallId: `tc-${Date.now()}`,
        toolCallName: tool.name,
      });
      emit({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: `tc-${Date.now()}`,
        delta: "{}",
      });
      emit({
        type: EventType.TOOL_CALL_END,
        toolCallId: `tc-${Date.now()}`,
      });
    } else {
      // Simple echo response
      const msgId = `msg-${Date.now()}`;
      emit({ type: EventType.TEXT_MESSAGE_START, messageId: msgId, role: "assistant" });

      const content = userMessage?.content || "No message received";
      const text = typeof content === "string" ? content : "[multimodal content]";
      const response = `You said: "${text}"`;

      // Stream character by character for demonstration
      for (const char of response) {
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: msgId, delta: char });
      }

      emit({ type: EventType.TEXT_MESSAGE_END, messageId: msgId });
    }
  }

  // RUN_FINISHED
  emit({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
  });

  res.end();
});

app.listen(3001, () => console.log("AG-UI agent running on :3001"));
```

## Connecting from the Client

```typescript
import { HttpAgent } from "@ag-ui/client";

const agent = new HttpAgent({
  url: "http://localhost:3001/agent",
  headers: { Authorization: "Bearer token" },
  initialMessages: [
    { id: "1", role: "user", content: "Hello!" },
  ],
});

// Run the agent
const { result, newMessages } = await agent.runAgent({
  tools: [
    {
      name: "getWeather",
      description: "Get current weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  ],
});

console.log("New messages:", newMessages);
console.log("Agent state:", agent.state);
```

## Error Handling

Always emit `RUN_ERROR` on failure so the client knows the run terminated:

```typescript
try {
  // ... agent logic ...
} catch (error) {
  emit({
    type: EventType.RUN_ERROR,
    message: error instanceof Error ? error.message : String(error),
    code: "internal_error",
  });
}
```

The client SDK also handles HTTP-level errors and abort signals, converting them to `RUN_ERROR` events automatically.

## Event Ordering Rules

1. `RUN_STARTED` must be the first event
2. `RUN_FINISHED` or `RUN_ERROR` must be the last event
3. `TEXT_MESSAGE_START` must precede `TEXT_MESSAGE_CONTENT` for the same `messageId`
4. `TEXT_MESSAGE_END` must follow all `TEXT_MESSAGE_CONTENT` for the same `messageId`
5. `TOOL_CALL_START` must precede `TOOL_CALL_ARGS` for the same `toolCallId`
6. `TOOL_CALL_END` must follow all `TOOL_CALL_ARGS` for the same `toolCallId`
7. `STEP_STARTED` and `STEP_FINISHED` must be properly paired
8. `STATE_SNAPSHOT` replaces all state; `STATE_DELTA` patches existing state
9. Multiple runs are supported sequentially: each `RUN_FINISHED` before the next `RUN_STARTED`
