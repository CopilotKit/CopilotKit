# QA: Agentic Chat (OpenClaw)

Demo source: `src/app/demos/agentic-chat/page.tsx`
Route: `/demos/agentic-chat` · Agent: `agentic_chat`

## What it exercises

The simplest OpenClaw surface: a plain agentic chat with no frontend tools,
render tools, or agent context. `CopilotChat` renders the full chat UI; the
message goes over AG-UI to the ag-ui gateway, which relays the OpenClaw run
back as streaming `TEXT_MESSAGE_*` events. Three static suggestion chips are
registered via `useConfigureSuggestions` (`available: "always"`), so they show
before and between turns. This is a pass-through demo — behaviour is chat +
token streaming from the single stateless gateway endpoint, nothing per-demo.

## Manual steps

1. Open the demo. Confirm the chat composer renders and three suggestion chips
   appear: **"Write a sonnet"**, **"Tell me a joke"**, **"Is 17 prime?"**.
2. Type **"Hello"** and send. Expect a coherent assistant reply that streams in
   token-by-token (text appears incrementally, not all at once).
3. Click the **"Is 17 prime?"** chip. Expect it to send that message and the
   agent to walk through the reasoning and conclude 17 is prime.
4. Send a follow-up (e.g. **"And is 18?"**). Confirm the conversation stays
   coherent across turns (context is carried within the thread).
5. Confirm the suggestion chips reappear after the turn completes.

## Assertion bar

- Assistant messages stream (incremental tokens), not a single delayed block.
- Multi-turn context holds within the thread.
- All three suggestion chips render and, when clicked, send their message.
- No tool cards appear — this demo forwards no tools.

## Protocol-level check (no browser)

Inside the running container, POST a plain `RunAgentInput` (one user message, no
`tools`) to `http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE stream contains
`TEXT_MESSAGE_START` → one or more `TEXT_MESSAGE_CONTENT` → `TEXT_MESSAGE_END`,
then `RUN_FINISHED`.
