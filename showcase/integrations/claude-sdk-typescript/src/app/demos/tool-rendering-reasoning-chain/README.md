# Tool Rendering — Reasoning Chain

## What This Demo Shows

A single chat that combines:

1. Reasoning tokens rendered via a custom `reasoningMessage` slot.
2. Sequential tool calls rendered with per-tool components for
   `get_weather` and `search_flights`, plus a wildcard catch-all renderer
   for everything else.

## How to Interact

- "What's the weather in Tokyo?"
- "How is AAPL doing?"
- "Find flights from SFO to JFK."

## Technical Details

- Backend: Claude 3.7 Sonnet with extended thinking enabled. The Claude
  Agent SDK pass-through forwards `thinking_delta` events to AG-UI as
  `REASONING_MESSAGE_*` events.
- Tools are registered as frontend tools with stub handlers (mock data),
  so the agent can call them and the renderers can paint results.
