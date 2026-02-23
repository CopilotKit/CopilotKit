# Architecture & Packages

## Three-Layer Architecture

```
Frontend (React/Angular/Vanilla)  →  Runtime (Express/Hono server)  →  Agent (LangGraph/CrewAI/BuiltIn/Custom)
```

All layers communicate via the **AG-UI protocol** — an event-based standard streamed over SSE.

## V1 vs V2

V2 (`@copilotkitnext/`) is the real implementation. V1 (`@copilotkit/`) is the public API that wraps V2 internally. New features always go in V2. If V1 compatibility is needed, create a thin re-export or wrapper in the corresponding V1 package.

## V2 Packages

- **shared**: Common utilities, types, and constants used across all other packages.
- **core**: The `CopilotKitCore` orchestrator — the central brain on the frontend. Manages the agent registry, tool registry, context store, and event subscriptions. All framework packages (React, Angular, Vanilla) wrap this.
- **react**: React hooks (`useAgent`, `useFrontendTool`, `useAgentContext`, etc.) and `CopilotKitProvider`. Hooks are thin wrappers that register/unregister with `CopilotKitCore` on mount/unmount.
- **angular**: Angular DI tokens, services, and signal-based state. Same concepts as React but using Angular patterns (`inject()`, signals, `AgentStore`).
- **runtime**: The server-side `CopilotRuntime` class that receives HTTP requests and delegates to agents. Provides Express and Hono adapters. Contains the `AgentRunner` abstraction for managing thread/conversation state.
- **agent**: The `BuiltInAgent` — a default agent implementation powered by the Vercel AI SDK. Used when developers don't bring their own agent framework.
- **voice**: Voice input and transcription support.
- **web-inspector**: A debug console (Lit web component) for inspecting agent communication in development.
- **sqlite-runner**: An `AgentRunner` implementation that persists thread state to SQLite instead of memory.

## V1 Packages

- **react-core**: The public `<CopilotKit>` provider and hooks. Internally delegates to V2 core.
- **react-ui**: Chat UI components — `CopilotChat`, `CopilotPopup`, `CopilotSidebar`, `CopilotPanel`.
- **react-textarea**: The `CopilotTextarea` component for AI-assisted text editing.
- **shared**: Shared types and telemetry utilities.
- **runtime**: Server-side runtime with GraphQL server and LLM adapters.
- **runtime-client-gql**: urql-based GraphQL client for frontend-to-runtime communication.
- **sdk-js**: Helpers for LangGraph/LangChain agent integration.

## Request Lifecycle

1. **Init**: Frontend creates `CopilotKitCore` → fetches agent info from runtime → creates a `ProxiedAgent` instance per remote agent.
2. **User sends message**: Message is added to the agent, then `runAgent()` is called.
3. **HTTP request**: A POST is sent to the runtime with a `RunAgentInput` payload containing messages, registered tools, context, threadId, and state.
4. **Runtime processing**: Request middleware runs → agent is resolved and cloned → `AgentRunner` executes the agent.
5. **SSE stream back**: Agent emits AG-UI events streamed to the frontend: run lifecycle events, text message chunks (streaming), and optional tool call events.
6. **Frontend tool execution**: When the agent calls a frontend tool, Core looks up the handler in its registry, executes it locally in the browser, and sends the result back to the agent which continues processing.
7. **UI update**: Core updates its message store and notifies subscribers → React/Angular re-renders.

## Core Concepts

### AG-UI Protocol

All agent↔UI communication is event-based. Events follow a structured lifecycle: `RUN_STARTED` → `STEP_STARTED` → message/tool events → `STEP_FINISHED` → `RUN_FINISHED`. Events are streamed over SSE and validated with Zod schemas. The `EventType` enum in `@ag-ui/core` defines all event types.

### ProxiedAgent

The frontend representation of a remote agent. Implements the `AbstractAgent` interface but translates calls into HTTP requests to the runtime, streaming SSE events back. Created automatically when the runtime reports available agents.

### AgentRunner

An abstract class on the runtime side responsible for managing thread state (conversation history, agent state). The default `InMemoryAgentRunner` is ephemeral; `SQLiteAgentRunner` provides persistence. Custom runners can be built for any storage backend.

### Tool Registration

Tools can be **frontend tools** (handler runs in the browser, registered via `useFrontendTool`) or **backend tools** (handler runs on the server, defined in the agent config). Tools can be scoped to a specific agent via `agentId`, or available to all agents by omitting it.

### Context

Application data sent alongside messages to give agents awareness of the current UI state. Registered via `useAgentContext(description, data)` where data is any JSON-serializable value. Automatically included in every agent run.

### Multi-Agent

Multiple agents can be registered in a single `CopilotRuntime`. Each agent gets its own endpoint, message thread, state, and optionally scoped tools. The frontend selects which agent to interact with via `useAgent({ agentId })`.

### Middleware

`CopilotRuntime` supports `beforeRequestMiddleware` and `afterRequestMiddleware` for cross-cutting concerns like authentication, logging, and request/response transformation.
