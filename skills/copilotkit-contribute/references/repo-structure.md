# Repository Structure

## Overview

CopilotKit is a pnpm monorepo managed by Nx. Packages live under `packages/`, examples under `examples/`, and a showcase app under `showcase/`.

```
CopilotKit/
  packages/
    v1/          # Public API packages (@copilotkit/*)
    v2/          # Implementation packages (@copilotkit/*)
  examples/
    v1/          # V1 example apps
    v2/          # V2 example apps (React, Angular, Node, etc.)
  showcase/      # Showcase app (shell + packages + scripts)
```

## V1-Wraps-V2 Architecture

V2 (`@copilotkit/*`) is the real implementation. V1 (`@copilotkit/*`) is the public API that wraps V2 internally. New features always go in V2. If V1 compatibility is needed, create a thin re-export or wrapper in the corresponding V1 package.

All layers communicate via the **AG-UI protocol** — an event-based standard streamed over SSE.

```
Frontend (React/Angular/Vanilla)  ->  Runtime (Express/Hono server)  ->  Agent (LangGraph/CrewAI/BuiltIn/Custom)
```

## V2 Packages (`packages/v2/`)

| Directory | Package Name | Description |
|---|---|---|
| `shared` | `@copilotkit/shared` | Common utilities, types, and constants used across all other packages |
| `core` | `@copilotkit/core` | The `CopilotKitCore` orchestrator — manages agent registry, tool registry, context store, and event subscriptions. All framework packages wrap this. |
| `react` | `@copilotkit/react` | React hooks (`useAgent`, `useFrontendTool`, `useAgentContext`, etc.) and `CopilotKitProvider`. Thin wrappers that register/unregister with Core. |
| `angular` | `@copilotkit/angular` | Angular DI tokens, services, and signal-based state. Same concepts as React using Angular patterns. |
| `runtime` | `@copilotkit/runtime` | Server-side `CopilotRuntime` class. Receives HTTP requests, delegates to agents. Provides Express and Hono adapters. Contains `AgentRunner` abstraction. |
| `agent` | `@copilotkit/agent` | `BuiltInAgent` — a default agent implementation powered by the Vercel AI SDK. Used when developers don't bring their own agent framework. |
| `voice` | `@copilotkit/voice` | Voice input and transcription support. |
| `web-inspector` | `@copilotkit/web-inspector` | Debug console (Lit web component) for inspecting agent communication in development. |
| `sqlite-runner` | `@copilotkit/sqlite-runner` | `AgentRunner` implementation that persists thread state to SQLite instead of memory. |
| `demo-agents` | `@copilotkit/demo-agents` | Demo agent implementations for examples and testing. |
| `eslint-config` | `@copilotkit/eslint-config` | Shared ESLint configuration for v2 packages. |
| `typescript-config` | `@copilotkit/typescript-config` | Shared TypeScript configuration for v2 packages. |

## V1 Packages (`packages/v1/`)

| Directory | Package Name | Description |
|---|---|---|
| `react-core` | `@copilotkit/react-core` | Public `<CopilotKit>` provider and hooks. Internally delegates to V2 core. |
| `react-ui` | `@copilotkit/react-ui` | Chat UI components — `CopilotChat`, `CopilotPopup`, `CopilotSidebar`, `CopilotPanel`. |
| `react-textarea` | `@copilotkit/react-textarea` | `CopilotTextarea` component for AI-assisted text editing. |
| `shared` | `@copilotkit/shared` | Shared types and telemetry utilities. |
| `runtime` | `@copilotkit/runtime` | Server-side runtime with GraphQL server and LLM adapters. |
| `runtime-client-gql` | `@copilotkit/runtime-client-gql` | urql-based GraphQL client for frontend-to-runtime communication. |
| `sdk-js` | `@copilotkit/sdk-js` | Helpers for LangGraph/LangChain agent integration. |
| `a2ui-renderer` | `@copilotkit/a2ui-renderer` | AG-UI renderer for V1 compatibility. |
| `cli` | `copilotkit` | CopilotKit CLI tool. |
| `eslint-config-custom` | `eslint-config-custom` | Shared ESLint config for v1 packages. |
| `tailwind-config` | `tailwind-config` | Shared Tailwind CSS configuration. |
| `tsconfig` | `tsconfig` | Shared TypeScript configuration for v1 packages. |

## Examples (`examples/`)

```
examples/
  v1/          # V1 example apps
  v2/
    angular/   # Angular examples (storybook, demo, demo-server)
    docs/      # Documentation site
    node/      # Plain Node.js example
    node-express/  # Express server example
    react/     # React examples (storybook, demo)
    interrupts-langraph/  # LangGraph interrupt handling example
    next-pages-router/    # Next.js Pages Router example
  canvas/      # Canvas examples
  e2e/         # End-to-end test apps
  integrations/  # Agent framework integration examples
  showcases/   # Showcase demos
```

## Workspace Configuration

**pnpm-workspace.yaml** defines the workspace packages:

```yaml
packages:
  - "packages/v1/*"
  - "packages/v2/*"
  - "examples/v1/*"
  - "examples/v2/*"
  - "examples/v2/*/apps/*"
  - "examples/v2/react/*"
  - "examples/v2/angular/*"
  - "showcase/shell"
  - "showcase/packages/*"
  - "showcase/scripts"
```

**nx.json** configures task orchestration:

- Default base branch: `main`
- Build parallelism: 14
- Build outputs go to `{projectRoot}/dist/**`
- Test outputs go to `{projectRoot}/coverage/**`
- All builds depend on upstream package builds (`^build`)
- Named inputs separate `production` (no tests, no markdown) from `test` (source + test files)

## Core Concepts

### Request Lifecycle

1. Frontend creates `CopilotKitCore` and fetches agent info from runtime
2. User sends message — POST to runtime with `RunAgentInput` payload
3. Runtime resolves agent, runs middleware, executes via `AgentRunner`
4. Agent emits AG-UI events streamed back over SSE
5. Frontend tool calls are executed locally in the browser, results sent back
6. Core updates message store, framework layer re-renders

### Key Abstractions

- **ProxiedAgent** — frontend representation of a remote agent; translates calls to HTTP + SSE
- **AgentRunner** — runtime-side thread state manager (InMemory or SQLite)
- **Tool Registration** — frontend tools (browser-side handlers) vs backend tools (server-side)
- **Context** — JSON-serializable app state sent with every agent run via `useAgentContext`
- **Middleware** — `beforeRequestMiddleware` / `afterRequestMiddleware` on `CopilotRuntime`
