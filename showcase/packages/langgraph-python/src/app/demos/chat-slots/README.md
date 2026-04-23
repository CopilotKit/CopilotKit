# Chat Customization (Slots)

## What This Demo Shows

How to swap out individual pieces of `CopilotChat` — its welcome screen, input disclaimer, and assistant message bubble — via the slot system, without rebuilding the chat from scratch.

- **Custom welcome screen**: a gradient "Welcome to the Slots demo" card wraps the default input + suggestion chips
- **Custom disclaimer**: a project-specific notice shown under the chat input
- **Custom assistant message**: rewraps how assistant replies are rendered

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Write a short sonnet about AI."
- "Tell me a short joke."
- "Explain CopilotKit slots in one paragraph"

Each response flows through the custom assistant-message slot.

## Technical Details

- `CopilotKit` wires the page with `runtimeUrl="/api/copilotkit"` and `agent="chat-slots"`, backed by the default `graph` in `src/agents/main.py`
- `CopilotChat` accepts three slot props: `welcomeScreen={CustomWelcomeScreen}`, `input={{ disclaimer: CustomDisclaimer }}`, and `messageView={{ assistantMessage: CustomAssistantMessage }}`
- The welcome slot receives the default `input` and `suggestionView` as React elements and composes them inside its own gradient card — slots are additive, not all-or-nothing
- `useConfigureSuggestions` seeds two starter chips ("Write a sonnet", "Tell me a joke")
- Use slots when you want to keep CopilotKit's chat behavior but restyle or reshape one specific piece; reach for a headless build only if you need to control the full loop
