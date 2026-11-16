# Agentic Chat

## What This Demo Shows

The simplest CopilotKit surface: a plain chat with an agent. The same page works with every integration.

- **Conversation**: chat with the agent in the prebuilt chat UI.
- **Streaming**: assistant messages stream in token by token over AG-UI.
- **Suggestions**: three starter prompts show as chips below the chat input.

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Write a short sonnet about AI"
- "Explain the difference between an LLM and an agent"
- "Give me three ideas for a weekend project"

## Technical Details

`CopilotKit` connects the page to the runtime:

- `runtimeUrl` is `/api/<integration>/agentic-chat`. `useDemoRuntimeUrl("agentic-chat")` makes it from the `[integration]` segment of the page URL.
- `agent="agentic_chat"` selects the agent that `src/integrations/<integration>/agents.ts` registers for this demo.

`CopilotChat` renders the full chat UI: the input, the message list and the streamed replies.

`useConfigureSuggestions` registers the static suggestions. They show as chips below the chat input.
