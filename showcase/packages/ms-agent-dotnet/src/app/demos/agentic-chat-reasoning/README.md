# Agentic Chat (Reasoning)

## What This Demo Shows

Visible display of the agent's step-by-step reasoning in the chat UI,
rendered with a custom amber banner so the thinking chain is always
front-and-center.

## How to Interact

Ask anything that benefits from a bit of step-by-step thinking:

- "If a train leaves at 3pm traveling at 60mph, when does it arrive 150 miles away?"
- "Plan a 3-day itinerary for Tokyo on a moderate budget."
- "What's the best way to split a $178 bill three ways including 18% tip?"

For every answer, the agent first emits a reasoning block (what it's
thinking), then a concise final answer.

## Technical Details

### Backend — `agent/ReasoningAgent.cs`

- `ReasoningAgentFactory.Create` builds a `ChatClientAgent` whose system
  prompt forces the model to produce output of the shape:

  ```
  <reasoning>
  step-by-step thinking
  </reasoning>
  concise final answer
  ```

- `ReasoningAgent` wraps that inner agent as a `DelegatingAIAgent`. It
  streams text through a small state-machine splitter that detects the
  `<reasoning>...</reasoning>` tags across chunk boundaries, emits the
  reasoning segment as `TextReasoningContent`, and emits the answer
  segment as ordinary `TextContent`. Non-text content (tool calls, data,
  usage) is forwarded unchanged.

- AG-UI hosting surfaces `TextReasoningContent` as
  `REASONING_MESSAGE_*` events, which arrive on the frontend as
  first-class `ReasoningMessage` items in the chat store.

### Frontend — `page.tsx` + `reasoning-block.tsx`

- `ReasoningBlock` is a custom renderer for the `reasoningMessage` slot.
  It receives the `ReasoningMessage`, the full message list, and the
  running state, and renders the content inside a tagged amber banner.

- The page wires this renderer into `CopilotChat` via the `messageView`
  slot:

  ```tsx
  <CopilotChat
    agentId="agentic-chat-reasoning"
    messageView={{
      reasoningMessage: ReasoningBlock as typeof CopilotChatReasoningMessage,
    }}
  />
  ```

### Runtime — `src/app/api/copilotkit-reasoning/route.ts`

Both reasoning demos share this dedicated runtime route, which proxies
to the .NET backend's `/reasoning` AG-UI endpoint.

## Building With This

If your agent already produces reasoning tokens (e.g. via a reasoning-
capable model API), you don't need the splitter at all — just emit
`TextReasoningContent` chunks and they'll flow through as reasoning
events. The splitter here is a portability shim for models that don't
have a native reasoning channel: the agent's system prompt is responsible
for producing the `<reasoning>...</reasoning>` shape, and the splitter
does the rest.
