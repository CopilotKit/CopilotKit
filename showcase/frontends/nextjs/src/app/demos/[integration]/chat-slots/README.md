# Chat Slots

## What This Demo Shows

How to replace parts of `CopilotChat` with its slot system. The page is a slot atlas: each slot that you can override has a dashed, colored outline.

- **Welcome screen**: `welcomeScreen` and its `welcomeMessage` sub-slot.
- **Messages** (`messageView`): the assistant, user and reasoning messages, and the cursor that shows while a reply streams.
- **Input** (`input`): the text area, the send button, the add-menu button and the disclaimer.
- **Suggestions** (`suggestionView`): the container and each suggestion pill.
- **Scrolling** (`scrollView`): the scroll-to-bottom button and the feather fade above the input.

## How to Interact

1. Hover a region to see the path of its slot.
2. Click the badge of a region to copy its slot path.
3. Send a message, or click a suggestion. Each reply renders inside the custom assistant-message slot.

## Technical Details

- Each custom slot wraps the default component in a `SlotMarker`, so markdown, streaming and tool UI still work.
- `makeSlotOverride` (in `../_shared/slot-override.ts`) gives each wrapper the exact type that its slot prop expects.
- The `input` prop takes slot overrides and `CopilotChatInput` props together. The page sets `toolsMenu`, so the add-menu button renders.
- The reasoning-message slot renders only when the agent streams reasoning. The `reasoning-default` and `reasoning-custom` demos show reasoning.
- Nothing renders `slot-overrides.snippet.tsx`. It holds short slot examples for the docs.
