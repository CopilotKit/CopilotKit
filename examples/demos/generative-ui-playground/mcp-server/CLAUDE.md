# MCP Server

MCP Apps server providing 6 interactive HTML applications.

## Architecture

MCP Apps are HTML/JS applications served by MCP servers that render in chat as sandboxed iframes. The server registers tools with UI resources, and MCPAppsMiddleware bridges MCP to AG-UI.

```
MCP Server (port 3001)
├── Resources: HTML apps (mimeType: "text/html+mcp")
├── Tools: Link to resources via _meta.ui/resourceUri
└── Express endpoint: /mcp
```

## Apps

| App        | Tool                                                                   | Description                            |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------- |
| Flights    | `search_flights`                                                       | Flight search with 5-step booking flow |
| Hotels     | `search_hotels`, `select_hotel`, `select_room`, `create_hotel_booking` | Hotel booking workflow                 |
| Trading    | `create_portfolio`, `execute_trade`, `refresh_prices`                  | Investment simulator                   |
| Kanban     | `open_kanban_board`, `create_kanban_task`, `update_task_status`        | Kanban board with drag-drop            |
| Calculator | `open_calculator`                                                      | Basic calculator                       |
| Todo       | `open_todo_list`                                                       | Todo list with add/complete/delete     |

## Development

```bash
npm install
npm run dev    # Starts server on port 3001
```

## Adding a New App

### 1. Create HTML App

Create `apps/your-app.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      /* Your styles - reference shared-styles.css patterns */
    </style>
  </head>
  <body>
    <div id="app"><!-- Your UI --></div>
    <script>
      // MCP communication helper
      const mcpApp = (() => {
        let requestId = 1;
        const pendingRequests = new Map();

        function sendRequest(method, params) {
          const id = requestId++;
          return new Promise((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject });
            window.parent.postMessage(
              { jsonrpc: "2.0", id, method, params },
              "*",
            );
          });
        }

        window.addEventListener("message", (event) => {
          const { id, result, error } = event.data;
          if (id && pendingRequests.has(id)) {
            const { resolve, reject } = pendingRequests.get(id);
            pendingRequests.delete(id);
            error ? reject(error) : resolve(result);
          }
        });

        return { sendRequest };
      })();

      // Call MCP tools
      async function doSomething() {
        const result = await mcpApp.sendRequest("tools/call", {
          name: "your_tool",
          arguments: {
            /* params */
          },
        });
      }
    </script>
  </body>
</html>
```

### 2. Create Data Layer

Create `src/your-feature.ts`:

```typescript
export interface YourData {
  /* types */
}

export function yourFunction(): YourData {
  // Business logic
}
```

### 3. Register Tool with UI Resource

In `server.ts`:

```typescript
import fs from "fs";
import path from "path";

// Load HTML
const yourAppHtml = fs.readFileSync(
  path.join(__dirname, "apps/your-app.html"),
  "utf-8",
);

// Register resource
server.resource(
  "your-app-ui",
  "your://app",
  { mimeType: "text/html+mcp" },
  async () => ({
    contents: [
      { uri: "your://app", mimeType: "text/html+mcp", text: yourAppHtml },
    ],
  }),
);

// Register tool linking to resource
server.tool("open_your_app", "Opens the app", {}, async () => ({
  content: [{ type: "text", text: "App opened" }],
  _meta: { "ui/resourceUri": "your://app" },
}));
```

## Key Patterns

### Tool → UI Resource Linking

Tools specify `_meta: { "ui/resourceUri": "resource://uri" }` to render their associated UI.

### postMessage Communication

HTML apps use `window.parent.postMessage` for bidirectional communication:

- App → Agent: `{ jsonrpc: "2.0", id, method: "tools/call", params }`
- Agent → App: `{ id, result }` or `{ id, error }`

### Shared Styles

Reference `shared-styles.css` patterns for consistent CopilotKit styling (lilac/mint palette, glassmorphism).

## File Structure

```
mcp-server/
├── server.ts           # Main MCP server with tool registrations
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts        # Re-exports all data modules
│   ├── flights.ts      # Flight search/booking logic
│   ├── hotels.ts       # Hotel search/booking logic
│   ├── stocks.ts       # Portfolio/trading logic
│   ├── kanban.ts       # Kanban board logic
│   ├── calculator.ts   # Calculator operations
│   └── todo.ts         # Todo list operations
└── apps/
    ├── shared-styles.css    # Common styles
    ├── flights-app.html
    ├── hotels-app.html
    ├── trading-app.html
    ├── kanban-app.html
    ├── calculator-app.html
    └── todo-app.html
```
