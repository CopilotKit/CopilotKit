# Prebuilt Popup

## What This Demo Shows

Floating `<CopilotPopup />` chat overlay launched from a corner bubble.

## How to Interact

The popup opens by default. Click the launcher bubble in the corner to toggle it closed/open.

## Technical Details

- `<CopilotPopup />` is a pre-built chat component that renders as a floating overlay.
- `defaultOpen={true}` makes the popup visible on initial load.
- `labels.chatInputPlaceholder` customizes the input placeholder text.
- This demo reuses the shared MS Agent Python backend (no agent-specific logic on the frontend).
