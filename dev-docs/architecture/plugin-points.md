# Pluggable Architecture Guide

CopilotKit is built around extension points. Almost everything is optional and replaceable. This guide catalogs **every** pluggable part, where it's configured, and what happens when you don't provide it.

---

## Overview: All Extension Points

```mermaid
graph TB
    subgraph "Frontend (React / Angular / Vanilla)"
        FT["Frontend Tools<br/><i>Functions agents can call</i>"]
        CTX["Agent Context<br/><i>Data agents can read</i>"]
        RTC["Tool Call Renderers<br/><i>Custom UI for tool calls</i>"]
        HIL["Human-in-the-Loop<br/><i>Approval before execution</i>"]
        RAM["Activity Renderers<br/><i>Custom activity messages</i>"]
        RCM["Custom Message Renderers<br/><i>Inject UI before/after messages</i>"]
        SUG["Suggestions Config<br/><i>AI or static suggestions</i>"]
        SUBS["Event Subscribers<br/><i>React to lifecycle events</i>"]
    end

    subgraph "Backend (Runtime)"
        BM["Before Middleware<br/><i>Auth, logging, transforms</i>"]
        AM["After Middleware<br/><i>Post-processing</i>"]
        RUNNER["Agent Runner<br/><i>How agents execute</i>"]
        TS["Transcription Service<br/><i>Audio → text</i>"]
    end

    subgraph "Agent Level"
        MW["AG-UI Middleware<br/><i>Intercept agent pipeline</i>"]
    end
```

---

## Frontend Extension Points

### 1. Frontend Tools

**What:** Functions in your app that agents can call during a conversation.

**Where configured:**

- React: `useFrontendTool()` hook or `frontendTools` provider prop
- Angular: `copilotKit.addTool()` or `tools` in config
- Vanilla: `copilotKit.addTool()`

**Default when not provided:** No tools — agent can only send text messages.

```typescript
// Type signature
type FrontendTool<T> = {
  name: string;
  description?: string;
  parameters?: z.ZodType<T>;
  handler?: (args: T, context: FrontendToolHandlerContext) => Promise<unknown>;
  followUp?: boolean; // Re-run agent after tool completes
  agentId?: string; // Scope to specific agent
};
```

```mermaid
sequenceDiagram
    participant Agent
    participant Core as CopilotKitCore
    participant Tool as Your Tool Handler

    Agent->>Core: TOOL_CALL_START { name: "myTool" }
    Agent->>Core: TOOL_CALL_ARGS { ... }
    Core->>Tool: handler(args)
    Tool-->>Core: result
    Core->>Agent: TOOL_CALL_RESULT
    opt followUp = true
        Core->>Agent: Re-run agent with result
    end
```

---

### 2. Agent Context

**What:** JSON data that gets sent to agents as context (like "the user is on the settings page").

**Where configured:**

- React: `useAgentContext()` hook
- Angular / Vanilla: `copilotKit.addContext()` / `removeContext()`

**Default when not provided:** No extra context — agent only sees messages and tool definitions.

```typescript
type AgentContextInput = {
  description: string; // Human-readable label
  value: JsonSerializable; // Any JSON value
};
```

---

### 3. Tool Call Renderers

**What:** Custom React components that render while a tool is being called — showing progress, args, and results.

**Where configured:**

- React: `useRenderToolCall()` hook or `renderToolCalls` provider prop
- Angular: `renderToolCalls` in config

**Default when not provided:** Generic built-in rendering.

```typescript
type ReactToolCallRenderer<T> = {
  name: string; // Tool name to render
  args: z.ZodSchema<T>; // Schema for type-safe args
  agentId?: string; // Scope to specific agent
  render: React.ComponentType<
    | { status: "in-progress"; args: Partial<T>; result: undefined }
    | { status: "executing"; args: T; result: undefined }
    | { status: "complete"; args: T; result: string }
  >;
};
```

```mermaid
graph LR
    IP["in-progress<br/><i>Args streaming in<br/>Partial&lt;T&gt; available</i>"]
    EX["executing<br/><i>Handler running<br/>Full args available</i>"]
    CO["complete<br/><i>Result available</i>"]
    IP --> EX --> CO
```

---

### 4. Human-in-the-Loop

**What:** Tools that pause and wait for user input before continuing. The user sees a custom UI with approve/deny buttons.

**Where configured:**

- React: `useHumanInTheLoop()` hook or `humanInTheLoop` provider prop
- Angular: `humanInTheLoop` in config

**Default when not provided:** No approval required — tools execute immediately.

```typescript
type ReactHumanInTheLoop<T> = Omit<FrontendTool<T>, "handler"> & {
  render: React.ComponentType<{
    args: T;
    status: "in-progress" | "executing" | "complete";
    respond: (result: unknown) => Promise<void>; // Call this to approve/deny
  }>;
};
```

```mermaid
sequenceDiagram
    participant Agent
    participant Core as CopilotKitCore
    participant UI as Your Approval UI
    participant User

    Agent->>Core: TOOL_CALL { name: "deleteUser" }
    Core->>UI: Render with status: "executing"
    UI->>User: "Delete user X?"
    User->>UI: Clicks "Approve"
    UI->>Core: respond("approved")
    Core->>Agent: TOOL_CALL_RESULT
    Agent->>Agent: Continues
```

---

### 5. Activity Message Renderers

**What:** Custom UI for structured activity messages (non-chat messages like progress indicators or MCP app outputs).

**Where configured:**

- React: `useRenderActivityMessage()` hook or `renderActivityMessages` provider prop

**Default when not provided:** Built-in MCP Apps renderer is included. Other activity types show generic display.

```typescript
type ReactActivityMessageRenderer<T> = {
  activityType: string; // Use "*" for wildcard
  agentId?: string;
  content: z.ZodSchema<T>;
  render: React.ComponentType<{
    activityType: string;
    content: T;
    message: ActivityMessage;
    agent: AbstractAgent | undefined;
  }>;
};
```

---

### 6. Custom Message Renderers

**What:** Inject custom UI before or after specific messages (e.g., add a "copy" button, show state snapshots).

**Where configured:**

- React: `useRenderCustomMessages()` hook or `renderCustomMessages` provider prop

**Default when not provided:** No custom rendering — standard message display.

```typescript
type ReactCustomMessageRenderer = {
  agentId?: string;
  render: React.ComponentType<{
    message: Message;
    position: "before" | "after";
    runId: string;
    messageIndex: number;
    agentId: string;
    stateSnapshot: any;
  }> | null;
};
```

---

### 7. Suggestions Configuration

**What:** Configure AI-generated or static prompt suggestions shown to users.

**Where configured:**

- React: `useConfigureSuggestions()` hook
- Core: `suggestionsConfig` in config

**Default when not provided:** No suggestions.

```typescript
// AI-generated suggestions
type DynamicSuggestionsConfig = {
  instructions: string; // What to suggest
  minSuggestions?: number; // Default: 1
  maxSuggestions?: number; // Default: 3
  available?: SuggestionAvailability; // When to show
  providerAgentId?: string; // Which agent generates them
  consumerAgentId?: string; // Which agent receives them ("*" = all)
};

// Static suggestions
type StaticSuggestionsConfig = {
  suggestions: Array<{ title: string; message: string }>;
  available?: SuggestionAvailability;
  consumerAgentId?: string;
};

type SuggestionAvailability =
  | "before-first-message" // Default for static
  | "after-first-message" // Default for dynamic
  | "always"
  | "disabled";
```

```mermaid
graph TB
    subgraph "Suggestion Types"
        DYN["Dynamic<br/><i>AI generates suggestions<br/>from instructions</i>"]
        STA["Static<br/><i>You provide fixed<br/>suggestion list</i>"]
    end

    subgraph "Availability"
        BFM["before-first-message"]
        AFM["after-first-message"]
        ALW["always"]
        DIS["disabled"]
    end

    DYN -.->|default| AFM
    STA -.->|default| BFM
```

---

### 8. Event Subscribers

**What:** Listen to lifecycle events — connection status, tool execution, agent changes, errors.

**Where configured:**

- Any: `copilotKit.subscribe(subscriber)`
- Returns: `{ unsubscribe() }` for cleanup

**Default when not provided:** No listeners — events still fire internally.

```typescript
type CopilotKitCoreSubscriber = {
  onRuntimeConnectionStatusChanged?: (event) => void;
  onToolExecutionStart?: (event) => void;
  onToolExecutionEnd?: (event) => void;
  onAgentsChanged?: (event) => void;
  onContextChanged?: (event) => void;
  onSuggestionsChanged?: (event) => void;
  onSuggestionsStartedLoading?: (event) => void;
  onSuggestionsFinishedLoading?: (event) => void;
  onPropertiesChanged?: (event) => void;
  onHeadersChanged?: (event) => void;
  onError?: (event) => void;
};
```

---

## Backend Extension Points

### 9. Before Request Middleware

**What:** Intercept HTTP requests before they reach the handler. Use for auth, logging, request transformation.

**Where configured:** `CopilotRuntime` constructor — `beforeRequestMiddleware`

**Default when not provided:** Requests pass through unchanged.

```typescript
type BeforeRequestMiddleware = (params: {
  runtime: CopilotRuntime;
  request: Request;
  path: string;
}) => MaybePromise<Request | void>;
// Return modified Request, or void to pass through
// Return a Response to short-circuit (e.g., 401)
```

```mermaid
graph LR
    REQ["Incoming Request"]
    BM["beforeRequestMiddleware"]
    HANDLER["Route Handler"]
    REJECT["401 / Error Response"]

    REQ --> BM
    BM -->|pass through| HANDLER
    BM -->|reject| REJECT
```

---

### 10. After Request Middleware

**What:** Run code after the response is prepared. Use for logging, metrics, cleanup.

**Where configured:** `CopilotRuntime` constructor — `afterRequestMiddleware`

**Default when not provided:** No post-processing.

```typescript
type AfterRequestMiddleware = (params: {
  runtime: CopilotRuntime;
  response: Response;
  path: string;
}) => MaybePromise<void>;
```

---

### 11. Agent Runner

**What:** Controls how agents are executed and how thread state is managed.

**Where configured:** `CopilotRuntime` constructor — `runner`

**Default when not provided:** `InMemoryAgentRunner` — in-process, ephemeral (threads lost on restart).

```typescript
abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: AgentRunnerConnectRequest): Observable<BaseEvent>;
  abstract isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean>;
  abstract stop(request: AgentRunnerStopRequest): Promise<boolean | undefined>;
}
```

| Implementation        | Storage     | Persistence | Use case                         |
| --------------------- | ----------- | ----------- | -------------------------------- |
| `InMemoryAgentRunner` | RAM         | No          | Development, stateless apps      |
| `SQLiteAgentRunner`   | Disk        | Yes         | Production, long-running threads |
| Custom                | Your choice | Your choice | Redis, PostgreSQL, etc.          |

```mermaid
graph TB
    RT["CopilotRuntime"]
    RUNNER["runner (AgentRunner)"]

    RT --> RUNNER

    subgraph Implementations
        IM["InMemoryAgentRunner<br/><i>Default — in-process</i>"]
        SQ["SQLiteAgentRunner<br/><i>Persistent on disk</i>"]
        CU["YourCustomRunner<br/><i>Redis, Postgres, etc.</i>"]
    end

    RUNNER -.-> IM
    RUNNER -.-> SQ
    RUNNER -.-> CU
```

---

### 12. Transcription Service

**What:** Convert audio files to text. Enables the `/transcribe` endpoint.

**Where configured:** `CopilotRuntime` constructor — `transcriptionService`

**Default when not provided:** `/transcribe` endpoint returns 404.

```typescript
abstract class TranscriptionService {
  abstract transcribeFile(options: {
    audioFile: File;
    mimeType?: string;
    size?: number;
  }): Promise<string>;
}
```

---

## Agent-Level Extension Points

### 13. AG-UI Middleware

**What:** Intercept and transform the agent execution pipeline. Cross-cutting concerns like logging, filtering, and backward compatibility.

**Where configured:** At the agent level (outside CopilotKit core).

**Default when not provided:** Direct agent execution.

```typescript
abstract class Middleware {
  abstract run(
    input: RunAgentInput,
    next: AbstractAgent,
  ): Observable<BaseEvent>;
}

// Built-in implementations:
// - FunctionMiddleware — wrap a function as middleware
// - FilterToolCallsMiddleware — filter which tools are sent
```

```mermaid
graph LR
    INPUT["RunAgentInput"]
    MW1["Middleware 1<br/><i>e.g., logging</i>"]
    MW2["Middleware 2<br/><i>e.g., tool filtering</i>"]
    AGENT["Agent.run()"]

    INPUT --> MW1 --> MW2 --> AGENT
```

---

## Complete Map: Where Each Extension Plugs In

```mermaid
graph TB
    subgraph "Provider / Config"
        P["CopilotKitProvider<br/>or provideCopilotKit()"]
        P --> FT_P["frontendTools"]
        P --> RTC_P["renderToolCalls"]
        P --> RAM_P["renderActivityMessages"]
        P --> RCM_P["renderCustomMessages"]
        P --> HIL_P["humanInTheLoop"]
        P --> HDR["headers"]
        P --> CRD["credentials"]
        P --> PRP["properties"]
        P --> DC["showDevConsole"]
    end

    subgraph "Hooks / Service Methods"
        UFT["useFrontendTool()"]
        UAC["useAgentContext()"]
        URT["useRenderToolCall()"]
        UHL["useHumanInTheLoop()"]
        UCS["useConfigureSuggestions()"]
        URA["useRenderActivityMessage()"]
        URC["useRenderCustomMessages()"]
    end

    subgraph "CopilotRuntime"
        RT["new CopilotRuntime()"]
        RT --> AGENTS["agents (required)"]
        RT --> RUNNER["runner"]
        RT --> BM["beforeRequestMiddleware"]
        RT --> AM["afterRequestMiddleware"]
        RT --> TS["transcriptionService"]
    end

    subgraph "Core API"
        SUB["copilotKit.subscribe()"]
        AT["copilotKit.addTool()"]
        AC["copilotKit.addContext()"]
    end
```

---

## Summary Table

| Extension Point              | Location | Config Method                 | Default             | Optional |
| ---------------------------- | -------- | ----------------------------- | ------------------- | -------- |
| **Frontend Tools**           | Frontend | Hook / Provider / `addTool()` | None                | Yes      |
| **Agent Context**            | Frontend | Hook / `addContext()`         | None                | Yes      |
| **Tool Call Renderers**      | Frontend | Hook / Provider               | Generic rendering   | Yes      |
| **Human-in-the-Loop**        | Frontend | Hook / Provider               | Immediate execution | Yes      |
| **Activity Renderers**       | Frontend | Hook / Provider               | MCP Apps included   | Yes      |
| **Custom Message Renderers** | Frontend | Hook / Provider               | None                | Yes      |
| **Suggestions Config**       | Frontend | Hook / Config                 | None                | Yes      |
| **Event Subscribers**        | Frontend | `subscribe()`                 | None                | Yes      |
| **Before Middleware**        | Backend  | Runtime constructor           | Pass-through        | Yes      |
| **After Middleware**         | Backend  | Runtime constructor           | None                | Yes      |
| **Agent Runner**             | Backend  | Runtime constructor           | InMemoryAgentRunner | Yes      |
| **Transcription Service**    | Backend  | Runtime constructor           | None (404)          | Yes      |
| **AG-UI Middleware**         | Agent    | Agent-level config            | Direct execution    | Yes      |
