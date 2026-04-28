# Tool Rendering

## What This Demo Shows

Backend agent tools rendered as UI components

## How to Interact

Try asking your Copilot to:

- "What's the weather like in San Francisco?"
- "Check the weather in Tokyo and New York"
- "Can you look up the current conditions in London?"

## Technical Details

What's happening technically:

- **Backend tools** are defined in the agent (e.g., `get_weather`) and called by the LLM when the user's query matches
- **`useRenderTool`** on the frontend registers a React component that renders whenever the agent calls that tool
- The render function receives `args` (input parameters), `result` (tool output), and `status` ("executing" or "complete") so the UI can show loading states
- The tool result is displayed as a rich UI card instead of plain text — demonstrating how agent actions can produce structured, visual output
