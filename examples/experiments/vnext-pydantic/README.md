<img width="910" height="1077" alt="image" src="https://github.com/user-attachments/assets/4869e961-51e7-4008-a2fd-bee0ff59efbd" />

# VNext with Pydantic

This app sets up a direct connection between Pydantic AI and CopilotKit vNext to create a playground for chatting with an AI agent.

CopilotKit connects directly to the endpoint created by the Pydantic AI agent. The React frontend then displays the chat and
shows streaming updates of what the agent is doing in real-time.

## How It Works

1. **Backend (Python)**: Creates a Pydantic AI agent and sets up an endpoint using `handle_ag_ui_request()`.

2. **Frontend (React)**: Uses CopilotKit's chat component to communicate directly with the Pydantic AI agent.

## What You Need

- [uv](https://docs.astral.sh/uv/) for Python package management
- [pnpm](https://pnpm.io/) for Node.js package management
- An OpenAI API key in your `.env` file or elsewhere in your environment

## Production Setup

Build the React app once and let Python serve both the static bundle and the agent on port 8000.

### 1. Build the frontend bundle

```bash
cd frontend
pnpm install
pnpm run build:static
cd ..
```

### 2. Start the Python server

```bash
cat > .env <<'EOF'
OPENAI_API_KEY=your-openai-api-key
EOF

uv venv
uv pip install -r requirements.txt
uv run python server.py
```

Visit [http://localhost:8000](http://localhost:8000). The static frontend is served from `/`, and `/api` streams agent responses.

## Development Setup (Live Reload)

Run the backend and frontend separately to get hot reloads during development.

### Terminal 1: Python backend (port 8000)

```bash
cat > .env <<'EOF'
OPENAI_API_KEY=your-openai-api-key
EOF

uv venv
uv pip install -r requirements.txt
uv run python server.py
```

### Terminal 2: React frontend (port 3000)

```bash
cd frontend
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting. The dev server reflects code changes immediately.

- **Tool Calls**: The agent has a `get_weather` tool. When you ask about weather, you'll see the tool being called in the UI.
- **Real-time Streaming**: Responses stream in as they're generated.
- **Tool Visualization**: The `WildCardToolCallRender` component shows you exactly what tools are being called with what arguments and results.

## How the frontend is set up (see [`frontend/app/page.tsx`](frontend/app/page.tsx))

1. Import `PydanticAIAgent` from `@ag-ui/pydantic-ai`
2. Creates the outer `CopilotKitProvider` component and configures the `default` agent to use the Pydantic AI agent.
3. Adds the `WildCardToolCallRender` component to the `renderToolCalls` to surface tool calls in the UI.
4. Adds the `CopilotChat` component inside a full-screen div.

## Files That Matter

- `agent.py` - The Pydantic AI agent definition.
- `server.py` - Starlette app that serves `/api` and the static frontend.
- `frontend/app/page.tsx` - Sets up CopilotKit and connects to the backend.

## Want to Modify?

- Add more tools: Just add more `@agent.tool` decorated functions in `agent.py`
- Add custom tool renderers: Define them with `defineToolCallRender` and add to the `renderToolCalls` prop in `frontend/app/page.tsx`
- Customize the UI ...
