# Scene Creator - CopilotKit + LangGraph + Gemini 3 Demo

A demo app showcasing [CopilotKit](https://copilotkit.ai) integration with [LangGraph](https://www.langchain.com/langgraph) and Google's Gemini 3 models. Generate AI-powered scenes by creating characters, backgrounds, and combining them together.

https://github.com/user-attachments/assets/3c60c2b8-5ccd-42f0-817f-0e5e22398a48

## What This Demo Shows

- **CopilotKit + LangGraph Integration** - Connect a Python LangGraph agent to a Next.js frontend
- **Shared State Pattern** - Bidirectional state sync between frontend and agent
- **Human-in-the-Loop (HITL)** - Approve/reject AI actions before execution
- **Generative UI** - Real-time tool execution feedback in chat
- **Dynamic API Keys** - Pass API keys from frontend to agent at runtime
- **Image Generation** - Using Gemini 3 and Nano Banana (gemini-2.5-flash-image)

## Demo Features

| Feature | Description |
|---------|-------------|
| Character Generation | Create characters with AI-generated images |
| Background Generation | Generate environments and scenes |
| Scene Composition | Combine characters and backgrounds |
| Image Editing | Modify generated images with natural language |
| HITL Approval | Review and approve image prompts before generation |

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- Google AI API Key ([get one here](https://makersuite.google.com/app/apikey))

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Set up your API key
echo 'GOOGLE_API_KEY=your-key-here' > agent/.env

# 3. Start the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start creating!

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main UI with CopilotKit integration
│   │   └── api/copilotkit/   # CopilotKit API route
│   ├── components/
│   │   ├── ArtifactPanel.tsx # Display generated artifacts
│   │   ├── ApiKeyInput.tsx   # Dynamic API key management
│   │   └── CustomChatInput.tsx
│   └── lib/
│       └── types.ts          # Shared TypeScript types
├── agent/
│   ├── agent.py              # LangGraph agent with tools
│   ├── server.py             # Custom routes (static files)
│   └── langgraph.json        # LangGraph configuration
```

## Key CopilotKit Patterns

### 1. Shared State (Frontend ↔ Agent)

```typescript
// Frontend: src/app/page.tsx
const { state, setState } = useCoAgent<AgentState>({
  name: "sample_agent",
  initialState: { characters: [], backgrounds: [], scenes: [] },
});

// Update state from frontend
setState((prev) => ({ ...prev, apiKey: newKey }));
```

```python
# Agent: agent/agent.py
class AgentState(MessagesState):
    characters: List[dict] = []
    backgrounds: List[dict] = []
    scenes: List[dict] = []
    apiKey: str = ""

# Read state in agent
api_key = state.get("apiKey", "")
```

### 2. Human-in-the-Loop (HITL)

```typescript
// Frontend: Enable HITL for specific tool
useCopilotAction({
  name: "approve_image_prompt",
  disabled: true,  // Agent calls this, not user
  handler: async ({ prompt }) => {
    // Show approval UI, return approved/rejected
  },
});
```

### 3. Generative UI

```typescript
// Show real-time tool progress
useCopilotAction({
  name: "create_character",
  render: ({ status, result }) => (
    <ToolCard status={status} result={result} />
  ),
});
```

### 4. LangGraph Agent Tools

```python
# agent/agent.py
@tool
async def create_character(
    name: str,
    description: str,
    prompt: str,
    state: Annotated[dict, InjectedState]  # Access shared state
) -> dict:
    api_key = state.get("apiKey", "")
    image_url = await generate_image(prompt, api_key=api_key)
    return {"name": name, "description": description, "imageUrl": image_url}
```

## Deployment

Deploy the agent to Railway:

```bash
cd agent
railway link
railway up
railway variables --set "AGENT_URL=https://your-app.up.railway.app"
railway variables --set "GOOGLE_API_KEY=your-key"
```

See [agent/DEPLOY.md](agent/DEPLOY.md) for detailed deployment guide.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| AI Integration | CopilotKit 1.10.6 |
| Agent | Python, LangGraph 0.6.6 |
| LLM | Gemini 3 Pro Preview |
| Image Gen | Nano Banana (gemini-2.5-flash-image) |

## Learn More

- [CopilotKit Docs](https://docs.copilotkit.ai) - Full CopilotKit documentation
- [LangGraph + CopilotKit Guide](https://docs.copilotkit.ai/coagents/langgraph/langgraph-native-python) - Integration guide
- [Shared State Pattern](https://docs.copilotkit.ai/coagents/langgraph/shared-state) - State synchronization

## License

MIT

Built by Mark Morgan
