# Tool-Based Generative UI

## What This Demo Shows

Agent uses tools to trigger UI generation

## How to Interact

Try asking your Copilot to:

- "What's the weather forecast for this week in San Francisco?"
- "Show me the weather in Paris"
- "Compare the weather in Tokyo and London"

The agent generates structured data via tools, and the frontend renders it as rich UI components.

## Technical Details

What's happening technically:

- **Generative UI** means the agent's tool calls produce structured data that the frontend renders as custom React components
- Unlike plain text responses, the agent returns tool results with typed parameters (city, temperature, conditions)
- `useRenderTool` maps each tool name to a React component, so `get_weather` renders a weather card with icons, temperature displays, and forecast details
- The agent decides when to call the tool based on context — it can mix tool-based UI generation with regular text responses
- This pattern enables agents to create dynamic, data-driven interfaces on demand
