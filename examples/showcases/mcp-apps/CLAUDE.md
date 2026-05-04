# MCP Apps Demo

CopilotKit + MCP Apps integration demo — 4 interactive apps render in chat sidebar.

## What This Demo Shows

- **MCP Apps Extension (SEP-1865)**: HTML/JS apps served by MCP servers that render in iframes
- **Tool-to-UI linking**: `_meta["ui/resourceUri"]` connects tools to UI resources
- **Bidirectional communication**: UI calls MCP tools via JSON-RPC over postMessage
- **MCPAppsMiddleware**: AG-UI middleware that intercepts UI-enabled tool calls

## Running Locally

```bash
# Terminal 1: MCP Server
cd mcp-server && npm run dev

# Terminal 2: Next.js Frontend
npm run dev
```

- Frontend: http://localhost:3000
- MCP Server: http://localhost:3001

## The 4 Apps

| App                      | Main Tool           | Helper Tools                                          | UI Features                             |
| ------------------------ | ------------------- | ----------------------------------------------------- | --------------------------------------- |
| **Fitness Coach**        | `workout-generator` | `log-exercise-complete`, `adjust-workout`             | Timer, exercise cards, progress bar     |
| **Recipe Chef**          | `generate-recipe`   | `adjust-servings`                                     | Ingredients checklist, steps, nutrition |
| **Investment Simulator** | `create-portfolio`  | `execute-trade`, `refresh-prices`                     | Holdings, CSS charts, trade modal       |
| **Kanban Board**         | `create-board`      | `add-card`, `update-card`, `delete-card`, `move-card` | Drag-drop cards, columns, detail modal  |

## Key Files

### Frontend (`src/app/`)

| File                                  | Purpose                               |
| ------------------------------------- | ------------------------------------- |
| `api/copilotkit/[[...slug]]/route.ts` | BasicAgent + MCPAppsMiddleware config |
| `page.tsx`                            | CopilotKitProvider + CopilotSidebar   |

### MCP Server (`mcp-server/`)

| File                   | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `server.ts`            | Express + MCP SDK server with all tools/resources |
| `src/exercises.ts`     | Exercise database (21 exercises)                  |
| `src/workout-logic.ts` | Workout generation and modification               |
| `src/recipes.ts`       | Recipe database (12 recipes, 5 cuisines)          |
| `src/stocks.ts`        | Stock/portfolio logic (18 stocks, 6 sectors)      |
| `src/kanban.ts`        | Board/card logic (4 templates)                    |
| `apps/*.html`          | Interactive UI sources                            |
| `apps/dist/*.html`     | Bundled outputs (via Vite)                        |

## MCP Apps Patterns Used

### Tool Registration with UI Resource

```typescript
// server.ts
const RESOURCE_URI_META_KEY = "ui/resourceUri";

// Each app has a main tool that triggers the UI
server.registerTool(
  "workout-generator",
  {
    inputSchema: { duration, focus, equipment, difficulty },
    _meta: { [RESOURCE_URI_META_KEY]: "ui://fitness/workout-app.html" },
  },
  handler,
);

server.registerTool(
  "generate-recipe",
  {
    inputSchema: { cuisine, dietary, servings, maxTime },
    _meta: { [RESOURCE_URI_META_KEY]: "ui://recipe/recipe-app.html" },
  },
  handler,
);

server.registerTool(
  "create-portfolio",
  {
    inputSchema: { initialBalance, riskTolerance, focus },
    _meta: { [RESOURCE_URI_META_KEY]: "ui://trading/trading-app.html" },
  },
  handler,
);

server.registerTool(
  "create-board",
  {
    inputSchema: { projectName, template },
    _meta: { [RESOURCE_URI_META_KEY]: "ui://kanban/kanban-app.html" },
  },
  handler,
);
```

### Resource Registration

```typescript
server.registerResource(
  "fitness-app-template",
  "ui://fitness/workout-app.html",
  {
    mimeType: "text/html+mcp", // Critical: marks as MCP App
  },
  contentHandler,
);
```

### UI-to-Server Communication (all apps use this pattern)

```javascript
// MCP App Communication Module (same in all 4 apps)
const mcpApp = (() => {
  let requestId = 1;
  const pendingRequests = new Map();

  function sendRequest(method, params) {
    const id = requestId++;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  function sendNotification(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  // ... notification handlers ...
  return { sendRequest, sendNotification, onNotification };
})();

// Call MCP tool from iframe (separate params, NOT object style)
mcpApp.sendRequest("tools/call", { name: "log-exercise-complete", arguments: {...} });

// Listen for tool results
mcpApp.onNotification("ui/notifications/tool-result", (params) => {
  // Update UI with data from params.structuredContent
});
```

## Architecture

```
Frontend (Next.js)           CopilotKit Runtime           MCP Server
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│ CopilotSidebar  │ ──SSE──▶│ BasicAgent      │──HTTP──▶│ Express :3001   │
│                 │         │ + MCPApps       │         │                 │
│ ┌─────────────┐ │         │   Middleware    │         │ Tools:          │
│ │ MCP App     │ │         │                 │         │ - workout-gen   │
│ │ iframe      │◀──────────│ Emits Activity  │         │ - generate-recipe│
│ └─────────────┘ │         │ Snapshots       │         │ - create-portfolio│
└─────────────────┘         └─────────────────┘         │ - create-board  │
                                                        │ + helper tools  │
                                                        │                 │
                                                        │ Resources:      │
                                                        │ - fitness-app   │
                                                        │ - recipe-app    │
                                                        │ - trading-app   │
                                                        │ - kanban-app    │
                                                        └─────────────────┘
```

## Reference Documentation

- `.meridian/docs/mcp-apps-architecture.md` - Full architecture guide
- `.meridian/docs/mcp-apps-reference.md` - Code patterns and snippets
- `.meridian/api-docs/ag-ui-mcp-apps-middleware.md` - Middleware API

## Packages

**CRITICAL**: MCP Apps support requires `@copilotkit/*@1.51.0-next.4` or later. The `0.0.x` versions do NOT include `MCPAppsActivityRenderer`.

```json
"@copilotkit/core": "1.51.0-next.4",
"@copilotkit/react-core": "1.51.0-next.4",
"@copilotkit/runtime": "1.51.0-next.4",
"@copilotkit/shared": "1.51.0-next.4",
"@copilotkit/web-inspector": "1.51.0-next.4",
"@ag-ui/mcp-apps-middleware": "^0.0.1",
"zod": "^3.25.75"
```

- `@copilotkit/react-core/v2` - CopilotKitProvider, CopilotSidebar, MCPAppsActivityRenderer
- `@copilotkit/runtime` - CopilotRuntime, createCopilotEndpoint
- `@copilotkit/runtime/v2` - BuiltInAgent (agent merged into runtime)
- `@ag-ui/mcp-apps-middleware` - MCPAppsMiddleware
- `@modelcontextprotocol/sdk` - MCP server SDK

## Known Issues

- BasicAgent is deprecated in favor of BuiltInAgent (warning only, still works)
- Timer accuracy depends on browser tab being focused
- Must use `@copilotkit/*@1.51.0-next.4+` for MCP Apps - older versions lack UI rendering
- Sandboxed iframes block external CDN scripts (use inline styles instead of Tailwind CDN)
