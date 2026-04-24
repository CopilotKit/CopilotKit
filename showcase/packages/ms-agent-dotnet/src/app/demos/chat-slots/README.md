# Chat Slots

## What This Demo Shows

How to override built-in chat UI regions using the `CopilotChat` **slot** system. Three slots are overridden:

- `welcomeScreen` — the empty-state card shown before the first message
- `input.disclaimer` — the small disclaimer line under the input box
- `messageView.assistantMessage` — the card rendered for each assistant reply

## How to Interact

- On page load you see the gradient welcome card (custom `welcomeScreen`) with a "slot"-tagged disclaimer under the input
- Ask anything (for example "Tell me a joke") and watch the assistant reply render inside a custom indigo card (custom `assistantMessage`)

## Technical Details

- `<CopilotChat>` accepts `welcomeScreen`, `input`, and `messageView` props; each can receive either a single component or an object mapping sub-slot names to components.
- The custom `assistantMessage` wraps the default `CopilotChatAssistantMessage` rather than reimplementing it, so markdown rendering, streaming, and tool UI all still work.
- The agent name `chat-slots` is registered in `src/app/api/copilotkit/route.ts` and forwards to the shared .NET `ProverbsAgent`.
