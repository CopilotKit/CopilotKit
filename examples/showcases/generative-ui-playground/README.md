# Generative UI Demo

https://github.com/user-attachments/assets/79ead351-f63c-4119-9d28-9d604e7f8876

A generative UI playground showcasing the three types for building AI-powered user interfaces with CopilotKit.

## Demo Overview

This demo demonstrates how different types of generative UI can be used to create rich, interactive AI experiences:

| Spec             | Description                                             | Use Case                                        |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------- |
| **Static GenUI** | Pre-built React components rendered by frontend hooks   | Weather cards, stock displays, task approvals   |
| **MCP Apps**     | HTML/JS apps served by MCP servers in sandboxed iframes | Flight booking, hotel search, trading simulator |
| **A2UI**         | Agent-composed declarative JSON UI rendered dynamically | Restaurant finder, booking forms                |

## CopilotKit Features Used

- **CopilotKitProvider** - Main provider with agent switching
- **CopilotSidebar** - Chat interface component
- **useRenderToolCall** - Display-only tool rendering (WeatherCard, StockCard)
- **useHumanInTheLoop** - Interactive approval flows (TaskApprovalCard)
- **A2UIRenderer** - Renders A2UI declarative JSON from agent responses
- **MCPAppsMiddleware** - Bridges MCP server tools with UI resources
- **BasicAgent** - TypeScript agent for Static GenUI + MCP Apps
- **A2AAgent** - Connects to the Python A2A backend for A2UI

## Setup

### Prerequisites

- Node.js 22 (the repository `.nvmrc` version)
- Corepack (included with Node.js)
- Python 3.11+
- OpenAI API key

### Installation

```bash
# From the CopilotKit repository root, install the pnpm workspace.
# Corepack reads the repository's packageManager field (pnpm 10.33.4).
corepack enable
pnpm install --frozen-lockfile

# The MCP server is a standalone npm project with its own package-lock.json.
cd examples/showcases/generative-ui-playground/mcp-server
npm ci
cd ../../../..

# The A2A agent is a standalone Python project.
cd examples/showcases/generative-ui-playground/a2a-agent
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
cd ../../../..
```

### Environment Variables

Create a `.env` file:

```bash
OPENAI_API_KEY=sk-your-key-here
MCP_SERVER_URL=http://localhost:3001/mcp
A2A_AGENT_URL=http://localhost:10002
```

### Running the Demo

Start all three services:

```bash
# Terminal 1: MCP Server (port 3001)
cd examples/showcases/generative-ui-playground/mcp-server
npm run dev

# Terminal 2: Python A2A Agent (port 10002)
cd examples/showcases/generative-ui-playground/a2a-agent
source .venv/bin/activate
python -m agent --port 10002

# Terminal 3: Next.js frontend (port 3000), from the repository root
pnpm exec nx run ui-protocols-demo:dev
```

Open http://localhost:3000 to see the demo.

## Usage

### Static + MCP Apps Mode

Click the "Static + MCP Apps" tab to use:

- "What's the weather in Tokyo?" → Weather card
- "Get stock price for AAPL" → Stock card with sparkline
- "Open the calculator" → Interactive calculator app
- "Search for flights to Paris" → Flight booking workflow

### A2UI Mode

Click the "A2UI" tab to use:

- "Find Italian restaurants nearby" → Restaurant list with booking
- "Show me Chinese food options" → Filtered results
- "Book a table for 4" → Interactive booking form

## Architecture

```
Frontend (Next.js) ─────────────────────────────────────────────────────
├── Protocol tabs switch between agents
├── Static GenUI: useRenderToolCall, useHumanInTheLoop
├── MCP Apps: Automatic iframe rendering via middleware events
└── A2UI: A2UIRenderer for declarative JSON
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   "default" Agent      "a2ui" Agent
   BasicAgent + MCP     A2AAgent → Python
   Port 3001            Port 10002
```

## Railway Service Settings

Create three Railway services from this repository and configure these exact paths. Railway's config-file path is repository-absolute and does not follow the Root Directory. The Docker build context is the configured Root Directory.

| Service    | Root Directory                                            | Railway Config File                                                    | Docker build context                                     | `dockerfilePath` resolved from that context              |
| ---------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Frontend   | `/`                                                       | `/examples/showcases/generative-ui-playground/railway.toml`            | repository root (`/`)                                    | `examples/showcases/generative-ui-playground/Dockerfile` |
| A2A agent  | `/examples/showcases/generative-ui-playground/a2a-agent`  | `/examples/showcases/generative-ui-playground/a2a-agent/railway.toml`  | `examples/showcases/generative-ui-playground/a2a-agent`  | `Dockerfile`                                             |
| MCP server | `/examples/showcases/generative-ui-playground/mcp-server` | `/examples/showcases/generative-ui-playground/mcp-server/railway.toml` | `examples/showcases/generative-ui-playground/mcp-server` | `Dockerfile`                                             |

Do not set the frontend Root Directory to the demo subdirectory. Its Dockerfile copies the root pnpm workspace and local `packages/`, so it requires the repository root as its build context. See Railway's [monorepo](https://docs.railway.com/deployments/monorepo), [config-as-code](https://docs.railway.com/config-as-code), and [Dockerfile](https://docs.railway.com/builds/dockerfiles) documentation for the path semantics.

The repository does not currently run this showcase's container build in CI. Before changing its dependency or deployment configuration, verify it manually from the repository root:

```bash
pnpm install --frozen-lockfile --ignore-scripts --filter ui-protocols-demo...
pnpm exec nx run ui-protocols-demo:build --skip-nx-cache
docker build \
  -f examples/showcases/generative-ui-playground/Dockerfile \
  -t ui-protocols-demo:local .
```

## Project Structure

```
ui-protocols-demo/
├── src/app/              # Next.js frontend
│   ├── page.tsx          # Main page with agent switching
│   ├── theme.ts          # A2UI theme configuration
│   ├── api/copilotkit/   # CopilotKit API route
│   └── components/       # React components
├── mcp-server/           # MCP Apps server
│   ├── server.ts         # Tool registrations
│   └── apps/             # HTML app files
└── a2a-agent/            # Python A2A agent
    └── agent/            # Agent modules
```

## Learn More

- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [Generative UI Types](https://www.copilotkit.ai/generative-ui)
- [A2UI Specification](https://a2ui.org)
- [MCP Apps](https://modelcontextprotocol.io)
