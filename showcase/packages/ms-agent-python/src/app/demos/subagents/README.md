# Sub-Agents

## What This Demo Shows

Multiple agents with visible task delegation

## How to Interact

Try asking your Copilot to:

- "Research the weather in three cities and recommend the best for a picnic"
- "Help me plan a trip -- check weather, suggest activities, and create a packing list"
- "What's happening in San Francisco today?"

The agent delegates to specialized sub-agents for different tasks.

## Technical Details

- **Multi-agent** architecture -- the main agent delegates to specialized sub-agents via LangGraph's graph structure
- Each sub-agent has its own tools and system prompt, optimized for a specific task domain
- The orchestrator agent decides which sub-agent to invoke based on the user's request
- CopilotKit handles the full conversation across agent boundaries transparently
