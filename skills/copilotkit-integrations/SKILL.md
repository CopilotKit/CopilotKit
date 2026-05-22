---
name: copilotkit-integrations
description: "Use when wiring an external agent framework (LangGraph, CrewAI, PydanticAI, Mastra, ADK, LlamaIndex, Agno, Strands, Microsoft Agent Framework, or others) into a CopilotKit application via the AG-UI protocol."
version: 1.0.0
---

# CopilotKit Integrations

## Live Documentation (MCP)

This plugin includes an MCP server (`copilotkit-docs`) that provides `search-docs` and `search-code` tools for querying live CopilotKit documentation and source code. Useful for looking up framework-specific integration details.

- **Claude Code:** Auto-configured by the plugin's `.mcp.json` -- no setup needed.
- **Codex:** Requires manual configuration. See the [copilotkit-debug skill](../copilotkit-debug/SKILL.md#mcp-setup) for setup instructions.

## Overview

CopilotKit connects to external agent frameworks through the **AG-UI (Agent-UI) protocol** -- a streaming protocol that enables bidirectional communication between a frontend CopilotKit application and a backend agent. Every integration follows the same architectural pattern:

1. **Agent server** -- your agent framework runs as an HTTP server (usually FastAPI/uvicorn for Python, or an Express/Next.js route for JS/TS)
2. **AG-UI adapter** -- a framework-specific adapter translates between the agent's native interface and the AG-UI wire protocol
3. **CopilotKit runtime** -- the Next.js API route creates a `CopilotRuntime` that connects to the agent via an AG-UI client class
4. **Frontend** -- React components use `useAgent`, `useFrontendTool`, `useRenderToolCall`, and `useHumanInTheLoop` to interact with the agent

## Supported Integrations

| Framework | Language | AG-UI Client (route.ts) | AG-UI Server Adapter | Agent Port |
|-----------|----------|------------------------|---------------------|------------|
| LangGraph (Python, self-hosted) | Python | `LangGraphHttpAgent` from `@copilotkit/runtime/langgraph` | `ag-ui-langgraph` (`add_langgraph_fastapi_endpoint`) | 8123 |
| LangGraph (Python, LangGraph Platform) | Python | `LangGraphAgent` from `@copilotkit/runtime/langgraph` | LangGraph Platform (managed) | varies |
| LangGraph (JS) | TypeScript | `LangGraphAgent` from `@copilotkit/runtime/langgraph` | Built into `@copilotkit/sdk-js/langgraph` | 8123 |
| CrewAI Flows | Python | `HttpAgent` from `@ag-ui/client` | `ag-ui-crewai` (`add_crewai_flow_fastapi_endpoint`) | 8000 |
| CrewAI Crews | Python | `CrewAIAgent` from `@ag-ui/crewai` | `ag-ui-crewai` (`add_crewai_crew_fastapi_endpoint`) | 8000 |
| PydanticAI | Python | `HttpAgent` from `@ag-ui/client` | `pydantic-ai-slim[ag-ui]` (`agent.to_ag_ui()`) | 8000 |
| Mastra | TypeScript | `MastraAgent` from `@ag-ui/mastra` | Built into `@ag-ui/mastra` | Next.js dev server |
| Google ADK | Python | `HttpAgent` from `@ag-ui/client` | `ag-ui-adk` (`add_adk_fastapi_endpoint`) | 8000 |
| LlamaIndex | Python | `LlamaIndexAgent` from `@ag-ui/llamaindex` | `llama-index-protocols-ag-ui` (`get_ag_ui_workflow_router`) | 9000 |
| Agno | Python | `HttpAgent` from `@ag-ui/client` | `agno` (built-in `AgentOS` with `AGUI` interface) | 8000 |
| Strands | Python | `HttpAgent` from `@ag-ui/client` | `ag_ui_strands` (`create_strands_app`) | 8000 |
| Microsoft Agent Framework (Python) | Python | `HttpAgent` from `@ag-ui/client` | `agent-framework-ag-ui` (`add_agent_framework_fastapi_endpoint`) | 8000 |
| Microsoft Agent Framework (.NET) | C# | `HttpAgent` from `@ag-ui/client` | `Microsoft.Agents.AI.Hosting.AGUI.AspNetCore` (`MapAGUI`) | 8000 |
| A2A Middleware | Python + TS | `A2AMiddlewareAgent` from `@ag-ui/a2a-middleware` | Per-agent (mixed frameworks) | 9000-9002 |
| MCP Apps | TypeScript | `BuiltInAgent` with `MCPAppsMiddleware` | N/A (middleware on BuiltInAgent) | 3108 |

## Decision Tree

Use this to pick the right integration:

```
Is your agent written in TypeScript/JavaScript?
  YES --> Is it a Mastra agent?
    YES --> Use Mastra integration (references/integrations/mastra.md)
    NO  --> Is it a LangGraph JS agent?
      YES --> Use LangGraph JS integration (references/integrations/langgraph.md, JS section)
      NO  --> Use BuiltInAgent with MCP Apps middleware or HttpAgent
  NO (Python or .NET) -->
    Which framework?
      LangGraph     --> references/integrations/langgraph.md
      CrewAI        --> references/integrations/crewai.md
      PydanticAI    --> references/integrations/pydantic-ai.md
      Google ADK    --> references/integrations/adk.md
      LlamaIndex    --> references/integrations/llamaindex.md
      Agno          --> references/integrations/agno.md
      Strands       --> references/integrations/strands.md
      MS Agent Fw   --> references/integrations/ms-agent-framework.md
      Multiple agents (A2A) --> references/integrations/a2a.md
```

## Common AG-UI Protocol Patterns

Every integration shares these patterns on the frontend side.

### CopilotKit Provider (layout.tsx)

```tsx
import { CopilotKitProvider } from "@copilotkit/react";
import "@copilotkit/react/styles.css";

export default function RootLayout({ children }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agent="my_agent_name">
      {children}
    </CopilotKitProvider>
  );
}
```

The `agent` prop must match the key used in `CopilotRuntime({ agents: { my_agent_name: ... } })`.

### API Route Pattern (route.ts)

All integrations create a Next.js API route at `src/app/api/copilotkit/route.ts`:

```tsx
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { NextRequest } from "next/server";
// Import the appropriate agent class for your framework

const runtime = new CopilotRuntime({
  agents: {
    my_agent: new SomeAgentClass({ url: "http://localhost:8000/" }),
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

### Shared State (useAgent)

```tsx
const { state, setState } = useAgent<{ proverbs: string[] }>({
  name: "my_agent",
  initialState: { proverbs: [] },
});
```

### Frontend Tools (useFrontendTool)

```tsx
useFrontendTool({
  name: "setThemeColor",
  parameters: [
    { name: "themeColor", description: "Hex color value", required: true },
  ],
  handler({ themeColor }) {
    setThemeColor(themeColor);
  },
});
```

### Generative UI (useRenderToolCall)

```tsx
useRenderToolCall({
  name: "get_weather",
  description: "Get weather for a location.",
  parameters: [{ name: "location", type: "string", required: true }],
  render: ({ args }) => <WeatherCard location={args.location} />,
}, []);
```

### Human in the Loop (useHumanInTheLoop)

```tsx
useHumanInTheLoop({
  name: "go_to_moon",
  description: "Go to the moon on request.",
  render: ({ respond, status }) => (
    <MoonCard status={status} respond={respond} />
  ),
}, []);
```

## Agent-Side State Management

On the agent side, shared state is managed differently per framework, but the protocol is the same -- agents emit `STATE_SNAPSHOT` events to update the frontend. See each integration guide for framework-specific patterns.

## Key Packages

Frontend (all integrations):
- `@copilotkit/react` -- hooks (`useAgent`, `useFrontendTool`, `useRenderToolCall`, `useHumanInTheLoop`) and UI components (`CopilotSidebar`, `CopilotPopup`)
- `@copilotkit/runtime` -- server runtime (`CopilotRuntime`, `ExperimentalEmptyAdapter`)

AG-UI client classes (choose one per integration):
- `@copilotkit/runtime/langgraph` -- `LangGraphAgent`, `LangGraphHttpAgent`
- `@ag-ui/client` -- `HttpAgent` (generic, works with any AG-UI server)
- `@ag-ui/crewai` -- `CrewAIAgent`
- `@ag-ui/mastra` -- `MastraAgent`
- `@ag-ui/llamaindex` -- `LlamaIndexAgent`
- `@ag-ui/a2a-middleware` -- `A2AMiddlewareAgent`
- `@ag-ui/mcp-apps-middleware` -- `MCPAppsMiddleware`
