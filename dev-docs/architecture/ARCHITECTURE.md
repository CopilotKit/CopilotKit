# CopilotKit Architecture Guide

CopilotKit lets you add AI agents to your app. You write hooks (React/Angular) or use the core API (vanilla JS), CopilotKit handles the rest — connecting your UI to any AI agent framework.

---

## The 30-Second Version

```mermaid
graph TB
    subgraph Your App
        A[React / Angular / Vanilla JS]
    end

    subgraph Your Server
        B[CopilotKit Runtime]
    end

    subgraph Any Agent Framework
        C[LangGraph / CrewAI / Mastra / Custom]
    end

    A -->|HTTP POST| B
    B -->|AG-UI Events| C
    C -->|AG-UI Events| B
    B -->|SSE Stream| A
```

That's it. Your app talks to a runtime on your server. The runtime talks to an AI agent. They communicate using **AG-UI** — an event-based protocol (think: "text is streaming", "agent wants to call a tool", "state changed").

---

## The Three Layers

### Layer 1: Frontend (your app)

You use hooks/services to wire up your app — registering tools agents can call, providing context, and getting agent instances.

### Layer 2: Runtime (your server)

A few lines create the backend that receives requests from the frontend, runs agents, and streams events back.

### Layer 3: Agent (any framework)

The agent is anything that speaks AG-UI protocol. CopilotKit has integrations for 13+ frameworks, or you build your own.

---

## How a Message Flows Through the System

```mermaid
sequenceDiagram
    participant User
    participant App as Your App
    participant Core as CopilotKitCore
    participant Runtime as CopilotRuntime
    participant Agent as AI Agent

    Note over App: Setup (on mount)
    App->>Core: Provider creates Core
    Core->>Runtime: GET /info (fetch agent list)
    Runtime-->>Core: [{ name, description }]
    App->>Core: Hooks register tools + context

    Note over User: User sends message
    User->>App: Types message, hits send
    App->>Core: Gets agent instance
    Core->>Runtime: POST /agent/{id}/run
    Runtime->>Agent: AgentRunner.run()

    Note over Agent: Events stream back
    Agent-->>Runtime: TEXT_MESSAGE_START
    Agent-->>Runtime: TEXT_MESSAGE_CONTENT (streaming)
    Agent-->>Runtime: TEXT_MESSAGE_END
    Runtime-->>Core: SSE event stream
    Core-->>App: Subscribers fire, UI re-renders
    App-->>User: Chat shows streaming response

    Note over Agent: Tool call (optional)
    Agent-->>Runtime: TOOL_CALL_START + ARGS
    Runtime-->>Core: SSE events
    Core->>Core: Execute frontend tool
    Core-->>Runtime: TOOL_CALL_RESULT
    Runtime->>Agent: Agent continues
    Agent-->>Runtime: RUN_FINISHED
```

---

## Guides

| Guide                                      | What you'll learn                                       |
| ------------------------------------------ | ------------------------------------------------------- |
| [React Setup](setup-react.md)              | Provider, hooks, chat UI — full React integration       |
| [Angular Setup](setup-angular.md)          | DI tokens, services, signals — full Angular integration |
| [Vanilla JS Setup](setup-vanilla.md)       | CopilotKitCore API without any framework                |
| [Runtime / Backend](setup-runtime.md)      | Express/Hono endpoints, agents, runners, middleware     |
| [Multi-Agent Patterns](multi-agent.md)     | Multiple agents, routing, agent-specific tools          |
| [Pluggable Architecture](plugin-points.md) | Every optional extension point with diagrams            |

---

## Package Dependency Map

```mermaid
graph BT
    subgraph AG-UI Protocol
        core["@ag-ui/core<br/><i>Types + Event schemas</i>"]
        client["@ag-ui/client<br/><i>AbstractAgent, HttpAgent, Middleware</i>"]
        encoder["@ag-ui/encoder<br/><i>SSE / Binary / Protobuf encoding</i>"]
        client --> core
        encoder --> core
    end

    subgraph CopilotKit Packages
        shared["@copilotkit/shared<br/><i>Utils, types, constants</i>"]
        core["@copilotkit/core<br/><i>CopilotKitCore orchestrator</i>"]
        reactcore["@copilotkit/react-core<br/><i>Provider + hooks</i>"]
        reactui["@copilotkit/react-ui<br/><i>Chat, Popup, Sidebar</i>"]
        reacttextarea["@copilotkit/react-textarea<br/><i>AI text editing</i>"]
        gql["@copilotkit/runtime-client-gql<br/><i>urql GraphQL client</i>"]
        runtime["@copilotkit/runtime<br/><i>Express/Hono server + AgentRunner + Built-in agent</i>"]

        core --> shared
        reactcore --> core
        reactcore --> gql
        reactui --> reactcore
        reacttextarea --> reactcore
        runtime --> shared
        reactcore -.-> client
        gql --> shared
    end
```

---

## AG-UI Protocol at a Glance

AG-UI is the communication contract between agents and UIs. Everything is an **event** streamed over SSE.

```mermaid
graph LR
    subgraph Lifecycle
        RS[RUN_STARTED] --> SS[STEP_STARTED]
        SF[STEP_FINISHED] --> RF[RUN_FINISHED]
    end

    subgraph Text
        TMS[TEXT_MESSAGE_START] --> TMC[TEXT_MESSAGE_CONTENT]
        TMC --> TME[TEXT_MESSAGE_END]
    end

    subgraph Tools
        TCS[TOOL_CALL_START] --> TCA[TOOL_CALL_ARGS]
        TCA --> TCE[TOOL_CALL_END]
        TCE --> TCR[TOOL_CALL_RESULT]
    end

    subgraph State
        SNP[STATE_SNAPSHOT]
        SD[STATE_DELTA]
    end

    SS --> TMS
    TME --> TCS
    TCR --> SF
```

| Package          | Role                                     | Key exports                                                       |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `@ag-ui/core`    | The contract — event types + data shapes | `EventType` enum, Zod schemas, `RunAgentInput`, `Message`, `Tool` |
| `@ag-ui/client`  | Client-side agent abstraction            | `AbstractAgent`, `HttpAgent`, `Middleware`, re-exports core       |
| `@ag-ui/encoder` | Serializes events for transport          | `EventEncoder` (SSE, binary, protobuf)                            |
| `@ag-ui/proto`   | Protobuf binary transport                | `encode()`, `decode()`                                            |

13+ framework integrations at `ag-ui/integrations/`: LangGraph, CrewAI, Mastra, Vercel AI SDK, Agno, AWS Strands, LlamaIndex, and more.

---

## Quick Reference

**"I want to..."** — here's where to look:

### Setup & Configuration

| Goal                             | Package                  | Key file / API                               |
| -------------------------------- | ------------------------ | -------------------------------------------- |
| Set up a React app               | `@copilotkit/react-core` | `<CopilotKit runtimeUrl="...">` provider     |
| Set up an Angular app            | `@copilotkit/angular`    | `provideCopilotKit({ runtimeUrl })` DI token |
| Set up vanilla JS                | `@copilotkit/core`       | `new CopilotKitCore({ runtimeUrl })`         |
| Set up the backend (Express)     | `@copilotkit/runtime`    | `createCopilotEndpointExpress({ runtime })`  |
| Set up the backend (Hono)        | `@copilotkit/runtime`    | `createCopilotEndpointHono({ runtime })`     |
| Configure authentication headers | Provider / Core config   | `headers: { Authorization: "Bearer ..." }`   |
| Forward cookies to runtime       | Provider / Core config   | `credentials: "include"`                     |

### Agent Communication

| Goal                            | Package               | Key file / API                                 |
| ------------------------------- | --------------------- | ---------------------------------------------- |
| Get an agent instance (React)   | `@copilotkit/react`   | `useAgent({ agentId })`                        |
| Get an agent instance (Angular) | `@copilotkit/angular` | `AgentStore` with signals                      |
| Get an agent instance (vanilla) | `@copilotkit/core`    | `copilotkit.getAgent(id)`                      |
| Run an agent                    | Core / hooks          | `copilotkit.runAgent({ agent })`               |
| Use multiple agents             | Runtime config        | `agents: { research: agent1, coding: agent2 }` |
| Agent-specific tools            | `useFrontendTool`     | `{ name, agentId: "specific-agent", handler }` |
| Shared context for all agents   | `useAgentContext`     | `useAgentContext("desc", value)`               |

### Tools & Interactivity

| Goal                            | Package                  | Key file / API                                   |
| ------------------------------- | ------------------------ | ------------------------------------------------ |
| Register a tool agents can call | `react-core` or `react`  | `useFrontendTool({ name, parameters, handler })` |
| Give agents context data        | `react-core` or `react`  | `useCopilotReadable()` / `useAgentContext()`     |
| Share state with an agent (V1)  | `@copilotkit/react-core` | `useCoAgent({ name, initialState })`             |
| Custom UI for tool execution    | Provider or hook         | `renderToolCalls` / `useRenderToolCall()`        |
| Require human approval          | Provider or hook         | `humanInTheLoop` / `useHumanInTheLoop()`         |
| Auto-generate suggestions       | Hook                     | `useConfigureSuggestions({ instructions })`      |
| Inject system instructions (V1) | `@copilotkit/react-core` | `useCopilotAdditionalInstructions()`             |

### UI Components

| Goal                   | Package                      | Component           |
| ---------------------- | ---------------------------- | ------------------- |
| Full chat interface    | `@copilotkit/react-ui`       | `<CopilotChat>`     |
| Floating popup chat    | `@copilotkit/react-ui`       | `<CopilotPopup>`    |
| Side panel chat        | `@copilotkit/react-ui`       | `<CopilotSidebar>`  |
| Inline panel chat      | `@copilotkit/react-ui`       | `<CopilotPanel>`    |
| AI text autocompletion | `@copilotkit/react-textarea` | `<CopilotTextarea>` |

### Backend & Runtime

| Goal                         | Package                     | Key file / API                                       |
| ---------------------------- | --------------------------- | ---------------------------------------------------- |
| Custom agent runner          | `@copilotkit/runtime`       | Extend `AgentRunner` abstract class                  |
| Persistent agent state       | `@copilotkit/sqlite-runner` | `SQLiteAgentRunner`                                  |
| Request/response middleware  | `CopilotRuntime` options    | `beforeRequestMiddleware` / `afterRequestMiddleware` |
| Audio transcription          | `CopilotRuntime` options    | `transcriptionService`                               |
| Voice (speech-to-text / TTS) | `@copilotkit/voice`         | Voice services                                       |
| Build a custom agent         | `@copilotkit/sdk-js`        | LangGraph / LangChain helpers                        |

### Debugging & Internals

| Goal                             | Package                           | Key file / API                                                 |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Understand event types           | `@ag-ui/core`                     | `src/events.ts` — `EventType` enum                             |
| Understand the agent abstraction | `@ag-ui/client`                   | `src/agent/agent.ts` — `AbstractAgent`                         |
| See how an integration works     | `ag-ui/integrations/{framework}/` | Each extends `AbstractAgent`                                   |
| Understand the core orchestrator | `@copilotkit/core`                | `src/core/core.ts` — `CopilotKitCore`                          |
| Debug agent interactions         | `@copilotkit/web-inspector`       | Lit web component, enabled via `showDevConsole`                |
| Subscribe to lifecycle events    | Core API                          | `copilotkit.subscribe({ onError, onToolExecutionStart, ... })` |

---

## Monorepo Structure

```
cpk/
├── ag-ui/                          # AG-UI Protocol (open standard)
│   ├── sdks/typescript/packages/
│   │   ├── core/                   # @ag-ui/core — types + events
│   │   ├── client/                 # @ag-ui/client — AbstractAgent, HttpAgent
│   │   ├── encoder/                # @ag-ui/encoder — SSE/binary encoding
│   │   └── proto/                  # @ag-ui/proto — protobuf
│   └── integrations/               # 13+ framework adapters
│       ├── langgraph/
│       ├── crewai/
│       ├── mastra/
│       └── ...
│
└── CopilotKit/                     # CopilotKit Product
    └── packages/                   # All packages flat under @copilotkit/ scope
        ├── shared/                 # @copilotkit/shared — utils, types, constants
        ├── core/                   # @copilotkit/core — CopilotKitCore orchestrator
        ├── react-core/             # @copilotkit/react-core — provider + hooks
        ├── react-ui/               # @copilotkit/react-ui — chat components
        ├── react-textarea/         # @copilotkit/react-textarea — AI text editing
        ├── runtime/                # @copilotkit/runtime — Express/Hono server + AgentRunner + Built-in agent
        ├── runtime-client-gql/     # @copilotkit/runtime-client-gql — urql GraphQL client
        ├── angular/                # @copilotkit/angular — Angular integration
        ├── voice/                  # @copilotkit/voice — voice support
        ├── web-inspector/          # @copilotkit/web-inspector — debug console
        ├── sqlite-runner/          # @copilotkit/sqlite-runner — persistent AgentRunner
        └── sdk-js/                 # @copilotkit/sdk-js — LangGraph/LangChain helpers
```
