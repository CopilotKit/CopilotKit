# @ag-ui/client SDK Reference

API reference for the AG-UI client SDK (`@ag-ui/client`).

## Package Exports

The client re-exports everything from `@ag-ui/core`, so you typically only need one import:

```typescript
import {
  // Agent classes
  AbstractAgent,
  HttpAgent,
  // Types from @ag-ui/core
  EventType,
  BaseEvent,
  RunAgentInput,
  Message,
  // Middleware
  Middleware,
  FilterToolCallsMiddleware,
  // Event application
  defaultApplyEvents,
  // Verification
  verifyEvents,
  // Transforms
  transformChunks,
  transformHttpEventStream,
  // Compact utilities
  compactEvents,
} from "@ag-ui/client";
```

---

## AbstractAgent

Base class for all AG-UI agents. Manages conversation state, message history, event processing, and subscriber notification.

### Constructor

```typescript
interface AgentConfig {
  agentId?: string;         // Unique agent identifier
  description?: string;     // Human-readable description
  threadId?: string;        // Conversation thread ID (auto-generated if omitted)
  initialMessages?: Message[];  // Starting message history
  initialState?: State;     // Starting state object
  debug?: boolean;          // Enable debug logging
}

const agent = new MyAgent({
  agentId: "my-agent",
  threadId: "thread-1",
  initialMessages: [{ id: "1", role: "user", content: "Hello" }],
  initialState: { preference: "dark" },
  debug: true,
});
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `agentId` | `string?` | Agent identifier |
| `description` | `string` | Human-readable description |
| `threadId` | `string` | Conversation thread ID |
| `messages` | `Message[]` | Current message history |
| `state` | `State` | Current agent state |
| `debug` | `boolean` | Debug logging enabled |
| `isRunning` | `boolean` | Whether a run is currently active |
| `subscribers` | `AgentSubscriber[]` | Registered event subscribers |

### Abstract Method: `run()`

Must be implemented by subclasses. Returns an RxJS Observable of AG-UI events.

```typescript
abstract run(input: RunAgentInput): Observable<BaseEvent>;
```

### `runAgent(parameters?, subscriber?)`

Executes a full agent run with event application, state management, and subscriber notification.

```typescript
interface RunAgentParameters {
  runId?: string;
  tools?: Tool[];
  context?: Context[];
  forwardedProps?: any;
}

interface RunAgentResult {
  result: any;              // From RUN_FINISHED.result
  newMessages: Message[];   // Messages added during this run
}

const { result, newMessages } = await agent.runAgent({
  runId: "run-1",
  tools: [{ name: "search", description: "Search docs", parameters: {} }],
  context: [{ description: "Current page", value: "/dashboard" }],
  forwardedProps: { model: "gpt-4" },
});
```

The pipeline internally:
1. Prepares `RunAgentInput` from current state + parameters
2. Calls `run(input)` to get the event Observable
3. Passes through middleware chain
4. Transforms chunk events into full events (`transformChunks`)
5. Verifies event ordering (`verifyEvents`)
6. Applies events to update messages/state (`defaultApplyEvents`)
7. Notifies subscribers at each step

### `connectAgent(parameters?, subscriber?)`

Like `runAgent()` but calls the protected `connect()` method instead of `run()`. Used for persistent connections (WebSocket).

### `detachActiveRun()`

Immediately stops processing the current run's event stream. The run's Observable is unsubscribed and the finalize handler runs.

```typescript
await agent.detachActiveRun();
```

### `abortRun()`

Aborts the current run. For `HttpAgent`, this calls `AbortController.abort()`.

### `subscribe(subscriber)`

Registers an event subscriber. Returns an object with `unsubscribe()`.

```typescript
const subscription = agent.subscribe({
  onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
    console.log("Streaming:", textMessageBuffer + event.delta);
  },
  onRunFinishedEvent: ({ result }) => {
    console.log("Done:", result);
  },
});

// Later:
subscription.unsubscribe();
```

### `use(...middlewares)`

Adds middleware to the agent's processing pipeline. Middlewares run in order, wrapping the `run()` call.

```typescript
agent.use(new FilterToolCallsMiddleware(["allowedTool"]));
agent.use((input, next) => {
  // Modify input before passing to next
  return next.run(input);
});
```

### `addMessage(message)` / `addMessages(messages)`

Adds messages and notifies subscribers (`onNewMessage`, `onNewToolCall`, `onMessagesChanged`).

### `setMessages(messages)` / `setState(state)`

Replaces messages/state and notifies subscribers.

### `clone()`

Creates a deep copy of the agent with the same configuration, messages, state, and middleware.

### `getCapabilities()`

Optional method that subclasses can implement to advertise supported capabilities:

```typescript
async getCapabilities(): Promise<AgentCapabilities> {
  return {
    identity: { name: "My Agent", type: "custom", version: "1.0.0" },
    transport: { streaming: true },
    tools: { supported: true, clientProvided: true },
    state: { snapshots: true, deltas: true },
    humanInTheLoop: { supported: true, approvals: true },
  };
}
```

---

## HttpAgent

Concrete agent that connects to a remote HTTP endpoint. Extends `AbstractAgent`.

### Constructor

```typescript
interface HttpAgentConfig extends AgentConfig {
  url: string;                        // Agent endpoint URL
  headers?: Record<string, string>;   // Custom HTTP headers
}

const agent = new HttpAgent({
  url: "https://api.example.com/agent",
  headers: {
    Authorization: "Bearer sk-...",
    "X-Custom-Header": "value",
  },
  threadId: "thread-1",
});
```

### How It Works

1. `run()` sends a POST request to `url` with `RunAgentInput` as JSON body
2. Request headers include `Content-Type: application/json` and `Accept: text/event-stream`
3. Response stream is parsed as SSE (or protobuf if content-type matches)
4. Each SSE `data:` line is parsed through `EventSchemas` (Zod discriminated union)

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | Agent endpoint URL |
| `headers` | `Record<string, string>` | Custom request headers |
| `abortController` | `AbortController` | Controls request cancellation |

### `requestInit(input)`

Protected method that builds the `RequestInit` for `fetch()`. Override for custom request behavior:

```typescript
class CustomHttpAgent extends HttpAgent {
  protected requestInit(input: RunAgentInput): RequestInit {
    return {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Request-Id": input.runId,
      },
      body: JSON.stringify(input),
      signal: this.abortController.signal,
    };
  }
}
```

### `abortRun()`

Aborts the HTTP request via `AbortController.abort()`. The client auto-generates a `RUN_ERROR` event with `code: "abort"`.

---

## AgentSubscriber

Interface for receiving typed event callbacks during agent runs. All callbacks are optional and can be sync or async.

### Lifecycle Callbacks

```typescript
interface AgentSubscriber {
  // Before events start flowing
  onRunInitialized?(params: AgentSubscriberParams):
    MaybePromise<Omit<AgentStateMutation, "stopPropagation"> | void>;

  // On unrecoverable error
  onRunFailed?(params: { error: Error } & AgentSubscriberParams):
    MaybePromise<Omit<AgentStateMutation, "stopPropagation"> | void>;

  // After run completes (success or failure)
  onRunFinalized?(params: AgentSubscriberParams):
    MaybePromise<Omit<AgentStateMutation, "stopPropagation"> | void>;
}
```

### Event Callbacks

Each event type has a corresponding callback. Key ones:

```typescript
interface AgentSubscriber {
  // Catch-all for every event
  onEvent?(params: { event: BaseEvent } & AgentSubscriberParams):
    MaybePromise<AgentStateMutation | void>;

  // Lifecycle events
  onRunStartedEvent?(params: { event: RunStartedEvent } & ...): ...;
  onRunFinishedEvent?(params: { event: RunFinishedEvent; result?: any } & ...): ...;
  onRunErrorEvent?(params: { event: RunErrorEvent } & ...): ...;
  onStepStartedEvent?(params: { event: StepStartedEvent } & ...): ...;
  onStepFinishedEvent?(params: { event: StepFinishedEvent } & ...): ...;

  // Text message events (includes accumulated buffer)
  onTextMessageStartEvent?(params: { event: TextMessageStartEvent } & ...): ...;
  onTextMessageContentEvent?(params: {
    event: TextMessageContentEvent;
    textMessageBuffer: string;  // Content accumulated so far
  } & ...): ...;
  onTextMessageEndEvent?(params: {
    event: TextMessageEndEvent;
    textMessageBuffer: string;  // Complete message content
  } & ...): ...;

  // Tool call events (includes accumulated args)
  onToolCallStartEvent?(params: { event: ToolCallStartEvent } & ...): ...;
  onToolCallArgsEvent?(params: {
    event: ToolCallArgsEvent;
    toolCallBuffer: string;           // Raw args accumulated
    toolCallName: string;             // Tool name
    partialToolCallArgs: Record<string, any>;  // Best-effort parsed args
  } & ...): ...;
  onToolCallEndEvent?(params: {
    event: ToolCallEndEvent;
    toolCallName: string;
    toolCallArgs: Record<string, any>;  // Fully parsed args
  } & ...): ...;
  onToolCallResultEvent?(params: { event: ToolCallResultEvent } & ...): ...;

  // State events
  onStateSnapshotEvent?(params: { event: StateSnapshotEvent } & ...): ...;
  onStateDeltaEvent?(params: { event: StateDeltaEvent } & ...): ...;
  onMessagesSnapshotEvent?(params: { event: MessagesSnapshotEvent } & ...): ...;

  // Activity events
  onActivitySnapshotEvent?(params: {
    event: ActivitySnapshotEvent;
    activityMessage?: ActivityMessage;
    existingMessage?: Message;
  } & ...): ...;
  onActivityDeltaEvent?(params: {
    event: ActivityDeltaEvent;
    activityMessage?: ActivityMessage;
  } & ...): ...;

  // Reasoning events
  onReasoningStartEvent?(params: { event: ReasoningStartEvent } & ...): ...;
  onReasoningMessageContentEvent?(params: {
    event: ReasoningMessageContentEvent;
    reasoningMessageBuffer: string;
  } & ...): ...;
  onReasoningEndEvent?(params: { event: ReasoningEndEvent } & ...): ...;
  onReasoningEncryptedValueEvent?(params: { event: ReasoningEncryptedValueEvent } & ...): ...;

  // Custom/raw events
  onRawEvent?(params: { event: RawEvent } & ...): ...;
  onCustomEvent?(params: { event: CustomEvent } & ...): ...;

  // State change notifications (fires after state/messages update)
  onMessagesChanged?(params: Omit<AgentSubscriberParams, "input"> & { input?: RunAgentInput }): ...;
  onStateChanged?(params: Omit<AgentSubscriberParams, "input"> & { input?: RunAgentInput }): ...;
  onNewMessage?(params: { message: Message } & ...): ...;
  onNewToolCall?(params: { toolCall: ToolCall } & ...): ...;
}
```

### AgentStateMutation

Subscriber callbacks can return mutations to modify agent state:

```typescript
interface AgentStateMutation {
  messages?: Message[];       // Replace messages
  state?: State;              // Replace state
  stopPropagation?: boolean;  // Stop processing this event
}
```

If `stopPropagation` is `true`, the default event application logic is skipped and no further subscribers see the event.

---

## Middleware

Middleware intercepts the `run()` call, enabling event transformation, filtering, and augmentation.

### Abstract Middleware Class

```typescript
abstract class Middleware {
  // Override this to intercept runs
  abstract run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent>;

  // Helper: runs next agent with chunk transformation
  protected runNext(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent>;

  // Helper: runs next agent and tracks state after each event
  protected runNextWithState(input: RunAgentInput, next: AbstractAgent): Observable<EventWithState>;
}

interface EventWithState {
  event: BaseEvent;
  messages: Message[];  // State AFTER event applied
  state: any;           // State AFTER event applied
}
```

### Function Middleware

Use a plain function instead of a class:

```typescript
agent.use((input: RunAgentInput, next: AbstractAgent) => {
  // Modify input
  const modifiedInput = { ...input, forwardedProps: { ...input.forwardedProps, custom: true } };
  // Pass to next agent/middleware
  return next.run(modifiedInput);
});
```

### FilterToolCallsMiddleware

Built-in middleware that filters tool call events to only allowed tool names:

```typescript
import { FilterToolCallsMiddleware } from "@ag-ui/client";

agent.use(new FilterToolCallsMiddleware(["allowedTool1", "allowedTool2"]));
```

### Custom Middleware Example

```typescript
import { Middleware } from "@ag-ui/client";
import { map } from "rxjs/operators";

class LoggingMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    console.log("Run started with", input.messages.length, "messages");
    return this.runNext(input, next).pipe(
      map((event) => {
        console.log("Event:", event.type);
        return event;
      }),
    );
  }
}
```

### Middleware with State Tracking

```typescript
class ConditionalMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    return this.runNextWithState(input, next).pipe(
      map(({ event, messages, state }) => {
        // Access messages and state AFTER the event was applied
        console.log("Messages after event:", messages.length);
        console.log("State after event:", state);
        return event;
      }),
    );
  }
}
```

---

## Event Application (defaultApplyEvents)

The `defaultApplyEvents` function processes events and updates agent messages/state:

```typescript
function defaultApplyEvents(
  input: RunAgentInput,
  events$: Observable<BaseEvent>,
  agent: AbstractAgent,
  subscribers: AgentSubscriber[],
): Observable<AgentStateMutation>;
```

### What It Does Per Event Type

| Event | Action |
|-------|--------|
| `TEXT_MESSAGE_START` | Creates new message in messages array |
| `TEXT_MESSAGE_CONTENT` | Appends delta to message content |
| `TEXT_MESSAGE_END` | Fires `onNewMessage` subscriber |
| `TOOL_CALL_START` | Creates assistant message with toolCalls array (or adds to existing if parentMessageId matches) |
| `TOOL_CALL_ARGS` | Appends delta to tool call's `function.arguments` |
| `TOOL_CALL_END` | Fires `onNewToolCall` subscriber |
| `TOOL_CALL_RESULT` | Adds tool message to messages |
| `STATE_SNAPSHOT` | Replaces entire state |
| `STATE_DELTA` | Applies JSON Patch operations to state |
| `MESSAGES_SNAPSHOT` | Edit-based merge preserving activity messages |
| `ACTIVITY_SNAPSHOT` | Creates or replaces activity message |
| `ACTIVITY_DELTA` | Applies JSON Patch to activity content |
| `RUN_STARTED` | Adds input.messages if present (new messages only) |
| `REASONING_MESSAGE_START` | Creates reasoning message |
| `REASONING_MESSAGE_CONTENT` | Appends delta to reasoning message |
| `REASONING_ENCRYPTED_VALUE` | Sets encryptedValue on target message or tool call |

---

## Observable Patterns

AG-UI uses RxJS Observables throughout. Key patterns:

### Creating Event Streams

```typescript
import { Observable } from "rxjs";
import { BaseEvent, EventType } from "@ag-ui/core";

// From scratch
const events$ = new Observable<BaseEvent>((observer) => {
  observer.next({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" });
  observer.next({ type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" });
  observer.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Hello" });
  observer.next({ type: EventType.TEXT_MESSAGE_END, messageId: "m1" });
  observer.next({ type: EventType.RUN_FINISHED, threadId: "t1", runId: "r1" });
  observer.complete();
});
```

### Async Event Streams

```typescript
const events$ = new Observable<BaseEvent>((observer) => {
  (async () => {
    try {
      observer.next({ type: EventType.RUN_STARTED, threadId: "t1", runId: "r1" });

      for await (const chunk of llmStream) {
        observer.next({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "m1",
          delta: chunk,
        });
      }

      observer.next({ type: EventType.RUN_FINISHED, threadId: "t1", runId: "r1" });
      observer.complete();
    } catch (error) {
      observer.next({
        type: EventType.RUN_ERROR,
        message: error.message,
      });
      observer.complete();
    }
  })();
});
```

---

## HTTP Transport Internals

### Request Flow

1. `HttpAgent.run()` calls `runHttpRequest(url, requestInit)` which returns `Observable<HttpEvent>`
2. `HttpEvent` is either `HttpHeadersEvent` (status + headers) or `HttpDataEvent` (Uint8Array chunks)
3. `transformHttpEventStream()` examines the content-type header:
   - `application/x-ag-ui` -> protobuf parser
   - Everything else -> SSE parser (`parseSSEStream`)
4. SSE parser splits on `\n\n`, extracts `data:` lines, parses JSON
5. JSON is validated through `EventSchemas.parse()` (Zod discriminated union)

### Error Handling

- Non-2xx HTTP responses throw with status and body payload
- `AbortError` (from `AbortController`) is converted to `RUN_ERROR` with `code: "abort"`
- SSE parse errors propagate as Observable errors

---

## Built-in Backward Compatibility

The client automatically applies backward-compatibility middleware:

- **BackwardCompatibility_0_0_39**: Applied for client versions <= 0.0.39
- **BackwardCompatibility_0_0_45**: Converts deprecated `THINKING_*` events to `REASONING_*` events
