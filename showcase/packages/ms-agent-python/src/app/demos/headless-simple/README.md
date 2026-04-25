# Headless Chat (Simple)

## What This Demo Shows

A minimal custom chat surface built on top of `useAgent` instead of the pre-built `<CopilotChat />` component. Demonstrates the smallest possible composition needed to drive the MS Agent Framework runtime from a hand-rolled UI.

## How to Interact

Try asking your Copilot to:

- "Show a card about cats"
- "Show a card with today's weather tips"
- "What's the weather in Tokyo?" (uses the shared MS Agent backend tool)
- "Add a sales todo called 'Follow up with Acme'"

The shared MS Agent is reused under the agent id `headless-simple`, so every backend tool available in the rest of the showcase (weather, sales todos, schedule meeting, search flights, generate_a2ui) is still reachable — only the chat chrome is hand-rolled.

## Technical Details

**`useAgent`** returns the live agent instance whose `.messages` array and `.isRunning` flag drive the view. Because the agent is reactive, simply rendering from `agent.messages` is enough — no extra subscriptions are needed.

**`useComponent`** registers a frontend-only tool the agent can invoke. Here it registers `show_card`, a Zod-typed component that the agent can call to render inline cards. `useComponent` is sugar over `useFrontendTool` + a `useRenderToolCall` renderer, so the same message list code handles both backend tool renders and frontend component renders.

**`useRenderToolCall`** returns a render function that knows how to route a tool call to its registered renderer (e.g. the `ShowCard` component above). Calling it inline inside the map over `agent.messages` keeps the generative-UI weave intact without needing `<CopilotChatMessageView>`.

**`copilotkit.runAgent({ agent })`** is the correct way to start a turn from custom UI. Calling `agent.runAgent()` directly would bypass frontend-tool forwarding, so the agent wouldn't see `show_card`. The helper on the `copilotkit` object takes care of tool registration.

## Building With This

If you want the full manual message-list composition (reasoning, activity messages, custom-message renderers, tool-result pairing), see the sibling [Headless Chat (Complete)](../headless-complete/README.md) demo — it re-composes the entire generative-UI pipeline from the low-level hooks.
