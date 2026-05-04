# Deep Research Assistant

A [CopilotKit](https://copilotkit.ai) Deep Agents demo showcasing planning, memory/files, and generative UI using [Tavily](https://www.tavily.com/) for web research.

https://github.com/user-attachments/assets/68d5729f-91f9-4fd9-a579-cd1a8f4aad8d

## What This Demo Shows

This demo showcases all key Deep Agents capabilities:

- **Planning (Todos)** - Visible research plan with status indicators (pending, in progress, completed)
- **Memory/Files** - Markdown files created by the agent, viewable in the workspace with download option
- **Generative UI** - Rich tool call rendering with result summaries and expandable details
- **Web Research** - Tavily-powered search for real-time information

## Architecture

```
[User asks research question]
        ↓
Next.js Frontend (CopilotChat + Workspace)
        ↓
CopilotKit Runtime → LangGraphHttpAgent
        ↓
Python Backend (FastAPI + AG-UI)
        ↓
Deep Agent (research_assistant)
    ├── write_todos        (planning, built-in)
    ├── write_file         (filesystem, built-in)
    ├── read_file          (filesystem, built-in)
    └── research(query)
            └── internal Deep Agent [thread-isolated]
                    └── internet_search (Tavily)
```

## Project Structure

```
deep-research-v2/
├── src/                              # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx               # CopilotKit provider
│   │   ├── page.tsx                 # Main page with useDefaultTool
│   │   ├── globals.css              # Glassmorphism styles
│   │   └── api/copilotkit/route.ts  # CopilotRuntime endpoint
│   ├── components/
│   │   ├── Workspace.tsx            # Research progress display
│   │   ├── ToolCard.tsx             # Generative UI for tools
│   │   └── FileViewerModal.tsx      # Markdown file viewer
│   └── types/
│       └── research.ts              # TypeScript types
│
├── agent/                           # Python backend
│   ├── main.py                      # FastAPI server + AG-UI
│   ├── agent.py                     # Deep Agent definition
│   ├── tools.py                     # Tavily search tools
│   └── pyproject.toml               # Python dependencies
│
├── .env.example                     # Environment variables
└── README.md                        # This file
```

## Environment Variables

| Variable                   | Required | Default                 | Description                                         |
| -------------------------- | -------- | ----------------------- | --------------------------------------------------- |
| `OPENAI_API_KEY`           | Yes      | -                       | [Get API key](https://platform.openai.com/api-keys) |
| `TAVILY_API_KEY`           | Yes      | -                       | [Get API key](https://app.tavily.com/home)          |
| `OPENAI_MODEL`             | No       | `gpt-5.2`               | Model to use (gpt-5.2, gpt-5, etc.)                 |
| `LANGGRAPH_DEPLOYMENT_URL` | No       | `http://localhost:8123` | Backend URL                                         |
| `SERVER_HOST`              | No       | `0.0.0.0`               | Backend host                                        |
| `SERVER_PORT`              | No       | `8123`                  | Backend port                                        |

## Setup & Installation

### Backend (Python)

```bash
cd agent
uv venv && source .venv/bin/activate
uv pip install -e .
```

Or with pip:

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -e .
```

### Frontend (Node.js)

```bash
npm install
```

### Environment

Copy `.env.example` to `.env` in both the root directory and `agent/` directory, then fill in your API keys.

## Running Locally

**Terminal 1 - Backend:**

```bash
cd agent
uv run python main.py
```

**Terminal 2 - Frontend:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and ask the assistant to research any topic.

## Key Patterns

### Frontend: useDefaultTool (not useCoAgent)

This demo uses local React state with `useDefaultTool` instead of `useCoAgent` to avoid type mismatches between Python's FilesystemMiddleware (Dict) and TypeScript (Array):

```typescript
const [state, setState] = useState<ResearchState>(INITIAL_STATE);

useDefaultTool({
  render: (props) => {
    // Update local state based on tool results
    if (name === "write_todos" && status === "complete") {
      setState(prev => ({ ...prev, todos: result.todos }));
    }
    return <ToolCard {...props} />;
  },
});
```

### Backend: Deep Agents with research tool

```python
agent_graph = create_deep_agent(
    model=ChatOpenAI(model="gpt-5.2"),
    system_prompt=MAIN_SYSTEM_PROMPT,
    tools=[research],
    middleware=[CopilotKitMiddleware()],
    checkpointer=MemorySaver(),
)
```

## Learn More

- [Deep Agents Documentation](https://docs.copilotkit.ai/integrations/langgraph/deep-agents)
- [Building Frontends for Deep Agents](https://www.copilotkit.ai/blog/how-to-build-a-frontend-for-langchain-deep-agents-with-copilotkit)
- [CopilotKit Documentation](https://docs.copilotkit.ai)
- [Tavily Documentation](https://docs.tavily.com/welcome)

## License

MIT
