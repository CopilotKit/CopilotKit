# Reasoning (Default Render)

## What This Demo Shows

Zero-config reasoning rendering: CopilotKit's built-in
`CopilotChatReasoningMessage` renders the agent's chain-of-thought as a
collapsible "Thought for X" card, without any custom slot wiring on the
page.

Pair this with `agentic-chat-reasoning` to compare the defaults against
a custom `reasoningMessage` slot renderer.

## How to Interact

Same as `agentic-chat-reasoning` — ask anything that benefits from
step-by-step thinking:

- "How many seconds are in a non-leap year?"
- "Suggest three weekend activities in Austin in April."
- "What's a reasonable daily water intake for a 70kg adult?"

## Technical Details

### Backend — shared with `agentic-chat-reasoning`

Uses the same `ReasoningAgent` wrapper defined in
`agent/ReasoningAgent.cs` and mounted at `/reasoning` in
`agent/Program.cs`. That agent emits `TextReasoningContent` chunks,
which AG-UI hosting surfaces as `REASONING_MESSAGE_*` events.

### Frontend — `page.tsx`

No custom `reasoningMessage` slot is passed:

```tsx
<CopilotChat
  agentId="reasoning-default-render"
  className="h-full rounded-2xl"
/>
```

`CopilotChatMessageView` discriminates messages by
`message.role === "reasoning"` and routes them to the default
`CopilotChatReasoningMessage` component, which shows a "Thinking…" /
"Thought for X" header with an expandable content region.

### Runtime — `src/app/api/copilotkit-reasoning/route.ts`

Shared with `agentic-chat-reasoning`. Proxies to the .NET backend's
`/reasoning` AG-UI endpoint.

## Building With This

This demo is deliberately minimal — it shows the "happy path" where you
don't have to think about reasoning rendering at all. If you want to
customize the look of the reasoning block, see
`agentic-chat-reasoning/reasoning-block.tsx` for the slot-override
pattern.
