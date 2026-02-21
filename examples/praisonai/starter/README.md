# PraisonAI Agents + CopilotKit

The **simplest** way to build AI agents with a beautiful UI.

## Why PraisonAI?

| Feature | Code |
|---------|------|
| Create an agent | `Agent(instructions="...")` |
| Add tools | `Agent(tools=[my_function])` |
| Multi-agent team | `PraisonAIAgents(agents=[...])` |
| Use MCP servers | `Agent(tools=MCP("npx ..."))` |
| Connect to CopilotKit | `AGUI(agent=agent)` |

## Quick Start

### 1. Install

```bash
pip install praisonaiagents fastapi uvicorn
```

### 2. Create `agent.py`

```python
from praisonaiagents import Agent, AGUI
from fastapi import FastAPI

agent = Agent(instructions="You are a helpful assistant")

app = FastAPI()
app.include_router(AGUI(agent=agent).get_router())
```

### 3. Run

```bash
export OPENAI_API_KEY=your-key
uvicorn agent:app --reload
```

### 4. Connect CopilotKit Frontend

```tsx
<CopilotKit runtimeUrl="http://localhost:8000/agui">
  <CopilotChat />
</CopilotKit>
```

**That's it!** 🎉

---

## Examples

### Basic Agent (`agent.py`)
```python
agent = Agent(instructions="You are a helpful assistant")
```

### Agent with Tools (`agent_with_tools.py`)
```python
def search(query: str) -> str:
    """Search the web."""
    return "results..."

agent = Agent(
    instructions="You can search the web",
    tools=[search]
)
```

### Multi-Agent Team (`multi_agent.py`)
```python
researcher = Agent(name="Researcher", instructions="Research topics")
writer = Agent(name="Writer", instructions="Write content")

team = PraisonAIAgents(
    agents=[researcher, writer],
    tasks=[research_task, write_task]
)
```

### MCP Tools (`mcp_agent.py`)
```python
# Use any of 100+ MCP tool servers!
agent = Agent(
    instructions="Search the web",
    tools=MCP("npx -y @modelcontextprotocol/server-brave-search")
)
```

---

## Key Features

✅ **Simple** - Create agents in 1 line  
✅ **Tools** - Any Python function becomes a tool  
✅ **Multi-Agent** - Teams of agents working together  
✅ **MCP Support** - Use 100+ pre-built tool servers  
✅ **Workflows** - Build complex pipelines  
✅ **Memory** - Agents remember conversations  
✅ **Knowledge** - RAG with any documents  
✅ **Any LLM** - OpenAI, Anthropic, Ollama, etc.

---

## More Examples

See the [PraisonAI Examples](https://github.com/MervinPraison/PraisonAI/tree/main/examples) for:
- Finance agents with stock tools
- Research agents with web search
- Code analysis agents
- Image understanding agents
- Voice agents
- And much more!

## Links

- [PraisonAI Documentation](https://docs.praison.ai)
- [PraisonAI GitHub](https://github.com/MervinPraison/PraisonAI)
- [CopilotKit Documentation](https://docs.copilotkit.ai)
