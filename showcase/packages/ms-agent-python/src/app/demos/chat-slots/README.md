# Chat Slots

## What This Demo Shows

Custom welcome screen rendered via the CopilotChat slot system.

## How to Interact

On first load, the custom welcome screen (a gradient card) is shown in place of the default welcome view. Once you send a message, the chat falls back to the standard message view.

## Technical Details

- `<CopilotChat />` accepts a `welcomeScreen` slot that overrides the default welcome view.
- The slot component receives the default `input` and `suggestionView` elements as props, so custom welcome screens can still render the standard input and suggestions.
- This demo reuses the shared MS Agent Python backend; only the frontend chat UI differs.
