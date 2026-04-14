# Agentic Generative UI

## What This Demo Shows

Long-running agent tasks with generated UI

## How to Interact

Try asking your Copilot to:

- "What's the weather like in San Francisco?"
- "Show me current conditions in multiple cities"
- "What should I wear in Tokyo today?"

The agent generates custom UI components in the chat stream itself, rendering weather cards and interactive elements directly as part of its response.

## Technical Details

- **Agent-driven Generative UI** differs from tool-based -- the agent directly emits UI components in the response stream
- The agent's response includes structured data that CopilotKit renders as React components inline with the chat
- Unlike tool-based gen UI, this approach gives the agent full control over when and how UI appears
- The frontend registers renderers that map agent output types to React components
