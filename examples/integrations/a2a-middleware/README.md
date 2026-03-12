# A2A + AG-UI Multi-Agent Starter

A minimal starter template for building multi-agent applications with **A2A Protocol** (Agent-to-Agent) and **AG-UI Protocol** (Agent-UI). This project demonstrates how to coordinate multiple AI agents across different frameworks (LangGraph and Google ADK) to solve tasks collaboratively.

![Screenshot of a demo](demo.png)

## Quick Start

### Prerequisites

- **Node.js** 18+
- **Python** 3.10+
- **Google API Key** - [Get one here](https://aistudio.google.com/app/apikey)
- **OpenAI API Key** - [Get one here](https://platform.openai.com/api-keys)

### Installation

1. **Install frontend dependencies:**

```bash
npm install
```

2. **Install Python dependencies:**

```bash
cd agents
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

3. **Set up environment variables:**

```bash
cp .env.example .env
# Edit .env and add your API keys:
# GOOGLE_API_KEY=your_google_api_key
# OPENAI_API_KEY=your_openai_api_key
```

4. **Start all services:**

```bash
npm run dev
```

This will start:

- **UI**: http://localhost:3000
- **Orchestrator**: http://localhost:9000
- **Research Agent**: http://localhost:9001
- **Analysis Agent**: http://localhost:9002

## Usage

Try asking:

- "Research quantum computing"
- "Tell me about artificial intelligence"
- "Research renewable energy"

The orchestrator will:

1. Send your query to the **Research Agent** to gather information
2. Pass the research to the **Analysis Agent** for insights
3. Present a complete summary with both research and analysis

## Development Scripts

```bash
# Start everything
npm run dev

# Start individual services
npm run dev:ui           # Next.js UI only
npm run dev:orchestrator # Orchestrator only
npm run dev:research     # Research agent only
npm run dev:analysis     # Analysis agent only

# Build for production
npm run build

# Lint code
npm run lint
```

## Customization

### Adding New Agents

1. **Create a new Python agent** in `agents/`:

   - Implement A2A Protocol (see existing agents as examples)
   - Choose a port (e.g., 9003)
   - Define agent capabilities and skills

2. **Register in middleware** (`app/api/copilotkit/route.ts`):

   ```typescript
   const newAgentUrl = "http://localhost:9003";

   const a2aMiddlewareAgent = new A2AMiddlewareAgent({
     agentUrls: [
       researchAgentUrl,
       analysisAgentUrl,
       newAgentUrl, // Add here
     ],
     // ...
   });
   ```

3. **Add run script** in `package.json`:

   ```json
   "dev:newagent": "python3 agents/new_agent.py"
   ```

4. **Update concurrently command** to include your new agent

### Changing UI

- **Main page**: Edit `app/page.tsx` for layout and result display
- **Chat**: Edit `components/chat.tsx` for chat behavior
- **Styling**: Edit `app/globals.css` and `tailwind.config.ts`
- **A2A badges**: Edit `components/a2a/` components

## What This Demonstrates

This starter shows how specialized agents built with different frameworks can communicate via the A2A protocol:

### Architecture

```
┌──────────────────────────────────────────┐
│ Next.js UI (CopilotKit)                  │
└────────────┬─────────────────────────────┘
             │ AG-UI Protocol
┌────────────┴─────────────────────────────┐
│ A2A Middleware                            │
│ - Routes messages between agents          │
└──────┬───────────────────────────────────┘
       │ A2A Protocol
       │
       ├─────► Research Agent (LangGraph)
       │       - Gathers information
       │       - Port 9001
       │
       └─────► Analysis Agent (ADK)
               - Analyzes findings
               - Port 9002
       ▲
       │
┌──────┴──────────┐
│ Orchestrator    │
│ (ADK)           │
│ Port 9000       │
└─────────────────┘
```

### Agents

1. **Orchestrator (ADK + AG-UI Protocol)**

   - Receives requests from the UI
   - Coordinates specialized agents
   - Port: 9000

2. **Research Agent (LangGraph + A2A Protocol)**

   - Gathers and summarizes information
   - Returns structured JSON
   - Port: 9001

3. **Analysis Agent (ADK + A2A Protocol)**
   - Analyzes research findings
   - Provides insights and conclusions
   - Port: 9002

## Project Structure

```
starter/
├── app/
│   ├── api/copilotkit/route.ts       # A2A middleware setup (KEY FILE!)
│   ├── layout.tsx                     # Root layout
│   ├── globals.css                    # Styles
│   └── page.tsx                       # Main UI
│
├── components/
│   ├── chat.tsx                       # Chat component with A2A visualization
│   └── a2a/                           # A2A message components
│       ├── agent-styles.ts            # Agent branding utilities
│       ├── MessageToA2A.tsx           # Outgoing message badges
│       └── MessageFromA2A.tsx         # Incoming message badges
│
├── agents/                            # Python agents
│   ├── orchestrator.py                # Orchestrator (ADK + AG-UI) - Port 9000
│   ├── research_agent.py              # Research (LangGraph + A2A) - Port 9001
│   ├── analysis_agent.py              # Analysis (ADK + A2A) - Port 9002
│   └── requirements.txt               # Python dependencies
│
├── package.json                       # Frontend dependencies & scripts
├── .env.example                       # Environment variables template
└── README.md                          # This file
```

## Key Concepts

### AG-UI Protocol

The **AG-UI Protocol** standardizes communication between the frontend (CopilotKit) and agents. The orchestrator uses AG-UI to receive messages from the UI.

### A2A Protocol

The **A2A Protocol** standardizes agent-to-agent communication. The Research and Analysis agents use A2A to communicate with the orchestrator.

### A2A Middleware

The **A2A Middleware** (in `app/api/copilotkit/route.ts`) is the magic that connects everything:

- Wraps the orchestrator agent
- Registers A2A agents automatically
- Injects a `send_message_to_a2a_agent` tool into the orchestrator
- Routes messages between agents

## Troubleshooting

### Agents not connecting?

- Verify all services are running: `http://localhost:9000-9002`
- Check console for startup errors

### Missing API keys?

- Ensure `.env` file exists with `GOOGLE_API_KEY` and `OPENAI_API_KEY`
- Restart all services after adding keys

### Python import errors?

- Activate virtual environment: `source agents/.venv/bin/activate`
- Reinstall dependencies: `pip install -r agents/requirements.txt`

### Port conflicts?

- Change ports in `.env` file:
  ```
  ORCHESTRATOR_PORT=9000
  RESEARCH_PORT=9001
  ANALYSIS_PORT=9002
  ```

## Learn More

- [AG-UI Protocol Documentation](https://docs.ag-ui.com)
- [A2A Protocol Specification](https://a2a-protocol.org)
- [Google ADK Documentation](https://google.github.io/adk-docs/)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
- [CopilotKit Documentation](https://docs.copilotkit.ai)

## License

MIT
