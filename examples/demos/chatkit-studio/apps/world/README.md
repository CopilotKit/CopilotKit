# 🌍 CopilotKit World Explorer

Interactive world travel app demonstrating **CopilotKit** and **AG-UI protocol** integration with LangGraph agents.

![Gif Demo](copilotkit-world-demo.gif)

## Features

- **3D Globe**: Click countries to explore
- **AI Agent**: GPT-4o provides country information
- **Frontend Actions**: Agent calls UI tools via AG-UI protocol
- **Progress Tracking**: Level-based gamification with localStorage persistence

## Architecture

```
Frontend (Next.js)
  ↓ CopilotKit Runtime
  ↓ AG-UI Protocol
Backend (LangGraph Agent)
  ↓ GPT-4o
```

**Key Files:**

- `src/app/api/copilotkit/route.ts` - Connects frontend to LangGraph agent
- `src/components/MyChat.tsx` - Registers `renderCountry` action via `useCopilotAction`
- `agent/agent.py` - ReAct agent that calls frontend tools

## Getting Started

**Prerequisites:** Node.js 18+, Python 3.13+, OpenAI API key

**Setup:**

1. Install dependencies:

   ```bash
   npm install
   cd agent && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
   ```

2. Create `.env`:

   ```bash
   OPENAI_API_KEY=your_key_here
   ```

3. Run both servers:

   ```bash
   # Terminal 1
   npm run dev:agent

   # Terminal 2
   npm run dev
   ```

4. Open http://localhost:3000

## How It Works

1. User clicks country on globe
2. `handleVisit` adds to journey & sends message to CopilotKit
3. LangGraph agent receives message, calls `renderCountry` frontend action
4. `MyChat` renders `CountryCard` + AI response in chat

## Extending

**Add Backend Tool** (`agent/agent.py`):

```python
@tool
def get_weather(country: str):
    """Get weather for a country."""
    return f"Weather for {country}"

backend_tools = [get_weather]
```

**Add Frontend Action** (any component):

```typescript
useCopilotAction({
  name: "showMap",
  render: ({ args }) => <Map country={args.countryName} />,
});
```

## Tech Stack

- [CopilotKit](https://docs.copilotkit.ai/) - Agentic Application Framework
- [AG-UI Protocol](https://docs.ag-ui.com/) - Agent-UI communication
- [LangGraph](https://www.langchain.com/langgraph) - Agent framework
- [Next.js](https://nextjs.org/) - React framework

## License

MIT
