# Headless Chat (Simple)

## What This Demo Shows

A minimal headless chat UI built directly on `useAgent` — no `<CopilotChat />` primitive. Demonstrates how the full send/render loop can be composed by hand from low-level hooks while still reusing CopilotKit's tool-rendering machinery.

## How to Interact

Try asking your Copilot to:

- "Show a card about cats"
- "Show me a card with a recipe for pancakes"
- "Display a card titled 'Reminder' with body 'Meeting at 3pm'"

## Technical Details

- **`useAgent`** gives you the raw agent handle (messages, `isRunning`, `addMessage`). No chat component is involved.
- **`useComponent`** registers a frontend-only tool (`show_card`) that the backend `SalesAgent` can invoke. The render function is a plain React component — its output flows through the same `useRenderToolCall` path the chat primitive uses internally.
- **`copilotkit.runAgent({ agent })`** is used instead of `agent.runAgent()` so that the frontend tool registrations are forwarded to the backend on each turn.
- **`useRenderToolCall`** returns a callable that converts an `AssistantMessage.toolCalls[i]` entry into a rendered React node using whatever renderer is registered for that tool name.

The page maps over `agent.messages` directly, branching on `role`, and drops tool-call renders inline under each assistant bubble.

## Backend

Reuses the same .NET `SalesAgent` exposed by `agent/Program.cs`. No backend changes are required — the frontend-registered `show_card` tool is forwarded to the agent on each run.
