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
- **HttpAgent** - Connects to Python A2A backend for A2UI

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- OpenAI API key

### Installation

```bash
# Clone and install dependencies
cd ui-protocols-demo
npm install

# Install MCP server dependencies
cd mcp-server
npm install
cd ..

# Install Python A2A agent
cd a2a-agent
pip install -e .
cd ..
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
cd mcp-server && npm run dev

# Terminal 2: Python A2A Agent (port 10002)
cd a2a-agent && python -m agent

# Terminal 3: Next.js Frontend (port 3000)
npm run dev
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
   BasicAgent + MCP     HttpAgent → Python
   Port 3001            Port 10002
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
