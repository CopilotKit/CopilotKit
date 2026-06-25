# Fully Headless UI

## What This Demo Shows

Custom chat UI built with the lower-level agent runtime while still rendering registered tool UI through `useToolRenderingResolver`.

## How to Interact

Try asking:

- "What's the weather like in Lisbon?"
- "Check the weather in Tokyo."

## Technical Details

The application code intentionally uses the lower-level headless path:

- `useAgent` owns the chat messages and loading state.
- `useCopilotKit().copilotkit.runAgent` sends each user message to the agent.
- `useRenderTool` registers the `get_weather` renderer.
- `useToolRenderingResolver` renders each assistant tool call by resolving the matching registered renderer.

This demo is meant to prove that a dev-user can build their own chat shell without losing CopilotKit's registered tool rendering behavior.

## QA Focus

- The chat UI is custom application UI, not `CopilotChat`.
- Weather prompts create real assistant tool calls.
- The rendered weather card appears through the resolver path.
