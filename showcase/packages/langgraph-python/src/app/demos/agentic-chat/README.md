# Agentic Chat with Frontend Tools

## What This Demo Shows

CopilotKit's agentic chat capabilities with frontend tool integration:

- **Natural Conversation**: Chat with your Copilot in a familiar chat interface
- **Frontend Tool Execution**: The Copilot can directly interact with your UI by calling frontend functions
- **Backend Tool Rendering**: Backend tools (like weather) are rendered as rich UI components
- **Agent Context**: The agent receives context about the current user

## How to Interact

Try asking your Copilot to:

- "Can you change the background color to something more vibrant?"
- "Make the background a blue to purple gradient"
- "What's the weather like in San Francisco?"
- "Set the background to a sunset-themed gradient"

You can also chat about other topics — the agent will respond conversationally while having the ability to use your UI tools when appropriate.

## Technical Details

**Frontend tools** are registered using `useFrontendTool`:

- `change_background` — accepts a CSS background value and applies it to the chat container
- CopilotKit automatically exposes this function to the agent
- The agent determines when to call the tool based on the user's request

**Backend tool rendering** uses `useRenderTool`:

- `get_weather` — a backend tool that the agent calls; the frontend renders the result as a weather card
- The render function receives `args`, `result`, and `status` for loading/complete states

**Agent context** is provided via `useAgentContext`:

- Sends the user's name to the agent so it can personalize responses

**Suggestions** are configured with `useConfigureSuggestions`:

- Static suggestions shown as quick-action buttons below the chat
